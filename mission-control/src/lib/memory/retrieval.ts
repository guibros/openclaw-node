/**
 * Tiered Memory Retrieval (MEM-008) + Injection Block (MEM-009)
 *
 * Tier 1: Search category summary files (fast, high-level)
 * Tier 2: Search memory items via FTS5 (detailed, fact-level)
 * Tier 3: Search full memory docs (original daily logs, MEMORY.md)
 *
 * Injection: Format top-N results as a structured block for prompt injection.
 */

import { getRawDb } from "../db";
import { readCategorySummary, VALID_CATEGORIES } from "./categories";
import { expandQueryWithGraph } from "./entities";
import { traceCall } from "../tracer";

export interface RetrievalResult {
  factText: string;
  confidence: number;
  category: string | null;
  source: string; // "category_summary" | "item" | "doc"
  tier: number;
  age: number; // days old
  decayedScore: number;
}

/**
 * Score decay formula: relevance × exp(-decayRate × daysOld)
 */
function decay(relevance: number, daysOld: number, rate = 0.01): number {
  return relevance * Math.exp(-rate * daysOld);
}

/**
 * Build FTS5 MATCH expression: exact phrase OR individual terms.
 * Single word → "word"*
 * Multi-word  → ("word1 word2") OR ("word1"* OR "word2"*)
 */
function buildFtsQuery(query: string): string {
  const safe = query.replace(/"/g, '""').replace(/[*(){}^]/g, '').trim();
  if (!safe) return '""';
  const terms = safe.split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length <= 1) return `"${safe}"*`;
  const phrase = `"${safe}"`;
  const individual = terms.map((t) => `"${t}"*`).join(" OR ");
  return `(${phrase}) OR (${individual})`;
}

/**
 * Tier 1: Search category summaries for relevant content.
 * Returns matches if a category summary contains the query terms.
 */
function searchCategorySummaries(query: string): RetrievalResult[] {
  const results: RetrievalResult[] = [];
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter((t) => t.length >= 2);

  for (const cat of VALID_CATEGORIES) {
    const summary = readCategorySummary(cat);
    if (!summary) continue;

    // Score: how many query terms appear in the summary
    const summaryLower = summary.toLowerCase();
    const matchCount = terms.filter((t) => summaryLower.includes(t)).length;
    if (matchCount === 0) continue;

    const relevance = matchCount / terms.length; // 0-1
    if (relevance < 0.5) continue; // need at least half the terms

    // Extract the most relevant paragraph
    const paragraphs = summary.split(/\n\n+/).filter((p) => p.trim());
    let bestParagraph = "";
    let bestScore = 0;
    for (const p of paragraphs) {
      const pLower = p.toLowerCase();
      const pMatch = terms.filter((t) => pLower.includes(t)).length;
      if (pMatch > bestScore) {
        bestScore = pMatch;
        bestParagraph = p.trim();
      }
    }

    results.push({
      factText: bestParagraph || summary.slice(0, 200),
      confidence: Math.round(relevance * 100),
      category: cat,
      source: "category_summary",
      tier: 1,
      age: 0, // summaries are always "current"
      decayedScore: relevance, // no decay on summaries
    });
  }

  return results.sort((a, b) => b.decayedScore - a.decayedScore);
}

/**
 * Tier 2: Search memory items via FTS5.
 */
