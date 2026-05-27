/**
 * broadcast-emitter.mjs — Context broadcast emitter for the OpenClaw federation layer
 *
 * Publishes `context.broadcast` events to the shared NATS stream when:
 * 1. Per-prompt: query-analysis detects ≥3 themes (aggressive cadence)
 * 2. Per-consolidation-cycle: theme set from extraction store
 *
 * Rate limited to 1 broadcast per 60 sec per session. De-duplicated via
 * SHA-256 of canonicalized themes∪entities with a 15-min suppression window.
 *
 * Usage:
 *   import { createBroadcaster } from '../lib/broadcast-emitter.mjs';
 *   const broadcaster = createBroadcaster(nc, nodeId, { log: console.log });
 *   await broadcaster.maybeBroadcast(prompt, analysisResult);
 *   await broadcaster.broadcastFromConsolidation(themes, entities);
 *   broadcaster.stop();
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum interval between broadcasts for the same session (ms). */
export const RATE_LIMIT_MS = 60 * 1000;

/** Dedup window — same dedup_key within this window is suppressed (ms). */
export const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Default TTL for broadcast events (minutes). */
export const DEFAULT_TTL_MINUTES = 60;

/** Minimum theme count to trigger a broadcast from per-prompt path. */
export const MIN_THEMES_FOR_BROADCAST = 3;

/** Max age of dedup entries before sweeping (ms). Slightly longer than window to avoid edge races. */
const DEDUP_SWEEP_AGE_MS = DEDUP_WINDOW_MS + 60_000;

// ─── Intensity Inference ────────────────────────────────────────────────────

