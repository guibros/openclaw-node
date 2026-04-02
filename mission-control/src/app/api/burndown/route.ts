import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/burndown?projectId=X
 * Returns task status counts and a done-over-time timeline for burndown charts.
 */
export const GET = withTrace("burndown", "GET /api/burndown", async (request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const projectId = searchParams.get("projectId");
    const raw = getRawDb();

    let statusRows: Array<{ status: string; count: number }>;
    let startDate: string | null = null;
    let endDate: string | null = null;
    let doneTimeline: Array<{ date: string; count: number }>;

    if (projectId) {
      statusRows = raw
        .prepare(
          `WITH RECURSIVE tree AS (
            SELECT id, type, status FROM tasks WHERE id = ?
            UNION ALL
            SELECT t.id, t.type, t.status FROM tasks t JOIN tree ON t.parent_id = tree.id
          )
          SELECT status, COUNT(*) as count FROM tree
          WHERE type = 'task' OR type IS NULL
          GROUP BY status`
        )
        .all(projectId) as Array<{ status: string; count: number }>;

      const dateRange = raw
        .prepare(
          `WITH RECURSIVE tree AS (
            SELECT id, start_date, end_date FROM tasks WHERE id = ?
            UNION ALL
            SELECT t.id, t.start_date, t.end_date FROM tasks t JOIN tree ON t.parent_id = tree.id
          )
          SELECT MIN(start_date) as min_date, MAX(end_date) as max_date FROM tree`
        )
        .get(projectId) as { min_date: string | null; max_date: string | null };
      startDate = dateRange?.min_date ?? null;
      endDate = dateRange?.max_date ?? null;

      // Timeline: done tasks grouped by updatedAt date
      doneTimeline = raw
        .prepare(
          `WITH RECURSIVE tree AS (
            SELECT id FROM tasks WHERE id = ?
            UNION ALL
            SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id
          )
          SELECT DATE(t.updated_at) as date, COUNT(*) as count
          FROM tasks t
          WHERE t.id IN (SELECT id FROM tree)
            AND t.status IN ('done', 'cancelled')
            AND (t.type = 'task' OR t.type IS NULL)
          GROUP BY DATE(t.updated_at)
          ORDER BY date`
        )
        .all(projectId) as Array<{ date: string; count: number }>;
    } else {
      statusRows = raw
        .prepare(
          `SELECT status, COUNT(*) as count FROM tasks
          WHERE type = 'task' OR type IS NULL
          GROUP BY status`
        )
        .all() as Array<{ status: string; count: number }>;

      doneTimeline = raw
        .prepare(
          `SELECT DATE(updated_at) as date, COUNT(*) as count
          FROM tasks
          WHERE status IN ('done', 'cancelled')
            AND (type = 'task' OR type IS NULL)
          GROUP BY DATE(updated_at)
          ORDER BY date`
        )
        .all() as Array<{ date: string; count: number }>;
    }

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of statusRows) {
      counts[row.status] = row.count;
      total += row.count;
    }

    // Build cumulative done series
    let cumDone = 0;
    const timeline = doneTimeline.map((d) => {
      cumDone += d.count;
      return { date: d.date, done: cumDone, remaining: total - cumDone };
    });

    return NextResponse.json({
      total,
      counts,
      startDate,
      endDate,
      timeline,
    });
  } catch (err) {
    console.error("GET /api/burndown error:", err);
    return NextResponse.json(
      { error: "Failed to compute burndown" },
      { status: 500 }
    );
  }
});
