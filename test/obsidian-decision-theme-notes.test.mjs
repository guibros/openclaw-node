import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  decisionNoteFilename,
  buildDecisionNote,
  generateDecisionNotes,
} from '../lib/obsidian-decision-notes.mjs';
import { buildThemeNote, generateThemeNotes } from '../lib/obsidian-theme-notes.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, mention_count INTEGER);
    CREATE TABLE mentions (id INTEGER PRIMARY KEY, entity_id INTEGER, session_id TEXT, source_event_id TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY, session_id TEXT, decision TEXT, rationale TEXT,
      confidence REAL, created_at TEXT, salience REAL);
    CREATE TABLE themes (id INTEGER PRIMARY KEY, label TEXT, hierarchy_path TEXT, parent_id INTEGER,
      mention_count INTEGER, source_event_id TEXT);
  `);
  return db;
}

describe('decision notes (repair 2.9)', () => {
  it('filename is dated, slug-capped, deterministic', () => {
    const d = {
      created_at: '2026-06-02T19:00:00Z',
      decision: 'Use NATS over RabbitMQ for all cross-node messaging because it is dramatically simpler to operate at our scale',
    };
    const f = decisionNoteFilename(d);
    assert.ok(f.startsWith('2026-06-02-use-nats-over-rabbitmq'));
    assert.ok(f.length <= 'XXXX-XX-XX-'.length + 60 + 3);
    assert.equal(f, decisionNoteFilename(d));
  });

  it('note body carries rationale, concept links, session link', () => {
    const note = buildDecisionNote(
      { decision: 'Use NATS', rationale: 'Simpler ops', confidence: 0.9, salience: 0.6, created_at: '2026-06-02T19:00:00Z', session_id: 's1' },
      { concepts: ['NATS JetStream'], sessionNote: '2026-06-02-verify-s1' }
    );
    assert.match(note, /type: decision/);
    assert.match(note, /related: \[\[\[nats-jetstream\|NATS JetStream\]\]\]/);
    assert.match(note, /Simpler ops/);
    assert.match(note, /\[\[sessions\/2026-06-02-verify-s1\]\]/);
  });

  it('generates high-salience decisions, idempotent on rerun', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'vault-dec-'));
    const db = makeDb();
    db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience)
      VALUES ('s1', 'Adopt time-anchored decay', 'Compounding bug', 0.9, '2026-06-02T10:00:00Z', 0.8)`).run();
    db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience)
      VALUES ('s1', 'Low salience decision', 'meh', 0.5, '2026-06-02T10:00:00Z', 0.1)`).run();

    const r1 = await generateDecisionNotes({ db, vaultPath: vault });
    assert.equal(r1.generated, 1);
    assert.match(r1.notes[0], /^2026-06-02-adopt-time-anchored-decay/);

    const r2 = await generateDecisionNotes({ db, vaultPath: vault });
    assert.equal(r2.generated, 0);
    assert.equal(r2.unchanged, 1);

    db.close();
    await rm(vault, { recursive: true, force: true });
  });
});

describe('theme notes (repair 2.9)', () => {
  it('hub note carries alias, members or the honest no-membership line', () => {
    const withMembers = buildThemeNote({ label: 'memory pipeline', mention_count: 9 }, { members: ['NATS JetStream'] });
    assert.match(withMembers, /aliases: \["memory pipeline"\]/);
    assert.match(withMembers, /- \[\[nats-jetstream\|NATS JetStream\]\]/);

    const without = buildThemeNote({ label: 'lonely theme', mention_count: 5 }, {});
    assert.match(without, /No structural concept membership recorded/);
  });

  it('generates above-threshold themes, idempotent on rerun', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'vault-theme-'));
    const db = makeDb();
    db.prepare(`INSERT INTO themes (label, mention_count) VALUES ('big theme', 9)`).run();
    db.prepare(`INSERT INTO themes (label, mention_count) VALUES ('small theme', 1)`).run();

    const r1 = await generateThemeNotes({ db, vaultPath: vault, threshold: 5 });
    assert.deepEqual(r1.notes, ['big-theme.md']);

    const r2 = await generateThemeNotes({ db, vaultPath: vault, threshold: 5 });
    assert.equal(r2.generated, 0);
    assert.equal(r2.unchanged, 1);

    const files = await readdir(join(vault, 'themes'));
    assert.deepEqual(files, ['big-theme.md']);

    db.close();
    await rm(vault, { recursive: true, force: true });
  });
});
