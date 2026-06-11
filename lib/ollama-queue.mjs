/**
 * ollama-queue.mjs — Single-instance request manager for the local LLM.
 *
 * Wraps all Ollama traffic in a serialized queue with priority semantics,
 * historical wall-time tracking, retry-with-backoff for transient failures,
 * slow-request alarms, auto-restart on stuck detection, and graceful shutdown.
 *
 * Why a queue: Ollama serializes per-model anyway. Without our own queue
 * the contention between background extraction and realtime query analysis
 * is invisible to the caller — analysis just hangs waiting behind extraction.
 * With the queue we can observe the contention, surface warnings, and let
 * analysis fall back to embedding-only mode when extraction is hot.
 *
 * Job types:
 *   - 'extraction' — background, long-running (5-15 min), no fallback. Just wait.
 *   - 'analysis'   — realtime, short timeout (default 1s), embedding-fallback on timeout.
 *
 * Singleton: one queue per process. Use getQueue() from anywhere.
 *
 * @module lib/ollama-queue
 */

import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { atomicWriteFileSync } from './atomic-write.mjs';

// ─── Configuration ───────────────────────────────────────────────────────────

const ROLLING_WINDOW = 10;                                  // last N completions tracked per job type
const SLOW_FACTOR    = 2.0;                                  // slow if > N× rolling avg
const STUCK_TIMEOUTS = 3;                                    // consecutive timeouts triggering auto-restart
// Retry budget (ms). Env-overridable: comma-separated list of delays, or
// the literal string "none" to disable retries (backfill use case where
// retrying a long server timeout just wastes minutes per session).
const RETRY_DELAYS = (() => {
  const env = (process.env.OLLAMA_QUEUE_RETRIES ?? '').trim();
  if (env === 'none' || env === '0') return [];
  if (env) return env.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0);
  return [1000, 2000, 4000];                                 // default: 3 retries with exponential backoff
})();
const SHUTDOWN_GRACE = Number(process.env.SHUTDOWN_GRACE_MS) || 30_000;

// ─── Internal State ──────────────────────────────────────────────────────────

const state = {
  currentJob:        null,                                   // { type, started_at, model, payload_size, eta_ms }
  pending:           [],                                     // FIFO queue of { type, run, resolve, reject, enqueued_at }
  history:           { extraction: [], analysis: [] },       // rolling wall times in ms
  consecutiveTimeouts: { extraction: 0, analysis: 0 },       // per job type
  totals:            { runs: 0, timeouts: 0, retries: 0, fallbacks: 0, slowAlarms: 0 },
  shuttingDown:      false,
  recentSlowAlarms:  [],                                     // last N { ts, type, ratio } for health-watch
  recentFallbacks:   [],                                     // last N { ts, reason, ollama_state }
  recentRestarts:    [],                                     // last N { ts, reason }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avgMs(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function recordHistory(type, ms) {
  state.history[type].push(ms);
  if (state.history[type].length > ROLLING_WINDOW) state.history[type].shift();
}

function estimateEta(type, payloadSize) {
  // ETA based on historical tokens/sec extrapolated to payload size.
  // payloadSize is an opaque proxy: char count of the prompt or similar.
  const avg = avgMs(state.history[type]);
  if (!avg) return null;
  // First-pass heuristic: extractions scale roughly with payload, analyses are ~constant.
  if (type === 'extraction' && payloadSize > 0) {
    const avgPayload = 5000; // historical assumption; could track separately
    return Math.round(avg * (payloadSize / avgPayload));
  }
  return Math.round(avg);
}

function pruneRecent(arr, max = 50) {
  if (arr.length > max) arr.splice(0, arr.length - max);
}

// ─── Run a Job Through the Lock ──────────────────────────────────────────────

