import { NextRequest, NextResponse } from "next/server";
import { getNats, sc } from "@/lib/nats";
import { getDb } from "@/lib/db";
import { tasks, clusterMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateTaskId } from "@/lib/task-id";
import { statusToKanban } from "@/lib/parsers/task-markdown";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";
import { logActivity } from "@/lib/activity";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * POST /api/cowork/dispatch
 *
 * Create a Kanban task with collaboration spec. The mesh-bridge picks it up
 * from active-tasks.md and submits to NATS — no direct NATS call here.
 *
 * A wake signal is published to reduce bridge poll latency to ~1s.
 */
export const POST = withTrace("cowork", "POST /api/cowork/dispatch", async (request: NextRequest) => {
  const body = await request.json();
  const {
    title,
    description,
    clusterId,
    nodes: manualNodes,
    mode = "parallel",
    convergence = { type: "unanimous" },
    scopeStrategy = "shared",
    budgetMinutes = 30,
    maxRounds = 5,
    metric,
    scope = [],
  } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Resolve nodes from cluster or manual list
  const db = getDb();
  let nodeIds: string[] = [];

  if (clusterId) {
    const members = db
      .select()
      .from(clusterMembers)
      .where(eq(clusterMembers.clusterId, clusterId))
      .all();
    nodeIds = members.map((m) => m.nodeId);
  }

  if (Array.isArray(manualNodes) && manualNodes.length > 0) {
    const manualIds = manualNodes.map((n: any) => n.node_id || n.nodeId);
    nodeIds = [...new Set([...nodeIds, ...manualIds])];
  }

  if (nodeIds.length < 2) {
    return NextResponse.json(
      { error: "Collab requires at least 2 nodes" },
      { status: 400 }
    );
  }

  // Build collaboration spec (bridge reads this from markdown)
  const collabSpec = {
    mode,
    min_nodes: Math.min(nodeIds.length, 2),
    max_nodes: nodeIds.length,
    join_window_s: 30,
    max_rounds: maxRounds,
    convergence: {
      type: convergence.type || "unanimous",
      threshold: (convergence.threshold ?? 66) / 100,
      metric: convergence.metric || null,
      min_quorum: Math.min(nodeIds.length, 2),
    },
    scope_strategy: scopeStrategy,
  };

  const now = new Date();
  const taskId = generateTaskId(db, now);

  try {
    db.insert(tasks)
      .values({
        id: taskId,
        title,
        status: "queued",
        kanbanColumn: statusToKanban("queued"),
        description: description || null,
        execution: "mesh",
        needsApproval: 0,
        collaboration: JSON.stringify(collabSpec),
        preferredNodes: JSON.stringify(nodeIds),
        clusterId: clusterId || null,
        metric: metric || null,
        budgetMinutes,
        scope: Array.isArray(scope) && scope.length ? JSON.stringify(scope) : null,
        updatedAt: now.toISOString(),
        createdAt: now.toISOString(),
      })
      .run();

    // Sync to markdown so bridge can pick it up
    syncTasksToMarkdown(db);

    logActivity("task_created", `Collab dispatch: ${title}`, taskId);

    // Wake the bridge for immediate pickup (~1s vs ~15s poll)
    const nc = await getNats();
    if (nc) {
      nc.publish("mesh.bridge.wake", sc.encode(""));
    }

    return NextResponse.json({
      taskId,
      clusterId: clusterId || null,
      nodesAssigned: nodeIds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
});
