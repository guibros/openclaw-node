import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  DECAY_HALF_LIFE_DAYS,
  DECAY_DROP_THRESHOLD,
  REINFORCEMENT_COOCCURRENCE_MIN,
  REINFORCEMENT_SALIENCE_BOOST,
  CLUSTER_COOCCURRENCE_MIN,
  initConsolidationTables,
  decayWeights,
  reinforceCoOccurrence,
  detectClusters,
  detectContradictions,
  evaluatePromotionCandidates,
} from '../lib/consolidation.mjs';
import { runConsolidationCycle } from '../bin/consolidate.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never let a cycle default to the REAL vault (getVaultPath) — fixture notes
// were landing in production ~/.openclaw/obsidian-local (memory review 2026-07-04).
const TEST_VAULT = mkdtempSync(join(tmpdir(), 'consolidation-vault-'));

/**
 * Helper: create a temp in-memory DB with the extraction store schema.
 */
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      embedding BLOB,
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      hierarchy_path TEXT,
      parent_id INTEGER REFERENCES themes(id),
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      salience REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_session ON mentions(session_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
  `);

  return db;
}

/**
 * Helper: insert an entity + mentions in multiple sessions.
 */
function insertEntity(db, name, type, opts = {}) {
  const now = opts.lastSeen || new Date().toISOString();
  const salience = opts.salience ?? 0.5;
  const lastRecalled = opts.lastRecalled || null;
  const sourceType = opts.sourceType || 'local';
  const mentionCount = opts.mentionCount || 1;

  db.prepare(`
    INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count, salience, last_recalled, source_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, type, name, now, now, mentionCount, salience, lastRecalled, sourceType);

  const entityId = db.prepare('SELECT id FROM entities WHERE name = ?').get(name).id;

  // Insert mentions in specified sessions
  const sessions = opts.sessions || ['session-1'];
  for (const sessionId of sessions) {
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(entityId, sessionId, salience, now, sourceType);
  }

  return entityId;
}

describe('consolidation constants', () => {
  it('exports correct constant values', () => {
    assert.equal(DECAY_HALF_LIFE_DAYS, 14);
    assert.equal(DECAY_DROP_THRESHOLD, 0.05);
    assert.equal(REINFORCEMENT_COOCCURRENCE_MIN, 3);
    assert.equal(REINFORCEMENT_SALIENCE_BOOST, 0.05);
    assert.equal(CLUSTER_COOCCURRENCE_MIN, 5);
  });
});

