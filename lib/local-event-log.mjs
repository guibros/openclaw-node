/**
 * local-event-log.mjs — Per-node event log substrate using NATS JetStream
 *
 * Provides durable, local-first event logging with Zod validation.
 * The stream is R=1 (no replication) and file-backed for sovereignty.
 *
 * Usage:
 *   import { createLocalEventLog, buildMemoryEvent } from '../lib/local-event-log.mjs';
 *   const eventLog = await createLocalEventLog(natsConn, nodeId);
 *   const event = buildMemoryEvent('memory.session_started', sessionId, 'session', data, nodeId);
 *   await eventLog.publishLocal(event);
 */

import crypto from 'crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('local-event-log');

const STREAM_PREFIX = 'local-events';

/**
 * Create a local event log instance backed by NATS JetStream.
 *
 * Ensures the JetStream stream exists (creates it if missing),
 * then returns an object with a publishLocal method for validated event publishing.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @param {string} nodeId - Node identifier (e.g. process.env.OPENCLAW_NODE_ID || os.hostname())
 * @param {object} [opts] - Optional configuration
 * @param {{ privateKey: import('crypto').KeyObject }} [opts.identity] - Node identity for event signing
 * @returns {Promise<{ publishLocal: function, streamName: string }>}
 */
export async function createLocalEventLog(nc, nodeId, opts = {}) {
  const { MemoryEventSchema } = await import('../packages/event-schemas/dist/index.js');
  const { StringCodec, StorageType } = _require('nats');
  const sc = StringCodec();

  const streamName = `${STREAM_PREFIX}-${nodeId}`;

  // Ensure the JetStream stream exists (R=1, file storage)
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.info(streamName);
  } catch {
    // Stream doesn't exist — create it
    await jsm.streams.add({
      name: streamName,
      subjects: ['local.>'],
      storage: StorageType.File,
      num_replicas: 1,
    });
  }

  const js = nc.jetstream();

  /**
   * Publish a validated event to the local event log.
   *
   * Validates the event against MemoryEventSchema, computes the subject from
   * event fields, and publishes with idempotency_key as msgID for dedup.
   *
   * @param {object} event - Event object conforming to MemoryEventSchema
   * @returns {Promise<object>} JetStream publish ack
   */
  async function publishLocal(event) {
    const validated = MemoryEventSchema.parse(event);

    // Sign the event if identity is provided
    let toPublish = validated;
    if (opts.identity && opts.identity.privateKey) {
      const { signEvent } = await import('./node-identity.mjs');
      toPublish = signEvent(validated, opts.identity.privateKey);
    }

    const subject = `local.${toPublish.entity_type}.events.${toPublish.entity_id}.${toPublish.event_type}`;
    return await js.publish(subject, sc.encode(JSON.stringify(toPublish)), {
      msgID: toPublish.idempotency_key,
    });
  }

  return { publishLocal, streamName };
}

/**
 * Build a memory event with envelope fields auto-populated.
 *
 * Generates event_id (UUID), timestamp (ISO 8601), and idempotency_key.
 * The caller provides the event-specific fields.
 *
 * @param {string} eventType - Event type (e.g. 'memory.session_started')
 * @param {string} entityId - Entity ID (e.g. session UUID)
 * @param {string} entityType - Entity type enum value (e.g. 'session', 'memory')
 * @param {object} data - Event-specific data payload
 * @param {string} nodeId - Node identifier
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.causation_id] - Causation event ID
 * @param {string} [opts.correlation_id] - Correlation ID
 * @param {{ type: string, id: string }} [opts.actor] - Actor override
 * @param {string} [opts.idempotency_key] - Custom idempotency key
 * @returns {object} Complete event object ready for publishLocal
 */
export function buildMemoryEvent(eventType, entityId, entityType, data, nodeId, opts = {}) {
  const eventId = crypto.randomUUID();
  return {
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    entity_id: entityId,
    entity_type: entityType,
    timestamp: new Date().toISOString(),
    causation_id: opts.causation_id || null,
    correlation_id: opts.correlation_id || null,
    actor: opts.actor || { type: 'system', id: `daemon-${nodeId}` },
    node_id: nodeId,
    idempotency_key: opts.idempotency_key || eventId,
    data,
  };
}
