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
import { loadEventSchemas } from './event-schemas.mjs';
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
 * @param {object} [deps] — injectable dependencies
 * @param {Function} [deps.requestAnalysis] — ollama-queue.requestAnalysis
 * @param {{ summariesLlm?: number, summariesFallback?: number }} [deps.stats] — optional stats object to increment
 * @param {Function} [deps.log] — optional logger for fallback diagnostics
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

  // F-M6 helper: record that we fell back to data-only summary.
  // Stats and log are optional; when both are undefined the function behaves
  // exactly as before (silent fallback).
  const recordFallback = (reason) => {
    if (deps.stats && typeof deps.stats === 'object') {
      deps.stats.summariesFallback = (deps.stats.summariesFallback || 0) + 1;
    }
    if (typeof deps.log === 'function') {
      deps.log(`[offerer] LLM summary fell back to data-only (reason=${reason})`);
    }
  };
  const recordLlmSuccess = () => {
    if (deps.stats && typeof deps.stats === 'object') {
      deps.stats.summariesLlm = (deps.stats.summariesLlm || 0) + 1;
    }
  };

  const requestAnalysis = deps.requestAnalysis;
  if (!requestAnalysis) {
    recordFallback('no-analysis-fn');
    return dataOnlySummary;
  }

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
      if (text.trim()) {
        recordLlmSuccess();
        return text.trim();
      }
      recordFallback('empty-llm-response');
      return dataOnlySummary;
    }

    // outcome.mode === 'fallback' (queue busy / wait-timeout)
    recordFallback(outcome.reason || 'queue-fallback');
    return dataOnlySummary;
  } catch (err) {
    recordFallback(`error:${err?.message?.slice(0, 60) || 'unknown'}`);
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

  // F-H6 fix (fail-CLOSED for offerer): the previous implementation excluded
  // a session ONLY if at least one entity in it was private — meaning a
  // non-private session containing a private mention leaked the chunk. Even
  // worse, all error paths returned `results` unfiltered (fail-OPEN), which
  // is the WRONG default for a privacy filter that's about to ship data to
  // peers. The fix:
  //   1. Build a chunk-level filter (mentions per chunk_id) so any private
  //      mention attached to a specific chunk excludes that chunk.
  //   2. Errors fail-CLOSED: return [] rather than leaking on a query bug.
  //
  // Note: this is the OFFERER-specific filter (peer-facing). Local retrieval
  // uses retrieval-pipeline's privacy filter (also fixed in F-C13). Two
  // layers of defense.
  try {
    // Check if the private column exists (pre-Step 9.5 DBs don't have it)
    const row = extractionDb.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('entities') WHERE name = 'private'"
    ).get();
    if (!row || row.cnt === 0) {
      // No privacy column yet — refuse to offer anything (fail closed) since
      // we can't distinguish private from public.
      return [];
    }

    // Per-chunk filter: any chunk whose ANY mention is private → drop.
    // (Chunks have stable session_id + turn_index; mentions table records
    // the chunk's session_id, and we treat session_id as the chunk-grain
    // proxy here. Future schema can add chunk_id to mentions for true
    // per-chunk filtering. For now, session_id is the best available
    // grain, but combined with the SQL-level filters in retrieval-pipeline
    // F-C13, private mentions are already excluded from search results.)
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
      // Privacy query failed — fail CLOSED, don't ship anything to peers
      return [];
    }

    if (!privateSessionIds.size) return results;
    return results.filter(r => !privateSessionIds.has(r.session_id));
  } catch {
    // Any unhandled error → fail closed for the offerer (peer-facing).
    return [];
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
    // F-M6: visibility into LLM-summary success vs fallback rate. Operator
    // can compute fallback ratio (summariesFallback / (summariesLlm + summariesFallback))
    // to spot Ollama health issues — was silently invisible.
    summariesLlm: 0,
    summariesFallback: 0,
    errors: 0,
  };

  let subscription = null;
  let loopPromise = null;  // F-M1: track for stop() to await
  let running = false;

  /**
   * Process a single broadcast event.
   *
   * @param {object} broadcastData — parsed broadcast event
   */
  async function processBroadcast(broadcastData) {
    stats.broadcastsReceived++;

    // 0a. STRICT signature verification FIRST — must run before schema parse
    // because Zod's .parse() strips unknown keys (signature, signer_pubkey)
    // by default. If we parsed first, the signature would be gone before
    // verifyEvent could check it, and STRICT mode would always reject as
    // 'missing-signature'. Verify on the raw wire-format event.
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
      return { action: 'skip', reason: 'bad_signature', detail: verifyResult.reason };
    }

    // 0b. Schema validation (F-H2) — drop malformed events at the boundary.
    // Runs after sig check, so a signed-but-malformed event is rejected as
    // bad_schema, and an unsigned malformed event is rejected as bad_signature
    // earlier (correct priority: auth > shape).
    const { ContextBroadcastSchema } = await loadEventSchemas();
    try {
      broadcastData = ContextBroadcastSchema.parse(broadcastData);
    } catch (err) {
      stats.schemaRejected++;
      log(`[offerer] schema validation failed for broadcast ${broadcastData?.event_id || '<no id>'}: ${err.message}`);
      return { action: 'skip', reason: 'bad_schema' };
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

    // 7. Generate summaries IN PARALLEL (F-H3 fix — was sequential 9s blocker).
    // F-M6: pass stats + log so summary-LLM success/fallback rate is visible.
    const summaries = await Promise.all(
      topResults.map(r => generateRelevanceSummary(
        broadcastData.data,
        r,
        { requestAnalysis: opts.requestAnalysis, stats, log },
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
    const { ContextOfferSchema } = await loadEventSchemas();
    try {
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

      // Message processing loop.
      // F-H1 fix: only ack on SUCCESSFUL processing. On processing error,
      // nak the message so JetStream can redeliver. Schema-rejected and
      // sig-rejected messages are PERMANENT failures — we ack those so
      // JetStream stops retrying (they'll never succeed regardless).
      // F-M1: track loop promise so stop() can await it.
      loopPromise = (async () => {
        try {
          for await (const msg of subscription) {
            if (!running) break;
            let outcome = 'ack';  // default: ack to remove from redelivery queue
            try {
              const data = JSON.parse(sc.decode(msg.data));
              const result = await processBroadcast(data);
              // If skip due to bad_schema/bad_signature/replay/self, ack — permanent.
              // If processing succeeded or skip was for transient reasons, ack.
              // If error path produces 'error' action, nak so JetStream retries.
              if (result?.action === 'error') outcome = 'nak';
            } catch (err) {
              stats.errors++;
              log(`[offerer] message processing error: ${err.message}`);
              // Treat thrown errors as transient → nak for redelivery
              outcome = 'nak';
            }
            if (outcome === 'ack' && msg.ack) msg.ack();
            else if (outcome === 'nak' && msg.nak) msg.nak();
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
   * F-M1: now async, awaits the message-processing loop with a small timeout
   * so test code calling `await stop()` knows when processing actually ends.
   */
  async function stop(timeoutMs = 1000) {
    running = false;
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
    log('[offerer] stopped');
  }

  return { start, stop, stats, _processBroadcast: processBroadcast };
}
