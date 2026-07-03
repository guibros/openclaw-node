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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { meshSkipReason } = require('./helpers/mesh-available.cjs');

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url).split('/').pop();

function meshDependentFiles() {
  return readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs)$/.test(f) && f !== SELF)
    .filter((f) => readFileSync(join(TEST_DIR, f), 'utf8').includes('meshSkipReason'))
    .sort();
}

const files = meshDependentFiles();
const reason = meshSkipReason();
const requireMesh = process.env.OPENCLAW_REQUIRE_MESH === '1';

test(`mesh-skip census (${files.length} mesh-dependent suite file(s))`, (t) => {
  if (!reason) return; // mesh up — those suites actually ran.

  const msg = `${files.length} mesh-dependent test file(s) skipped their suites — ${reason}:\n  ${files.join('\n  ')}`;
  if (requireMesh) {
    assert.fail(`OPENCLAW_REQUIRE_MESH=1 but ${msg}`);
  }
  t.skip(msg);
});
