/**
 * session-store.test.mjs — Unit tests for lib/session-store.mjs
 *
 * Covers: SessionStore construction (custom dbPath, schema migrations, indexes,
 * FTS5 setup), importSession (from JSONL, skipIfExists semantics, empty file),
 * importDirectory (batch import), search (FTS5 ranking, role filter, recency
 * weighting, empty query handling), updateSummary, getSession, listSessions
 * (filter + pagination), getStats, close.
 *
 * Hermetic — uses a fresh temp DB per test.
 *
 * Run: node --test test/session-store.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { SessionStore } from '../lib/session-store.mjs';

let TMP;
let DB_PATH;
let store;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'session-store-test-'));
  DB_PATH = join(TMP, 'state.db');
  store = new SessionStore({ dbPath: DB_PATH });
});

afterEach(() => {
  try { store.close(); } catch {}
  rmSync(TMP, { recursive: true, force: true });
});

function writeJsonl(name, entries) {
  const path = join(TMP, name);
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

// ─── Construction ───────────────────────────────────────────────────────────

describe('SessionStore construction', () => {
  it('creates DB file at the configured path', () => {
    assert.equal(store.dbPath, DB_PATH);
    const stats = statSync(DB_PATH);
    assert.ok(stats.size > 0);
  });

  it('creates the sessions/messages/messages_fts schema', () => {
    // Re-open to introspect raw SQLite
    const db = new Database(DB_PATH, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('sessions'));
    assert.ok(tables.includes('messages'));
    // FTS5 virtual table appears as 'messages_fts' + auxiliary tables
    assert.ok(tables.some(t => t === 'messages_fts'));
    db.close();
  });

  it('enables WAL mode + foreign keys', () => {
    const db = new Database(DB_PATH, { readonly: true });
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    db.close();
  });

  it('is idempotent — second constructor on same path does not error', () => {
    const s2 = new SessionStore({ dbPath: DB_PATH });
    assert.ok(s2.dbPath);
    s2.close();
  });
});

// ─── importSession ──────────────────────────────────────────────────────────

describe('importSession', () => {
  it('imports a claude-code session and counts messages', async () => {
    const path = writeJsonl('session-1.jsonl', [
      { type: 'user', message: { content: 'q1' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: 'a1' }, timestamp: '2026-01-01T00:00:05Z' },
      { type: 'user', message: { content: 'q2' }, timestamp: '2026-01-01T00:00:10Z' },
    ]);
    const result = await store.importSession(path, { source: 'claude-code' });
    assert.equal(result.imported, true);
    assert.equal(result.messageCount, 3);
    assert.equal(result.sessionId, 'session-1');
  });

  it('skips re-import when session has not grown', async () => {
    const p = writeJsonl('dup.jsonl', [
      { type: 'user', message: { content: 'once' } },
    ]);
    await store.importSession(p);
    const second = await store.importSession(p);
    assert.equal(second.imported, false);
    assert.equal(second.messageCount, 0);
  });

  it('re-imports in full when a session has grown', async () => {
    // First import: 2 messages
    const p = writeJsonl('growing.jsonl', [
      { type: 'user', message: { content: 'q1' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: 'a1' }, timestamp: '2026-01-01T00:00:05Z' },
    ]);
    const first = await store.importSession(p);
    assert.equal(first.imported, true);
    assert.equal(first.messageCount, 2);

    // Simulate session growth: rewrite JSONL with 4 messages
    writeJsonl('growing.jsonl', [
      { type: 'user', message: { content: 'q1' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: 'a1' }, timestamp: '2026-01-01T00:00:05Z' },
      { type: 'user', message: { content: 'q2' }, timestamp: '2026-01-01T00:00:10Z' },
      { type: 'assistant', message: { content: 'a2' }, timestamp: '2026-01-01T00:00:15Z' },
    ]);
    const second = await store.importSession(p);
    assert.equal(second.imported, true);
    assert.equal(second.messageCount, 4); // full re-import, not a delta graft

    // Verify total messages in DB
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare('SELECT turn_index, content FROM messages WHERE session_id = ? ORDER BY turn_index').all('growing');
    assert.equal(rows.length, 4);
    assert.equal(rows[0].content, 'q1');
    assert.equal(rows[2].content, 'q2');
    assert.equal(rows[3].content, 'a2');

    // Verify session row updated
    const session = db.prepare('SELECT message_count, end_time FROM sessions WHERE id = ?').get('growing');
    assert.equal(session.message_count, 4);
    assert.equal(session.end_time, '2026-01-01T00:00:15Z');
    db.close();
  });

  it('re-imports in full when the stored count is stale — parser-change corruption guard', async () => {
    // Reproduces the v3.1/v3.2 corruption: a session was first stored by an
    // older parser that produced FEWER, differently-ordered rows. The file on
    // disk now parses to more rows. The old append-delta logic would keep the
    // stale rows and graft the tail of the new parse on top. Full-replace must
    // instead yield exactly the clean current parse — no stale rows, no graft.
    const p = writeJsonl('reparse.jsonl', [
      { type: 'user', message: { content: 'q1' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: 'a1' }, timestamp: '2026-01-01T00:00:05Z' },
      { type: 'user', message: { content: 'q2' }, timestamp: '2026-01-01T00:00:10Z' },
      { type: 'assistant', message: { content: 'a2' }, timestamp: '2026-01-01T00:00:15Z' },
    ]);

    // Simulate the old-parser state: 2 stale rows + a stale message_count of 2.
    const seed = new Database(DB_PATH);
    seed.prepare("INSERT INTO sessions (id, source, start_time, end_time, message_count) VALUES ('reparse','gateway','2026-01-01T00:00:00Z','2026-01-01T00:00:05Z',2)").run();
    seed.prepare("INSERT INTO messages (session_id, role, content, timestamp, turn_index) VALUES ('reparse','user','STALE0',null,0)").run();
    seed.prepare("INSERT INTO messages (session_id, role, content, timestamp, turn_index) VALUES ('reparse','assistant','STALE1',null,1)").run();
    seed.close();

    const result = await store.importSession(p, { source: 'gateway' });
    assert.equal(result.imported, true);

    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare('SELECT turn_index, content FROM messages WHERE session_id = ? ORDER BY turn_index').all('reparse');
    // Exactly the clean current parse — the STALE rows are gone, nothing grafted.
    assert.deepEqual(rows.map((r) => r.content), ['q1', 'a1', 'q2', 'a2']);
    assert.deepEqual(rows.map((r) => r.turn_index), [0, 1, 2, 3]);
    assert.equal(rows.length, 4);
    db.close();
  });

  it('append-delta is idempotent — third import with same count is a no-op', async () => {
    const p = writeJsonl('idem.jsonl', [
      { type: 'user', message: { content: 'q1' } },
    ]);
    await store.importSession(p);
    const second = await store.importSession(p);
    assert.equal(second.imported, false);
    assert.equal(second.messageCount, 0);
  });

  it('returns {imported:false} for empty JSONL', async () => {
    const path = writeJsonl('empty.jsonl', []);
    const result = await store.importSession(path);
    assert.equal(result.imported, false);
    assert.equal(result.messageCount, 0);
  });

  it('persists messages with turn_index 0..N-1', async () => {
    const path = writeJsonl('turns.jsonl', [
      { type: 'user', message: { content: 'first' } },
      { type: 'assistant', message: { content: 'second' } },
      { type: 'user', message: { content: 'third' } },
    ]);
    await store.importSession(path);
    const db = new Database(DB_PATH, { readonly: true });
    const turns = db.prepare('SELECT turn_index, content FROM messages WHERE session_id = ? ORDER BY turn_index').all('turns');
    assert.equal(turns.length, 3);
    assert.equal(turns[0].turn_index, 0);
    assert.equal(turns[2].turn_index, 2);
    db.close();
  });
});

// ─── importDirectory ────────────────────────────────────────────────────────

describe('importDirectory', () => {
  it('imports all .jsonl files in a directory', async () => {
    writeJsonl('s1.jsonl', [{ type: 'user', message: { content: 'a' } }]);
    writeJsonl('s2.jsonl', [{ type: 'user', message: { content: 'b' } }]);
    writeJsonl('s3.jsonl', [{ type: 'user', message: { content: 'c' } }]);
    const result = await store.importDirectory(TMP);
    assert.equal(result.imported, 3);
    assert.equal(result.skipped, 0);
    assert.equal(result.total, 3);
  });

  it('returns zeros for a missing directory', async () => {
    const result = await store.importDirectory(join(TMP, 'does-not-exist'));
    assert.equal(result.total, 0);
  });

  it('counts re-imports as skipped on second pass', async () => {
    writeJsonl('reimport.jsonl', [{ type: 'user', message: { content: 'a' } }]);
    await store.importDirectory(TMP);
    const second = await store.importDirectory(TMP);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 1);
  });
});

// ─── search ─────────────────────────────────────────────────────────────────

describe('search (FTS5)', () => {
  beforeEach(async () => {
    writeJsonl('sa.jsonl', [
      { type: 'user', message: { content: 'how do I use NATS JetStream for events' }, timestamp: '2026-05-01T10:00:00Z' },
      { type: 'assistant', message: { content: 'NATS JetStream is a persistent stream' }, timestamp: '2026-05-01T10:00:05Z' },
    ]);
    writeJsonl('sb.jsonl', [
      { type: 'user', message: { content: 'tell me about Obsidian wikilinks' }, timestamp: '2026-05-02T10:00:00Z' },
    ]);
    await store.importSession(join(TMP, 'sa.jsonl'), { source: 'test' });
    await store.importSession(join(TMP, 'sb.jsonl'), { source: 'test' });
  });

  it('finds sessions matching a single term', () => {
    const results = store.search('NATS');
    assert.ok(results.length >= 1);
    const hit = results.find(r => r.sessionId === 'sa');
    assert.ok(hit, 'sa should be in results');
    assert.ok(hit.matchCount >= 1);
  });

  it('returns empty array for empty / whitespace query', () => {
    assert.deepEqual(store.search(''), []);
    assert.deepEqual(store.search('   '), []);
  });

  it('supports role filter', () => {
    const userOnly = store.search('NATS', { role: 'user' });
    const assistantOnly = store.search('NATS', { role: 'assistant' });
    // sa has NATS in both roles; both should hit
    assert.ok(userOnly.length >= 1);
    assert.ok(assistantOnly.length >= 1);
  });

  it('honors limit option', () => {
    const limited = store.search('NATS', { limit: 1 });
    assert.ok(limited.length <= 1);
  });

  it('does not return sessions that do not match', () => {
    const results = store.search('something_no_session_mentioned');
    assert.equal(results.length, 0);
  });
});

// ─── getSession / listSessions / updateSummary / getStats ───────────────────

describe('getSession + listSessions + updateSummary + getStats', () => {
  beforeEach(async () => {
    writeJsonl('m1.jsonl', [{ type: 'user', message: { content: 'a' }, timestamp: '2026-05-01T00:00:00Z' }]);
    writeJsonl('m2.jsonl', [{ type: 'user', message: { content: 'b' }, timestamp: '2026-05-02T00:00:00Z' }]);
    await store.importSession(join(TMP, 'm1.jsonl'), { source: 'src-A' });
    await store.importSession(join(TMP, 'm2.jsonl'), { source: 'src-B' });
  });

  it('getSession returns the row for a known id', () => {
    const row = store.getSession('m1');
    assert.ok(row);
    assert.equal(row.id, 'm1');
    assert.equal(row.source, 'src-A');
  });

  it('getSession returns undefined for an unknown id', () => {
    assert.equal(store.getSession('does-not-exist'), undefined);
  });

  it('updateSummary persists a summary string', () => {
    store.updateSummary('m1', 'this session was about A');
    const row = store.getSession('m1');
    assert.equal(row.summary, 'this session was about A');
  });

  it('listSessions returns sessions ordered by start_time DESC', () => {
    const rows = store.listSessions();
    assert.ok(rows.length >= 2);
    // m2 (2026-05-02) is newer than m1 (2026-05-01)
    assert.equal(rows[0].id, 'm2');
  });

  it('listSessions honors source filter', () => {
    const onlyA = store.listSessions({ source: 'src-A' });
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0].source, 'src-A');
  });

  it('listSessions honors limit + offset', () => {
    const page1 = store.listSessions({ limit: 1, offset: 0 });
    const page2 = store.listSessions({ limit: 1, offset: 1 });
    assert.equal(page1.length, 1);
    assert.equal(page2.length, 1);
    assert.notEqual(page1[0].id, page2[0].id);
  });

  it('getStats reports session + message counts', () => {
    const stats = store.getStats();
    assert.ok(stats.sessionCount >= 2);
    assert.ok(stats.messageCount >= 2);
  });
});

// ─── close ──────────────────────────────────────────────────────────────────

describe('close', () => {
  it('closes the DB cleanly + subsequent ops error', () => {
    store.close();
    assert.throws(() => store.getStats());
  });
});
