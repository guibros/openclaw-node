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
import { createRetrievalPipeline, reportChannelError } from './retrieval-pipeline.mjs';
import { logInjection, channelStats, promptExcerpt } from './injection-logger.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Default injection token SAFETY CEILING.
 *
 * Block 7 amendment (C) — human-recall-modeled curation: the dumb 750-token
 * cap of the original Block 7 §0 is demoted to a safety belt. The PRIMARY
 * curation lever is Miller 7±2 per-category caps + scoring + inhibition
 * (see curateForRecall below). The token ceiling exists only to prevent
 * pathological cases (e.g. very long snippets) from blowing past 1500
 * tokens of context.
 */
export const DEFAULT_TOKEN_BUDGET = Number(process.env.INJECTION_TOKEN_BUDGET) || 1500;

/** Char-based heuristic for token estimation (~4 chars/token). */
export const CHARS_PER_TOKEN = 4;

// ─── Human-Recall Curation Constants ─────────────────────────────────────────

/**
 * Per-category caps. Miller's 7±2 — humans hold 4-7 chunks in working memory.
 * Each category surfaces its top-K by composite recall score; rest is
 * "inhibited" (still in DB, just not in this injection's context block).
 */
export const RECALL_CAPS = {
  active_concepts:  7,
  recent_decisions: 5,
  related_sessions: 3,
  // F-M8: `themes` (3) and `contradictions` (2) caps removed — no caller
  // populates them and no formatter renders them. Re-add when there's an
  // actual consumer (would belong in a Block 11+ feature, not in this file).
};

/** Recency half-life in days — items get progressively less weight as they age. */
export const RECENCY_HALF_LIFE_DAYS = Number(process.env.RECALL_HALF_LIFE_DAYS) || 14;

