import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  DEFAULT_CHANNEL_WEIGHTS,
  parseWeights,
  findMatchingEntities,
  findMatchingThemes,
  getChunksForSessions,
  entitySearch,
  themeEntitySearch,
  decisionFtsSearch,
  toFtsQuery,
  buildSeeds,
  weightedRRF,
  createRetrievalPipeline,
  setChannelErrorSink,
} from '../lib/retrieval-pipeline.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create an in-memory extraction store DB with entities/themes/mentions/decisions tables. */
function createExtractionDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      hierarchy_path TEXT,
      parent_id INTEGER,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL,
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
      private INTEGER DEFAULT 1
    );
    CREATE VIRTUAL TABLE decisions_fts USING fts5(
      decision, rationale, content='decisions', content_rowid='id'
    );
    CREATE TRIGGER decisions_fts_ai AFTER INSERT ON decisions BEGIN
      INSERT INTO decisions_fts(rowid, decision, rationale)
      VALUES (new.id, new.decision, new.rationale);
    END;
    CREATE TRIGGER decisions_fts_ad AFTER DELETE ON decisions BEGIN
      INSERT INTO decisions_fts(decisions_fts, rowid, decision, rationale)
      VALUES ('delete', old.id, old.decision, old.rationale);
    END;
  `);
  return db;
}

/** Create an in-memory knowledge DB with session_chunks table. */
function createKnowledgeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE session_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      snippet TEXT NOT NULL
    );
  `);
  return db;
}

