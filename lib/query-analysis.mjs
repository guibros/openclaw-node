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
 * Analyze a user prompt for memory retrieval seeding.
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
