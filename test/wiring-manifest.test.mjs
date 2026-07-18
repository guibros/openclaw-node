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
  // Since the daemon consolidation (structural_cleanups, 2026-07-18) there is
  // ONE daemon: workspace-bin/memory-daemon.mjs. The federation wiring that
  // used to live in the dormant bin/openclaw-memory-daemon.mjs is now its
  // initFederationSubsystems() section (opt-in via OPENCLAW_FEDERATION=1;
  // the manifest asserts call-position, which the gated section satisfies).
  { factory: 'createBroadcaster',      calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createOfferer',          calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createAcceptor',         calledIn: 'lib/federation-startup.mjs' },
  { factory: 'startFederation',        calledIn: 'workspace-bin/memory-daemon.mjs' },

  // F-N2: registry + seenIds must be constructed at startup, not left null.
  { factory: 'createIdentityRegistry', calledIn: 'lib/federation-startup.mjs' },
  { factory: 'createSeenEventCache',   calledIn: 'lib/federation-startup.mjs' },

  // Subscriber + in-process consolidation scheduler are wired from the same
  // federation section of the one daemon.
  { factory: 'createSubscriber',       calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'createConsolidationScheduler', calledIn: 'workspace-bin/memory-daemon.mjs' },
  // STUB_AUDIT wiring: Channel 5 (spreading activation) — the daemon's
  // getGraphCache() constructs it and both the inject server and federation
  // reuse the instance. (The extraction trigger + runFlush wires are locked
  // by the rows below — one daemon, no duplicate rows.)
  { factory: 'createGraphCache',       calledIn: 'workspace-bin/memory-daemon.mjs' },

  // R29 fix (repair 7.3): rows locking the live daemon's production wires
  // (Block-1 event producers, the watcher, the inject server, the tick
  // guard, the queue snapshot) so a refactor can't silently drop them. That
  // exact failure mode shipped once.
  { factory: 'emitIngestEvent',         calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'emitExtractEvent',        calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'emitSynthesizeEvent',     calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'emitErrorEvent',          calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'createLocalEventLog',     calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'createMemoryWatcher',     calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'runStoreHealthProbes',    calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'startInjectionServer',    calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'createExtractionTrigger', calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'createConcurrencyGuard',  calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'exportStateSnapshot',     calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'appendWatcherRecord',     calledIn: 'workspace-bin/memory-daemon.mjs' },
  // The flush runs OFF the daemon's main thread since the flush-worker change
  // (audits/flush_worker): the daemon invokes runFlushInWorker at every flush
  // site, and the worker is the one that calls the real runFlush. Both wires
  // are locked so neither half can be silently dropped.
  { factory: 'runFlushInWorker',        calledIn: 'workspace-bin/memory-daemon.mjs' },
  { factory: 'runFlush',                calledIn: 'workspace-bin/flush-worker.mjs' },
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
