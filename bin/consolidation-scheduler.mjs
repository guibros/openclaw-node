#!/usr/bin/env node

/**
 * consolidation-scheduler.mjs — Schedules consolidation cycles during quiet periods.
 *
 * Launchd fires this script every 30 minutes (StartInterval 1800).
 * The script checks whether the system is idle (no active LLM inference),
 * then runs one consolidation cycle with a 5-minute hard cap.
 *
 * Idle detection has two paths:
 *   - In-process: reads ollama-queue.getState() directly (when imported by daemon)
 *   - Standalone: probes Ollama HTTP API /api/ps (when run by launchd)
 *
 * Usage:
 *   node bin/consolidation-scheduler.mjs [--db <path>] [--vault-path <path>] [--interval <ms>]
 */

import { setTimeout as delay } from 'node:timers/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createConcurrencyGuard } from '../lib/concurrency-guard.mjs';

// A failed consolidation cycle breaks the memory cadence silently (launchd
// just restarts the one-shot) — escalate it to a ledgered desktop popup.
const NOTIFY_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'openclaw-notify.mjs');
const MC_MEMORY_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/memory`;
function notifyCycleFailure(message) {
  try {
    execFile(process.execPath, [
      NOTIFY_CLI, '--source', 'consolidation', '--kind', 'error',
      '--title', 'Consolidation cycle FAILED', '--message', message,
      '--url', MC_MEMORY_URL,
    ], { timeout: 10_000 }, () => {});
  } catch { /* best-effort */ }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum idle time before triggering a cycle (no extraction for this long). */
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum wall time for a single consolidation cycle. */
export const HARD_CAP_MS = 5 * 60 * 1000; // 5 minutes

/** No analysis activity within this window to qualify as idle. */
export const ANALYSIS_QUIET_MS = 60 * 1000; // 60 seconds

/** Default scheduler interval (30 minutes). */
export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const OLLAMA_BASE = process.env.LLM_BASE_URL || 'http://localhost:11434';

// ─── Idle Detection: Ollama HTTP ────────────────────────────────────────────

/**
 * Check if Ollama has no active inference requests via the HTTP API.
 * Returns true if idle (no models currently running inference).
 *
 * @param {string} [baseUrl] — Ollama base URL
 * @returns {Promise<boolean>}
 */
export async function isOllamaIdle(baseUrl) {
  const url = `${baseUrl || OLLAMA_BASE}/api/ps`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    // Ollama /api/ps returns { models: [...] } — empty array means idle
    if (!data.models || data.models.length === 0) return true;
    // Check if any model has active requests
    return data.models.every(m => !m.size_vram || m.size_vram === 0);
  } catch {
    // Ollama not reachable — treat as idle (consolidation doesn't need LLM for all jobs)
    return true;
  }
}

// ─── Idle Detection: In-process Queue ───────────────────────────────────────

/**
 * Check if the ollama-queue reports idle state.
 * Requires a getState function from the in-process ollama-queue singleton.
 *
 * @param {() => object} getStateFn — ollama-queue.getState
 * @returns {{ idle: boolean, reason: string|null }}
 */
export function isQueueIdle(getStateFn) {
  const state = getStateFn();

  // Current job running → not idle
  if (state.current_job) {
    return { idle: false, reason: `active ${state.current_job.type} job (elapsed ${state.current_job.elapsed_ms}ms)` };
  }

  // Pending jobs → not idle
  if (state.queue_depth > 0) {
    return { idle: false, reason: `${state.queue_depth} pending jobs` };
  }

  // Recent extraction activity — check if last extraction was within IDLE_THRESHOLD
  if (state.history.extraction.count > 0 && state.history.extraction.avg_ms > 0) {
    // We can't know exact last-completion time from getState(), but if the queue
    // has no current job and no pending jobs, it's effectively idle now.
    // The caller should combine this with time-since-last-extraction from the DB.
  }

  // Recent analysis activity — check recent fallbacks/alarms for recency
  const recentAnalysis = state.recent_fallbacks.filter(
    f => (Date.now() - f.ts) < ANALYSIS_QUIET_MS
  );
  if (recentAnalysis.length > 0) {
    return { idle: false, reason: `analysis activity within last ${ANALYSIS_QUIET_MS / 1000}s` };
  }

  return { idle: true, reason: null };
}

// ─── Combined Idle Check ────────────────────────────────────────────────────

/**
 * Determine if the system is idle enough to run a consolidation cycle.
 *
 * @param {object} [opts]
 * @param {() => object} [opts.getStateFn] — in-process queue state function
 * @param {string} [opts.ollamaBaseUrl] — Ollama API base URL
 * @returns {Promise<{ idle: boolean, reason: string|null }>}
 */
export async function isSystemIdle(opts = {}) {
  // Path 1: In-process queue state (preferred — more precise)
  if (opts.getStateFn) {
    const queueResult = isQueueIdle(opts.getStateFn);
    if (!queueResult.idle) return queueResult;
  }

  // Path 2: Ollama HTTP API (standalone fallback)
  const ollamaIdle = await isOllamaIdle(opts.ollamaBaseUrl);
  if (!ollamaIdle) {
    return { idle: false, reason: 'Ollama has active inference (HTTP /api/ps)' };
  }

  return { idle: true, reason: null };
}

// ─── Run With Timeout ───────────────────────────────────────────────────────

/**
 * Run a consolidation cycle with a hard time cap.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — extraction store DB path
 * @param {string} [opts.vaultPath] — Obsidian vault path
 * @param {number} [opts.hardCapMs] — timeout in ms (default HARD_CAP_MS)
 * @param {object} [opts.db] — pre-opened database (for testing)
 * @param {(opts: object) => Promise<object>} [opts.runCycle] — injectable cycle function (for testing)
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, durationMs: number }>}
 */
export async function runScheduledCycle(opts = {}) {
  const hardCap = opts.hardCapMs ?? HARD_CAP_MS;
  const startMs = Date.now();

  // Dynamically import runConsolidationCycle unless injected
  const runCycle = opts.runCycle || (await import('./consolidate.mjs')).runConsolidationCycle;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('hard cap')), hardCap);

  try {
    // F-H19 fix: pass ac.signal into runCycle so the work can actually be
    // cancelled when the hard cap fires. Previously the timeout fired,
    // Promise.race rejected, the function returned — but runCycle kept
    // running in the background. Repeated 30-min ticks then stacked
    // overlapping cycles racing on the same DB.
    const cyclePromise = runCycle({
      dbPath: opts.dbPath,
      vaultPath: opts.vaultPath,
      db: opts.db,
      signal: ac.signal,
      eventLog: opts.eventLog,
      nodeId: opts.nodeId,
    });

    const result = await Promise.race([
      cyclePromise.then(r => ({ ok: true, result: r })),
      new Promise((_, reject) => {
        ac.signal.addEventListener('abort', () =>
          reject(new Error(`consolidation cycle exceeded hard cap (${hardCap}ms)`))
        );
      }),
    ]);

    clearTimeout(timer);
    return { ...result, durationMs: Date.now() - startMs };
  } catch (err) {
    clearTimeout(timer);
    // F-H19: ensure abort fires so the runCycle promise sees cancellation
    if (!ac.signal.aborted) ac.abort(err);
    return { ok: false, error: err.message, durationMs: Date.now() - startMs };
  }
}

// ─── Scheduler Factory ──────────────────────────────────────────────────────

/**
 * Create an interval-based consolidation scheduler.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] — check interval (default 30 min)
 * @param {string} [opts.dbPath]
 * @param {string} [opts.vaultPath]
 * @param {() => object} [opts.getStateFn] — in-process queue state
 * @param {string} [opts.ollamaBaseUrl]
 * @param {number} [opts.hardCapMs]
 * @param {(msg: string) => void} [opts.log] — logger
 * @returns {{ start: () => void, stop: () => void, runOnce: () => Promise<object> }}
 */
export function createConsolidationScheduler(opts = {}) {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = opts.log || console.log;
  let timer = null;
  // F-P215 fix: shared createConcurrencyGuard helper. Replaces inline tracking.
  // F-Q306 addition: maxAgeMs caps how long a wedged cycle can lock out the
  // scheduler. After hardCapMs + 60s, force-clear so the next interval can
  // try again. The orphan resolves into the void.
  const hardCapMs = opts.hardCapMs ?? HARD_CAP_MS;
  const guardedCycle = createConcurrencyGuard(
    () => runScheduledCycle({
      dbPath: opts.dbPath,
      vaultPath: opts.vaultPath,
      hardCapMs: opts.hardCapMs,
      eventLog: opts.eventLog,
      nodeId: opts.nodeId,
    }),
    {
      maxAgeMs: hardCapMs + 60_000,
      log: (m) => log(`[consolidation-scheduler] ${m}`),
    }
  );

  async function runOnce() {
    const idleCheck = await isSystemIdle({
      getStateFn: opts.getStateFn,
      ollamaBaseUrl: opts.ollamaBaseUrl,
    });

    if (!idleCheck.idle) {
      log(`[consolidation-scheduler] skipping: ${idleCheck.reason}`);
      return { skipped: true, reason: idleCheck.reason };
    }

    log('[consolidation-scheduler] system idle — starting consolidation cycle');
    const result = await guardedCycle();
    if (result?.skipped) {
      log(`[consolidation-scheduler] skipping: ${result.reason}`);
      return result;
    }

    if (result.ok) {
      log(`[consolidation-scheduler] cycle complete (${result.durationMs}ms)`);
    } else {
      log(`[consolidation-scheduler] cycle failed: ${result.error} (${result.durationMs}ms)`);
      notifyCycleFailure(`${result.error} (${result.durationMs}ms)`);
    }

    return result;
  }

  function start() {
    if (timer) return;
    log(`[consolidation-scheduler] started (interval: ${intervalMs / 1000}s)`);
    timer = setInterval(() => {
      runOnce().catch(err => log(`[consolidation-scheduler] error: ${err.message}`));
    }, intervalMs);
    // Unref so the timer doesn't prevent process exit
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      log('[consolidation-scheduler] stopped');
    }
  }

  return { start, stop, runOnce };
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidation-scheduler.mjs')) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const vaultIdx = args.indexOf('--vault-path');
  const intervalIdx = args.indexOf('--interval');
  const daemon = args.includes('--daemon');
  const noEvents = args.includes('--no-events');

  const natsUrl = process.env.OPENCLAW_NATS || process.env.NATS_URL || 'nats://127.0.0.1:4222';
  const nodeId = process.env.OPENCLAW_NODE_ID || os.hostname();

  const cliOpts = { nodeId };
  if (dbIdx !== -1 && args[dbIdx + 1]) cliOpts.dbPath = args[dbIdx + 1];
  if (vaultIdx !== -1 && args[vaultIdx + 1]) cliOpts.vaultPath = args[vaultIdx + 1];
  if (intervalIdx !== -1 && args[intervalIdx + 1]) cliOpts.intervalMs = Number(args[intervalIdx + 1]);

  let nc = null;

  if (!noEvents) {
    try {
      const { connect } = await import('nats');
      const { createLocalEventLog } = await import('../lib/local-event-log.mjs');
      nc = await connect({ servers: natsUrl });
      cliOpts.eventLog = await createLocalEventLog(nc, nodeId);
      console.log(`NATS connected (${natsUrl}), events will be emitted.`);
    } catch (err) {
      console.warn(`NATS unavailable (${err.message}); running without event emission.`);
    }
  }

  const scheduler = createConsolidationScheduler(cliOpts);

  const cleanup = async () => {
    if (nc) { try { await nc.flush(); await nc.close(); } catch {} }
  };

  if (daemon) {
    // Long-running mode: run on interval
    scheduler.start();

    const shutdown = async () => {
      scheduler.stop();
      await cleanup();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // Single-shot mode (default for launchd): check idle → run → exit
    scheduler.runOnce()
      .then(async result => {
        if (result.skipped) {
          console.log(`Skipped: ${result.reason}`);
        } else if (result.ok) {
          console.log(`Consolidation complete (${result.durationMs}ms)`);
          const r = result.result;
          if (r) {
            console.log(`  Decayed: ${r.decayed?.decayedEntities ?? '?'} entities, ${r.decayed?.archivedEntities ?? '?'} archived`);
            console.log(`  Reinforced: ${r.reinforced?.reinforcedEntities ?? '?'} entities`);
            console.log(`  Clusters: ${r.clusters?.clusters?.length ?? '?'} detected`);
            console.log(`  Contradictions: ${r.contradictions?.total ?? '?'} found`);
            console.log(`  Promotion: ${r.promotionCandidates?.entityCandidates?.length ?? '?'} entities, ${r.promotionCandidates?.decisionCandidates?.length ?? '?'} decisions`);
          }
        } else {
          console.error(`Consolidation failed: ${result.error} (${result.durationMs}ms)`);
          await cleanup();
          process.exit(1);
        }
        await cleanup();
      })
      .catch(async err => {
        console.error(`Fatal: ${err.message}`);
        await cleanup();
        process.exit(1);
      });
  }
}
