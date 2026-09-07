/**
 * mesh-lock.cjs — serialize the suites that share the ONE live mesh bus.
 *
 * node --test runs every file in its own process, in parallel. The live-NATS
 * suites all talk to the same task daemon, and `mesh.tasks.claim` hands out
 * the highest-priority queued task regardless of who submitted it — so two
 * files claiming at the same time steal each other's tasks, and a
 * `mesh.events.submitted` listener with max:1 sees the other file's task.
 * This never showed before Phase 7 because the availability probe was broken
 * and the tier silently skipped. The lock keeps the bus suites one-at-a-time
 * while every other test file keeps running in parallel.
 *
 * Usage (root hooks): `before(() => acquireMeshLock('file'))`, `after(releaseMeshLock)`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCK_PATH = path.join(os.tmpdir(), 'openclaw-mesh-tests.lock');
const WAIT_MS = 10 * 60_000;
let held = false;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

async function acquireMeshLock(label = 'test') {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, label, at: Date.now() }), { flag: 'wx' });
      held = true;
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A holder that died mid-suite must not wedge every later run.
      try {
        const holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
        if (!pidAlive(holder.pid)) { fs.rmSync(LOCK_PATH, { force: true }); continue; }
      } catch { fs.rmSync(LOCK_PATH, { force: true }); continue; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`mesh test lock not acquired within ${WAIT_MS / 1000}s (${LOCK_PATH})`);
}

function releaseMeshLock() {
  if (!held) return;
  held = false;
  try {
    const holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (holder.pid === process.pid) fs.rmSync(LOCK_PATH, { force: true });
  } catch { /* already gone */ }
}

process.on('exit', releaseMeshLock);

module.exports = { acquireMeshLock, releaseMeshLock, LOCK_PATH };
