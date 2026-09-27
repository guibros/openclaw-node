/**
 * test/memory-archive.test.mjs — consolidation archives instead of destroying
 * (repair 2026-09-26). Every test runs on its own temp state.db built by the
 * real extraction store, so the FTS triggers, FKs and migrations are the
 * production ones.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { RESURRECTED_SALIENCE } from '../lib/memory-archive.mjs';
import { initConsolidationTables, decayWeights, pruneStale, summarizeRemovals } from '../lib/consolidation.mjs';
import { backupStore } from '../lib/sqlite-store.mjs';
import { runConsolidationCycle } from '../bin/consolidate.mjs';
import { MemoryEventSchema } from '../packages/event-schemas/dist/index.js';

const DAY = 86_400_000;
const NOW = new Date('2026-09-26T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const base = { themes: [], actions: [], friction_signals: [], relationships: [] };
const ent = (name, extra = {}) => ({ name, type: 'technology', salience: 0.6, ...extra });
const dec = (decision, extra = {}) => ({ decision, rationale: 'because', confidence: 0.9, ...extra });

let tmpDir, store, db;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-archive-'));
  store = createExtractionStore({ dbPath: path.join(tmpDir, 'state.db') });
  db = store.db;
  initConsolidationTables(db);
});
afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const count = (sql, ...args) => db.prepare(sql).get(...args).n;

describe('decisions are archived, not deleted', () => {
  function decayedOutDecision() {
    store.storeExtractionResult('s-dec', { ...base, entities: [], decisions: [dec('Use NATS JetStream for the event log')] });
    const { id } = db.prepare('SELECT id FROM decisions').get();
    db.prepare('UPDATE decisions SET salience = 0.01, last_recalled = ?, private = 0 WHERE id = ?')
      .run('2026-07-01T00:00:00.000Z', id);
    return id;
  }

  it('a decision below the drop threshold moves to decisions_archived with every column', () => {
    const id = decayedOutDecision();
    const before = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);

    const r = pruneStale(db, { now: NOW });

    assert.equal(r.archivedDecisions, 1);
    assert.equal(count('SELECT COUNT(*) n FROM decisions'), 0, 'out of the live table');
    const archived = db.prepare('SELECT * FROM decisions_archived WHERE id = ?').get(id);
    assert.ok(archived, 'kept in the archive under its id');
    for (const [col, value] of Object.entries(before)) {
      assert.deepEqual(archived[col], value, `column ${col} preserved`);
    }
    assert.equal(archived.archived_at, NOW.toISOString());
    assert.deepEqual(r.removed.map((x) => [x.action, x.kind, x.id]), [['archived', 'decision', id]]);
    assert.equal(count(`SELECT COUNT(*) n FROM decisions_fts WHERE decisions_fts MATCH 'jetstream'`), 0,
      'retrieval stops seeing it');
  });

  it('a re-mention of an archived decision resurrects it under its original id', () => {
    const id = decayedOutDecision();
    pruneStale(db, { now: NOW });

    const stats = store.storeExtractionResult('s-dec', {
      ...base, entities: [],
      decisions: [dec('Use NATS JetStream for the event log', { rationale: 'restated', confidence: 0.95 })],
    });

    assert.equal(stats.decisions_resurrected, 1);
    assert.equal(stats.decisions_new, 0);
    const back = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    assert.ok(back, 'same id');
    assert.equal(back.rationale, 'restated', 'registry ops apply: rationale replaces');
    assert.equal(back.confidence, 0.95);
    assert.equal(back.salience, RESURRECTED_SALIENCE);
    assert.equal(back.last_recalled, '2026-07-01T00:00:00.000Z', 'recall history kept');
    assert.equal(back.private, 0, 'store-owned state kept');
    assert.equal(count('SELECT COUNT(*) n FROM decisions_archived'), 0, 'archive row consumed');
    assert.equal(count(`SELECT COUNT(*) n FROM decisions_fts WHERE decisions_fts MATCH 'jetstream'`), 1);
  });

  it('a decision re-stated after a recall is not decayed from the recall', () => {
    store.storeExtractionResult('s-dec', { ...base, entities: [], decisions: [dec('Keep the R=3 quorum')] });
    db.prepare('UPDATE decisions SET salience = 0.2, last_recalled = ?, created_at = ?, last_decayed_at = ?')
      .run(iso(NOW - 60 * DAY), iso(NOW - 3_600_000), iso(NOW - 60 * DAY));

    decayWeights(db, { now: NOW });
    pruneStale(db, { now: NOW });

    const row = db.prepare('SELECT salience FROM decisions').get();
    assert.ok(row, 'still live');
    assert.ok(row.salience > 0.19, `one idle hour of decay, not sixty days (got ${row.salience})`);
  });
});

describe('entity decay anchors on the latest of recall and sighting', () => {
  it('an entity recalled long ago but mentioned today is not archived (the 13-session reproduction)', () => {
    for (let i = 0; i < 13; i++) {
      store.storeExtractionResult(`s-${i}`, { ...base, entities: [ent('Mission Control')], decisions: [] });
    }
    const { id } = db.prepare(`SELECT id FROM entities WHERE canonical_name = 'mission control'`).get();
    db.prepare('UPDATE entities SET salience = 0.2, last_recalled = ?, last_seen = ?, last_decayed_at = ? WHERE id = ?')
      .run(iso(NOW - 60 * DAY), iso(NOW - 3_600_000), iso(NOW - 60 * DAY), id);

    const r = decayWeights(db, { now: NOW });

    assert.equal(r.archivedEntities, 0);
    const row = db.prepare('SELECT salience, mention_count FROM entities WHERE id = ?').get(id);
    assert.ok(row.salience > 0.19, `one idle hour of decay, not sixty days (got ${row.salience})`);
    assert.equal(row.mention_count, 13);
    assert.equal(count('SELECT COUNT(*) n FROM mentions WHERE entity_id = ?', id), 13);
  });

  it('with no sighting after the recall, the recall still anchors decay', () => {
    store.storeExtractionResult('s-1', { ...base, entities: [ent('Kafka')], decisions: [] });
    db.prepare('UPDATE entities SET salience = 0.2, last_recalled = ?, last_seen = ?, last_decayed_at = NULL')
      .run(iso(NOW - 60 * DAY), iso(NOW - 90 * DAY));

    const r = decayWeights(db, { now: NOW });

    assert.equal(r.archivedEntities, 1, '0.2 · 0.5^(60/14) ≈ 0.010 is below the floor');
    assert.deepEqual(r.removed.map((x) => [x.action, x.kind, x.label]), [['archived', 'entity', 'Kafka']]);
  });
});

describe('archival keeps provenance; resurrection restores it', () => {
  function archivePostgres() {
    store.storeExtractionResult('s1', { ...base, entities: [ent('PostgreSQL', { aliases: ['postgres', 'pg'] })], decisions: [] });
    store.storeExtractionResult('s2', { ...base, entities: [ent('PostgreSQL')], decisions: [] });
    const before = db.prepare(`SELECT * FROM entities WHERE canonical_name = 'postgresql'`).get();
    db.prepare('UPDATE entities SET private = 0, reinforcement_count = 3, embedding = ? WHERE id = ?')
      .run(Buffer.from([1, 2, 3]), before.id);
    db.prepare('UPDATE entities SET salience = 0.06, last_seen = ?, last_recalled = NULL, last_decayed_at = NULL WHERE id = ?')
      .run(iso(NOW - 30 * DAY), before.id);
    const r = decayWeights(db, { now: NOW });
    assert.equal(r.archivedEntities, 1);
    return before;
  }

  it('an archived entity takes its mentions, aliases and every column with it', () => {
    const before = archivePostgres();

    assert.equal(count('SELECT COUNT(*) n FROM entities'), 0);
    assert.equal(count('SELECT COUNT(*) n FROM mentions'), 0);
    assert.equal(count('SELECT COUNT(*) n FROM entity_aliases'), 0);
    const archived = db.prepare('SELECT * FROM entities_archived WHERE id = ?').get(before.id);
    assert.equal(archived.private, 0);
    assert.equal(archived.reinforcement_count, 3);
    assert.deepEqual(archived.embedding, Buffer.from([1, 2, 3]));
    assert.equal(archived.first_seen, before.first_seen);
    assert.deepEqual(
      db.prepare('SELECT session_id FROM mentions_archived WHERE entity_id = ? ORDER BY session_id').all(before.id).map((m) => m.session_id),
      ['s1', 's2']
    );
    assert.deepEqual(
      db.prepare('SELECT alias FROM entity_aliases_archived WHERE entity_id = ? ORDER BY alias').all(before.id).map((a) => a.alias),
      ['pg', 'postgres']
    );
  });

  it('a re-mention through an archived alias brings the same entity back, history intact', () => {
    const before = archivePostgres();

    const stats = store.storeExtractionResult('s3', { ...base, entities: [ent('Postgres')], decisions: [] });

    assert.equal(stats.entities_resurrected, 1);
    assert.equal(stats.entities_new, 0);
    assert.equal(count('SELECT COUNT(*) n FROM entities'), 1, 'no fresh entity minted');
    const back = db.prepare('SELECT * FROM entities WHERE id = ?').get(before.id);
    assert.ok(back, 'original id');
    assert.equal(back.name, 'PostgreSQL', 'the display name is immutable');
    assert.equal(back.canonical_name, 'postgresql');
    assert.equal(back.first_seen, before.first_seen);
    assert.equal(back.salience, RESURRECTED_SALIENCE);
    assert.equal(back.private, 0);
    assert.equal(back.reinforcement_count, 3);
    assert.deepEqual(back.embedding, Buffer.from([1, 2, 3]));
    assert.equal(back.mention_count, 3, 's1 + s2 restored, s3 new');
    assert.deepEqual(store.getEntityAliases(before.id).sort(), ['pg', 'postgres']);
    for (const t of ['entities_archived', 'mentions_archived', 'entity_aliases_archived']) {
      assert.equal(count(`SELECT COUNT(*) n FROM ${t}`), 0, `${t} consumed`);
    }
  });

  it('an alias another entity claimed meanwhile stays with that entity', () => {
    const before = archivePostgres();
    store.storeExtractionResult('s4', { ...base, entities: [ent('PgBouncer', { aliases: ['pg'] })], decisions: [] });
    const bouncer = db.prepare(`SELECT id FROM entities WHERE canonical_name = 'pgbouncer'`).get().id;

    store.storeExtractionResult('s5', { ...base, entities: [ent('PostgreSQL')], decisions: [] });

    assert.deepEqual(store.getEntityAliases(before.id), ['postgres']);
    assert.deepEqual(store.getEntityAliases(bouncer), ['pg']);
  });

  it('when the archived identity is live again under another row, the alias resolves to the live row', () => {
    const before = archivePostgres();
    // a pre-fix re-extraction re-created the entity while the old row sat in the archive
    db.prepare(`INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
                VALUES ('PostgreSQL', 'technology', 'postgresql', ?, ?, 1)`).run(NOW.toISOString(), NOW.toISOString());
    const live = db.prepare(`SELECT id FROM entities WHERE canonical_name = 'postgresql'`).get().id;

    const stats = store.storeExtractionResult('s6', { ...base, entities: [ent('Postgres')], decisions: [] });

    assert.equal(stats.entities_resurrected, 0);
    assert.equal(stats.aliases_resolved, 1);
    assert.equal(count('SELECT COUNT(*) n FROM entities'), 1);
    assert.deepEqual(store.getEntityAliases(live), ['Postgres']);
    assert.ok(db.prepare('SELECT 1 FROM entities_archived WHERE id = ?').get(before.id), 'the archive keeps its copy');
  });
});

describe('schema v7 migration', () => {
  // A database as the v6 code left it: v7's tables absent, the pre-v7
  // 13-column entities_archived (plus the restored_at column the repair 1.7
  // restore added on the live node), data in every table. `consolidated`:
  // consolidation has run on it, as on the node, so entities carries
  // reinforcement_count NOT NULL DEFAULT 0, which pre-v7 archive rows lack.
  function makeV6(dbPath, { consolidated = false } = {}) {
    const s = createExtractionStore({ dbPath });
    s.storeExtractionResult('s1', {
      ...base,
      entities: [ent('NATS', { aliases: ['nats-server'] })],
      decisions: [dec('Keep the R=3 quorum')],
    });
    if (consolidated) initConsolidationTables(s.db);
    s.close();
    const d = new Database(dbPath);
    d.exec(`
      DROP TABLE decisions_archived;
      DROP TABLE mentions_archived;
      DROP TABLE entity_aliases_archived;
      DROP TABLE entities_archived;
      CREATE TABLE entities_archived (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, canonical_name TEXT,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 1,
        salience REAL DEFAULT 0.5, last_recalled TEXT, archived_at TEXT NOT NULL,
        source_type TEXT DEFAULT 'local', source_node TEXT, source_event_id TEXT, restored_at TEXT
      );
      INSERT INTO entities_archived (id, name, type, canonical_name, first_seen, last_seen, mention_count, salience, archived_at)
        VALUES (900, 'Legacy Thing', 'concept', 'legacy thing', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 7, 0.01, '2026-06-02T00:00:00.000Z'),
               (901, 'Other Legacy', 'concept', 'other legacy', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 3, 0.01, '2026-06-02T00:00:00.000Z');
      PRAGMA user_version = 6;
    `);
    d.close();
  }

  function snapshot(d) {
    const tables = d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'decisions_fts%' ORDER BY name`).all();
    return {
      version: d.pragma('user_version', { simple: true }),
      schema: d.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
      rows: Object.fromEntries(tables.map(({ name }) => [name, d.prepare(`SELECT * FROM "${name}"`).all()])),
    };
  }

  it('upgrades a v6 database in place, keeps every row, and is idempotent', () => {
    const dbPath = path.join(tmpDir, 'v6.db');
    makeV6(dbPath);

    const s1 = createExtractionStore({ dbPath });
    assert.equal(s1.db.pragma('user_version', { simple: true }), 7);
    for (const t of ['decisions_archived', 'mentions_archived', 'entity_aliases_archived']) {
      assert.ok(s1.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), `${t} created`);
    }
    const archivedCols = s1.db.pragma('table_info(entities_archived)').map((c) => c.name);
    for (const c of ['private', 'embedding', 'restored_at']) assert.ok(archivedCols.includes(c), `entities_archived has ${c}`);
    const legacy = s1.db.prepare('SELECT * FROM entities_archived WHERE id = 900').get();
    assert.equal(legacy.name, 'Legacy Thing');
    assert.equal(legacy.mention_count, 7);
    assert.equal(s1.db.prepare('SELECT COUNT(*) n FROM entities').get().n, 1);
    assert.equal(s1.db.prepare('SELECT COUNT(*) n FROM entity_aliases').get().n, 1);
    assert.equal(s1.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 1);
    const first = snapshot(s1.db);
    s1.close();

    const s2 = createExtractionStore({ dbPath });
    assert.deepEqual(snapshot(s2.db), first, 'a second open changes nothing');
    initConsolidationTables(s2.db);
    const afterConsolidation = snapshot(s2.db);
    initConsolidationTables(s2.db);
    assert.deepEqual(snapshot(s2.db), afterConsolidation, 'consolidation init is idempotent too');
    s2.close();
  });

  it('a pre-v7 archive row (no mention history) still resurrects by name', () => {
    const dbPath = path.join(tmpDir, 'v6.db');
    makeV6(dbPath);
    const s = createExtractionStore({ dbPath });
    try {
      const stats = s.storeExtractionResult('s9', { ...base, entities: [ent('legacy_thing')], decisions: [] });
      assert.equal(stats.entities_resurrected, 1);
      const row = s.db.prepare('SELECT * FROM entities WHERE id = 900').get();
      assert.equal(row.name, 'Legacy Thing');
      assert.equal(row.canonical_name, 'legacy thing');
      assert.equal(row.first_seen, '2026-05-01T00:00:00.000Z');
      assert.equal(row.private, 1, 'default-private (F-C15), not the NULL v7 mirroring gave the archive row');
    } finally {
      s.close();
    }
  });

  it('a pre-v7 archive row resurrects on a consolidated store without failing its extraction (review 2026-09-27)', () => {
    const dbPath = path.join(tmpDir, 'v6.db');
    makeV6(dbPath, { consolidated: true });
    const s = createExtractionStore({ dbPath });
    const mentionCount = (id) => s.db.prepare('SELECT mention_count FROM entities WHERE id = ?').get(id).mention_count;
    try {
      const legacy = s.db.prepare('SELECT * FROM entities_archived WHERE id = 900').get();
      assert.equal(legacy.reinforcement_count, null, 'precondition: v7 mirroring left the legacy row NULL');
      assert.equal(legacy.private, null, 'precondition');
      assert.equal(s.db.pragma('table_info(entities)').find((c) => c.name === 'reinforcement_count').notnull, 1, 'precondition');

      const decision = 'Resurrect pre-v7 rows without losing the flush';
      const stats = s.storeExtractionResult('s9', {
        ...base, entities: [ent('NATS'), ent('legacy_thing')], decisions: [dec(decision)],
      });

      assert.equal(stats.entities_resurrected, 1);
      assert.equal(stats.decisions_new, 1);
      const row = s.db.prepare('SELECT * FROM entities WHERE id = 900').get();
      assert.ok(row, 'restored under its archived id');
      assert.equal(row.reinforcement_count, 0, 'the column default, not the archive NULL');
      assert.equal(row.private, 1, 'default-private (F-C15), not NULL');
      assert.equal(row.mention_count, 7, 'max(archived 7, recomputed 1)');
      assert.equal(s.db.prepare('SELECT COUNT(*) n FROM decisions WHERE decision = ?').get(decision).n, 1,
        'the decision in the same extraction is stored');
      assert.ok(s.db.prepare('SELECT 1 FROM entities_archived WHERE id = 901').get(), 'the other legacy row stays archived');

      s.storeExtractionResult('s9', { ...base, entities: [ent('Legacy Thing')], decisions: [] });
      assert.equal(mentionCount(900), 7, 'a later flush does not recompute the history away');
      for (let i = 10; i < 17; i++) s.storeExtractionResult(`s${i}`, { ...base, entities: [ent('Legacy Thing')], decisions: [] });
      assert.equal(mentionCount(900), 8, 'eight sessions now outnumber the archived seven');
    } finally {
      s.close();
    }
  });

  it('backs up a pre-v7 store before migrating it (review 2026-09-27)', () => {
    const dbPath = path.join(tmpDir, 'v6.db');
    makeV6(dbPath);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'backups')), 'a new store (version 0) takes none');

    createExtractionStore({ dbPath }).close();

    const dir = path.join(tmpDir, 'backups', 'migration');
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^v6\.db-v6-\d{8}T\d{9}Z\.db$/, 'named for the database file and the version it held');
    assert.equal(fs.statSync(path.join(dir, files[0])).mode & 0o777, 0o600);
    const copy = new Database(path.join(dir, files[0]), { readonly: true });
    try {
      assert.equal(copy.pragma('user_version', { simple: true }), 6, 'the store as it was before the migration');
      assert.equal(copy.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'decisions_archived'`).get().n, 0);
      assert.equal(copy.prepare('SELECT mention_count FROM entities_archived WHERE id = 900').get().mention_count, 7);
    } finally {
      copy.close();
    }
    createExtractionStore({ dbPath }).close();
    assert.equal(fs.readdirSync(dir).length, 1, 'a store already at v7 takes no other');
  });

  it('no backup, no migration: the store stays at its version', () => {
    const dbPath = path.join(tmpDir, 'v6.db');
    makeV6(dbPath);
    const blocker = path.join(tmpDir, 'backups');
    fs.writeFileSync(blocker, '');

    assert.throws(() => createExtractionStore({ dbPath }), /not migrating .*v6\.db from schema v6: no backup/);
    const raw = new Database(dbPath, { readonly: true });
    try {
      assert.equal(raw.pragma('user_version', { simple: true }), 6);
      assert.equal(raw.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'decisions_archived'`).get().n, 0);
    } finally {
      raw.close();
    }

    fs.rmSync(blocker);
    const s = createExtractionStore({ dbPath });
    assert.equal(s.db.pragma('user_version', { simple: true }), 7, 'migrates once a backup can be taken');
    s.close();
  });
});

describe('idle-theme deletion requires a backup', () => {
  const addTheme = (label, lastSeen) => db.prepare(
    `INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count) VALUES (?, '[]', ?, ?, 1)`
  ).run(label, lastSeen, lastSeen);

  it('takes a VACUUM INTO backup first, reuses it within a day, and rotates', () => {
    const backupDir = path.join(tmpDir, 'backups');
    addTheme('stale-1', iso(NOW - 200 * DAY));
    addTheme('fresh', iso(NOW - 5 * DAY));

    const r1 = pruneStale(db, { now: NOW, backupDir, backupKeep: 2 });
    assert.equal(r1.prunedThemes, 1);
    assert.equal(r1.backup.reused, false);
    assert.equal(fs.statSync(r1.backup.path).mode & 0o777, 0o600);
    const snap = new Database(r1.backup.path, { readonly: true });
    assert.deepEqual(snap.prepare('SELECT label FROM themes ORDER BY label').all().map((t) => t.label), ['fresh', 'stale-1'],
      'the backup holds the theme before it is deleted');
    snap.close();
    assert.deepEqual(db.prepare('SELECT label FROM themes').all().map((t) => t.label), ['fresh']);

    addTheme('stale-2', iso(NOW - 200 * DAY));
    const r2 = pruneStale(db, { now: new Date(NOW.getTime() + 3_600_000), backupDir, backupKeep: 2 });
    assert.equal(r2.backup.reused, true, 'an hour-old backup already holds a 200-day-idle theme');
    assert.equal(r2.backup.path, r1.backup.path);

    for (const [i, days] of [[3, 2], [4, 4]]) {
      addTheme(`stale-${i}`, iso(NOW - 200 * DAY));
      const r = pruneStale(db, { now: new Date(NOW.getTime() + days * DAY), backupDir, backupKeep: 2 });
      assert.equal(r.backup.reused, false);
    }
    const kept = fs.readdirSync(backupDir).sort();
    assert.equal(kept.length, 2, `rotated to the newest two: ${kept}`);
    assert.ok(!kept.includes(path.basename(r1.backup.path)), 'the oldest snapshot rotated out');
  });

  it('keeps the themes and the decayed-out decisions when no backup can be taken', () => {
    addTheme('stale', iso(NOW - 200 * DAY));
    store.storeExtractionResult('s', { ...base, entities: [], decisions: [dec('Decayed out')] });
    db.prepare('UPDATE decisions SET salience = 0.01').run();
    const blocked = path.join(tmpDir, 'a-file');
    fs.writeFileSync(blocked, '');

    const r = pruneStale(db, { now: NOW, backupDir: path.join(blocked, 'backups') });

    assert.equal(r.prunedThemes, 0);
    assert.match(r.themesSkipped, /no backup/);
    assert.equal(count('SELECT COUNT(*) n FROM themes'), 1);
    // review 2026-09-27: archival waits for a backup too (fail closed)
    assert.equal(r.archivedDecisions, 0);
    assert.match(r.decisionsSkipped, /no backup/);
    assert.equal(count('SELECT COUNT(*) n FROM decisions'), 1);
    assert.equal(count('SELECT COUNT(*) n FROM decisions_archived'), 0);
  });

  it('defaults the backup directory to backups/consolidation beside the database', () => {
    addTheme('stale', iso(NOW - 200 * DAY));
    const saved = process.env.CONSOLIDATE_BACKUP_DIR;
    delete process.env.CONSOLIDATE_BACKUP_DIR;
    try {
      const r = pruneStale(db, { now: NOW });
      assert.equal(path.dirname(r.backup.path), path.join(tmpDir, 'backups', 'consolidation'));
      assert.equal(fs.statSync(path.dirname(r.backup.path)).mode & 0o777, 0o700);
    } finally {
      if (saved !== undefined) process.env.CONSOLIDATE_BACKUP_DIR = saved;
    }
  });
});

describe('archival moves wait for a backup (review 2026-09-27)', () => {
  function seedDue() {
    store.storeExtractionResult('s-due', { ...base, entities: [ent('Faded Thing')], decisions: [dec('Faded decision')] });
    db.prepare('UPDATE entities SET salience = 0.06, last_seen = ?, last_recalled = NULL, last_decayed_at = NULL')
      .run(iso(NOW - 30 * DAY));
    db.prepare('UPDATE decisions SET salience = 0.01').run();
  }

  it('the first move of a cycle takes a backup; the rest of the day reuses it', () => {
    seedDue();
    const backupDir = path.join(tmpDir, 'backups');

    const d = decayWeights(db, { now: NOW, backupDir });

    assert.equal(d.archivedEntities, 1);
    assert.equal(d.backup.reused, false, 'taken before the move');
    const snap = new Database(d.backup.path, { readonly: true });
    assert.equal(snap.prepare(`SELECT COUNT(*) n FROM entities WHERE name = 'Faded Thing'`).get().n, 1,
      'the backup holds the entity as it was before it moved');
    assert.equal(snap.prepare('SELECT COUNT(*) n FROM decisions').get().n, 1);
    snap.close();

    const p = pruneStale(db, { now: new Date(NOW.getTime() + 3_600_000), backupDir });
    assert.equal(p.archivedDecisions, 1);
    assert.equal(p.backup.reused, true, 'one backup a day, shared by decay and prune');
    assert.equal(p.backup.path, d.backup.path);
    assert.equal(fs.readdirSync(backupDir).length, 1);
  });

  it('without a backup a decayed-out entity stays live and untouched, and the cycle says why', () => {
    seedDue();
    const before = db.prepare('SELECT * FROM entities').get();
    const blocked = path.join(tmpDir, 'a-file');
    fs.writeFileSync(blocked, '');
    const backupDir = path.join(blocked, 'backups');

    const d = decayWeights(db, { now: NOW, backupDir });
    const p = pruneStale(db, { now: NOW, backupDir });

    assert.equal(d.archivedEntities, 0);
    assert.match(d.archiveSkipped, /no backup/);
    assert.deepEqual(db.prepare('SELECT * FROM entities').get(), before, 'the next cycle decays it from the same anchor');
    assert.equal(count('SELECT COUNT(*) n FROM mentions'), 1);
    for (const t of ['entities_archived', 'mentions_archived', 'decisions_archived']) {
      assert.equal(count(`SELECT COUNT(*) n FROM ${t}`), 0, `${t} empty`);
    }
    const line = summarizeRemovals({ decayed: d, pruned: p });
    assert.match(line, /decayed-out entities kept \(no backup: /);
    assert.match(line, /decayed-out decisions kept \(no backup: /);
  });
});

describe('backups belong to their database and are verified (review 2026-09-27)', () => {
  const stateFile = () => path.join(tmpDir, 'state.db');

  it('a copy of another database in the same backup directory never satisfies this one\'s gate', () => {
    const backupDir = path.join(tmpDir, 'backups');
    const rehearsal = createExtractionStore({ dbPath: path.join(tmpDir, 'rehearsal.db') });
    try {
      initConsolidationTables(rehearsal.db);
      rehearsal.db.prepare(`INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count) VALUES ('theirs', '[]', ?, ?, 1)`)
        .run(iso(NOW - 200 * DAY), iso(NOW - 200 * DAY));
      assert.equal(pruneStale(rehearsal.db, { now: NOW, backupDir }).backup.reused, false);
    } finally {
      rehearsal.close();
    }
    db.prepare(`INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count) VALUES ('ours', '[]', ?, ?, 1)`)
      .run(iso(NOW - 200 * DAY), iso(NOW - 200 * DAY));

    const r = pruneStale(db, { now: new Date(NOW.getTime() + 3_600_000), backupDir });

    assert.equal(r.backup.reused, false, 'the rehearsal database\'s backup is not this one\'s');
    assert.match(path.basename(r.backup.path), /^state\.db-/);
    const snap = new Database(r.backup.path, { readonly: true });
    assert.deepEqual(snap.prepare('SELECT label FROM themes').all().map((t) => t.label), ['ours'], 'a backup of this database');
    snap.close();
    assert.equal(r.prunedThemes, 1);
  });

  it('a future-dated file is never reused and rotates out first', () => {
    const dir = path.join(tmpDir, 'b');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'state-20991231T000000000Z.db'), '');

    const r1 = backupStore(db, { dir, prefix: 'state', keep: 2, reuseMs: DAY, now: NOW });
    assert.equal(r1.reused, false, 'a stamp in the future is not a recent backup');
    const r2 = backupStore(db, { dir, prefix: 'state', keep: 2, reuseMs: DAY, now: new Date(NOW.getTime() + 2 * DAY) });

    assert.equal(r2.reused, false);
    assert.deepEqual(fs.readdirSync(dir).sort(), [path.basename(r1.path), path.basename(r2.path)].sort(),
      'the future-dated file went, not the real backups');
  });

  it('a crash mid-copy leaves nothing a later gate counts as a backup', () => {
    const dir = path.join(tmpDir, 'b');
    // VACUUM INTO writes part of the copy, then the process dies (SIGKILL: no
    // catch block, no cleanup runs).
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      const { backupStore } = await import(${JSON.stringify(new URL('../lib/sqlite-store.mjs', import.meta.url).href)});
      const partial = fs.readFileSync(${JSON.stringify(stateFile())}).subarray(0, 4096);
      const db = { name: ${JSON.stringify(stateFile())}, prepare: () => ({ run: (to) => { fs.writeFileSync(to, partial); process.kill(process.pid, 'SIGKILL'); } }) };
      backupStore(db, { dir: ${JSON.stringify(dir)}, prefix: 'state', now: new Date(${NOW.getTime()}) });
    `]);
    assert.equal(crashed.signal, 'SIGKILL', String(crashed.stderr));
    const left = fs.readdirSync(dir);
    assert.equal(left.length, 1, 'precondition: the partial copy is still on disk');
    assert.doesNotMatch(left[0], /^state-\d{8}T\d{9}Z\.db$/, 'the partial copy is not under a backup name');

    const r = backupStore(db, { dir, prefix: 'state', reuseMs: DAY, now: new Date(NOW.getTime() + 60_000) });

    assert.equal(r.reused, false, 'the partial copy never satisfies the reuse gate');
    const copy = new Database(r.path, { readonly: true });
    assert.equal(copy.pragma('quick_check', { simple: true }), 'ok');
    copy.close();
  });

  it('a copy that fails quick_check is discarded, never kept under a backup name', () => {
    const dir = path.join(tmpDir, 'b');
    const garbled = { name: stateFile(), prepare: () => ({ run: (to) => fs.writeFileSync(to, Buffer.alloc(8192, 7)) }) };

    assert.throws(() => backupStore(garbled, { dir, now: NOW }), /not a database|quick_check/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe('the cycle: CONSOLIDATE_PRUNE and the audit trail', () => {
  const vaultPath = () => path.join(tmpDir, 'vault');

  function seedRemovals() {
    store.storeExtractionResult('s-audit', {
      ...base, entities: [ent('Faded Thing')], decisions: [dec('Faded decision')],
    });
    db.prepare('UPDATE decisions SET salience = 0.01').run();
    db.prepare('UPDATE entities SET salience = 0.06, last_seen = ?, last_recalled = NULL, last_decayed_at = NULL')
      .run(iso(Date.now() - 30 * DAY));
    return {
      entityId: db.prepare('SELECT id FROM entities').get().id,
      decisionId: db.prepare('SELECT id FROM decisions').get().id,
    };
  }

  it('CONSOLIDATE_PRUNE=0 skips the prune step', async () => {
    seedRemovals();
    const saved = process.env.CONSOLIDATE_PRUNE;
    process.env.CONSOLIDATE_PRUNE = '0';
    let result;
    try {
      result = await runConsolidationCycle({ db, vaultPath: vaultPath() });
    } finally {
      if (saved === undefined) delete process.env.CONSOLIDATE_PRUNE; else process.env.CONSOLIDATE_PRUNE = saved;
    }
    assert.match(result.pruned.skipped, /CONSOLIDATE_PRUNE=0/);
    assert.equal(count('SELECT COUNT(*) n FROM decisions'), 1, 'the decayed decision stays live');
    assert.equal(count('SELECT COUNT(*) n FROM decisions_archived'), 0);
  });

  it('memory.decayed is emitted after prune with per-row identity and counts', async () => {
    const { entityId, decisionId } = seedRemovals();
    const published = [];
    await runConsolidationCycle({
      db, vaultPath: vaultPath(), nodeId: 'test-node',
      eventLog: { publishLocal: async (e) => { published.push(e); } },
    });

    const decayed = published.filter((e) => e.event_type === 'memory.decayed');
    assert.equal(decayed.length, 1);
    const data = decayed[0].data;
    assert.equal(data.archived_count, 1);
    assert.equal(data.decisions_archived, 1);
    assert.equal(data.themes_deleted, 0);
    assert.equal(data.prune_status, 'ran');
    assert.deepEqual(
      data.removed.map((r) => [r.action, r.kind, r.id]).sort(),
      [['archived', 'decision', decisionId], ['archived', 'entity', entityId]].sort()
    );
    const parsed = MemoryEventSchema.safeParse(decayed[0]);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.deepEqual(parsed.data.data.removed, data.removed, 'the schema keeps the per-row records');
  });
});
