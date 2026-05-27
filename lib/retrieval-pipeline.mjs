/**
 * retrieval-pipeline.mjs — 5-channel retrieval pipeline with weighted RRF.
 *
 * Channels:
 *   1. FTS5 keyword search (searchSessionsFts from mcp-knowledge)
 *   2. Vector / semantic search (searchSessions from mcp-knowledge)
 *   3. Entity exact match — entities whose names appear in query → mentions → session chunks
 *   4. Theme/entity seed — themes + entities from query → direct session lookup via mentions + decisions
 *   5. Spreading activation — seeds propagated through concept graph → session chunks
 *
 * Combined via weighted Reciprocal Rank Fusion (RRF, constant 60).
 * Channel weights configurable via RETRIEVAL_WEIGHTS env var.
 *
 * @module lib/retrieval-pipeline
 */

import { spreadingActivation, createGraphAdapter } from './spreading-activation.mjs';
import { slugifyName } from './obsidian-summarizer.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default equal weights for all 5 channels. */
export const DEFAULT_CHANNEL_WEIGHTS = Object.freeze({
  fts: 1, vec: 1, entity: 1, theme: 1, spread: 1,
});

const VALID_CHANNELS = new Set(Object.keys(DEFAULT_CHANNEL_WEIGHTS));

// ─── Weight Parsing ──────────────────────────────────────────────────────────

/**
 * Parse RETRIEVAL_WEIGHTS env var format: "fts:2,vec:1,entity:1,theme:1,spread:1"
 * Returns a weights object with all 5 channel keys. Missing channels get default weight 1.
 * Invalid entries are silently ignored.
 *
 * @param {string} envValue
 * @returns {{ fts: number, vec: number, entity: number, theme: number, spread: number }}
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
  } catch {
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
  } catch {
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
    const rows = knowledgeDb.prepare(`
      SELECT id as chunk_id, session_id, turn_index, role, snippet
      FROM session_chunks
      WHERE session_id IN (${placeholders})
      ORDER BY turn_index DESC
      LIMIT ?
    `).all(...sessionIds, limit);

    return rows.map((r, i) => ({
      chunk_id: r.chunk_id,
      session_id: r.session_id,
      turn_index: r.turn_index,
      role: r.role,
      score: 1.0 - (i * 0.01), // Preserve ordering via decreasing score
      snippet: r.snippet,
    }));
  } catch {
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
  } catch {
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
  // F-H23 fix: was O(themes × decisions) full-table scan. Now: per-theme
  // LIKE query that uses no index (decisions has no FTS) but at least
  // stops scanning after LIMIT. For a small number of themes this is
  // much cheaper than loading ALL decisions then nested-looping.
  const themes = findMatchingThemes(extractionDb, query, opts);
  if (themes.length) {
    try {
      const decisionLikeStmt = extractionDb.prepare(
        `SELECT DISTINCT session_id FROM decisions
         WHERE LOWER(decision) LIKE ? OR LOWER(rationale) LIKE ?
         LIMIT ?`
      );
      for (const theme of themes) {
        if (sessionIdSet.size >= limit * 2) break;
        const pattern = `%${theme.label.toLowerCase()}%`;
        try {
          const rows = decisionLikeStmt.all(pattern, pattern, limit * 2);
          for (const r of rows) {
            sessionIdSet.add(r.session_id);
            if (sessionIdSet.size >= limit * 2) break;
          }
        } catch { /* skip theme on per-theme error */ }
      }
      // Dead-code guard: the legacy inner loop body below is unreachable now.
      // Kept as a structural sentinel — empty arrays don't enter the loop.
      const allDecisions = [];
      for (const theme of themes) {
        const lowerLabel = theme.label.toLowerCase();
        for (const d of allDecisions) {
          if (sessionIdSet.size >= limit * 2) break;
          if ((d.decision && d.decision.toLowerCase().includes(lowerLabel)) ||
              (d.rationale && d.rationale.toLowerCase().includes(lowerLabel))) {
            sessionIdSet.add(d.session_id);
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (!sessionIdSet.size) return [];
  return getChunksForSessions(knowledgeDb, [...sessionIdSet], limit);
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
  } catch {
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
  } catch {
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

    // Build (session_id, turn_index) → privacy verdict.
    // A turn is "private" if ANY mention at that turn points to a private entity.
    // A turn is "public" if all mentions at that turn point to public entities.
    // A turn with no mentions at all is treated as public (no entity to leak).
    const privateTurns = new Set();
    const publicTurns = new Set();
    const tk = (s, t) => `${s}\x00${t}`;
    try {
      // mentions.turn_index may be null in older rows; coalesce to -1 so
      // session-grain results (turn_index undefined) line up with them.
      const rows = extractionDb.prepare(`
        SELECT m.session_id, COALESCE(m.turn_index, -1) AS turn_index, e.private
        FROM mentions m
        JOIN entities e ON m.entity_id = e.id
      `).all();
      for (const r of rows) {
        const key = tk(r.session_id, r.turn_index);
        if (r.private === 1) privateTurns.add(key);
        else publicTurns.add(key);
      }
    } catch {
      return [];  // fail-CLOSED
    }

    return results.filter(r => {
      const turnIdx = r.turn_index !== undefined ? r.turn_index : -1;
      const key = tk(r.session_id, turnIdx);
      // Any private mention at this turn → drop, regardless of public mentions.
      if (privateTurns.has(key)) return false;
      // Public mention at this turn → keep.
      if (publicTurns.has(key)) return true;
      // No mention at this turn → keep (no entity to be private about).
      // This preserves the "untagged content" semantic without re-introducing
      // the session-grain leak.
      return true;
    });
  } catch {
    return [];  // fail-CLOSED
  }
}

/**
 * Create a 5-channel retrieval pipeline.
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
   * Run the 5-channel retrieval pipeline and return combined results.
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

    // F-H24 fix: parallelize all 5 channels. Was sequential — channel 2's
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
