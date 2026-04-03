import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { observabilityEvents } from "./db/schema";
import { getNats, sc } from "./nats";
import { NODE_ID } from "./config";

/** Summarize URL search params for trace logging (max 120 chars) */
function summarizeParams(url: URL): string {
  const params = url.searchParams;
  if (params.size === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of params) {
    parts.push(`${k}=${v.length > 20 ? v.slice(0, 17) + "..." : v}`);
  }
  return parts.join("&").slice(0, 100);
}

/** Safely extract a body summary for trace logging */
async function summarizeBody(request: NextRequest): Promise<string> {
  try {
    const clone = request.clone();
    const text = await clone.text();
    if (!text) return "";
    const obj = JSON.parse(text);
    // Extract key identifiers from the body
    const keys = Object.keys(obj);
    const ids = ["id", "task_id", "taskId", "session_id", "sessionId", "plan_id", "planId", "action", "status", "title", "event_type", "eventType", "category", "name"];
    const relevant = ids.filter(k => obj[k] != null).map(k => `${k}=${String(obj[k]).slice(0, 30)}`);
    if (relevant.length > 0) return relevant.join(" ").slice(0, 100);
    return `{${keys.slice(0, 5).join(",")}}`;
  } catch {
    return "";
  }
}

/** Wrap a Next.js route handler with trace logging */
export function withTrace(
  module: string,
  method: string,
  handler: (request: NextRequest, context?: any) => Promise<NextResponse>,
  opts: { tier?: number; category?: string } = {}
) {
  return async (request: NextRequest, context?: any): Promise<NextResponse> => {
    const start = Date.now();
    const url = request.nextUrl;
    const params = summarizeParams(url);
    const pathSegment = url.pathname.replace(/^\/api\//, "");

    // Extract body summary for mutating requests
    let bodySummary = "";
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      bodySummary = await summarizeBody(request);
    }

    const argsParts = [`${request.method} /${pathSegment}`];
    if (params) argsParts.push(params);
    if (bodySummary) argsParts.push(bodySummary);

    const event = {
      id: crypto.randomUUID(),
      timestamp: start,
      nodeId: NODE_ID,
      module,
      fn: method,
      tier: opts.tier || 2,
      category: opts.category || "api_call",
      argsSummary: argsParts.join(" | ").slice(0, 120),
      resultSummary: null as string | null,
      durationMs: 0,
      error: null as string | null,
      meta: null as string | null,
    };

    // Log request receipt
    console.log(`[${module}] ${event.argsSummary}`);

    try {
      const result = await handler(request, context);
      event.durationMs = Date.now() - start;
      event.resultSummary = `${result.status} ${event.durationMs}ms`;
      insertEvent(event);
      publishEvent(event);
      // Log slow or error responses
      if (event.durationMs > 500 || result.status >= 400) {
        console.log(`[${module}] ${result.status} ${event.durationMs}ms ${request.method} /${pathSegment}`);
      }
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
