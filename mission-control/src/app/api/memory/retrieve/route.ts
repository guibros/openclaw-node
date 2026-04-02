import { NextRequest, NextResponse } from "next/server";
import { tieredSearch, formatInjectionBlock, getMemoryInjection } from "@/lib/memory/retrieval";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/memory/retrieve?q=query&limit=10&format=block
 */
export const GET = withTrace("memory", "GET /api/memory/retrieve", async (request: NextRequest) => {
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
});
