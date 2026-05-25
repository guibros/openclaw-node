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

  state.currentJob = { type, started_at: startedAt, payload_size: payloadSize, eta_ms: eta, model: opts.model };
  state.totals.runs++;

  try {
    const result = await run();
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
    if (err.name === 'AbortError' || /timeout|aborted/i.test(err.message)) {
      state.consecutiveTimeouts[type]++;
      state.totals.timeouts++;
    }
    return { ok: false, error: err, ms };
  } finally {
    state.currentJob = null;
    drainPending();
  }
}

function drainPending() {
  if (state.currentJob || !state.pending.length) return;
  // Priority: analysis before extraction (realtime ahead of background).
  let nextIdx = state.pending.findIndex(j => j.type === 'analysis');
  if (nextIdx < 0) nextIdx = 0;
  const next = state.pending.splice(nextIdx, 1)[0];
  next._fire();
}

function enqueueJob(type, run, opts) {
  return new Promise((resolve, reject) => {
    if (state.shuttingDown) {
      reject(new Error('queue is shutting down'));
      return;
    }
    const enqueuedAt = Date.now();
    const entry = {
      type, enqueued_at: enqueuedAt,
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
  const waitTimeoutMs = opts.waitTimeoutMs ?? Number(process.env.ANALYSIS_TIMEOUT_MS ?? 1000);

  // If a long-running extraction is in flight, fall back immediately (don't even queue).
  if (state.currentJob?.type === 'extraction') {
    return fallback('ollama-busy-extraction');
  }

  // Race the queued job against the wait timeout.
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, waitTimeoutMs);

  try {
    const jobPromise = runWithRetry('analysis', run, opts);
    const winner = await Promise.race([
      jobPromise,
      delay(waitTimeoutMs).then(() => ({ ok: false, error: new Error('analysis wait timeout'), timeout: true })),
    ]);
    clearTimeout(timer);
    if (winner.timeout) return fallback('analysis-wait-timeout');
    if (!winner.ok) {
      if (/timeout|aborted/i.test(winner.error.message)) return fallback('analysis-call-timeout');
      throw winner.error;
    }
    return { mode: 'llm', value: winner.value, ms: winner.ms };
  } finally {
    clearTimeout(timer);
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
  // Network/transient signals — retry
  if (err.code === 'ECONNRESET') return true;
  if (err.code === 'ECONNREFUSED') return true;
  if (err.code === 'ETIMEDOUT') return true;
  if (err.code === 'EAI_AGAIN') return true;
  if (/socket hang up|terminated|ENOTFOUND/i.test(err.message)) return true;
  // HTTP 502/503/504 — proxy/gateway/upstream issues, usually transient
  if (/HTTP 50[234]/i.test(err.message)) return true;
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

/**
 * Check if Ollama appears stuck (STUCK_TIMEOUTS consecutive timeouts on one type).
 * Used by health-watch to trigger auto-restart.
 */
export function isStuck() {
  return state.consecutiveTimeouts.extraction >= STUCK_TIMEOUTS
      || state.consecutiveTimeouts.analysis   >= STUCK_TIMEOUTS;
}

/**
 * Record that an auto-restart was performed externally. Resets stuck counters.
 */
export function recordAutoRestart(reason) {
  state.recentRestarts.push({ ts: Date.now(), reason });
  pruneRecent(state.recentRestarts);
  state.consecutiveTimeouts.extraction = 0;
  state.consecutiveTimeouts.analysis = 0;
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Stop accepting new requests and wait up to SHUTDOWN_GRACE for in-flight to drain.
 * Returns true if drained cleanly, false if drain timed out.
 */
export async function shutdown(graceMs = SHUTDOWN_GRACE) {
  state.shuttingDown = true;
  const deadline = Date.now() + graceMs;
  while ((state.currentJob || state.pending.length) && Date.now() < deadline) {
    await delay(200);
  }
  // Reject any pending jobs that didn't drain in time.
  for (const p of state.pending) {
    try { p._fire = () => {}; } catch {}
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
