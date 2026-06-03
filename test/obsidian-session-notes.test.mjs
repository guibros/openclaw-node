import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  querySessionNoteData,
  deriveSessionTopic,
  formatSessionDate,
  buildSessionFrontmatter,
  buildSessionBody,
  generateSessionNote,
} from '../lib/obsidian-session-notes.mjs';

function seedDb(db) {
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
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      embedding BLOB
    );
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      salience REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );
  `);

  const now = '2026-05-30T12:00:00Z';
  db.prepare(`INSERT INTO sessions (id, source, start_time, summary, message_count)
    VALUES ('sess-abc12345', 'claude-code', '2026-05-30T10:00:00Z', 'Refactored the memory daemon', 42)`).run();

  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count)
    VALUES ('NATS JetStream', 'technology', ?, ?, 15)`).run(now, now);
  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count)
    VALUES ('OpenClaw', 'project', ?, ?, 77)`).run(now, now);

  const e1 = db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS JetStream');
  const e2 = db.prepare('SELECT id FROM entities WHERE name = ?').get('OpenClaw');

  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at)
    VALUES (?, 'sess-abc12345', 0.9, ?)`).run(e1.id, now);
  db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at)
    VALUES (?, 'sess-abc12345', 0.8, ?)`).run(e2.id, now);

  db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at)
    VALUES ('sess-abc12345', 'Use local NATS', 'Federation deferred', 0.95, ?)`).run(now);
}

