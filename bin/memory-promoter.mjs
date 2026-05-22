#!/usr/bin/env node

/**
 * memory-promoter.mjs — Promoter daemon for the OpenClaw federation layer
 *
 * Subscribes to the local event log (NATS JetStream), evaluates each event
 * against the promotion policy, and publishes eligible events to the shared
 * cluster (OPENCLAW_SHARED) with provenance tracking.
 *
 * Includes exponential backoff on shared cluster errors and health-check
 * integration. Single-node operation works fully without the cluster.
 *
 * Usage:
 *   node bin/memory-promoter.mjs
 *
 * Environment:
 *   NATS_URL           — NATS server URL (default: nats://localhost:4222)
 *   OPENCLAW_NODE_ID   — Node identifier (default: os.hostname())
 *   PROMOTION_POLICY   — Path to policy YAML (default: config/promotion-policy.yaml)
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { loadPromotionPolicy } from '../lib/promotion-policy.mjs';
import { ensureSharedStream, SHARED_STREAM_NAME } from '../lib/shared-event-stream.mjs';

const _require = createRequire(import.meta.url);

// ── Policy evaluation ────────────────────────────────────

/**
 * Check whether an event matches the 'kanban_events' automatic rule.
 * Kanban events have entity_type 'task' or event_type starting with 'kanban.'.
 *
 * @param {object} event - Event to check
 * @returns {boolean}
 */
function isKanbanEvent(event) {
  return (
    event.entity_type === 'task' ||
    (typeof event.event_type === 'string' && event.event_type.startsWith('kanban.'))
  );
}

/**
 * Check whether an event matches the 'share_true' explicit rule.
 * Looks for `share: true` in the event's data payload.
 *
 * @param {object} event - Event to check
 * @returns {boolean}
 */
function hasShareTrue(event) {
  return event.data?.share === true;
}

/**
 * Evaluate a single event against the promotion policy.
 *
 * Checks rules in priority order: automatic → explicit → threshold → manual_review.
 * Returns a decision object describing whether to promote, queue for review, or skip.
 *
 * @param {object} event - Event conforming to MemoryEventSchema
 * @param {object} policy - Validated promotion policy from loadPromotionPolicy
 * @returns {{ decision: 'promote'|'queue_for_review'|'skip', category: string, reason: string }}
 */
export function evaluatePromotionPolicy(event, policy) {
  // 1. Automatic — unconditional promotion for matching event types
  if (Array.isArray(policy.automatic)) {
    for (const rule of policy.automatic) {
      if (rule === 'kanban_events' && isKanbanEvent(event)) {
        return { decision: 'promote', category: 'automatic', reason: 'kanban_events' };
      }
    }
  }

  // 2. Explicit — entities explicitly marked for sharing
  if (Array.isArray(policy.explicit)) {
    for (const rule of policy.explicit) {
      if (rule === 'share_true' && hasShareTrue(event)) {
        return { decision: 'promote', category: 'explicit', reason: 'share_true' };
      }
    }
  }

  // 3. Threshold — numeric criteria on event data
  if (policy.threshold && typeof policy.threshold === 'object') {
    // concept_mention_count: concepts mentioned N+ times
    if (
      policy.threshold.concept_mention_count != null &&
      event.event_type === 'memory.concept_mentioned' &&
      typeof event.data?.mention_count === 'number' &&
      event.data.mention_count >= policy.threshold.concept_mention_count
    ) {
      return {
        decision: 'promote',
        category: 'threshold',
        reason: `concept_mention_count >= ${policy.threshold.concept_mention_count}`,
      };
    }

    // decision_confidence: high-confidence decisions
    if (
      policy.threshold.decision_confidence != null &&
      typeof event.data?.confidence === 'number' &&
      event.data.confidence >= policy.threshold.decision_confidence
    ) {
      return {
        decision: 'promote',
        category: 'threshold',
        reason: `decision_confidence >= ${policy.threshold.decision_confidence}`,
      };
    }
  }

  // 4. Default — queue for manual review
  return {
    decision: 'queue_for_review',
    category: 'manual_review',
    reason: 'no automatic/explicit/threshold match',
  };
}