/** Salience bump on reconsolidation (multiplicative, capped 1.0). */
export const RECONSOLIDATION_BOOST = Number(process.env.RECALL_BOOST) || 1.05;

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
export function queryRelevantConcepts(db, sessionIds, limit = 10, opts = {}) {
  if (!sessionIds || !sessionIds.length) return [];
  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    // F-C8/C9/C10/C12 fix: select id + salience + last_recalled + last_seen +
    // mention_count (matches schema name — recallScore reads item.mention_count
    // not item.mentionCount), and respect privacy filter when requested.
    const privacyClause = opts.respectPrivacy ? ' AND COALESCE(e.private, 1) = 0' : '';
    // F-N52 fix (F-C8/C10 regression): read e.salience directly instead of
    // AVG(m.salience). writeBackReconsolidation updates entities.salience,
    // and consolidation.decayWeights also operates on entities.salience.
    // The old AVG(mentions) read never saw either write, so the
    // "biological forgetting loop" never closed: recall couldn't bump
    // salience and decay couldn't dampen it. Mentions are count-only.
    const rows = db.prepare(`
      SELECT e.id, e.name, e.type, e.mention_count, e.last_seen, e.last_recalled, e.salience
      FROM entities e
      WHERE e.id IN (
        SELECT DISTINCT entity_id FROM mentions WHERE session_id IN (${placeholders})
      )${privacyClause}
      ORDER BY e.salience DESC, e.mention_count DESC, e.id ASC
      LIMIT ?
    `).all(...sessionIds, limit);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      mention_count: r.mention_count,        // snake_case to match recallScore
      mentionCount: r.mention_count,          // keep camelCase for backward compat
      salience: r.salience ?? 0.5,
      last_seen: r.last_seen,
      last_recalled: r.last_recalled,
    }));
  } catch (err) {
    reportChannelError('concepts', err);
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
export function queryRelevantDecisions(db, sessionIds, limit = 5, opts = {}) {
  if (!sessionIds || !sessionIds.length) return [];
  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    // F-C8/C10/C12 fix: select id + session_id + salience + last_recalled,
    // and respect privacy filter when requested.
    const privacyClause = opts.respectPrivacy ? ' AND COALESCE(d.private, 1) = 0' : '';
    const rows = db.prepare(`
      SELECT d.id, d.session_id, d.decision, d.confidence, d.created_at, d.salience, d.last_recalled
      FROM decisions d
      WHERE d.session_id IN (${placeholders})${privacyClause}
      ORDER BY d.confidence DESC, d.created_at DESC, d.id ASC
      LIMIT ?
    `).all(...sessionIds, limit);
    return rows.map(r => ({
      id: r.id,
      session_id: r.session_id,
      decision: r.decision,
      confidence: r.confidence,
      date: r.created_at,
      salience: r.salience ?? 0.5,
      last_recalled: r.last_recalled,
    }));
  } catch (err) {
    reportChannelError('decisions', err);
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
// ─── Human-Recall-Modeled Curation (Block 7 amendment C) ─────────────────────

/**
 * Compute a recall-shaped composite score for one item.
 *
 *   score = recency × frequency × salience × graph_activation × rrf
 *
 * - recency: exp(-days_since_last_recall / half_life)
 * - frequency: log1p(mention_count) — diminishing returns
 * - salience: 0..1 from the LLM extractor (or 0.5 default)
 * - graph_activation: 0..1 from Block 6 spreading activation (or 0)
 * - rrf: reciprocal rank fusion score from the 5-channel pipeline (or 0)
 *
 * The function takes a generic "item" shape with optional fields. Missing
 * fields contribute neutral multipliers (1) so partial data still scores.
 *
 * @param {object} item
 * @param {number} [item.mention_count]
 * @param {number} [item.salience]
 * @param {string} [item.last_recalled] — ISO timestamp or null
 * @param {string} [item.last_seen] — ISO timestamp (fallback if last_recalled is null)
 * @param {number} [item.graph_activation]
 * @param {number} [item.rrf_score]
 * @returns {number}
 */
export function recallScore(item) {
  if (!item) return 0;
  // F-N54 fix: bounded coercion against corrupt inputs. Previously a malformed
  // timestamp produced NaN → all-NaN score → V8 sort placed entries unpredictably
  // → writeBackReconsolidation issued updates for whatever survived. Also no
  // clamp on salience: a corrupt row with salience=1e9 dominated every recall.

  // Recency: time since item was last surfaced. Fall back to last_seen, then
  // created_at (P2: decisions carry created_at but no last_seen, so without this
  // an un-recalled decision was stuck at recency=1 and never aged). Corrupt ISO →
  // NaN → treat recency as 0. Cap days at 5y as a sanity ceiling.
  const lastTouchIso = item.last_recalled || item.last_seen || item.created_at;
  let recency = 1;
  if (lastTouchIso) {
    const ts = new Date(lastTouchIso).getTime();
    if (!Number.isFinite(ts)) {
      recency = 0;
    } else {
      const daysSince = Math.min(365 * 5, Math.max(0, (Date.now() - ts) / 86_400_000));
      recency = Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS);
    }
  }
  // F-C9 fix: read mention_count (snake_case matches schema + the new
  // queryRelevantConcepts output); also accept mentionCount as legacy alias.
  // F-N54: clamp to [0, 1e6] so a corrupt row can't dominate.
  const rawCount = Number.isFinite(item.mention_count)
    ? item.mention_count
    : Number.isFinite(item.mentionCount) ? item.mentionCount : 1;
  const mentionCount = Math.max(0, Math.min(1_000_000, rawCount));
  const frequency = Math.log1p(mentionCount);
  // F-N54: clamp salience to [0, 1] — defends against corrupt out-of-range writes.
  const rawSalience = Number.isFinite(item.salience) ? item.salience : 0.5;
  const salience = Math.max(0, Math.min(1, rawSalience));
  // Activation is allowed up to 1 by design; clamp defensively.
  const rawActivation = Number.isFinite(item.graph_activation) ? item.graph_activation : 0;
  const activation = Math.max(0, Math.min(1, rawActivation));
  // F-C11 fix: snippets carry the RRF score in .score (named by the pipeline);
  // accept either rrf_score or score so the 5-channel ranking actually feeds
  // back into the curator instead of always being 0.
  // F-N54: clamp rrf to [0, 1] — RRF normalization should always produce
  // values in this range, but defend against pipeline bugs.
  const rawRrf = Number.isFinite(item.rrf_score)
    ? item.rrf_score
    : Number.isFinite(item.score) ? item.score : 0;
  const rrf = Math.max(0, Math.min(1, rawRrf));
  // Multiplicative composition; (1 + activation) and (1 + rrf) so missing
  // graph or RRF data doesn't zero the whole score.
  const score = recency * frequency * salience * (1 + activation) * (1 + rrf);
  // Final defense: any input we missed reduces to 0 rather than NaN.
  return Number.isFinite(score) ? score : 0;
}

/**
 * Sort + inhibit + cap items in one category.
 * Top-K survive by score; competitors are dropped.
 *
 * @template T
 * @param {T[]} items
 * @param {number} cap
 * @returns {T[]}
 */
export function inhibitWithinGroup(items, cap) {
  if (!items || !items.length) return [];
  const scored = items.map(it => ({ ...it, _score: recallScore(it) }));
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, cap).map(({ _score, ...rest }) => rest);
}

