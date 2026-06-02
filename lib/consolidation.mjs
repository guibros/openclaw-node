/**
 * consolidation.mjs — Batch consolidation jobs for graph health maintenance.
 *
 * The "sleep" analog: periodic offline processing that decays stale knowledge,
 * reinforces frequently co-occurring concepts, detects emerging clusters,
 * regenerates concept summaries, detects contradictions, and evaluates
 * promotion candidates.
 *
 * Each function is independently runnable + testable. The bin/consolidate.mjs
 * orchestrator runs them in sequence as one cycle.
 *
 * Decay model (from Block 8 frozen decisions §0 "8.3"):
 *   - Half-life: 14 days for un-recalled items
 *   - Formula: new = old * 0.5^(days_since_recall / 14)
 *   - Drop threshold: salience < 0.05 → archive (don't hard delete)
 *   - Reinforcement: co-occurrence in ≥3 recent sessions → mention_count += 1, salience += 0.05
 *
 * Cluster detection (from Block 8 frozen decisions §0 "8.4"):
 *   - Simple co-occurrence threshold: entities in same session ≥5 times → candidate
 *   - NOT k-means/DBSCAN — deterministic + transparent
 */

import { surfaceConflicts } from './conflict-surfacing.mjs';

export const DECAY_HALF_LIFE_DAYS = 14;
export const DECAY_DROP_THRESHOLD = 0.05;
export const REINFORCEMENT_COOCCURRENCE_MIN = 3;
export const REINFORCEMENT_SALIENCE_BOOST = 0.05;
export const CLUSTER_COOCCURRENCE_MIN = 5;

/**
 * Create the entities_archived table if it doesn't exist.
 * Called at the start of every consolidation cycle.
 *
 * @param {object} db — better-sqlite3 database instance
 */
export function initConsolidationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities_archived (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      archived_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    )
  `);

  // R1 fix (repair 1.2): decay anchor. Without it decayWeights re-applied the
  // full idle-duration factor every scheduler cycle — compounding ~48×/day.
  for (const table of ['entities', 'decisions']) {
    const cols = db.pragma(`table_info(${table})`).map(c => c.name);
    if (!cols.includes('last_decayed_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN last_decayed_at TEXT`);
    }
  }
}

/**
 * Apply salience decay to entities and decisions that haven't been recalled recently.
 *
 * Formula: new_salience = old_salience * 0.5^(days_since_recall / HALF_LIFE)
 * - Uses last_recalled if set, otherwise falls back to last_seen
 * - Entities that drop below DECAY_DROP_THRESHOLD are moved to entities_archived
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {string} [opts.now] — ISO timestamp to use as "now" (for testing)
 * @returns {{ decayedEntities: number, decayedDecisions: number, archivedEntities: number, archivedNames: string[] }}
 */