function searchItems(query: string, limit = 20): RetrievalResult[] {
  const raw = getRawDb();
  const ftsQuery = buildFtsQuery(query);
  const now = Date.now();

  const rows = raw
    .prepare(
      `SELECT mi.fact_text, mi.confidence, mi.category, mi.created_at, rank
      FROM memory_items_fts
      JOIN memory_items mi ON mi.id = memory_items_fts.rowid
      WHERE memory_items_fts MATCH ? AND mi.status = 'active' AND mi.valid_to IS NULL
      ORDER BY rank
      LIMIT ?`
    )
    .all(ftsQuery, limit) as Array<{
    fact_text: string;
    confidence: number;
    category: string | null;
    created_at: string;
    rank: number;
  }>;

  return rows.map((row) => {
    const daysOld = Math.round(
      (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const relevance = -row.rank; // FTS5 rank is negative
    return {
      factText: row.fact_text,
      confidence: row.confidence ?? 70,
      category: row.category,
      source: "item",
      tier: 2,
      age: daysOld,
      decayedScore: decay(relevance, daysOld),
    };
  });
}

/**
 * Tier 3: Search full memory docs via FTS5.
 */
function searchDocs(query: string, limit = 10): RetrievalResult[] {
  const raw = getRawDb();
  const ftsQuery = buildFtsQuery(query);
  const now = Date.now();

  const rows = raw
    .prepare(
      `SELECT
        snippet(memory_fts, 1, '', '', '...', 64) AS excerpt,
        md.date, md.modified_at, md.source, md.category, rank
      FROM memory_fts
      JOIN memory_docs md ON md.id = memory_fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?`
    )
    .all(ftsQuery, limit) as Array<{
    excerpt: string;
    date: string | null;
    modified_at: string | null;
    source: string;
    category: string | null;
    rank: number;
  }>;

  return rows.map((row) => {
    const dateStr = row.date || row.modified_at;
    const daysOld = dateStr
      ? Math.round(
          (now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
        )
      : 30;
    const relevance = -row.rank;
    return {
      factText: row.excerpt,
      confidence: 60, // docs are raw, lower confidence than extracted items
      category: row.category,
      source: `doc:${row.source}`,
      tier: 3,
      age: daysOld,
      decayedScore: decay(relevance, daysOld),
    };
  });
}

/**
 * Tiered retrieval: search all tiers, merge, deduplicate, rank by decayed score.
 * Graph expansion (P0): expands query with 1-hop related entity names before searching.
 */
export function tieredSearch(
  query: string,
  limit = 10
): RetrievalResult[] {
  const _start = Date.now();
  // Graph expansion: find related entities and add to search
  let graphExpansions: string[] = [];
  try {
    graphExpansions = expandQueryWithGraph(query);
  } catch { /* graph expansion is non-blocking */ }

  // Build expanded queries: original + each expansion (max 3)
  const queries = [query, ...graphExpansions.slice(0, 3)];

  // Tier 1: category summaries (original query only — summaries are broad)
  const tier1 = searchCategorySummaries(query);

  // If Tier 1 has a high-confidence result, return early
  if (tier1.length > 0 && tier1[0].confidence >= 70) {
    // Still supplement with Tier 2 for completeness (expanded)
    const tier2Results: RetrievalResult[] = [];
    for (const q of queries) {
      tier2Results.push(...searchItems(q, Math.ceil(limit / queries.length)));
    }
    const merged = [...tier1, ...tier2Results];
    const earlyResult = dedup(merged).slice(0, limit);
    traceCall("memory/retrieval", "tieredSearch", _start, `${earlyResult.length} results (early)`);
    return earlyResult;
  }

  // Tier 2: memory items (expanded queries)
  const tier2Results: RetrievalResult[] = [];
  for (const q of queries) {
    tier2Results.push(...searchItems(q, limit));
  }

  // Tier 3: full docs (original query only — docs are expensive)
  const tier3 = searchDocs(query, Math.ceil(limit / 2));

  // Merge all tiers, sort by decayed score
  const merged = [...tier1, ...tier2Results, ...tier3];
  const result = dedup(merged).slice(0, limit);
  traceCall("memory/retrieval", "tieredSearch", _start, `${result.length} results`);
  return result;
}

/**
 * Simple dedup: remove results with very similar fact text.
 */
function dedup(results: RetrievalResult[]): RetrievalResult[] {
  const seen = new Set<string>();
  const deduped: RetrievalResult[] = [];

  for (const r of results.sort((a, b) => b.decayedScore - a.decayedScore)) {
    // Normalize for comparison: lowercase, trim, collapse whitespace
    const key = r.factText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped;
}

/**
 * MEM-009: Format retrieval results as a structured injection block.
 * This block gets injected into the agent's context at session start or per-turn.
 *
 * Format:
 * — [fact_text] [confidence: 0.X, age: Nd, category: work, tier: 1]
 */
export function formatInjectionBlock(
  results: RetrievalResult[],
  maxItems = 10
): string {
  if (results.length === 0) return "";

  const lines = results.slice(0, maxItems).map((r) => {
    const conf = (r.confidence / 100).toFixed(1);
    const cat = r.category || "general";
    const src = r.source === "category_summary" ? "summary" : r.source;
    return `— ${r.factText} [confidence: ${conf}, age: ${r.age}d, category: ${cat}, source: ${src}]`;
  });

  return `## Relevant Memory (${lines.length} items, auto-injected)\n${lines.join("\n")}`;
}

/**
 * Full retrieval pipeline: query → tiered search → format injection block.
 * This is what Daedalus calls during session bootstrap or per-turn retrieval.
 */
export function getMemoryInjection(
  query: string,
  maxItems = 10
): { block: string; results: RetrievalResult[] } {
  const _start = Date.now();
  const results = tieredSearch(query, maxItems);
  const block = formatInjectionBlock(results, maxItems);
  traceCall("memory/retrieval", "getMemoryInjection", _start, `${results.length} results`);
  return { block, results };
}
