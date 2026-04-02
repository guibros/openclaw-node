import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getRawDb } from "@/lib/db";
import { dependencies } from "@/lib/db/schema";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/dependencies?taskId=X
 * Get all dependencies where taskId is source or target.
 * Also accepts ?projectId=X to get all deps within a project tree.
 */
export const GET = withTrace("dependencies", "GET /api/dependencies", async (request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const taskId = searchParams.get("taskId");
    const projectId = searchParams.get("projectId");

    const raw = getRawDb();

    if (projectId) {
      // Get all dependencies within a project's subtree
      const rows = raw
        .prepare(
          `WITH RECURSIVE tree AS (
            SELECT id FROM tasks WHERE id = ?
            UNION ALL
            SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id
          )
          SELECT d.* FROM dependencies d
          WHERE d.source_id IN (SELECT id FROM tree)
             OR d.target_id IN (SELECT id FROM tree)`
        )
        .all(projectId) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        type: string;
        created_at: string;
      }>;

      return NextResponse.json(
        rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          type: r.type,
          createdAt: r.created_at,
        }))
      );
    }

    if (taskId) {
      const db = getDb();
      const asSource = db
        .select()
        .from(dependencies)
        .where(eq(dependencies.sourceId, taskId))
        .all();
      const asTarget = db
        .select()
        .from(dependencies)
        .where(eq(dependencies.targetId, taskId))
        .all();

      return NextResponse.json({
        blocks: asSource, // things this task blocks
        blockedBy: asTarget, // things blocking this task
      });
    }

    // No filter — return all
    const db = getDb();
    const all = db.select().from(dependencies).all();
    return NextResponse.json(all);
  } catch (err) {
    console.error("GET /api/dependencies error:", err);
    return NextResponse.json(
      { error: "Failed to fetch dependencies" },
      { status: 500 }
    );
  }
});

/**
 * POST /api/dependencies
 * Create a dependency. Body: { sourceId, targetId, type? }
 * Includes cycle detection via recursive CTE.
 */
export const POST = withTrace("dependencies", "POST /api/dependencies", async (request: NextRequest) => {
  try {
    const db = getDb();
    const raw = getRawDb();
    const body = await request.json();

    if (!body.sourceId || !body.targetId) {
      return NextResponse.json(
        { error: "sourceId and targetId are required" },
        { status: 400 }
      );
    }

    if (body.sourceId === body.targetId) {
      return NextResponse.json(
        { error: "A task cannot depend on itself" },
        { status: 400 }
      );
    }

    // Cycle detection: check if targetId can already reach sourceId
    const cycle = raw
      .prepare(
        `WITH RECURSIVE reachable AS (
          SELECT target_id AS id FROM dependencies WHERE source_id = ?
          UNION ALL
          SELECT d.target_id FROM dependencies d JOIN reachable r ON d.source_id = r.id
        )
        SELECT 1 FROM reachable WHERE id = ? LIMIT 1`
      )
      .get(body.targetId, body.sourceId);

    if (cycle) {
      return NextResponse.json(
        { error: "This dependency would create a cycle" },
        { status: 400 }
      );
    }

    const result = db
      .insert(dependencies)
      .values({
        sourceId: body.sourceId,
        targetId: body.targetId,
        type: body.type || "finish_to_start",
      })
      .returning()
      .get();

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/dependencies error:", err);
    return NextResponse.json(
      { error: "Failed to create dependency" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/dependencies?id=X
 * Remove a dependency by ID.
 */
export const DELETE = withTrace("dependencies", "DELETE /api/dependencies", async (request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const idStr = searchParams.get("id");

    if (!idStr) {
      return NextResponse.json(
        { error: "id query param is required" },
        { status: 400 }
      );
    }

    const db = getDb();
    db.delete(dependencies)
      .where(eq(dependencies.id, parseInt(idStr, 10)))
      .run();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/dependencies error:", err);
    return NextResponse.json(
      { error: "Failed to delete dependency" },
      { status: 500 }
    );
  }
});
