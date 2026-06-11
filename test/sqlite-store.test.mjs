import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, closeStore, getVersion, setVersion } from '../lib/sqlite-store.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP_DIR = path.join(os.tmpdir(), 'sqlite-store-test-' + process.pid);

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('openStore', () => {
  it('sets WAL journal_mode', () => {
    const db = openStore(path.join(TMP_DIR, 'test.db'));
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal');
    db.close();
  });

  it('enables foreign_keys', () => {
    const db = openStore(path.join(TMP_DIR, 'test.db'));
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1);
    db.close();
  });

  it('sets busy_timeout', () => {
    const db = openStore(path.join(TMP_DIR, 'test.db'));
    const timeout = db.pragma('busy_timeout', { simple: true });
    assert.equal(timeout, 5000);
    db.close();
  });

  it('passes integrity_check', () => {
    const db = openStore(path.join(TMP_DIR, 'test.db'));
    const result = db.pragma('integrity_check');
    assert.equal(result[0].integrity_check, 'ok');
    db.close();
  });

  it('throws on corrupted database', () => {
    const dbPath = path.join(TMP_DIR, 'corrupt.db');
    fs.writeFileSync(dbPath, 'not a sqlite database');
    assert.throws(
      () => openStore(dbPath),
      /integrity check failed|not a database/i
    );
  });

  it('skips pragma writes for readonly opens', () => {
    const dbPath = path.join(TMP_DIR, 'ro.db');
    const dbSetup = openStore(dbPath);
    dbSetup.close();

    const db = openStore(dbPath, { readonly: true });
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal');
    db.close();
  });

  it('creates parent directories if missing', () => {
    const nested = path.join(TMP_DIR, 'a', 'b', 'test.db');
    const db = openStore(nested);
    assert.ok(fs.existsSync(path.dirname(nested)));
    db.close();
  });

  it('allows disabling integrity_check', () => {
    const dbPath = path.join(TMP_DIR, 'nocheck.db');
    const db = openStore(dbPath, { integrityCheck: false });
    assert.ok(db);
    db.close();
  });
});

describe('getVersion / setVersion', () => {
  it('defaults to version 0', () => {
    const db = openStore(path.join(TMP_DIR, 'v.db'));
    assert.equal(getVersion(db), 0);
    db.close();
  });

  it('sets and reads back user_version', () => {
    const db = openStore(path.join(TMP_DIR, 'v.db'));
    setVersion(db, 3);
    assert.equal(getVersion(db), 3);
    db.close();
  });

  it('persists version across reopens', () => {
    const dbPath = path.join(TMP_DIR, 'persist.db');
    const db1 = openStore(dbPath);
    setVersion(db1, 7);
    db1.close();

    const db2 = openStore(dbPath);
    assert.equal(getVersion(db2), 7);
    db2.close();
  });
});

describe('closeStore', () => {
  it('checkpoints WAL and closes the database', () => {
    const dbPath = path.join(TMP_DIR, 'close.db');
    const db = openStore(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO t VALUES (1)').run();

    const walPath = dbPath + '-wal';
    assert.ok(fs.existsSync(walPath), 'WAL file should exist before close');
    const walSize = fs.statSync(walPath).size;
    assert.ok(walSize > 0, 'WAL should have content before close');

    closeStore(db);

    const walAfter = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    assert.equal(walAfter, 0, 'WAL should be truncated after closeStore');
    assert.throws(() => db.pragma('journal_mode'), /not open/i);
  });

  it('still closes even if checkpoint fails (readonly)', () => {
    const dbPath = path.join(TMP_DIR, 'ro-close.db');
    const setup = openStore(dbPath);
    setup.close();

    const db = openStore(dbPath, { readonly: true });
    closeStore(db);
    assert.throws(() => db.pragma('journal_mode'), /not open/i);
  });
});

describe('R21 (repair 5.5): readonly opens get busy_timeout', () => {
  it('readonly connections read back busy_timeout = 5000', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ro-'));
    const dbPath = path.join(dir, 'ro.db');
    const w = openStore(dbPath);
    w.exec('CREATE TABLE t (id INTEGER)');
    w.close();

    const ro = openStore(dbPath, { readonly: true, integrityCheck: false });
    assert.equal(ro.pragma('busy_timeout', { simple: true }), 5000);
    ro.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
