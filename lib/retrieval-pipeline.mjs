/**
 * retrieval-pipeline.mjs — 6-channel retrieval pipeline with weighted RRF.
 *
 * Channels:
 *   1. FTS5 keyword search (searchSessionsFts from mcp-knowledge)
 *   2. Vector / semantic search (searchSessions from mcp-knowledge)
 *   3. Entity exact match — entities whose names appear in query → mentions → session chunks
 *   4. Theme/entity seed — themes + entities from query → direct session lookup via mentions + decisions
 *   5. Spreading activation — seeds propagated through concept graph → session chunks
 *   6. Decision FTS — query terms matched against decision text via decisions_fts (bm25)
 *
 * Combined via weighted Reciprocal Rank Fusion (RRF, constant 60).
 * Channel weights configurable via RETRIEVAL_WEIGHTS env var.
 *
 * @module lib/retrieval-pipeline
 */

import { spreadingActivation, createGraphAdapter } from './spreading-activation.mjs';
import { slugifyName } from './obsidian-summarizer.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default equal weights for all 6 channels. */
// R19 fix (repair 5.2): a failing retrieval channel must be observable —
// a schema regression used to read as "no matches" forever. The default
// sink logs to stderr; the inject server installs one that also publishes
// memory.error so the watcher sees it.
let channelErrorSink = (channel, err) => {
  try { console.error(`[retrieval] channel '${channel}' failed: ${err?.message || err}`); } catch { /* */ }
};
export function setChannelErrorSink(fn) {
  if (typeof fn === 'function') channelErrorSink = fn;
}
export function reportChannelError(channel, err) {
  try { channelErrorSink(channel, err); } catch { /* a sink must never throw into a channel */ }
}

export const DEFAULT_CHANNEL_WEIGHTS = Object.freeze({
  fts: 1, vec: 1, entity: 1, theme: 1, spread: 1, dfts: 1,
});

const VALID_CHANNELS = new Set(Object.keys(DEFAULT_CHANNEL_WEIGHTS));

// ─── Weight Parsing ──────────────────────────────────────────────────────────

/**
 * Parse RETRIEVAL_WEIGHTS env var format: "fts:2,vec:1,entity:1,theme:1,spread:1,dfts:1"
 * Returns a weights object with all 6 channel keys. Missing channels get default weight 1.
 * Invalid entries are silently ignored.
 *
 * @param {string} envValue
 * @returns {{ fts: number, vec: number, entity: number, theme: number, spread: number, dfts: number }}
 */
export function parseWeights(envValue) {
  const result = { ...DEFAULT_CHANNEL_WEIGHTS };
  if (!envValue || typeof envValue !== 'string') return result;

  for (const pair of envValue.split(',')) {
    const [key, val] = pair.split(':').map(s => s.trim());
    if (VALID_CHANNELS.has(key) && !isNaN(Number(val))) {
      result[key] = Number(val);
    }
  }
  return result;
}

// ─── Entity / Theme Matching ─────────────────────────────────────────────────

/**
 * Find entities whose names appear as substrings in the query text (case-insensitive).
 *
 * @param {import('better-sqlite3').Database} db — extraction store database
 * @param {string} query — search query text
 * @returns {Array<{id: number, name: string, type: string, mention_count: number}>}
 */
