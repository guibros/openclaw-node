#!/usr/bin/env node

/**
 * memory-subscriber.mjs — Subscriber daemon for the OpenClaw federation layer
 *
 * Subscribes to the shared NATS JetStream cluster (OPENCLAW_SHARED), evaluates
 * each incoming event against an ingestion policy, filters out self-originated
 * events, and projects accepted events to local stores with provenance tracking.
 *
 * Mirrors the promoter's architecture (health-check + exponential backoff,
 * graceful shutdown) but operates in the reverse direction: shared → local.
 *
 * Usage:
 *   node bin/memory-subscriber.mjs
 *
 * Environment:
 *   NATS_URL           — NATS server URL (default: nats://localhost:4222)
 *   OPENCLAW_NODE_ID   — Node identifier (default: os.hostname())
 */

import os from 'node:os';
import { createRequire } from 'node:module';
import { ensureSharedStream, SHARED_STREAM_NAME } from '../lib/shared-event-stream.mjs';
import { createBackoff } from './memory-promoter.mjs';

const _require = createRequire(import.meta.url);

// ── Subject parsing ──────────────────────────────────────

/**
 * Known subject prefixes from the shared stream, mapped to category labels.
 * Order matters — first match wins.
 */
const SUBJECT_PREFIX_MAP = [
  { prefix: 'kanban.events.', category: 'kanban' },
  { prefix: 'concepts.shared.', category: 'concept' },
  { prefix: 'lessons.shared.', category: 'lesson' },
  { prefix: 'context.broadcast.', category: 'broadcast' },
  { prefix: 'context.offer.', category: 'offer' },
  { prefix: 'context.accepted.', category: 'accepted' },
  { prefix: 'artifacts.shared.', category: 'artifact' },
];

/**
 * Parse a shared-stream NATS subject into a category label.
 *
 * @param {string} subject - NATS subject (e.g. 'kanban.events.task-1.kanban.created')
 * @returns {{ category: string, remainder: string } | null} Parsed result or null if unrecognized
 */
export function parseSharedSubject(subject) {
  if (typeof subject !== 'string') return null;

  for (const { prefix, category } of SUBJECT_PREFIX_MAP) {
    if (subject.startsWith(prefix)) {
      return { category, remainder: subject.slice(prefix.length) };
    }
  }

  return null;
}

// ── Ingestion policy ─────────────────────────────────────

/**
 * Evaluate whether a shared event should be ingested into local stores.
 *
 * Rules (in order):
 * 1. Skip if the event originated from this node (self-loop prevention).
 * 2. Accept kanban events unconditionally (per Block 4 frozen decisions).
 * 3. Accept concept and lesson events (shared knowledge).
 * 4. Accept artifact events.
 * 5. Skip everything else (broadcast/offer/accepted are Block 9 scope).
 *
 * @param {object} event - Shared event with promoted_from metadata
 * @param {string} nodeId - This node's identifier
 * @param {{ category: string } | null} parsed - Result of parseSharedSubject
 * @returns {{ decision: 'accept'|'skip', reason: string }}
 */
export function evaluateIngestionPolicy(event, nodeId, parsed) {
  // 1. Self-originated — never ingest your own promoted events
  if (event.promoted_from?.node_id === nodeId) {
    return { decision: 'skip', reason: 'self_originated' };
  }

  // 2. No category parsed — unknown subject
  if (!parsed) {
    return { decision: 'skip', reason: 'unknown_subject' };
  }

  // 3. Kanban — always ingest (per Block 4 frozen decisions)
  if (parsed.category === 'kanban') {
    return { decision: 'accept', reason: 'kanban_always_ingest' };
  }

  // 4. Concept and lesson — shared knowledge
  if (parsed.category === 'concept' || parsed.category === 'lesson') {
    return { decision: 'accept', reason: `shared_${parsed.category}` };
  }

  // 5. Artifact — shared artifacts
  if (parsed.category === 'artifact') {
    return { decision: 'accept', reason: 'shared_artifact' };
  }

  // 6. Everything else (broadcast/offer/accepted) — Block 9 scope
  return { decision: 'skip', reason: 'deferred_to_block_9' };
}

// ── Subscriber factory ───────────────────────────────────

/**
 * Create a subscriber instance that consumes the shared stream
 * and projects accepted events into local stores.
 *
 * @param {object} nc - NATS connection
 * @param {string} nodeId - Node identifier
 * @param {object} opts
 * @param {function} opts.onIngest - REQUIRED. Callback(event, parsed, provenance)
 *   invoked for every accepted event. Without this, accepted events are acked
 *   from JetStream's redelivery queue with no projection — events evaporate.
 *   F-N107 fix: was optional, which made an entire class of "subscriber wired
 *   but no consumer" bugs silent. Throw early so the misconfiguration is
 *   visible at startup.
 * @param {object} [opts.backoffOpts] - Backoff controller options
 * @param {function} [opts.onSkip] - Callback(event, result) on skipped event
 * @param {function} [opts.onError] - Callback(context, err) on errors
 * @returns {Promise<{ stop: function, backoff: object, stats: object }>}
 */
