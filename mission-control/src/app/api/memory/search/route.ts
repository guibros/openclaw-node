import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";

/**
 * Score decay: time-weighted relevance scoring.
 * Recent facts beat old facts at equal relevance.
 * Formula: finalScore = relevance × exp(-decayRate × daysOld)
 */
function applyScoreDecay(
  rows: Array<Record<string, unknown>>,
  decayRate = 0.01
): Array<Record<string, unknown>> {
  const now = Date.now();
  return rows.map((row) => {
    const dateStr = (row.date as string) || (row.modifiedAt as string);
    const daysOld = dateStr
      ? (now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
      : 30; // default 30 days if no date
    const rawRank = row.rank as number; // FTS5 rank is negative (lower = better)
    const relevance = -rawRank; // flip so higher = better
    const decayedScore = relevance * Math.exp(-decayRate * daysOld);
    return { ...row, decayedScore, daysOld: Math.round(daysOld) };
  });
}

/**
 * Expand search query with synonyms and related terms.
 * Lightweight keyword expansion — no LLM call needed for dashboard use.
 * Daedalus does deeper semantic rewriting inline during his own searches.
 */
function expandQuery(query: string): string {
  // Split into terms and add OR variants for common patterns
  const terms = query.trim().split(/\s+/);
  if (terms.length === 1) {
    // Single term: use prefix matching
    return `"${query.replace(/"/g, '""')}"*`;
  }
  // Multi-term: quote as phrase + add individual terms with OR for broader recall
  const phrase = `"${query.replace(/"/g, '""')}"`;
  const individual = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
  return `(${phrase}) OR (${individual})`;
}

/**
 * GET /api/memory/search?q=term&source=daily_log&category=preferences&limit=20&offset=0&decay=true
 * Full-text search across indexed memory using FTS5.
 * Supports score decay (time-weighted relevance) via &decay=true (default: true).
 * Uses raw SQLite for FTS5 MATCH + snippet() since Drizzle doesn't support FTS5.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("q");
    const source = searchParams.get("source");
    const category = searchParams.get("category");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const useDecay = searchParams.get("decay") !== "false"; // default: true
    const decayRate = parseFloat(searchParams.get("decay_rate") || "0.01");

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    const raw = getRawDb();

    // Build WHERE conditions for the joined memory_docs table
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // FTS5 MATCH condition with query expansion
    conditions.push("memory_fts MATCH ?");
    params.push(expandQuery(query));

    if (source) {
      conditions.push("md.source = ?");
      params.push(source);
    }
    if (category) {
      conditions.push("md.category = ?");
      params.push(category);
    }

    const whereClause = conditions.join(" AND ");

    // Count total matches
    const countSql = `
      SELECT COUNT(*) as total
      FROM memory_fts
      JOIN memory_docs md ON md.id = memory_fts.rowid
      WHERE ${whereClause}
    `;
    const countResult = raw.prepare(countSql).get(...params) as {
      total: number;
    };

    // Fetch results — grab more than needed if decay is on (re-ranking may shuffle order)
    const fetchLimit = useDecay ? Math.min(limit * 3, 100) : limit;
    const selectSql = `
      SELECT
        md.id,
        md.source,
        md.category,
        md.file_path AS filePath,
        md.title,
        md.date,
        md.modified_at AS modifiedAt,
        snippet(memory_fts, 1, '<mark>', '</mark>', '...', 48) AS excerpt,
        rank
      FROM memory_fts
      JOIN memory_docs md ON md.id = memory_fts.rowid
      WHERE ${whereClause}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    params.push(fetchLimit, offset);
    let rows = raw.prepare(selectSql).all(...params) as Array<Record<string, unknown>>;

    // Apply score decay if enabled — re-rank by time-weighted relevance
    if (useDecay && rows.length > 0) {
      rows = applyScoreDecay(rows, decayRate);
      rows.sort(
        (a, b) => (b.decayedScore as number) - (a.decayedScore as number)
      );
      rows = rows.slice(0, limit);
    }

    return NextResponse.json({
      results: rows,
      total: countResult.total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/memory/search error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to search memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