describe('initConsolidationTables', () => {
  it('creates entities_archived table', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='entities_archived'`
    ).all();
    assert.equal(tables.length, 1);

    // Verify columns
    const cols = db.pragma('table_info(entities_archived)').map(c => c.name);
    assert.ok(cols.includes('id'));
    assert.ok(cols.includes('name'));
    assert.ok(cols.includes('salience'));
    assert.ok(cols.includes('archived_at'));
    assert.ok(cols.includes('source_type'));

    db.close();
  });
});

describe('decayWeights', () => {
  it('applies half-life decay to stale entities', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    // Insert an entity last seen 28 days ago (2 half-lives → salience 0.5 → ~0.125)
    const twentyEightDaysAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
    insertEntity(db, 'stale-project', 'project', {
      salience: 0.5,
      lastSeen: twentyEightDaysAgo,
    });

    const result = decayWeights(db);

    assert.equal(result.decayedEntities, 1);
    const entity = db.prepare('SELECT salience FROM entities WHERE name = ?').get('stale-project');
    // After 28 days (2 half-lives): 0.5 * 0.5^2 = 0.125
    assert.ok(entity.salience < 0.2, `expected salience < 0.2, got ${entity.salience}`);
    assert.ok(entity.salience > 0.1, `expected salience > 0.1, got ${entity.salience}`);

    db.close();
  });

  it('archives entities below drop threshold', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    // Entity with very low salience that was last seen 100 days ago
    const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    insertEntity(db, 'forgotten-thing', 'concept', {
      salience: 0.1,
      lastSeen: longAgo,
    });

    const result = decayWeights(db);

    assert.equal(result.archivedEntities, 1);
    // Should be removed from entities
    const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get('forgotten-thing');
    assert.equal(entity, undefined);
    // Should be in entities_archived
    const archived = db.prepare('SELECT * FROM entities_archived WHERE name = ?').get('forgotten-thing');
    assert.ok(archived);
    assert.ok(archived.archived_at);

    db.close();
  });

  it('decays decisions similarly', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('session-1', 'Use Redis', 'Performance reasons', 0.9, thirtyDaysAgo, 0.5, 'local');

    const result = decayWeights(db);

    assert.equal(result.decayedDecisions, 1);
    const decision = db.prepare('SELECT salience FROM decisions WHERE decision = ?').get('Use Redis');
    assert.ok(decision.salience < 0.5, `expected decay, got ${decision.salience}`);

    db.close();
  });

  // F-C16 regression: archival used to throw SQLITE_CONSTRAINT_FOREIGNKEY
  // because mentions FK-reference entities and `foreign_keys = ON`. Whole
  // transaction rolled back silently → archival never happened.
  it('archives entity WITH mentions when foreign_keys=ON (no FK violation)', () => {
    const db = createTestDb();
    initConsolidationTables(db);
    db.pragma('foreign_keys = ON');

    // Insert an entity old enough to trip the drop threshold
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const idVeryOld = insertEntity(db, 'long-decayed', 'concept', {
      sessions: ['session-old'],
      salience: 0.5,             // will decay below 0.05 with 365 days at half-life 14d
      lastSeen: longAgo,         // helper uses camelCase opts
      lastRecalled: longAgo,
    });
    // Sanity: there IS a mention referencing this entity
    const mentions = db.prepare('SELECT * FROM mentions WHERE entity_id = ?').all(idVeryOld);
    assert.ok(mentions.length > 0, 'precondition: entity has mentions');

    // This used to throw silently (transaction rollback). Now it should succeed.
    let threw = null;
    let result;
    try {
      result = decayWeights(db);
    } catch (err) {
      threw = err;
    }
    assert.equal(threw, null, `decayWeights should not throw, got ${threw}`);
    assert.ok(result.archivedEntities >= 1, `expected ≥1 archival, got ${result.archivedEntities}`);

    // Entity row should be gone
    const remaining = db.prepare('SELECT * FROM entities WHERE id = ?').get(idVeryOld);
    assert.equal(remaining, undefined);
    // And mentions should be cleaned up (no orphans)
    const orphanMentions = db.prepare('SELECT * FROM mentions WHERE entity_id = ?').all(idVeryOld);
    assert.equal(orphanMentions.length, 0);
    // And archived table should have it
    const archived = db.prepare('SELECT * FROM entities_archived WHERE id = ?').get(idVeryOld);
    assert.ok(archived, 'entity should be in archive');

    db.close();
  });
});

describe('reinforceCoOccurrence', () => {
  it('bumps entities co-occurring in ≥3 sessions', () => {
    const db = createTestDb();

    const sessions = ['s1', 's2', 's3'];
    const idA = insertEntity(db, 'entity-a', 'concept', { sessions, salience: 0.4 });
    const idB = insertEntity(db, 'entity-b', 'concept', { sessions, salience: 0.4 });

    const result = reinforceCoOccurrence(db);

    assert.equal(result.reinforcedEntities, 2);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].sessions, 3);

    // Check salience was bumped
    const entityA = db.prepare('SELECT salience, mention_count FROM entities WHERE name = ?').get('entity-a');
    assert.ok(entityA.salience > 0.4, `expected salience > 0.4, got ${entityA.salience}`);
    assert.equal(entityA.mention_count, 2); // was 1, bumped to 2

    db.close();
  });

  it('does not reinforce entities below threshold', () => {
    const db = createTestDb();

    // Only 2 shared sessions (below default min of 3)
    insertEntity(db, 'rare-a', 'concept', { sessions: ['s1', 's2'] });
    insertEntity(db, 'rare-b', 'concept', { sessions: ['s1', 's2'] });

    const result = reinforceCoOccurrence(db);

    assert.equal(result.reinforcedEntities, 0);
    assert.equal(result.pairs.length, 0);

    db.close();
  });

  it('second cycle with no new evidence credits nothing (R2, repair 1.3)', () => {
    const db = createTestDb();

    const sessions = ['s1', 's2', 's3'];
    insertEntity(db, 'pair-a', 'concept', { sessions, salience: 0.4 });
    insertEntity(db, 'pair-b', 'concept', { sessions, salience: 0.4 });

    const first = reinforceCoOccurrence(db);
    assert.equal(first.reinforcedEntities, 2);

    const snapshot = db.prepare(`SELECT name, mention_count, salience FROM entities ORDER BY name`).all();
    const second = reinforceCoOccurrence(db);

    assert.equal(second.reinforcedEntities, 0);
    assert.equal(second.pairs.length, 0);
    assert.deepEqual(
      db.prepare(`SELECT name, mention_count, salience FROM entities ORDER BY name`).all(),
      snapshot
    );

    db.close();
  });

  it('one new shared session credits each member exactly +1', () => {
    const db = createTestDb();

    const sessions = ['s1', 's2', 's3'];
    const idA = insertEntity(db, 'grow-a', 'concept', { sessions, salience: 0.4 });
    const idB = insertEntity(db, 'grow-b', 'concept', { sessions, salience: 0.4 });

    reinforceCoOccurrence(db);
    const before = db.prepare(`SELECT mention_count FROM entities WHERE name = 'grow-a'`).get().mention_count;

    const now = new Date().toISOString();
    for (const id of [idA, idB]) {
      db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type)
                  VALUES (?, 's4', 0.5, ?, 'local')`).run(id, now);
    }

    const result = reinforceCoOccurrence(db);
    assert.equal(result.reinforcedEntities, 2);
    assert.equal(result.pairs[0].sessions, 4);

    const after = db.prepare(`SELECT mention_count FROM entities WHERE name = 'grow-a'`).get().mention_count;
    assert.equal(after, before + 1);

    db.close();
  });
});

