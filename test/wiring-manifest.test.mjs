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
  // STUB_AUDIT wirings: Channel 5 (spreading activation) + real-time
  // extraction trigger. Lock them in via the manifest so a future refactor
  // that drops them fails the test.
  { factory: 'createGraphCache',       calledIn: 'bin/openclaw-memory-daemon.mjs' },
  { factory: 'createExtractionTrigger', calledIn: 'bin/openclaw-memory-daemon.mjs' },
  { factory: 'runFlush',               calledIn: 'bin/openclaw-memory-daemon.mjs' },
];

/**
 * Strip lines that look like ES module imports. This is a deliberately
 * conservative pass — we just want to make sure that a factory referenced
 * ONLY in an `import { X } from '...'` line doesn't get counted as "wired."
 *
 * F-P110 / F-Q412 fix: the previous test matched `\b${factory}\b` against
 * the whole source, which passed even when the factory was imported and
 * then ignored (the F-N107 daemon stub pattern: import the type-checker,
 * pass a function that does nothing).
 *
 * Now we strip import statements and require the factory name to appear
 * in call position (`factory(` or `factory (`).
 */
function stripImports(src) {
  return src
    // Strip multi-line import { ... } from '...';
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    // Strip multi-line import { ... } that span lines
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    // Strip default + namespace imports
    .replace(/^\s*import\s+\w+(?:\s*,\s*\{[^}]*\})?\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*import\s+\*\s+as\s+\w+\s+from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    // Strip dynamic-import destructure (still acceptable as "calling")
    // const { X } = await import(...) — leave these in since they ARE
    // call-position uses
    ;
}

describe('production wiring manifest', () => {
  for (const { factory, calledIn } of REQUIRED_PRODUCTION_WIRES) {
    it(`regression_F-N1: ${factory} is invoked (call position) in ${calledIn}`, () => {
      let src;
      try {
        src = readFileSync(join(REPO_ROOT, calledIn), 'utf8');
      } catch (err) {
        assert.fail(`expected entrypoint ${calledIn} to exist (${err.message})`);
      }
      // Strip imports so a factory that's imported-but-never-called fails.
      const stripped = stripImports(src);
      // Match `factory(` or `factory (` — explicit call position. F-P110
      // / F-Q412: previously the regex was just `\b${factory}\b` which
      // a comment or leftover import would satisfy.
      const callPattern = new RegExp(`\\b${factory}\\s*\\(`);
      assert.match(stripped, callPattern,
        `${factory} must be INVOKED (call position) in ${calledIn} — not just imported. ` +
        `If the factory was renamed, update REQUIRED_PRODUCTION_WIRES. ` +
        `If intentionally inert, document the gap in memory-plan/STUB_AUDIT.md and remove the row. ` +
        `See F-N1 + F-P110 + F-Q412.`);
    });
  }
});
