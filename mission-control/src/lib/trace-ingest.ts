/**
 * trace-ingest.ts — NATS→SQLite bridge for daemon trace events.
 *
 * Daemon trace events are published to NATS (`openclaw.trace.>`), visible in
 * the live SSE stream, but NOT persisted to the observability_events table.
 * This module subscribes to NATS and batches events into SQLite so they appear
 * in historical queries (/api/observability/events).
 *
 * Singleton — call `startTraceIngestion()` from any route; only the first call
 * starts the subscriber. Subsequent calls are no-ops.
 *
 * Batches events every 2s to minimize DB write contention.
 */

import { getNats, sc } from "./nats";
import { batchInsertEvents } from "./tracer";
import { NODE_ID } from "./config";

let _started = false;
let _eventBuffer: any[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;

const BATCH_INTERVAL_MS = 2000;
const MAX_BUFFER_SIZE = 500;

function flush() {
  if (_eventBuffer.length === 0) return;
  const batch = _eventBuffer.splice(0);
  batchInsertEvents(batch);
}

export async function startTraceIngestion() {
  if (_started) return;
  _started = true;

  const nc = await getNats();
  if (!nc) {
    console.warn("[trace-ingest] NATS unavailable — daemon events will not be persisted");
    _started = false;
    return;
  }

  // Subscribe to all trace events from all nodes
  const sub = nc.subscribe("openclaw.trace.>");

  // Flush buffer periodically
  _flushTimer = setInterval(flush, BATCH_INTERVAL_MS);

  console.log("[trace-ingest] Started NATS→DB ingestion for daemon trace events");

  // Process events in background
  (async () => {
    try {
      for await (const msg of sub) {
        try {
          const raw = JSON.parse(sc.decode(msg.data));

          // Extract source node from subject: openclaw.trace.<nodeId>.<module>
          const parts = msg.subject.split(".");
          const sourceNode = parts[2] || "unknown";

          // Skip events from MC itself — those are already persisted via insertEvent()
          if (sourceNode === NODE_ID) continue;

          // Normalize to the camelCase schema used by observability_events table
          const event = {
            id: raw.id || crypto.randomUUID(),
            timestamp: raw.timestamp || Date.now(),
            nodeId: raw.node_id || sourceNode,
            module: raw.module || parts[3] || "unknown",
            fn: raw.function || raw.fn || "unknown",
            tier: raw.tier || 2,
            category: raw.category || "lifecycle",
            argsSummary: (raw.args_summary || raw.argsSummary || "").slice(0, 120),
            resultSummary: (raw.result_summary || raw.resultSummary || "").slice(0, 80),
            durationMs: raw.duration_ms || raw.durationMs || 0,
            error: raw.error || null,
            meta: raw.meta ? (typeof raw.meta === "string" ? raw.meta : JSON.stringify(raw.meta)) : null,
          };

          _eventBuffer.push(event);

          // Emergency flush if buffer gets too large
          if (_eventBuffer.length >= MAX_BUFFER_SIZE) {
            flush();
          }
        } catch {
          // Skip malformed events
        }
      }
    } catch {
      // Subscription ended (NATS closed)
      console.log("[trace-ingest] NATS subscription ended");
    }
  })();
}
