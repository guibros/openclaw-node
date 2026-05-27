/**
 * atomic-write.mjs — durable, atomic file writes.
 *
 * Replaces 5 different ad-hoc "atomic" implementations across the repo, only
 * 2 of which used fsync (kanban-io.js correctly; node-identity registry save
 * incorrectly per F-Q411). Without fsync, the rename can be journaled by the
 * filesystem before the data hits disk — on power loss the renamed file is
 * zero-length or torn.
 *
 * Absorbs findings:
 *   F-Q205 / F-Q409 — vault note writes (obsidian-summarizer)
 *   F-Q313 / F-Q410 — backfill checkpoint (extract-existing-sessions)
 *   F-Q411 — registry save fsync gap (node-identity)
 *   F-Q105 — registry save tmp filename collision (per-pid suffix)
 *   F-Q211 / F-P313 — token file TOCTOU (memory-inject-server)
 *
 * Pattern: openSync(tmp, 'w') + writeSync + fsyncSync + closeSync + renameSync.
 * The tmp filename includes pid + timestamp so concurrent saves don't collide.
 */

import fs from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomically write content to `path`. Crash-safe + power-safe.
 *
 * @param {string} filePath — absolute target path
 * @param {string | Buffer} content
 * @param {object} [opts]
 * @param {number} [opts.mode=0o644] — final file mode after rename
 * @param {boolean} [opts.mkdirp=false] — create parent dirs if missing
 * @returns {void}
 */
export function atomicWriteFileSync(filePath, content, opts = {}) {
  const mode = opts.mode ?? 0o644;
  if (opts.mkdirp) {
    fs.mkdirSync(dirname(filePath), { recursive: true });
  }
  // Per-pid + timestamp suffix prevents concurrent-writer tmp collision.
  // (F-Q105: registry save races between daemon startup + trust-peer CLI.)
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, typeof content === 'string' ? content : Buffer.from(content));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/**
 * Async variant. Same semantics, uses fs/promises. Fsync via fd.sync().
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {object} [opts] — same as sync variant
 * @returns {Promise<void>}
 */
export async function atomicWriteFile(filePath, content, opts = {}) {
  const mode = opts.mode ?? 0o644;
  const fsp = await import('node:fs/promises');
  if (opts.mkdirp) {
    await fsp.mkdir(dirname(filePath), { recursive: true });
  }
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fh = await fsp.open(tmp, 'w', mode);
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, filePath);
}
