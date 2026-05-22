/**
 * conflict-surfacing.mjs — Conflict detection and surfacing for the retrieval pipeline.
 *
 * When local and shared knowledge disagree on a concept, this module detects
 * the conflict and surfaces both versions with provenance. The agent sees the
 * disagreement and decides per-conflict. No auto-merge.
 *
 * Conflict detection works via the mentions and decisions tables:
 *   - Entity conflicts: entities with mentions from both source_type='local'
 *     AND source_type='shared' are flagged as having mixed provenance.
 *   - Decision conflicts: decisions from different source_types that overlap
 *     on session context.
 *
 * Per Block 4 frozen decision: "surface, don't auto-merge."
 */

/**
 * Describe a conflict between a local and shared concept.
 *
 * Pure function — no database access. Formats two items into a
 * conflict descriptor for the retrieval pipeline.
 *
 * @param {object} localItem — local version of the concept
 * @param {string} localItem.summary — description/definition from local store
 * @param {string} localItem.last_seen — ISO timestamp of last local mention
 * @param {object} sharedItem — shared version of the concept
 * @param {string} sharedItem.summary — description/definition from shared store
 * @param {string} sharedItem.last_seen — ISO timestamp of last shared mention
 * @returns {object} conflict descriptor
 */
export function describeConflict(localItem, sharedItem) {
  return {
    local_definition: localItem.summary,
    shared_definition: sharedItem.summary,
    last_local_mention: localItem.last_seen,
    last_shared_mention: sharedItem.last_seen,
  };
}

/**
 * Find entities that have mentions from both local and shared sources.
 *
 * An entity with mixed-provenance mentions indicates that both the local node
 * and a remote node have referenced the same concept. The entity row itself
 * reflects the first sighter's provenance; mentions track per-observation provenance.
 *
 * @param {object} db — better-sqlite3 database instance
 * @returns {Array<object>} array of conflict descriptors, one per conflicted entity
 */
export function findEntityConflicts(db) {
  const rows = db.prepare(`
    SELECT
      e.id,
      e.name,
      e.type,
      e.source_type AS entity_source_type,
      e.source_node AS entity_source_node,
      e.first_seen,
      e.last_seen,
      e.mention_count,
      (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'local') AS local_mention_count,
      (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'shared') AS shared_mention_count,
      (SELECT MAX(m.created_at) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'local') AS last_local_mention,
      (SELECT MAX(m.created_at) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'shared') AS last_shared_mention,
      (SELECT m.source_node FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'shared' ORDER BY m.created_at DESC LIMIT 1) AS shared_source_node
    FROM entities e
    WHERE
      (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'local') > 0
      AND
      (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id AND m.source_type = 'shared') > 0
    ORDER BY e.mention_count DESC
  `).all();

  return rows.map(row => ({
    entity_name: row.name,
    entity_type: row.type,
    conflict_type: 'mixed_provenance',
    entity_source_type: row.entity_source_type,
    local_mention_count: row.local_mention_count,
    shared_mention_count: row.shared_mention_count,
    shared_source_node: row.shared_source_node,
    conflict: true,
    description: describeConflict(
      { summary: `${row.name} (${row.type}, ${row.local_mention_count} local mentions)`, last_seen: row.last_local_mention },
      { summary: `${row.name} (${row.type}, ${row.shared_mention_count} shared mentions from ${row.shared_source_node || 'unknown'})`, last_seen: row.last_shared_mention },
    ),
  }));
}

/**
 * Find decisions from different source types.
 *
 * Decisions from local and shared sources may represent divergent conclusions
 * about the same topic. This function surfaces decisions that exist from both
 * source types for manual review.
 *
 * @param {object} db — better-sqlite3 database instance
 * @returns {Array<object>} array of decision conflict pairs
 */
export function findDecisionConflicts(db) {
  // Find sessions that have decisions from both local and shared sources
  const conflictedSessions = db.prepare(`
    SELECT session_id
    FROM decisions
    GROUP BY session_id
    HAVING
      SUM(CASE WHEN source_type = 'local' THEN 1 ELSE 0 END) > 0
      AND
      SUM(CASE WHEN source_type = 'shared' THEN 1 ELSE 0 END) > 0
  `).all();

  const conflicts = [];

  for (const { session_id } of conflictedSessions) {
    const localDecisions = db.prepare(`
      SELECT decision, rationale, confidence, created_at, source_type, source_node
      FROM decisions
      WHERE session_id = ? AND source_type = 'local'
      ORDER BY created_at DESC
    `).all(session_id);

    const sharedDecisions = db.prepare(`
      SELECT decision, rationale, confidence, created_at, source_type, source_node
      FROM decisions
      WHERE session_id = ? AND source_type = 'shared'
      ORDER BY created_at DESC
    `).all(session_id);

    conflicts.push({
      session_id,
      conflict_type: 'decision_divergence',
      conflict: true,
      local_decisions: localDecisions,
      shared_decisions: sharedDecisions,
      description: describeConflict(
        { summary: localDecisions.map(d => d.decision).join('; '), last_seen: localDecisions[0]?.created_at },
        { summary: sharedDecisions.map(d => d.decision).join('; '), last_seen: sharedDecisions[0]?.created_at },
      ),
    });
  }

  return conflicts;
}

/**
 * Surface all conflicts across entities and decisions.
 *
 * Top-level conflict discovery function for the retrieval pipeline.
 *
 * @param {object} db — better-sqlite3 database instance
 * @returns {{ entity_conflicts: Array, decision_conflicts: Array, total: number }}
 */
export function surfaceConflicts(db) {
  const entityConflicts = findEntityConflicts(db);
  const decisionConflicts = findDecisionConflicts(db);

  return {
    entity_conflicts: entityConflicts,
    decision_conflicts: decisionConflicts,
    total: entityConflicts.length + decisionConflicts.length,
  };
}

/**
 * Annotate retrieval results with conflict flags.
 *
 * For each result that matches a known conflict (by entity name), adds
 * `conflict: true` and a `conflict_detail` descriptor. Results without
 * matching conflicts are returned unchanged.
 *
 * @param {Array<object>} results — retrieval results (each must have a `name` or `entity_name` field)
 * @param {Array<object>} conflicts — entity conflict descriptors from findEntityConflicts
 * @returns {Array<object>} annotated results (new array, original results not mutated)
 */
export function annotateWithConflicts(results, conflicts) {
  const conflictMap = new Map();
  for (const c of conflicts) {
    conflictMap.set(c.entity_name, c);
  }

  return results.map(result => {
    const key = result.name || result.entity_name;
    const match = conflictMap.get(key);
    if (match) {
      return {
        ...result,
        conflict: true,
        conflict_detail: match.description,
      };
    }
    return { ...result };
  });
}
