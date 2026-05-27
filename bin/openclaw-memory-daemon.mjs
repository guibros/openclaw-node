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

  // NATS
  const { connect } = _require('nats');
  const nc = await connect({ servers: natsUrl, reconnect: true, maxReconnectAttempts: -1 });
  log(`[daemon] NATS connected`);

  // Open the DBs that federation + subscriber need.
  // Federation needs both extraction-store (concepts/decisions/themes) AND
  // the knowledge DB (session_chunks for FTS / semantic retrieval).
  const Database = _require('better-sqlite3');
  const knowledgeDbPath = process.env.OPENCLAW_KNOWLEDGE_DB || join(dbDir, 'knowledge.db');
  const extractionDbPath = process.env.OPENCLAW_EXTRACTION_DB || join(dbDir, 'extraction.db');
  const knowledgeDb = existsSync(knowledgeDbPath) ? new Database(knowledgeDbPath) : null;
  const extractionDb = existsSync(extractionDbPath) ? new Database(extractionDbPath) : null;
  if (!knowledgeDb || !extractionDb) {
    log(`[daemon] WARNING: knowledge.db or extraction.db missing — federation will run in broadcast-only mode (no offerer/acceptor)`);
  }

  // Federation (F-N1/N2/N3). Strict mode by default; operator must trust
  // peers via bin/openclaw-trust-peer before they're accepted.
  const federation = await startFederation(nc, nodeId, {
    extractionDb,
    knowledgeDb,
    log,
  });

  // Memory subscriber — consumes shared-stream events.
  // F-P107/F-P113 fix: previously this had a logging-only onIngest that acked
  // events into the void (the exact F-N107 evaporation pattern with a log
  // line). Until Block 11 lands the shared-knowledge projection path, the
  // safest behavior is to NOT subscribe at all so events accumulate in
  // JetStream for the eventual real consumer (the durable consumer's
  // deliver_policy:'new' bound matters here — once subscribed, only events
  // from the join point forward are delivered).
  //
  // Operators that want the subscriber active right now (e.g. for testing
  // shared-stream wiring) set OPENCLAW_SUBSCRIBER_PROJECTION=stub. The stub
  // mode is explicit and noisy: every ingest logs at INFO so the operator
  // sees that events are being CONSUMED but not projected.
  let subscriber = null;
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
  const scheduler = createConsolidationScheduler({
    dbPath: extractionDbPath,
    log,
  });
  if (extractionDb) {
    scheduler.start();
    log(`[daemon] consolidation scheduler started`);
  }

  // Graceful shutdown
  const shutdown = async (sig) => {
    log(`[daemon] received ${sig} — shutting down...`);
    try { scheduler.stop?.(); } catch {}
    try { if (subscriber) await subscriber.stop(); } catch {}
    try { await federation.stop(); } catch {}
    try { await nc.drain(); } catch {}
    log(`[daemon] stopped`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
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
