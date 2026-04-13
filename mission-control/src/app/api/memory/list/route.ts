import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memoryDocs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/memory/list?source=daily_log
 * List all indexed memory documents (without full content).
 * Sorted by date desc, then modified_at desc.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const source = request.nextUrl.searchParams.get("source");

    const query = db
      .select({
        id: memoryDocs.id,
        source: memoryDocs.source,
        category: memoryDocs.category,
        filePath: memoryDocs.filePath,
        title: memoryDocs.title,
        date: memoryDocs.date,
        modifiedAt: memoryDocs.modifiedAt,
      })
      .from(memoryDocs);

    let rows;
    if (source) {
      rows = query
        .where(eq(memoryDocs.source, source))
        .orderBy(desc(memoryDocs.date), desc(memoryDocs.modifiedAt))
        .all();
    } else {
      rows = query
        .orderBy(desc(memoryDocs.date), desc(memoryDocs.modifiedAt))
        .all();
    }

    return NextResponse.json({ docs: rows, total: rows.length });
  } catch (err) {
    console.error("GET /api/memory/list error:", err);
    return NextResponse.json(
      { error: "Failed to list memory docs" },
      { status: 500 }
    );
  }
}
