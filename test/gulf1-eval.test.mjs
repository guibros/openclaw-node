import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseQuerySet,
  runEvaluation,
  formatResults,
  aggregateScores,
  checkDatabaseReadiness,
} from '../bin/run-gulf1-eval.mjs';

import {
  initDatabase,
  indexSessionTurns,
} from '../lib/mcp-knowledge/core.mjs';

// ─── parseQuerySet ───────────────────────────────────────────────────────────

describe('parseQuerySet', () => {
  it('parses valid JSON array with required fields', () => {
    const input = JSON.stringify([
      { id: 'q01', query: 'test query', category: 'test', expected_topic: 'test topic' },
      { id: 'q02', query: 'another query', category: 'arch', expected_topic: 'arch topic' },
    ]);
    const result = parseQuerySet(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'q01');
    assert.equal(result[1].query, 'another query');
  });

  it('throws on non-array JSON', () => {
    assert.throws(() => parseQuerySet('{}'), /must be a JSON array/);
  });

  it('throws on missing required field', () => {
    const input = JSON.stringify([{ id: 'q01', query: 'test' }]);
    assert.throws(() => parseQuerySet(input), /missing valid "category"/);
  });
});

// ─── runEvaluation ───────────────────────────────────────────────────────────

describe('runEvaluation', () => {
  let db, tmpDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gulf1-eval-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    await indexSessionTurns(db, 'session-nats', 'test://nats', [
      { role: 'user', content: 'How do I configure NATS JetStream for clustering?' },
      { role: 'assistant', content: 'Configure the cluster block in nats-server.conf with routes.' },
    ]);
    await indexSessionTurns(db, 'session-sqlite', 'test://sqlite', [
      { role: 'user', content: 'How does SQLite FTS5 full-text search work?' },
      { role: 'assistant', content: 'FTS5 uses BM25 ranking and supports external content tables.' },
    ]);
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs queries through all 3 modes and returns structured results', async () => {
    const queries = [
      { id: 'q01', query: 'NATS JetStream clustering', category: 'arch', expected_topic: 'nats' },
    ];
    const results = await runEvaluation(db, queries, 5);
    assert.equal(results.length, 1);
    assert.ok(results[0].results.fts !== undefined, 'fts results present');
    assert.ok(results[0].results.semantic !== undefined, 'semantic results present');
    assert.ok(results[0].results.hybrid !== undefined, 'hybrid results present');
    assert.ok(Array.isArray(results[0].results.fts));
    assert.ok(Array.isArray(results[0].results.semantic));
    assert.ok(Array.isArray(results[0].results.hybrid));
  });

  it('handles empty database gracefully', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'gulf1-empty-'));
    const emptyDb = initDatabase(join(emptyDir, 'empty.db'));
    try {
      const queries = [
        { id: 'q01', query: 'nonexistent topic', category: 'test', expected_topic: 'nothing' },
      ];
      const results = await runEvaluation(emptyDb, queries, 5);
      assert.equal(results.length, 1);
      assert.equal(results[0].results.fts.length, 0);
      assert.equal(results[0].results.semantic.length, 0);
      assert.equal(results[0].results.hybrid.length, 0);
    } finally {
      emptyDb.close();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ─── formatResults ───────────────────────────────────────────────────────────

describe('formatResults', () => {
  it('produces valid markdown with scoring columns', () => {
    const evalResults = [
      {
        query: { id: 'q01', query: 'test', category: 'test', expected_topic: 'topic' },
        results: {
          fts: [{ session_id: 's1', turn_index: 0, role: 'user', score: 0.5, snippet: 'test snippet' }],
          semantic: [],
          hybrid: [{ session_id: 's1', turn_index: 0, role: 'user', score: 0.8, snippet: 'test snippet' }],
        },
      },
    ];
    const output = formatResults(evalResults, { dbPath: '/test.db', limit: 5 });
    assert.ok(output.includes('# Gulf 1 Evaluation Results'), 'has title');
    assert.ok(output.includes('### q01: test'), 'has query header');
    assert.ok(output.includes('**FTS5** results:'), 'has FTS5 section');
    assert.ok(output.includes('**Semantic** results:'), 'has semantic section');
    assert.ok(output.includes('**Hybrid** results:'), 'has hybrid section');
    assert.ok(output.includes('Relevant? (0-2)'), 'has scoring column');
    assert.ok(output.includes('Aggregate Scores'), 'has aggregate section');
    assert.ok(output.includes('(no results)'), 'marks empty results');
  });
});

// ─── checkDatabaseReadiness ──────────────────────────────────────────────────

describe('checkDatabaseReadiness', () => {
  it('reports chunk and vector counts for populated database', async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'gulf1-ready-'));
    const db2 = initDatabase(join(tmpDir2, 'test.db'));
    try {
      await indexSessionTurns(db2, 'session-1', 'test://s1', [
        { role: 'user', content: 'Test content for readiness check' },
      ]);
      const stats = checkDatabaseReadiness(db2);
      assert.ok(stats.chunks > 0, 'chunks should be > 0');
      assert.ok(stats.vectors > 0, 'vectors should be > 0');
      assert.equal(stats.sessions, 1, 'sessions should be 1');
    } finally {
      db2.close();
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