export function findMatchingEntities(db, query, opts = {}) {
  try {
    const lowerQuery = query.toLowerCase();
    // F-C13 / F-H22 fix: push privacy + length filter into SQL.
    // Empty names matched every prompt; single-letter entities matched too
    // broadly. Filter at the SQL level + word-boundary check below.
    const privacyClause = opts.respectPrivacy ? ' AND COALESCE(private, 1) = 0' : '';
    const rows = db.prepare(
      `SELECT id, name, type, mention_count FROM entities
       WHERE length(name) >= 2${privacyClause}
       ORDER BY mention_count DESC`
    ).all();
    return rows.filter(r => {
      const lname = r.name.toLowerCase();
      // Word-boundary check: ensure name is a discrete token in query, not
      // just substring (so "R" doesn't match "react"). For multi-word names
      // we accept any occurrence (already discriminative enough).
      if (!lowerQuery.includes(lname)) return false;
      if (lname.length >= 4 || lname.includes(' ')) return true;
      // For short names, require word boundary on at least one side
      const idx = lowerQuery.indexOf(lname);
      const before = idx === 0 ? ' ' : lowerQuery[idx - 1];
      const after = lowerQuery[idx + lname.length] ?? ' ';
      return /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
    }).slice(0, 20);
  } catch (err) {
    reportChannelError('entity-match', err);
    return [];
  }
}

/**
 * Find themes whose labels appear as substrings in the query text (case-insensitive).
 *
 * @param {import('better-sqlite3').Database} db — extraction store database
 * @param {string} query — search query text
 * @param {object} [opts]
 * @param {boolean} [opts.respectPrivacy] — apply private filter at SQL level
 * @returns {Array<{id: number, label: string, mention_count: number}>}
 */
export function findMatchingThemes(db, query, opts = {}) {
  try {
    const lowerQuery = query.toLowerCase();
    const privacyClause = opts.respectPrivacy ? ' AND COALESCE(private, 1) = 0' : '';
    const rows = db.prepare(
      `SELECT id, label, mention_count FROM themes
       WHERE length(label) >= 2${privacyClause}
       ORDER BY mention_count DESC`
    ).all();
    return rows.filter(r => lowerQuery.includes(r.label.toLowerCase())).slice(0, 20);
  } catch (err) {
    reportChannelError('theme-match', err);
    return [];
  }
}

// ─── Session Chunk Helpers ───────────────────────────────────────────────────

