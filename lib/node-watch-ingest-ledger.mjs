import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const GRACE_MS = 2 * 3600_000;

export function observeIngestLag(home, entries, presentPaths, clock = Date.now) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (statSync(home).uid !== process.getuid()) throw new Error('ingest ledger directory belongs to another user');
  const file = join(home, '.node-watch-ingest.sqlite');
  const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid()) {
      throw new Error('ingest ledger is not an owned private regular file');
    }
    if ((st.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
    const Database = require('better-sqlite3');
    const db = new Database(file, { fileMustExist: true });
    try {
      const opened = lstatSync(file);
      const main = db.pragma('database_list').find((row) => row.name === 'main')?.file;
      const expected = join(realpathSync(home), '.node-watch-ingest.sqlite');
      if (!opened.isFile() || opened.dev !== st.dev || opened.ino !== st.ino
          || opened.nlink !== 1 || opened.uid !== st.uid
          || realpathSync(file) !== expected || !main || realpathSync(main) !== expected) {
        throw new Error('ingest ledger changed while opening');
      }
      db.pragma('busy_timeout = 5000');
      db.exec(`CREATE TABLE IF NOT EXISTS pending (
        path TEXT PRIMARY KEY,
        archived INTEGER NOT NULL,
        since_ms INTEGER NOT NULL,
        seen_ms INTEGER NOT NULL
      )`);
      const read = db.prepare('SELECT archived, since_ms, seen_ms FROM pending WHERE path = ?');
      const upsert = db.prepare(`INSERT INTO pending (path, archived, since_ms, seen_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET archived = excluded.archived, since_ms = excluded.since_ms,
        seen_ms = excluded.seen_ms`);
      const remove = db.prepare('DELETE FROM pending WHERE path = ?');
      const paths = db.prepare('SELECT path FROM pending');
      const transaction = db.transaction(() => {
        const now = clock();
        const present = new Set(presentPaths);
        for (const { path } of paths.all()) if (!present.has(path)) remove.run(path);
        const overdue = [];
        const lower = [];
        for (const entry of entries) {
          if (entry.inconsistent) { remove.run(entry.file); continue; }
          const previous = read.get(entry.file);
          if (previous && entry.archivedCount < previous.archived) {
            lower.push(entry.file);
            const since = previous.since_ms - Math.max(0, previous.seen_ms - now);
            upsert.run(entry.file, previous.archived, since, now);
            if (now - since > GRACE_MS) overdue.push(entry.file);
            continue;
          }
          if (!entry.pending) { remove.run(entry.file); continue; }
          const since = !previous || entry.archivedCount > previous.archived ? now
            : previous.since_ms - Math.max(0, previous.seen_ms - now);
          upsert.run(entry.file, entry.archivedCount, since, now);
          if (now - since > GRACE_MS) overdue.push(entry.file);
        }
        return { overdue, lower };
      });
      return transaction.immediate();
    } finally { db.close(); }
  } finally { closeSync(fd); }
}
