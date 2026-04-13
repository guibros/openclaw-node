import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";

interface TreeRow {
  id: string;
  title: string;
  status: string;
  kanban_column: string;
  owner: string | null;
  type: string | null;
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  color: string | null;
  description: string | null;
  sort_order: number | null;
  scheduled_date: string | null;
  project: string | null;
  next_action: string | null;
  updated_at: string;
  created_at: string;
}

/**
 * GET /api/tasks/[id]/tree
 * Returns the full recursive subtree for a project/pipeline/phase.
 * Uses SQLite recursive CTE for efficient traversal.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = getRawDb();

    const rows = raw
      .prepare(
        `WITH RECURSIVE tree AS (
          SELECT * FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.* FROM tasks t JOIN tree ON t.parent_id = tree.id
        )
        SELECT * FROM tree ORDER BY
          CASE type
            WHEN 'project' THEN 0
            WHEN 'pipeline' THEN 1
            WHEN 'phase' THEN 2
            ELSE 3
          END,
          sort_order,
          scheduled_date,
          start_date,
          id`
      )
      .all(id) as TreeRow[];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `Task not found: ${id}` },
        { status: 404 }
      );
    }

    // Convert snake_case to camelCase for frontend consistency
    const result = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      kanbanColumn: r.kanban_column,
      owner: r.owner,
      type: r.type,
      parentId: r.parent_id,
      startDate: r.start_date,
      endDate: r.end_date,
      color: r.color,
      description: r.description,
      sortOrder: r.sort_order,
      scheduledDate: r.scheduled_date,
      project: r.project,
      nextAction: r.next_action,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/tasks/[id]/tree error:", err);
    return NextResponse.json(
      { error: "Failed to fetch tree" },
      { status: 500 }
    );
  }
}
