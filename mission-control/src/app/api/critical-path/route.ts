import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";

interface TaskRow {
  id: string;
  start_date: string | null;
  end_date: string | null;
  type: string | null;
}

/**
 * GET /api/critical-path?projectId=X
 * Computes the critical path through the dependency DAG using
 * forward/backward pass (ES/EF/LS/LF). Tasks with zero float are critical.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const projectId = searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId required" },
        { status: 400 }
      );
    }

    const raw = getRawDb();

    // Get subtree tasks
    const taskRows = raw
      .prepare(
        `WITH RECURSIVE tree AS (
          SELECT id, start_date, end_date, type FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id, t.start_date, t.end_date, t.type
          FROM tasks t JOIN tree ON t.parent_id = tree.id
        )
        SELECT * FROM tree`
      )
      .all(projectId) as TaskRow[];

    const taskIds = new Set(taskRows.map((t) => t.id));

    // Get dependencies within subtree (using the same recursive CTE)
    const depRows = raw
      .prepare(
        `WITH RECURSIVE tree AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id
        )
        SELECT d.source_id, d.target_id FROM dependencies d
        WHERE d.source_id IN (SELECT id FROM tree)
          AND d.target_id IN (SELECT id FROM tree)`
      )
      .all(projectId) as Array<{ source_id: string; target_id: string }>;

    // No dependencies → no critical path to compute
    if (depRows.length === 0) {
      return NextResponse.json({ criticalPath: [], totalDuration: 0 });
    }

    // Compute task durations (in days)
    const duration = new Map<string, number>();
    for (const t of taskRows) {
      if (t.start_date && t.end_date) {
        const ms =
          new Date(t.end_date).getTime() - new Date(t.start_date).getTime();
        duration.set(t.id, Math.max(1, Math.ceil(ms / 86400000)));
      } else {
        duration.set(t.id, 1);
      }
    }

    // Build adjacency lists
    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of taskIds) {
      successors.set(id, []);
      predecessors.set(id, []);
      inDegree.set(id, 0);
    }

    for (const dep of depRows) {
      successors.get(dep.source_id)!.push(dep.target_id);
      predecessors.get(dep.target_id)!.push(dep.source_id);
      inDegree.set(
        dep.target_id,
        (inDegree.get(dep.target_id) || 0) + 1
      );
    }

    // Topological sort (Kahn's algorithm)
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const topoOrder: string[] = [];
    const degCopy = new Map(inDegree);
    const topoQueue = [...queue];
    while (topoQueue.length > 0) {
      const node = topoQueue.shift()!;
      topoOrder.push(node);
      for (const succ of successors.get(node) || []) {
        const nd = (degCopy.get(succ) || 1) - 1;
        degCopy.set(succ, nd);
        if (nd === 0) topoQueue.push(succ);
      }
    }

    // Forward pass: ES[i] = max(EF[predecessors]), EF[i] = ES[i] + duration[i]
    const ES = new Map<string, number>();
    const EF = new Map<string, number>();
    for (const node of topoOrder) {
      const preds = predecessors.get(node) || [];
      const es =
        preds.length > 0
          ? Math.max(...preds.map((p) => EF.get(p) || 0))
          : 0;
      ES.set(node, es);
      EF.set(node, es + (duration.get(node) || 1));
    }

    const projectDuration = Math.max(0, ...Array.from(EF.values()));

    // Backward pass: LF[i] = min(LS[successors]), LS[i] = LF[i] - duration[i]
    const LS = new Map<string, number>();
    const LF = new Map<string, number>();
    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const node = topoOrder[i];
      const succs = successors.get(node) || [];
      const lf =
        succs.length > 0
          ? Math.min(...succs.map((s) => LS.get(s) || projectDuration))
          : projectDuration;
      LF.set(node, lf);
      LS.set(node, lf - (duration.get(node) || 1));
    }

    // Critical path: tasks with zero float (LS - ES ≈ 0)
    const criticalPath: string[] = [];
    for (const id of topoOrder) {
      const float = (LS.get(id) || 0) - (ES.get(id) || 0);
      if (Math.abs(float) < 0.001) {
        criticalPath.push(id);
      }
    }

    return NextResponse.json({ criticalPath, totalDuration: projectDuration });
  } catch (err) {
    console.error("GET /api/critical-path error:", err);
    return NextResponse.json(
      { error: "Failed to compute critical path" },
      { status: 500 }
    );
  }
}
