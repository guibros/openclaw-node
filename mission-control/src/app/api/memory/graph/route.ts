/**
 * Knowledge Graph API
 *
 * GET  /api/memory/graph             — graph stats + top entities with relations
 * GET  /api/memory/graph?boot=true   — boot injection block (Option B: top 10 entities)
 * GET  /api/memory/graph?format=viz  — full graph as flat nodes + edges for visualization
 * POST /api/memory/graph             — seed known entities
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getTopEntities,
  getEntityRelations,
  getGraphStats,
  formatEntityContextBlock,
  seedKnownEntities,
} from "@/lib/memory/entities";
import { getRawDb } from "@/lib/db";
import { withTrace } from "@/lib/tracer";

export const GET = withTrace("memory", "GET /api/memory/graph", async (request: NextRequest) => {
  try {
    const url = new URL(request.url);
    const boot = url.searchParams.get("boot");
    const format = url.searchParams.get("format");

    if (boot === "true") {
      const block = formatEntityContextBlock();
      return NextResponse.json({ block });
    }

    if (format === "viz") {
      return getVizData();
    }

    const stats = getGraphStats();
    const topEntities = getTopEntities(10).map((entity) => {
      const relations = getEntityRelations(entity.id, 3);
      return { ...entity, relations };
    });

    return NextResponse.json({ stats, topEntities });
  } catch (err) {
    console.error("[memory/graph] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: err instanceof SyntaxError ? 400 : 500 }
    );
  }
});

export const POST = withTrace("memory", "POST /api/memory/graph", async () => {
  try {
    const seeded = seedKnownEntities();
    return NextResponse.json({ seeded, message: `${seeded} entities seeded` });
  } catch (err) {
    console.error("[memory/graph] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: err instanceof SyntaxError ? 400 : 500 }
    );
  }
});

/**
 * Returns flat nodes + edges for force-directed graph visualization.
 */
function getVizData() {
  const raw = getRawDb();

  const entities = raw.prepare(`
    SELECT id, name, type, access_count, last_seen
    FROM memory_entities
    ORDER BY access_count DESC
    LIMIT 50
  `).all() as Array<{
    id: number;
    name: string;
    type: string;
    access_count: number;
    last_seen: string;
  }>;

  const entityIds = new Set(entities.map(e => e.id));

  const relations = raw.prepare(`
    SELECT
      mr.id, mr.source_entity_id, mr.target_entity_id,
      mr.relation_type, mr.confidence
    FROM memory_relations mr
    WHERE mr.valid_to IS NULL
  `).all() as Array<{
    id: number;
    source_entity_id: number;
    target_entity_id: number;
    relation_type: string;
    confidence: number;
  }>;

  // Only include edges where both nodes are in our set
  const edges = relations
    .filter(r => entityIds.has(r.source_entity_id) && entityIds.has(r.target_entity_id))
    .map(r => ({
      id: r.id,
      source: r.source_entity_id,
      target: r.target_entity_id,
      relationType: r.relation_type,
      confidence: r.confidence,
    }));

  const nodes = entities.map(e => ({
    id: e.id,
    name: e.name,
    type: e.type,
    accessCount: e.access_count,
    lastSeen: e.last_seen,
  }));

  const stats = getGraphStats();

  return NextResponse.json({ nodes, edges, stats });
}
