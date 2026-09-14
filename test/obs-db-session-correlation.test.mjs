/**
 * obs-db-session-correlation.test.mjs — observability_events carries session_id.
 *
 * The defect this pins: the table had thirteen columns and none of them
 * correlated — no session, trace, span or parent id — so every event from every
 * session landed in one flat heap keyed only by (timestamp, node_id, module,
 * function). Rows could not be grouped back into the run that produced them,
 * which is the first thing any diagnosis has to do.
 *
 * The migration half matters as much as the column: `CREATE TABLE IF NOT EXISTS`
 * is a no-op against the tables already deployed under ~/.openclaw, so without an
 * explicit ALTER every existing node would keep writing uncorrelatable rows.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let tmpdir;
let dbPath;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-db-'));
  dbPath = path.join(tmpdir, 'mission-control.db');
});
afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

/** Load obs-db against a throwaway DB; the module caches its handle per load. */
function loadObsDb() {
  process.env.OPENCLAW_OBS_DB = dbPath;
  delete require.cache[require.resolve('../lib/obs-db.js')];
  return require('../lib/obs-db.js');
}

function columns(db) {
  return db.prepare('PRAGMA table_info(observability_events)').all().map((c) => c.name);
}

describe('observability_events session correlation', () => {
  it('regression_F-TRACE4: a fresh table has session_id', () => {
    const obs = loadObsDb();
    obs.insertEvent({ module: 'm', function: 'f', category: 'lifecycle', session_id: 'sess-1' });

    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    try {
      assert.ok(columns(db).includes('session_id'));
      const row = db.prepare('SELECT session_id FROM observability_events').get();
      assert.equal(row.session_id, 'sess-1');
    } finally { db.close(); }
  });

  it('regression_F-TRACE5: migrates a table that predates the column', () => {
    // Stand up the old thirteen-column shape exactly as deployed nodes carry it.
    const Database = require('better-sqlite3');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE observability_events (
        id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, node_id TEXT NOT NULL,
        module TEXT NOT NULL, function TEXT NOT NULL, tier INTEGER NOT NULL DEFAULT 2,
        category TEXT NOT NULL, args_summary TEXT, result_summary TEXT,
        duration_ms INTEGER, error TEXT, meta TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
    legacy.prepare(
      `INSERT INTO observability_events (id, timestamp, node_id, module, function, category)
       VALUES ('old-1', 1, 'n', 'legacy', 'fn', 'lifecycle')`,
    ).run();
    assert.ok(!columns(legacy).includes('session_id'), 'fixture must start without the column');
    legacy.close();

    const obs = loadObsDb();
    obs.insertEvent({ module: 'm', function: 'f', category: 'lifecycle', session_id: 'sess-2' });

    const db = new Database(dbPath, { readonly: true });
    try {
      assert.ok(columns(db).includes('session_id'), 'ALTER must reach an already-deployed table');
      // The pre-existing row survives, correlation simply unknown for it.
      const old = db.prepare("SELECT session_id FROM observability_events WHERE id = 'old-1'").get();
      assert.equal(old.session_id, null);
      const fresh = db.prepare("SELECT session_id FROM observability_events WHERE session_id = 'sess-2'").get();
      assert.ok(fresh, 'new rows carry their session');
    } finally { db.close(); }
  });

  it('groups a run: events from one session are retrievable together, in order', () => {
    const obs = loadObsDb();
    obs.insertEvents([
      { id: 'a', timestamp: 3, module: 'm', function: 'tool.call', category: 'state_transition', session_id: 'run-A' },
      { id: 'b', timestamp: 1, module: 'm', function: 'message.user', category: 'lifecycle', session_id: 'run-A' },
      { id: 'c', timestamp: 2, module: 'm', function: 'message.user', category: 'lifecycle', session_id: 'run-B' },
    ]);

    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    try {
      const runA = db.prepare(
        'SELECT id FROM observability_events WHERE session_id = ? ORDER BY timestamp',
      ).all('run-A').map((r) => r.id);
      assert.deepEqual(runA, ['b', 'a'], 'one run reconstructs in causal order, without the other run');
    } finally { db.close(); }
  });

  it('an event with no known session stores NULL rather than failing', () => {
    const obs = loadObsDb();
    obs.insertEvent({ module: 'm', function: 'f', category: 'lifecycle' });

    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    try {
      assert.equal(db.prepare('SELECT session_id FROM observability_events').get().session_id, null);
    } finally { db.close(); }
  });
});