// ── Subject mapping ──────────────────────────────────────

/**
 * Map a local event to the appropriate shared stream subject.
 *
 * Subject patterns must match SHARED_SUBJECTS defined in shared-event-stream.mjs:
 *   kanban.events.>  concepts.shared.>  lessons.shared.>
 *   context.broadcast.>  context.offer.>  context.accepted.>
 *   artifacts.shared.>
 *
 * @param {object} event - Event with event_type, entity_id, entity_type
 * @returns {string} NATS subject for the shared stream
 */
export function mapToSharedSubject(event) {
  // Kanban events → kanban.events.{entity_id}.{event_type}
  if (isKanbanEvent(event)) {
    return `kanban.events.${event.entity_id}.${event.event_type}`;
  }

  // Concept-mentioned events → concepts.shared.{entity_id}
  if (event.event_type === 'memory.concept_mentioned') {
    return `concepts.shared.${event.entity_id}`;
  }

  // Fact-extracted / decision events → lessons.shared.{entity_id}
  if (
    event.event_type === 'memory.fact_extracted' ||
    event.event_type === 'memory.snapshot_taken'
  ) {
    return `lessons.shared.${event.entity_id}`;
  }

  // Default — lessons.shared catchall for any promoted memory event
  return `lessons.shared.${event.entity_id}`;
}

// ── Backoff controller ───────────────────────────────────

/**
 * Create an exponential backoff controller for shared cluster retries.
 *
 * @param {object} [opts]
 * @param {number} [opts.baseDelay=1000] - Initial delay in ms
 * @param {number} [opts.maxDelay=60000] - Maximum delay in ms
 * @param {number} [opts.multiplier=2] - Delay multiplier per failure
 * @returns {{ recordFailure: function, reset: function, getDelay: function, failures: number }}
 */
export function createBackoff(opts = {}) {
  const baseDelay = opts.baseDelay ?? 1000;
  const maxDelay = opts.maxDelay ?? 60000;
  const multiplier = opts.multiplier ?? 2;
  let currentDelay = baseDelay;
  let failures = 0;

  return {
    /** Record a failure and advance the delay. Returns the new delay in ms. */
    recordFailure() {
      failures++;
      currentDelay = Math.min(currentDelay * multiplier, maxDelay);
      return currentDelay;
    },

    /** Reset backoff state after a successful operation. */
    reset() {
      failures = 0;
      currentDelay = baseDelay;
    },

    /** Get the current delay in ms. */
    getDelay() {
      return currentDelay;
    },

    /** Current failure count. */
    get failures() {
      return failures;
    },
  };
}

// ── Promoter factory ─────────────────────────────────────

/**
 * Create a promoter instance that subscribes to the local event log
 * and publishes eligible events to the shared cluster.
 *
 * @param {object} nc - NATS connection
 * @param {string} nodeId - Node identifier
 * @param {object} [opts]
 * @param {string} [opts.policyPath] - Override policy config path
 * @param {object} [opts.policy] - Pre-loaded policy (skips file load)
 * @param {object} [opts.backoffOpts] - Backoff controller options
 * @param {function} [opts.onPromote] - Callback on successful promotion
 * @param {function} [opts.onQueueForReview] - Callback on queue_for_review
 * @param {function} [opts.onError] - Callback on publish errors
 * @returns {Promise<{ stop: function, backoff: object, policy: object, stats: object }>}
 */
