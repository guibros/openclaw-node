/**
 * broadcast-offerer.mjs — Context offer responder for the OpenClaw federation layer
 *
 * Subscribes to `context.broadcast.>` events from peer nodes on the shared
 * NATS JetStream cluster. For each broadcast:
 *
 * 1. Skip self-originated broadcasts
 * 2. Check TTL expiry — ignore stale broadcasts
 * 3. Build a composite query from broadcast themes + entities
 * 4. Retrieve locally relevant content via the 5-channel retrieval pipeline
 * 5. Filter by RELEVANCE_THRESHOLD (0.55)
 * 6. Cap at top-3 artifacts (Miller-style)
 * 7. Generate a relevance summary (LLM with data-only fallback)
 * 8. Validate against ContextOfferSchema and publish to context.offer.<nodeId>
 *
 * Privacy: when the `private` column exists (Step 9.5), the offerer pre-filters
 * private items from retrieval results. Before that migration, all items are eligible.
 *
 * Usage:
 *   import { createOfferer } from '../lib/broadcast-offerer.mjs';
 *   const offerer = createOfferer(nc, nodeId, { retrievalPipeline, log: console.log });
 *   await offerer.start();
 *   // ... later
 *   offerer.stop();
 *
 * @module lib/broadcast-offerer
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum RRF-combined score from the retrieval pipeline to consider offering. */
export const RELEVANCE_THRESHOLD = Number(process.env.OFFERER_RELEVANCE_THRESHOLD) || 0.55;

/** Maximum artifacts included in a single offer event. */
export const MAX_ARTIFACTS_PER_OFFER = 3;

/** Default offer expiry offset from now (minutes). Matches broadcast TTL default. */
export const DEFAULT_OFFER_EXPIRY_MINUTES = 60;

/** Durable consumer name prefix for offerer subscriptions. */
const CONSUMER_NAME_PREFIX = 'offerer';

// ─── Summary Generation ────────────────────────────────────────────────────

/**
 * Generate a relevance summary for an artifact relative to a broadcast.
 * Routes through ollama-queue.requestAnalysis() for LLM summary with
 * automatic fallback to a data-only summary when the LLM is busy.
 *
 * @param {{ themes: string[], entities: string[] }} broadcast — broadcast data
 * @param {{ snippet: string, session_id: string, score: number }} result — retrieval result
 * @param {{ requestAnalysis?: Function }} [deps] — injectable dependencies
 * @returns {Promise<string>} — summary text
 */
export async function generateRelevanceSummary(broadcast, result, deps = {}) {
  const snippet = result.snippet || '';
  const themes = (broadcast.themes || []).join(', ');
  const entities = (broadcast.entities || []).join(', ');

  // Data-only fallback summary
  const dataOnlySummary = `Relevant to: ${themes || entities || 'broadcast context'}. ` +
    `Score: ${(result.score || 0).toFixed(3)}. ` +
    (snippet.length > 120 ? snippet.slice(0, 120) + '...' : snippet);

  const requestAnalysis = deps.requestAnalysis;
  if (!requestAnalysis) return dataOnlySummary;

  try {
    const outcome = await requestAnalysis(async (client) => {
      const messages = [
        {
          role: 'system',
          content: '/no_think\nYou are a relevance summarizer. Given a peer node\'s broadcast context and a local knowledge snippet, write a 1-2 sentence summary explaining why this snippet is relevant. Be concise and specific.',
        },
        {
          role: 'user',
          content: `Broadcast context:\n- Themes: ${themes}\n- Entities: ${entities}\n\nLocal snippet:\n${snippet}\n\nWrite a 1-2 sentence relevance summary.`,
        },
      ];
      const resp = await client.generate(messages, { maxTokens: 150 });
      return resp;
    }, { waitTimeoutMs: 3000 });

    if (outcome.mode === 'llm' && outcome.value) {
      const text = typeof outcome.value === 'string'
        ? outcome.value
        : outcome.value.content || outcome.value.text || '';
      return text.trim() || dataOnlySummary;
    }

    return dataOnlySummary;
  } catch {
    return dataOnlySummary;
  }
}

// ─── Offer Building ─────────────────────────────────────────────────────────

/**
 * Build an offer event payload from retrieval results and broadcast context.
 *
 * @param {string} broadcastEventId — event_id of the received broadcast
 * @param {string} nodeId — this node's identifier
 * @param {Array<{ snippet: string, session_id: string, score: number, chunk_id: number }>} results — filtered retrieval results (top-K)
 * @param {string[]} summaries — per-result relevance summaries
 * @param {number} [expiryMinutes] — offer expiry offset from now
 * @returns {object} — offer event envelope (pre-validation)
 */