export async function createSubscriber(nc, nodeId, opts = {}) {
  // F-N107: fail fast on missing onIngest.
  // F-Q302: type check alone is paper-thin (`onIngest: () => {}` passes!).
  // Detect trivial stub patterns at startup and log a loud warning so
  // operators see what they're getting. The deeper fix — requiring a
  // discriminated return-value contract — is documented but not yet
  // enforced via type system here (would break existing callers).
  if (typeof opts.onIngest !== 'function') {
    throw new Error(
      'createSubscriber: opts.onIngest is required. ' +
      'Without it, accepted events are acked from JetStream with no projection. ' +
      'See F-N107.'
    );
  }
  // F-Q302 stub detector: an onIngest source body < 40 chars almost always
  // means a no-op or pure log. Surface it loudly so the daemon's "started
  // in STUB mode" warning isn't the only signal that events evaporate.
  try {
    const src = opts.onIngest.toString();
    if (src.length < 40 || /^\s*\(?\s*[a-z_,\s]*\)?\s*=>\s*\{?\s*\}?\s*$/i.test(src)) {
      const warn = '[subscriber] WARNING: onIngest appears to be a stub ' +
        `(source: ${JSON.stringify(src.slice(0, 80))}). ` +
        'Events will be acked from JetStream without projection. ' +
        'See F-Q302.';
      if (opts.onError) opts.onError('stub_detected', new Error(warn));
      else process.stderr.write(warn + '\n');
    }
  } catch { /* toString may fail on bound/native fns — ignore */ }
  const { StringCodec } = _require('nats');
  const sc = StringCodec();

  // Ensure shared stream exists (degraded mode if unreachable)
  let sharedAvailable = true;
  try {
    await ensureSharedStream(nc);
  } catch (err) {
    sharedAvailable = false;
    if (opts.onError) opts.onError('shared_stream_init', err);
  }

  if (!sharedAvailable) {
    // Cannot subscribe without the stream — return a no-op subscriber
    // that can be stopped. The caller can retry on next tick.
    const backoff = createBackoff(opts.backoffOpts);
    backoff.recordFailure();
    return {
      stop() { return Promise.resolve(); },
      backoff,
      stats: { ingested: 0, skipped: 0, errors: 0 },
    };
  }

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();
  const backoff = createBackoff(opts.backoffOpts);

  const consumerName = `subscriber-${nodeId}`;

  // Ensure durable consumer on shared stream
  try {
    await jsm.consumers.info(SHARED_STREAM_NAME, consumerName);
  } catch {
    await jsm.consumers.add(SHARED_STREAM_NAME, {
      durable_name: consumerName,
      deliver_policy: 'new',
    });
  }

  const stats = { ingested: 0, skipped: 0, errors: 0 };
  let running = true;

  const consumer = await js.consumers.get(SHARED_STREAM_NAME, consumerName);
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

      const parsed = parseSharedSubject(msg.subject);
      const result = evaluateIngestionPolicy(event, nodeId, parsed);

      if (result.decision === 'accept') {
        const provenance = {
          source_type: 'shared',
          source_node: event.promoted_from?.node_id || 'unknown',
          source_event_id: event.event_id,
        };

        try {
          // F-N107: opts.onIngest is validated as required at factory init.
          opts.onIngest(event, parsed, provenance);
          backoff.reset();
          stats.ingested++;
        } catch (err) {
          backoff.recordFailure();
          stats.errors++;
          if (opts.onError) opts.onError('projection', err);
          msg.nak();
          continue;
        }
      } else {
        stats.skipped++;
        if (opts.onSkip) opts.onSkip(event, result);
      }

      msg.ack();
    }
  })();

  return {
    /** Stop the subscriber consumer loop. */
    stop() {
      running = false;
      iter.stop();
      return processingLoop;
    },
    backoff,
    stats,
  };
}

// ── CLI entry point ──────────────────────────────────────

async function main() {
  const { connect } = _require('nats');

  const nodeId = process.env.OPENCLAW_NODE_ID || os.hostname();
  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';

  const nc = await connect({ servers: natsUrl });
  console.log(`[subscriber] connected to ${natsUrl} as node ${nodeId}`);

  const subscriber = await createSubscriber(nc, nodeId, {
    onIngest: (event, parsed, provenance) => {
      console.log(
        `[subscriber] ingested ${parsed.category} event ${event.event_id} from ${provenance.source_node}`
      );
    },
    onSkip: (event, result) => {
      console.log(
        `[subscriber] skipped ${event.event_type || 'unknown'} (${result.reason})`
      );
    },
    onError: (context, err) => {
      console.error(`[subscriber] error in ${context}: ${err.message}`);
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[subscriber] shutting down...');
    await subscriber.stop();
    await nc.drain();
    console.log(
      `[subscriber] stopped. stats: ${subscriber.stats.ingested} ingested, ${subscriber.stats.skipped} skipped, ${subscriber.stats.errors} errors`
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
    console.error('[subscriber] fatal:', err.message);
    process.exit(1);
  });
}
