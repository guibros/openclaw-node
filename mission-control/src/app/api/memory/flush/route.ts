import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memoryItems, memoryAudit } from "@/lib/db/schema";
import { storeExtractedFacts, getDocIdByPath, type GatedFact } from "@/lib/memory/extract";
import { logActivity } from "@/lib/activity";

/**
 * POST /api/memory/flush
 *
 * Session flush endpoint. Called by Daedalus at end of session
 * (or by cron fallback in Phase 2).
 *
 * Body: {
 *   facts: GatedFact[],         // extracted + gated facts from this session
 *   source: string,             // e.g. "memory/2026-02-21.md"
 *   sessionId?: string,         // optional session identifier
 *   companionState?: string,    // optional companion state update
 * }
 *
 * The actual extraction + gating is done by Daedalus inline.
 * This endpoint just stores the results and marks the flush.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { facts, source, sessionId } = body as {
      facts: GatedFact[];
      source: string;
      sessionId?: string;
    };

    if (!facts || !Array.isArray(facts)) {
      return NextResponse.json(
        { error: "facts array is required" },
        { status: 400 }
      );
    }

    // Resolve source doc ID if available
    const sourceDocId = source ? getDocIdByPath(source) ?? undefined : undefined;

    // Store facts
    const result = storeExtractedFacts(
      facts,
      sourceDocId,
      source || sessionId || "session_flush"
    );

    // Log the flush event
    const db = getDb();
    db.insert(memoryAudit)
      .values({
        operation: "session_flush",
        detail: JSON.stringify({
          source,
          sessionId,
          accepted: result.accepted,
          rejected: result.rejected,
          timestamp: new Date().toISOString(),
        }),
      })
      .run();

    logActivity(
      "memory_flush",
      `Session flush: ${result.accepted} facts stored, ${result.rejected} rejected from ${source || "session"}`,
    );

    return NextResponse.json({
      ok: true,
      ...result,
      total: facts.length,
      flushedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /api/memory/flush error:", err);
    return NextResponse.json(
      { error: "Failed to flush session memory" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/memory/flush
 * Returns last flush info (when, how many facts, etc.)
 */
export async function GET() {
  try {
    const db = getDb();
    const raw = db
      .select()
      .from(memoryAudit)
      .where(
        // @ts-expect-error — raw SQL for operation filter
        { operation: "session_flush" }
      )
      .limit(1);

    // Use raw SQL for this query since Drizzle doesn't handle the filter well
    const { getRawDb } = await import("@/lib/db");
    const rawDb = getRawDb();
    const lastFlush = rawDb
      .prepare(
        "SELECT * FROM memory_audit WHERE operation = 'session_flush' ORDER BY timestamp DESC LIMIT 1"
      )
      .get() as Record<string, unknown> | undefined;

    const totalItems = rawDb
      .prepare("SELECT COUNT(*) as count FROM memory_items WHERE status = 'active'")
      .get() as { count: number };

    return NextResponse.json({
      lastFlush: lastFlush
        ? {
            timestamp: lastFlush.timestamp,
            detail: lastFlush.detail ? JSON.parse(lastFlush.detail as string) : null,
          }
        : null,
      totalActiveItems: totalItems.count,
    });
  } catch (err) {
    console.error("GET /api/memory/flush error:", err);
    return NextResponse.json(
      { error: "Failed to get flush info" },
      { status: 500 }
    );
  }
}