async function executeJob(type, run, opts = {}) {
  const startedAt = Date.now();
  const payloadSize = opts.payloadSize || 0;
  const eta = estimateEta(type, payloadSize);

  // F-N103 fix: capture our own job reference so the finally clause can
  // tell whether currentJob still belongs to us (or whether the wait-
  // timeout path already cleared it as abandoned and a fresh job took
  // the slot).
  const myJob = { type, started_at: startedAt, payload_size: payloadSize, eta_ms: eta, model: opts.model, abandoned: false, ticket: opts._ticket ?? null };
  state.currentJob = myJob;
  state.totals.runs++;

  try {
    // F-C6: pass opts.abortSignal (set by requestAnalysis's queueController)
    // so the run function can attach it to its fetch and abort cleanly when
    // requestAnalysis's wait-timeout fires. run() that doesn't need the
    // signal simply ignores its argument.
    const result = await run(opts.abortSignal);
    const ms = Date.now() - startedAt;
    recordHistory(type, ms);
    state.consecutiveTimeouts[type] = 0;

    // Slow-request alarm (2× rolling average)
    const avg = avgMs(state.history[type].slice(0, -1));      // exclude this run
    if (avg > 0 && ms > avg * SLOW_FACTOR) {
      const ratio = ms / avg;
      state.totals.slowAlarms++;
      state.recentSlowAlarms.push({ ts: Date.now(), type, ratio, ms, avg_ms: Math.round(avg) });
      pruneRecent(state.recentSlowAlarms);
    }

    return { ok: true, value: result, ms };
  } catch (err) {
    const ms = Date.now() - startedAt;
    // F-N105 fix: tightened stuck-detection match. Old regex
    // /timeout|aborted/i over the WHOLE error message fired on benign
    // server errors that happened to contain those words (e.g. a 500
    // body mentioning "aborted by user", a schema error referencing a
    // field named "timeout"). Three such matches would bump
    // consecutiveTimeouts[type] past the threshold, triggering health-
    // watch's destructive `ollama stop`. Switch to structured signals.
    const looksLikeRealTimeout =
      err?.name === 'AbortError' ||
      err?.code === 'ETIMEDOUT' ||
      err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
      err?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
      err?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
    if (looksLikeRealTimeout) {
      state.consecutiveTimeouts[type]++;
      state.totals.timeouts++;
    }
    return { ok: false, error: err, ms };
  } finally {
    // F-N103 fix: only clear currentJob if it's still OURS. If the wait-
    // timeout path already marked us abandoned and set currentJob = null,
    // a fresh job may have claimed the slot — don't stomp it.
    if (state.currentJob === myJob) {
      state.currentJob = null;
      drainPending();
    }
  }
}

function drainPending() {
  // F-H18 fix: don't drain new jobs when shutting down.
  if (state.shuttingDown) return;
  if (state.currentJob) return;
  // R11 fix (repair 3.2): drop entries whose caller already settled to
  // fallback — firing them would run an analysis nobody consumes.
  state.pending = state.pending.filter((p) => {
    if (p._ticket?.cancelled) {
      p._resolve({ ok: false, error: new Error('analysis abandoned before start'), ms: 0 });
      return false;
    }
    return true;
  });
  if (!state.pending.length) return;
  // Priority: analysis before extraction (realtime ahead of background).
  let nextIdx = state.pending.findIndex(j => j.type === 'analysis');
  if (nextIdx < 0) nextIdx = 0;
  const next = state.pending.splice(nextIdx, 1)[0];
  next._fire();
}

/** Cap on pending queue depth to prevent unbounded memory growth (F-C7). */
const MAX_PENDING = Number(process.env.OLLAMA_QUEUE_MAX_PENDING) || 50;

