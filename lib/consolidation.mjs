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

import path from 'path';
import { surfaceConflicts } from './conflict-surfacing.mjs';
import { ensureArchiveTables, createMemoryArchive } from './memory-archive.mjs';
import { backupStore } from './sqlite-store.mjs';

export const DECAY_HALF_LIFE_DAYS = 14;
export const DECAY_DROP_THRESHOLD = 0.05;
export const REINFORCEMENT_COOCCURRENCE_MIN = 3;
export const REINFORCEMENT_SALIENCE_BOOST = 0.05;
export const CLUSTER_COOCCURRENCE_MIN = 5;
export const THEME_IDLE_DAYS = 180;
// Backups taken before a hard delete (repair 2026-09-26) and before a cycle's
// first archival move (review 2026-09-27). Env overrides:
// CONSOLIDATE_BACKUP_DIR, CONSOLIDATE_BACKUP_KEEP.
export const BACKUP_KEEP = 7;
export const BACKUP_REUSE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * P5-1: reinforcement credit lives in its own column. mention_count is DERIVED
 * from the mentions table (extraction-store D5) and the two writers used to
 * fight: extraction recomputed it (erasing consolidation's +1) while
 * consolidation bumped it (inflating the promotion signal with a number
 * nobody could reproduce). Now mention_count means "distinct sessions",
 * reinforcement_count means "co-occurrence credits", and promotion reads both.
 */
function ensureReinforcementColumn(db) {
  const cols = db.pragma('table_info(entities)').map(c => c.name);
  if (!cols.includes('reinforcement_count')) {
    db.exec('ALTER TABLE entities ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * Create the consolidation-owned columns and tables, then the archive tables
 * (memory-archive.mjs) — last, so they mirror the columns added here.
 * Called at the start of every consolidation cycle.
 *
 * @param {object} db — better-sqlite3 database instance
 */
export function initConsolidationTables(db) {
  ensureReinforcementColumn(db);

  // R1 fix (repair 1.2): decay anchor. Without it decayWeights re-applied the
  // full idle-duration factor every scheduler cycle — compounding ~48×/day.
  for (const table of ['entities', 'decisions']) {
    const cols = db.pragma(`table_info(${table})`).map(c => c.name);
    if (!cols.includes('last_decayed_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN last_decayed_at TEXT`);
    }
  }

  // R20 fix (repair 5.3): per-cycle bookkeeping (e.g. the last emitted
  // promotion fingerprint) so the scheduler stops re-announcing an
  // unchanged candidate set every 30 minutes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // IMMEDIATE for the same reason as the store's v7 migration: the daemon may
  // be running it concurrently.
  db.transaction(() => ensureArchiveTables(db)).immediate();
}

/**
 * Apply salience decay to entities and decisions that haven't been recalled recently.
 *
 * Formula: new_salience = old_salience * 0.5^(idle_days / HALF_LIFE), where the
 * idle clock starts at the latest of last_recalled, last_seen and the previous
 * decay application.
 * - Entities that drop below DECAY_DROP_THRESHOLD move to the archive with
 *   their mentions and aliases (memory-archive.mjs); nothing is deleted. The
 *   first move waits for a backup (archivalBackup); without one they stay
 *   live, untouched, and `archiveSkipped` says why
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {string} [opts.now] — ISO timestamp to use as "now" (for testing)
 * @param {string} [opts.backupDir] — as for pruneStale
 * @param {number} [opts.backupKeep] — as for pruneStale
 * @returns {{ decayedEntities: number, decayedDecisions: number, archivedEntities: number,
 *   archivedNames: string[], archiveSkipped: string|null, backup: { path: string, reused: boolean, removed: string[] }|null,
 *   removed: Array<{ action: 'archived', kind: 'entity', id: number, label: string, salience: number }> }}
 */
export function decayWeights(db, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const nowIso = now.toISOString();

  const entities = db.prepare(`
    SELECT id, name, salience, last_seen, last_recalled, last_decayed_at
    FROM entities
    WHERE salience > 0
  `).all();

  let decayedEntities = 0;
  let archivedEntities = 0;
  const archivedNames = [];
  const removed = [];

  const updateSalience = db.prepare(`UPDATE entities SET salience = ?, last_decayed_at = ? WHERE id = ?`);
  const archive = createMemoryArchive(db);

  // Computed before the transaction: whether anything is archived decides
  // whether a backup comes first, and VACUUM INTO cannot run inside one.
  const decayed = [];
  for (const entity of entities) {
    // R1 fix (repair 1.2): anchor each decay application at the previous one
    // (lexicographic max works on ISO strings). Recall after the last decay
    // restarts the idle clock; the factor then composes exactly —
    // 0.5^(a/14)·0.5^(b/14) = 0.5^((a+b)/14) — instead of re-applying the
    // full idle duration every cycle.
    // A sighting restarts it too (repair 2026-09-26): with
    // `last_recalled || last_seen`, one recall froze the clock at that recall
    // and every later mention was ignored — an entity mentioned in 13
    // sessions, the last one that day, was archived off a weeks-old recall.
    const lastTouch = [entity.last_recalled, entity.last_seen].filter(Boolean).sort().pop();
    const refDate = [entity.last_decayed_at, lastTouch].filter(Boolean).sort().pop() || null;
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
    decayed.push({ entity, oldSalience, clampedSalience: Math.max(0, Math.min(1, newSalience)) });
  }

  const gate = decayed.some((d) => d.clampedSalience < DECAY_DROP_THRESHOLD)
    ? archivalBackup(db, opts, now)
    : { backup: null, skipped: null };

  const doDecay = db.transaction(() => {
    for (const { entity, oldSalience, clampedSalience } of decayed) {
      if (clampedSalience < DECAY_DROP_THRESHOLD) {
        // No backup, no move: left exactly as it was, so the next cycle
        // decays it from the same anchor and tries again.
        if (gate.skipped) continue;
        // The archive copies the row as it stands, so record the final decay first.
        updateSalience.run(clampedSalience, nowIso, entity.id);
        archive.archiveEntity(entity.id, nowIso);
        archivedEntities++;
        decayedEntities++;
        archivedNames.push(entity.name);
        removed.push({ action: 'archived', kind: 'entity', id: entity.id, label: entity.name, salience: clampedSalience });
      } else if (Math.abs(clampedSalience - oldSalience) > 0.001) {
        updateSalience.run(clampedSalience, nowIso, entity.id);
        decayedEntities++;
      }
      // Sub-threshold deltas leave last_decayed_at untouched so tiny decay
      // accumulates and applies on a later cycle — nothing is lost.
    }
  });

  doDecay();

  // Decay decisions (salience only — pruneStale archives the ones that fall out)
  const decisions = db.prepare(`
    SELECT id, salience, last_recalled, created_at, last_decayed_at
    FROM decisions
    WHERE salience > 0
  `).all();

  let decayedDecisions = 0;

  const updateDecisionSalience = db.prepare(`UPDATE decisions SET salience = ?, last_decayed_at = ? WHERE id = ?`);

  const doDecayDecisions = db.transaction(() => {
    for (const decision of decisions) {
      // R1 fix: same anchoring as the entity loop above. created_at is the
      // latest restatement (the store's merge replaces it), so a decision
      // re-stated after a recall restarts its clock the way a sighting does.
      const lastTouch = [decision.last_recalled, decision.created_at].filter(Boolean).sort().pop();
      const refDate = [decision.last_decayed_at, lastTouch].filter(Boolean).sort().pop() || null;
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

  return {
    decayedEntities, decayedDecisions, archivedEntities, archivedNames,
    archiveSkipped: gate.skipped, backup: gate.backup, removed,
  };
}

function backupDirFor(db, opts) {
  const dir = opts.backupDir || process.env.CONSOLIDATE_BACKUP_DIR;
  if (dir) return dir;
  if (!db.name || db.name === ':memory:') throw new Error('no backup directory for a database without a file');
  return path.join(path.dirname(path.resolve(db.name)), 'backups', 'consolidation');
}

function removalBackup(db, opts, now, reuseMs) {
  return backupStore(db, {
    dir: backupDirFor(db, opts),
    keep: opts.backupKeep ?? (Number(process.env.CONSOLIDATE_BACKUP_KEEP) || BACKUP_KEEP),
    reuseMs,
    now,
  });
}

/**
 * The backup a cycle's first archival move waits for (review 2026-09-27):
 * archival is a lossless move, but it rewrites the only copy of the memory,
 * and the theme gate alone took a backup only once a theme went idle (months
 * away on the node). One per BACKUP_REUSE_MS, shared with the theme gate. A
 * database without a file (tests) has no copy for one to protect.
 *
 * @returns {{ backup: { path: string, reused: boolean, removed: string[] }|null, skipped: string|null }}
 *   `skipped` set: no backup could be taken, so the caller moves nothing
 */
function archivalBackup(db, opts, now) {
  if (!db.name || db.name === ':memory:') return { backup: null, skipped: null };
  try {
    return { backup: removalBackup(db, opts, now, BACKUP_REUSE_MS), skipped: null };
  } catch (err) {
    return { backup: null, skipped: `no backup: ${err.message}` };
  }
}

/**
 * Take out of the live tables what decay made irrelevant (P5-2) — without
 * destroying it (repair 2026-09-26; P5-2 hard-deleted decisions and purged the
 * archive after 90 days):
 *   - decisions whose salience decayed below DECAY_DROP_THRESHOLD move to
 *     decisions_archived (every column; the FTS delete trigger drops them from
 *     decisions_fts) and are resurrected if re-mentioned — once a backup
 *     exists (archivalBackup); without one they stay live and
 *     `decisionsSkipped` says why;
 *   - themes not seen for `themeIdleDays` are deleted — the one hard delete
 *     left, so it waits for a VACUUM INTO backup no older than a day (reused
 *     within that window: a theme idle that long is already in it). No backup,
 *     no delete: the themes stay and `themesSkipped` says why.
 * Archives are never purged (operator decision, same day): they are the
 * recovery path, and a purged entity would return as a fresh 0.5 row instead
 * of the low-salience resurrection.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} [opts]
 * @param {string|Date} [opts.now]
 * @param {number} [opts.themeIdleDays]
 * @param {string} [opts.backupDir] — default CONSOLIDATE_BACKUP_DIR, else backups/consolidation beside the database
 * @param {number} [opts.backupKeep] — default CONSOLIDATE_BACKUP_KEEP, else BACKUP_KEEP
 * @returns {{ archivedDecisions: number, prunedThemes: number, themesSkipped: string|null,
 *   decisionsSkipped: string|null, backup: { path: string, reused: boolean, removed: string[] }|null,
 *   removed: Array<{ action: 'archived'|'deleted', kind: 'decision'|'theme', id: number, label: string }> }}
 */
export function pruneStale(db, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const nowIso = now.toISOString();
  const themeIdleDays = opts.themeIdleDays ?? THEME_IDLE_DAYS;
  const themeCutoff = new Date(now - themeIdleDays * DAY_MS).toISOString();

  let backup = null;
  let themesSkipped = null;
  const themesIdle = !!db.prepare('SELECT 1 FROM themes WHERE last_seen < ? LIMIT 1').get(themeCutoff);
  if (themesIdle) {
    try {
      backup = removalBackup(db, opts, now, Math.min(BACKUP_REUSE_MS, themeIdleDays * DAY_MS));
    } catch (err) {
      themesSkipped = `no backup: ${err.message}`;
    }
  }
  // The theme backup, when there is one, serves the decisions too.
  let decisionsSkipped = null;
  if (!backup && db.prepare('SELECT 1 FROM decisions WHERE salience IS NOT NULL AND salience < ? LIMIT 1').get(DECAY_DROP_THRESHOLD)) {
    ({ backup, skipped: decisionsSkipped } = archivalBackup(db, opts, now));
  }

  const archive = createMemoryArchive(db);
  const run = db.transaction(() => {
    const removed = [];
    const decayedOut = decisionsSkipped ? [] : db.prepare(`
      SELECT id, session_id, decision, salience FROM decisions
      WHERE salience IS NOT NULL AND salience < ? ORDER BY id
    `).all(DECAY_DROP_THRESHOLD);
    for (const d of decayedOut) {
      archive.archiveDecision(d.id, nowIso);
      removed.push({ action: 'archived', kind: 'decision', id: d.id, label: d.decision, salience: d.salience, session_id: d.session_id });
    }
    if (themesIdle && !themesSkipped) {
      // re-checked here: a theme upserted since the check above is no longer idle
      const idle = db.prepare('SELECT id, label FROM themes WHERE last_seen < ? ORDER BY id').all(themeCutoff);
      const drop = db.prepare('DELETE FROM themes WHERE id = ?');
      for (const t of idle) {
        drop.run(t.id);
        removed.push({ action: 'deleted', kind: 'theme', id: t.id, label: t.label });
      }
    }
    return removed;
  });
  const removed = run();
  return {
    archivedDecisions: removed.filter((r) => r.kind === 'decision').length,
    prunedThemes: removed.filter((r) => r.kind === 'theme').length,
    themesSkipped,
    decisionsSkipped,
    backup,
    removed,
  };
}

/** Everything a cycle took out of the live tables, decay first. */
export function cycleRemovals(result) {
  return [...(result?.decayed?.removed || []), ...(result?.pruned?.removed || [])];
}

/** One log line per removed row: what, which row, and why it went. */
export function formatRemoval(r) {
  const why = [
    r.salience != null ? `salience ${Number(r.salience).toFixed(3)}` : null,
    r.session_id ? `session ${String(r.session_id).slice(0, 8)}` : null,
  ].filter(Boolean).join(', ');
  return `${r.action} ${r.kind} #${r.id}${why ? ` (${why})` : ''} ${JSON.stringify(String(r.label).slice(0, 200))}`;
}

/** The counts half of a cycle report: decay, then the prune step's outcome. */
export function summarizeRemovals(result) {
  const parts = [];
  const d = result?.decayed;
  if (d) {
    parts.push(`decayed ${d.decayedEntities} entities + ${d.decayedDecisions} decisions, archived ${d.archivedEntities} entities`);
    if (d.archiveSkipped) parts.push(`decayed-out entities kept (${d.archiveSkipped})`);
    if (d.backup) parts.push(`backup ${d.backup.reused ? 'reused' : 'written'} ${d.backup.path}`);
  }
  const p = result?.pruned;
  if (p?.skipped) parts.push(`prune skipped (${p.skipped})`);
  else if (p) {
    parts.push(`pruned: archived ${p.archivedDecisions} decisions, deleted ${p.prunedThemes} idle themes`);
    if (p.decisionsSkipped) parts.push(`decayed-out decisions kept (${p.decisionsSkipped})`);
    if (p.themesSkipped) parts.push(`idle themes kept (${p.themesSkipped})`);
    if (p.backup) parts.push(`backup ${p.backup.reused ? 'reused' : 'written'} ${p.backup.path}`);
  }
  return parts.join(' · ');
}

/**
 * Reinforce entities that frequently co-occur across recent sessions.
 *
 * Finds entity pairs appearing together in ≥ REINFORCEMENT_COOCCURRENCE_MIN
 * distinct sessions. R2 fix (repair 1.3): a pair is credited once when it
 * first qualifies and again only when its shared-session count GROWS —
 * never per cycle. Each credited entity bumps mention_count by 1 and
 * salience by REINFORCEMENT_SALIENCE_BOOST (capped at 1.0), at most once
 * per cycle.
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

  // R2 fix (repair 1.3): credited-evidence state. Created lazily so every
  // caller (CLI, scheduler, tests) is covered regardless of init order.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cooccurrence_state (
      id_a INTEGER NOT NULL,
      id_b INTEGER NOT NULL,
      sessions_seen INTEGER NOT NULL,
      last_reinforced_at TEXT,
      PRIMARY KEY (id_a, id_b)
    )
  `);
  const getSeen = db.prepare(`SELECT sessions_seen FROM cooccurrence_state WHERE id_a = ? AND id_b = ?`);
  const creditState = db.prepare(`
    INSERT INTO cooccurrence_state (id_a, id_b, sessions_seen, last_reinforced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id_a, id_b) DO UPDATE SET
      sessions_seen = excluded.sessions_seen,
      last_reinforced_at = excluded.last_reinforced_at
  `);
  const shrinkState = db.prepare(`UPDATE cooccurrence_state SET sessions_seen = ? WHERE id_a = ? AND id_b = ?`);

  const reinforcedIds = new Set();
  const pairResults = [];
  const nowIso = new Date().toISOString();

  ensureReinforcementColumn(db);
  const bumpEntity = db.prepare(`
    UPDATE entities
    SET reinforcement_count = reinforcement_count + 1,
        salience = MIN(1.0, COALESCE(salience, 0.5) + ?)
    WHERE id = ?
  `);

  const doReinforce = db.transaction(() => {
    for (const pair of pairs) {
      const seen = getSeen.get(pair.id_a, pair.id_b)?.sessions_seen ?? 0;
      if (pair.shared_sessions <= seen) {
        // 30-day window aging can shrink shared_sessions below the credited
        // count; track the shrink so future growth credits from the new floor.
        if (pair.shared_sessions < seen) shrinkState.run(pair.shared_sessions, pair.id_a, pair.id_b);
        continue;
      }

      creditState.run(pair.id_a, pair.id_b, pair.shared_sessions, nowIso);
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

  ensureReinforcementColumn(db);
  const entityCandidates = db.prepare(`
    SELECT id, name, type, mention_count, reinforcement_count, salience
    FROM entities
    WHERE mention_count + reinforcement_count >= ?
      AND source_type = 'local'
      ${entityNotPubFilter}
    ORDER BY mention_count + reinforcement_count DESC, id ASC
  `).all(mentionThreshold).map(e => ({
    name: e.name,
    type: e.type,
    mentionCount: e.mention_count + e.reinforcement_count,
    salience: e.salience ?? 0.5,
  }));

  // P5-2: a decision that decayed out of recall is no longer a candidate,
  // however confident it was when stated — otherwise one planted
  // high-confidence decision stayed a promotion candidate forever.
  const decisionCandidates = db.prepare(`
    SELECT id, decision, confidence, rationale, created_at
    FROM decisions
    WHERE confidence >= ?
      AND COALESCE(salience, 0.5) >= ${DECAY_DROP_THRESHOLD}
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
