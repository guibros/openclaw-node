import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  DEFAULT_TOKEN_BUDGET,
  CHARS_PER_TOKEN,
  estimateTokens,
  queryRelevantConcepts,
  queryRelevantDecisions,
  trimToBudget,
  createMemoryInjector,
} from '../lib/memory-injector.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create an in-memory extraction store with schema for testing. */
function createTestExtractionDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE entities (
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
    CREATE TABLE themes (
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
    CREATE TABLE mentions (
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
    CREATE TABLE decisions (
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
    CREATE INDEX idx_mentions_entity ON mentions(entity_id);
    CREATE INDEX idx_mentions_session ON mentions(session_id);
    CREATE INDEX idx_decisions_session ON decisions(session_id);
  `);
  return db;
}

/** Seed test data: 2 entities, 3 mentions, 2 decisions across 2 sessions. */
function seedTestData(db) {
  const now = '2026-05-23T12:00:00.000Z';
  db.prepare(`INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
    VALUES ('NATS', 'technology', 'NATS', ?, ?, 15)`).run(now, now);
  db.prepare(`INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
    VALUES ('Obsidian', 'technology', 'Obsidian', ?, ?, 8)`).run(now, now);

  // Mentions: NATS in session-1 (salience 0.9), Obsidian in session-2 (salience 0.7), NATS in session-2 (salience 0.5)
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (1, 'session-1', 0.9, ?)`).run(now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (2, 'session-2', 0.7, ?)`).run(now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (1, 'session-2', 0.5, ?)`).run(now);

  // Decisions
  db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at)
    VALUES ('session-1', 'Use NATS JetStream for event log', 'Durable, local-first', 0.95, ?)`).run(now);
  db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at)
    VALUES ('session-2', 'Skip BGE reranker', 'RRF is sufficient at this scale', 0.85, ?)`).run(now);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('DEFAULT_TOKEN_BUDGET is 750', () => {
    assert.equal(DEFAULT_TOKEN_BUDGET, 750);
  });

  it('CHARS_PER_TOKEN is 4', () => {
    assert.equal(CHARS_PER_TOKEN, 4);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty/null input', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  it('estimates tokens correctly using 4 chars/token heuristic', () => {
    // 20 chars → ceil(20/4) = 5 tokens
    assert.equal(estimateTokens('12345678901234567890'), 5);
    // 7 chars → ceil(7/4) = 2 tokens
    assert.equal(estimateTokens('1234567'), 2);
  });
});

describe('queryRelevantConcepts', () => {
  it('returns empty array for empty sessionIds', () => {
    const db = createTestExtractionDb();
    assert.deepEqual(queryRelevantConcepts(db, []), []);
    assert.deepEqual(queryRelevantConcepts(db, null), []);
    db.close();
  });

  it('returns entities mentioned in given sessions sorted by salience', () => {
    const db = createTestExtractionDb();
    seedTestData(db);

    // Query session-1 only — should return NATS (salience 0.9)
    const result1 = queryRelevantConcepts(db, ['session-1']);
    assert.equal(result1.length, 1);
    assert.equal(result1[0].name, 'NATS');
    assert.equal(result1[0].type, 'technology');
    assert.equal(result1[0].mentionCount, 15);

    // Query session-2 — should return Obsidian first (0.7) then NATS (0.5)
    const result2 = queryRelevantConcepts(db, ['session-2']);
    assert.equal(result2.length, 2);
    assert.equal(result2[0].name, 'Obsidian');
    assert.equal(result2[1].name, 'NATS');

    db.close();
  });
});

describe('queryRelevantDecisions', () => {
  it('returns empty array for empty sessionIds', () => {
    const db = createTestExtractionDb();
    assert.deepEqual(queryRelevantDecisions(db, []), []);
    db.close();
  });

  it('returns decisions from given sessions sorted by confidence', () => {
    const db = createTestExtractionDb();
    seedTestData(db);

    const result = queryRelevantDecisions(db, ['session-1', 'session-2']);
    assert.equal(result.length, 2);
    // Higher confidence first
    assert.equal(result[0].confidence, 0.95);
    assert.ok(result[0].decision.includes('NATS'));
    assert.equal(result[1].confidence, 0.85);
    assert.ok(result[1].decision.includes('reranker'));

    db.close();
  });
});