describe('formatSessionDate', () => {
  it('formats ISO date to YYYY-MM-DD', () => {
    assert.equal(formatSessionDate('2026-05-30T10:00:00Z'), '2026-05-30');
  });

  it('falls back to today for null input', () => {
    const result = formatSessionDate(null);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('deriveSessionTopic', () => {
  it('uses session summary when available', () => {
    const topic = deriveSessionTopic({ summary: 'Refactored the memory daemon' }, []);
    assert.equal(topic, 'refactored-the-memory-daemon');
  });

  it('falls back to entity names when no summary', () => {
    const entities = [{ name: 'NATS JetStream' }, { name: 'OpenClaw' }];
    const topic = deriveSessionTopic({ summary: null }, entities);
    assert.equal(topic, 'nats-jetstream-openclaw');
  });

  it('returns generic slug when nothing available', () => {
    assert.equal(deriveSessionTopic({}, []), 'session');
  });

  it('truncates long summaries', () => {
    const long = 'a'.repeat(100);
    const topic = deriveSessionTopic({ summary: long }, []);
    assert.ok(topic.length <= 60);
  });
});

describe('buildSessionFrontmatter', () => {
  it('builds YAML with session metadata and concept wikilinks', () => {
    const session = { id: 'sess-abc12345', source: 'claude-code', start_time: '2026-05-30T10:00:00Z', message_count: 42 };
    const entities = [{ name: 'NATS JetStream' }, { name: 'OpenClaw' }];
    const fm = buildSessionFrontmatter(session, entities);

    assert.ok(fm.startsWith('---'));
    assert.ok(fm.endsWith('---'));
    assert.ok(fm.includes('type: session'));
    assert.ok(fm.includes('date: 2026-05-30'));
    assert.ok(fm.includes('session_id: sess-abc12345'));
    assert.ok(fm.includes('source: claude-code'));
    assert.ok(fm.includes('message_count: 42'));
    assert.ok(fm.includes('[[nats-jetstream]]'));
    assert.ok(fm.includes('[[openclaw]]'));
  });

  it('omits concepts when none', () => {
    const session = { id: 'x', start_time: '2026-01-01T00:00:00Z' };
    const fm = buildSessionFrontmatter(session, []);
    assert.ok(!fm.includes('concepts:'));
  });
});

describe('buildSessionBody', () => {
  it('includes heading, concepts, and decisions', () => {
    const session = { summary: 'Did stuff', start_time: '2026-05-30T10:00:00Z' };
    const entities = [{ name: 'NATS JetStream', type: 'technology' }];
    const decisions = [{ decision: 'Use local NATS' }];
    const body = buildSessionBody(session, entities, decisions);

    assert.ok(body.includes('# Session: 2026-05-30'));
    assert.ok(body.includes('Did stuff'));
    assert.ok(body.includes('## Concepts Touched'));
    assert.ok(body.includes('[[nats-jetstream]]'));
    assert.ok(body.includes('## Decisions'));
    assert.ok(body.includes('Use local NATS'));
  });

  it('works with no entities or decisions', () => {
    const session = { start_time: '2026-05-30T10:00:00Z' };
    const body = buildSessionBody(session, [], []);
    assert.ok(body.includes('# Session: 2026-05-30'));
    assert.ok(!body.includes('## Concepts'));
    assert.ok(!body.includes('## Decisions'));
  });
});

describe('querySessionNoteData', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    seedDb(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns session + entities + decisions for a known session', () => {
    const data = querySessionNoteData(db, 'sess-abc12345');
    assert.ok(data.session);
    assert.equal(data.session.id, 'sess-abc12345');
    assert.equal(data.entities.length, 2);
    assert.equal(data.decisions.length, 1);
    assert.equal(data.decisions[0].decision, 'Use local NATS');
  });

  it('returns null session for unknown session ID', () => {
    const data = querySessionNoteData(db, 'nonexistent');
    assert.equal(data.session, null);
    assert.equal(data.entities.length, 0);
    assert.equal(data.decisions.length, 0);
  });

  it('orders entities by salience descending', () => {
    const data = querySessionNoteData(db, 'sess-abc12345');
    assert.ok(data.entities[0].salience >= data.entities[1].salience);
  });
});

describe('generateSessionNote', () => {
  let db;
  let tmpDir;

  beforeEach(async () => {
    db = new Database(':memory:');
    seedDb(db);
    tmpDir = await mkdtemp(join(tmpdir(), 'session-note-test-'));
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates a session note linking only concepts whose note exists (repair 2.9)', async () => {
    // Only nats-jetstream has a concept note; openclaw must render as text.
    await mkdir(join(tmpDir, 'concepts'), { recursive: true });
    await writeFile(join(tmpDir, 'concepts', 'nats-jetstream.md'), '# NATS JetStream\n');

    const result = await generateSessionNote({
      db,
      sessionId: 'sess-abc12345',
      vaultPath: tmpDir,
    });

    assert.ok(result.generated);
    assert.ok(result.filename.startsWith('2026-05-30-'));
    assert.ok(result.filename.includes('sess-abc'));
    assert.ok(result.filename.endsWith('.md'));

    const content = await readFile(result.filePath, 'utf-8');
    assert.ok(content.includes('type: session'));
    assert.ok(content.includes('session_id: sess-abc12345'));
    assert.ok(content.includes('[[nats-jetstream]]'));
    assert.ok(!content.includes('[[openclaw]]'), 'no note on disk → plain text, not a dangler');
    assert.ok(content.includes('openclaw'));
    assert.ok(content.includes('Use local NATS'));
  });

  it('writes to sessions/ subdirectory', async () => {
    const result = await generateSessionNote({
      db,
      sessionId: 'sess-abc12345',
      vaultPath: tmpDir,
    });

    const files = await readdir(join(tmpDir, 'sessions'));
    assert.ok(files.length > 0);
    assert.ok(files.includes(result.filename));
  });

  it('handles unknown session gracefully', async () => {
    const result = await generateSessionNote({
      db,
      sessionId: 'nonexistent-session',
      vaultPath: tmpDir,
    });

    assert.ok(result.generated);
    const content = await readFile(result.filePath, 'utf-8');
    assert.ok(content.includes('session_id: nonexistent-session'));
  });

  it('returns not-generated when db is missing', async () => {
    const result = await generateSessionNote({ db: null, sessionId: 'x' });
    assert.equal(result.generated, false);
  });
});
