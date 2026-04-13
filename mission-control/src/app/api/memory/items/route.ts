import { NextRequest, NextResponse } from "next/server";
import {
  storeExtractedFacts,
  getItemsWithSource,
  searchItems,
  getExtractionStats,
  type GatedFact,
} from "@/lib/memory/extract";

/**
 * GET /api/memory/items?category=work&limit=50&offset=0&q=search
 * List active memory items, optionally filtered by category or search query.
 * Add ?stats=true for extraction statistics.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // Stats mode
    if (searchParams.get("stats") === "true") {
      const stats = getExtractionStats();
      return NextResponse.json(stats);
    }

    const category = searchParams.get("category") || undefined;
    const query = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Search mode
    if (query && query.trim().length >= 2) {
      const results = searchItems(query, category, limit);
      return NextResponse.json({ items: results, total: results.length });
    }

    // List mode
    const items = getItemsWithSource(limit, offset);
    return NextResponse.json({ items, limit, offset });
  } catch (err) {
    console.error("GET /api/memory/items error:", err);
    return NextResponse.json(
      { error: "Failed to fetch memory items" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/memory/items
 * Store extracted + gated facts.
 * Body: { facts: GatedFact[], sourceDocId?: number, extractionSource?: string }
 *
 * Called by Daedalus after inline extraction + gating,
 * or by a sub-agent doing batch extraction.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { facts, sourceDocId, extractionSource } = body as {
      facts: GatedFact[];
      sourceDocId?: number;
      extractionSource?: string;
    };

    if (!facts || !Array.isArray(facts) || facts.length === 0) {
      return NextResponse.json(
        { error: "facts array is required and must not be empty" },
        { status: 400 }
      );
    }

    const result = storeExtractedFacts(facts, sourceDocId, extractionSource);

    return NextResponse.json({
      ok: true,
      ...result,
      total: facts.length,
    });
  } catch (err) {
    console.error("POST /api/memory/items error:", err);
    return NextResponse.json(
      { error: "Failed to store memory items" },
      { status: 500 }
    );
  }
}
