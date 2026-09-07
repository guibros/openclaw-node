/**
 * nats-connect-census.test.mjs — drift lock for Phase 7 P7-3.
 *
 * Every runtime NATS connect in bin/, lib/, workspace-bin/ and Mission
 * Control must go through the one resolver (natsConnectOpts / natsAuthOptions),
 * because that is the only place that knows whether to send the shared token,
 * this node's nkey, or the legacy user. A bare `connect({ servers: … })` is a
 * client that silently falls off the bus the day the operator flips
 * OPENCLAW_NATS_AUTH=nkey. Files that ARE the resolver are the only exception.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['bin', 'lib', 'workspace-bin', 'mission-control/src/lib'];
const EXT = /\.(c?js|mjs|ts)$/;
const ALLOW = new Set([
  'lib/nats-resolve.js',
  'mission-control/src/lib/nats-auth.ts',
]);
// `connect({ servers: …` with nothing from the resolver spread in first.
const BARE = /\bconnect\(\s*\{\s*servers\s*:/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(entry)) yield p;
  }
}

test('no runtime file connects to NATS without the resolver', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (ALLOW.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(BARE)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `bare NATS connects (route through natsConnectOpts):\n  ${offenders.join('\n  ')}`);
});

test('the resolver is where the token or nkey is attached', () => {
  const src = readFileSync(join(ROOT, 'lib/nats-resolve.js'), 'utf8');
  assert.match(src, /nkeyAuthenticatorFor/);
  assert.match(src, /nkey-strict/);
});
