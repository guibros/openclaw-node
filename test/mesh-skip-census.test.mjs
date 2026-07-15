/**
 * mesh-skip-census.test.mjs — make the mesh/collab skip VISIBLE in the summary.
 *
 * The integration suites declare `describe(name, { skip: meshSkipReason() })`
 * when the mesh stack is down (R32). But node:test's summary counts skipped
 * *tests*, and a skipped `describe` registers zero child tests — so a run with
 * the entire mesh/collab tier skipped still prints `skipped 0`. A green check
 * then says nothing about whether any of that tier actually ran.
 *
 * This census always runs. If the mesh stack is down it surfaces exactly which
 * suite files were skipped, as one clearly-named skipped test (so `skipped >= 1`
 * with a reason). Set OPENCLAW_REQUIRE_MESH=1 (e.g. in CI once the mesh stack is
 * provisioned) to turn that silent skip into a hard failure instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { meshSkipReason } = require('./helpers/mesh-available.cjs');

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url).split('/').pop();

function filesContaining(marker) {
  return readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs)$/.test(f) && f !== SELF)
    .filter((f) => readFileSync(join(TEST_DIR, f), 'utf8').includes(marker))
    .sort();
}

const requireMesh = process.env.OPENCLAW_REQUIRE_MESH === '1';

function censusCheck(t, { files, reason, label }) {
  if (!reason) return; // dependency present — those suites actually ran.
  const msg = `${files.length} ${label} test file(s) skipped their suites — ${reason}:\n  ${files.join('\n  ')}`;
  if (requireMesh) {
    assert.fail(`OPENCLAW_REQUIRE_MESH=1 but ${msg}`);
  }
  t.skip(msg);
}

// Class 1: suites gated on the running mesh stack (meshSkipReason).
const meshFiles = filesContaining('meshSkipReason');
test(`mesh-skip census (${meshFiles.length} mesh-dependent suite file(s))`, (t) => {
  censusCheck(t, { files: meshFiles, reason: meshSkipReason(), label: 'mesh-dependent' });
});

// Class 2: federation suites gated on the nats-server BINARY. They skip via
// their own `{ skip: 'nats-server not found on PATH' }` const — a skipped
// describe registers zero child tests, so without this census the whole
// federation-integration tier vanishes with `skipped 0`.
const natsBinFiles = filesContaining('nats-server not found on PATH');
function natsServerBinReason() {
  try { execSync('which nats-server', { stdio: 'pipe' }); return null; }
  catch { return 'nats-server binary not found on PATH'; }
}
test(`nats-server-binary census (${natsBinFiles.length} federation suite file(s))`, (t) => {
  censusCheck(t, { files: natsBinFiles, reason: natsServerBinReason(), label: 'nats-server-dependent' });
});

// Completeness guard (step 6.4): the census finds nats-gated suites by the exact
// marker 'nats-server not found on PATH'. A new suite that gates a describe/test
// on NATS with a *different* skip string would run neither in CI (no nats) nor be
// censused — it would vanish with `skipped 0`. This HARD-FAILS (never skips) if any
// test file carries a skip whose reason mentions nats but isn't the canonical marker,
// forcing new nats-gated suites through a censused mechanism.
const CANONICAL_NATS_SKIP = 'nats-server not found on PATH';
const SKIP_GATE_RE = /\{\s*skip:\s*([^}]{0,200})\}/g;
test('census completeness: every nats-gated skip uses the censused canonical marker', () => {
  const offenders = [];
  for (const f of readdirSync(TEST_DIR).filter((x) => /\.test\.(js|mjs)$/.test(x) && x !== SELF)) {
    const src = readFileSync(join(TEST_DIR, f), 'utf8');
    // The census is file-granular (filesContaining), so require the canonical
    // marker somewhere in the FILE — a nats-named skip const is fine as long as
    // the file carries the marker the census greps for.
    if (src.includes(CANONICAL_NATS_SKIP)) continue;
    for (const m of src.matchAll(SKIP_GATE_RE)) {
      const expr = m[1];
      if (/nats/i.test(expr)) {
        offenders.push(`${f}: { skip: ${expr.trim().slice(0, 80)} }`);
      }
    }
  }
  assert.equal(offenders.length, 0,
    `nats-gated skip(s) not using the canonical census marker '${CANONICAL_NATS_SKIP}' ` +
    `— the census can't see them, so they'd vanish in CI:\n  ${offenders.join('\n  ')}`);
});
