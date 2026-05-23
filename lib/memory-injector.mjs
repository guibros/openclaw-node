/**
 * memory-injector.mjs — Pre-retrieve and budget ambient memory for proactive injection.
 *
 * Consumes:
 *   - analyzeQuery from lib/query-analysis.mjs (Step 7.1)
 *   - createRetrievalPipeline from lib/retrieval-pipeline.mjs (Step 6.2)
 *   - extraction store queries (entities, decisions) from state.db
 *
 * Returns budgeted structured data ready for formatting by Step 7.3.
 * Does NOT format the [memory: ...] block (Step 7.3) or parse @memory directives (Step 7.4).
 *
 * @module lib/memory-injector
 */

import { analyzeQuery, analyzeQueryWithLlm } from './query-analysis.mjs';
import { createRetrievalPipeline } from './retrieval-pipeline.mjs';
import { logInjection, channelStats, promptExcerpt } from './injection-logger.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default injection token budget per Block 7 frozen decisions (midpoint of 500-1000). */
export const DEFAULT_TOKEN_BUDGET = 750;

/** Char-based heuristic for token estimation (~4 chars/token). */
export const CHARS_PER_TOKEN = 4;

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Estimate token count from text using char-based heuristic.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── Extraction Store Queries ────────────────────────────────────────────────

/**
 * Query entities relevant to the retrieved sessions.
 * Returns entities that have mentions in the given session IDs,
 * sorted by aggregate salience then mention count.
 *
 * @param {import('better-sqlite3').Database} db — extraction store database
 * @param {string[]} sessionIds — session IDs from retrieval results
 * @param {number} [limit=10]
 * @returns {Array<{name: string, type: string, mentionCount: number}>}
 */
export function queryRelevantConcepts(db, sessionIds, limit = 10) {
  if (!sessionIds || !sessionIds.length) return [];
  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT e.name, e.type, e.mention_count,
             AVG(m.salience) as avg_salience
      FROM entities e
      JOIN mentions m ON e.id = m.entity_id
      WHERE m.session_id IN (${placeholders})
      GROUP BY e.id
      ORDER BY avg_salience DESC, e.mention_count DESC
      LIMIT ?
    `).all(...sessionIds, limit);
    return rows.map(r => ({
      name: r.name,
      type: r.type,
      mentionCount: r.mention_count,
    }));
  } catch {
    return [];
  }
}

/**
 * Query decisions from retrieved sessions.
 * Returns decisions ordered by confidence (desc) then recency.
 *
 * @param {import('better-sqlite3').Database} db — extraction store database
 * @param {string[]} sessionIds — session IDs from retrieval results
 * @param {number} [limit=5]
 * @returns {Array<{decision: string, confidence: number, date: string}>}
 */
export function queryRelevantDecisions(db, sessionIds, limit = 5) {
  if (!sessionIds || !sessionIds.length) return [];
  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT decision, confidence, created_at
      FROM decisions
      WHERE session_id IN (${placeholders})
      ORDER BY confidence DESC, created_at DESC
      LIMIT ?
    `).all(...sessionIds, limit);
    return rows.map(r => ({
      decision: r.decision,
      confidence: r.confidence,
      date: r.created_at,
    }));
  } catch {
    return [];
  }
}

// ─── Budget Trimming ─────────────────────────────────────────────────────────

/**
 * Estimate the formatted token cost of a concept entry.
 * Format: "EntityName (type)" — used in "Active concepts: ..." list.
 *
 * @param {{ name: string, type: string }} c
 * @returns {number}
 */
function conceptCost(c) {
  return estimateTokens(`${c.name} (${c.type}), `);
}

/**
 * Estimate the formatted token cost of a decision entry.
 * Format: "- YYYY-MM-DD: decision text (confidence)"
 *
 * @param {{ decision: string, confidence: number, date: string }} d
 * @returns {number}
 */
function decisionCost(d) {
  const dateStr = d.date ? d.date.slice(0, 10) : 'unknown';
  return estimateTokens(`- ${dateStr}: ${d.decision} (${d.confidence})\n`);
}

/**
 * Estimate the formatted token cost of a snippet entry.
 *
 * @param {{ snippet: string }} s
 * @returns {number}
 */
function snippetCost(s) {
  return estimateTokens(s.snippet || '');
}

