import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks, dependencies } from "@/lib/db/schema";
import { statusToKanban, kanbanToStatus } from "@/lib/parsers/task-markdown";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";
import { logActivity } from "@/lib/activity";
import { gatewayNotify } from "@/lib/gateway-notify";
import { AGENT_NAME, HUMAN_NAME } from "@/lib/config";
import { getNats, sc } from "@/lib/nats";
import { withTrace } from "@/lib/tracer";

/** Safely parse a JSON string from a DB field, returning fallback on failure. */
function safeParse(json: string | null, fallback: unknown = []): unknown {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * Push a notification message to the OpenClaw TUI via gateway chat.send + abort.
 * Fire-and-forget — does not block the API response.
 */
function notifyAgent(text: string) {
  gatewayNotify(text).catch((err) => {
    console.error("MC gateway notify failed:", err);
  });
}

/**
 * Cancel a running mesh task via NATS. Best-effort — ignores failures.
 */
async function cancelMeshTask(taskId: string, execution: string | null, status: string) {
  if (execution === "mesh" && status !== "done" && status !== "cancelled") {
    const nc = await getNats();
    if (nc) {
      nc.request(
        "mesh.tasks.cancel",
        sc.encode(JSON.stringify({ task_id: taskId })),
        { timeout: 5000 }
      ).catch(() => {});
    }
  }
}

/**
 * DELETE /api/tasks/[id]
 * Delete a task (and its children) by ID.
 */
export const DELETE = withTrace("tasks", "DELETE /api/tasks/:id", async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: `Task not found: ${id}` },
        { status: 404 }
      );
    }

    // Recursively collect all descendant IDs (handles project → phase → task)
    const idsToDelete: string[] = [];
    function collectDescendants(parentId: string) {
      const children = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parentId, parentId))
        .all();
      for (const child of children) {
        collectDescendants(child.id); // depth-first: grandchildren first
        idsToDelete.push(child.id);
      }
    }
    collectDescendants(id);
    idsToDelete.push(id); // add the root task last

    // Cancel mesh task if running
    await cancelMeshTask(id, existing.execution, existing.status);

    // Delete all collected tasks + their dependency edges
    for (const delId of idsToDelete) {
      db.delete(dependencies)
        .where(or(eq(dependencies.sourceId, delId), eq(dependencies.targetId, delId)))
        .run();
      db.delete(tasks).where(eq(tasks.id, delId)).run();
    }

    syncTasksToMarkdown(db);
    logActivity("task_deleted", `Deleted: ${existing.title}`, id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasks/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete task" },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/tasks/[id]
 * Update a task by ID. Body: partial task fields.
 * Updates in DB, then syncs to markdown.
 */
export const PATCH = withTrace("tasks", "PATCH /api/tasks/:id", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const db = getDb();

    // Verify the task exists
    const existing = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: `Task not found: ${id}` },
        { status: 404 }
      );
    }

    const body = await request.json();
    const now = new Date().toISOString();

    // Status validation
    const VALID_STATUSES = new Set([
      "not started", "queued", "ready", "submitted", "running",
      "blocked", "waiting-user", "done", "cancelled", "archived",
    ]);
    if (body.status && !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status: ${body.status}` },
        { status: 400 }
      );
    }

    // Transition guard: block execution mode changes on in-flight mesh tasks
    if (body.execution !== undefined && body.execution !== existing.execution) {
      if (existing.meshTaskId) {
        return NextResponse.json(
          { error: "Cannot change execution mode after task has been submitted to mesh" },
          { status: 400 }
        );
      }
      if (existing.status !== "queued" && existing.status !== "ready") {
        return NextResponse.json(
          { error: `Cannot change execution mode while task is ${existing.status}` },
          { status: 400 }
        );
      }
    }

    // Build the update set from provided fields
    const update: Record<string, unknown> = { updatedAt: now };

    if (body.title !== undefined) {
      update.title = body.title;
    }
    if (body.status !== undefined) {
      update.status = body.status;
      update.kanbanColumn = statusToKanban(body.status);
    }
    if (body.kanban_column !== undefined) {
      update.kanbanColumn = body.kanban_column;
      if (body.status === undefined) {
        update.status = kanbanToStatus(body.kanban_column);
      }
    } else if (body.kanbanColumn !== undefined) {
      update.kanbanColumn = body.kanbanColumn;
      if (body.status === undefined) {
        update.status = kanbanToStatus(body.kanbanColumn);
      }
    }

    // Done-gate: only the human operator can mark tasks as done (via force_done flag).
    // Without force_done, redirect done→review so tasks land in waiting-user.
    const targetStatus = update.status as string | undefined;
    const targetColumn = update.kanbanColumn as string | undefined;
    if (!body.force_done) {
      if (targetStatus === "done" || targetColumn === "done") {
        update.status = "waiting-user";
        update.kanbanColumn = "review";
      }
    }
    if (body.owner !== undefined) {
      update.owner = body.owner || null;
    }
    if (body.success_criteria !== undefined) {
      update.successCriteria = body.success_criteria
        ? JSON.stringify(body.success_criteria)
        : null;
    }
    if (body.artifacts !== undefined) {
      update.artifacts = body.artifacts
        ? JSON.stringify(body.artifacts)
        : null;
    }
    if (body.next_action !== undefined) {
      update.nextAction = body.next_action || null;
    }
    if (body.sort_order !== undefined) {
      update.sortOrder = body.sort_order;
    }
    if (body.scheduled_date !== undefined) {
      update.scheduledDate = body.scheduled_date || null;
    }
    if (body.project !== undefined) {
      update.project = body.project || null;
    }
    if (body.type !== undefined) {
      update.type = body.type;
    }
    if (body.parent_id !== undefined) {
      update.parentId = body.parent_id || null;
    }
    if (body.start_date !== undefined) {
      update.startDate = body.start_date || null;
    }
    if (body.end_date !== undefined) {
      update.endDate = body.end_date || null;
    }
    if (body.color !== undefined) {
      update.color = body.color || null;
    }
    if (body.description !== undefined) {
      update.description = body.description || null;
    }
    if (body.needs_approval !== undefined) {
      update.needsApproval = body.needs_approval ? 1 : 0;
    }
    if (body.trigger_kind !== undefined) {
      update.triggerKind = body.trigger_kind;
    }
    if (body.trigger_at !== undefined) {
      update.triggerAt = body.trigger_at || null;
    }
    if (body.trigger_cron !== undefined) {
      update.triggerCron = body.trigger_cron || null;
    }
    if (body.trigger_tz !== undefined) {
      update.triggerTz = body.trigger_tz || null;
    }
    if (body.is_recurring !== undefined) {
      update.isRecurring = body.is_recurring ? 1 : 0;
    }
    if (body.capacity_class !== undefined) {
      update.capacityClass = body.capacity_class;
    }
    if (body.auto_priority !== undefined) {
      update.autoPriority = body.auto_priority;
    }
    if (body.show_in_calendar !== undefined) {
      update.showInCalendar = body.show_in_calendar ? 1 : 0;
    }
    if (body.acknowledged_at !== undefined) {
      update.acknowledgedAt = body.acknowledged_at || null;
    }
    // Mesh execution fields
    if (body.execution !== undefined) {
      update.execution = body.execution || null;
    }
    if (body.collaboration !== undefined) {
      update.collaboration = body.collaboration ? JSON.stringify(body.collaboration) : null;
    }
    if (body.preferred_nodes !== undefined) {
      update.preferredNodes = body.preferred_nodes?.length ? JSON.stringify(body.preferred_nodes) : null;
    }
    if (body.exclude_nodes !== undefined) {
      update.excludeNodes = body.exclude_nodes?.length ? JSON.stringify(body.exclude_nodes) : null;
    }
    if (body.cluster_id !== undefined) {
      update.clusterId = body.cluster_id || null;
    }
    if (body.metric !== undefined) {
      update.metric = body.metric || null;
    }
    if (body.budget_minutes !== undefined) {
      update.budgetMinutes = body.budget_minutes;
    }
    if (body.scope !== undefined) {
      update.scope = body.scope?.length ? JSON.stringify(body.scope) : null;
    }

    // Auto-set owner when task moves to running manually (no explicit owner change)
    const effectiveStatus = (update.status as string) ?? existing.status;
    if (effectiveStatus === "running" && body.owner === undefined && !existing.owner) {
      update.owner = HUMAN_NAME;
    }

    db.update(tasks).set(update).where(eq(tasks.id, id)).run();

    // Cancel mesh task if status changed to cancelled
    if (update.status === "cancelled") {
      await cancelMeshTask(id, existing.execution, existing.status);
    }

    // Sync back to markdown
    syncTasksToMarkdown(db);

    // Wake bridge when execution is set to mesh (for immediate pickup)
    const effectiveExecution = (update.execution as string) ?? existing.execution;
    const effectiveApprovalNum = (update.needsApproval as number) ?? existing.needsApproval;
    if (effectiveExecution === "mesh" && effectiveApprovalNum === 0) {
      const nc = await getNats();
      if (nc) nc.publish("mesh.bridge.wake", sc.encode(""));
    }

    // Log activity
    const movedTo = body.kanban_column || body.kanbanColumn;
    const parts: string[] = [];
    if (movedTo) parts.push(`moved to ${movedTo}`);
    if (body.status === "done") parts.push("completed");
    else if (body.status) parts.push(`status → ${body.status}`);
    if (body.title) parts.push(`renamed to "${body.title}"`);
    const desc = parts.length > 0 ? parts.join(", ") : "updated";
    logActivity(
      body.status === "done" ? "task_completed" : movedTo ? "task_moved" : "task_updated",
      `${existing.title}: ${desc}`,
      id
    );

    // Push notification to TUI only for agent autostart tasks
    if (movedTo || body.status) {
      const effectiveOwner = (update.owner as string) ?? existing.owner;
      const effectiveApproval = (update.needsApproval as number) ?? existing.needsApproval;
      const isAgent = effectiveOwner === AGENT_NAME;
      const isAutostart = effectiveApproval === 0;

      if (isAgent && isAutostart) {
        const fromCol = existing.kanbanColumn || existing.status;
        const toCol = movedTo || body.status;
        notifyAgent(`MC-Kanban: "${existing.title}" has been moved from ${fromCol} to ${toCol}`);
      }
    }

    const updated = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();

    return NextResponse.json({
      ...updated,
      successCriteria: safeParse(updated?.successCriteria ?? null),
      artifacts: safeParse(updated?.artifacts ?? null),
    });
  } catch (err) {
    console.error("PATCH /api/tasks/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
});