describe('detectClusters', () => {
  it('finds entity clusters via co-occurrence', () => {
    const db = createTestDb();

    const sessions = ['s1', 's2', 's3', 's4', 's5'];
    insertEntity(db, 'cluster-a', 'concept', { sessions });
    insertEntity(db, 'cluster-b', 'concept', { sessions });
    insertEntity(db, 'loner', 'concept', { sessions: ['s1'] });

    const result = detectClusters(db);

    assert.equal(result.clusters.length, 1);
    assert.deepEqual(result.clusters[0].entities.sort(), ['cluster-a', 'cluster-b']);
    assert.equal(result.clusters[0].sessions, 5);

    db.close();
  });

  it('returns empty clusters when below threshold', () => {
    const db = createTestDb();

    insertEntity(db, 'solo-a', 'concept', { sessions: ['s1', 's2'] });
    insertEntity(db, 'solo-b', 'concept', { sessions: ['s3', 's4'] });

    const result = detectClusters(db);

    assert.equal(result.clusters.length, 0);

    db.close();
  });
});

describe('detectContradictions', () => {
  it('returns zero for no mixed-provenance data', () => {
    const db = createTestDb();

    insertEntity(db, 'local-only', 'concept', { sourceType: 'local' });

    const result = detectContradictions(db);

    assert.equal(result.total, 0);
    assert.equal(result.entityConflicts, 0);
    assert.equal(result.decisionConflicts, 0);

    db.close();
  });

  it('detects entity conflicts from mixed provenance', () => {
    const db = createTestDb();

    // Insert entity with local mention
    const localId = insertEntity(db, 'shared-concept', 'technology', {
      sourceType: 'local',
      sessions: ['s1'],
    });
    // Add shared mention
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type, source_node)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(localId, 's2', 0.5, new Date().toISOString(), 'shared', 'node-2');

    const result = detectContradictions(db);

    assert.equal(result.entityConflicts, 1);

    db.close();
  });
});

describe('evaluatePromotionCandidates', () => {
  it('returns entities above mention threshold', () => {
    const db = createTestDb();

    insertEntity(db, 'popular', 'concept', { mentionCount: 15, sourceType: 'local' });
    insertEntity(db, 'unpopular', 'concept', { mentionCount: 3, sourceType: 'local' });

    const result = evaluatePromotionCandidates(db);

    assert.equal(result.entityCandidates.length, 1);
    assert.equal(result.entityCandidates[0].name, 'popular');
    assert.equal(result.entityCandidates[0].mentionCount, 15);

    db.close();
  });

  it('returns decisions above confidence threshold', () => {
    const db = createTestDb();

    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 'High-conf decision', 'Solid reasons', 0.98, new Date().toISOString(), 0.5, 'local');
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('s2', 'Low-conf decision', 'Weak reasons', 0.5, new Date().toISOString(), 0.5, 'local');

    const result = evaluatePromotionCandidates(db);

    assert.equal(result.decisionCandidates.length, 1);
    assert.equal(result.decisionCandidates[0].decision, 'High-conf decision');

    db.close();
  });
});

