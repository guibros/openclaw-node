/**
 * shared-event-stream.mjs — Shared JetStream stream for cross-node federation
 *
 * Configures and ensures the OPENCLAW_SHARED stream exists on the connected
 * NATS cluster with R=3 replication. This is infrastructure preparation only —
 * the stream sits idle until Block 4 wires promoter/subscriber processes.
 *
 * The stream carries federation subjects: kanban events, shared lessons,
 * shared concepts, broadcast/offer/accepted context, and shared artifacts.
 *
 * Usage:
 *   import { ensureSharedStream, inspectSharedStream } from '../lib/shared-event-stream.mjs';
 *   const info = await ensureSharedStream(natsConn);
 *   const status = await inspectSharedStream(natsConn);
 */

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { StorageType } = _require('nats');

/** The canonical name of the shared federation stream. */
export const SHARED_STREAM_NAME = 'OPENCLAW_SHARED';

/**
 * Subject filter for the shared stream.
 * Each entry is a NATS subject pattern covering one federation domain.
 * Matches REFERENCE_PLAN §1.4 specification verbatim.
 */
export const SHARED_SUBJECTS = [
  'kanban.events.>',
  'lessons.shared.>',
  'concepts.shared.>',
  'context.broadcast.>',
  'context.offer.>',
  'context.accepted.>',
  'artifacts.shared.>',
];

/**
 * Ensure the OPENCLAW_SHARED stream exists on the connected NATS cluster.
 *
 * Creates the stream if it doesn't exist. If it already exists, returns
 * the existing stream info without modification.
 *
 * Requires the NATS cluster to have ≥3 nodes for R=3 to succeed.
 * If the cluster has fewer nodes, NATS will reject the create/update.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @returns {Promise<object>} JetStream stream info
 */
export async function ensureSharedStream(nc) {
  const jsm = await nc.jetstreamManager();

  try {
    const info = await jsm.streams.info(SHARED_STREAM_NAME);
    return info;
  } catch {
    // Stream doesn't exist — create it
    const info = await jsm.streams.add({
      name: SHARED_STREAM_NAME,
      subjects: SHARED_SUBJECTS,
      storage: StorageType.File,
      num_replicas: 3,
    });
    return info;
  }
}

/**
 * Inspect the OPENCLAW_SHARED stream and return its current state.
 *
 * Returns stream configuration and state for operational verification.
 * Throws if the stream does not exist.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @returns {Promise<{ config: object, state: object }>} Stream info with config and state
 */
export async function inspectSharedStream(nc) {
  const jsm = await nc.jetstreamManager();
  const info = await jsm.streams.info(SHARED_STREAM_NAME);
  return {
    config: info.config,
    state: info.state,
  };
}