describe('trimToBudget', () => {
  it('includes all items when within budget', () => {
    const data = {
      concepts: [{ name: 'A', type: 'tech' }],
      decisions: [{ decision: 'Use X', confidence: 0.9, date: '2026-05-23' }],
      snippets: [{ snippet: 'short snippet', score: 0.8 }],
    };
    const result = trimToBudget(data, 500);
    assert.equal(result.concepts.length, 1);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.snippets.length, 1);
    assert.ok(result.tokenCount > 0);
    assert.equal(result.budget, 500);
  });

  it('trims snippets first when over budget', () => {
    const longSnippet = 'x'.repeat(2000); // 500 tokens
    const data = {
      concepts: [{ name: 'A', type: 'tech' }],
      decisions: [{ decision: 'Use X', confidence: 0.9, date: '2026-05-23' }],
      snippets: [
        { snippet: longSnippet, score: 0.9 },
        { snippet: longSnippet, score: 0.8 },
      ],
    };
    // Budget of 100 tokens — concepts + decisions fit, but not both long snippets
    const result = trimToBudget(data, 100);
    assert.equal(result.concepts.length, 1);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.snippets.length, 0); // snippets too large
    assert.ok(result.tokenCount <= 100);
  });

  it('returns empty sections for very small budget', () => {
    const data = {
      concepts: [{ name: 'A', type: 'tech' }],
      decisions: [{ decision: 'Use X', confidence: 0.9, date: '2026-05-23' }],
      snippets: [{ snippet: 'text', score: 0.8 }],
    };
    const result = trimToBudget(data, 10);
    // Budget too small for overhead (30 tokens) — remaining goes negative
    assert.equal(result.concepts.length, 0);
    assert.equal(result.decisions.length, 0);
    assert.equal(result.snippets.length, 0);
  });

  it('handles empty input data', () => {
    const result = trimToBudget({ concepts: [], decisions: [], snippets: [] }, 750);
    assert.equal(result.concepts.length, 0);
    assert.equal(result.decisions.length, 0);
    assert.equal(result.snippets.length, 0);
    assert.equal(result.budget, 750);
  });
});

describe('createMemoryInjector', () => {
  it('returns an object with a retrieve method', () => {
    const injector = createMemoryInjector({});
    assert.equal(typeof injector.retrieve, 'function');
  });

  it('retrieve returns empty result for null prompt', async () => {
    const injector = createMemoryInjector({});
    const result = await injector.retrieve(null);
    assert.deepEqual(result.concepts, []);
    assert.deepEqual(result.decisions, []);
    assert.deepEqual(result.snippets, []);
    assert.equal(result.tokenCount, 0);
    assert.equal(result.budget, DEFAULT_TOKEN_BUDGET);
  });

  it('retrieve returns structured result with mock embedFn', async () => {
    // No DBs — pipeline returns empty, but structure is correct
    const mockEmbedFn = async () => new Float32Array(1024);
    const injector = createMemoryInjector({});
    const result = await injector.retrieve('How does NATS work?', {
      embedFn: mockEmbedFn,
    });
    assert.ok(Array.isArray(result.concepts));
    assert.ok(Array.isArray(result.decisions));
    assert.ok(Array.isArray(result.snippets));
    assert.equal(typeof result.tokenCount, 'number');
    assert.equal(typeof result.budget, 'number');
    assert.equal(result.budget, DEFAULT_TOKEN_BUDGET);
  });

  it('retrieve respects custom tokenBudget', async () => {
    const mockEmbedFn = async () => new Float32Array(1024);
    const injector = createMemoryInjector({});
    const result = await injector.retrieve('test query', {
      embedFn: mockEmbedFn,
      tokenBudget: 200,
    });
    assert.equal(result.budget, 200);
  });
});
