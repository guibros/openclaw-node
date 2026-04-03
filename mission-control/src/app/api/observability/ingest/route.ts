import { NextRequest, NextResponse } from "next/server";
import { batchInsertEvents } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * POST /api/observability/ingest
 *
 * HTTP fallback for daemon trace event ingestion when NATS is unavailable.
 * Accepts a JSON array of trace events and inserts them into SQLite.
 *
 * Used by lib/tracer.js HTTP transport when NATS publish fails.
 * Intentionally unauthenticated — local-only service.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      return NextResponse.json({ ok: true, ingested: 0 });
    }

    // Normalize snake_case (daemon tracer.js) to camelCase (MC schema)
    const normalized = events.map((e: any) => ({
      id: e.id || crypto.randomUUID(),
      timestamp: e.timestamp || Date.now(),
      nodeId: e.node_id || e.nodeId || "unknown",
      module: e.module || "unknown",
      fn: e.function || e.fn || "unknown",
      tier: e.tier || 2,
      category: e.category || "lifecycle",
      argsSummary: (e.args_summary || e.argsSummary || "").slice(0, 120),
      resultSummary: (e.result_summary || e.resultSummary || "").slice(0, 80),
      durationMs: e.duration_ms || e.durationMs || 0,
      error: e.error || null,
      meta: e.meta ? (typeof e.meta === "string" ? e.meta : JSON.stringify(e.meta)) : null,
    }));

    batchInsertEvents(normalized);

    return NextResponse.json({ ok: true, ingested: normalized.length });
  } catch (err) {
    console.error(`[observability/ingest] error: ${(err as Error).message}`);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
