/**
 * Memory Consolidation API
 *
 * POST /api/memory/consolidate — merge near-duplicate active facts
 *
 * Uses token-level Jaccard similarity (no LLM calls).
 * Keeps the higher-confidence fact, archives the duplicate.
 * Called by memory-maintenance.mjs every 30min.
 */

import { NextResponse } from "next/server";
import { getRawDb, getDb } from "@/lib/db";
import { memoryItems, memoryAudit } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withTrace } from "@/lib/tracer";

function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const POST = withTrace("memory", "POST /api/memory/consolidate", async () => {
  const raw = getRawDb();
  const db = getDb();

  // Get all active, non-superseded facts grouped by category
  const activeFacts = raw.prepare(
    `SELECT id, fact_text, confidence, category, created_at
     FROM memory_items
     WHERE status = 'active' AND valid_to IS NULL
     ORDER BY category, created_at DESC`
  ).all() as Array<{
    id: number;
    fact_text: string;
    confidence: number;
    category: string;
    created_at: string;
  }>;

  let merged = 0;
  const mergedPairs: Array<{ kept: number; archived: number; similarity: number }> = [];

  // Compare within each category (O(n²) but categories are small)
  const byCategory = new Map<string, typeof activeFacts>();
  for (const fact of activeFacts) {
    const cat = fact.category || "general";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(fact);
  }

  const archivedIds = new Set<number>();

  for (const [, facts] of byCategory) {
    for (let i = 0; i < facts.length; i++) {
      if (archivedIds.has(facts[i].id)) continue;

      for (let j = i + 1; j < facts.length; j++) {
        if (archivedIds.has(facts[j].id)) continue;

        const similarity = tokenJaccard(facts[i].fact_text, facts[j].fact_text);
        if (similarity >= 0.8) {
          // Keep higher confidence (or newer if equal)
          const [keep, archive] =
            facts[i].confidence >= facts[j].confidence
              ? [facts[i], facts[j]]
              : [facts[j], facts[i]];

          // Archive the duplicate
          raw.prepare(
            "UPDATE memory_items SET status = 'archived', superseded_by = ? WHERE id = ?"
          ).run(keep.id, archive.id);

          archivedIds.add(archive.id);

          // Audit
          db.insert(memoryAudit)
            .values({
              operation: "consolidate",
              itemId: archive.id,
              detail: JSON.stringify({
                keptId: keep.id,
                similarity: similarity.toFixed(2),
                keptText: keep.fact_text.slice(0, 80),
                archivedText: archive.fact_text.slice(0, 80),
              }),
            })
            .run();

          mergedPairs.push({ kept: keep.id, archived: archive.id, similarity });
          merged++;
        }
      }
    }
  }

  return NextResponse.json({
    merged,
    totalActive: activeFacts.length - merged,
    pairs: mergedPairs.slice(0, 20), // cap for response size
  });
});