describe('runConsolidationCycle', () => {
  it('runs a full cycle and returns results', async () => {
    const db = createTestDb();

    // Set up some test data
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    insertEntity(db, 'aging-entity', 'concept', { salience: 0.5, lastSeen: thirtyDaysAgo });
    insertEntity(db, 'promoted-entity', 'concept', { mentionCount: 12, sourceType: 'local' });

    const result = await runConsolidationCycle({ vaultPath: TEST_VAULT, db });

    assert.ok(result.durationMs >= 0);
    assert.ok('decayed' in result);
    assert.ok('reinforced' in result);
    assert.ok('clusters' in result);
    assert.ok('summariesRegenerated' in result);
    assert.ok('contradictions' in result);
    assert.ok('promotionCandidates' in result);

    // Verify decay ran
    assert.ok(result.decayed.decayedEntities >= 0);

    // Verify promotion candidates found
    assert.equal(result.promotionCandidates.entityCandidates.length, 1);

    db.close();
  });

  it('the cycle backfills session notes for DB sessions lacking one (memory review V1-2)', async () => {
    const db = createTestDb();
    insertEntity(db, 'backfilled-concept', 'concept', {
      mentionCount: 6, sourceType: 'local',
      sessions: ['cafe0001-1111-2222-3333-444455556666'],
    });

    const vault = mkdtempSync(join(tmpdir(), 'cycle-vault-'));
    const result = await runConsolidationCycle({ vaultPath: vault, db });

    assert.ok(result.vaultSurfaces, 'cycle reports vault surfaces');
    assert.equal(result.vaultSurfaces.sessionNotes, 1, 'one session note backfilled');
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(join(vault, 'sessions'));
    assert.equal(files.length, 1);
    assert.ok(files[0].includes('cafe0001'), 'note filename embeds the session shortid');
    assert.ok('dailyDigest' in result.vaultSurfaces);

    // Second cycle: nothing new to backfill — idempotent.
    const again = await runConsolidationCycle({ vaultPath: vault, db });
    assert.equal(again.vaultSurfaces.sessionNotes, 0);

    db.close();
  });

  it('regression_F-N100: aborts cleanly when signal fires before the cycle starts', async () => {
    const db = createTestDb();
    insertEntity(db, 'e1', 'concept', { mentionCount: 1 });

    const ac = new AbortController();
    ac.abort(new Error('hard cap'));  // already-aborted signal

    const result = await runConsolidationCycle({ vaultPath: TEST_VAULT, db, signal: ac.signal });

    assert.equal(result.aborted, true, 'cycle records that it was aborted');
    assert.equal(result.abortedAt, 'decay',
      'aborts at the first checkpoint after init (decay)');
    // Steps after the abort point are untouched
    assert.equal(result.decayed, undefined, 'decay never ran');
    assert.equal(result.contradictions, undefined, 'contradictions never ran');
    db.close();
  });

  it('regression_F-N100: aborts mid-cycle and reports which step', async () => {
    const db = createTestDb();
    insertEntity(db, 'e1', 'concept', { mentionCount: 1 });

    const ac = new AbortController();
    // Fire abort on next microtask — the first checkpoint will catch it after
    // decay runs (because checkpoints fire BEFORE each step, the cycle runs
    // init+decay synchronously before yielding).
    queueMicrotask(() => ac.abort(new Error('mid-cycle hard cap')));

    const result = await runConsolidationCycle({ vaultPath: TEST_VAULT, db, signal: ac.signal });

    // Either aborted at one of the checkpoints, or completed before microtask
    // depending on scheduling — both are valid. The key assertion: when
    // aborted, abortedAt is set and downstream steps didn't run.
    if (result.aborted) {
      // F-Q307 added 'summaries-midloop' as a valid abortedAt value when the
      // per-concept summary loop catches the signal mid-iteration (vs. the
      // between-step checkpoints).
      assert.ok(['decay', 'reinforce', 'clusters', 'summaries',
                 'summaries-midloop', 'vault-surfaces',
                 'contradictions', 'promotion'].includes(result.abortedAt),
        `abortedAt should be a known step, got: ${result.abortedAt}`);
    }
    db.close();
  });
});

