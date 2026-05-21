/**
 * test/embed-existing-sessions.test.mjs — Migration script tests
 *
 * Step 2.3 deliverable: proves the embed-existing-sessions migration script
 * correctly reads sessions from the session store, indexes them into the
 * knowledge DB, and tracks progress via checkpoint file.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { runMigration } from '../bin/embed-existing-sessions.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal session-store DB with the expected schema.
 */
function createTestSessionDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      parent_session_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT,
      turn_index INTEGER NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  `);

  return db;
}

/**
 * Insert a session with turns into the test session store.
 */
function insertSession(db, sessionId, turns) {
  db.prepare(
    'INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)'
  ).run(sessionId, 'test', new Date().toISOString(), turns.length);

  const insert = db.prepare(
    'INSERT INTO messages (session_id, role, content, turn_index) VALUES (?, ?, ?, ?)'
  );
  for (let i = 0; i < turns.length; i++) {
    insert.run(sessionId, turns[i].role, turns[i].content, i);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_A_TURNS = [
  { role: 'user', content: 'How do I configure NATS JetStream for local event logging?' },
  { role: 'assistant', content: 'You can create a JetStream stream with R=1 replication for local-only persistence.' },
];

const SESSION_B_TURNS = [
  { role: 'user', content: 'Explain the content-addressed artifact store layout.' },
  { role: 'assistant', content: 'The store uses SHA-256 hashing with a sharded directory: sha256/<2>/<2>/<full-hash>.' },
  { role: 'user', content: 'What about the meta sidecar files?' },
  { role: 'assistant', content: 'Each artifact gets a .meta.json sidecar with ref, size, mime_type, and timestamps.' },
];

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('embed-existing-sessions migration', () => {
  let tmpDir;
  let sessionDbPath;
  let knowledgeDbPath;
  let checkpointPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'embed-mig-'));
    sessionDbPath = join(tmpDir, 'state.db');
    knowledgeDbPath = join(tmpDir, 'knowledge.db');
    checkpointPath = join(tmpDir, 'checkpoint.json');
  });

  it('migrates sessions from session store to knowledge DB', async () => {
    // Set up session store with 2 sessions
    const sessDb = createTestSessionDb(sessionDbPath);
    insertSession(sessDb, 'sess-001', SESSION_A_TURNS);
    insertSession(sessDb, 'sess-002', SESSION_B_TURNS);
    sessDb.close();

    const result = await runMigration({ sessionDbPath, knowledgeDbPath, checkpointPath });

    assert.strictEqual(result.processed, 2, 'processed 2 sessions');
    assert.strictEqual(result.total, 2, 'total 2 sessions');
    assert.ok(result.chunks >= 6, 'at least 6 chunks (2 + 4 turns)');

    // Verify knowledge DB has the sessions
    const { initDatabase } = await import('../lib/mcp-knowledge/core.mjs');
    const kDb = initDatabase(knowledgeDbPath);
    const docCount = kDb.prepare('SELECT COUNT(*) as c FROM session_documents').get().c;
    assert.strictEqual(docCount, 2, 'knowledge DB has 2 session documents');

    const chunkCount = kDb.prepare('SELECT COUNT(*) as c FROM session_chunks').get().c;
    assert.ok(chunkCount >= 6, 'knowledge DB has at least 6 chunks');
    kDb.close();
  });

  it('second run is idempotent (skips already-indexed sessions)', async () => {
    const result = await runMigration({ sessionDbPath, knowledgeDbPath, checkpointPath });

    assert.strictEqual(result.processed, 0, 'zero newly processed');
    assert.strictEqual(result.skipped, 2, 'both sessions skipped');
    assert.strictEqual(result.chunks, 0, 'zero new chunks');
  });

  it('writes checkpoint file with progress', () => {
    assert.ok(existsSync(checkpointPath), 'checkpoint file exists');

    const cp = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
    assert.ok(Array.isArray(cp.completed), 'completed is an array');
    assert.strictEqual(cp.completed.length, 2, '2 completed sessions in checkpoint');
    assert.ok(cp.completed.includes('sess-001'), 'sess-001 in checkpoint');
    assert.ok(cp.completed.includes('sess-002'), 'sess-002 in checkpoint');
    assert.ok(cp.totalChunks >= 6, 'totalChunks recorded');
    assert.ok(cp.startedAt, 'startedAt recorded');
    assert.ok(cp.lastUpdated, 'lastUpdated recorded');
  });

  it('handles empty session store gracefully', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'embed-mig-empty-'));
    const emptySessionDb = join(emptyDir, 'empty.db');
    const emptyKnowledgeDb = join(emptyDir, 'knowledge.db');
    const emptyCp = join(emptyDir, 'cp.json');

    // Create empty session store
    const db = createTestSessionDb(emptySessionDb);
    db.close();

    const result = await runMigration({
      sessionDbPath: emptySessionDb,
      knowledgeDbPath: emptyKnowledgeDb,
      checkpointPath: emptyCp,
    });

    assert.strictEqual(result.processed, 0);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.chunks, 0);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('skips sessions with zero messages', async () => {
    const zeroDir = mkdtempSync(join(tmpdir(), 'embed-mig-zero-'));
    const zeroSessionDb = join(zeroDir, 'state.db');
    const zeroKnowledgeDb = join(zeroDir, 'knowledge.db');
    const zeroCp = join(zeroDir, 'cp.json');

    // Create session store with one empty session and one normal session
    const db = createTestSessionDb(zeroSessionDb);
    // Insert session with no messages
    db.prepare(
      'INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)'
    ).run('empty-sess', 'test', new Date().toISOString(), 0);
    // Insert session with messages
    insertSession(db, 'valid-sess', SESSION_A_TURNS);
    db.close();

    const result = await runMigration({
      sessionDbPath: zeroSessionDb,
      knowledgeDbPath: zeroKnowledgeDb,
      checkpointPath: zeroCp,
    });

    assert.strictEqual(result.total, 2, 'total includes empty session');
    assert.strictEqual(result.processed, 1, 'only valid session processed');
    assert.strictEqual(result.skipped, 1, 'empty session skipped');
    assert.ok(result.chunks >= 2, 'chunks from valid session only');

    // Verify checkpoint includes the empty session as completed
    const cp = JSON.parse(readFileSync(zeroCp, 'utf-8'));
    assert.ok(cp.completed.includes('empty-sess'), 'empty session marked completed');
    assert.ok(cp.completed.includes('valid-sess'), 'valid session marked completed');

    rmSync(zeroDir, { recursive: true, force: true });
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });
});
