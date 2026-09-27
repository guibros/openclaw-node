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

const stampOf = (date) => date.toISOString().replace(/[-:.]/g, '');   // 20260926T120000000Z
const dateOf = (s) => new Date(
  `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z`
);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Named after the database file (review 2026-09-27): with one fixed prefix, a
// copy of another database in the same backup directory — a rehearsal DB
// beside the live one — satisfied this one's reuse gate and took its
// rotation slots.
const backupPrefixOf = (db) => (db.name && db.name !== ':memory:' ? path.basename(db.name) : 'memory');

function verifyBackup(file) {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const check = copy.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`backup ${file} failed quick_check: ${check}`);
  } finally {
    copy.close();
  }
}

/**
 * Snapshot a live database into `dir` with VACUUM INTO — a consistent copy
 * under WAL that does not block writers — and rotate to the newest `keep`.
 * A snapshot younger than `reuseMs` is returned instead of taking another.
 * Snapshots hold conversation-derived memory: the directory is created 0700
 * and each file 0600. VACUUM INTO cannot run inside a transaction.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {object} opts
 * @param {string} opts.dir
 * @param {string} [opts.prefix] — default: the database file's name
 * @param {number} [opts.keep]
 * @param {number} [opts.reuseMs]
 * @param {Date} [opts.now]
 * @returns {{ path: string, reused: boolean, removed: string[] }}
 */
export function backupStore(db, { dir, prefix = backupPrefixOf(db), keep = 7, reuseMs = 0, now = new Date() }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{8}T\\d{9}Z)\\.db$`);
  const past = [];
  const future = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = pattern.exec(f);
    if (!m) continue;
    const at = dateOf(m[1]).getTime();
    // A stamp after `now` (or an invalid one) is a wrong clock or a planted
    // file, not a recent backup: it never satisfies the reuse gate, and it
    // rotates out first — sorted by name it outranks every real backup, so it
    // was reused forever and never rotated.
    (at <= now.getTime() ? past : future).push(f);
  }
  const newest = past.at(-1);
  if (newest && reuseMs > 0 && now - dateOf(newest.match(pattern)[1]) < reuseMs) {
    return { path: path.join(dir, newest), reused: true, removed: [] };
  }

  const file = `${prefix}-${stampOf(now)}.db`;
  const target = path.join(dir, file);
  if (fs.existsSync(target)) throw new Error(`backup ${target} already exists`);
  // Written under a name the pattern never matches (per process, so two
  // writers never share one), synced — VACUUM INTO does not fsync its output
  // — and checked before the rename: a crash or power loss mid-copy leaves a
  // stray .tmp, never a truncated file the gate would count as a backup.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.chmodSync(tmp, 0o600);
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    verifyBackup(tmp);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }

  const all = [...future, ...past, file];
  const removed = all.slice(0, Math.max(0, all.length - Math.max(1, keep)));
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });
  return { path: target, reused: false, removed };
}