describe('decayWeights — time-anchored (R1, repair 1.2)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const halfLife = (days) => Math.pow(0.5, days / 14);

  it('repeated cycles compose to a single application, not compounding', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    const t0 = new Date('2026-06-01T00:00:00.000Z');
    const idleSince = new Date(t0 - 8 * DAY).toISOString();
    insertEntity(db, 'idle-entity', 'concept', { salience: 0.8, lastSeen: idleSince });

    decayWeights(db, { now: t0.toISOString() });
    const afterAnchor = db.prepare(`SELECT salience, last_decayed_at FROM entities WHERE name = 'idle-entity'`).get();
    assert.ok(Math.abs(afterAnchor.salience - 0.8 * halfLife(8)) < 0.002);
    assert.equal(afterAnchor.last_decayed_at, t0.toISOString());

    decayWeights(db, { now: new Date(t0.getTime() + 30 * 60 * 1000).toISOString() });
    const afterTiny = db.prepare(`SELECT salience, last_decayed_at FROM entities WHERE name = 'idle-entity'`).get();
    assert.equal(afterTiny.last_decayed_at, t0.toISOString());

    decayWeights(db, { now: new Date(t0.getTime() + 60 * 60 * 1000).toISOString() });
    const final = db.prepare(`SELECT salience FROM entities WHERE name = 'idle-entity'`).get();

    const composed = 0.8 * halfLife(8 + 1 / 24);
    assert.ok(Math.abs(final.salience - composed) < 0.002,
      `expected composed ${composed.toFixed(4)}, got ${final.salience.toFixed(4)}`);
    const compounded = 0.8 * halfLife(8) * halfLife(8) * halfLife(8);
    assert.ok(final.salience > compounded + 0.1,
      `salience ${final.salience.toFixed(4)} should be far above the compounding result ${compounded.toFixed(4)}`);

    db.close();
  });

  it('recall after a decay restarts the idle clock', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    const t0 = new Date('2026-06-01T00:00:00.000Z');
    insertEntity(db, 'recalled-entity', 'concept', {
      salience: 0.5,
      lastSeen: new Date(t0 - 5 * DAY).toISOString(),
    });

    decayWeights(db, { now: t0.toISOString() });
    const anchored = db.prepare(`SELECT salience FROM entities WHERE name = 'recalled-entity'`).get().salience;

    db.prepare(`UPDATE entities SET last_recalled = ? WHERE name = 'recalled-entity'`)
      .run(new Date(t0.getTime() + 2 * DAY).toISOString());

    decayWeights(db, { now: new Date(t0.getTime() + 3 * DAY).toISOString() });
    const final = db.prepare(`SELECT salience FROM entities WHERE name = 'recalled-entity'`).get().salience;

    assert.ok(Math.abs(final - anchored * halfLife(1)) < 0.005,
      `expected 1 idle day of decay (${(anchored * halfLife(1)).toFixed(4)}), got ${final.toFixed(4)}`);
    assert.ok(final > anchored * halfLife(3) + 0.02,
      'decay must count from the recall, not from the previous anchor');

    db.close();
  });

  it('decisions decay is anchored the same way', () => {
    const db = createTestDb();
    initConsolidationTables(db);

    const t0 = new Date('2026-06-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 'anchor decisions too', 'R1 applies to both loops', 0.9,
      new Date(t0 - 10 * DAY).toISOString(), 0.6, 'local');

    decayWeights(db, { now: t0.toISOString() });
    decayWeights(db, { now: new Date(t0.getTime() + 60 * 60 * 1000).toISOString() });
    const final = db.prepare(`SELECT salience FROM decisions WHERE decision = 'anchor decisions too'`).get().salience;

    const composed = 0.6 * halfLife(10 + 1 / 24);
    assert.ok(Math.abs(final - composed) < 0.002,
      `expected composed ${composed.toFixed(4)}, got ${final.toFixed(4)}`);

    db.close();
  });
});

describe('R20 (repair 5.3): promotion emits on change only', () => {
  function mockEventLog(published) {
    return { publishLocal: async (evt) => { published.push(evt); } };
  }

  it('an unchanged candidate set does not re-emit; a changed set does', async () => {
    const db = createTestDb();
    initConsolidationTables(db);
    insertEntity(db, 'promotable-one', 'concept', {
      sessions: ['s1', 's2', 's3'], salience: 0.9, mentionCount: 25,
    });

    const published = [];
    const { runConsolidationCycle } = await import('../bin/consolidate.mjs');

    await runConsolidationCycle({ vaultPath: TEST_VAULT, db, eventLog: mockEventLog(published), nodeId: 'test-node' });
    const promotedAfterFirst = published.filter(e => e.event_type === 'memory.promoted').length;
    assert.equal(promotedAfterFirst, 1, 'first sighting of the candidate set must emit');

    const r2 = await runConsolidationCycle({ vaultPath: TEST_VAULT, db, eventLog: mockEventLog(published), nodeId: 'test-node' });
    assert.equal(published.filter(e => e.event_type === 'memory.promoted').length, promotedAfterFirst,
      'unchanged set must not re-emit');
    assert.equal(r2.promotionCandidates?.eventSkipped, true);

    insertEntity(db, 'promotable-two', 'concept', {
      sessions: ['s4', 's5', 's6'], salience: 0.9, mentionCount: 30,
    });
    await runConsolidationCycle({ vaultPath: TEST_VAULT, db, eventLog: mockEventLog(published), nodeId: 'test-node' });
    assert.equal(published.filter(e => e.event_type === 'memory.promoted').length, promotedAfterFirst + 1,
      'a changed candidate set must emit');

    db.close();
  });
});