/** Seed extraction DB with test data. */
function seedExtractionDb(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run('NATS', 'technology', now, now, 15);
  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run('SQLite', 'technology', now, now, 10);
  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run('spreading activation', 'concept', now, now, 5);

  db.prepare(`INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run('memory infrastructure', '["infrastructure","memory"]', now, now, 8);
  db.prepare(`INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run('federation', '["networking","federation"]', now, now, 4);

  // Mentions linking entities to sessions
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(1, 'session-001', 0.9, now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(1, 'session-002', 0.7, now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(2, 'session-002', 0.8, now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(3, 'session-003', 0.6, now);

  // Decisions referencing themes
  db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at) VALUES (?, ?, ?, ?, ?)`).run('session-004', 'Use NATS for federation', 'memory infrastructure requires reliable messaging', 0.9, now);
}

/** Seed knowledge DB with test chunks. */
function seedKnowledgeDb(db) {
  const insert = db.prepare(`INSERT INTO session_chunks (session_id, turn_index, role, text, snippet) VALUES (?, ?, ?, ?, ?)`);
  insert.run('session-001', 0, 'user', 'How does NATS work?', 'How does NATS work?');
  insert.run('session-001', 1, 'assistant', 'NATS is a messaging system...', 'NATS is a messaging system...');
  insert.run('session-002', 0, 'user', 'Set up SQLite and NATS', 'Set up SQLite and NATS');
  insert.run('session-002', 1, 'assistant', 'SQLite is configured...', 'SQLite is configured...');
  insert.run('session-003', 0, 'user', 'Explain spreading activation', 'Explain spreading activation');
  insert.run('session-003', 1, 'assistant', 'Spreading activation propagates...', 'Spreading activation propagates...');
  insert.run('session-004', 0, 'user', 'What about memory infrastructure?', 'What about memory infrastructure?');
  insert.run('session-004', 1, 'assistant', 'The memory infrastructure uses...', 'The memory infrastructure uses...');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DEFAULT_CHANNEL_WEIGHTS', () => {
  it('has all 6 channel keys with weight 1', () => {
    assert.deepStrictEqual(DEFAULT_CHANNEL_WEIGHTS, {
      fts: 1, vec: 1, entity: 1, theme: 1, spread: 1, dfts: 1,
    });
    assert.ok(Object.isFrozen(DEFAULT_CHANNEL_WEIGHTS));
  });
});

describe('parseWeights', () => {
  it('parses valid CSV format', () => {
    const result = parseWeights('fts:2,vec:3,entity:1,theme:0.5,spread:1.5');
    assert.strictEqual(result.fts, 2);
    assert.strictEqual(result.vec, 3);
    assert.strictEqual(result.entity, 1);
    assert.strictEqual(result.theme, 0.5);
    assert.strictEqual(result.spread, 1.5);
  });

  it('returns defaults for empty/null input', () => {
    assert.deepStrictEqual(parseWeights(null), { ...DEFAULT_CHANNEL_WEIGHTS });
    assert.deepStrictEqual(parseWeights(''), { ...DEFAULT_CHANNEL_WEIGHTS });
    assert.deepStrictEqual(parseWeights(undefined), { ...DEFAULT_CHANNEL_WEIGHTS });
  });

  it('ignores invalid channel names', () => {
    const result = parseWeights('fts:2,bogus:99');
    assert.strictEqual(result.fts, 2);
    assert.strictEqual(result.vec, 1); // default
    assert.ok(!('bogus' in result));
  });
});

describe('findMatchingEntities', () => {
  let db;
  beforeEach(() => { db = createExtractionDb(); seedExtractionDb(db); });
  afterEach(() => { db.close(); });

  it('finds entities whose names appear in query', () => {
    const results = findMatchingEntities(db, 'How does NATS handle clustering?');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.name === 'NATS'));
  });

  it('returns empty for no matches', () => {
    const results = findMatchingEntities(db, 'completely unrelated topic');
    assert.strictEqual(results.length, 0);
  });
});

describe('findMatchingThemes', () => {
  let db;
  beforeEach(() => { db = createExtractionDb(); seedExtractionDb(db); });
  afterEach(() => { db.close(); });

  it('finds themes whose labels appear in query', () => {
    const results = findMatchingThemes(db, 'Tell me about memory infrastructure design');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.label === 'memory infrastructure'));
  });

  it('returns empty for no matches', () => {
    const results = findMatchingThemes(db, 'completely unrelated');
    assert.strictEqual(results.length, 0);
  });
});

describe('weightedRRF', () => {
  it('combines results with equal weights', () => {
    const set1 = [
      { chunk_id: 1, session_id: 's1', turn_index: 0, role: 'user', score: 0.9, snippet: 'a' },
      { chunk_id: 2, session_id: 's1', turn_index: 1, role: 'assistant', score: 0.8, snippet: 'b' },
    ];
    const set2 = [
      { chunk_id: 2, session_id: 's1', turn_index: 1, role: 'assistant', score: 0.7, snippet: 'b' },
      { chunk_id: 3, session_id: 's2', turn_index: 0, role: 'user', score: 0.6, snippet: 'c' },
    ];

    const fused = weightedRRF([set1, set2], [1, 1]);
    assert.ok(fused.length === 3);
    // chunk_id 2 appears in both sets → highest RRF score
    assert.strictEqual(fused[0].chunk_id, 2);
  });

  it('weights change relative ordering', () => {
    const setA = [
      { chunk_id: 10, session_id: 's1', turn_index: 0, role: 'user', score: 1.0, snippet: 'x' },
    ];
    const setB = [
      { chunk_id: 20, session_id: 's2', turn_index: 0, role: 'user', score: 1.0, snippet: 'y' },
    ];

    // Equal weights → tied (depends on map order, but scores should be equal)
    const equal = weightedRRF([setA, setB], [1, 1]);
    assert.strictEqual(equal.length, 2);
    assert.strictEqual(equal[0].score, equal[1].score);

    // Heavy weight on setB → chunk 20 should score higher
    const weighted = weightedRRF([setA, setB], [1, 5]);
    assert.strictEqual(weighted.length, 2);
    assert.strictEqual(weighted[0].chunk_id, 20);
    assert.ok(weighted[0].score > weighted[1].score);
  });

  it('skips zero-weighted channels', () => {
    const set1 = [
      { chunk_id: 1, session_id: 's1', turn_index: 0, role: 'user', score: 1.0, snippet: 'a' },
    ];
    const set2 = [
      { chunk_id: 2, session_id: 's2', turn_index: 0, role: 'user', score: 1.0, snippet: 'b' },
    ];

    const result = weightedRRF([set1, set2], [1, 0]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].chunk_id, 1);
  });
});

describe('getChunksForSessions (D8: session-relevance ranking)', () => {
  let kDb;
  beforeEach(() => { kDb = createKnowledgeDb(); });
  afterEach(() => { kDb.close(); });

  it('ranks by caller session order, not global turn_index', () => {
    const insert = kDb.prepare(`INSERT INTO session_chunks (session_id, turn_index, role, text, snippet) VALUES (?, ?, ?, ?, ?)`);
    // 'lo' is the LESS-relevant session but has much HIGHER turn indices. Under
    // the old global `ORDER BY turn_index DESC`, lo's chunks would rank first.
    insert.run('hi', 0, 'user', 'hi-a', 'hi-a');
    insert.run('hi', 1, 'assistant', 'hi-b', 'hi-b');
    insert.run('lo', 50, 'user', 'lo-a', 'lo-a');
    insert.run('lo', 51, 'assistant', 'lo-b', 'lo-b');

    // Caller passes 'hi' first (more relevant).
    const results = getChunksForSessions(kDb, ['hi', 'lo'], 10);
    assert.strictEqual(results[0].session_id, 'hi', 'top-relevance session ranks first despite lower turn_index');
    assert.strictEqual(results[1].session_id, 'hi');
    assert.strictEqual(results[2].session_id, 'lo');
    // Within 'hi', recency first (turn 1 before turn 0).
    assert.strictEqual(results[0].turn_index, 1);
    // Scores are positive and monotonic by session rank (never negative).
    assert.ok(results.every(r => r.score > 0), 'scores never negative');
    assert.ok(results[0].score >= results[results.length - 1].score);
  });

  it('respects the limit', () => {
    const insert = kDb.prepare(`INSERT INTO session_chunks (session_id, turn_index, role, text, snippet) VALUES (?, ?, ?, ?, ?)`);
    for (let i = 0; i < 20; i++) insert.run('s1', i, 'user', 't' + i, 't' + i);
    assert.strictEqual(getChunksForSessions(kDb, ['s1'], 5).length, 5);
  });
});

describe('entitySearch', () => {
  let eDb, kDb;
  beforeEach(() => {
    eDb = createExtractionDb();
    kDb = createKnowledgeDb();
    seedExtractionDb(eDb);
    seedKnowledgeDb(kDb);
  });
  afterEach(() => { eDb.close(); kDb.close(); });

  it('returns chunks from sessions where matched entities appear', () => {
    const results = entitySearch(eDb, kDb, 'How does NATS work?', 10);
    assert.ok(results.length > 0);
    // NATS entity is mentioned in session-001 and session-002
    const sessionIds = new Set(results.map(r => r.session_id));
    assert.ok(sessionIds.has('session-001') || sessionIds.has('session-002'));
    // Results have RRF-compatible shape
    assert.ok('chunk_id' in results[0]);
    assert.ok('snippet' in results[0]);
  });

  it('returns empty for unmatched query', () => {
    const results = entitySearch(eDb, kDb, 'quantum physics', 10);
    assert.strictEqual(results.length, 0);
  });
});

describe('themeEntitySearch', () => {
  let eDb, kDb;
  beforeEach(() => {
    eDb = createExtractionDb();
    kDb = createKnowledgeDb();
    seedExtractionDb(eDb);
    seedKnowledgeDb(kDb);
  });
  afterEach(() => { eDb.close(); kDb.close(); });

  it('returns chunks from sessions matching themes via decision text', () => {
    const results = themeEntitySearch(eDb, kDb, 'Tell me about memory infrastructure', 10);
    assert.ok(results.length > 0);
    // "memory infrastructure" theme appears in decisions for session-004
    const sessionIds = new Set(results.map(r => r.session_id));
    assert.ok(sessionIds.has('session-004'));
  });

  it('handles theme labels containing FTS operator characters', () => {
    const now = new Date().toISOString();
    eDb.prepare(`INSERT INTO themes (label, first_seen, last_seen) VALUES (?, ?, ?)`)
      .run('mesh AND "security"', now, now);
    // Label is phrase-quoted into the MATCH — must not throw as FTS syntax
    assert.doesNotThrow(() =>
      themeEntitySearch(eDb, kDb, 'thoughts on mesh AND "security" hardening', 10));
  });
});

describe('toFtsQuery', () => {
  it('quotes terms and ORs them, dropping sub-2-char terms', () => {
    assert.equal(toFtsQuery('use NATS for x federation'), '"use" OR "NATS" OR "for" OR "federation"');
  });

  it('strips embedded quotes so user text cannot inject FTS syntax', () => {
    assert.equal(toFtsQuery('say "hello world"'), '"say" OR "hello" OR "world"');
  });

  it('returns empty string when no usable terms', () => {
    assert.equal(toFtsQuery('a b'), '');
    assert.equal(toFtsQuery('   '), '');
  });
});

describe('decisionFtsSearch (channel 6)', () => {
  let eDb, kDb;
  beforeEach(() => {
    eDb = createExtractionDb();
    kDb = createKnowledgeDb();
    seedExtractionDb(eDb);
    seedKnowledgeDb(kDb);
  });
  afterEach(() => { eDb.close(); kDb.close(); });

  it('surfaces sessions whose decisions match query terms', () => {
    // Query words appear in the session-004 decision text, but "session-004"
    // has no entity mention — channels 3/4 entity paths can't find it.
    const results = decisionFtsSearch(eDb, kDb, 'reliable messaging federation', 10);
    assert.ok(results.length > 0);
    assert.ok(results.every(r => r.session_id === 'session-004'));
  });

  it('returns [] for queries with no usable terms', () => {
    assert.deepEqual(decisionFtsSearch(eDb, kDb, 'a', 10), []);
  });

  it('respects decision privacy when respectPrivacy is set', () => {
    // Seeded decision is private (DEFAULT 1)
    const hidden = decisionFtsSearch(eDb, kDb, 'reliable messaging', 10, { respectPrivacy: true });
    assert.deepEqual(hidden, []);

    eDb.prepare(`UPDATE decisions SET private = 0 WHERE session_id = 'session-004'`).run();
    const visible = decisionFtsSearch(eDb, kDb, 'reliable messaging', 10, { respectPrivacy: true });
    assert.ok(visible.length > 0);
  });

  it('reports (not swallows) a missing decisions_fts table', () => {
    const errors = [];
    setChannelErrorSink((channel, err) => errors.push({ channel, message: err.message }));
    try {
      eDb.exec('DROP TRIGGER decisions_fts_ad; DROP TABLE decisions_fts;');
      const results = decisionFtsSearch(eDb, kDb, 'reliable messaging', 10);
      assert.deepEqual(results, []);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].channel, 'decision-fts');
    } finally {
      setChannelErrorSink((channel, err) => {
        console.error(`[retrieval] channel '${channel}' failed: ${err?.message || err}`);
      });
    }
  });
});

describe('buildSeeds', () => {
  let db;
  beforeEach(() => { db = createExtractionDb(); seedExtractionDb(db); });
  afterEach(() => { db.close(); });

  it('returns slugified entity/theme names as seeds with activation 1.0', () => {
    const seeds = buildSeeds(db, 'How does NATS handle memory infrastructure?');
    // Should find NATS entity and memory infrastructure theme
    assert.ok('nats' in seeds);
    assert.ok('memory-infrastructure' in seeds);
    assert.strictEqual(seeds['nats'], 1.0);
    assert.strictEqual(seeds['memory-infrastructure'], 1.0);
  });

  it('returns empty object for no matches', () => {
    const seeds = buildSeeds(db, 'quantum physics');
    assert.strictEqual(Object.keys(seeds).length, 0);
  });
});

describe('createRetrievalPipeline', () => {
  it('returns an object with a retrieve method', () => {
    const pipeline = createRetrievalPipeline({});
    assert.ok(typeof pipeline.retrieve === 'function');
  });

  it('returns empty results when no databases are provided', async () => {
    const pipeline = createRetrievalPipeline({});
    const results = await pipeline.retrieve('test query');
    assert.deepStrictEqual(results, []);
  });
});

describe('R19 (repair 5.2): channel failures are observable, never silent', () => {
  it('a broken store reports through the sink and still returns []', () => {
    const reports = [];
    setChannelErrorSink((channel, err) => reports.push({ channel, message: err.message }));
    try {
      const broken = new Database(':memory:'); // no tables at all
      const result = findMatchingEntities(broken, 'anything');
      assert.deepStrictEqual(result, [], 'channel still degrades gracefully');
      assert.equal(reports.length, 1, 'the failure must be reported');
      assert.equal(reports[0].channel, 'entity-match');
      assert.match(reports[0].message, /no such table/);
      broken.close();
    } finally {
      setChannelErrorSink((channel, err) => {
        console.error(`[retrieval] channel '${channel}' failed: ${err?.message || err}`);
      });
    }
  });

  it('a throwing sink never breaks the channel', () => {
    setChannelErrorSink(() => { throw new Error('bad sink'); });
    try {
      const broken = new Database(':memory:');
      assert.deepStrictEqual(findMatchingEntities(broken, 'x'), []);
      broken.close();
    } finally {
      setChannelErrorSink((channel, err) => {
        console.error(`[retrieval] channel '${channel}' failed: ${err?.message || err}`);
      });
    }
  });
});