export function buildOfferFromResults(broadcastEventId, nodeId, results, summaries, expiryMinutes = DEFAULT_OFFER_EXPIRY_MINUTES) {
  const eventId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();

  const artifacts = results.map((r, i) => ({
    artifact_ref: `session:${r.session_id}:chunk:${r.chunk_id || 0}`,
    relevance_score: r.score,
    provenance: {
      source_node: nodeId,
      source_type: 'local_retrieval',
    },
    summary: summaries[i] || `Score: ${r.score.toFixed(3)}`,
  }));

  return {
    event_id: eventId,
    event_type: 'context.offer',
    event_version: 1,
    entity_id: eventId,
    entity_type: 'session',
    timestamp: new Date().toISOString(),
    causation_id: broadcastEventId,
    correlation_id: null,
    actor: { type: 'system', id: `offerer-${nodeId}` },
    node_id: nodeId,
    idempotency_key: eventId,
    data: {
      responding_to: broadcastEventId,
      offerer_node_id: nodeId,
      artifacts,
      expires_at: expiresAt,
    },
  };
}

// ─── Privacy Pre-filter ─────────────────────────────────────────────────────

/**
 * Filter retrieval results to exclude private items.
 * If the `private` column doesn't exist yet (pre-Step 9.5), this is a no-op
 * (returns all results unchanged).
 *
 * @param {Array} results — retrieval pipeline results
 * @param {import('better-sqlite3').Database | null} extractionDb — extraction store (nullable)
 * @returns {Array} — filtered results
 */
export function filterPrivateItems(results, extractionDb) {
  if (!extractionDb || !results || !results.length) return results || [];

  try {
    // Check if the private column exists by querying the entities table
    const row = extractionDb.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('entities') WHERE name = 'private'"
    ).get();

    if (!row || row.cnt === 0) {
      // Column doesn't exist yet (pre-Step 9.5) — all items eligible
      return results;
    }

    // Get session IDs that contain only private entities
    const privateSessionIds = new Set();
    try {
      const privateSessions = extractionDb.prepare(`
        SELECT DISTINCT m.session_id
        FROM mentions m
        JOIN entities e ON m.entity_id = e.id
        WHERE e.private = 1
      `).all();
      for (const r of privateSessions) privateSessionIds.add(r.session_id);
    } catch {
      return results; // Query failed — don't filter
    }

    if (!privateSessionIds.size) return results;

    return results.filter(r => !privateSessionIds.has(r.session_id));
  } catch {
    // Any error in privacy check — don't filter (fail open for now)
    return results;
  }
}

// ─── Offerer Factory ────────────────────────────────────────────────────────

/**
 * Create an offerer instance.
 *
 * @param {object} nc — NATS connection (from nats.connect())
 * @param {string} nodeId — this node's identifier (must be non-empty)
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log] — logger
 * @param {{ retrieve: Function }} [opts.retrievalPipeline] — 5-channel retrieval pipeline
 * @param {import('better-sqlite3').Database} [opts.extractionDb] — extraction store database
 * @param {Function} [opts.requestAnalysis] — ollama-queue.requestAnalysis for LLM summaries
 * @param {number} [opts.relevanceThreshold] — minimum score to offer (default 0.55)
 * @param {number} [opts.maxArtifacts] — max artifacts per offer (default 3)
 * @param {number} [opts.offerExpiryMinutes] — offer expiry (default 60)
 * @param {object} [opts.peerTracker] — peer liveness tracker (from createPeerTracker)
 * @param {{privateKey: object, publicKeyBase64: string}} [opts.identity] — signing identity for outgoing offers
 * @param {object} [opts.registry] — identity registry for verifying incoming broadcasts (binds nodeId↔pubkey)
 * @param {object} [opts.seenIds] — seen-event cache for replay protection
 * @returns {{ start: Function, stop: Function, stats: object }}
 */
