import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";
import { withTrace } from "@/lib/tracer";
import { startTraceIngestion } from "@/lib/trace-ingest";

export const dynamic = "force-dynamic";

/**
 * GET /api/observability/events
 *
 * Query observability_events table with filters:
 * - since: timestamp (ms) — events after this time
 * - module: filter by module name
 * - node: filter by node_id
 * - category: filter by category
 * - tier: filter by tier (1, 2, 3)
 * - error: if "true", only events with errors
 * - limit: default 200, max 1000
 *
 * Returns JSON array ordered by timestamp DESC.
 */
export const GET = withTrace("observability", "GET /api/observability/events", async (request: NextRequest) => {
  // Start NATS→DB ingestion for daemon trace events (singleton, no-op if already started)
  startTraceIngestion();

  try {
    const url = request.nextUrl;
    // Support both ?since=<ms timestamp> and ?hours=<N> for convenience
    let since = url.searchParams.get("since");
    const hours = url.searchParams.get("hours");
    if (!since && hours) {
      const h = parseFloat(hours);
      if (!isNaN(h)) since = String(Date.now() - h * 3600000);
    }
    const module = url.searchParams.get("module");
    const node = url.searchParams.get("node");
    const category = url.searchParams.get("category");
    const tier = url.searchParams.get("tier");
    const errorOnly = url.searchParams.get("error") === "true";
    const limitParam = parseInt(url.searchParams.get("limit") || "200", 10);
    const limit = Math.min(Math.max(1, limitParam), 1000);

    const db = getRawDb();

    const conditions: string[] = [];
    const params: any[] = [];

    if (since) {
      const sinceTs = parseInt(since, 10);
      if (!isNaN(sinceTs)) {
        conditions.push("timestamp > ?");
        params.push(sinceTs);
      }
    }

    if (module) {
      conditions.push("module = ?");
      params.push(module);
    }

    if (node) {
      conditions.push("node_id = ?");
      params.push(node);
    }

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (tier) {
      const tierNum = parseInt(tier, 10);
      if (!isNaN(tierNum)) {
        conditions.push("tier = ?");
        params.push(tierNum);
      }
    }

    if (errorOnly) {
      conditions.push("error IS NOT NULL");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM observability_events ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    return NextResponse.json({ events: rows });
  } catch (err) {
    console.error("[observability/events] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
});
