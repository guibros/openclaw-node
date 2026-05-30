import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

const WATCHER_JSONL = path.join(path.dirname(WORKSPACE_ROOT), "watcher.jsonl");

function parseJsonlTail(filePath: string, maxLines: number): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const tail = lines.slice(-maxLines);
  const records: unknown[] = [];
  for (const line of tail) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

interface WatcherRecord {
  ts: string;
  op: string;
  status?: string;
  actor?: string | null;
  session?: string | null;
  duration_ms?: number | null;
  stores?: {
    knowledge?: { last_indexed?: number | string } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function normalizeHealth(record: WatcherRecord): WatcherRecord {
  if (record.stores?.knowledge && typeof record.stores.knowledge.last_indexed === "number") {
    record = structuredClone(record);
    (record.stores!.knowledge as Record<string, unknown>).last_indexed_iso =
      new Date(record.stores!.knowledge!.last_indexed as number).toISOString();
  }
  return record;
}

/**
 * GET /api/watcher
 *
 * Serves memory-watcher records from ~/.openclaw/watcher.jsonl.
 *
 * Query params:
 *   limit  — max event records (default 50, max 500)
 *   status — filter events by ok|noop|error
 *   op     — filter by operation type (e.g. memory.ingested, or watcher.alert)
 *
 * Response: { events: [...], alerts: [...], health: {...} | null, source: string }
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(parseInt(params.get("limit") || "50", 10) || 50, 1), 500);
    const statusFilter = params.get("status");
    const opFilter = params.get("op");

    const records = parseJsonlTail(WATCHER_JSONL, limit + 100) as WatcherRecord[];

    let latestHealth: WatcherRecord | null = null;
    const events: WatcherRecord[] = [];
    const alerts: WatcherRecord[] = [];

    for (const r of records) {
      if (r.op === "health.probe") {
        if (!latestHealth || r.ts > latestHealth.ts) latestHealth = r;
      } else if (r.op === "watcher.alert") {
        alerts.push(r);
        // Alerts have their own field, but also honor an explicit ?op=watcher.alert
        // so the op filter never silently returns an empty set.
        if (opFilter === "watcher.alert" && (!statusFilter || r.status === statusFilter)) {
          events.push(r);
        }
      } else {
        if (statusFilter && r.status !== statusFilter) continue;
        if (opFilter && r.op !== opFilter) continue;
        events.push(r);
      }
    }

    events.reverse();
    alerts.reverse();
    const trimmed = events.slice(0, limit);

    return NextResponse.json({
      events: trimmed,
      alerts: alerts.slice(0, limit),
      health: latestHealth ? normalizeHealth(latestHealth) : null,
      source: WATCHER_JSONL,
    });
  } catch (err) {
    console.error("[watcher] error:", err);
    return NextResponse.json(
      { error: "Failed to read watcher data", detail: String(err) },
      { status: 500 }
    );
  }
}
