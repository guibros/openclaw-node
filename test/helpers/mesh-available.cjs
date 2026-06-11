/**
 * R32 fix (repair 7.4): mesh-stack availability as a VISIBLE skip.
 *
 * Seven integration suites used to probe NATS/mesh-task-daemon inside
 * before() and process.exit(0) when absent — node:test reports an exiting
 * file as a clean pass, so "tests green" said nothing about whether the
 * mesh tests ran. This helper makes the probe synchronous (child process)
 * so files can declare `describe(name, { skip: reason }, ...)` and the
 * runner prints real skip counts.
 *
 * The probe result is cached in tmp for 60s — one ~2.5s probe per suite
 * run, not one per file.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CACHE_FILE = path.join(os.tmpdir(), 'openclaw-mesh-probe.json');
const CACHE_TTL_MS = 60_000;

function meshSkipReason() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - cached.ts < CACHE_TTL_MS) return cached.reason;
  } catch { /* no fresh cache */ }

  const probe = `
    const { connect } = require('nats');
    const { NATS_URL } = require('./lib/nats-resolve');
    connect({ servers: NATS_URL, timeout: 2000 })
      .then((nc) => nc.request('mesh.tasks.list', Buffer.from(JSON.stringify({ status: 'queued', limit: 1 })), { timeout: 3000 })
        .finally(() => nc.close()))
      .then(() => process.exit(0), () => process.exit(1));
  `;
  let reason = false;
  try {
    execSync(`node -e ${JSON.stringify(probe)}`, { cwd: REPO_ROOT, stdio: 'ignore', timeout: 10_000 });
  } catch {
    reason = 'mesh stack unavailable (NATS or mesh-task-daemon not responding)';
  }
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), reason })); } catch { /* cache is best-effort */ }
  return reason;
}

module.exports = { meshSkipReason };
