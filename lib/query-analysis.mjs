/**
 * query-analysis.mjs — Per-prompt analysis for proactive memory injection.
 *
 * Analyzes user prompts via:
 * 1. BGE-M3 embedding (one pass, ~50-150ms on M4) — replaces REFERENCE_PLAN's LLM call approach
 * 2. Regex fallback for structured cues (file paths, version/step refs, code identifiers)
 *
 * Returns an analysis result consumed by the memory injector (Step 7.2).
 *
 * @module lib/query-analysis
 */

// Default wall timeout for the LLM analysis call (ms). Env-configurable; must
// exceed the analysis model's real latency (warm qwen3:8b ~2.7s) or the inject
// path always degrades to embedding-only. Mirrors llm-client DEFAULT_ANALYSIS_TIMEOUT.
const DEFAULT_ANALYSIS_TIMEOUT = Number(process.env.LLM_ANALYSIS_TIMEOUT) || 8000;

// ─── Regex Patterns ──────────────────────────────────────────────────────────

/** Matches file paths like `lib/foo.mjs`, `src/bar/baz.ts`, `test/x.test.js` */
const FILE_PATH_RE = /(?:^|[\s(["'])(\w[\w.-]*\/[\w./-]+\.\w+)/g;

/** Matches version references like `v6.4`, `v7.1-pre`, `v0.1-mid` */
const VERSION_REF_RE = /\bv\d+\.\d+(?:-(?:pre|mid))?\b/gi;

/** Matches step references like `Step 3.1`, `step 7.1`, `Step 0.7` */
const STEP_REF_RE = /\bstep\s+\d+\.\d+\b/gi;

/** Matches backtick-delimited code identifiers like `createBudget`, `spreadingActivation` */
const CODE_REF_RE = /`([^`\n]{1,80})`/g;

// ─── Structured Cue Extraction ───────────────────────────────────────────────

/**
 * Extract structured cues from a prompt via regex patterns.
 * Pure function — no async, no side effects.
 *
 * @param {string} text — user prompt
 * @returns {{ filePaths: string[], versionRefs: string[], codeRefs: string[] }}
 */
export function extractStructuredCues(text) {
  if (!text || typeof text !== 'string') {
    return { filePaths: [], versionRefs: [], codeRefs: [] };
  }

  const filePaths = [];
  for (const m of text.matchAll(FILE_PATH_RE)) {
    filePaths.push(m[1] || m[0]);
  }

  const versionRefs = [];
  for (const m of text.matchAll(VERSION_REF_RE)) {
    versionRefs.push(m[0]);
  }
  for (const m of text.matchAll(STEP_REF_RE)) {
    versionRefs.push(m[0]);
  }

  const codeRefs = [];
  for (const m of text.matchAll(CODE_REF_RE)) {
    codeRefs.push(m[1]);
  }

  return {
    filePaths: [...new Set(filePaths)],
    versionRefs: [...new Set(versionRefs)],
    codeRefs: [...new Set(codeRefs)],
  };
}

// ─── Embedding ───────────────────────────────────────────────────────────────

/**
 * Embed a prompt via the BGE-M3 stack from mcp-knowledge.
 * Returns null on any failure (model not cached, import error, etc.).
 *
 * @param {string} prompt — text to embed
 * @param {Function} [embedFn] — injected embed function (for testing); defaults to mcp-knowledge embed
 * @returns {Promise<Float32Array|null>}
 */
export async function embedPrompt(prompt, embedFn) {
  if (!prompt || typeof prompt !== 'string') return null;

  try {
    if (!embedFn) {
      const { embed } = await import('./mcp-knowledge/core.mjs');
      embedFn = embed;
    }
    return await embedFn(prompt);
  } catch {
    return null;
  }
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

/**
 * Analyze a user prompt for memory retrieval seeding (embedding-only path).
 *
 * Produces an analysis result with:
 * - rawQuery: the original prompt string (for text-based pipeline channels)
 * - embedding: Float32Array from BGE-M3 (or null if unavailable)
 * - structuredCues: regex-extracted file paths, version refs, code refs
 *
 * @param {string} prompt — user prompt text
 * @param {{ embedFn?: Function }} [opts] — optional overrides (embedFn for testing)
 * @returns {Promise<{ rawQuery: string, embedding: Float32Array|null, structuredCues: { filePaths: string[], versionRefs: string[], codeRefs: string[] } }>}
 */
export async function analyzeQuery(prompt, opts = {}) {
  const rawQuery = (prompt && typeof prompt === 'string') ? prompt : '';
  const structuredCues = extractStructuredCues(rawQuery);
  const embedding = await embedPrompt(rawQuery, opts.embedFn);

  return { rawQuery, embedding, structuredCues };
}

// ─── LLM-Based Analysis (with embedding fallback) ────────────────────────────

const LLM_ANALYSIS_SYSTEM_PROMPT = `You analyze a single user prompt and return ONE JSON object classifying it for a memory-retrieval system. Output ONLY the JSON, no commentary.

Schema:
{
  "intent": "debug" | "design" | "explain" | "implement" | "plan" | "research" | "review" | "other",
  "entities": [string, ...],         // named things: tech, files, people, projects
  "themes": [string, ...],            // higher-level topics: messaging, memory, federation
  "sentiment": "neutral" | "frustrated" | "curious" | "urgent",
  "continues_thread": true | false,   // is this a follow-up to a prior conversation?
  "explicit_references": [string, ...] // any "the bug we discussed" / "yesterday's plan" style refs
}

Be concise. If a field is empty, return an empty array or "neutral"/"other". /no_think`;

/**
 * Analyze a user prompt using BOTH the LLM analyzer AND the embedding-only
 * baseline. The LLM analysis provides intent/sentiment/disambiguation that
 * embedding alone cannot. Falls back gracefully to embedding-only when the
 * LLM queue is busy with extraction or the LLM call times out.
 *
 * The embedding work happens regardless — semantic retrieval needs it.
 *
 * @param {string} prompt — user prompt text
 * @param {object} llmClient — created by createLlmClient(); must expose generateAnalysis()
 * @param {object} [opts]
 * @param {number} [opts.waitTimeoutMs=8000] — wall timeout for the LLM analysis call (env LLM_ANALYSIS_TIMEOUT)
 * @param {Function} [opts.embedFn]
 * @returns {Promise<{
 *   rawQuery: string,
 *   embedding: Float32Array|null,
 *   structuredCues: object,
 *   llmAnalysis: object|null,
 *   analysisMode: 'llm' | 'embedding-fallback' | 'embedding-only',
 *   fallbackReason: string|null,
 *   ollamaState: object|null,
 *   etaMs: number|null,
 *   timings: { embedMs: number, llmMs: number|null }
 * }>}
 */
export async function analyzeQueryWithLlm(prompt, llmClient, opts = {}) {
  const rawQuery = (prompt && typeof prompt === 'string') ? prompt : '';
  const structuredCues = extractStructuredCues(rawQuery);

  // Skip the LLM if the operator forced embedding-only mode
  if (process.env.ANALYSIS_MODE === 'embedding') {
    const t0 = Date.now();
    const embedding = await embedPrompt(rawQuery, opts.embedFn);
    return {
      rawQuery, embedding, structuredCues,
      llmAnalysis: null,
      analysisMode: 'embedding-only',
      fallbackReason: null,
      ollamaState: null,
      etaMs: null,
      timings: { embedMs: Date.now() - t0, llmMs: null },
    };
  }

  // Run embedding + LLM analysis in parallel — embedding is needed regardless.
  const t0 = Date.now();
  const embedPromise = embedPrompt(rawQuery, opts.embedFn);

  let llmAnalysis = null;
  let analysisMode = 'llm';
  let fallbackReason = null;
  let ollamaState = null;
  let etaMs = null;
  let llmMs = null;

  if (!llmClient || typeof llmClient.generateAnalysis !== 'function') {
    // No LLM client provided — embedding-only mode
    analysisMode = 'embedding-only';
  } else {
    const tLlm = Date.now();
    try {
      const result = await llmClient.generateAnalysis([
        { role: 'system', content: LLM_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user',   content: rawQuery },
      ], { jsonMode: true, maxTokens: 512, waitTimeoutMs: opts.waitTimeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT });

      llmMs = Date.now() - tLlm;

      if (result.mode === 'fallback') {
        analysisMode = 'embedding-fallback';
        fallbackReason = result.reason;
        ollamaState = result.ollama_state;
        etaMs = result.eta_ms;
      } else {
        try {
          llmAnalysis = JSON.parse(result.value.content);
        } catch {
          // Malformed JSON — treat as fallback for safety
          analysisMode = 'embedding-fallback';
          fallbackReason = 'llm-malformed-json';
        }
      }
    } catch (err) {
      llmMs = Date.now() - tLlm;
      analysisMode = 'embedding-fallback';
      fallbackReason = `llm-error:${err.message.slice(0, 80)}`;
    }
  }

  const embedding = await embedPromise;
  const embedMs = Date.now() - t0 - (llmMs ?? 0);

  return {
    rawQuery, embedding, structuredCues,
    llmAnalysis,
    analysisMode,
    fallbackReason,
    ollamaState,
    etaMs,
    timings: { embedMs: Math.max(0, embedMs), llmMs },
  };
}