/**
 * Trim concepts, decisions, and snippets to fit within the token budget.
 * Priority order: concepts first (cheapest), decisions second, snippets third (bulkiest).
 * Items are added greedily until the budget is exhausted.
 *
 * @param {{ concepts: Array, decisions: Array, snippets: Array }} data
 * @param {number} budget — token budget
 * @returns {{ concepts: Array, decisions: Array, snippets: Array, tokenCount: number, budget: number }}
 */
export function trimToBudget(data, budget) {
  // Overhead for delimiters, headers, labels (~30 tokens)
  const OVERHEAD = 30;
  let remaining = budget - OVERHEAD;

  if (remaining <= 0) {
    return { concepts: [], decisions: [], snippets: [], tokenCount: OVERHEAD, budget };
  }

  // Phase 1: Concepts (typically compact — entity names)
  const concepts = [];
  for (const c of (data.concepts || [])) {
    const cost = conceptCost(c);
    if (remaining - cost < 0) break;
    concepts.push(c);
    remaining -= cost;
  }

  // Phase 2: Decisions (moderate size — one-line summaries)
  const decisions = [];
  for (const d of (data.decisions || [])) {
    const cost = decisionCost(d);
    if (remaining - cost < 0) break;
    decisions.push(d);
    remaining -= cost;
  }

  // Phase 3: Snippets (bulkiest — session chunks, fill remaining budget)
  const snippets = [];
  for (const s of (data.snippets || [])) {
    const cost = snippetCost(s);
    if (remaining - cost < 0) break;
    snippets.push(s);
    remaining -= cost;
  }

  const tokenCount = budget - remaining;
  return { concepts, decisions, snippets, tokenCount, budget };
}

// ─── Pipeline Factory ────────────────────────────────────────────────────────

/**
 * Create a memory injector that pre-retrieves and budgets ambient memory.
 *
 * All database handles are optional — missing components disable their
 * corresponding channels gracefully.
 *
 * @param {{ knowledgeDb?: Database, extractionDb?: Database, graphCache?: object }} opts
 * @returns {{ retrieve: (prompt: string, opts?: object) => Promise<object> }}
 */
