/**
 * wiring-manifest.test.mjs — Defends against F-N1-class "never instantiated" bugs.
 *
 * Per TESTING_PROTOCOL.md §4: the federation review found that the entire
 * Block 9/10 federation layer was implemented correctly but NEVER CALLED
 * from any daemon entrypoint. Unit tests of each factory passed; integration
 * tests of the modules passed; nothing tested whether the production wiring
 * path actually invoked them.
 *
 * This file is the structural fix. It maintains a list of `{factory, calledIn}`
 * pairs and grep-asserts that each factory is referenced from its expected
 * entrypoint. It's NOT a behavioral test — it can't catch a no-op stub. It
 * catches the specific failure mode where a factory has zero production
 * callers.
 *
 * To add a new factory: add a row below. To deliberately deprecate one:
 * remove the row (and the factory).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const REQUIRED_PRODUCTION_WIRES = [
  // F-N1: federation factories must be called from the memory daemon.
  { factory: 'createBroadcaster',      calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createOfferer',          calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createAcceptor',         calledIn: 'lib/federation-startup.mjs' },
  { factory: 'startFederation',        calledIn: 'bin/openclaw-memory-daemon.mjs' },

  // F-N2: registry + seenIds must be constructed at startup, not left null.
  { factory: 'createIdentityRegistry', calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createSeenEventCache',   calledIn: 'lib/federation-startup.mjs' },

  // Subscriber + scheduler should be wired from the daemon too.
  { factory: 'createSubscriber',       calledIn: 'bin/openclaw-memory-daemon.mjs' },
  { factory: 'createConsolidationScheduler', calledIn: 'bin/openclaw-memory-daemon.mjs' },
];

describe('production wiring manifest', () => {
  for (const { factory, calledIn } of REQUIRED_PRODUCTION_WIRES) {
    it(`regression_F-N1: ${factory} is called from ${calledIn}`, () => {
      let src;
      try {
        src = readFileSync(join(REPO_ROOT, calledIn), 'utf8');
      } catch (err) {
        assert.fail(`expected entrypoint ${calledIn} to exist (${err.message})`);
      }
      // Match `factory(`, `factory (`, or `factory<EOL or non-identifier>` — broad
      // enough that imports + invocations both count, narrow enough to catch
      // "no reference at all."
      const pattern = new RegExp(`\\b${factory}\\b`);
      assert.match(src, pattern,
        `${factory} must be referenced from ${calledIn} — see F-N1. ` +
        `If you intentionally removed it, also remove the row from REQUIRED_PRODUCTION_WIRES.`);
    });
  }
});
