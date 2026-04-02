import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getRawDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";
import { logActivity } from "@/lib/activity";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/projects
 * List all project-type tasks with child counts.
 */
export const GET = withTrace("projects", "GET /api/projects", async () => {
  try {
    const db = getDb();
    const raw = getRawDb();

    const projects = db
      .select()
      .from(tasks)
      .where(eq(tasks.type, "project"))
      .orderBy(tasks.sortOrder, tasks.title)
      .all();

    // Get child counts per project via raw SQL for efficiency
    const counts = raw
      .prepare(
        `SELECT parent_id, COUNT(*) as count FROM tasks
         WHERE parent_id IS NOT NULL
         GROUP BY parent_id`
      )
      .all() as { parent_id: string; count: number }[];

    const countMap = new Map(counts.map((c) => [c.parent_id, c.count]));

    const result = projects.map((p) => ({
      ...p,
      childCount: countMap.get(p.id) ?? 0,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/projects error:", err);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
});

/**
 * POST /api/projects
 * Create a new project. Body: { id, title, description?, color?, start_date?, end_date? }
 */
export const POST = withTrace("projects", "POST /api/projects", async (request: NextRequest) => {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.id || !body.title) {
      return NextResponse.json(
        { error: "id and title are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    db.insert(tasks)
      .values({
        id: body.id,
        title: body.title,
        status: body.status || "queued",
        kanbanColumn: "backlog",
        type: "project",
        description: body.description || null,
        color: body.color || null,
        startDate: body.start_date || null,
        endDate: body.end_date || null,
        owner: body.owner || null,
        updatedAt: now,
        createdAt: now,
      })
      .run();

    syncTasksToMarkdown(db);
    logActivity("task_created", `Created project: ${body.title}`, body.id);

    const created = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, body.id))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("POST /api/projects error:", err);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
});
