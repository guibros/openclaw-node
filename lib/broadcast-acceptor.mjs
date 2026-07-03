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
import { loadEventSchemas } from './event-schemas.mjs';
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
  // F-L5 fix: dedupe summary tokens before counting. A summary with repeated
  // words (e.g. "the the the") otherwise inflates the denominator and
  // underestimates overlap.
  const summaryTokens = new Set(tokenize(summaryText));

  if (!summaryTokens.size) return 0;

  let overlap = 0;
  for (const token of summaryTokens) {
    if (promptTokens.has(token)) overlap++;
  }

  return overlap / summaryTokens.size;
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

  // F-L2 fix: sanitize peer-supplied strings. A malicious peer can embed
  // newlines or the literal "[end peer-memory]" token in `summary` to
  // confuse downstream injection layer or break parsing. Strip control
  // characters + replace the close delimiter with an escaped form.
  const sanitize = (s) =>
    String(s || '')
      .replace(/[\r\n\t\v\f]/g, ' ')
      .replace(/\[end peer-memory\]/gi, '[end peer-memory (escaped)]')
      .slice(0, 500);

  const lines = [`[peer-memory: context offered by ${sanitize(nodeId)}]`];

  for (const art of artifacts) {
    const parsed = parseArtifactRef(art.artifact_ref);
    const sessionLabel = parsed ? `session ${sanitize(parsed.sessionId)}` : sanitize(art.artifact_ref);
    const score = typeof art.relevance_score === 'number'
      ? ` (relevance: ${art.relevance_score.toFixed(2)})`
      : '';
    lines.push(`- ${sessionLabel}${score}: ${sanitize(art.summary)}`);
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
 * @param {Set<string> | Map<string, any> | (() => Set<string> | Map<string, any>)} [opts.ownBroadcastIds] — Set or Map of broadcast event_ids this node has emitted (or getter function). Set/Map both expose .has() so the offerer's Map<event_id, publishedAt> (F-Q103) works without conversion.
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

  /** @type {Map<string, object>} pending offers keyed by event_id */
  // F-H4 fix: Map<event_id, offer> replaces the previous Array + index-based
  // splice. With a Map, deletions in concurrent code paths (cleanupExpiredOffers
  // running on the setInterval timer + checkAcceptance running on user-prompt
  // arrival) can't skip or duplicate entries via shifting indices — Map
  // operations are key-keyed and order-stable. Iteration order is insertion
  // order (Map guarantee since ES2015), which preserves the FIFO eviction
  // semantics maxPending relied on.
  const pendingOffers = new Map();
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
  let loopPromise = null;  // F-N6: track for stop() to await (mirrors offerer's F-M1 fix)
  // F-N8: serialize checkAcceptance per-offer. Two concurrent calls can each
  // pick the same bestKey, await schema-parse + sign + publish, and emit two
  // distinct context.accepted events for the same offer. The set is keyed by
  // bestKey (the offer's event_id) and entries are added synchronously
  // before any await; cleared on completion or error.
  const inFlightAcceptance = new Set();

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

    // 0a. STRICT signature verification FIRST — Zod's .parse() strips
    // signature/signer_pubkey keys by default, so verify BEFORE schema parse.
    // Without this ordering, a signed event would lose its signature during
    // parse, then verifyEvent would always reject as 'missing-signature' in
    // STRICT mode.
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

    // 0b. Schema validation (F-H2) — runs after sig check; correct priority is auth > shape.
    const { ContextOfferSchema } = await loadEventSchemas();
    try {
      offerData = ContextOfferSchema.parse(offerData);
    } catch (err) {
      stats.schemaRejected++;
      log(`[acceptor] schema validation failed for offer ${offerData?.event_id || '<no id>'}: ${err.message}`);
      return { action: 'skip', reason: 'bad_schema' };
    }

    // 0c. F-N7 fix: cross-field auth check. The signature attests to
    // `event.node_id` (envelope) via the registry binding — but the offer
    // also carries `data.offerer_node_id` (payload), which is separately
    // attacker-controlled. Without this check, a signed offer from peer X
    // could claim `offerer_node_id: 'peer-Y'`, polluting peer-tracker and
    // attributing peer-memory blocks to the wrong author.
    const offererNodeId = offerData.data?.offerer_node_id;
    if (offererNodeId && offerData.node_id && offererNodeId !== offerData.node_id) {
      stats.signatureRejected++;
      log(`[acceptor] rejecting offer ${offerData.event_id} — offerer_node_id mismatch (data=${offererNodeId}, envelope=${offerData.node_id})`);
      return { action: 'skip', reason: 'offerer_node_id_mismatch' };
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

    // 4. Push to pending queue (evict oldest if at capacity).
    // F-H4: Map is insertion-ordered, so the oldest entry is keys().next().value.
    // Deleting and re-setting the same event_id would also refresh its position,
    // but we want strict at-cap-evict-oldest behavior, not refresh-on-write.
    if (pendingOffers.size >= maxPending) {
      const oldestKey = pendingOffers.keys().next().value;
      if (oldestKey !== undefined) pendingOffers.delete(oldestKey);
    }
    pendingOffers.set(offerData.event_id, offerData);
    stats.offersPending = pendingOffers.size;

    // 4b. Record peer liveness
    if (peerTracker && offerData.data?.offerer_node_id) {
      peerTracker.recordSeen(offerData.data.offerer_node_id);
    }

    log(`[acceptor] queued offer ${offerData.event_id} from ${offerData.data?.offerer_node_id || 'unknown'} (${pendingOffers.size} pending)`);
    return { action: 'queued', eventId: offerData.event_id };
  }

  /**
   * Get all pending offers (for inspection / debugging).
   * Returns array of offer objects in insertion order (FIFO). The internal
   * storage is a Map (F-H4 fix) but external callers + tests treat the
   * collection as an ordered list, so we materialize to an array here.
   * @returns {Array<object>}
   */
  function getPendingOffers() {
    return [...pendingOffers.values()];
  }

  /**
   * Get the top offer (highest combined relevance score across artifacts).
   * Returns the formatted [peer-memory: ...] block string, or empty string if no pending offers.
   *
   * @returns {string}
   */
  function getTopOffer() {
    if (pendingOffers.size === 0) return '';

    // Score each pending offer by max artifact relevance, filtering dead peers.
    // F-H4: iterate Map values directly. Map iteration order is insertion
    // order (ES2015 spec), so tiebreaks are stable.
    let best = null;
    let bestScore = -1;
    for (const offer of pendingOffers.values()) {
      // Filter out offers from dead peers
      const offererId = offer.data?.offerer_node_id;
      if (peerTracker && offererId && !peerTracker.isAlive(offererId)) {
        stats.deadPeerFiltered++;
        log(`[acceptor] filtering offer ${offer.event_id} from dead peer ${offererId}`);
        continue;
      }

      const artifacts = offer.data?.artifacts || [];
      const maxScore = artifacts.reduce((max, a) => Math.max(max, a.relevance_score || 0), 0);
      // F-M2 fix: deterministic tie-break by timestamp (older offers win
      // ties so recency-weighted scoring isn't biased by Map iteration order).
      // Strict > preserves first-seen on ties → we add timestamp comparison
      // explicitly for predictable behavior.
      if (maxScore > bestScore) {
        bestScore = maxScore;
        best = offer;
      } else if (maxScore === bestScore && best) {
        const a = Date.parse(offer.timestamp || '');
        const b = Date.parse(best.timestamp || '');
        if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
          best = offer;
        }
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
    if (!prompt || pendingOffers.size === 0) return { accepted: false };

    // F-L6 fix: scan ALL pending offers and accept the one with the HIGHEST
    // overlap above threshold. Was: first-match-wins, so a later offer with
    // strictly higher overlap was never seen.
    // F-H4: key-based lookup instead of array index. bestKey is the event_id
    // of the winning offer; bestOffer is the offer object itself. Map.delete
    // by key is race-safe vs concurrent cleanupExpiredOffers / processOffer.
    let bestKey = null;
    let bestOffer = null;
    let bestOverlap = 0;
    for (const [offerKey, offer] of pendingOffers) {
      const artifacts = offer.data?.artifacts || [];
      let maxOverlap = 0;
      for (const art of artifacts) {
        const overlap = computeTokenOverlap(prompt, art.summary || '');
        if (overlap > maxOverlap) maxOverlap = overlap;
      }
      if (maxOverlap >= overlapThreshold && maxOverlap > bestOverlap) {
        bestOverlap = maxOverlap;
        bestKey = offerKey;
        bestOffer = offer;
      }
    }

    if (bestKey !== null) {
      // F-N8 mutex: skip if another in-flight checkAcceptance is already
      // publishing for this offer. The check + insert happen synchronously
      // before the first await, so two concurrent callers can't both pass
      // this gate. Removed in the success or error path below.
      if (inFlightAcceptance.has(bestKey)) {
        return { accepted: false, reason: 'concurrent_acceptance_in_flight' };
      }
      inFlightAcceptance.add(bestKey);

      const offer = bestOffer;
      const artifacts = offer.data?.artifacts || [];
      const maxOverlap = bestOverlap;
      // Continue with the acceptance flow using the best match
      try {
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
        const { ContextAcceptedSchema } = await loadEventSchemas();
        try {
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

          // Remove from pending, mark as accepted (F-H5 bounded LRU).
          // F-H4: Map.delete is key-based — safe even if cleanupExpiredOffers
          // ran in between and removed entries by their own keys. Each operation
          // touches its own keys, no shared indices to fight over.
          pendingOffers.delete(bestKey);
          recordAcceptedId(offer.event_id);
          stats.offersPending = pendingOffers.size;
          stats.acceptancesEmitted++;

          log(`[acceptor] emitted context.accepted for offer ${offer.event_id} (overlap: ${maxOverlap.toFixed(3)})`);
          return { accepted: true, offerId: offer.event_id, overlap: maxOverlap };
        } catch (err) {
          stats.errors++;
          log(`[acceptor] publish error for acceptance: ${err.message}`);
          return { accepted: false };
        }
      } finally {
        // F-N8: always release the mutex, success or failure. The publish path's
        // own inner try/catch already returns above; this finally only fires
        // when the outer try block completes or throws.
        inFlightAcceptance.delete(bestKey);
      }
    }
    // No best match above threshold
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

      // Process messages asynchronously.
      // F-N4 fix (F-H1 regression — was applied to offerer only): outcome-driven
      // ack/nak. Default ack (permanent processing). Set nak only when the
      // processing path threw or returned action:'error' — those are transient
      // failures that JetStream should redeliver.
      //   - 'skip' for bad_schema/bad_signature/replay/expired/etc. → ack
      //     (permanent; redelivering won't make them succeed)
      //   - 'queued' → ack (success)
      //   - thrown error → nak (DB temporarily locked, ollama queue full, etc.)
      // Old behavior: unconditional msg.ack() in both branches — a peer could
      // DOS by sending malformed offers that got permanently dropped from the
      // redelivery queue.
      //
      // F-N6 fix: capture as loopPromise so stop() can await actual loop exit
      // (mirrors F-M1's offerer fix). Previously the IIFE was unawaited so
      // stop() returned while the in-flight handler might still be mid-publish.
      loopPromise = (async () => {
        try {
          for await (const msg of subscription) {
            if (!running) break;
            let outcome = 'ack';
            try {
              const raw = sc.decode(msg.data);
              const offerData = JSON.parse(raw);
              const result = await processOffer(offerData);
              if (result?.action === 'error') outcome = 'nak';
            } catch (err) {
              stats.errors++;
              log(`[acceptor] message processing error: ${err.message}`);
              outcome = 'nak';
            }
            if (outcome === 'ack' && msg.ack) msg.ack();
            else if (outcome === 'nak' && msg.nak) msg.nak();
          }
        } catch (err) {
          if (running) {
            log(`[acceptor] subscription loop ended: ${err.message}`);
          }
        }
      })();

      // Start periodic cleanup of expired pending offers.
      // F-H4: cleanupExpiredOffers now accepts Map<id, offer> (in addition
      // to legacy Array<offer>) and deletes by key, which is race-safe with
      // concurrent processOffer / checkAcceptance Map mutations.
      cleanupTimer = setInterval(() => {
        const removed = cleanupExpiredOffers(pendingOffers);
        if (removed > 0) {
          stats.expiredCleaned += removed;
          stats.offersPending = pendingOffers.size;
          log(`[acceptor] periodic cleanup: removed ${removed} expired offer(s) (${pendingOffers.size} remaining)`);
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
   * Stop the acceptor — unsubscribe, clear cleanup timer, and await the
   * message-processing loop with a short timeout.
   *
   * F-N6 fix: now async, awaits loopPromise so callers can `await stop()`
   * and know in-flight handlers have settled. Previously stop() returned
   * synchronously while the loop's IIFE was still mid-publish — tests
   * that called stop() then asserted on nc.published[...] could observe
   * a race.
   */
  async function stop(timeoutMs = 1000) {
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
    if (loopPromise) {
      try {
        await Promise.race([
          loopPromise,
          new Promise(r => setTimeout(r, timeoutMs)),
        ]);
      } catch { /* loop may throw on close — ignore */ }
      loopPromise = null;
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
