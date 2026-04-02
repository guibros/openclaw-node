import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clusters, clusterMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * GET /api/cowork/clusters/[id]
 */
export const GET = withTrace("cowork", "GET /api/cowork/clusters/[id]", async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const db = getDb();

  const cluster = db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (!cluster) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const members = db
    .select()
    .from(clusterMembers)
    .where(eq(clusterMembers.clusterId, id))
    .all();

  return NextResponse.json({ ...cluster, members });
});

/**
 * PATCH /api/cowork/clusters/[id]
 *
 * Partial update — only touches fields present in request body.
 */
export const PATCH = withTrace("cowork", "PATCH /api/cowork/clusters/[id]", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const existing = db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.color !== undefined) updates.color = body.color;
  if (body.defaultMode !== undefined) updates.defaultMode = body.defaultMode;
  if (body.defaultConvergence !== undefined)
    updates.defaultConvergence = body.defaultConvergence;
  if (body.convergenceThreshold !== undefined)
    updates.convergenceThreshold = body.convergenceThreshold;
  if (body.maxRounds !== undefined) updates.maxRounds = body.maxRounds;

  db.update(clusters).set(updates).where(eq(clusters.id, id)).run();

  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/cowork/clusters/[id]
 *
 * Soft-delete: sets status to "archived".
 */
export const DELETE = withTrace("cowork", "DELETE /api/cowork/clusters/[id]", async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const db = getDb();

  db.update(clusters)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(clusters.id, id))
    .run();

  return NextResponse.json({ ok: true });
});