export function createMemoryInjector(opts = {}) {
  const { knowledgeDb, extractionDb, graphCache, llmClient } = opts;
  const pipeline = createRetrievalPipeline({ knowledgeDb, extractionDb, graphCache });

  /**
   * Pre-retrieve ambient memory for a user prompt.
   *
   * If an `llmClient` was provided to createMemoryInjector(), uses
   * analyzeQueryWithLlm() for richer signals (intent, sentiment, etc.)
   * — automatically falls back to embedding-only when the LLM queue is
   * busy with extraction. Without llmClient, runs in embedding-only mode.
   *
   * @param {string} prompt — user prompt text
   * @param {{ tokenBudget?: number, embedFn?: Function, sessionId?: string, frontend?: string, directive?: string }} [retrieveOpts]
   * @returns {Promise<{ concepts, decisions, snippets, tokenCount, budget, analysis: { mode, fallbackReason, ollamaState, etaMs, llm } }>}
   */
  async function retrieve(prompt, retrieveOpts = {}) {
    const budget = retrieveOpts.tokenBudget ||
      Number(process.env.INJECTION_TOKEN_BUDGET) ||
      DEFAULT_TOKEN_BUDGET;
    const t0 = Date.now();

    // Handle empty/invalid prompt
    if (!prompt || typeof prompt !== 'string') {
      return {
        concepts: [], decisions: [], snippets: [], tokenCount: 0, budget,
        analysis: { mode: 'noop', fallbackReason: null, ollamaState: null, etaMs: null, llm: null },
      };
    }

    // 1. Analyze the prompt (LLM + embedding if llmClient available; embedding-only otherwise)
    let analysis;
    if (llmClient && process.env.ANALYSIS_MODE !== 'embedding') {
      analysis = await analyzeQueryWithLlm(prompt, llmClient, {
        embedFn: retrieveOpts.embedFn,
        waitTimeoutMs: retrieveOpts.analysisTimeoutMs,
      });
    } else {
      const base = await analyzeQuery(prompt, { embedFn: retrieveOpts.embedFn });
      analysis = {
        ...base,
        llmAnalysis: null,
        analysisMode: 'embedding-only',
        fallbackReason: null,
        ollamaState: null,
        etaMs: null,
        timings: { embedMs: Date.now() - t0, llmMs: null },
      };
    }

    const tRetrieve = Date.now();

    // 2. Run the 5-channel retrieval pipeline
    const results = await pipeline.retrieve(analysis.rawQuery, { k: 10 });

    // 3. Get unique session IDs from retrieval results
    const sessionIds = [...new Set(results.map(r => r.session_id))];

    // 4. Query extraction store for relevant concepts + decisions
    let concepts = [];
    let decisions = [];
    if (extractionDb) {
      concepts = queryRelevantConcepts(extractionDb, sessionIds);
      decisions = queryRelevantDecisions(extractionDb, sessionIds);
    }

    // 5. Build snippets from retrieval results
    const snippets = results.map(r => ({
      sessionId: r.session_id,
      snippet: r.snippet,
      score: r.score,
    }));

    const tCurate = Date.now();

    // 6. Trim everything to fit within token budget
    const trimmed = trimToBudget({ concepts, decisions, snippets }, budget);

    const tDone = Date.now();

    const out = {
      ...trimmed,
      analysis: {
        mode: analysis.analysisMode,
        fallbackReason: analysis.fallbackReason,
        ollamaState: analysis.ollamaState,
        etaMs: analysis.etaMs,
        llm: analysis.llmAnalysis,
      },
    };

    // 7. Log the injection (fire-and-forget)
    logInjection({
      session_id: retrieveOpts.sessionId || null,
      frontend: retrieveOpts.frontend || 'unknown',
      prompt_excerpt: promptExcerpt(prompt, 200),
      directive: retrieveOpts.directive || null,
      analysis_mode: analysis.analysisMode,
      fallback_reason: analysis.fallbackReason,
      ollama_state: analysis.ollamaState,
      items_injected: {
        concepts: trimmed.concepts.map(c => c.name),
        decisions: trimmed.decisions.map(d => ({ session: d.session_id, confidence: d.confidence })),
        sessions: [...new Set(trimmed.snippets.map(s => s.sessionId))],
      },
      total_tokens: trimmed.tokenCount,
      latency_ms: {
        analysis: analysis.timings?.embedMs ?? 0,
        analysis_llm: analysis.timings?.llmMs ?? null,
        retrieve: tCurate - tRetrieve,
        curate: tDone - tCurate,
        total: tDone - t0,
      },
    }).catch(() => {});

    return out;
  }

  return { retrieve };
}

// ─── Degraded-Mode Warning Formatter ─────────────────────────────────────────

/**
 * Format a degraded-mode warning for the `[memory: ...]` block.
 * Visible to the receiving LLM so it knows context may be missing.
 *
 * @param {object} analysis — the analysis sub-object from retrieve()
 * @returns {string} — formatted warning text, or empty string if not degraded
 */
export function formatDegradedWarning(analysis) {
  if (!analysis || analysis.mode === 'llm' || analysis.mode === 'embedding-only' || analysis.mode === 'noop') {
    return '';
  }

  const reason = analysis.fallbackReason || 'unknown';
  const eta = analysis.etaMs ? `~${Math.ceil(analysis.etaMs / 60000)} min remaining` : 'duration unknown';
  const elapsed = analysis.ollamaState?.elapsed_ms
    ? `${Math.round(analysis.ollamaState.elapsed_ms / 1000)}s elapsed`
    : null;

  let causeLabel = reason;
  if (reason === 'ollama-busy-extraction') {
    causeLabel = `local LLM busy with background extraction job` +
      (analysis.ollamaState ? ` (${elapsed}, ${eta})` : '');
  } else if (reason === 'analysis-wait-timeout') {
    causeLabel = `query analysis timed out — LLM queue contended`;
  } else if (reason === 'analysis-call-timeout') {
    causeLabel = `query analysis call exceeded its timeout`;
  } else if (reason === 'llm-malformed-json') {
    causeLabel = `analysis LLM returned malformed JSON`;
  } else if (reason.startsWith('llm-error:')) {
    causeLabel = `analysis LLM errored: ${reason.slice(10)}`;
  }

  return `⚠ degraded mode — ${causeLabel}. Falling back to embedding-only retrieval; results may miss implicit references and intent-shaped context.`;
}
