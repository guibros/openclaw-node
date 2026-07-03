import { describe, it, before, after } from 'node:test';
import { test } from 'node:test';
import { embedderSkipReason, embedderCensus } from './helpers/embedder-available.mjs';

const EMBED_SKIP = await embedderSkipReason();
embedderCensus(test, EMBED_SKIP, 'hybrid-search');

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initDatabase,
  indexSessionTurns,
  searchSessions,
  searchSessionsFts,
  reciprocalRankFusion,
  hybridSearchSessions,
} from '../lib/mcp-knowledge/core.mjs';

// ─── reciprocalRankFusion ────────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  it('merges two ranked lists and boosts items appearing in both', () => {
    const set1 = [
      { chunk_id: 1, session_id: 'a', turn_index: 0, role: 'user', score: 0.9, snippet: 'one' },
      { chunk_id: 2, session_id: 'a', turn_index: 1, role: 'assistant', score: 0.8, snippet: 'two' },
    ];
    const set2 = [
      { chunk_id: 3, session_id: 'b', turn_index: 0, role: 'user', score: 0.95, snippet: 'three' },
      { chunk_id: 1, session_id: 'a', turn_index: 0, role: 'user', score: 0.7, snippet: 'one' },
    ];
    const fused = reciprocalRankFusion([set1, set2]);
    // chunk_id=1 appears in both lists → highest RRF score
    assert.equal(fused[0].chunk_id, 1);
    assert.equal(fused.length, 3); // 3 unique chunks
  });

  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(reciprocalRankFusion([[], []]), []);
    assert.deepStrictEqual(reciprocalRankFusion([]), []);
  });

  it('handles single result set without error', () => {
    const set = [
      { chunk_id: 5, session_id: 'x', turn_index: 0, role: 'user', score: 1.0, snippet: 'test' },
    ];
    const fused = reciprocalRankFusion([set]);
    assert.equal(fused.length, 1);
    assert.equal(fused[0].chunk_id, 5);
    assert.ok(fused[0].score > 0);
  });
});

// ─── searchSessionsFts ──────────────────────────────────────────────────────

describe('searchSessionsFts', { skip: EMBED_SKIP }, () => {
  let db, tmpDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hybrid-fts-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    await indexSessionTurns(db, 'session-1', 'test://s1', [
      { role: 'user', content: 'How do I configure NATS JetStream for clustering?' },
      { role: 'assistant', content: 'You can configure NATS JetStream clustering by setting the cluster block in nats-server.conf.' },
    ]);
    await indexSessionTurns(db, 'session-2', 'test://s2', [
      { role: 'user', content: 'What is the best way to handle SQLite migrations?' },
      { role: 'assistant', content: 'Use ALTER TABLE for additive changes and a version tracking table for complex migrations.' },
    ]);
    await indexSessionTurns(db, 'session-3', 'test://s3', [
      { role: 'user', content: 'Tell me about React hooks and state management patterns.' },
      { role: 'assistant', content: 'React hooks like useState and useEffect are the core primitives for managing component state.' },
    ]);
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds session turns by keyword', () => {
    const results = searchSessionsFts(db, 'NATS JetStream', 5);
    assert.ok(results.length > 0, 'expected at least one FTS5 result');
    assert.ok(results.some(r => r.session_id === 'session-1'));
    assert.ok(results[0].chunk_id !== undefined, 'chunk_id must be present');
    assert.ok(results[0].score > 0, 'BM25 score must be positive');
  });

  it('returns empty for non-matching query', () => {
    const results = searchSessionsFts(db, 'quantum_entanglement_xyz', 5);
    assert.equal(results.length, 0);
  });
});

// ─── hybridSearchSessions ───────────────────────────────────────────────────

describe('hybridSearchSessions', { skip: EMBED_SKIP }, () => {
  let db, tmpDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hybrid-combo-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    await indexSessionTurns(db, 'session-1', 'test://s1', [
      { role: 'user', content: 'How do I configure NATS JetStream for clustering?' },
      { role: 'assistant', content: 'You can configure NATS JetStream clustering by setting the cluster block in nats-server.conf.' },
    ]);
    await indexSessionTurns(db, 'session-2', 'test://s2', [
      { role: 'user', content: 'What is the best way to handle SQLite database migrations?' },
      { role: 'assistant', content: 'Use ALTER TABLE for additive schema changes and a version tracking table.' },
    ]);
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns combined results from both sources', async () => {
    const results = await hybridSearchSessions(db, 'NATS JetStream clustering', 10);
    assert.ok(results.length > 0, 'expected at least one hybrid result');
    assert.ok(results.some(r => r.session_id === 'session-1'));
    assert.ok(results[0].chunk_id !== undefined, 'chunk_id must be present');
  });

  it('ranks items appearing in both FTS5 and semantic higher', async () => {
    const results = await hybridSearchSessions(db, 'configure NATS JetStream', 10);
    assert.ok(results.length > 0);
    // The top result should be from session-1 (strong keyword + semantic match for NATS)
    assert.equal(results[0].session_id, 'session-1');
  });
});
