#!/usr/bin/env node
/**
 * openclaw-status.mjs — Runtime inventory of memory daemon subsystems.
 *
 * Answers the question STUB_AUDIT.md surfaced: "the daemon starts cleanly,
 * but which subsystems are actually doing work?"
 *
 * Output for each subsystem: WIRED / STUB / NOT_WIRED, plus the env var or
 * code change that would alter the state. No-runtime version: introspects
 * the daemon source statically (does NOT require the daemon to be running).
 *
 * Usage:
 *   node bin/openclaw-status.mjs
 *   node bin/openclaw-status.mjs --json
 *
 * Each row is computed by:
 *   - grep for the factory/component in workspace-bin/memory-daemon.mjs
 *   - grep for the factory in lib/federation-startup.mjs
 *   - cross-check against the call-position rule (was it actually invoked?)
 *
 * Goal: give an operator (or me, during a review) a single command that
 * says exactly what's running. No more "the daemon starts and prints
 * startup complete" hiding three disabled subsystems.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DAEMON_PATH = join(REPO_ROOT, 'workspace-bin', 'memory-daemon.mjs');
const FED_STARTUP_PATH = join(REPO_ROOT, 'lib', 'federation-startup.mjs');

function readOrEmpty(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

const daemonSrc = readOrEmpty(DAEMON_PATH);
const fedSrc = readOrEmpty(FED_STARTUP_PATH);

/**
 * Test whether a factory is invoked (call position) in a given source.
 * Matches `factoryName(` or `factoryName (` — excludes import-only lines.
 */
function isInvoked(src, factoryName) {
  if (!src) return false;
  const callRe = new RegExp(`\\b${factoryName}\\s*\\(`, 'g');
  // Strip out import statements before testing
  const stripped = src.replace(/^\s*import\b[^\n]*$/gm, '');
  return callRe.test(stripped);
}

/**
 * Test whether a factory is just imported but never called.
 */
function isImportedNotCalled(src, factoryName) {
  if (!src) return false;
  const importRe = new RegExp(`\\bimport\\b[^;]*\\b${factoryName}\\b`);
  return importRe.test(src) && !isInvoked(src, factoryName);
}

// ─── Subsystem definitions ──────────────────────────────────────────────────

