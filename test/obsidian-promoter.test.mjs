import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  SHARED_CONCEPTS_DIR,
  getNodeId,
  buildPromotedFrontmatter,
  queryPromotableConcepts,
  promoteConceptNotes,
} from '../lib/obsidian-promoter.mjs';

// ── Helpers ──────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'concept',
      first_seen TEXT,
      last_seen TEXT,
      mention_count INTEGER DEFAULT 0,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE mentions (
      id INTEGER PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      salience REAL DEFAULT 0.5,
      created_at TEXT DEFAULT '2026-01-01T00:00:00Z',
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE decisions (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      rationale TEXT,
      session_id TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT '2026-01-01T00:00:00Z',
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE themes (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      session_id TEXT,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
  `);
  return db;
}

function seedConceptData(db, name, mentionCount, type = 'concept') {
  const entityId = db.prepare(`
    INSERT INTO entities (name, type, first_seen, last_seen, mention_count)
    VALUES (?, ?, '2026-01-01T00:00:00Z', '2026-05-22T00:00:00Z', ?)
  `).run(name, type, mentionCount).lastInsertRowid;

  // Add mentions
  for (let i = 0; i < mentionCount; i++) {
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at)
      VALUES (?, ?, 0.7, '2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z')
    `).run(entityId, `session-${i}`);
  }

  return entityId;
}

// ── Tests ────────────────────────────────────────────────

describe('SHARED_CONCEPTS_DIR', () => {
  it('ends with projects/arcane-vault/concepts-shared', () => {
    assert.ok(SHARED_CONCEPTS_DIR.endsWith(join('projects', 'arcane-vault', 'concepts-shared')));
  });
});

describe('getNodeId', () => {
  it('returns a non-empty string (hostname or env)', () => {
    const nodeId = getNodeId();
    assert.ok(typeof nodeId === 'string');
    assert.ok(nodeId.length > 0);
  });
});

describe('buildPromotedFrontmatter', () => {
  it('includes standard concept fields plus provenance fields', () => {
    const entity = {
      name: 'NATS JetStream',
      type: 'technology',
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-05-22T00:00:00Z',
      mention_count: 15,
    };
    const fm = buildPromotedFrontmatter(entity, 'test-node', ['Ollama', 'SQLite'], 0.82);

    assert.ok(fm.startsWith('---'));
    assert.ok(fm.endsWith('---'));
    assert.ok(fm.includes('type: concept'));
    assert.ok(fm.includes('entity_type: technology'));
    assert.ok(fm.includes('mention_count: 15'));
    assert.ok(fm.includes('salience: 0.82'));
    assert.ok(fm.includes('[[Ollama]]'));
    assert.ok(fm.includes('[[SQLite]]'));
    // Provenance fields
    assert.ok(fm.includes('source_node: test-node'));
    assert.ok(fm.includes('original_path:'));
    assert.ok(fm.includes('promoted_at:'));
    assert.ok(fm.includes('nats-jetstream.md'));
  });
});

describe('queryPromotableConcepts', () => {
  it('returns only entities meeting the threshold', () => {
    const db = createTestDb();
    seedConceptData(db, 'HighMention', 12);
    seedConceptData(db, 'LowMention', 3);
    seedConceptData(db, 'Borderline', 10);

    const results = queryPromotableConcepts(db, 10);
    const names = results.map(r => r.entity.name);

    assert.ok(names.includes('HighMention'));
    assert.ok(names.includes('Borderline'));
    assert.ok(!names.includes('LowMention'));
    assert.equal(results.length, 2);
    db.close();
  });
});

describe('promoteConceptNotes', () => {
  let tmpDir;
  let vaultDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'promoter-test-'));
    vaultDir = join(tmpDir, 'concepts-shared');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes qualifying concepts to the shared directory', async () => {
    const db = createTestDb();
    seedConceptData(db, 'Spreading Activation', 15);
    seedConceptData(db, 'Wikilinks', 12);
    seedConceptData(db, 'Below Threshold', 5);

    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const result = await promoteConceptNotes({
      db,
      sharedDir: vaultDir,
      policy,
      nodeId: 'test-node',
    });

    assert.equal(result.promoted, 2);
    assert.ok(result.notes.includes('spreading-activation.md'));
    assert.ok(result.notes.includes('wikilinks.md'));

    // Verify files exist on disk
    const files = await readdir(vaultDir);
    assert.ok(files.includes('spreading-activation.md'));
    assert.ok(files.includes('wikilinks.md'));
    assert.ok(!files.includes('below-threshold.md'));

    db.close();
  });

  it('includes provenance frontmatter in written notes', async () => {
    const db = createTestDb();
    seedConceptData(db, 'ProvenanceTest', 11);

    const sharedDir2 = join(tmpDir, 'provenance-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    await promoteConceptNotes({
      db,
      sharedDir: sharedDir2,
      policy,
      nodeId: 'prov-node',
    });

    const content = await readFile(join(sharedDir2, 'provenancetest.md'), 'utf-8');
    assert.ok(content.includes('source_node: prov-node'));
    assert.ok(content.includes('original_path:'));
    assert.ok(content.includes('promoted_at:'));
    assert.ok(content.includes('type: concept'));

    db.close();
  });

  it('returns zero notes for an empty extraction store', async () => {
    const db = createTestDb();
    const sharedDir3 = join(tmpDir, 'empty-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const result = await promoteConceptNotes({
      db,
      sharedDir: sharedDir3,
      policy,
      nodeId: 'test-node',
    });

    assert.equal(result.promoted, 0);
    assert.deepEqual(result.notes, []);

    db.close();
  });

  it('is idempotent — re-running overwrites without error', async () => {
    const db = createTestDb();
    seedConceptData(db, 'IdempotentConcept', 15);

    const sharedDir4 = join(tmpDir, 'idempotent-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const r1 = await promoteConceptNotes({ db, sharedDir: sharedDir4, policy, nodeId: 'n1' });
    const r2 = await promoteConceptNotes({ db, sharedDir: sharedDir4, policy, nodeId: 'n1' });

    assert.equal(r1.promoted, 1);
    assert.equal(r2.promoted, 1);

    const files = await readdir(sharedDir4);
    assert.equal(files.length, 1);

    db.close();
  });
});
