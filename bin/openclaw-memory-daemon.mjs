#!/usr/bin/env node
/**
 * openclaw-memory-daemon.mjs — Top-level memory daemon.
 *
 * F-N1 fix: this is the production entrypoint that actually instantiates the
 * federation factories (broadcaster, offerer, acceptor) along with the
 * subscriber, scheduler, and consolidation cycle. Before this file existed,
 * Cluster A's signing/auth/replay protections were correctly implemented but
 * never reached at runtime — no `bin/` script called createBroadcaster /
 * createOfferer / createAcceptor.
 *
 * Components:
 *   - federation-startup: identity, registry (strict), seen-cache, the 3 federation modules
 *   - memory-subscriber:  consumes shared stream events (signed by peers)
 *   - consolidation-scheduler: periodic memory consolidation cycle
 *
 * Environment:
 *   OPENCLAW_NODE_ID         — this node's id (default: hostname)
 *   NATS_URL                 — NATS server (default: nats://localhost:4222)
 *   OPENCLAW_TRUST_MODE      — 'strict' (default) | 'tofu' (dev only)
 *   OPENCLAW_DB_DIR          — DB directory (default: ~/.openclaw)
 *   OPENCLAW_REQUIRE_SIGNED  — '1' (default) | '0' (dev only)
 *
 * Onboarding for multi-node deployments — see bin/openclaw-trust-peer.mjs.
 */

import os from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

import { startFederation, defaultNodeId } from '../lib/federation-startup.mjs';

const log = (msg) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);

async function main() {
  const nodeId = defaultNodeId();
  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
  const dbDir = process.env.OPENCLAW_DB_DIR || join(homedir(), '.openclaw');

  log(`[daemon] starting node=${nodeId}, nats=${natsUrl}, dbDir=${dbDir}`);

  // F-P102/F-P103 fix: cleanup-closure pattern + early signal handlers.
  // Previously the SIGINT/SIGTERM handlers registered AFTER all startup
  // awaits, so a signal arriving during startup left NATS subs, DBs, and
  // timers leaked. And the outer .catch did process.exit(1) without any
  // cleanup. Now: handlers register FIRST, and `cleanup` grows as resources
  // are acquired. A signal at any point triggers full teardown of what
  // exists so far.
  let nc = null;
  let knowledgeDb = null;
  let extractionDb = null;
  let federation = null;
  let subscriber = null;
  let scheduler = null;
  let shuttingDown = false;

  const cleanup = async (sig) => {
    if (shuttingDown) {
      // Re-entry guard: a second SIGTERM during shutdown is a no-op.
      log(`[daemon] ${sig || 'cleanup'} ignored: already shutting down`);
      return;
    }
    shuttingDown = true;
    if (sig) log(`[daemon] received ${sig} — shutting down...`);
    try { scheduler?.stop?.(); } catch (e) { log(`[daemon] scheduler.stop error: ${e.message}`); }
    try { if (subscriber) await subscriber.stop(); } catch (e) { log(`[daemon] subscriber.stop error: ${e.message}`); }
    try { if (federation) await federation.stop(); } catch (e) { log(`[daemon] federation.stop error: ${e.message}`); }
    try { if (nc) await nc.drain(); } catch (e) { log(`[daemon] nc.drain error: ${e.message}`); }
    try { knowledgeDb?.close(); } catch { /* ignore */ }
    try { extractionDb?.close(); } catch { /* ignore */ }
    log(`[daemon] stopped`);
  };

  // Register signal handlers BEFORE any await. SIGTERM during startup
  // now runs cleanup against whatever has been built so far.
  process.on('SIGINT',  () => { cleanup('SIGINT').then(() => process.exit(0)).catch(() => process.exit(1)); });
  process.on('SIGTERM', () => { cleanup('SIGTERM').then(() => process.exit(0)).catch(() => process.exit(1)); });

  try {
    // NATS
    const { connect } = _require('nats');
    nc = await connect({ servers: natsUrl, reconnect: true, maxReconnectAttempts: -1 });
    log(`[daemon] NATS connected`);

    // Open the DBs that federation + subscriber need.
    // Federation needs both extraction-store (concepts/decisions/themes) AND
    // the knowledge DB (session_chunks for FTS / semantic retrieval).
    const Database = _require('better-sqlite3');
    const knowledgeDbPath = process.env.OPENCLAW_KNOWLEDGE_DB || join(dbDir, 'knowledge.db');
    const extractionDbPath = process.env.OPENCLAW_EXTRACTION_DB || join(dbDir, 'extraction.db');
    knowledgeDb = existsSync(knowledgeDbPath) ? new Database(knowledgeDbPath) : null;
    extractionDb = existsSync(extractionDbPath) ? new Database(extractionDbPath) : null;
    if (!knowledgeDb || !extractionDb) {
      log(`[daemon] WARNING: knowledge.db or extraction.db missing — federation will run in broadcast-only mode (no offerer/acceptor)`);
    }

    // Federation (F-N1/N2/N3). Strict mode by default; operator must trust
    // peers via bin/openclaw-trust-peer before they're accepted.
    federation = await startFederation(nc, nodeId, {
      extractionDb,
      knowledgeDb,
      log,
    });

    // Memory subscriber — consumes shared-stream events.
    // F-P107/F-P113 fix: subscriber DISABLED by default until Block 11
    // projection lands. See header comment for the reasoning.
    const subscriberMode = process.env.OPENCLAW_SUBSCRIBER_PROJECTION;
    if (subscriberMode === 'stub') {
      const { createSubscriber } = await import('./memory-subscriber.mjs');
      subscriber = await createSubscriber(nc, nodeId, {
        onIngest: (event, parsed) => {
          log(`[daemon] SUBSCRIBER-STUB acked-without-projection ${parsed.category} ${event.event_id}`);
        },
        onSkip: (_event, result) => {
          if (result.reason !== 'deferred_to_block_9') {
            log(`[daemon] subscriber skipped (${result.reason})`);
          }
        },
        onError: (ctx, err) => log(`[daemon] subscriber error in ${ctx}: ${err.message}`),
      });
      log(`[daemon] subscriber started in STUB mode — events will be ACKED WITHOUT PROJECTION`);
    } else {
      log(`[daemon] subscriber DISABLED (Block 11 projection not yet implemented). ` +
          `Events accumulate in JetStream until a real projection is wired. ` +
          `Set OPENCLAW_SUBSCRIBER_PROJECTION=stub to ack-without-project for testing.`);
    }

    // Consolidation scheduler — periodic memory consolidation cycle with hard-cap.
    // F-N100: signal propagates through runConsolidationCycle to each step.
    const { createConsolidationScheduler } = await import('./consolidation-scheduler.mjs');
    scheduler = createConsolidationScheduler({
      dbPath: extractionDbPath,
      log,
    });
    if (extractionDb) {
      scheduler.start();
      log(`[daemon] consolidation scheduler started`);
    }

    log(`[daemon] startup complete`);
  } catch (err) {
    log(`[daemon] startup failed: ${err?.message || err}`);
    await cleanup();  // F-P102: run cleanup against whatever was built
    throw err;
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  main().catch(err => {
    process.stderr.write(`[daemon] fatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}
