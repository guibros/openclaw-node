import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clusterMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * POST /api/cowork/clusters/[id]/members
 *
 * Add a member to a cluster. 409 if already exists.
 */
export const POST = withTrace("cowork", "POST /api/cowork/clusters/[id]/members", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: clusterId } = await params;
  const { nodeId, role } = await request.json();

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId required" }, { status: 400 });
  }

  const db = getDb();

  // Check unique constraint
  const existing = db
    .select()
    .from(clusterMembers)
    .where(
      and(
        eq(clusterMembers.clusterId, clusterId),
        eq(clusterMembers.nodeId, nodeId)
      )
    )
    .get();

  if (existing) {
    return NextResponse.json(
      { error: "Node already in cluster" },
      { status: 409 }
    );
  }

  db.insert(clusterMembers)
    .values({ clusterId, nodeId, role: role || "worker" })
    .run();

  return NextResponse.json({ ok: true });
});

/**
 * PATCH /api/cowork/clusters/[id]/members
 *
 * Update role for a member. Body: { nodeId, role }
 */
export const PATCH = withTrace("cowork", "PATCH /api/cowork/clusters/[id]/members", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: clusterId } = await params;
  const { nodeId, role } = await request.json();

  if (!nodeId || !role) {
    return NextResponse.json(
      { error: "nodeId and role required" },
      { status: 400 }
    );
  }

  const db = getDb();

  db.update(clusterMembers)
    .set({ role })
    .where(
      and(
        eq(clusterMembers.clusterId, clusterId),
        eq(clusterMembers.nodeId, nodeId)
      )
    )
    .run();

  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/cowork/clusters/[id]/members?nodeId=X
 *
 * Remove a member from a cluster.
 */
export const DELETE = withTrace("cowork", "DELETE /api/cowork/clusters/[id]/members", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: clusterId } = await params;
  const nodeId = request.nextUrl.searchParams.get("nodeId");

  if (!nodeId) {
    return NextResponse.json(
      { error: "nodeId query param required" },
      { status: 400 }
    );
  }

  const db = getDb();

  db.delete(clusterMembers)
    .where(
      and(
        eq(clusterMembers.clusterId, clusterId),
        eq(clusterMembers.nodeId, nodeId)
      )
    )
    .run();

  return NextResponse.json({ ok: true });
});
