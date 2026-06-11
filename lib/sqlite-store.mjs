import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function openStore(dbPath, opts = {}) {
  const dir = path.dirname(dbPath);
  if (!opts.readonly && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { readonly: opts.readonly ?? false });

  // R21 fix (repair 5.5): busy_timeout applies to READONLY connections too —
  // probes and CLI reads used to fail SQLITE_BUSY instantly during writer
  // checkpoints, exactly when the daemon is busiest.
  db.pragma('busy_timeout = 5000');
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }

  if (opts.integrityCheck !== false) {
    const result = db.pragma('integrity_check');
    if (result[0]?.integrity_check !== 'ok') {
      db.close();
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(result)}`);
    }
  }

  return db;
}

export function getVersion(db) {
  return db.pragma('user_version', { simple: true });
}

export function setVersion(db, version) {
  db.pragma(`user_version = ${Number(version)}`);
}

export function closeStore(db) {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  db.close();
}
