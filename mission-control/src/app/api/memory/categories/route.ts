import { NextRequest, NextResponse } from "next/server";
import {
  getCategoryOverview,
  readCategorySummary,
  writeCategorySummary,
  getCategoryItemsFormatted,
  VALID_CATEGORIES,
} from "@/lib/memory/categories";

/**
 * GET /api/memory/categories
 * Returns overview of all categories (item counts, summary status).
 * Add ?category=work to get the full summary for a specific category.
 * Add ?category=work&items=true to get the raw items list for regeneration.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get("category");

    if (category) {
      if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
        return NextResponse.json(
          { error: `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}` },
          { status: 400 }
        );
      }

      // Return items for regeneration
      if (searchParams.get("items") === "true") {
        const formatted = getCategoryItemsFormatted(category);
        return NextResponse.json({ category, items: formatted });
      }

      // Return existing summary
      const summary = readCategorySummary(category);
      return NextResponse.json({
        category,
        summary: summary ?? null,
        exists: summary !== null,
      });
    }

    // Overview of all categories
    const overview = getCategoryOverview();
    return NextResponse.json({ categories: overview });
  } catch (err) {
    console.error("GET /api/memory/categories error:", err);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/memory/categories
 * Write a category summary. Called by Daedalus after generating the summary inline.
 * Body: { category: string, content: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, content } = body as {
      category: string;
      content: string;
    };

    if (!category || !content) {
      return NextResponse.json(
        { error: "category and content are required" },
        { status: 400 }
      );
    }

    if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return NextResponse.json(
        { error: `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    writeCategorySummary(category, content);

    return NextResponse.json({ ok: true, category });
  } catch (err) {
    console.error("POST /api/memory/categories error:", err);
    return NextResponse.json(
      { error: "Failed to write category summary" },
      { status: 500 }
    );
  }
}