export async function createPromoter(nc, nodeId, opts = {}) {
  const { StringCodec } = _require('nats');
  const sc = StringCodec();

  // Load promotion policy
  const policy = opts.policy || (await loadPromotionPolicy(opts.policyPath));

  // Ensure shared stream exists (degraded mode if unreachable)
  let sharedAvailable = true;
  try {
    await ensureSharedStream(nc);
  } catch (err) {
    sharedAvailable = false;
    if (opts.onError) opts.onError('shared_stream_init', err);
  }

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();
  const backoff = createBackoff(opts.backoffOpts);

  const streamName = `local-events-${nodeId}`;
  const consumerName = `promoter-${nodeId}`;

  // Ensure durable consumer on local stream
  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      deliver_policy: 'new',
    });
  }

  const stats = { promoted: 0, queued: 0, errors: 0 };
  let running = true;

  const consumer = await js.consumers.get(streamName, consumerName);
  const iter = await consumer.consume();

  // Process messages in background
  const processingLoop = (async () => {
    for await (const msg of iter) {
      if (!running) break;

      let event;
      try {
        event = JSON.parse(sc.decode(msg.data));
      } catch {
        msg.ack();
        continue;
      }

      const result = evaluatePromotionPolicy(event, policy);

      if (result.decision === 'promote') {
        if (!sharedAvailable && backoff.failures > 3) {
          // Try to re-establish shared stream
          try {
            await ensureSharedStream(nc);
            sharedAvailable = true;
            backoff.reset();
          } catch {
            // Still down — wait and retry on next message
          }
        }

        // Apply backoff delay if needed
        if (backoff.failures > 0) {
          await new Promise((r) => setTimeout(r, backoff.getDelay()));
        }

        const sharedSubject = mapToSharedSubject(event);
        const sharedEvent = {
          ...event,
          event_id: crypto.randomUUID(),
          promoted_from: {
            node_id: nodeId,
            local_event_id: event.event_id,
          },
        };

        try {
          await js.publish(
            sharedSubject,
            sc.encode(JSON.stringify(sharedEvent)),
            { msgID: `promoted-${event.idempotency_key}` }
          );
          backoff.reset();
          stats.promoted++;
          if (opts.onPromote) opts.onPromote(event, result);
        } catch (err) {
          backoff.recordFailure();
          stats.errors++;
          if (opts.onError) opts.onError('publish', err);
          // NAK for redelivery
          msg.nak();
          continue;
        }
      } else if (result.decision === 'queue_for_review') {
        stats.queued++;
        if (opts.onQueueForReview) opts.onQueueForReview(event, result);
      }

      msg.ack();
    }
  })();

  return {
    /** Stop the promoter consumer loop. */
    stop() {
      running = false;
      iter.stop();
      return processingLoop;
    },
    backoff,
    policy,
    stats,
  };
}

// ── CLI entry point ──────────────────────────────────────

async function main() {
  const { connect } = _require('nats');

  const nodeId = process.env.OPENCLAW_NODE_ID || os.hostname();
  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';

  const nc = await connect({ servers: natsUrl });
  console.log(`[promoter] connected to ${natsUrl} as node ${nodeId}`);

  const promoter = await createPromoter(nc, nodeId, {
    policyPath: process.env.PROMOTION_POLICY || undefined,
    onPromote: (event, result) => {
      console.log(
        `[promoter] promoted ${event.event_type} (${result.category}/${result.reason})`
      );
    },
    onQueueForReview: (event, result) => {
      console.log(
        `[promoter] queued ${event.event_type} for review (${result.reason})`
      );
    },
    onError: (context, err) => {
      console.error(`[promoter] error in ${context}: ${err.message}`);
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[promoter] shutting down...');
    await promoter.stop();
    await nc.drain();
    console.log(
      `[promoter] stopped. stats: ${promoter.stats.promoted} promoted, ${promoter.stats.queued} queued, ${promoter.stats.errors} errors`
    );
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run main if invoked directly
const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  main().catch((err) => {
    console.error('[promoter] fatal:', err.message);
    process.exit(1);
  });
}
