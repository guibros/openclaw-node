/**
 * concurrency-guard.mjs — single-flight + deadlock-safe wrapper for async ops.
 *
 * Pass-1 + pass-2 reviews surfaced the same "concurrent-cycle-stacking" bug
 * shape twice (F-P215 in consolidation-scheduler — fixed inline, and F-P216
 * / F-Q406 in obsidian-graph-cache — still open). Both:
 *   - long-running async op fires from a setInterval AND a debounced event
 *   - the second trigger fires before the first finishes
 *   - both touch the same DB/file → SQLITE_BUSY, torn rebuilds, race state
 *
 * This helper standardizes the fix. Returns a function that:
 *   - skips with `{skipped: true, reason: 'in_flight'}` if a previous call
 *     is still running
 *   - times out + force-clears after `maxAgeMs` so a deadlocked call can't
 *     wedge the system permanently (F-Q306)
 *   - runs the wrapped function normally otherwise
 *
 * Usage:
 *   const guardedRefresh = createConcurrencyGuard(refreshFn, { maxAgeMs: 5*60_000 });
 *   const result = await guardedRefresh();   // {skipped:true} if in flight
 */

/**
 * @template T
 * @param {() => Promise<T>} fn — the async op to single-flight
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs] — after this, force-clear in-flight state.
 *   Default Infinity (never auto-clear). Set on long jobs that might deadlock.
 * @param {(msg: string) => void} [opts.log] — optional logger for skip/clear events
 * @returns {(...args: any[]) => Promise<{skipped: true, reason: string} | T>}
 */
export function createConcurrencyGuard(fn, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? Infinity;
  const log = opts.log || (() => {});
  let currentRun = null;
  let currentStartedAt = 0;

  return async function guardedCall(...args) {
    // Check for deadlocked in-flight call.
    if (currentRun) {
      const age = Date.now() - currentStartedAt;
      if (age > maxAgeMs) {
        // F-Q306 fix: force-clear after maxAge so a wedged call can't
        // permanently lock out the scheduler. The orphan promise is
        // intentionally not awaited — it'll resolve into the void.
        log(`[concurrency-guard] force-clearing in-flight call after ${age}ms (max ${maxAgeMs}ms) — likely deadlocked`);
        currentRun = null;
        currentStartedAt = 0;
      } else {
        return { skipped: true, reason: 'in_flight' };
      }
    }

    currentStartedAt = Date.now();
    currentRun = fn(...args);
    try {
      return await currentRun;
    } finally {
      currentRun = null;
      currentStartedAt = 0;
    }
  };
}

/**
 * Convenience: returns whether a guard is currently running.
 * (Exposed for tests + health endpoints.)
 */
export function isGuardRunning(guard) {
  // The guard doesn't expose state — this is a placeholder for a future
  // version that returns a `{run, isRunning, runtimeMs}` object. For now,
  // tests can probe via the skipped:true return.
  void guard;
  throw new Error('isGuardRunning not implemented; check return value of guard() instead');
}
