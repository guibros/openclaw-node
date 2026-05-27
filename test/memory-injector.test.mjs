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
  recallScore,
  writeBackReconsolidation,
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
      source_event_id TEXT,
      -- Block 7C reconsolidation + Block 9 privacy columns (added via migration in production)
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      private INTEGER DEFAULT 1
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
      source_event_id TEXT,
      -- Block 7C reconsolidation + Block 9 privacy columns
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      private INTEGER DEFAULT 1
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
  it('DEFAULT_TOKEN_BUDGET is 1500 (safety ceiling, Block 7 amendment C)', () => {
    // Block 7 amendment (C): token cap demoted to safety ceiling. The primary
    // curation lever is now Miller 7±2 per-category caps in curateForRecall.
    // Operators override via INJECTION_TOKEN_BUDGET env.
    assert.equal(DEFAULT_TOKEN_BUDGET, 1500);
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
    // F-N52: queryRelevantConcepts now reads entities.salience (global per
    // entity, updated by reconsolidation + decay), not AVG(mentions.salience)
    // (per-session, never updated). The test seeds entities without explicit
    // salience so both default to 0.5; bump them to distinguish ordering
    // in the way the test expects.
    db.exec(`UPDATE entities SET salience = 0.8 WHERE name = 'NATS'`);
    db.exec(`UPDATE entities SET salience = 0.7 WHERE name = 'Obsidian'`);

    // Query session-1 only — only NATS is mentioned there.
    const result1 = queryRelevantConcepts(db, ['session-1']);
    assert.equal(result1.length, 1);
    assert.equal(result1[0].name, 'NATS');
    assert.equal(result1[0].type, 'technology');
    assert.equal(result1[0].mentionCount, 15);

    // Query session-2 — both NATS (0.8) and Obsidian (0.7) are mentioned.
    // New semantic ranks by entity-global salience, so NATS comes first.
    const result2 = queryRelevantConcepts(db, ['session-2']);
    assert.equal(result2.length, 2);
    assert.equal(result2[0].name, 'NATS');
    assert.equal(result2[1].name, 'Obsidian');

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

// ─── Cluster C regression tests (F-C8/C9/C10/C11) ──────────────────────────

describe('queryRelevantConcepts — returns id + salience + last_recalled (F-C8/C10)', () => {
  it('includes id, mention_count (snake), salience, last_seen, last_recalled', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    const result = queryRelevantConcepts(db, ['session-1']);
    assert.ok(result.length > 0);
    assert.equal(typeof result[0].id, 'number', 'id should be present');
    assert.equal(typeof result[0].mention_count, 'number', 'mention_count (snake) for recallScore');
    assert.equal(typeof result[0].mentionCount, 'number', 'mentionCount (camel) for backward compat');
    assert.equal(typeof result[0].salience, 'number');
    assert.ok('last_seen' in result[0]);
    assert.ok('last_recalled' in result[0]);
    db.close();
  });

  it('respectPrivacy:true filters private entities', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    // Mark all entities private
    db.exec(`UPDATE entities SET private = 1`);
    const filtered = queryRelevantConcepts(db, ['session-1'], 10, { respectPrivacy: true });
    assert.equal(filtered.length, 0, 'private entities should be filtered');
    // Without privacy flag, everything returns
    const unfiltered = queryRelevantConcepts(db, ['session-1'], 10, { respectPrivacy: false });
    assert.ok(unfiltered.length > 0);
    db.close();
  });
});

describe('queryRelevantDecisions — returns id + session_id + salience (F-C8/C10)', () => {
  it('includes id, session_id, salience, last_recalled', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    const result = queryRelevantDecisions(db, ['session-1', 'session-2']);
    assert.ok(result.length > 0);
    assert.equal(typeof result[0].id, 'number');
    assert.equal(typeof result[0].session_id, 'string');
    assert.equal(typeof result[0].salience, 'number');
    assert.ok('last_recalled' in result[0]);
    db.close();
  });

  it('respectPrivacy:true filters private decisions', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    db.exec(`UPDATE decisions SET private = 1`);
    const filtered = queryRelevantDecisions(db, ['session-1', 'session-2'], 10, { respectPrivacy: true });
    assert.equal(filtered.length, 0);
    db.close();
  });
});

describe('recallScore — reads correct field names (F-C9, F-C11)', () => {
  it('reads mention_count (snake_case) from concept items', () => {
    const item = { mention_count: 100, salience: 0.5 };
    const score = recallScore(item);
    // log1p(100) * 0.5 * 1 * (1+0) * (1+0) ≈ 4.615 * 0.5 = 2.307
    assert.ok(score > 2 && score < 3, `expected ~2.3, got ${score}`);
  });

  it('falls back to mentionCount (camelCase) for legacy callers', () => {
    const item = { mentionCount: 100, salience: 0.5 };
    const score = recallScore(item);
    assert.ok(score > 2 && score < 3, `legacy field should work, got ${score}`);
  });

  it('reads score field from snippet items (F-C11 — RRF feedback)', () => {
    // Snippets carry RRF score in `.score` per retrieval-pipeline output
    const lowScore = recallScore({ mention_count: 1, salience: 0.5, score: 0.1 });
    const highScore = recallScore({ mention_count: 1, salience: 0.5, score: 0.9 });
    assert.ok(highScore > lowScore, 'higher RRF score should produce higher recall score');
  });

  it('rrf_score field still works (backward compat)', () => {
    const a = recallScore({ mention_count: 1, salience: 0.5, rrf_score: 0.9 });
    const b = recallScore({ mention_count: 1, salience: 0.5, score: 0.9 });
    assert.ok(Math.abs(a - b) < 0.001, 'rrf_score and score should produce same result');
  });
});

describe('writeBackReconsolidation — actually writes (F-C8)', () => {
  it('bumps salience + sets last_recalled when entityIds populated', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    // Find an entity ID to recall
    const entityRow = db.prepare('SELECT id, salience FROM entities WHERE name = ?').get('NATS');
    const before = entityRow.salience ?? 0.5;
    writeBackReconsolidation(db, { entityIds: [entityRow.id], decisionIds: [] });
    const after = db.prepare('SELECT salience, last_recalled FROM entities WHERE id = ?').get(entityRow.id);
    // Salience should be bumped (× 1.05 capped at 1.0)
    assert.ok(after.salience >= before, `salience should not decrease, before=${before} after=${after.salience}`);
    // last_recalled should be set
    assert.ok(after.last_recalled, 'last_recalled should be set');
    db.close();
  });

  it('does nothing when entityIds is empty (F-C8 baseline behavior preserved)', () => {
    const db = createTestExtractionDb();
    seedTestData(db);
    writeBackReconsolidation(db, { entityIds: [], decisionIds: [] });
    // Should not throw, should not modify rows
    const row = db.prepare('SELECT last_recalled FROM entities WHERE name = ?').get('NATS');
    assert.equal(row.last_recalled, null);
    db.close();
  });
});
