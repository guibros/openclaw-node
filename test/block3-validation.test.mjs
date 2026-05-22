import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readSessions,
  runRegexExtraction,
  runLlmExtraction,
  formatComparison,
  aggregateMetrics,
} from '../bin/run-block3-validation.mjs';

// ─── readSessions ────────────────────────────────────────────────────────────

describe('readSessions', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'block3-val-'));
    dbPath = join(tmpDir, 'state.db');

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT,
        start_time TEXT,
        message_count INTEGER
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        turn_index INTEGER NOT NULL
      );
    `);

    // Insert 3 sessions
    db.prepare('INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)').run(
      'sess-1', 'test', '2026-05-20T10:00:00Z', 4
    );
    db.prepare('INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)').run(
      'sess-2', 'test', '2026-05-21T10:00:00Z', 2
    );
    db.prepare('INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)').run(
      'sess-3', 'test', '2026-05-22T10:00:00Z', 0
    );

    // Insert messages for sess-1
    const insertMsg = db.prepare(
      'INSERT INTO messages (session_id, role, content, turn_index) VALUES (?, ?, ?, ?)'
    );
    insertMsg.run('sess-1', 'user', 'I prefer using NATS for messaging', 0);
    insertMsg.run('sess-1', 'assistant', "I'll configure NATS JetStream for you", 1);
    insertMsg.run('sess-1', 'user', 'The API endpoint is at localhost:4222', 2);
    insertMsg.run('sess-1', 'assistant', 'I found that the cluster config needs R=3', 3);

    // Insert messages for sess-2
    insertMsg.run('sess-2', 'user', "Let's go with SQLite for the session store", 0);
    insertMsg.run('sess-2', 'assistant', 'I noticed the database already exists', 1);

    db.close();
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads sessions ordered by most recent, respecting limit', () => {
    const sessions = readSessions(dbPath, 2);
    assert.equal(sessions.length, 2);
    // Most recent first
    assert.equal(sessions[0].id, 'sess-3');
    assert.equal(sessions[1].id, 'sess-2');
  });

  it('includes messages for each session', () => {
    const sessions = readSessions(dbPath, 3);
    const sess1 = sessions.find(s => s.id === 'sess-1');
    assert.equal(sess1.messages.length, 4);
    assert.equal(sess1.messages[0].role, 'user');
    assert.equal(sess1.messages[0].content, 'I prefer using NATS for messaging');
  });

  it('throws on missing database file', () => {
    assert.throws(() => readSessions('/nonexistent/path.db'), /not found/);
  });
});

// ─── runRegexExtraction ──────────────────────────────────────────────────────

describe('runRegexExtraction', () => {
  it('extracts facts from synthetic messages and returns metrics', () => {
    const messages = [
      { role: 'user', content: 'I prefer using TypeScript over JavaScript for this project' },
      { role: 'assistant', content: "I'll switch to TypeScript compilation for all modules" },
      { role: 'user', content: 'The API endpoint is at https://api.example.com/v2' },
    ];

    const result = runRegexExtraction(messages);

    assert.ok(result.facts.length > 0, 'should extract at least one fact');
    assert.ok(result.memoryContent.includes('# Memory'), 'output includes Memory header');
    assert.equal(typeof result.metrics.factCount, 'number');
    assert.equal(typeof result.metrics.charLength, 'number');
    assert.ok(Array.isArray(result.metrics.categories));
    assert.equal(result.metrics.factCount, result.facts.length);
  });

  it('returns empty results for messages with no extractable patterns', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const result = runRegexExtraction(messages);
    assert.equal(result.metrics.factCount, 0);
    assert.ok(result.memoryContent.includes('# Memory'));
  });
});

// ─── runLlmExtraction ────────────────────────────────────────────────────────

describe('runLlmExtraction', () => {
  it('calls LLM client and returns structured metrics', async () => {
    const mockResult = {
      entities: [
        { name: 'NATS', type: 'technology', salience: 0.9 },
        { name: 'SQLite', type: 'technology', salience: 0.7 },
      ],
      themes: [{ label: 'messaging', hierarchy: ['infrastructure', 'messaging'] }],
      actions: ['implementing'],
      decisions: [{ decision: 'Use NATS', rationale: 'Best fit for mesh', confidence: 0.85 }],
      friction_signals: [],
      relationships: [{ source: 'NATS', target: 'SQLite', type: 'depends_on' }],
    };

    const mockClient = {
      generate: async () => ({ content: JSON.stringify(mockResult) }),
      healthCheck: async () => ({ ok: true }),
    };

    const messages = [
      { role: 'user', content: 'Configure NATS for the mesh' },
      { role: 'assistant', content: 'Setting up JetStream with R=1 replication' },
    ];

    const result = await runLlmExtraction(mockClient, messages, 'test-session');

    assert.equal(result.metrics.entityCount, 2);
    assert.equal(result.metrics.themeCount, 1);
    assert.equal(result.metrics.decisionCount, 1);
    assert.equal(result.metrics.frictionCount, 0);
    assert.equal(result.metrics.relationshipCount, 1);
    assert.ok(result.memoryContent.includes('NATS'), 'MEMORY.md includes extracted entity');
    assert.ok(result.memoryContent.length > 0);
  });
});

// ─── aggregateMetrics ────────────────────────────────────────────────────────

describe('aggregateMetrics', () => {
  it('computes correct averages across multiple sessions', () => {
    const results = [
      {
        sessionId: 's1',
        regex: { metrics: { factCount: 4, charLength: 200, categories: ['preference', 'decision'] } },
        llm: { metrics: { entityCount: 3, themeCount: 2, decisionCount: 1, frictionCount: 0, relationshipCount: 1, actionCount: 1, charLength: 300 } },
      },
      {
        sessionId: 's2',
        regex: { metrics: { factCount: 6, charLength: 400, categories: ['environment', 'reference'] } },
        llm: { metrics: { entityCount: 5, themeCount: 3, decisionCount: 2, frictionCount: 1, relationshipCount: 0, actionCount: 2, charLength: 500 } },
      },
    ];

    const agg = aggregateMetrics(results);

    assert.equal(agg.sessionCount, 2);
    assert.equal(agg.regex.totalFacts, 10);
    assert.equal(agg.regex.avgFacts, 5);
    assert.equal(agg.regex.avgChars, 300);
    assert.ok(agg.regex.allCategories.includes('preference'));
    assert.ok(agg.regex.allCategories.includes('environment'));

    assert.equal(agg.llm.totalEntities, 8);
    assert.equal(agg.llm.avgEntities, 4);
    assert.equal(agg.llm.avgChars, 400);
    assert.equal(agg.llm.sessionsProcessed, 2);
  });

  it('handles results with no LLM data', () => {
    const results = [
      {
        sessionId: 's1',
        regex: { metrics: { factCount: 3, charLength: 150, categories: ['decision'] } },
        llm: null,
      },
    ];

    const agg = aggregateMetrics(results);

    assert.equal(agg.sessionCount, 1);
    assert.equal(agg.regex.totalFacts, 3);
    assert.equal(agg.llm, null);
  });
});

// ─── formatComparison ────────────────────────────────────────────────────────

describe('formatComparison', () => {
  it('produces valid markdown with all sections', () => {
    const results = [
      {
        sessionId: 'sess-abc',
        startTime: '2026-05-22T10:00:00Z',
        messageCount: 6,
        regex: {
          facts: [{ fact: 'test', category: 'preference', speaker: 'user' }],
          memoryContent: '# Memory\n\n## Recent\n- test\n',
          metrics: { factCount: 1, addedCount: 1, mergedCount: 0, skippedCount: 0, charLength: 30, categories: ['preference'] },
        },
        llm: {
          result: { entities: [{ name: 'Test', type: 'concept', salience: 0.8 }], themes: [], actions: [], decisions: [], friction_signals: [], relationships: [] },
          memoryContent: '# Memory\n\n## Active Entities\n- Test (concept, mentioned 1x)\n',
          metrics: { entityCount: 1, themeCount: 0, decisionCount: 0, frictionCount: 0, relationshipCount: 0, actionCount: 0, charLength: 55 },
        },
      },
    ];

    const md = formatComparison(results);

    assert.ok(md.includes('# Block 3 Validation'), 'has main heading');
    assert.ok(md.includes('## Aggregate Metrics'), 'has aggregate section');
    assert.ok(md.includes('## Per-Session Comparison'), 'has per-session section');
    assert.ok(md.includes('sess-abc'), 'includes session ID');
    assert.ok(md.includes('## Go/No-Go Decision Checklist'), 'has decision checklist');
    assert.ok(md.includes('#### Regex Extraction'), 'has regex section');
    assert.ok(md.includes('#### LLM Extraction'), 'has LLM section');
    assert.ok(md.includes('#### Manual Scoring'), 'has scoring section');
    assert.ok(md.includes('Semantic coherence'), 'has scoring criteria');
  });
});
