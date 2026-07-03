/**
 * test/mcp-knowledge-sessions.test.mjs — Session-turn embedding smoke tests
 *
 * Step 2.1 deliverable: proves session turns can be embedded, stored, and searched
 * in the mcp-knowledge database alongside markdown chunks.
 */

import { describe, it, before, after } from 'node:test';
import { test } from 'node:test';
import { embedderSkipReason, embedderCensus } from './helpers/embedder-available.mjs';

const EMBED_SKIP = await embedderSkipReason();
embedderCensus(test, EMBED_SKIP, 'mcp-knowledge-sessions');

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  initDatabase,
  chunkSessionTurns,
  indexSessionTurns,
  searchSessions,
  getStats,
  EMBEDDING_DIM,
  MAX_CHUNK_CHARS,
  SNIPPET_LENGTH,
} from '../lib/mcp-knowledge/core.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SYNTHETIC_TURNS = [
  { role: 'user', content: 'How do I configure NATS JetStream for local event logging?' },
  { role: 'assistant', content: 'You can create a JetStream stream with R=1 replication for local use. Use file-backed storage for durability. The stream subject filter should use a local prefix like `local.>` to keep it separate from shared federation subjects.' },
  { role: 'user', content: 'What about the shared cluster configuration?' },
  { role: 'assistant', content: 'The shared cluster uses R=3 replication across mesh nodes. Configure it with the OPENCLAW_SHARED stream name and subjects for kanban events, shared lessons, concepts, and the context broadcast protocol.' },
  { role: 'user', content: 'Can you explain the content-addressed artifact store?' },
  { role: 'assistant', content: 'The artifact store uses SHA-256 hashing with a sharded directory layout: ~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>. Each artifact has a .meta.json sidecar with ref, size, mime_type, filename, created_at, and encoding. Writes are idempotent — if the hash already exists, the write is skipped.' },
];

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('mcp-knowledge session tables', () => {
  it('initDatabase creates session tables alongside document tables', () => {
    const db = initDatabase(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);

    assert.ok(tables.includes('session_documents'), 'session_documents table exists');
    assert.ok(tables.includes('session_chunks'), 'session_chunks table exists');

    // session_chunk_vectors is a vec0 virtual table
    const vecTables = db.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'session_chunk_vectors'"
    ).all();
    assert.ok(vecTables.length > 0, 'session_chunk_vectors virtual table exists');

    // Index exists
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_chunks_session_id'"
    ).all();
    assert.strictEqual(indexes.length, 1, 'session_chunks index exists');

    db.close();
  });
});

describe('chunkSessionTurns', () => {
  it('produces one chunk per turn with role prefix', () => {
    const chunks = chunkSessionTurns(SYNTHETIC_TURNS);
    assert.ok(chunks.length >= SYNTHETIC_TURNS.length, `at least ${SYNTHETIC_TURNS.length} chunks`);
    assert.strictEqual(chunks[0].role, 'user');
    assert.ok(chunks[0].text.startsWith('[user]'), 'chunk text has role prefix');
    assert.strictEqual(chunks[0].turn_index, 0);
    assert.ok(chunks[0].snippet.length <= SNIPPET_LENGTH, 'snippet respects length limit');
    assert.ok(!chunks[0].snippet.includes('\n'), 'snippet has no newlines');
  });

  it('skips turns with empty content', () => {
    const turns = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '  ' },
      { role: 'assistant', content: 'world' },
    ];
    const chunks = chunkSessionTurns(turns);
    assert.strictEqual(chunks.length, 2, 'empty/whitespace turns skipped');
    assert.strictEqual(chunks[0].turn_index, 0);
    assert.strictEqual(chunks[1].turn_index, 3);
  });
});

describe('indexSessionTurns + searchSessions', { skip: EMBED_SKIP }, () => {
  let db;
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-k-sess-'));
    db = initDatabase(join(tmpDir, 'test.db'));
  });

  it('indexes session turns and creates vectors', async () => {
    const result = await indexSessionTurns(db, 'test-session-001', '/fake/path.jsonl', SYNTHETIC_TURNS);
    assert.strictEqual(result.indexed, true);
    assert.ok(result.chunks >= SYNTHETIC_TURNS.length, 'created at least one chunk per turn');

    const docCount = db.prepare('SELECT COUNT(*) as c FROM session_documents').get().c;
    assert.strictEqual(docCount, 1, 'one session document stored');

    const chunkCount = db.prepare('SELECT COUNT(*) as c FROM session_chunks').get().c;
    const vecCount = db.prepare('SELECT COUNT(*) as c FROM session_chunk_vectors').get().c;
    assert.strictEqual(chunkCount, vecCount, 'chunk count equals vector count');
  });

  it('skips unchanged sessions on re-index (idempotent)', async () => {
    const result = await indexSessionTurns(db, 'test-session-001', '/fake/path.jsonl', SYNTHETIC_TURNS);
    assert.strictEqual(result.indexed, false, 'unchanged session skipped');
    assert.strictEqual(result.chunks, 0);
  });

  it('finds relevant session turns via searchSessions', async () => {
    const results = await searchSessions(db, 'NATS JetStream configuration', 5);
    assert.ok(results.length > 0, 'search returns results');
    assert.strictEqual(results[0].session_id, 'test-session-001');
    assert.ok(typeof results[0].turn_index === 'number', 'result has turn_index');
    assert.ok(typeof results[0].role === 'string', 'result has role');
    assert.ok(typeof results[0].score === 'number', 'result has score');
    assert.ok(results[0].snippet.length > 0, 'result has snippet');
  });

  it('getStats includes session document and chunk counts', () => {
    const stats = getStats(db);
    assert.ok('session_documents' in stats, 'stats has session_documents');
    assert.ok('session_chunks' in stats, 'stats has session_chunks');
    assert.strictEqual(stats.session_documents, 1);
    assert.ok(stats.session_chunks >= SYNTHETIC_TURNS.length);
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });
});