/**
 * Human-recall-modeled curation. Replaces trimToBudget for the new injection
 * path. Each category gets a per-category cap (Miller 7±2); within each
 * category items are scored + sorted + inhibited. Token cap is the safety
 * ceiling, not the primary lever.
 *
 * Returns the curated sets PLUS a list of `recalled_ids` so the caller can
 * write back reconsolidation updates (Block 7 amendment C — close the loop).
 *
 * F-M8 cleanup: removed `themes` and `contradictions` from the curation
 * surface. The function used to reserve token budget for these two slots
 * and apply per-category caps, but no caller ever populated them and no
 * formatter rendered them — so the budget reservation was always 0 and
 * the caps were no-ops. Re-introduce these fields when there's an actual
 * caller wired up (would belong in a Block 11+ feature, not in this file).
 *
 * @param {{ concepts, decisions, snippets }} data
 * @param {number} [budget] — safety ceiling
 * @returns {{ concepts, decisions, snippets, tokenCount, budget, recalled: { entityIds: number[], decisionIds: number[] } }}
 */
export function curateForRecall(data, budget = DEFAULT_TOKEN_BUDGET) {
  const concepts = inhibitWithinGroup(data.concepts || [], RECALL_CAPS.active_concepts);
  const decisions = inhibitWithinGroup(data.decisions || [], RECALL_CAPS.recent_decisions);

  // Snippets are bulkiest — apply the cap AND respect the token ceiling.
  const rankedSnippets = inhibitWithinGroup(data.snippets || [], RECALL_CAPS.related_sessions * 2);
  const snippets = [];
  let tokens = OVERHEAD_TOKENS
    + concepts.reduce((s, c) => s + conceptCost(c), 0)
    + decisions.reduce((s, d) => s + decisionCost(d), 0);
  for (const s of rankedSnippets) {
    const cost = snippetCost(s);
    if (tokens + cost > budget) break;
    snippets.push(s);
    tokens += cost;
    if (snippets.length >= RECALL_CAPS.related_sessions) break;
  }

  return {
    concepts, decisions, snippets,
    tokenCount: tokens,
    budget,
    recalled: {
      entityIds: concepts.map(c => c.id).filter(Boolean),
      decisionIds: decisions.map(d => d.id).filter(Boolean),
    },
  };
}

/** Overhead estimate for `[memory: ...]` block scaffolding + headers. */
const OVERHEAD_TOKENS = 40;

/**
 * Reconsolidation write-back. Run after retrieve() to update last_recalled
 * and bump salience on the items that were surfaced. Completes the
 * biological forgetting loop with Block 8's decay job.
 *
 * @param {import('better-sqlite3').Database} db — extraction store
 * @param {{ entityIds: number[], decisionIds: number[] }} recalled
 */
export function writeBackReconsolidation(db, recalled) {
  if (!db || !recalled) return;
  const nowIso = new Date().toISOString();
  try {
    const stmtEntity = db.prepare(
      `UPDATE entities SET last_recalled = ?, salience = MIN(1.0, COALESCE(salience, 0.5) * ?) WHERE id = ?`
    );
    const stmtDecision = db.prepare(
      `UPDATE decisions SET last_recalled = ?, salience = MIN(1.0, COALESCE(salience, 0.5) * ?) WHERE id = ?`
    );
    const tx = db.transaction(() => {
      for (const id of (recalled.entityIds || [])) {
        try { stmtEntity.run(nowIso, RECONSOLIDATION_BOOST, id); } catch {}
      }
      for (const id of (recalled.decisionIds || [])) {
        try { stmtDecision.run(nowIso, RECONSOLIDATION_BOOST, id); } catch {}
      }
    });
    tx();
  } catch {
    // Best-effort — never crash the user's request because reconsolidation failed
  }
}