function enqueueJob(type, run, opts) {
  return new Promise((resolve, reject) => {
    if (state.shuttingDown) {
      reject(new Error('queue is shutting down'));
      return;
    }
    // F-C7: reject when pending queue is full to prevent memory growth.
    // Analysis is allowed in (it falls back fast); extraction over-limit rejects.
    if (type === 'extraction' && state.pending.length >= MAX_PENDING) {
      reject(new Error(`queue full: ${state.pending.length} pending extractions (cap ${MAX_PENDING})`));
      return;
    }
    const enqueuedAt = Date.now();
    const entry = {
      type, enqueued_at: enqueuedAt,
      _ticket: opts._ticket ?? null,
      _resolve: resolve,
      _reject: reject,
      _fire: () => {
        executeJob(type, run, opts).then(resolve, reject);
      },
    };
    if (!state.currentJob) {
      entry._fire();
    } else {
      state.pending.push(entry);
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run an extraction job. Always waits to completion; no fallback.
 *
 * @param {() => Promise<any>} run — async function performing the Ollama call
 * @param {object} [opts]
 * @param {number} [opts.payloadSize] — char count of prompt for ETA estimation
 * @param {string} [opts.model] — model identifier (for state reporting)
 * @returns {Promise<any>} — the run's return value
 * @throws if the underlying Ollama call throws
 */
export async function requestExtraction(run, opts = {}) {
  const result = await runWithRetry('extraction', run, opts);
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * Run an analysis job. Has a wait timeout; returns a fallback marker if the
 * queue is busy with extraction or if the analysis itself times out.
 *
 * @param {() => Promise<any>} run — async function performing the Ollama call
 * @param {object} [opts]
 * @param {number} [opts.waitTimeoutMs=1000] — max wait + execution time before fallback
 * @param {number} [opts.payloadSize]
 * @param {string} [opts.model]
 * @returns {Promise<{mode: 'llm', value: any} | {mode: 'fallback', reason: string, ollama_state: object, eta_ms: number|null}>}
 */
export async function requestAnalysis(run, opts = {}) {
  // R43 fix (repair 3.4): ONE knob. The old queue-side ANALYSIS_TIMEOUT_MS
  // defaulted to 1000ms — the ceiling that made LLM analysis structurally
  // impossible — and stayed loaded for any direct caller after llm-client
  // moved to LLM_ANALYSIS_TIMEOUT (8000).
  const waitTimeoutMs = opts.waitTimeoutMs ?? Number(process.env.LLM_ANALYSIS_TIMEOUT ?? 8000);

  // If a long-running extraction is in flight, fall back immediately (don't even queue).
  if (state.currentJob?.type === 'extraction') {
    return fallback('ollama-busy-extraction');
  }

  // F-C6 fix: own an AbortController so we can cancel the in-flight Ollama
  // call when the wait-timeout wins the race. Pass the signal through opts
  // so the run function (e.g. llm-client.runFetch) can attach it to its fetch.
  // Without this, wait-timeout returning fallback leaves the underlying fetch
  // running, occupying the queue slot and bumping consecutiveTimeouts despite
  // the caller already having moved on.
  const queueController = new AbortController();
  // R11 fix (repair 3.2): per-call ticket so the timeout path can tell
  // whether the running job — and any pending entry — is actually OURS.
  const ticket = { cancelled: false };
  const optsWithSignal = { ...opts, abortSignal: queueController.signal, _ticket: ticket };

  try {
    const jobPromise = runWithRetry('analysis', run, optsWithSignal);
    const winner = await Promise.race([
      jobPromise,
      delay(waitTimeoutMs).then(() => ({ ok: false, error: new Error('analysis wait timeout'), timeout: true })),
    ]);
    if (winner.timeout) {
      // Abort the in-flight fetch so it doesn't leak the queue slot.
      queueController.abort(new Error('analysis-wait-timeout'));
      ticket.cancelled = true;
      // R11 fix: if our job never started, remove our pending entry —
      // otherwise drainPending later fires an analysis nobody consumes.
      const idx = state.pending.findIndex((p) => p._ticket === ticket);
      if (idx >= 0) {
        const [entry] = state.pending.splice(idx, 1);
        entry._resolve({ ok: false, error: new Error('analysis abandoned before start'), ms: 0 });
      }
      // F-N103 + R11: release the slot defensively ONLY when the running
      // job is ours (that's the one our abort signal actually cancels).
      // Abandoning another caller's job broke single-flight: the next job
      // drained while the foreign fetch was still in flight.
      if (state.currentJob && state.currentJob.ticket === ticket) {
        state.currentJob.abandoned = true;
        state.currentJob = null;
        drainPending();
      }
      return fallback('analysis-wait-timeout');
    }
    if (!winner.ok) {
      // F-N105 fix: structured timeout signals only (matches the tightened
      // detection in executeJob's catch). Regex on message body produced
      // false positives on benign 500s and schema errors.
      const e = winner.error;
      const isTimeout =
        e?.name === 'AbortError' ||
        e?.code === 'ETIMEDOUT' ||
        e?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        e?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
        e?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
      if (isTimeout) return fallback('analysis-call-timeout');
      throw winner.error;
    }
    return { mode: 'llm', value: winner.value, ms: winner.ms };
  } catch (err) {
    // F-C6: ensure we abort on error too, not just timeout
    if (!queueController.signal.aborted) {
      queueController.abort(err);
    }
    throw err;
  }
}

function fallback(reason) {
  state.totals.fallbacks++;
  const entry = {
    ts: Date.now(),
    reason,
    ollama_state: state.currentJob ? { ...state.currentJob, elapsed_ms: Date.now() - state.currentJob.started_at } : null,
    eta_ms: state.currentJob?.eta_ms ?? null,
  };
  state.recentFallbacks.push(entry);
  pruneRecent(state.recentFallbacks);
  return { mode: 'fallback', reason, ollama_state: entry.ollama_state, eta_ms: entry.eta_ms };
}

// ─── Retry With Backoff ──────────────────────────────────────────────────────

async function runWithRetry(type, run, opts) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const result = await enqueueJob(type, run, opts);
    if (result.ok) return result;
    lastErr = result.error;
    if (!isTransient(result.error)) break;
    if (attempt < RETRY_DELAYS.length) {
      state.totals.retries++;
      await delay(RETRY_DELAYS[attempt]);
    }
  }
  return { ok: false, error: lastErr, ms: 0 };
}

function isTransient(err) {
  if (!err) return false;
  // F-H15 fix: Node's global fetch (undici) wraps low-level errors in
  // `TypeError: fetch failed` with the real cause in `err.cause.code`.
  // Check both directly (.code) and via cause chain.
  const code = err.code ?? err.cause?.code;
  // Network/transient signals — retry
  if (code === 'ECONNRESET') return true;
  if (code === 'ECONNREFUSED') return true;
  if (code === 'ETIMEDOUT') return true;
  if (code === 'EAI_AGAIN') return true;
  if (code === 'UND_ERR_SOCKET') return true;
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return true;
  const msg = err.message || '';
  if (/socket hang up|terminated|ENOTFOUND/i.test(msg)) return true;
  // HTTP 502/503/504 — proxy/gateway/upstream issues, usually transient
  if (/HTTP 50[234]/i.test(msg)) return true;
  // HTTP 500 from Ollama, schema-validation errors, 4xx, malformed JSON, or
  // plain "fetch failed" (which on Ollama almost always means the server's
  // internal request deadline killed inference) — persistent for the same
  // prompt, don't retry. Same input → same failure → wasted minutes.
  return false;
}

// ─── State Inspection (for health-watch) ─────────────────────────────────────

/**
 * Snapshot of queue state for the health monitor.
 */
export function getState() {
  const now = Date.now();
  return {
    current_job: state.currentJob ? {
      type: state.currentJob.type,
      started_at: state.currentJob.started_at,
      elapsed_ms: now - state.currentJob.started_at,
      eta_ms: state.currentJob.eta_ms,
      model: state.currentJob.model,
    } : null,
    queue_depth: state.pending.length,
    history: {
      extraction: { count: state.history.extraction.length, avg_ms: Math.round(avgMs(state.history.extraction)) },
      analysis:   { count: state.history.analysis.length,   avg_ms: Math.round(avgMs(state.history.analysis))   },
    },
    consecutive_timeouts: { ...state.consecutiveTimeouts },
    totals: { ...state.totals },
    recent_slow_alarms: state.recentSlowAlarms.slice(-10),
    recent_fallbacks: state.recentFallbacks.slice(-10),
    recent_restarts: state.recentRestarts.slice(-10),
    shutting_down: state.shuttingDown,
  };
}

// ─── Cross-Process Snapshot (R12, repair 3.3) ────────────────────────────────
// Queue state is module-level memory — invisible to other processes. The
// daemon exports a snapshot each tick; health-watch (a separate process)
// reads the FILE instead of importing this module and seeing its own empty
// singleton, which made stuck-detection structurally impossible.

export const QUEUE_STATE_PATH = join(homedir(), '.openclaw', 'workspace', '.tmp', 'ollama-queue-state.json');

/** Write the current queue state for cross-process consumers. */
export function exportStateSnapshot(snapshotPath = QUEUE_STATE_PATH) {
  const snapshot = { ts: Date.now(), pid: process.pid, ...getState() };
  atomicWriteFileSync(snapshotPath, JSON.stringify(snapshot), { mkdirp: true });
  return snapshot;
}

/**
 * Read another process's queue snapshot. Returns null when missing,
 * unparseable, or older than maxAgeMs (a dead exporter must read as
 * "unknown", never as "idle").
 */
export function readStateSnapshot(snapshotPath = QUEUE_STATE_PATH, { maxAgeMs = 120_000 } = {}) {
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    if (typeof snapshot.ts !== 'number' || Date.now() - snapshot.ts > maxAgeMs) return null;
    return snapshot;
  } catch {
    return null;
  }
}

/** Stuck evaluation over a snapshot (same rule as isStuck, cross-process). */
export function snapshotLooksStuck(snapshot) {
  return (snapshot?.consecutive_timeouts?.extraction ?? 0) >= STUCK_TIMEOUTS;
}

/**
 * Check if Ollama appears stuck (consecutive timeouts on extraction).
 * F-H17 fix: only count EXTRACTION timeouts toward stuck detection.
 * Analysis defaults to a 1s wait — a cold model load takes 5-15s, which
 * trips three "stuck" hits in 5 seconds → triggers auto-restart → evicts
 * the loading model → another cold load → cycle. Excluding analysis from
 * stuck detection breaks that loop.
 *
 * Used by health-watch to trigger auto-restart.
 */
export function isStuck() {
  return state.consecutiveTimeouts.extraction >= STUCK_TIMEOUTS;
}

/** F-H16: rate-limit window for auto-restart loops. */
const RESTART_LOOP_WINDOW_MS = 15 * 60 * 1000;  // 15 min
const RESTART_LOOP_MAX = 3;                       // max 3 restarts per window

/**
 * Record that an auto-restart was performed externally. Resets stuck counters.
 *
 * F-H16 fix: enforces a rate limit. If N restarts have happened in the last
 * RESTART_LOOP_WINDOW_MS, refuse to record/reset → caller (health-watch)
 * sees `{ rateLimited: true }` and abstains from restarting. Without this,
 * a deeper Ollama failure (disk full, corrupt model) triggers infinite
 * restart-stop-load-fail cascade every 60s.
 *
 * @returns {{ recorded: boolean, rateLimited: boolean, restartsInWindow: number }}
 */
export function recordAutoRestart(reason) {
  const now = Date.now();
  const recent = state.recentRestarts.filter(r => now - r.ts < RESTART_LOOP_WINDOW_MS);
  if (recent.length >= RESTART_LOOP_MAX) {
    return { recorded: false, rateLimited: true, restartsInWindow: recent.length };
  }
  state.recentRestarts.push({ ts: now, reason });
  pruneRecent(state.recentRestarts);
  state.consecutiveTimeouts.extraction = 0;
  state.consecutiveTimeouts.analysis = 0;
  return { recorded: true, rateLimited: false, restartsInWindow: recent.length + 1 };
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Stop accepting new requests and wait up to SHUTDOWN_GRACE for in-flight to drain.
 * Returns true if drained cleanly, false if drain timed out.
 *
 * F-N104 (HIGH, documentation): shutdown is TERMINAL by design. Once called,
 * state.shuttingDown stays true for the rest of the process lifetime — every
 * subsequent enqueueJob() rejects with "queue is shutting down". This is
 * intentional for the deployed daemon model (process exits after shutdown).
 *
 * Do NOT add a "reset shuttingDown after drain" path here. That would race
 * any concurrent SIGTERM redelivery and let a new request slip in during
 * what the operator believes is a graceful drain. For hot-reload scenarios
 * (SIGUSR2 to reload config without restart), the right answer is to
 * destroy the module's singleton state entirely and re-construct — which
 * requires moving state off module scope first. Until that refactor lands,
 * shutdown stays one-shot. `_resetForTesting()` exists for unit tests only.
 *
 * @param {number} [graceMs=SHUTDOWN_GRACE]
 * @returns {Promise<boolean>} true if drained cleanly, false if drain timed out
 */
export async function shutdown(graceMs = SHUTDOWN_GRACE) {
  state.shuttingDown = true;
  const deadline = Date.now() + graceMs;
  // Wait for in-flight + queued jobs to drain naturally (up to graceMs).
  while ((state.currentJob || state.pending.length) && Date.now() < deadline) {
    await delay(200);
  }
  // F-C5 fix: reject ANY remaining pending entries via their stored reject fn.
  // Previously we set _fire = () => {} which silently abandoned promises —
  // callers awaiting requestExtraction()/requestAnalysis() hung forever.
  const shutdownErr = new Error('queue shutdown: pending job cancelled');
  for (const p of state.pending) {
    try {
      if (typeof p._reject === 'function') p._reject(shutdownErr);
    } catch {}
  }
  state.pending = [];
  return !state.currentJob;
}

// ─── Test/Reset Hook ─────────────────────────────────────────────────────────
// Exposed for unit tests; do not call from production code.

export function _resetForTesting() {
  state.currentJob = null;
  state.pending = [];
  state.history = { extraction: [], analysis: [] };
  state.consecutiveTimeouts = { extraction: 0, analysis: 0 };
  state.totals = { runs: 0, timeouts: 0, retries: 0, fallbacks: 0, slowAlarms: 0 };
  state.shuttingDown = false;
  state.recentSlowAlarms = [];
  state.recentFallbacks = [];
  state.recentRestarts = [];
}