/**
 * Get session chunks for a list of session IDs from the knowledge database.
 * Returns results in RRF-compatible format with chunk_id.
 *
 * @param {import('better-sqlite3').Database} knowledgeDb — mcp-knowledge database
 * @param {string[]} sessionIds — session IDs to look up
 * @param {number} limit — max results
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function getChunksForSessions(knowledgeDb, sessionIds, limit = 10) {
  if (!sessionIds.length) return [];

  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    // No global ORDER BY / LIMIT here: the caller passes sessionIds in relevance
    // order (entitySearch ranks by salience). The old `ORDER BY turn_index DESC
    // LIMIT` ranked chunks by turn recency ACROSS sessions, so whichever session
    // had the largest turn indices dominated — the caller's ranking was thrown
    // away and RRF (which fuses on array position) saw noise (D8). We rank by
    // session relevance first, then recency within a session, then cap.
    const rows = knowledgeDb.prepare(`
      SELECT id as chunk_id, session_id, turn_index, role, snippet
      FROM session_chunks
      WHERE session_id IN (${placeholders})
    `).all(...sessionIds);

    const sessionRank = new Map(sessionIds.map((sid, i) => [sid, i]));
    const n = sessionIds.length;
    rows.sort((a, b) =>
      (sessionRank.get(a.session_id) - sessionRank.get(b.session_id)) ||
      (b.turn_index - a.turn_index));

    return rows.slice(0, limit).map((r) => ({
      chunk_id: r.chunk_id,
      session_id: r.session_id,
      turn_index: r.turn_index,
      role: r.role,
      // Session-relevance score in (0,1], monotonic by session rank — never
      // negative (the old 1.0 - i*0.01 went < 0 past rank 100). RRF fuses on
      // position; this stays honest for any display/secondary use.
      score: (n - sessionRank.get(r.session_id)) / n,
      snippet: r.snippet,
    }));
  } catch (err) {
    reportChannelError('chunks', err);
    return [];
  }
}

// ─── Channel 3: Entity Exact Match ──────────────────────────────────────────

/**
 * Channel 3: Find entities whose names appear in the query, look up their
 * session mentions, and return corresponding session chunks.
 *
 * @param {import('better-sqlite3').Database} extractionDb
 * @param {import('better-sqlite3').Database} knowledgeDb
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function entitySearch(extractionDb, knowledgeDb, query, limit = 10, opts = {}) {
  const entities = findMatchingEntities(extractionDb, query, opts);
  if (!entities.length) return [];

  const entityIds = entities.map(e => e.id);
  const placeholders = entityIds.map(() => '?').join(',');

  let sessions;
  try {
    sessions = extractionDb.prepare(`
      SELECT session_id, MAX(salience) as max_salience
      FROM mentions
      WHERE entity_id IN (${placeholders})
      GROUP BY session_id
      ORDER BY max_salience DESC
      LIMIT ?
    `).all(...entityIds, limit);
  } catch (err) {
    reportChannelError('entity-search', err);
    return [];
  }

  if (!sessions.length) return [];
  return getChunksForSessions(knowledgeDb, sessions.map(s => s.session_id), limit);
}

// ─── Channel 4: Theme/Entity Seed ───────────────────────────────────────────

/**
 * Channel 4: Find themes and entities mentioned in the query, look up sessions
 * where they appear (entities via mentions, themes via decision text search),
 * and return corresponding session chunks.
 *
 * @param {import('better-sqlite3').Database} extractionDb
 * @param {import('better-sqlite3').Database} knowledgeDb
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function themeEntitySearch(extractionDb, knowledgeDb, query, limit = 10, opts = {}) {
  const sessionIdSet = new Set();

  // Entity path: names → mentions → session_ids
  const entities = findMatchingEntities(extractionDb, query, opts);
  if (entities.length) {
    const entityIds = entities.map(e => e.id);
    const ph = entityIds.map(() => '?').join(',');
    try {
      const rows = extractionDb.prepare(`
        SELECT DISTINCT session_id
        FROM mentions
        WHERE entity_id IN (${ph})
        LIMIT ?
      `).all(...entityIds, limit * 2);
      for (const r of rows) sessionIdSet.add(r.session_id);
    } catch { /* extraction DB may be empty */ }
  }

  // Theme path: labels → decisions text search → session_ids.
  // F-H23 close-out: per-theme LIKE scans replaced with one indexed MATCH
  // against decisions_fts (extraction-store schema v3). Labels are quoted
  // as FTS phrases so operator characters in a label can't break the query.
  const themes = findMatchingThemes(extractionDb, query, opts);
  if (themes.length) {
    try {
      const ftsQuery = themes
        .map(t => `"${t.label.replace(/"/g, '""')}"`)
        .join(' OR ');
      const rows = extractionDb.prepare(
        `SELECT DISTINCT d.session_id
         FROM decisions_fts
         JOIN decisions d ON d.id = decisions_fts.rowid
         WHERE decisions_fts MATCH ?
         LIMIT ?`
      ).all(ftsQuery, limit * 2);
      for (const r of rows) {
        if (sessionIdSet.size >= limit * 2) break;
        sessionIdSet.add(r.session_id);
      }
    } catch (err) {
      reportChannelError('theme-decision-fts', err);
    }
  }

  if (!sessionIdSet.size) return [];
  return getChunksForSessions(knowledgeDb, [...sessionIdSet], limit);
}

// ─── Channel 6: Decision FTS ─────────────────────────────────────────────────

/**
 * Turn free query text into an FTS5 query: each term quoted (so FTS operator
 * characters in user text can't inject syntax), OR'd for recall. Terms under
 * 2 chars are dropped — they match too broadly to rank.
 *
 * @param {string} query
 * @returns {string} FTS5 MATCH expression, or '' when no usable terms
 */
