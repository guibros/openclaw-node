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
  let graphCache = null;            // STUB_AUDIT fix: Channel 5 now wired
  let federation = null;
  let subscriber = null;
  let scheduler = null;
  let extractionTrigger = null;     // STUB_AUDIT fix: real-time extraction now wired
  let extractionStore = null;
  let shuttingDown = false;

  const cleanup = async (sig) => {
    if (shuttingDown) {
      // Re-entry guard: a second SIGTERM during shutdown is a no-op.
      log(`[daemon] ${sig || 'cleanup'} ignored: already shutting down`);
      return;
    }
    shuttingDown = true;
    if (sig) log(`[daemon] received ${sig} — shutting down...`);
    try { extractionTrigger?.stop?.(); } catch (e) { log(`[daemon] extractionTrigger.stop error: ${e.message}`); }
    try { scheduler?.stop?.(); } catch (e) { log(`[daemon] scheduler.stop error: ${e.message}`); }
    try { if (subscriber) await subscriber.stop(); } catch (e) { log(`[daemon] subscriber.stop error: ${e.message}`); }
    try { if (federation) await federation.stop(); } catch (e) { log(`[daemon] federation.stop error: ${e.message}`); }
    try { graphCache?.close?.(); } catch { /* ignore */ }
    try { if (nc) await nc.drain(); } catch (e) { log(`[daemon] nc.drain error: ${e.message}`); }
    try { knowledgeDb?.close(); } catch { /* ignore */ }
    try { extractionStore?.close(); } catch { /* ignore */ }
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
    const { openStore } = await import('../lib/sqlite-store.mjs');
    const knowledgeDbPath = process.env.OPENCLAW_KNOWLEDGE_DB || join(dbDir, 'knowledge.db');
    // C1 fix (deep review 2026-07-03): extraction tables live in state.db —
    // the session-store database that extraction-store, the inject server,
    // and extract-existing-sessions all use. The old default (extraction.db)
    // split the daemon's reads (federation, consolidation) from its writes:
    // consolidation ran against a 0-byte DB forever while logging success.
    const extractionDbPath = process.env.OPENCLAW_EXTRACTION_DB || join(dbDir, 'state.db');
    knowledgeDb = existsSync(knowledgeDbPath) ? openStore(knowledgeDbPath) : null;
    extractionDb = existsSync(extractionDbPath) ? openStore(extractionDbPath) : null;
    if (!knowledgeDb || !extractionDb) {
      log(`[daemon] WARNING: knowledge.db or extraction.db missing — federation will run in broadcast-only mode (no offerer/acceptor)`);
    }

    // STUB_AUDIT fix: Channel 5 (spreading activation) was inert in the
    // daemon because we didn't construct a graphCache to pass through to
    // federation-startup → retrieval pipeline. Now constructed and threaded.
    // The cache reads the Obsidian vault and persists to ~/.openclaw/graph-cache.db.
    // If the vault doesn't exist (no notes yet), createGraphCache still works —
    // queryNeighbors returns empty edges, Channel 5 just contributes nothing.
    try {
      const { createGraphCache } = await import('./obsidian-graph-cache.mjs');
      graphCache = createGraphCache();
      // Build the initial cache so the first retrieval has data. Async; the
      // watcher (if started) will keep it in sync as the vault changes.
      if (graphCache.refreshCache) {
        await graphCache.refreshCache().catch(err =>
          log(`[daemon] graphCache initial refresh failed (non-fatal): ${err.message}`));
      }
      if (graphCache.startWatcher) graphCache.startWatcher();
      log(`[daemon] graph cache constructed (Channel 5 active)`);
    } catch (err) {
      log(`[daemon] graphCache unavailable (${err.message}) — Channel 5 will be inert`);
      graphCache = null;
    }

    // Federation (F-N1/N2/N3). Strict mode by default; operator must trust
    // peers via bin/openclaw-trust-peer before they're accepted.
    federation = await startFederation(nc, nodeId, {
      extractionDb,
      knowledgeDb,
      graphCache,
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

    // STUB_AUDIT fix: real-time extraction trigger. Previously the
    // PreCompact hooks fired `mesh.memory.extract_request` events that
    // had no subscriber — entire real-time extraction flow was dead.
    // Now the daemon subscribes, finds the active session's JSONL, and
    // calls runFlush. The idle-timer fallback also runs (publishing a
    // self-extraction every 45 min if nothing else has fired).
    try {
      const { createExtractionTrigger } = await import('../lib/extraction-trigger.mjs');
      const { runFlush } = await import('../lib/pre-compression-flush.mjs');
      const { createExtractionStore } = await import('../lib/extraction-store.mjs');
      const { createLlmClient } = await import('../lib/llm-client.mjs');

      // Resolve runtime deps for the extract handler. Same DB file as the
      // raw extractionDb handle above (own connection; WAL makes that safe).
      extractionStore = extractionDb ? createExtractionStore({ dbPath: extractionDbPath }) : null;
      let llmClient = null;
      try { llmClient = createLlmClient(); }
      catch (e) { log(`[daemon] LLM client unavailable: ${e.message}`); }

      // Find the active session's JSONL — same convention as heartbeat-detect:
      // scan ~/.openclaw/agents/main/sessions/ for the newest .jsonl.
      const findActiveTranscript = () => {
        const sessionsDir = join(homedir(), '.openclaw/agents/main/sessions');
        if (!existsSync(sessionsDir)) return null;
        const { readdirSync, statSync } = _require('fs');
        try {
          const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
          if (!files.length) return null;
          const newest = files
            .map(f => ({ f, mtime: statSync(join(sessionsDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0];
          return join(sessionsDir, newest.f);
        } catch { return null; }
      };

      // Serialize flushes: a flush takes 1–15 min; concurrent extract requests
      // (or an idle fire during one) must not run overlapping runFlush passes —
      // they'd double the LLM work and race on the store. Guard to one in-flight
      // flush; a request arriving mid-flush sets `pending` so we do exactly one
      // more pass afterward to capture the latest transcript (dedup makes that
      // pass a cheap no-op if nothing changed).
      let flushInFlight = false;
      let flushPending = false;
      const runFlushGuarded = async (triggeredBy) => {
        if (flushInFlight) {
          flushPending = true;
          log(`[daemon] flush already running — coalescing request (triggered_by=${triggeredBy})`);
          return;
        }
        flushInFlight = true;
        try {
          do {
            flushPending = false;
            const jsonlPath = findActiveTranscript();
            if (!jsonlPath) {
              log(`[daemon] extract requested by ${triggeredBy} but no active transcript found — skipping`);
              break;
            }
            const memoryMdPath = jsonlPath.replace(/\.jsonl$/, '.memory.md');
            log(`[daemon] running flush for ${jsonlPath} (triggered_by=${triggeredBy})`);
            try {
              const result = await runFlush(jsonlPath, memoryMdPath, { llmClient, extractionStore });
              log(`[daemon] flush complete: mode=${result.mode}, facts=${result.facts}, added=${result.added}, merged=${result.merged}`);
            } catch (err) {
              log(`[daemon] flush failed: ${err.message}`);
            }
          } while (flushPending);
        } finally {
          flushInFlight = false;
          // A completed flush is the new activity baseline — re-arm the idle
          // timer so the fallback keeps firing (it dies after one fire
          // otherwise: idle-timer messages deliberately don't self-re-arm).
          extractionTrigger?.resetIdleTimer?.();
        }
      };

      extractionTrigger = createExtractionTrigger(nc, nodeId, {
        onExtract: (payload) => { void runFlushGuarded(payload.triggered_by); },
      });
      await extractionTrigger.start();
      log(`[daemon] extraction trigger active on ${join('mesh.memory.extract_request')}`);
    } catch (err) {
      log(`[daemon] extraction trigger startup failed (non-fatal): ${err.message}`);
      extractionTrigger = null;
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
