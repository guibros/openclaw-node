import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memoryDocs } from "@/lib/db/schema";
import { withTrace } from "@/lib/tracer";
import {
  extractAllReferences,
  buildResolutionMaps,
} from "@/lib/memory/wikilinks";

/**
 * GET /api/memory/wikilinks
 * Compute the document-level cross-reference graph from all indexed memory_docs.
 * Auto-detects: [[wikilinks]], task IDs (ARCANE-M01, T-xxx), file path mentions.
 */
export const GET = withTrace("memory", "GET /api/memory/wikilinks", async () => {
  try {
    const db = getDb();

    const docs = db
      .select({
        id: memoryDocs.id,
        filePath: memoryDocs.filePath,
        title: memoryDocs.title,
        source: memoryDocs.source,
        category: memoryDocs.category,
        content: memoryDocs.content,
      })
      .from(memoryDocs)
      .all();

    const maps = buildResolutionMaps(docs);

    const linkCounts = new Map<string, number>();
    const links: Array<{ source: string; target: string }> = [];
    const seenEdges = new Set<string>();

    for (const doc of docs) {
      const refs = extractAllReferences(doc.content, maps, doc.filePath);
      for (const target of refs) {
        const edgeKey = `${doc.filePath}::${target}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          links.push({ source: doc.filePath, target });
          linkCounts.set(
            doc.filePath,
            (linkCounts.get(doc.filePath) || 0) + 1
          );
          linkCounts.set(target, (linkCounts.get(target) || 0) + 1);
        }
      }
    }

    const nodes = docs.map((d) => ({
      id: d.filePath,
      title:
        d.title ||
        d.filePath.split("/").pop()?.replace(/\.md$/, "") ||
        d.filePath,
      source: d.source,
      category: d.category,
      linkCount: linkCounts.get(d.filePath) || 0,
    }));

    return NextResponse.json({
      nodes,
      links,
      stats: { nodeCount: nodes.length, linkCount: links.length },
    });
  } catch (err) {
    console.error("GET /api/memory/wikilinks error:", err);
    return NextResponse.json(
      { error: "Failed to compute wikilink graph" },
      { status: 500 }
    );
  }
});