export function toFtsQuery(query) {
  return query
    .split(/\s+/)
    .map(t => t.replace(/"/g, ''))
    .filter(t => t.length >= 2)
    .map(t => `"${t}"`)
    .join(' OR ');
}

/**
 * Channel 6: bm25-ranked FTS over decision text (decisions_fts, schema v3).
 * Sessions surface by their best-matching decision — the ctx-borrow fusion
 * shape (GROUP BY key ORDER BY MIN(score)) at session granularity — then
 * map to chunks. Complements channel 4, which only sees decisions whose
 * text contains a known THEME label; this matches the query's own words.
 *
 * @param {import('better-sqlite3').Database} extractionDb
 * @param {import('better-sqlite3').Database} knowledgeDb
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function decisionFtsSearch(extractionDb, knowledgeDb, query, limit = 10, opts = {}) {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];

  let sessions;
  try {
    const privacyClause = opts.respectPrivacy ? ' WHERE COALESCE(d.private, 1) = 0' : '';
    // bm25() only resolves while the FTS table drives the query; joined or
    // flattened into an outer query SQLite throws "unable to use function
    // bm25 in the requested context". The inner ORDER BY + LIMIT keeps the
    // subquery unflattened AND bounds scoring to the top 200 decisions.
    sessions = extractionDb.prepare(`
      SELECT d.session_id, MIN(m.score) AS score
      FROM (
        SELECT rowid, bm25(decisions_fts) AS score
        FROM decisions_fts
        WHERE decisions_fts MATCH ?
        ORDER BY score
        LIMIT 200
      ) m
      JOIN decisions d ON d.id = m.rowid${privacyClause}
      GROUP BY d.session_id
      ORDER BY score
      LIMIT ?
    `).all(ftsQuery, limit);
  } catch (err) {
    reportChannelError('decision-fts', err);
    return [];
  }

  if (!sessions.length) return [];
  return getChunksForSessions(knowledgeDb, sessions.map(s => s.session_id), limit);
}

// ─── Seed Extraction ─────────────────────────────────────────────────────────

/**
 * Extract spreading activation seeds from a query by finding entity names and
 * theme labels that appear in the query text. Returns a seed map keyed by
 * slugified names (matching graph node IDs) with activation 1.0.
 *
 * @param {import('better-sqlite3').Database} extractionDb
 * @param {string} query
 * @returns {Object<string, number>}
 */
export function buildSeeds(extractionDb, query, opts = {}) {
  const seeds = {};
  const entities = findMatchingEntities(extractionDb, query, opts);
  for (const e of entities) {
    seeds[slugifyName(e.name)] = 1.0;
  }
  const themes = findMatchingThemes(extractionDb, query, opts);
  for (const t of themes) {
    seeds[slugifyName(t.label)] = 1.0;
  }
  return seeds;
}

// ─── Channel 5: Spreading Activation ─────────────────────────────────────────

/**
 * Channel 5: Build seeds from query, run spreading activation through the
 * concept graph, map activated nodes back to entity names → sessions → chunks.
 *
 * @param {import('better-sqlite3').Database} extractionDb
 * @param {import('better-sqlite3').Database} knowledgeDb
 * @param {{ queryNeighbors: Function }} graphCache
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function activationSearch(extractionDb, knowledgeDb, graphCache, query, limit = 20, opts = {}) {
  const seeds = buildSeeds(extractionDb, query, opts);
  if (Object.keys(seeds).length === 0) return [];

  const graph = createGraphAdapter(graphCache);
  const activated = spreadingActivation(seeds, graph);
  if (!activated.length) return [];

  // Map activated node IDs (slugs) back to entity names → session_ids
  // Build slug→entity lookup from entities table
  let allEntities;
  try {
    allEntities = extractionDb.prepare('SELECT id, name FROM entities').all();
  } catch (err) {
    reportChannelError('activation-seeds', err);
    return [];
  }

  const slugToEntityIds = new Map();
  for (const e of allEntities) {
    const slug = slugifyName(e.name);
    if (!slugToEntityIds.has(slug)) slugToEntityIds.set(slug, []);
    slugToEntityIds.get(slug).push(e.id);
  }

  // Collect entity IDs for activated nodes (exclude seeds — they're in Channel 3/4)
  const seedSlugs = new Set(Object.keys(seeds));
  const activatedEntityIds = [];
  for (const [nodeId] of activated.slice(0, limit)) {
    if (seedSlugs.has(nodeId)) continue; // Skip seeds — covered by Channels 3/4
    const ids = slugToEntityIds.get(nodeId);
    if (ids) activatedEntityIds.push(...ids);
  }

  if (!activatedEntityIds.length) return [];

  const ph = activatedEntityIds.map(() => '?').join(',');
  let sessions;
  try {
    sessions = extractionDb.prepare(`
      SELECT DISTINCT session_id
      FROM mentions
      WHERE entity_id IN (${ph})
      LIMIT ?
    `).all(...activatedEntityIds, limit);
  } catch (err) {
    reportChannelError('activation', err);
    return [];
  }

  if (!sessions.length) return [];
  return getChunksForSessions(knowledgeDb, sessions.map(s => s.session_id), limit);
}

// ─── Weighted RRF ────────────────────────────────────────────────────────────

/**
 * Weighted Reciprocal Rank Fusion.
 * Formula: RRF(d) = Σ w_i / (k + rank_i(d)) where rank is 1-based.
 * Deduplicates by chunk_id — items in multiple sets get boosted.
 *
 * @param {Array<Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>>} resultSets
 * @param {number[]} weights — per-channel weight (aligned with resultSets)
 * @param {{ k?: number }} opts — RRF constant k (default 60)
 * @returns {Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>}
 */
export function weightedRRF(resultSets, weights = [], opts = {}) {
  const k = opts.k || 60;
  const scores = new Map();

  for (let setIdx = 0; setIdx < resultSets.length; setIdx++) {
    const results = resultSets[setIdx];
    const w = weights[setIdx] ?? 1;
    if (w <= 0) continue; // Skip zero-weighted channels

    for (let rank = 0; rank < results.length; rank++) {
      const item = results[rank];
      const id = item.chunk_id;
      const rrfScore = w / (k + rank + 1);

      if (scores.has(id)) {
        scores.get(id).score += rrfScore;
      } else {
        scores.set(id, { score: rrfScore, data: item });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(entry => ({
      ...entry.data,
      score: parseFloat(entry.score.toFixed(6)),
    }));
}

// ─── Pipeline Factory ────────────────────────────────────────────────────────

// ─── Privacy Filter ───────────────────────────────────────────────────────────

/**
 * Filter retrieval results to exclude items linked to private entities.
 *
 * F-N51 fix (chunk-grain + fail-CLOSED, supersedes the F-C13 session-grain logic):
 *   - Operates at turn_index granularity, not session-grain. A single private
 *     chunk in an otherwise-public session no longer leaks just because some
 *     other turn happened to publish an entity.
 *   - When `respect_privacy` is true, EVERY error path returns `[]` (fail-closed).
 *     Previously the catch blocks returned the unfiltered `results`, meaning a
 *     transient DB error or missing schema column silently surfaced private
 *     content. That's now a hard refusal.
 *   - Backward-compat: when result rows have no `turn_index` (e.g. legacy
 *     tests, or callers that synthesize results), falls back to a STRICTER
 *     session-grain rule than before: a session is kept only if it has at
 *     least one public entity AND no private entity. The old "any public is
 *     enough" rule was the actual F-N51 leak.
 *
 * @param {Array<{chunk_id, session_id, turn_index?}>} results
 * @param {import('better-sqlite3').Database} extractionDb
 * @returns {Array} — filtered results (or `[]` on any error when filtering was requested)
 */
export function filterPrivateResults(results, extractionDb) {
  if (!results || !results.length) return results || [];
  // No DB → we have no way to verify privacy. Fail-CLOSED.
  if (!extractionDb) return [];

  try {
    // Schema sanity: if the migration hasn't run, there's no `private` column
    // to filter on. Old code returned `results` (fail-open). New: fail-closed.
    const row = extractionDb.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('entities') WHERE name = 'private'"
    ).get();
    if (!row || row.cnt === 0) return [];

    // F-Q201 fix (F-N51 regression): the original chunk-grain filter joined
    // result rows on (session_id, turn_index), but extraction-store.mjs hard-
    // codes `turn_index: null` on every mention insert — so the privateTurns
    // / publicTurns sets only contained (session_id, -1) keys and result rows
    // always carry turn_index >= 0, falling through to "no mention → keep"
    // for every private session. Net: every chunk in a public-with-some-
    // private session leaked.
    //
    // Stopgap until the extractor populates mentions.turn_index:
    //  - Build a SESSION-grain "session has any private entity" set.
    //  - Build a TURN-grain set ONLY from rows where turn_index is populated.
    //  - Decision per result: turn-grain match wins if available; otherwise
    //    fall back to "drop the whole session if it has any private mention."
    //    This is stricter than the old "session has at least one public →
    //    keep all" behavior — that was the F-N51 leak.
    const privateTurns = new Set();   // (session_id, turn_index) with any private mention
    const publicTurns = new Set();    // (session_id, turn_index) with all-public mentions
    const privateSessions = new Set();// session_id with any private mention (NULL turn_index)
    const tk = (s, t) => `${s}\x00${t}`;
    try {
      const rows = extractionDb.prepare(`
        SELECT m.session_id,
               m.turn_index AS turn_index_raw,
               e.private
        FROM mentions m
        JOIN entities e ON m.entity_id = e.id
      `).all();
      for (const r of rows) {
        if (r.private === 1) {
          // Always mark the session private as a fail-safe.
          privateSessions.add(r.session_id);
          // ALSO mark the specific turn if known.
          if (Number.isInteger(r.turn_index_raw)) {
            privateTurns.add(tk(r.session_id, r.turn_index_raw));
          }
        } else {
          // Public turn record — only used when turn_index is known.
          if (Number.isInteger(r.turn_index_raw)) {
            publicTurns.add(tk(r.session_id, r.turn_index_raw));
          }
        }
      }
    } catch (err) {
      reportChannelError('privacy-filter', err);
      return [];  // fail-CLOSED
    }

    return results.filter(r => {
      const turnIdx = Number.isInteger(r.turn_index) ? r.turn_index : null;

      // Turn-grain decision when both sides have turn_index populated.
      if (turnIdx !== null) {
        const key = tk(r.session_id, turnIdx);
        if (privateTurns.has(key)) return false;
        if (publicTurns.has(key)) return true;
        // Turn not in either set — fall through to session-grain check.
      }

      // Session-grain fail-safe: if ANY mention in this session is private,
      // drop the chunk. Stricter than the old "any public → keep" rule,
      // which was the F-N51 leak. This applies when turn_index info is
      // unavailable (the current production state per F-Q201).
      if (privateSessions.has(r.session_id)) return false;

      // No private mention anywhere in this session → safe to keep.
      return true;
    });
  } catch (err) {
    reportChannelError('privacy-filter', err);
    return [];  // fail-CLOSED
  }
}

/**
 * Create a 6-channel retrieval pipeline.
 *
 * @param {{ knowledgeDb?: Database, extractionDb?: Database, graphCache?: object, respect_privacy?: boolean }} opts
 *   All databases are optional — missing components disable their channels gracefully.
 *   respect_privacy defaults to true — private items are filtered from results.
 *   Offerer passes true (never offer private items to peers).
 *   Local injection passes false (your own private memory is fair game).
 * @returns {{ retrieve: (query: string, opts?: {k?: number, respect_privacy?: boolean}) => Promise<Array> }}
 */
export function createRetrievalPipeline(opts = {}) {
  const { knowledgeDb, extractionDb, graphCache } = opts;
  const defaultPrivacy = opts.respect_privacy !== undefined ? opts.respect_privacy : true;
  const weights = parseWeights(process.env.RETRIEVAL_WEIGHTS);

  /**
   * Run the 6-channel retrieval pipeline and return combined results.
   *
   * @param {string} query — natural language query
   * @param {{ k?: number, respect_privacy?: boolean }} queryOpts
   * @returns {Promise<Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>>}
   */
  async function retrieve(query, queryOpts = {}) {
    const topK = queryOpts.k || 10;
    const fetchLimit = topK * 3;
    const privacyFlag = queryOpts.respect_privacy !== undefined
      ? queryOpts.respect_privacy
      : defaultPrivacy;

    // F-H24 fix: parallelize all channels. Was sequential — channel 2's
    // ~50-150ms embedding wait blocked channels 3/4/5 (sync SQLite reads).
    // F-H25: if caller passed a precomputed embedding, channel 2 reuses
    // it instead of re-embedding.
    const channelTasks = [];
    const channelWeights = [];
    const chanOpts = { respectPrivacy: privacyFlag };

    // Channel 1: FTS5 keyword
    if (knowledgeDb) {
      channelTasks.push((async () => {
        try {
          const { searchSessionsFts } = await import('./mcp-knowledge/core.mjs');
          return searchSessionsFts(knowledgeDb, query, fetchLimit);
        } catch { return []; }
      })());
      channelWeights.push(weights.fts);
    }

    // Channel 2: Vector / semantic — reuse precomputed embedding if supplied
    if (knowledgeDb) {
      channelTasks.push((async () => {
        try {
          const { searchSessions } = await import('./mcp-knowledge/core.mjs');
          // searchSessions accepts either text or precomputed embedding;
          // passing the precomputed avoids the in-pipeline re-embed cost.
          return await searchSessions(knowledgeDb, query, fetchLimit, {
            precomputedEmbedding: queryOpts.precomputedEmbedding,
          });
        } catch { return []; }
      })());
      channelWeights.push(weights.vec);
    }

    // Channel 3: Entity exact match (sync but wrap as async for uniform Promise.all)
    if (extractionDb && knowledgeDb) {
      channelTasks.push(Promise.resolve(entitySearch(extractionDb, knowledgeDb, query, fetchLimit, chanOpts)));
      channelWeights.push(weights.entity);
    }

    // Channel 4: Theme/entity seed
    if (extractionDb && knowledgeDb) {
      channelTasks.push(Promise.resolve(themeEntitySearch(extractionDb, knowledgeDb, query, fetchLimit, chanOpts)));
      channelWeights.push(weights.theme);
    }

    // Channel 5: Spreading activation
    if (extractionDb && knowledgeDb && graphCache) {
      channelTasks.push(Promise.resolve(activationSearch(extractionDb, knowledgeDb, graphCache, query, 20, chanOpts)));
      channelWeights.push(weights.spread);
    }

    // Channel 6: Decision FTS
    if (extractionDb && knowledgeDb) {
      channelTasks.push(Promise.resolve(decisionFtsSearch(extractionDb, knowledgeDb, query, fetchLimit, chanOpts)));
      channelWeights.push(weights.dfts);
    }

    if (!channelTasks.length) return [];

    // Race all channels in parallel. Even with sync channels wrapped as
    // resolved promises, Promise.all preserves order for the RRF combiner.
    const resultSets = await Promise.all(channelTasks);

    let fused = weightedRRF(resultSets, channelWeights);

    // Apply privacy filter after fusion if requested
    if (privacyFlag && extractionDb) {
      fused = filterPrivateResults(fused, extractionDb);
    }

    return fused.slice(0, topK);
  }

  return { retrieve };
}
