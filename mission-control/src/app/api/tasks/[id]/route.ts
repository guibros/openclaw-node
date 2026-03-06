import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { statusToKanban, kanbanToStatus } from "@/lib/parsers/task-markdown";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";
import { logActivity } from "@/lib/activity";
import { gatewayNotify } from "@/lib/gateway-notify";

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
 * DELETE /api/tasks/[id]
 * Delete a task (and its children) by ID.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Delete children first
    db.delete(tasks).where(eq(tasks.parentId, id)).run();
    db.delete(tasks).where(eq(tasks.id, id)).run();

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
}

/**
 * PATCH /api/tasks/[id]
 * Update a task by ID. Body: partial task fields.
 * Updates in DB, then syncs to markdown.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Auto-set owner when task moves to running manually (no explicit owner change)
    const effectiveStatus = (update.status as string) ?? existing.status;
    if (effectiveStatus === "running" && body.owner === undefined && !existing.owner) {
      update.owner = "Gui";
    }

    db.update(tasks).set(update).where(eq(tasks.id, id)).run();

    // Sync back to markdown
    syncTasksToMarkdown(db);

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

    // Push notification to TUI only for Daedalus autostart tasks
    if (movedTo || body.status) {
      const effectiveOwner = (update.owner as string) ?? existing.owner;
      const effectiveApproval = (update.needsApproval as number) ?? existing.needsApproval;
      const isDaedalus = effectiveOwner === "Daedalus";
      const isAutostart = effectiveApproval === 0;

      if (isDaedalus && isAutostart) {
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
      successCriteria: updated?.successCriteria
        ? JSON.parse(updated.successCriteria)
        : [],
      artifacts: updated?.artifacts ? JSON.parse(updated.artifacts) : [],
    });
  } catch (err) {
    console.error("PATCH /api/tasks/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}
