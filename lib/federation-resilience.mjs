/**
 * federation-resilience.mjs — Peer lifecycle tracking, TTL cleanup, and NATS reconnect utilities.
 *
 * Provides:
 * - createPeerTracker(opts) — track peer liveness via last-seen timestamps
 * - cleanupExpiredOffers(pendingOffers) — mutating filter of TTL-expired pending offers
 * - NATS_RECONNECT_OPTS — standard reconnect options for nats.js v2
 *
 * Step 10.7 of the OpenClaw Memory Plan.
 */

/** Default dead-peer timeout: 10 minutes. Override via DEAD_PEER_TIMEOUT_MIN env. */
export const DEAD_PEER_TIMEOUT_MS = (() => {
  const envMin = parseInt(process.env.DEAD_PEER_TIMEOUT_MIN, 10);
  return Number.isFinite(envMin) && envMin > 0 ? envMin * 60_000 : 600_000;
})();

/** Periodic cleanup interval for expired offers: 60 seconds. */
export const OFFER_CLEANUP_INTERVAL_MS = 60_000;

/**
 * Standard NATS reconnect options for long-running daemons.
 * maxReconnectAttempts: -1 = infinite retries.
 */
export const NATS_RECONNECT_OPTS = Object.freeze({
  maxReconnectAttempts: -1,
  reconnectTimeWait: 2000,
  reconnectJitter: 1000,
  reconnect: true,
});

/**
 * Create a peer liveness tracker.
 *
 * Records last-seen timestamps per peer ID. A peer is "alive" if it was seen
 * within the configured timeout window. Dead peers are those that have been
 * silent longer than the timeout.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] — dead-peer timeout (default: DEAD_PEER_TIMEOUT_MS)
 * @param {boolean} [opts.autoCleanup] — run periodic cleanup (default: false)
 * @param {number} [opts.cleanupIntervalMs] — cleanup interval (default: 5 min)
 * @returns {{ recordSeen: Function, isAlive: Function, getDeadPeers: Function, getPeerStatus: Function, cleanup: Function, stop: Function }}
 */
export function createPeerTracker(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEAD_PEER_TIMEOUT_MS;
  const cleanupIntervalMs = opts.cleanupIntervalMs ?? 300_000; // 5 min

  /** @type {Map<string, number>} peerId → lastSeenMs */
  const peers = new Map();
  let cleanupTimer = null;

  if (opts.autoCleanup) {
    cleanupTimer = setInterval(() => cleanup(), cleanupIntervalMs);
    cleanupTimer.unref();
  }

  /**
   * Record that a peer was seen (alive) at the current time.
   * @param {string} peerId
   */
  function recordSeen(peerId) {
    if (!peerId) return;
    peers.set(peerId, Date.now());
  }

  /**
   * Check if a peer is alive (seen within timeout window).
   * A peer that has never been recorded returns true (unknown ≠ dead).
   * @param {string} peerId
   * @returns {boolean}
   */
  function isAlive(peerId) {
    if (!peers.has(peerId)) return true; // never tracked → not dead
    return (Date.now() - peers.get(peerId)) < timeoutMs;
  }

  /**
   * Get list of peer IDs that are considered dead (silent > timeout).
   * @returns {string[]}
   */
  function getDeadPeers() {
    const now = Date.now();
    const dead = [];
    for (const [peerId, lastSeen] of peers) {
      if (now - lastSeen >= timeoutMs) {
        dead.push(peerId);
      }
    }
    return dead;
  }

  /**
   * Get full status map of all tracked peers.
   * @returns {Array<{ peerId: string, lastSeen: number, alive: boolean, silentMs: number }>}
   */
  function getPeerStatus() {
    const now = Date.now();
    const result = [];
    for (const [peerId, lastSeen] of peers) {
      const silentMs = now - lastSeen;
      result.push({ peerId, lastSeen, alive: silentMs < timeoutMs, silentMs });
    }
    return result;
  }

  /**
   * Remove entries older than 2x timeout (truly stale, no longer useful to track).
   * @returns {number} count of removed entries
   */
  function cleanup() {
    const now = Date.now();
    const staleThreshold = timeoutMs * 2;
    let removed = 0;
    for (const [peerId, lastSeen] of peers) {
      if (now - lastSeen > staleThreshold) {
        peers.delete(peerId);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop the tracker — clear any auto-cleanup timer.
   */
  function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  return { recordSeen, isAlive, getDeadPeers, getPeerStatus, cleanup, stop };
}

/**
 * Remove expired offers from a pending offers array (mutating, in-place).
 *
 * Checks each offer's `data.expires_at` field. Offers whose expiry time
 * has passed are spliced out.
 *
 * @param {Array<object>} pendingOffers — the mutable array of pending offers
 * @returns {number} count of removed offers
 */
export function cleanupExpiredOffers(pendingOffers) {
  if (!Array.isArray(pendingOffers)) return 0;
  const now = Date.now();
  let removed = 0;
  for (let i = pendingOffers.length - 1; i >= 0; i--) {
    const expiresAt = pendingOffers[i]?.data?.expires_at;
    if (expiresAt) {
      const expiryTs = new Date(expiresAt).getTime();
      if (now > expiryTs) {
        pendingOffers.splice(i, 1);
        removed++;
      }
    }
  }
  return removed;
}
