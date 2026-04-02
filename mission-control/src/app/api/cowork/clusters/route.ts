import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clusters, clusterMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getHealthKv, sc } from "@/lib/nats";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * GET /api/cowork/clusters
 *
 * List all active clusters with members. Enriches members with live node status.
 */
export const GET = withTrace("cowork", "GET /api/cowork/clusters", async () => {
  const db = getDb();
  const kv = await getHealthKv();

  const allClusters = db
    .select()
    .from(clusters)
    .where(eq(clusters.status, "active"))
    .all();

  const allMembers = db.select().from(clusterMembers).all();

  // Build node status cache from NATS KV
  const nodeStatus = new Map<string, string>();
  if (kv) {
    const now = Date.now();
    const nodeIds = [...new Set(allMembers.map((m) => m.nodeId))];
    for (const nodeId of nodeIds) {
      try {
        const entry = await kv.get(nodeId);
        if (entry && entry.value) {
          const health = JSON.parse(sc.decode(entry.value));
          const reportedAt = health.reportedAt
            ? new Date(health.reportedAt).getTime()
            : now;
          const stale = (now - reportedAt) / 1000;
          nodeStatus.set(
            nodeId,
            stale < 45 ? "online" : stale < 120 ? "degraded" : "offline"
          );
        } else {
          nodeStatus.set(nodeId, "offline");
        }
      } catch {
        nodeStatus.set(nodeId, "offline");
      }
    }
  }

  const result = allClusters.map((c) => ({
    ...c,
    members: allMembers
      .filter((m) => m.clusterId === c.id)
      .map((m) => ({
        id: m.id,
        nodeId: m.nodeId,
        role: m.role,
        nodeStatus: nodeStatus.get(m.nodeId) ?? "unknown",
        createdAt: m.createdAt,
      })),
  }));

  return NextResponse.json({ clusters: result });
});

/**
 * POST /api/cowork/clusters
 *
 * Create a new cluster with members.
 */
export const POST = withTrace("cowork", "POST /api/cowork/clusters", async (request: NextRequest) => {
  const body = await request.json();
  const {
    name,
    description,
    color,
    defaultMode,
    defaultConvergence,
    convergenceThreshold,
    maxRounds,
    members,
  } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Auto-slug from name
  const id =
    body.id ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const db = getDb();

  // Check duplicate
  const existing = db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (existing) {
    return NextResponse.json(
      { error: `Cluster "${id}" already exists` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  db.insert(clusters)
    .values({
      id,
      name,
      description: description || null,
      color: color || null,
      defaultMode: defaultMode || "parallel",
      defaultConvergence: defaultConvergence || "unanimous",
      convergenceThreshold: convergenceThreshold ?? 66,
      maxRounds: maxRounds ?? 5,
      status: "active",
      updatedAt: now,
    })
    .run();

  // Insert members
  if (Array.isArray(members)) {
    for (const m of members) {
      db.insert(clusterMembers)
        .values({
          clusterId: id,
          nodeId: m.nodeId,
          role: m.role || "worker",
        })
        .run();
    }
  }

  return NextResponse.json({ id, name });
});