const ACTIVELY_SEEKING_PATTERNS = [
  /\?\s*$/,
  /\bhow\s+(do|can|should|would)\s+I\b/i,
  /\bstuck\b/i,
  /\bblocked\b/i,
  /\bhelp\s+(me|with)\b/i,
  /\bcan't\s+figure\b/i,
  /\bwhat('s|\s+is)\s+wrong\b/i,
];

const INTERESTED_PATTERNS = [
  /\bexplore\b/i,
  /\bthink\s+about\b/i,
  /\bwhat\s+if\b/i,
  /\bconsider\b/i,
  /\bwondering\b/i,
  /\bcurious\b/i,
  /\blook\s+into\b/i,
];

/**
 * Infer broadcast intensity from prompt text.
 *
 * @param {string} prompt — user prompt text
 * @returns {'actively_seeking' | 'interested' | 'passive'}
 */
export function inferIntensity(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'passive';

  for (const re of ACTIVELY_SEEKING_PATTERNS) {
    if (re.test(prompt)) return 'actively_seeking';
  }

  for (const re of INTERESTED_PATTERNS) {
    if (re.test(prompt)) return 'interested';
  }

  return 'passive';
}

// ─── Dedup Key Computation ──────────────────────────────────────────────────

/**
 * Compute a deterministic dedup key from themes and entities.
 * SHA-256 of sorted, lowercased, pipe-joined set.
 *
 * @param {string[]} themes
 * @param {string[]} entities
 * @returns {string} hex SHA-256 hash
 */
export function computeDedupKey(themes, entities) {
  // F-M5 fix: namespace themes vs entities (`t:` / `e:` prefix) so
  // themes=['foo'] doesn't collide with entities=['foo']. Also
  // Unicode-normalize (NFC) so visually-identical strings hash the same
  // (café composed vs decomposed used to produce different keys).
  const combined = [...new Set([
    ...(themes || []).map(t => `t:${String(t).normalize('NFC').toLowerCase().trim()}`),
    ...(entities || []).map(e => `e:${String(e).normalize('NFC').toLowerCase().trim()}`),
  ])].sort();
  return crypto.createHash('sha256').update(combined.join('|')).digest('hex');
}

// ─── Problem Class Inference ────────────────────────────────────────────────

const PROBLEM_CLASS_PATTERNS = {
  debug: [/\bbug\b/i, /\berror\b/i, /\bfix\b/i, /\bcrash\b/i, /\bfail/i, /\bbroken\b/i],
  design: [/\bdesign\b/i, /\barchitect/i, /\blayout\b/i, /\bUI\b/, /\bUX\b/],
  research: [/\bresearch\b/i, /\binvestigat/i, /\bcompare\b/i, /\bevaluat/i],
  implement: [/\bimplement\b/i, /\bbuild\b/i, /\bcreate\b/i, /\badd\b/i, /\bwrite\b/i],
};

/**
 * Infer problem_class from prompt text. Returns undefined if no clear match.
 *
 * @param {string} prompt
 * @returns {'debug' | 'design' | 'research' | 'implement' | undefined}
 */
export function inferProblemClass(prompt) {
  if (!prompt || typeof prompt !== 'string') return undefined;
  for (const [cls, patterns] of Object.entries(PROBLEM_CLASS_PATTERNS)) {
    for (const re of patterns) {
      if (re.test(prompt)) return cls;
    }
  }
  return undefined;
}

// ─── Broadcaster Factory ────────────────────────────────────────────────────

/**
 * Create a broadcaster instance.
 *
 * @param {object} nc — NATS connection (from nats.connect())
 * @param {string} nodeId — this node's identifier (must be non-empty)
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log] — logger
 * @param {number} [opts.rateLimitMs] — per-session rate limit (default 60s)
 * @param {number} [opts.dedupWindowMs] — dedup suppression window (default 15 min)
 * @param {number} [opts.ttlMinutes] — broadcast TTL (default 60, env override)
 * @param {string[]} [opts.recentThemeHistory] — last 5 turns' theme sets for passive skip logic
 * @param {{privateKey: object, publicKeyBase64: string}} [opts.identity] — signing identity.
 *   When provided, every published broadcast is signed with this key. When
 *   absent AND OPENCLAW_REQUIRE_SIGNED=1 (default), publish is refused — the
 *   federation layer requires signing in production.
 * @returns {{ maybeBroadcast: Function, broadcastFromConsolidation: Function, stop: Function, stats: object }}
 */
export function createBroadcaster(nc, nodeId, opts = {}) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new Error('createBroadcaster: nodeId must be a non-empty string');
  }
  const log = opts.log || (() => {});
  const rateLimitMs = opts.rateLimitMs ?? RATE_LIMIT_MS;
  const dedupWindowMs = opts.dedupWindowMs ?? DEDUP_WINDOW_MS;
  const ttlMinutes = opts.ttlMinutes
    ?? (process.env.OPENCLAW_BROADCAST_TTL_MIN ? Number(process.env.OPENCLAW_BROADCAST_TTL_MIN) : DEFAULT_TTL_MINUTES);
  const identity = opts.identity || null;
  const requireSigned = (process.env.OPENCLAW_REQUIRE_SIGNED ?? '1') !== '0';

  if (requireSigned && !identity) {
    log(`[broadcaster] WARN: no identity provided and OPENCLAW_REQUIRE_SIGNED=${process.env.OPENCLAW_REQUIRE_SIGNED ?? '1'}; all publishes will be refused`);
  }

  // State
  let lastBroadcastTs = 0; // per-session rate limit timestamp
  const dedupMap = new Map(); // dedupKey → timestamp of last broadcast
  const recentThemeSets = []; // last 5 theme sets for passive-skip logic
  const stats = { emitted: 0, rateLimited: 0, deduplicated: 0, passiveSkipped: 0, errors: 0, unsigned_refused: 0 };
  let sweepTimer = null;
  // F-N1 federation-startup support: track recently-published broadcast IDs so
  // the acceptor (on this node) can recognize which incoming offers are
  // responding to OUR broadcasts. Bounded so it doesn't grow unbounded over
  // a long-running daemon. Older entries naturally fall out as new broadcasts
  // arrive; an offer responding to a broadcast we evicted gets skipped as
  // 'not_our_broadcast' (acceptable — the broadcast was old enough that we
  // shouldn't be expecting fresh offers anymore).
  const publishedIds = new Set();
  const PUBLISHED_IDS_CAP = 1024;

  // Periodic dedup map cleanup
  function sweepDedupMap() {
    const now = Date.now();
    for (const [key, ts] of dedupMap) {
      if (now - ts > DEDUP_SWEEP_AGE_MS) dedupMap.delete(key);
    }
  }

  sweepTimer = setInterval(sweepDedupMap, 5 * 60_000);
  if (sweepTimer.unref) sweepTimer.unref();

  // ── Internal publish ─────────────────────────────────���─────────────────────

  async function publishBroadcast(themes, entities, intensity, problemClass) {
    const dedupKey = computeDedupKey(themes, entities);

    // Dedup check
    const lastDedup = dedupMap.get(dedupKey);
    if (lastDedup && (Date.now() - lastDedup) < dedupWindowMs) {
      stats.deduplicated++;
      log(`[broadcaster] dedup suppressed (key ${dedupKey.slice(0, 8)}...)`);
      return { suppressed: true, reason: 'dedup' };
    }

    // F-H8 fix: set the dedup entry EAGERLY so concurrent publishBroadcast
    // calls with the same dedupKey can't both pass the check above before
    // either reaches the post-publish set. We roll back below if publish
    // fails (so retries with the same key aren't blocked). This narrows
    // the race window from "until publish completes" to "until the next
    // microtask" — effectively serialized for in-process callers.
    const setEagerly = Date.now();
    dedupMap.set(dedupKey, setEagerly);

    // Build event envelope
    const eventId = crypto.randomUUID();
    const event = {
      event_id: eventId,
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: eventId,
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${nodeId}` },
      node_id: nodeId,
      idempotency_key: eventId,
      data: {
        themes,
        entities,
        intensity,
        ttl_minutes: ttlMinutes,
        dedup_key: dedupKey,
        ...(problemClass ? { problem_class: problemClass } : {}),
      },
    };

    // Validate against schema
    let validated;
    try {
      const { ContextBroadcastSchema } = await import('../packages/event-schemas/dist/index.js');
      validated = ContextBroadcastSchema.parse(event);
    } catch (err) {
      stats.errors++;
      log(`[broadcaster] schema validation failed: ${err.message}`);
      // F-H8: roll back the eager dedup entry on failure path
      if (dedupMap.get(dedupKey) === setEagerly) dedupMap.delete(dedupKey);
      return { suppressed: true, reason: 'validation_error' };
    }

    // Sign the validated event (F-C1 fix). Refusal when identity is absent + STRICT mode
    // is intentional: the federation layer must not publish forgeable events.
    let signed = validated;
    if (identity) {
      try {
        const { signEvent } = await import('./node-identity.mjs');
        signed = signEvent(validated, identity.privateKey);
      } catch (err) {
        stats.errors++;
        log(`[broadcaster] signing failed: ${err.message}`);
        // F-N5 fix (F-H8 regression): roll back the eager dedup entry on
        // signing failure too. Previously this path suppressed the dedupKey
        // for 15 min, blocking legitimate retry after a transient signing
        // error (e.g. key file briefly unreadable during rotation).
        if (dedupMap.get(dedupKey) === setEagerly) dedupMap.delete(dedupKey);
        return { suppressed: true, reason: 'signing_error' };
      }
    } else if (requireSigned) {
      stats.unsigned_refused++;
      log(`[broadcaster] refused to publish unsigned event (set OPENCLAW_REQUIRE_SIGNED=0 to allow during migration, NOT recommended)`);
      if (dedupMap.get(dedupKey) === setEagerly) dedupMap.delete(dedupKey);
      return { suppressed: true, reason: 'unsigned_refused' };
    }

    // Publish to shared stream
    try {
      const { StringCodec } = _require('nats');
      const sc = StringCodec();
      const js = nc.jetstream();
      const subject = `context.broadcast.${nodeId}`;
      await js.publish(subject, sc.encode(JSON.stringify(signed)), {
        msgID: eventId,
      });

      // F-H8: dedup entry was already set eagerly above; just refresh
      // timestamp on successful publish (closer to "true" publish time).
      dedupMap.set(dedupKey, Date.now());
      lastBroadcastTs = Date.now();
      stats.emitted++;
      // F-N1: track for the acceptor's ownBroadcastIds lookup.
      publishedIds.add(eventId);
      if (publishedIds.size > PUBLISHED_IDS_CAP) {
        const oldest = publishedIds.values().next().value;
        publishedIds.delete(oldest);
      }
      log(`[broadcaster] emitted broadcast (intensity=${intensity}, themes=${themes.length}, entities=${entities.length})`);
      return { suppressed: false, eventId };
    } catch (err) {
      stats.errors++;
      log(`[broadcaster] publish error: ${err.message}`);
      // F-H8: roll back the eager dedup entry on publish failure
      if (dedupMap.get(dedupKey) === setEagerly) dedupMap.delete(dedupKey);
      return { suppressed: true, reason: 'publish_error' };
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attempt to broadcast based on a user prompt and query-analysis result.
   * Fires only if:
   * - themes >= MIN_THEMES_FOR_BROADCAST (3)
   * - rate limit not exceeded (60s per session)
   * - not passive + unchanged theme set
   *
   * @param {string} prompt — user prompt text
   * @param {object} analysis — result from analyzeQuery or analyzeQueryWithLlm
   * @param {object} [broadcastOpts]
   * @param {string[]} [broadcastOpts.themes] — override themes (e.g. from llmAnalysis)
   * @param {string[]} [broadcastOpts.entities] — override entities
   * @returns {Promise<{ suppressed: boolean, reason?: string, eventId?: string }>}
   */
  async function maybeBroadcast(prompt, analysis, broadcastOpts = {}) {
    // Extract themes from analysis
    let themes = broadcastOpts.themes || [];
    let entities = broadcastOpts.entities || [];

    if (analysis && analysis.llmAnalysis) {
      if (!themes.length && Array.isArray(analysis.llmAnalysis.themes)) {
        themes = analysis.llmAnalysis.themes;
      }
      if (!entities.length && Array.isArray(analysis.llmAnalysis.entities)) {
        entities = analysis.llmAnalysis.entities;
      }
    }

    // Gate: need ≥3 themes
    if (themes.length < MIN_THEMES_FOR_BROADCAST) {
      return { suppressed: true, reason: 'insufficient_themes' };
    }

    // Rate limit check (per-session)
    if (Date.now() - lastBroadcastTs < rateLimitMs) {
      stats.rateLimited++;
      log('[broadcaster] rate limited (60s per session)');
      return { suppressed: true, reason: 'rate_limited' };
    }

    // Intensity inference
    const intensity = inferIntensity(prompt);

    // Passive + unchanged skip
    if (intensity === 'passive') {
      const currentSet = [...themes].sort().join(',');
      const unchanged = recentThemeSets.length >= 5 &&
        recentThemeSets.slice(-5).every(s => s === currentSet);
      if (unchanged) {
        stats.passiveSkipped++;
        log('[broadcaster] passive + unchanged theme set — skipping');
        return { suppressed: true, reason: 'passive_unchanged' };
      }
    }

    // F-H7 fix: only update theme history AFTER successful publish.
    // Previously: push happened before publish, so dedup-suppressed,
    // validation-failed, or publish-failed calls consumed the passive-skip
    // budget. After 5 failed attempts, legitimate broadcasts got skipped.
    const problemClass = inferProblemClass(prompt);
    const result = await publishBroadcast(themes, entities, intensity, problemClass);
    if (!result.suppressed) {
      recentThemeSets.push([...themes].sort().join(','));
      if (recentThemeSets.length > 10) recentThemeSets.shift();
    }
    return result;
  }

  /**
   * Broadcast from a consolidation cycle (non-prompt path).
   * Bypasses the ≥3-themes gate and rate limit (consolidation is already throttled).
   * Still respects dedup.
   *
   * @param {string[]} themes — themes from the consolidation cycle
   * @param {string[]} entities — entities from the consolidation cycle
   * @returns {Promise<{ suppressed: boolean, reason?: string, eventId?: string }>}
   */
  async function broadcastFromConsolidation(themes, entities) {
    if (!themes || themes.length === 0) {
      return { suppressed: true, reason: 'no_themes' };
    }

    // Consolidation path uses 'interested' as default intensity
    // (it represents background processing, not active seeking)
    return await publishBroadcast(themes, entities || [], 'interested', undefined);
  }

  /**
   * Stop the broadcaster (clear timers).
   */
  function stop() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  return {
    maybeBroadcast,
    broadcastFromConsolidation,
    stop,
    stats,
    // F-N1: expose for federation-startup → acceptor wiring.
    publishedIds: () => publishedIds,
  };
}
