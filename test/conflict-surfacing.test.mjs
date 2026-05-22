import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  describeConflict,
  findEntityConflicts,
  findDecisionConflicts,
  surfaceConflicts,
  annotateWithConflicts,
} from '../lib/conflict-surfacing.mjs';

/**
 * Helper: create an in-memory database with the extraction store schema
 * (entities, themes, mentions, decisions) including provenance columns.
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

describe('describeConflict', () => {
  it('returns conflict descriptor with local and shared definitions', () => {
    const local = { summary: 'NATS is a messaging system', last_seen: '2026-05-20T10:00:00Z' };
    const shared = { summary: 'NATS is a pub-sub broker', last_seen: '2026-05-21T15:00:00Z' };
    const result = describeConflict(local, shared);

    assert.equal(result.local_definition, 'NATS is a messaging system');
    assert.equal(result.shared_definition, 'NATS is a pub-sub broker');
    assert.equal(result.last_local_mention, '2026-05-20T10:00:00Z');
    assert.equal(result.last_shared_mention, '2026-05-21T15:00:00Z');
  });
});

describe('findEntityConflicts', () => {
  it('detects entity with mixed-provenance mentions', () => {
    const db = createTestDb();

    // Insert entity
    db.prepare(`
      INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count, source_type)
      VALUES ('NATS', 'technology', 'NATS', '2026-05-20T10:00:00Z', '2026-05-21T15:00:00Z', 3, 'local')
    `).run();

    const entityId = db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS').id;

    // Insert local mention
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type, source_node)
      VALUES (?, 'session-1', 0.8, '2026-05-20T10:00:00Z', 'local', NULL)
    `).run(entityId);

    // Insert shared mention
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type, source_node)
      VALUES (?, 'session-2', 0.7, '2026-05-21T15:00:00Z', 'shared', 'node-B')
    `).run(entityId);

    const conflicts = findEntityConflicts(db);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].entity_name, 'NATS');
    assert.equal(conflicts[0].conflict, true);
    assert.equal(conflicts[0].conflict_type, 'mixed_provenance');
    assert.equal(conflicts[0].local_mention_count, 1);
    assert.equal(conflicts[0].shared_mention_count, 1);
    assert.equal(conflicts[0].shared_source_node, 'node-B');
    assert.ok(conflicts[0].description.local_definition);
    assert.ok(conflicts[0].description.shared_definition);

    db.close();
  });

  it('returns empty array when entity has only local mentions', () => {
    const db = createTestDb();

    db.prepare(`
      INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count, source_type)
      VALUES ('SQLite', 'technology', 'SQLite', '2026-05-20T10:00:00Z', '2026-05-20T10:00:00Z', 1, 'local')
    `).run();

    const entityId = db.prepare('SELECT id FROM entities WHERE name = ?').get('SQLite').id;

    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type)
      VALUES (?, 'session-1', 0.9, '2026-05-20T10:00:00Z', 'local')
    `).run(entityId);

    const conflicts = findEntityConflicts(db);
    assert.equal(conflicts.length, 0);

    db.close();
  });

  it('returns empty array when no mentions exist', () => {
    const db = createTestDb();

    db.prepare(`
      INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, source_type)
      VALUES ('orphan', 'concept', 'orphan', '2026-05-20T10:00:00Z', '2026-05-20T10:00:00Z', 'local')
    `).run();

    const conflicts = findEntityConflicts(db);
    assert.equal(conflicts.length, 0);

    db.close();
  });
});

describe('findDecisionConflicts', () => {
  it('detects decisions from different sources in same session', () => {
    const db = createTestDb();

    // Local decision
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type, source_node)
      VALUES ('session-X', 'Use SQLite for storage', 'Simple and embedded', 0.9, '2026-05-20T10:00:00Z', 'local', NULL)
    `).run();

    // Shared decision in same session
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type, source_node)
      VALUES ('session-X', 'Use PostgreSQL for storage', 'Better concurrency', 0.85, '2026-05-21T15:00:00Z', 'shared', 'node-C')
    `).run();

    const conflicts = findDecisionConflicts(db);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].session_id, 'session-X');
    assert.equal(conflicts[0].conflict, true);
    assert.equal(conflicts[0].conflict_type, 'decision_divergence');
    assert.equal(conflicts[0].local_decisions.length, 1);
    assert.equal(conflicts[0].shared_decisions.length, 1);
    assert.equal(conflicts[0].local_decisions[0].decision, 'Use SQLite for storage');
    assert.equal(conflicts[0].shared_decisions[0].decision, 'Use PostgreSQL for storage');

    db.close();
  });

  it('returns empty array when all decisions are from same source type', () => {
    const db = createTestDb();

    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type)
      VALUES ('session-Y', 'Use NATS', 'Good fit', 0.9, '2026-05-20T10:00:00Z', 'local')
    `).run();

    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type)
      VALUES ('session-Y', 'Use JetStream', 'Persistence', 0.85, '2026-05-20T11:00:00Z', 'local')
    `).run();

    const conflicts = findDecisionConflicts(db);
    assert.equal(conflicts.length, 0);

    db.close();
  });
});

describe('surfaceConflicts', () => {
  it('aggregates entity and decision conflicts', () => {
    const db = createTestDb();

    // Create an entity conflict
    db.prepare(`
      INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count, source_type)
      VALUES ('Ollama', 'tool', 'Ollama', '2026-05-20T10:00:00Z', '2026-05-21T15:00:00Z', 2, 'local')
    `).run();
    const entityId = db.prepare('SELECT id FROM entities WHERE name = ?').get('Ollama').id;
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type)
      VALUES (?, 'session-1', 0.8, '2026-05-20T10:00:00Z', 'local')
    `).run(entityId);
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at, source_type, source_node)
      VALUES (?, 'session-2', 0.7, '2026-05-21T15:00:00Z', 'shared', 'node-D')
    `).run(entityId);

    // Create a decision conflict
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type)
      VALUES ('session-Z', 'Deploy to cloud', 'Scalability', 0.9, '2026-05-20T10:00:00Z', 'local')
    `).run();
    db.prepare(`
      INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, source_type, source_node)
      VALUES ('session-Z', 'Stay on-prem', 'Control', 0.85, '2026-05-21T15:00:00Z', 'shared', 'node-E')
    `).run();

    const result = surfaceConflicts(db);
    assert.equal(result.entity_conflicts.length, 1);
    assert.equal(result.decision_conflicts.length, 1);
    assert.equal(result.total, 2);

    db.close();
  });
});

describe('annotateWithConflicts', () => {
  it('adds conflict flag and detail to matching results', () => {
    const results = [
      { name: 'NATS', type: 'technology', mention_count: 5 },
      { name: 'SQLite', type: 'technology', mention_count: 3 },
    ];

    const conflicts = [
      {
        entity_name: 'NATS',
        conflict: true,
        description: {
          local_definition: 'NATS local def',
          shared_definition: 'NATS shared def',
          last_local_mention: '2026-05-20T10:00:00Z',
          last_shared_mention: '2026-05-21T15:00:00Z',
        },
      },
    ];

    const annotated = annotateWithConflicts(results, conflicts);
    assert.equal(annotated.length, 2);
    assert.equal(annotated[0].conflict, true);
    assert.equal(annotated[0].conflict_detail.local_definition, 'NATS local def');
    assert.equal(annotated[1].conflict, undefined);
    // Original results not mutated
    assert.equal(results[0].conflict, undefined);
  });

  it('returns all results unchanged when no conflicts match', () => {
    const results = [
      { name: 'Redis', type: 'technology' },
    ];

    const annotated = annotateWithConflicts(results, []);
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0].name, 'Redis');
    assert.equal(annotated[0].conflict, undefined);
  });
});
