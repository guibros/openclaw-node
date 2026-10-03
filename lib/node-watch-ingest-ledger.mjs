import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const GRACE_MS = 2 * 3600_000;

export function observeIngestLag(home, entries, presentPaths, now = Date.now()) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, '.node-watch-ingest.sqlite');
  const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw new Error('ingest ledger is not a private regular file');
    if ((st.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
  } finally { closeSync(fd); }

  const Database = require('better-sqlite3');
  const db = new Database(file);
  try {
    db.pragma('busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS pending (
      path TEXT PRIMARY KEY,
      inode TEXT NOT NULL,
      archived INTEGER NOT NULL,
      since_ms INTEGER NOT NULL
    )`);
    const read = db.prepare('SELECT inode, archived, since_ms FROM pending WHERE path = ?');
    const upsert = db.prepare(`INSERT INTO pending (path, inode, archived, since_ms) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET inode = excluded.inode, archived = excluded.archived,
      since_ms = excluded.since_ms`);
    const remove = db.prepare('DELETE FROM pending WHERE path = ?');
    const paths = db.prepare('SELECT path FROM pending');
    const transaction = db.transaction(() => {
      const present = new Set(presentPaths);
      for (const { path } of paths.all()) if (!present.has(path)) remove.run(path);
      const overdue = [];
      const regressed = [];
      for (const entry of entries) {
        if (entry.inconsistent || !entry.pending) { remove.run(entry.file); continue; }
        const inode = entry.identity.split(':', 2).join(':');
        const previous = read.get(entry.file);
        if (previous?.inode === inode && entry.archivedCount < previous.archived) {
          regressed.push(entry.file);
          continue;
        }
        const since = previous?.inode === inode && entry.archivedCount === previous.archived
          ? previous.since_ms : now;
        if (!previous || previous.inode !== inode || entry.archivedCount !== previous.archived) {
          upsert.run(entry.file, inode, entry.archivedCount, since);
        }
        if (now - since > GRACE_MS) overdue.push(entry.file);
      }
      return { overdue, regressed };
    });
    return transaction.immediate();
  } finally { db.close(); }
}