export function createOfferer(nc, nodeId, opts = {}) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new Error('createOfferer: nodeId must be a non-empty string');
  }
  const log = opts.log || (() => {});
  const threshold = opts.relevanceThreshold ?? RELEVANCE_THRESHOLD;
  const maxArtifacts = opts.maxArtifacts ?? MAX_ARTIFACTS_PER_OFFER;
  const expiryMinutes = opts.offerExpiryMinutes ?? DEFAULT_OFFER_EXPIRY_MINUTES;
  const peerTracker = opts.peerTracker || null;
  const identity = opts.identity || null;
  const registry = opts.registry || null;
  const seenIds = opts.seenIds || null;
  const requireSigned = (process.env.OPENCLAW_REQUIRE_SIGNED ?? '1') !== '0';

  const stats = {
    broadcastsReceived: 0,
    selfSkipped: 0,
    expiredSkipped: 0,
    signatureRejected: 0,
    replayRejected: 0,
    schemaRejected: 0,
    belowThreshold: 0,
    offersPublished: 0,
    deadPeerLogged: 0,
    errors: 0,
  };

  let subscription = null;
  let running = false;

  /**
   * Process a single broadcast event.
   *
   * @param {object} broadcastData — parsed broadcast event
   */
  async function processBroadcast(broadcastData) {
    stats.broadcastsReceived++;

    // 0a. Schema validation — drop malformed events at the boundary (F-H2)
    try {
      const { ContextBroadcastSchema } = await import('../packages/event-schemas/dist/index.js');
      broadcastData = ContextBroadcastSchema.parse(broadcastData);
    } catch (err) {
      stats.schemaRejected++;
      log(`[offerer] schema validation failed for broadcast ${broadcastData?.event_id || '<no id>'}: ${err.message}`);
      return { action: 'skip', reason: 'bad_schema' };
    }

    // 0b. STRICT signature verification — bind nodeId↔pubkey via registry + replay check
    const { verifyEvent } = await import('./node-identity.mjs');
    const verifyResult = verifyEvent(broadcastData, {
      requireSigned,
      registry,
      seenIds,
      checkFreshness: true,
    });
    if (verifyResult && verifyResult.ok === false) {
      if (verifyResult.reason === 'replay') {
        stats.replayRejected++;
        log(`[offerer] replay rejected: ${broadcastData.event_id}`);
        return { action: 'skip', reason: 'replay' };
      }
      stats.signatureRejected++;
      log(`[offerer] STRICT: rejecting broadcast ${broadcastData.event_id} — ${verifyResult.reason}`);
      // Normalize to legacy reason for caller-side compat; details are in the log
      return { action: 'skip', reason: 'bad_signature', detail: verifyResult.reason };
    }

    // 1. Skip self-originated (after sig check so attacker can't suppress us by spoofing self)
    if (broadcastData.node_id === nodeId) {
      stats.selfSkipped++;
      log(`[offerer] skipping self-originated broadcast ${broadcastData.event_id}`);
      return { action: 'skip', reason: 'self' };
    }

    // 1b. Peer liveness tracking — log if peer was previously dead
    if (peerTracker) {
      const peerId = broadcastData.node_id;
      const wasAlive = peerTracker.isAlive(peerId);
      peerTracker.recordSeen(peerId);
      if (!wasAlive) {
        stats.deadPeerLogged++;
        log(`[offerer] peer ${peerId} returned after silence (was dead, now alive)`);
      }
    }

    // 2. Check TTL expiry
    const broadcastTs = new Date(broadcastData.timestamp).getTime();
    const ttlMs = (broadcastData.data?.ttl_minutes || 60) * 60_000;
    if (Date.now() - broadcastTs > ttlMs) {
      stats.expiredSkipped++;
      log(`[offerer] skipping expired broadcast ${broadcastData.event_id}`);
      return { action: 'skip', reason: 'expired' };
    }

    // 3. Build query from themes + entities
    const themes = broadcastData.data?.themes || [];
    const entities = broadcastData.data?.entities || [];
    const queryParts = [...themes, ...entities];
    if (!queryParts.length) {
      return { action: 'skip', reason: 'empty_context' };
    }
    const query = queryParts.join(' ');

    // 4. Retrieve via pipeline
    let results = [];
    if (opts.retrievalPipeline) {
      try {
        results = await opts.retrievalPipeline.retrieve(query, { k: 10 });
      } catch (err) {
        stats.errors++;
        log(`[offerer] retrieval error: ${err.message}`);
        return { action: 'error', reason: 'retrieval_failed' };
      }
    }

    // 4b. Privacy pre-filter
    results = filterPrivateItems(results, opts.extractionDb || null);

    // 5. Filter by relevance threshold
    const relevant = results.filter(r => r.score >= threshold);
    if (!relevant.length) {
      stats.belowThreshold++;
      log(`[offerer] no results above threshold ${threshold} for broadcast ${broadcastData.event_id}`);
      return { action: 'skip', reason: 'below_threshold' };
    }

    // 6. Cap at top-K artifacts
    const topResults = relevant.slice(0, maxArtifacts);

    // 7. Generate summaries IN PARALLEL (F-H3 fix — was sequential 9s blocker)
    const summaries = await Promise.all(
      topResults.map(r => generateRelevanceSummary(
        broadcastData.data,
        r,
        { requestAnalysis: opts.requestAnalysis },
      ))
    );

    // 8. Build and validate offer event
    const offerEvent = buildOfferFromResults(
      broadcastData.event_id,
      nodeId,
      topResults,
      summaries,
      expiryMinutes,
    );

    let validated;
    try {
      const { ContextOfferSchema } = await import('../packages/event-schemas/dist/index.js');
      validated = ContextOfferSchema.parse(offerEvent);
    } catch (err) {
      stats.errors++;
      log(`[offerer] schema validation failed: ${err.message}`);
      return { action: 'error', reason: 'validation_error' };
    }

    // 8b. Sign the offer (F-C1) — refuse to publish unsigned if STRICT
    let signed = validated;
    if (identity) {
      try {
        const { signEvent } = await import('./node-identity.mjs');
        signed = signEvent(validated, identity.privateKey);
      } catch (err) {
        stats.errors++;
        log(`[offerer] signing failed: ${err.message}`);
        return { action: 'error', reason: 'signing_error' };
      }
    } else if (requireSigned) {
      stats.errors++;
      log(`[offerer] refused to publish unsigned offer (no identity + STRICT mode)`);
      return { action: 'skip', reason: 'unsigned_refused' };
    }

    // 9. Publish to shared stream
    try {
      const { StringCodec } = _require('nats');
      const sc = StringCodec();
      const js = nc.jetstream();
      const subject = `context.offer.${nodeId}`;
      await js.publish(subject, sc.encode(JSON.stringify(signed)), {
        msgID: offerEvent.event_id,
      });

      stats.offersPublished++;
      log(`[offerer] published offer for broadcast ${broadcastData.event_id} (${topResults.length} artifacts)`);
      return { action: 'offered', eventId: offerEvent.event_id, artifactCount: topResults.length };
    } catch (err) {
      stats.errors++;
      log(`[offerer] publish error: ${err.message}`);
      return { action: 'error', reason: 'publish_error' };
    }
  }

  /**
   * Start the offerer — subscribe to context.broadcast.> on the shared stream.
   */
  async function start() {
    if (running) return;
    running = true;

    try {
      const { StringCodec } = _require('nats');
      const sc = StringCodec();
      const js = nc.jetstream();
      const consumerName = `${CONSUMER_NAME_PREFIX}-${nodeId}`;

      // Subscribe to context.broadcast.> using a durable pull consumer
      // Use ordered consumer for simplicity — deliver new messages only
      try {
        const consumer = await js.consumers.get('OPENCLAW_SHARED', consumerName);
        subscription = await consumer.consume();
      } catch {
        // Consumer may not exist — create an ephemeral ordered consumer
        try {
          subscription = await js.subscribe('context.broadcast.>', {
            stream: 'OPENCLAW_SHARED',
          });
        } catch (subErr) {
          // Shared stream may not be available — degrade gracefully
          log(`[offerer] shared stream unavailable, running in degraded mode: ${subErr.message}`);
          running = false;
          return;
        }
      }

      // Message processing loop
      (async () => {
        try {
          for await (const msg of subscription) {
            if (!running) break;
            try {
              const data = JSON.parse(sc.decode(msg.data));
              await processBroadcast(data);
            } catch (err) {
              stats.errors++;
              log(`[offerer] message processing error: ${err.message}`);
            }
            if (msg.ack) msg.ack();
          }
        } catch (err) {
          if (running) {
            log(`[offerer] subscription loop error: ${err.message}`);
          }
        }
      })();

      log('[offerer] started — listening for context.broadcast.> events');
    } catch (err) {
      stats.errors++;
      log(`[offerer] start error: ${err.message}`);
      running = false;
    }
  }

  /**
   * Stop the offerer — unsubscribe and clean up.
   */
  function stop() {
    running = false;
    if (subscription) {
      try {
        if (subscription.unsubscribe) subscription.unsubscribe();
        else if (subscription.close) subscription.close();
      } catch { /* ignore cleanup errors */ }
      subscription = null;
    }
    log('[offerer] stopped');
  }

  return { start, stop, stats, _processBroadcast: processBroadcast };
}
