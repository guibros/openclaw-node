import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { observabilityEvents } from "./db/schema";
import { getNats, sc } from "./nats";
import { NODE_ID } from "./config";

/** Wrap a Next.js route handler with trace logging */
export function withTrace(
  module: string,
  method: string,
  handler: (request: NextRequest, context?: any) => Promise<NextResponse>,
  opts: { tier?: number; category?: string } = {}
) {
  return async (request: NextRequest, context?: any): Promise<NextResponse> => {
    const start = Date.now();
    const event = {
      id: crypto.randomUUID(),
      timestamp: start,
      nodeId: NODE_ID,
      module,
      fn: method,
      tier: opts.tier || 2,
      category: opts.category || "api_call",
      argsSummary: `${request.method} ${request.nextUrl.pathname}`,
      resultSummary: null as string | null,
      durationMs: 0,
      error: null as string | null,
      meta: null as string | null,
    };

    try {
      const result = await handler(request, context);
      event.durationMs = Date.now() - start;
      event.resultSummary = `${result.status}`;
      insertEvent(event);
      publishEvent(event);
      return result;
    } catch (err: any) {
      event.durationMs = Date.now() - start;
      event.error = err?.message || String(err);
      event.category = "error";
      insertEvent(event);
      publishEvent(event);
      throw err;
    }
  };
}

/** Insert trace event into SQLite */
function insertEvent(event: any) {
  try {
    const db = getDb();
    db.insert(observabilityEvents).values(event).run();
  } catch {
    // Intentional: best-effort DB insert, event may be published via NATS
  }
}

/** Publish trace event to NATS */
async function publishEvent(event: any) {
  try {
    const nats = await getNats();
    if (nats) {
      const subject = `openclaw.trace.${NODE_ID}.mc`;
      nats.publish(subject, sc.encode(JSON.stringify(event)));
    }
  } catch {
    // Intentional: best-effort NATS publish, event may be in DB
  }
}

/** Trace a plain function call (non-route-handler). Fire-and-forget. */
export function traceCall(
  module: string,
  fn: string,
  start: number,
  result?: any,
  error?: any
) {
  const event = {
    id: crypto.randomUUID(),
    timestamp: start,
    nodeId: NODE_ID,
    module,
    fn,
    tier: 2,
    category: error ? "error" : "compute",
    argsSummary: "",
    resultSummary: result != null ? String(result).slice(0, 80) : null,
    durationMs: Date.now() - start,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    meta: null,
  };
  insertEvent(event);
  publishEvent(event);
}

/** Batch insert events (for NATS ingestion) */
export function batchInsertEvents(events: any[]) {
  try {
    const db = getDb();
    for (const e of events) {
      db.insert(observabilityEvents).values(e).run();
    }
  } catch (err) {
    console.warn(`[tracer] batchInsert failed (${events.length} events): ${(err as Error).message}`);
  }
}
