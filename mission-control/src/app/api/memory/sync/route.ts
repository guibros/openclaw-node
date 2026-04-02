import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { indexAllMemory } from "@/lib/sync/memory";
import { withTrace } from "@/lib/tracer";

/**
 * POST /api/memory/sync
 * Force re-index all memory sources from disk into SQLite + FTS5.
 * Returns { indexed, updated, removed }.
 */
export const POST = withTrace("memory", "POST /api/memory/sync", async () => {
  try {
    const db = getDb();
    const stats = indexAllMemory(db);

    return NextResponse.json(stats);
  } catch (err) {
    console.error("POST /api/memory/sync error:", err);
    return NextResponse.json(
      { error: "Failed to sync memory" },
      { status: 500 }
    );
  }
});