export function decayWeights(db, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const nowIso = now.toISOString();

  const entities = db.prepare(`
    SELECT id, name, type, canonical_name, first_seen, last_seen, mention_count,
           salience, last_recalled, last_decayed_at, source_type, source_node, source_event_id
    FROM entities
    WHERE salience > 0
  `).all();

  let decayedEntities = 0;
  let archivedEntities = 0;
  const archivedNames = [];

  const updateSalience = db.prepare(`UPDATE entities SET salience = ?, last_decayed_at = ? WHERE id = ?`);
  // F-C16 fix: with foreign_keys = ON, DELETE FROM entities used to throw
  // SQLITE_CONSTRAINT_FOREIGNKEY because the mentions table FK-references it.
  // Whole transaction would silently roll back; archival never happened.
  // Tests didn't catch it because they ran with empty mention tables.
  //
  // Two-step fix: (1) clear the mentions for the archived entity first,
  // (2) then delete the entity row. The mentions' content lives in the
  // archived entity row already (we copy name, type, etc.), so dropping
  // mentions is safe for the archive purpose.
  const deleteEntity = db.prepare(`DELETE FROM entities WHERE id = ?`);
  const deleteMentionsForEntity = db.prepare(`DELETE FROM mentions WHERE entity_id = ?`);
  const insertArchived = db.prepare(`
    INSERT OR REPLACE INTO entities_archived
      (id, name, type, canonical_name, first_seen, last_seen, mention_count,
       salience, last_recalled, archived_at, source_type, source_node, source_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const doDecay = db.transaction(() => {
    for (const entity of entities) {
      // R1 fix (repair 1.2): anchor each decay application at the previous one
      // (lexicographic max works on ISO strings). Recall after the last decay
      // restarts the idle clock; the factor then composes exactly —
      // 0.5^(a/14)·0.5^(b/14) = 0.5^((a+b)/14) — instead of re-applying the
      // full idle duration every cycle.
      const recallDate = entity.last_recalled || entity.last_seen;
      const refDate = [entity.last_decayed_at, recallDate].filter(Boolean).sort().pop() || null;
      // F-P212 fix: previously orphan entities (both timestamps null) were
      // silently skipped, leaving them with bogus salience that never
      // decayed → perpetual promotion candidates. Now: missing date is
      // treated as "infinitely stale" → forced to floor so the next cycle
      // archives them. This surfaces bad-data rows visibly via archival.
      let daysSince;
      if (!refDate) {
        daysSince = 365 * 10;  // effectively infinite — guarantees floor
      } else {
        daysSince = (now - new Date(refDate)) / (1000 * 60 * 60 * 24);
        if (!Number.isFinite(daysSince) || daysSince <= 0) continue;  // F-L21: skip Invalid Date
      }

      const oldSalience = entity.salience ?? 0.5;
      const newSalience = oldSalience * Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
      // F-M18 fix: clamp salience to [0, 1] (decisions path was clamping;
      // entities path wasn't).
      const clampedSalience = Math.max(0, Math.min(1, newSalience));

      if (clampedSalience < DECAY_DROP_THRESHOLD) {
        insertArchived.run(
          entity.id, entity.name, entity.type, entity.canonical_name,
          entity.first_seen, entity.last_seen, entity.mention_count,
          clampedSalience, entity.last_recalled, nowIso,
          entity.source_type, entity.source_node, entity.source_event_id
        );
        // F-C16: clear mentions before deleting parent to satisfy FK
        deleteMentionsForEntity.run(entity.id);
        deleteEntity.run(entity.id);
        archivedEntities++;
        decayedEntities++;
        archivedNames.push(entity.name);
      } else if (Math.abs(clampedSalience - oldSalience) > 0.001) {
        updateSalience.run(clampedSalience, nowIso, entity.id);
        decayedEntities++;
      }
      // Sub-threshold deltas leave last_decayed_at untouched so tiny decay
      // accumulates and applies on a later cycle — nothing is lost.
    }
  });

  doDecay();

  // Decay decisions (no archival, just update salience)
  const decisions = db.prepare(`
    SELECT id, salience, last_recalled, created_at, last_decayed_at
    FROM decisions
    WHERE salience > 0
  `).all();

  let decayedDecisions = 0;

  const updateDecisionSalience = db.prepare(`UPDATE decisions SET salience = ?, last_decayed_at = ? WHERE id = ?`);

  const doDecayDecisions = db.transaction(() => {
    for (const decision of decisions) {
      // R1 fix: same anchoring as the entity loop above.
      const recallDate = decision.last_recalled || decision.created_at;
      const refDate = [decision.last_decayed_at, recallDate].filter(Boolean).sort().pop() || null;
      if (!refDate) continue;

      const daysSince = (now - new Date(refDate)) / (1000 * 60 * 60 * 24);
      if (daysSince <= 0) continue;

      const oldSalience = decision.salience ?? 0.5;
      const newSalience = oldSalience * Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
      // F-P211 fix: clamp to [0, 1] (entity path was clamping; decision path
      // wasn't). Defends against any future writer that pushes salience > 1.
      const clampedSalience = Math.max(0, Math.min(1, newSalience));

      if (Math.abs(clampedSalience - oldSalience) > 0.001) {
        updateDecisionSalience.run(clampedSalience, nowIso, decision.id);
        decayedDecisions++;
      }
    }
  });

  doDecayDecisions();

  return { decayedEntities, decayedDecisions, archivedEntities, archivedNames };
}

/**
 * Reinforce entities that frequently co-occur across recent sessions.
 *
 * Finds entity pairs appearing together in ≥ REINFORCEMENT_COOCCURRENCE_MIN
 * distinct sessions. For each qualifying entity, bumps mention_count by 1
 * and salience by REINFORCEMENT_SALIENCE_BOOST (capped at 1.0).
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {number} [opts.minSessions] — override REINFORCEMENT_COOCCURRENCE_MIN
 * @returns {{ reinforcedEntities: number, pairs: Array<{ entity_a: string, entity_b: string, sessions: number }> }}
 */
export function reinforceCoOccurrence(db, opts = {}) {
  const minSessions = opts.minSessions ?? REINFORCEMENT_COOCCURRENCE_MIN;
  // F-P203 fix (F-H14 / F-N150 regression): apply recency cap so the
  // self-join doesn't grow quadratically with history depth AND so stale
  // historical co-occurrence doesn't keep driving present-day salience
  // reinforcement. Default 30 days; env override CONSOLIDATE_RECENCY_WINDOW_DAYS.
  // Number(undefined)=NaN which is NOT nullish, so the env-var path needs
  // an explicit isFinite check before falling through to the default.
  const envDays = Number(process.env.CONSOLIDATE_RECENCY_WINDOW_DAYS);
  const recencyDays = opts.recencyDays
    ?? (Number.isFinite(envDays) && envDays > 0 ? envDays : 30);
  const cutoffIso = new Date(Date.now() - recencyDays * 86_400_000).toISOString();

  const pairs = db.prepare(`
    SELECT
      e1.id AS id_a, e1.name AS entity_a,
      e2.id AS id_b, e2.name AS entity_b,
      COUNT(DISTINCT m1.session_id) AS shared_sessions
    FROM mentions m1
    JOIN mentions m2 ON m1.session_id = m2.session_id AND m1.entity_id < m2.entity_id
    JOIN entities e1 ON m1.entity_id = e1.id
    JOIN entities e2 ON m2.entity_id = e2.id
    WHERE m1.created_at >= ? AND m2.created_at >= ?
    GROUP BY m1.entity_id, m2.entity_id
    HAVING shared_sessions >= ?
    ORDER BY shared_sessions DESC
  `).all(cutoffIso, cutoffIso, minSessions);

  const reinforcedIds = new Set();
  const pairResults = [];

  const bumpEntity = db.prepare(`
    UPDATE entities
    SET mention_count = mention_count + 1,
        salience = MIN(1.0, COALESCE(salience, 0.5) + ?)
    WHERE id = ?
  `);

  const doReinforce = db.transaction(() => {
    for (const pair of pairs) {
      pairResults.push({
        entity_a: pair.entity_a,
        entity_b: pair.entity_b,
        sessions: pair.shared_sessions,
      });

      if (!reinforcedIds.has(pair.id_a)) {
        bumpEntity.run(REINFORCEMENT_SALIENCE_BOOST, pair.id_a);
        reinforcedIds.add(pair.id_a);
      }
      if (!reinforcedIds.has(pair.id_b)) {
        bumpEntity.run(REINFORCEMENT_SALIENCE_BOOST, pair.id_b);
        reinforcedIds.add(pair.id_b);
      }
    }
  });

  doReinforce();

  return { reinforcedEntities: reinforcedIds.size, pairs: pairResults };
}

/**
 * Detect clusters of frequently co-occurring entities that may deserve
 * a new theme note.
 *
 * Uses simple co-occurrence threshold: entities appearing in the same
 * session ≥ CLUSTER_COOCCURRENCE_MIN times are cluster candidates.
 * NOT k-means/DBSCAN — deterministic + transparent.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {number} [opts.minCoOccurrence] — override CLUSTER_COOCCURRENCE_MIN
 * @returns {{ clusters: Array<{ entities: string[], sessions: number, suggestedTheme: string }> }}
 */
export function detectClusters(db, opts = {}) {
  const minCoOccurrence = opts.minCoOccurrence ?? CLUSTER_COOCCURRENCE_MIN;
  // F-P203 fix: same recency cap as reinforceCoOccurrence — both queries
  // share the same self-join shape and have the same scaling problem.
  // Number(undefined)=NaN which is NOT nullish, so the env-var path needs
  // an explicit isFinite check before falling through to the default.
  const envDays = Number(process.env.CONSOLIDATE_RECENCY_WINDOW_DAYS);
  const recencyDays = opts.recencyDays
    ?? (Number.isFinite(envDays) && envDays > 0 ? envDays : 30);
  const cutoffIso = new Date(Date.now() - recencyDays * 86_400_000).toISOString();

  const pairs = db.prepare(`
    SELECT
      e1.name AS entity_a,
      e2.name AS entity_b,
      COUNT(DISTINCT m1.session_id) AS shared_sessions
    FROM mentions m1
    JOIN mentions m2 ON m1.session_id = m2.session_id AND m1.entity_id < m2.entity_id
    JOIN entities e1 ON m1.entity_id = e1.id
    JOIN entities e2 ON m2.entity_id = e2.id
    WHERE m1.created_at >= ? AND m2.created_at >= ?
    GROUP BY m1.entity_id, m2.entity_id
    HAVING shared_sessions >= ?
    ORDER BY shared_sessions DESC
  `).all(cutoffIso, cutoffIso, minCoOccurrence);

  // Union-find to merge connected entities into clusters
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const pairSessionCounts = new Map();

  for (const pair of pairs) {
    union(pair.entity_a, pair.entity_b);
    const key = [pair.entity_a, pair.entity_b].sort().join('|');
    pairSessionCounts.set(key, pair.shared_sessions);
  }

  // Group by cluster root
  const clusterMap = new Map();
  for (const entity of parent.keys()) {
    const root = find(entity);
    if (!clusterMap.has(root)) clusterMap.set(root, new Set());
    clusterMap.get(root).add(entity);
  }

  const clusters = [];
  for (const [, members] of clusterMap) {
    if (members.size < 2) continue;

    const entities = [...members].sort();
    let maxSessions = 0;
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const key = [entities[i], entities[j]].sort().join('|');
        const count = pairSessionCounts.get(key) || 0;
        if (count > maxSessions) maxSessions = count;
      }
    }

    clusters.push({
      entities,
      sessions: maxSessions,
      suggestedTheme: entities.join(' + '),
    });
  }

  return { clusters };
}

/**
 * Regenerate concept notes for entities whose data has changed.
 *
 * Wraps generateConceptNotes from obsidian-summarizer.
 *
 * @param {object} opts
 * @param {object} opts.db — better-sqlite3 database instance
 * @param {object} [opts.client] — LLM client for summary generation (optional)
 * @param {string} [opts.vaultPath] — Obsidian vault path (optional)
 * @returns {Promise<{ regenerated: number }>}
 */
export async function regenerateSummaries(opts) {
  const { db, client, vaultPath, signal, maxConcepts } = opts;

  try {
    const { generateConceptNotes } = await import('./obsidian-summarizer.mjs');
    const result = await generateConceptNotes({
      db, client, vaultPath,
      signal,           // F-N100: forward hard-cap signal
      maxConcepts,      // F-N101: forward per-cycle cap
    });
    return {
      regenerated: result.generated || 0,
      // F-N101: surface partial-progress so the caller can log + the next
      // cycle can intentionally take a fresh slice of remaining work.
      attempted: result.attempted ?? 0,
      skipped: result.skipped ?? 0,
      aborted: result.aborted ?? false,
    };
  } catch (err) {
    // F-N110 fix: don't silently swallow. Surface the error AND log so the
    // scheduler's banner can flag a vault that's been failing to update.
    // F-Q307 fix: AbortError must propagate `aborted: true` so the cycle
    // wrapper (bin/consolidate.mjs) sets abortInfo and stops the cycle.
    // Previously a mid-summary abort was caught here and returned
    // {aborted: false}, allowing detectContradictions + evaluatePromotion
    // to keep running after the hard cap fired.
    const errMsg = err?.message || String(err);
    const isAbort = err?.name === 'AbortError'
      || /aborted|abort/i.test(errMsg)
      || opts.signal?.aborted;
    if (typeof opts.log === 'function') {
      try { opts.log(`[consolidation] regenerateSummaries failed: ${errMsg}${isAbort ? ' (aborted)' : ''}`); } catch { /* */ }
    } else {
      // eslint-disable-next-line no-console
      console.error(`[consolidation] regenerateSummaries failed: ${errMsg}`);
    }
    return {
      regenerated: 0, attempted: 0, skipped: 0,
      aborted: isAbort,
      error: errMsg,
    };
  }
}

/**
 * Detect contradictions in the extraction data.
 *
 * Wraps surfaceConflicts from conflict-surfacing.mjs. Returns counts
 * and details of entity-level and decision-level contradictions.
 *
 * @param {object} db — better-sqlite3 database instance
 * @returns {{ entityConflicts: number, decisionConflicts: number, total: number, details: object }}
 */
export function detectContradictions(db) {
  try {
    const result = surfaceConflicts(db);
    return {
      entityConflicts: result.entity_conflicts.length,
      decisionConflicts: result.decision_conflicts.length,
      total: result.total,
      details: result,
    };
  } catch (err) {
    return { entityConflicts: 0, decisionConflicts: 0, total: 0, details: null, error: err.message };
  }
}

/**
 * Evaluate entities that meet promotion thresholds.
 *
 * Queries entities with mention_count above the promotion policy threshold
 * and decisions with confidence above the confidence threshold.
 * Returns candidates ready for the promoter to process.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {number} [opts.mentionThreshold] — minimum mention_count (default: 10 per Block 4 §0)
 * @param {number} [opts.confidenceThreshold] — minimum decision confidence (default: 0.95)
 * @returns {{ entityCandidates: Array, decisionCandidates: Array }}
 */
export function evaluatePromotionCandidates(db, opts = {}) {
  const mentionThreshold = opts.mentionThreshold ?? 10;
  const confidenceThreshold = opts.confidenceThreshold ?? 0.95;

  // F-P210 fix: exclude items already in published_items so each 30-minute
  // cycle doesn't re-emit the same candidates indefinitely. The
  // published_items table is created by F-C15 / privacy migration; if it
  // doesn't exist yet (older DBs), the LEFT JOIN matches nothing and the
  // filter is effectively a pass-through.
  // Guard with a schema-presence check to avoid breaking older test DBs.
  const hasPublishedItems = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='published_items'"
  ).get().n > 0;
  const entityNotPubFilter = hasPublishedItems
    ? `AND NOT EXISTS (SELECT 1 FROM published_items p WHERE p.item_type = 'entity' AND p.item_id = entities.id)`
    : '';
  const decisionNotPubFilter = hasPublishedItems
    ? `AND NOT EXISTS (SELECT 1 FROM published_items p WHERE p.item_type = 'decision' AND p.item_id = decisions.id)`
    : '';

  const entityCandidates = db.prepare(`
    SELECT id, name, type, mention_count, salience
    FROM entities
    WHERE mention_count >= ?
      AND source_type = 'local'
      ${entityNotPubFilter}
    ORDER BY mention_count DESC, id ASC
  `).all(mentionThreshold).map(e => ({
    name: e.name,
    type: e.type,
    mentionCount: e.mention_count,
    salience: e.salience ?? 0.5,
  }));

  const decisionCandidates = db.prepare(`
    SELECT id, decision, confidence, rationale, created_at
    FROM decisions
    WHERE confidence >= ?
      AND source_type = 'local'
      ${decisionNotPubFilter}
    ORDER BY confidence DESC, id ASC
  `).all(confidenceThreshold).map(d => ({
    decision: d.decision,
    confidence: d.confidence,
    rationale: d.rationale,
    createdAt: d.created_at,
  }));

  return { entityCandidates, decisionCandidates };
}
