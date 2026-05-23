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
export function findMatchingEntities(db, query) {
  try {
    const lowerQuery = query.toLowerCase();
    const rows = db.prepare(
      'SELECT id, name, type, mention_count FROM entities ORDER BY mention_count DESC'
    ).all();
    return rows.filter(r => lowerQuery.includes(r.name.toLowerCase())).slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Find themes whose labels appear as substrings in the query text (case-insensitive).
 *
 * @param {import('better-sqlite3').Database} db — extraction store database
 * @param {string} query — search query text
 * @returns {Array<{id: number, label: string, mention_count: number}>}
 */
export function findMatchingThemes(db, query) {
  try {
    const lowerQuery = query.toLowerCase();
    const rows = db.prepare(
      'SELECT id, label, mention_count FROM themes ORDER BY mention_count DESC'
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
export function entitySearch(extractionDb, knowledgeDb, query, limit = 10) {
  const entities = findMatchingEntities(extractionDb, query);
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
export function themeEntitySearch(extractionDb, knowledgeDb, query, limit = 10) {
  const sessionIdSet = new Set();

  // Entity path: names → mentions → session_ids
  const entities = findMatchingEntities(extractionDb, query);
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

  // Theme path: labels → decisions text search → session_ids
  const themes = findMatchingThemes(extractionDb, query);
  if (themes.length) {
    try {
      const allDecisions = extractionDb.prepare(
        'SELECT DISTINCT session_id, decision, rationale FROM decisions'
      ).all();
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
export function buildSeeds(extractionDb, query) {
  const seeds = {};
  const entities = findMatchingEntities(extractionDb, query);
  for (const e of entities) {
    seeds[slugifyName(e.name)] = 1.0;
  }
  const themes = findMatchingThemes(extractionDb, query);
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
export function activationSearch(extractionDb, knowledgeDb, graphCache, query, limit = 20) {
  const seeds = buildSeeds(extractionDb, query);
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

/**
 * Create a 5-channel retrieval pipeline.
 *
 * @param {{ knowledgeDb?: Database, extractionDb?: Database, graphCache?: object }} opts
 *   All databases are optional — missing components disable their channels gracefully.
 * @returns {{ retrieve: (query: string, opts?: {k?: number}) => Promise<Array> }}
 */
export function createRetrievalPipeline(opts = {}) {
  const { knowledgeDb, extractionDb, graphCache } = opts;
  const weights = parseWeights(process.env.RETRIEVAL_WEIGHTS);

  /**
   * Run the 5-channel retrieval pipeline and return combined results.
   *
   * @param {string} query — natural language query
   * @param {{ k?: number }} queryOpts — top-k results to return (default 10)
   * @returns {Promise<Array<{chunk_id: number, session_id: string, turn_index: number, role: string, score: number, snippet: string}>>}
   */
  async function retrieve(query, queryOpts = {}) {
    const topK = queryOpts.k || 10;
    const fetchLimit = topK * 3;

    const resultSets = [];
    const channelWeights = [];

    // Channel 1: FTS5 keyword (requires knowledgeDb)
    if (knowledgeDb) {
      try {
        const { searchSessionsFts } = await import('./mcp-knowledge/core.mjs');
        resultSets.push(searchSessionsFts(knowledgeDb, query, fetchLimit));
      } catch {
        resultSets.push([]);
      }
      channelWeights.push(weights.fts);
    }

    // Channel 2: Vector / semantic (requires knowledgeDb)
    if (knowledgeDb) {
      try {
        const { searchSessions } = await import('./mcp-knowledge/core.mjs');
        resultSets.push(await searchSessions(knowledgeDb, query, fetchLimit));
      } catch {
        resultSets.push([]);
      }
      channelWeights.push(weights.vec);
    }

    // Channel 3: Entity exact match (requires both DBs)
    if (extractionDb && knowledgeDb) {
      resultSets.push(entitySearch(extractionDb, knowledgeDb, query, fetchLimit));
      channelWeights.push(weights.entity);
    }

    // Channel 4: Theme/entity seed (requires both DBs)
    if (extractionDb && knowledgeDb) {
      resultSets.push(themeEntitySearch(extractionDb, knowledgeDb, query, fetchLimit));
      channelWeights.push(weights.theme);
    }

    // Channel 5: Spreading activation (requires all three)
    if (extractionDb && knowledgeDb && graphCache) {
      resultSets.push(activationSearch(extractionDb, knowledgeDb, graphCache, query, 20));
      channelWeights.push(weights.spread);
    }

    if (!resultSets.length) return [];

    const fused = weightedRRF(resultSets, channelWeights);
    return fused.slice(0, topK);
  }

  return { retrieve };
}
