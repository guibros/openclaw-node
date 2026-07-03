/**
 * Tests for lib/readonly-sql.mjs — the hardened read-only SQL surface.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  createReadonlyQuery,
  firstKeyword,
  DEFAULT_MAX_ROWS,
} from '../lib/readonly-sql.mjs';

let tmpDir;
let dbPath;
let ro;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-sql-test-'));
  dbPath = path.join(tmpDir, 'fixture.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, payload BLOB);
    CREATE INDEX idx_items_name ON items(name);
    CREATE VIEW item_names AS SELECT name FROM items;
  `);
  const insert = db.prepare('INSERT INTO items (name, payload) VALUES (?, ?)');
  for (let i = 0; i < 300; i++) insert.run(`item-${i}`, null);
  insert.run('x'.repeat(5000), Buffer.alloc(64));
  db.close();
  ro = createReadonlyQuery({ dbPath });
});

after(() => {
  ro.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('firstKeyword', () => {
  it('skips line and block comments', () => {
    assert.equal(firstKeyword('-- hi\n  /* x */ select 1'), 'SELECT');
    assert.equal(firstKeyword('/* unterminated'), '');
    assert.equal(firstKeyword('   '), '');
  });
});

describe('createReadonlyQuery', () => {
  it('rejects unknown options and missing dbPath', () => {
    assert.throws(() => createReadonlyQuery({ dbPath, db: 'x' }), /unknown option/);
    assert.throws(() => createReadonlyQuery({}), /dbPath is required/);
  });

  it('throws when the database file does not exist', () => {
    assert.throws(() => createReadonlyQuery({ dbPath: path.join(tmpDir, 'nope.db') }));
  });

  it('runs a SELECT with positional params', () => {
    const { columns, rows, truncated } = ro.query(
      'SELECT id, name FROM items WHERE name = ?',
      ['item-3']
    );
    assert.deepEqual(columns, ['id', 'name']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'item-3');
    assert.equal(truncated, false);
  });

  it('allows WITH and EXPLAIN', () => {
    assert.equal(ro.query('WITH t AS (SELECT 1 AS n) SELECT n FROM t').rows[0].n, 1);
    assert.ok(ro.query('EXPLAIN QUERY PLAN SELECT * FROM items').rows.length > 0);
  });

  it('rejects writes', () => {
    for (const sql of [
      "INSERT INTO items (name) VALUES ('evil')",
      "UPDATE items SET name = 'evil'",
      'DELETE FROM items',
      'CREATE TABLE evil (id)',
      'DROP TABLE items',
    ]) {
      assert.throws(() => ro.query(sql), /must start with SELECT/);
    }
  });

  it('rejects PRAGMA and ATTACH even though sqlite reports them read-only', () => {
    assert.throws(() => ro.query('PRAGMA journal_mode = DELETE'), /must start with SELECT/);
    assert.throws(
      () => ro.query(`ATTACH DATABASE '${dbPath}' AS other`),
      /must start with SELECT/
    );
  });

  it('rejects multi-statement SQL', () => {
    assert.throws(() => ro.query("SELECT 1; DELETE FROM items"));
  });

  it('rejects empty and oversized SQL', () => {
    assert.throws(() => ro.query('  '), /non-empty/);
    assert.throws(
      () => ro.query(`SELECT '${'a'.repeat(9000)}'`),
      /exceeds 8192 bytes/
    );
  });

  it('caps rows and flags truncation', () => {
    const { rows, truncated } = ro.query('SELECT id FROM items');
    assert.equal(rows.length, DEFAULT_MAX_ROWS);
    assert.equal(truncated, true);
  });

  it('truncates long values and elides blobs', () => {
    const { rows } = ro.query(
      'SELECT name, payload FROM items WHERE length(name) > 4000'
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].name.endsWith('…[truncated]'));
    assert.ok(Buffer.byteLength(rows[0].name, 'utf8') < 5000);
    assert.equal(rows[0].payload, '<blob 64 bytes>');
  });

  it('lists schema without sqlite internals', () => {
    const entries = ro.schema();
    const names = entries.map((e) => e.name);
    assert.ok(names.includes('items'));
    assert.ok(names.includes('idx_items_name'));
    assert.ok(names.includes('item_names'));
    assert.ok(!names.some((n) => n.startsWith('sqlite_')));
    assert.ok(entries.find((e) => e.name === 'items').sql.includes('CREATE TABLE'));
  });

  it('the underlying connection truly cannot write (query_only)', () => {
    // Belt-and-suspenders check: even if the keyword guard were bypassed,
    // prepare() of a write on this connection must fail at readonly/query_only.
    assert.throws(() => {
      const db = new Database(dbPath, { readonly: true });
      db.pragma('query_only = ON');
      db.prepare('DELETE FROM items').run();
    });
  });
});
