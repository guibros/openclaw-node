#!/usr/bin/env node
/**
 * mesh-bridge.mjs — Optional NATS bridge for the memory daemon.
 *
 * High-level:
 *   Connects to the mesh NATS server (if configured via OPENCLAW_NATS env).
 *   Publishes session lifecycle events so other nodes stay aware.
 *   Subscribes to remote node events for cross-node context.
 *   Falls back gracefully if NATS is unreachable — daemon works standalone.
 *
 * Events published (subject: openclaw.memory.<nodeId>.<event>):
 *   - session.start    { sessionId, nodeId, timestamp }
 *   - session.active   { sessionId, nodeId, timestamp }
 *   - session.idle     { sessionId, nodeId, timestamp }
 *   - session.end      { sessionId, nodeId, timestamp, duration }
 *   - maintenance      { nodeId, type, result, timestamp }
 *
 * Events subscribed (subject: openclaw.memory.*.>):
 *   - All remote node memory events, logged + optionally written to
 *     ~/.openclaw/workspace/memory/mesh-events.jsonl
 *
 * Usage:
 *   import { createMeshBridge } from './mesh-bridge.mjs';
 *   const bridge = await createMeshBridge();  // returns null if NATS unavailable
 *   bridge?.publishEvent('session.start', { sessionId: '...' });
 *   bridge?.close();
 */

import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('mesh-bridge');

// ── NATS connection URL from environment (set by agent service) ──
const NATS_URL = process.env.OPENCLAW_NATS || '';
const NODE_ID = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const EVENTS_LOG = path.join(WORKSPACE, 'memory', 'mesh-events.jsonl');

/**
 * Create a mesh bridge instance. Returns null if NATS is not configured
 * or unreachable — the caller should always null-check.
 */
export async function createMeshBridge() {
  // No NATS URL = mesh not configured, return null (standalone mode)
  if (!NATS_URL) return null;

  try {
    // Dynamic import — nats package lives in ~/openclaw/node_modules
    // Add it to NODE_PATH or resolve from known location
    const natsPath = path.join(os.homedir(), 'openclaw', 'node_modules', 'nats');
    let natsModule;
    try {
      natsModule = await import('nats');
    } catch (err) {
      console.warn(`[mesh-bridge] nats import failed, trying fallback: ${err.message}`);
      try {
        natsModule = await import(natsPath);
      } catch (err2) {
        console.warn(`[mesh-bridge] nats fallback import failed: ${err2.message}`);
        return null;
      }
    }

    const { connect, StringCodec } = natsModule;
    const sc = StringCodec();

    // Connect with a short timeout — don't block the daemon
    const nc = await connect({ servers: NATS_URL, timeout: 5000 });
    
    // ── Event log file (append-only JSONL for mesh event history) ──
    const logDir = path.dirname(EVENTS_LOG);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    // ── Subscribe to remote node events ──
    const sub = nc.subscribe('openclaw.memory.>');
    (async () => {
      for await (const msg of sub) {
        try {
          const event = JSON.parse(sc.decode(msg.data));
          // Skip our own events (echo prevention)
          if (event.nodeId === NODE_ID) continue;

          // Append to mesh-events.jsonl for local context
          const line = JSON.stringify({
            ...event,
            receivedAt: new Date().toISOString(),
            subject: msg.subject,
          }) + '\n';
          fs.appendFileSync(EVENTS_LOG, line);
        } catch (err) {
          console.warn(`[mesh-bridge] malformed event on ${msg.subject}: ${err.message}`);
        }
      }
    })();

    // ── Bridge API ──
    return {
      nodeId: NODE_ID,
      connected: true,

      /**
       * Publish a memory event to the mesh.
       * @param {string} eventType - e.g. 'session.start', 'session.end', 'maintenance'
       * @param {object} payload - event-specific data
       */
      publishEvent(eventType, payload = {}) {
        try {
          const event = {
            nodeId: NODE_ID,
            event: eventType,
            timestamp: new Date().toISOString(),
            ...payload,
          };
          nc.publish(
            `openclaw.memory.${NODE_ID}.${eventType}`,
            sc.encode(JSON.stringify(event))
          );
        } catch (err) {
          console.warn(`[mesh-bridge] publish failed for ${eventType}: ${err.message}`);
        }
      },

      /**
       * Get recent events from remote nodes (last N lines from JSONL log).
       * @param {number} n - number of recent events
       * @returns {object[]}
       */
      getRecentRemoteEvents(n = 20) {
        try {
          if (!fs.existsSync(EVENTS_LOG)) return [];
          const lines = fs.readFileSync(EVENTS_LOG, 'utf8').trim().split('\n');
          return lines.slice(-n).map(l => {
            try { return JSON.parse(l); } catch (err) { console.warn(`[mesh-bridge] event line parse failed: ${err.message}`); return null; }
          }).filter(Boolean);
        } catch (err) {
          console.warn(`[mesh-bridge] events log read failed: ${err.message}`);
          return [];
        }
      },

      /**
       * Clean close — drain subscriptions and disconnect.
       */
      async close() {
        try {
          await nc.drain();
        } catch (err) {
          console.warn(`[mesh-bridge] drain failed (already closed): ${err.message}`);
        }
      },
    };
  } catch (err) {
    console.warn(`[mesh-bridge] NATS connection failed, standalone mode: ${err.message}`);
    return null;
  }
}