// ─── Legacy Token-Budget Trim (kept for back-compat / safety fallback) ───────

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
  const { knowledgeDb, extractionDb, graphCache } = opts;
  // Block 7 amendment (A): auto-instantiate an llmClient if none provided.
  // Default behavior is now LLM analysis (with embedding-fallback when the
  // queue is busy). Operators opt out via ANALYSIS_MODE=embedding env var.
  let llmClient = opts.llmClient;
  if (llmClient === undefined && process.env.ANALYSIS_MODE !== 'embedding') {
    try {
      // Lazy import — keep memory-injector usable in environments without llm-client.
      // F-M9 fix: memoize the PROMISE (not just the resolved client) so two
      // concurrent calls don't both fall through to createLlmClient(). Was:
      // both see !this._real, both create independent clients, second
      // replaces first; first's outstanding analysis is now bound to an
      // orphaned client.
      llmClient = {
        _lazy: true,
        _creating: null,
        async generateAnalysis(...args) {
          if (!this._real) {
            if (!this._creating) {
              this._creating = (async () => {
                const { createLlmClient } = await import('./llm-client.mjs');
                this._real = createLlmClient();
              })();
            }
            await this._creating;
          }
          return this._real.generateAnalysis(...args);
        },
      };
    } catch {
      llmClient = null;
    }
  }
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
    // F-N50 fix: privacy defaults to ON. Callers must opt out explicitly
    // (e.g. for an "audit my own private memory" UI). Without this default
    // the F-C12 fix in queryRelevant{Concepts,Decisions} was inert because
    // retrieve() invoked them with no opts.
    const respectPrivacy = retrieveOpts.respectPrivacy !== false;
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

    // 2. Run the 5-channel retrieval pipeline.
    // F-H25 fix: pass analysis.embedding so the pipeline's semantic channel
    // can reuse it instead of re-embedding the prompt internally. Was: double
    // embed cost per request.
    let results = await pipeline.retrieve(analysis.rawQuery, {
      k: 10,
      precomputedEmbedding: analysis.embedding ?? null,
      respect_privacy: respectPrivacy,  // F-N50/F-N51: thread privacy through
    });

    // F-N53 fix: rewire @memory only:X against entities (which DO link to
    // sessions via mentions). The previous F-H20 implementation used a
    // cartesian `JOIN themes t ON 1=1` because themes have no session
    // linkage in the schema — that made the filter all-or-nothing (any
    // theme containing X anywhere globally would pass every input session,
    // no matching theme dropped them all). Now: keep sessions whose
    // mentions reference an entity name or type matching X.
    if (retrieveOpts.themeFilter && extractionDb && results.length) {
      const filter = String(retrieveOpts.themeFilter).toLowerCase().trim();
      if (filter) {
        try {
          const sessionIdsList = [...new Set(results.map(r => r.session_id))];
          if (sessionIdsList.length) {
            const placeholders = sessionIdsList.map(() => '?').join(',');
            const matchingSessions = extractionDb.prepare(
              `SELECT DISTINCT m.session_id
               FROM mentions m
               JOIN entities e ON m.entity_id = e.id
               WHERE m.session_id IN (${placeholders})
                 AND (LOWER(e.name) LIKE ? OR LOWER(e.type) LIKE ?)`
            ).all(...sessionIdsList, `%${filter}%`, `%${filter}%`);
            const keepSet = new Set(matchingSessions.map(r => r.session_id));
            results = results.filter(r => keepSet.has(r.session_id));
          }
        } catch {
          // Filter failed (e.g. extraction tables missing) — fall through
          // unfiltered. Acceptable: missing extraction is fail-OPEN for
          // retrieval (the user gets results), only privacy fails closed.
        }
      }
    }

    // 3. Get unique session IDs from retrieval results
    const sessionIds = [...new Set(results.map(r => r.session_id))];

    // 4. Query extraction store for relevant concepts + decisions
    // F-N50 fix: pass respectPrivacy through so private entities/decisions
    // don't reach the injection block. The F-C12 helpers accept this opt
    // but the live caller never set it before this fix.
    let concepts = [];
    let decisions = [];
    if (extractionDb) {
      concepts = queryRelevantConcepts(extractionDb, sessionIds, 10, { respectPrivacy });
      decisions = queryRelevantDecisions(extractionDb, sessionIds, 5, { respectPrivacy });
    }

    // 5. Build snippets from retrieval results
    const snippets = results.map(r => ({
      sessionId: r.session_id,
      snippet: r.snippet,
      score: r.score,
    }));

    const tCurate = Date.now();

    // 6. Curate via human-recall model (Block 7 amendment C):
    //    score = recency × frequency × salience × graph_activation × rrf
    //    + per-category Miller 7±2 caps + inhibition + reconsolidation write-back.
    //    Token budget is the SAFETY CEILING, not the primary lever.
    const curated = curateForRecall({ concepts, decisions, snippets }, budget);

    // 7. Reconsolidation write-back — bump last_recalled + salience on surfaced items
    if (extractionDb && curated.recalled) {
      writeBackReconsolidation(extractionDb, curated.recalled);
    }
    const trimmed = curated;  // preserve variable name for the rest of the function

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
