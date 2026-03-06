import { NextRequest, NextResponse } from "next/server";
import { tieredSearch, formatInjectionBlock, getMemoryInjection } from "@/lib/memory/retrieval";

/**
 * GET /api/memory/retrieve?q=query&limit=10&format=block
 *
 * Tiered memory retrieval:
 * - Tier 1: Category summaries
 * - Tier 2: Memory items (FTS5)
 * - Tier 3: Full docs (FTS5)
 *
 * Add &format=block to get the formatted injection block (for agent context).
 * Default returns raw results array.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);
    const format = searchParams.get("format");

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required (min 2 chars)" },
        { status: 400 }
      );
    }

    if (format === "block") {
      const { block, results } = getMemoryInjection(query, limit);
      return NextResponse.json({ block, resultCount: results.length });
    }

    const results = tieredSearch(query, limit);
    return NextResponse.json({
      results,
      total: results.length,
      tiers: {
        t1: results.filter((r) => r.tier === 1).length,
        t2: results.filter((r) => r.tier === 2).length,
        t3: results.filter((r) => r.tier === 3).length,
      },
    });
  } catch (err) {
    console.error("GET /api/memory/retrieve error:", err);
    return NextResponse.json(
      { error: "Failed to retrieve memories" },
      { status: 500 }
    );
  }
}
