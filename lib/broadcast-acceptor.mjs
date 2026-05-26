/**
 * broadcast-acceptor.mjs — Context offer acceptor for the OpenClaw federation layer
 *
 * Subscribes to `context.offer.>` events from peer nodes on the shared
 * NATS JetStream cluster. For each offer:
 *
 * 1. Check if `responding_to` matches one of this node's own broadcasts
 * 2. Check offer TTL (expires_at) — ignore expired offers
 * 3. Push into pending offers queue (capped at MAX_PENDING_OFFERS)
 * 4. Surface top-1 offer as [peer-memory: ...] block via injection path
 * 5. Auto-emit context.accepted when next prompt overlaps offer summary
 *
 * Usage:
 *   import { createAcceptor } from '../lib/broadcast-acceptor.mjs';
 *   const acceptor = createAcceptor(nc, nodeId, { ownBroadcastIds, log });
 *   await acceptor.start();
 *   const block = acceptor.getTopOffer(); // for injection
 *   await acceptor.checkAcceptance(prompt); // after user sends next prompt
 *   acceptor.stop();
 *
 * @module lib/broadcast-acceptor
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { cleanupExpiredOffers } from './federation-resilience.mjs';

const _require = createRequire(import.meta.url);

// ─── Constants ──────────────────────────────────────────────────────────────

/** Token overlap threshold for auto-acceptance (ratio of shared tokens / summary tokens). */
export const TOKEN_OVERLAP_THRESHOLD = Number(process.env.ACCEPTOR_TOKEN_OVERLAP) || 0.3;

/** Maximum number of pending offers held in memory. Oldest evicted when exceeded. */
export const MAX_PENDING_OFFERS = 10;

/** Durable consumer name prefix for acceptor subscriptions. */
const CONSUMER_NAME_PREFIX = 'acceptor';

// ─── Artifact Ref Parsing ───────────────────────────────────────────────────

/**
 * Parse an artifact reference in the format `session:<session_id>:chunk:<chunk_id>`.
 *
 * @param {string} ref — artifact reference string
 * @returns {{ sessionId: string, chunkId: number } | null} — parsed ref or null if malformed
 */
export function parseArtifactRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const match = ref.match(/^session:([^:]+):chunk:(\d+)$/);
  if (!match) return null;
  return { sessionId: match[1], chunkId: Number(match[2]) };
}

// ─── Token Overlap ──────────────────────────────────────────────────────────

/**
 * Compute the token overlap ratio between a prompt and a summary.
 * Tokenizes both by splitting on whitespace and punctuation, lowercases,
 * then computes |intersection| / |summaryTokens|.
 *
 * @param {string} promptText — user prompt text
 * @param {string} summaryText — offer artifact summary
 * @returns {number} — overlap ratio [0, 1]
 */
export function computeTokenOverlap(promptText, summaryText) {
  if (!promptText || !summaryText) return 0;

  const tokenize = (text) => {
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(t => t.length > 1);
  };

  const promptTokens = new Set(tokenize(promptText));
  const summaryTokens = tokenize(summaryText);

  if (!summaryTokens.length) return 0;

  let overlap = 0;
  for (const token of summaryTokens) {
    if (promptTokens.has(token)) overlap++;
  }

  return overlap / summaryTokens.length;
}

// ─── Peer Memory Formatting ────────────────────────────────────────────────

/**
 * Format the top offer into a [peer-memory: ...] injection block.
 * Prepended after the local [memory: ...] block in the companion-bridge path.
 *
 * @param {{ data: { artifacts: Array<{ artifact_ref: string, relevance_score: number, summary: string }>, offerer_node_id: string } }} offer — the offer event
 * @returns {string} — formatted block, or empty string if no artifacts
 */
export function formatPeerMemoryBlock(offer) {
  if (!offer || !offer.data || !offer.data.artifacts || !offer.data.artifacts.length) {
    return '';
  }

  const artifacts = offer.data.artifacts;
  const nodeId = offer.data.offerer_node_id || 'peer';

  const lines = [`[peer-memory: context offered by ${nodeId}]`];

  for (const art of artifacts) {
    const parsed = parseArtifactRef(art.artifact_ref);
    const sessionLabel = parsed ? `session ${parsed.sessionId}` : art.artifact_ref;
    const score = typeof art.relevance_score === 'number'
      ? ` (relevance: ${art.relevance_score.toFixed(2)})`
      : '';
    const summary = art.summary || '';
    lines.push(`- ${sessionLabel}${score}: ${summary}`);
  }

  lines.push('[end peer-memory]');
  return lines.join('\n');
}

// ─���─ Acceptor Factory ───────────────────────────────────────────────────────