const subsystems = [
  {
    name: 'NATS connection',
    // The live daemon aliases the import: `const { connect: natsConnect } = require('nats')`
    check: () => isInvoked(daemonSrc, 'connect') || isInvoked(daemonSrc, 'natsConnect'),
    notWiredFix: 'Daemon must connect to NATS at startup (currently it does)',
  },
  {
    name: 'Federation: broadcaster',
    check: () => isInvoked(fedSrc, 'createBroadcaster'),
    notWiredFix: 'Wire createBroadcaster in lib/federation-startup.mjs',
  },
  {
    name: 'Federation: offerer',
    check: () => isInvoked(fedSrc, 'createOfferer'),
    notWiredFix: 'Wire createOfferer in lib/federation-startup.mjs',
  },
  {
    name: 'Federation: acceptor',
    check: () => isInvoked(fedSrc, 'createAcceptor'),
    notWiredFix: 'Wire createAcceptor in lib/federation-startup.mjs',
  },
  {
    name: 'Federation: identity registry',
    check: () => isInvoked(fedSrc, 'createIdentityRegistry'),
    notWiredFix: 'Wire createIdentityRegistry in lib/federation-startup.mjs',
  },
  {
    name: 'Federation: seenIds replay cache',
    check: () => isInvoked(fedSrc, 'createSeenEventCache'),
    notWiredFix: 'Wire createSeenEventCache in lib/federation-startup.mjs',
  },
  {
    name: 'Federation: retrieval pipeline',
    check: () => isInvoked(fedSrc, 'createRetrievalPipeline'),
    notWiredFix: 'Wire createRetrievalPipeline (depends on knowledgeDb + extractionDb)',
  },
  {
    name: 'Retrieval Channel 5: spreading activation (graphCache)',
    // The daemon must call createGraphCache AND pass it to startFederation.
    // federation-startup will pass it through to retrieval pipeline if non-null.
    check: () => isInvoked(daemonSrc, 'createGraphCache'),
    stubCondition: () => /graphCache:\s*null/.test(fedSrc) || /opts\.graphCache\s*\|\|\s*null/.test(fedSrc),
    notWiredFix: 'Daemon must call createGraphCache() and pass it to startFederation({ graphCache })',
  },
  {
    name: 'Subscriber projection (Block 11)',
    check: () => {
      // Wired if daemon imports + calls createSubscriber unconditionally.
      const importedAndCalled = /createSubscriber\s*\(/m.test(daemonSrc);
      const isGated = /OPENCLAW_SUBSCRIBER_PROJECTION/.test(daemonSrc);
      return importedAndCalled && !isGated;
    },
    stubCondition: () => /OPENCLAW_SUBSCRIBER_PROJECTION.*stub/.test(daemonSrc),
    notWiredFix: 'Implement projection in onIngest; remove env-gate. Today: OPENCLAW_SUBSCRIBER_PROJECTION=stub enables an ack-without-project mode.',
  },
  {
    name: 'Real-time extraction trigger (NATS subject mesh.memory.extract_request)',
    check: () => isInvoked(daemonSrc, 'createExtractionTrigger'),
    notWiredFix: 'Daemon must import + call createExtractionTrigger(nc, nodeId, { runFlush }). Without this, the PreCompact hooks publish to a subject with no subscriber.',
  },
  {
    name: 'Consolidation scheduler',
    check: () => isInvoked(daemonSrc, 'createConsolidationScheduler'),
    notWiredFix: 'Wire createConsolidationScheduler in daemon',
  },
  {
    name: 'Memory budget event recorder',
    // Live daemon: `import { createBudget } from '../lib/memory-budget.mjs'` via initMemoryBudget()
    check: () => isInvoked(daemonSrc, 'createMemoryBudget') || isInvoked(daemonSrc, 'new MemoryBudget') || isInvoked(daemonSrc, 'createBudget'),
    notWiredFix: 'Daemon must instantiate MemoryBudget if memory.session_*/fact_extracted events are wanted',
  },
  {
    name: 'Session store',
    // Live daemon: `new SessionStore()` inside the lazy getSessionStore() singleton
    check: () => isInvoked(daemonSrc, 'createSessionStore') || /new\s+SessionStore\s*\(/.test(daemonSrc),
    notWiredFix: 'Daemon must call createSessionStore() for session/message ingest. Today, only backfill scripts read the DB; nothing in production writes to it via this API.',
  },
  {
    name: 'Local event log signing/verify',
    check: () => isInvoked(daemonSrc, 'createLocalEventLog'),
    notWiredFix: 'Daemon must call createLocalEventLog() to enable signed local event stream',
  },
];

// ─── Status determination ───────────────────────────────────────────────────

function determine(s) {
  if (s.check()) return 'WIRED';
  if (s.stubCondition && s.stubCondition()) return 'STUB';
  return 'NOT_WIRED';
}

const rows = subsystems.map(s => ({
  name: s.name,
  status: determine(s),
  notWiredFix: s.notWiredFix,
}));

// ─── Output ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const json = args.includes('--json');

if (json) {
  process.stdout.write(JSON.stringify({
    daemonPath: DAEMON_PATH,
    federationStartupPath: FED_STARTUP_PATH,
    subsystems: rows,
    summary: {
      wired: rows.filter(r => r.status === 'WIRED').length,
      stub: rows.filter(r => r.status === 'STUB').length,
      notWired: rows.filter(r => r.status === 'NOT_WIRED').length,
    },
  }, null, 2) + '\n');
  process.exit(0);
}

// Pretty-print
const COLOR_WIRED = '\x1b[32m';      // green
const COLOR_STUB = '\x1b[33m';        // yellow
const COLOR_NOT = '\x1b[31m';         // red
const COLOR_RESET = '\x1b[0m';
const useColor = process.stdout.isTTY;
function paint(s, color) { return useColor ? `${color}${s}${COLOR_RESET}` : s; }

const STATUS_COLOR = { WIRED: COLOR_WIRED, STUB: COLOR_STUB, NOT_WIRED: COLOR_NOT };

process.stdout.write('OpenClaw memory daemon — subsystem inventory\n');
process.stdout.write('=============================================\n\n');

const longest = Math.max(...rows.map(r => r.name.length));
for (const r of rows) {
  const padded = r.name.padEnd(longest + 2, ' ');
  const statusStr = paint(r.status.padEnd(9), STATUS_COLOR[r.status]);
  process.stdout.write(`  ${padded}${statusStr}`);
  if (r.status !== 'WIRED' && r.notWiredFix) {
    process.stdout.write(`\n    └─ ${r.notWiredFix}`);
  }
  process.stdout.write('\n');
}

const summary = {
  wired: rows.filter(r => r.status === 'WIRED').length,
  stub: rows.filter(r => r.status === 'STUB').length,
  notWired: rows.filter(r => r.status === 'NOT_WIRED').length,
};
process.stdout.write('\n');
process.stdout.write(`Summary: ${paint(summary.wired + ' wired', COLOR_WIRED)}`);
process.stdout.write(`, ${paint(summary.stub + ' stub', COLOR_STUB)}`);
process.stdout.write(`, ${paint(summary.notWired + ' not wired', COLOR_NOT)} out of ${rows.length} total.\n`);

if (summary.notWired + summary.stub > 0) {
  process.stdout.write('\nSee memory-plan/STUB_AUDIT.md for the inventory rationale.\n');
}

process.exit(summary.notWired > 0 ? 1 : 0);
