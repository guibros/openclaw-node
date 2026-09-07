/**
 * publish-helper.mjs — Shared NATS publish utility for all OpenClaw publishers.
 *
 * Provides fire-and-forget extraction event publishing that all SDK wrappers
 * and hook scripts share. Two modes:
 *   1. `publishExtractDirect(nc, nodeId, triggeredBy)` — for callers that
 *      already hold a NATS connection.
 *   2. `createNatsPublisher(opts)` — lazy-connect factory for wrappers that
 *      need to manage their own connection lifecycle.
 */

import os from 'node:os';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

/** Default NATS server URL. */
export const DEFAULT_NATS_URL = 'nats://localhost:4222';

/** NATS subject for extraction requests (mirrors extraction-trigger.mjs). */
export const EXTRACT_SUBJECT = 'mesh.memory.extract_request';

const encoder = new TextEncoder();

/**
 * Publish an extraction request on an existing NATS connection.
 * Fire-and-forget — errors are silently swallowed.
 *
 * @param {import('nats').NatsConnection} nc
 * @param {string} nodeId
 * @param {string} [triggeredBy='manual']
 */
export function publishExtractDirect(nc, nodeId, triggeredBy = 'manual') {
  const payload = {
    node_id: nodeId,
    triggered_by: triggeredBy,
    timestamp: new Date().toISOString(),
  };
  nc.publish(EXTRACT_SUBJECT, encoder.encode(JSON.stringify(payload)));
}

/**
 * Create a lazy-connecting NATS publisher for extraction events.
 *
 * @param {object} [opts]
 * @param {string} [opts.natsUrl] - NATS server URL (env NATS_URL takes priority)
 * @param {string} [opts.nodeId] - Node identifier (env OPENCLAW_NODE_ID takes priority)
 * @param {import('nats').NatsConnection} [opts.nc] - Pre-existing connection (skips connect)
 * @returns {{ publish: (triggeredBy?: string) => Promise<void>, close: () => Promise<void> }}
 */
export function createNatsPublisher(opts = {}) {
  // NATS_URL / opts.natsUrl only override the URL; credentials (token or this
  // node's nkey) always come from lib/nats-resolve.
  const natsUrl = process.env.NATS_URL || opts.natsUrl || undefined;
  const nodeId = process.env.OPENCLAW_NODE_ID || opts.nodeId || os.hostname();
  let nc = opts.nc || null;
  let connecting = null;

  async function ensureConnection() {
    if (nc) return nc;
    if (connecting) return connecting;
    const { connect } = await import('nats');
    const { natsConnectOpts } = _require('../nats-resolve.js');
    connecting = connect(natsConnectOpts({ servers: natsUrl })).then(c => {
      nc = c;
      connecting = null;
      return c;
    });
    return connecting;
  }

  /**
   * Publish an extraction request. Fire-and-forget.
   * @param {string} [triggeredBy='manual']
   */
  async function publish(triggeredBy = 'manual') {
    try {
      const conn = await ensureConnection();
      publishExtractDirect(conn, nodeId, triggeredBy);
    } catch {
      // Fire-and-forget — NATS unreachable is not an error for the caller
    }
  }

  /** Close the managed NATS connection if one was created. */
  async function close() {
    if (nc && !opts.nc) {
      try {
        await nc.drain();
      } catch {
        // best-effort
      }
      nc = null;
    }
    connecting = null;
  }

  return { publish, close };
}