/**
 * Create an acceptor instance.
 *
 * @param {object} nc — NATS connection (from nats.connect())
 * @param {string} nodeId — this node's identifier
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log] — logger
 * @param {Set<string> | (() => Set<string>)} [opts.ownBroadcastIds] — Set of broadcast event_ids this node has emitted (or getter function)
 * @param {number} [opts.overlapThreshold] — token overlap threshold for acceptance (default 0.3)
 * @param {number} [opts.maxPending] — max pending offers (default 10)
 * @param {object} [opts.peerTracker] — peer liveness tracker (from createPeerTracker)
 * @param {number} [opts.cleanupIntervalMs] — periodic cleanup interval (default 60000)
 * @returns {{ start: Function, stop: Function, stats: object, getPendingOffers: Function, getTopOffer: Function, checkAcceptance: Function, _processOffer: Function }}
 */
export function createAcceptor(nc, nodeId, opts = {}) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new Error('createAcceptor: nodeId must be a non-empty string');
  }
  const log = opts.log || (() => {});
  const overlapThreshold = opts.overlapThreshold ?? TOKEN_OVERLAP_THRESHOLD;
  const maxPending = opts.maxPending ?? MAX_PENDING_OFFERS;
  const peerTracker = opts.peerTracker || null;
  const cleanupIntervalMs = opts.cleanupIntervalMs ?? 60_000;
  const identity = opts.identity || null;
  const registry = opts.registry || null;
  const seenIds = opts.seenIds || null;
  const requireSigned = (process.env.OPENCLAW_REQUIRE_SIGNED ?? '1') !== '0';
  // F-H5 fix: cap acceptedIds Set
  const maxAcceptedIds = opts.maxAcceptedIds ?? 10_000;

  const stats = {
    offersReceived: 0,
    nonMatchingSkipped: 0,
    expiredSkipped: 0,
    signatureRejected: 0,
    replayRejected: 0,
    schemaRejected: 0,
    offersPending: 0,
    acceptancesEmitted: 0,
    expiredCleaned: 0,
    deadPeerFiltered: 0,
    errors: 0,
  };

  /** @type {Array<object>} */
  // F-H4 (deferred): the array + splice pattern has a theoretical race with
  // concurrent cleanupExpiredOffers (setInterval) and checkAcceptance, but
  // JS is single-threaded — the only window is across async boundaries
  // (await). Mitigated for now by careful await placement; full Map<id,
  // offer> migration tracked separately to avoid invasive churn.
  const pendingOffers = [];
  const acceptedIds = new Set();
  // F-H5 fix: bounded LRU for acceptedIds. Track insertion order for eviction.
  const acceptedIdsOrder = [];
  function recordAcceptedId(id) {
    if (acceptedIds.has(id)) return;
    acceptedIds.add(id);
    acceptedIdsOrder.push(id);
    while (acceptedIdsOrder.length > maxAcceptedIds) {
      const evicted = acceptedIdsOrder.shift();
      acceptedIds.delete(evicted);
    }
  }
  let subscription = null;
  let cleanupTimer = null;
  let running = false;

  /**
   * Resolve the set of own broadcast IDs.
   * @returns {Set<string>}
   */
  function getOwnBroadcastIds() {
    const ids = opts.ownBroadcastIds;
    if (!ids) return new Set();
    if (typeof ids === 'function') return ids();
    return ids;
  }

  /**
   * Process a single offer event.
   *
   * @param {object} offerData — parsed offer event
   * @returns {Promise<{ action: string, reason?: string, eventId?: string }>}
   */
  async function processOffer(offerData) {
    stats.offersReceived++;

    // 0a. Schema validation — drop malformed events at the boundary (F-H2)
    try {
      const { ContextOfferSchema } = await import('../packages/event-schemas/dist/index.js');
      offerData = ContextOfferSchema.parse(offerData);
    } catch (err) {
      stats.schemaRejected++;
      log(`[acceptor] schema validation failed for offer ${offerData?.event_id || '<no id>'}: ${err.message}`);
      return { action: 'skip', reason: 'bad_schema' };
    }

    // 0b. STRICT signature verification with nodeId↔pubkey binding + replay check
    const { verifyEvent } = await import('./node-identity.mjs');
    const verifyResult = verifyEvent(offerData, {
      requireSigned,
      registry,
      seenIds,
      checkFreshness: true,
    });
    if (verifyResult && verifyResult.ok === false) {
      if (verifyResult.reason === 'replay') {
        stats.replayRejected++;
        log(`[acceptor] replay rejected: ${offerData.event_id}`);
        return { action: 'skip', reason: 'replay' };
      }
      stats.signatureRejected++;
      log(`[acceptor] STRICT: rejecting offer ${offerData.event_id} — ${verifyResult.reason}`);
      return { action: 'skip', reason: 'bad_signature', detail: verifyResult.reason };
    }

    // 1. Check if responding_to matches one of our own broadcasts
    const respondingTo = offerData.data?.responding_to;
    if (!respondingTo) {
      stats.nonMatchingSkipped++;
      return { action: 'skip', reason: 'no_responding_to' };
    }

    const ownIds = getOwnBroadcastIds();
    if (!ownIds.has(respondingTo)) {
      stats.nonMatchingSkipped++;
      log(`[acceptor] skipping offer ${offerData.event_id} — not responding to our broadcast`);
      return { action: 'skip', reason: 'not_our_broadcast' };
    }

    // 2. Check offer expiry (expires_at)
    const expiresAt = offerData.data?.expires_at;
    if (expiresAt) {
      const expiryTs = new Date(expiresAt).getTime();
      if (Date.now() > expiryTs) {
        stats.expiredSkipped++;
        log(`[acceptor] skipping expired offer ${offerData.event_id}`);
        return { action: 'skip', reason: 'expired' };
      }
    }

    // 3. Skip if already accepted
    if (acceptedIds.has(offerData.event_id)) {
      return { action: 'skip', reason: 'already_accepted' };
    }

    // 4. Push to pending queue (evict oldest if at capacity)
    if (pendingOffers.length >= maxPending) {
      pendingOffers.shift();
    }
    pendingOffers.push(offerData);
    stats.offersPending = pendingOffers.length;

    // 4b. Record peer liveness
    if (peerTracker && offerData.data?.offerer_node_id) {
      peerTracker.recordSeen(offerData.data.offerer_node_id);
    }

    log(`[acceptor] queued offer ${offerData.event_id} from ${offerData.data?.offerer_node_id || 'unknown'} (${pendingOffers.length} pending)`);
    return { action: 'queued', eventId: offerData.event_id };
  }

  /**
   * Get all pending offers (for inspection / debugging).
   * @returns {Array<object>}
   */
  function getPendingOffers() {
    return [...pendingOffers];
  }

  /**
   * Get the top offer (highest combined relevance score across artifacts).
   * Returns the formatted [peer-memory: ...] block string, or empty string if no pending offers.
   *
   * @returns {string}
   */
  function getTopOffer() {
    if (!pendingOffers.length) return '';

    // Score each pending offer by max artifact relevance, filtering dead peers
    let best = null;
    let bestScore = -1;
    for (const offer of pendingOffers) {
      // Filter out offers from dead peers
      const offererId = offer.data?.offerer_node_id;
      if (peerTracker && offererId && !peerTracker.isAlive(offererId)) {
        stats.deadPeerFiltered++;
        log(`[acceptor] filtering offer ${offer.event_id} from dead peer ${offererId}`);
        continue;
      }

      const artifacts = offer.data?.artifacts || [];
      const maxScore = artifacts.reduce((max, a) => Math.max(max, a.relevance_score || 0), 0);
      if (maxScore > bestScore) {
        bestScore = maxScore;
        best = offer;
      }
    }

    if (!best) return '';
    return formatPeerMemoryBlock(best);
  }

  /**
   * Check if a new user prompt indicates acceptance of a pending offer.
   * Computes token overlap between the prompt and each pending offer's summaries.
   * If overlap ≥ threshold, emits context.accepted and removes the offer from pending.
   *
   * @param {string} prompt — the user's latest prompt text
   * @returns {Promise<{ accepted: boolean, offerId?: string, overlap?: number }>}
   */
  async function checkAcceptance(prompt) {
    if (!prompt || !pendingOffers.length) return { accepted: false };

    for (let i = 0; i < pendingOffers.length; i++) {
      const offer = pendingOffers[i];
      const artifacts = offer.data?.artifacts || [];

      // Compute overlap against each artifact's summary; take max
      let maxOverlap = 0;
      for (const art of artifacts) {
        const overlap = computeTokenOverlap(prompt, art.summary || '');
        if (overlap > maxOverlap) maxOverlap = overlap;
      }

      if (maxOverlap >= overlapThreshold) {
        // Acceptance triggered — emit context.accepted
        const acceptedRefs = artifacts.map(a => a.artifact_ref);
        const acceptedEventId = crypto.randomUUID();

        const acceptedEvent = {
          event_id: acceptedEventId,
          event_type: 'context.accepted',
          event_version: 1,
          entity_id: acceptedEventId,
          entity_type: 'session',
          timestamp: new Date().toISOString(),
          causation_id: offer.event_id,
          correlation_id: null,
          actor: { type: 'system', id: `acceptor-${nodeId}` },
          node_id: nodeId,
          idempotency_key: acceptedEventId,
          data: {
            responding_to: offer.event_id,
            accepted_artifacts: acceptedRefs,
          },
        };

        // Validate against schema
        let validated;
        try {
          const { ContextAcceptedSchema } = await import('../packages/event-schemas/dist/index.js');
          validated = ContextAcceptedSchema.parse(acceptedEvent);
        } catch (err) {
          stats.errors++;
          log(`[acceptor] schema validation failed for acceptance: ${err.message}`);
          return { accepted: false };
        }

        // Sign the accepted event (F-C1)
        let signed = validated;
        if (identity) {
          try {
            const { signEvent } = await import('./node-identity.mjs');
            signed = signEvent(validated, identity.privateKey);
          } catch (err) {
            stats.errors++;
            log(`[acceptor] signing failed: ${err.message}`);
            return { accepted: false };
          }
        } else if (requireSigned) {
          stats.errors++;
          log(`[acceptor] refused to emit unsigned context.accepted (no identity + STRICT mode)`);
          return { accepted: false };
        }

        // Publish to shared stream
        try {
          const { StringCodec } = _require('nats');
          const sc = StringCodec();
          const js = nc.jetstream();
          const subject = `context.accepted.${nodeId}`;
          await js.publish(subject, sc.encode(JSON.stringify(signed)), {
            msgID: acceptedEventId,
          });

          // Remove from pending, mark as accepted (F-H5 bounded LRU)
          pendingOffers.splice(i, 1);
          recordAcceptedId(offer.event_id);
          stats.offersPending = pendingOffers.length;
          stats.acceptancesEmitted++;

          log(`[acceptor] emitted context.accepted for offer ${offer.event_id} (overlap: ${maxOverlap.toFixed(3)})`);
          return { accepted: true, offerId: offer.event_id, overlap: maxOverlap };
        } catch (err) {
          stats.errors++;
          log(`[acceptor] publish error for acceptance: ${err.message}`);
          return { accepted: false };
        }
      }
    }

    return { accepted: false };
  }

  /**
   * Start the acceptor — subscribe to context.offer.> on the shared stream.
   */
  async function start() {
    if (running) return;
    running = true;

    try {
      const { StringCodec } = _require('nats');
      const sc = StringCodec();
      const js = nc.jetstream();
      const consumerName = `${CONSUMER_NAME_PREFIX}-${nodeId}`;

      try {
        const consumer = await js.consumers.get('OPENCLAW_SHARED', consumerName);
        subscription = await consumer.consume();
      } catch {
        try {
          subscription = await js.subscribe('context.offer.>', {
            stream: 'OPENCLAW_SHARED',
            config: {
              deliver_policy: 'new',
              ack_policy: 'explicit',
            },
          });
        } catch (err) {
          log(`[acceptor] failed to subscribe to shared stream: ${err.message}`);
          running = false;
          return;
        }
      }

      // Process messages asynchronously
      (async () => {
        try {
          for await (const msg of subscription) {
            try {
              const raw = sc.decode(msg.data);
              const offerData = JSON.parse(raw);
              await processOffer(offerData);
              if (msg.ack) msg.ack();
            } catch (err) {
              stats.errors++;
              log(`[acceptor] message processing error: ${err.message}`);
              if (msg.ack) msg.ack();
            }
          }
        } catch (err) {
          if (running) {
            log(`[acceptor] subscription loop ended: ${err.message}`);
          }
        }
      })();

      // Start periodic cleanup of expired pending offers
      cleanupTimer = setInterval(() => {
        const removed = cleanupExpiredOffers(pendingOffers);
        if (removed > 0) {
          stats.expiredCleaned += removed;
          stats.offersPending = pendingOffers.length;
          log(`[acceptor] periodic cleanup: removed ${removed} expired offer(s) (${pendingOffers.length} remaining)`);
        }
      }, cleanupIntervalMs);
      cleanupTimer.unref();

      log(`[acceptor] started — listening on context.offer.>`);
    } catch (err) {
      stats.errors++;
      log(`[acceptor] start error: ${err.message}`);
      running = false;
    }
  }

  /**
   * Stop the acceptor — unsubscribe from the shared stream, clear cleanup timer.
   */
  function stop() {
    running = false;
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    if (subscription) {
      try {
        if (subscription.unsubscribe) subscription.unsubscribe();
        else if (subscription.close) subscription.close();
      } catch { /* ignore cleanup errors */ }
      subscription = null;
    }
    log('[acceptor] stopped');
  }

  return {
    start,
    stop,
    stats,
    getPendingOffers,
    getTopOffer,
    checkAcceptance,
    _processOffer: processOffer,
  };
}
