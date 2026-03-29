import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { statusToKanban } from "@/lib/parsers/task-markdown";
import { syncTasksFromMarkdownIfChanged, syncTasksToMarkdown } from "@/lib/sync/tasks";
import { logActivity } from "@/lib/activity";
import { schedulerTick } from "@/lib/scheduler";
import { generateTaskId } from "@/lib/task-id";
import { getNats, sc } from "@/lib/nats";
import { WORKSPACE_ROOT, AGENT_NAME } from "@/lib/config";
import path from "path";

/**
 * Parse .companion-state.md to extract current active task.
 * Returns a synthetic task object if there's active work, null otherwise.
 */
function readCompanionState(): { title: string; nextAction: string } | null {
  const statePath = path.join(WORKSPACE_ROOT, ".companion-state.md");
  if (!fs.existsSync(statePath)) return null;

  const content = fs.readFileSync(statePath, "utf-8");

  // Extract Active Task section
  const activeMatch = content.match(new RegExp("## Active Task\\n(.+?)(?:\\n##|\\n*$)", "s"));
  if (!activeMatch) return null;

  const activeText = activeMatch[1].trim();
  // Only treat as idle if the ENTIRE text is an idle phrase (not a substring match)
  if (!activeText || /^(standing by|awaiting instructions|idle|none)\.?$/im.test(activeText)) {
    return null;
  }

  // Extract Next Steps section
  const nextMatch = content.match(/## Next Steps\n([\s\S]+?)(?:\n##|\n*$)/);
  const nextText = nextMatch
    ? nextMatch[1]
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2))
        .join("; ")
    : "";

  return { title: activeText, nextAction: nextText };
}

/**
 * GET /api/tasks
 * List all tasks. Always re-syncs from active-tasks.md for fresh state.
 * Also injects a live "current session" task from .companion-state.md.
 * Optional query params: ?status=X&column=X
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();

    // Only re-sync from markdown if the file was modified externally
    syncTasksFromMarkdownIfChanged(db);

    // Inject live session task from companion state
    const liveWork = readCompanionState();
    const liveTaskId = "__LIVE_SESSION__";

    if (liveWork) {
      db.insert(tasks)
        .values({
          id: liveTaskId,
          title: liveWork.title,
          status: "running",
          kanbanColumn: "in_progress",
          owner: AGENT_NAME.toLowerCase(),
          nextAction: liveWork.nextAction || null,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          sortOrder: -1,
          successCriteria: null,
          artifacts: null,
        })
        .onConflictDoUpdate({
          target: tasks.id,
          set: {
            title: liveWork.title,
            status: "running",
            kanbanColumn: "in_progress",
            nextAction: liveWork.nextAction || null,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();
    } else {
      // No active work — remove the live task if it exists
      db.delete(tasks).where(eq(tasks.id, liveTaskId)).run();
    }

    const { searchParams } = request.nextUrl;
    const statusFilter = searchParams.get("status");
    const columnFilter = searchParams.get("column");

    const conditions = [];
    if (statusFilter) {
      conditions.push(eq(tasks.status, statusFilter));
    }
    if (columnFilter) {
      conditions.push(eq(tasks.kanbanColumn, columnFilter));
    }

    let rows;
    if (conditions.length > 0) {
      rows = db
        .select()
        .from(tasks)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(tasks.sortOrder, tasks.id)
        .all();
    } else {
      rows = db
        .select()
        .from(tasks)
        .orderBy(tasks.sortOrder, tasks.id)
        .all();
    }

    // Parse JSON fields for the response
    const result = rows.map((t) => ({
      ...t,
      successCriteria: t.successCriteria ? JSON.parse(t.successCriteria) : [],
      artifacts: t.artifacts ? JSON.parse(t.artifacts) : [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/tasks error:", err);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks
 * Create a new task. Body: { title, status?, owner?, success_criteria?, artifacts?, next_action? }
 * Auto-generates task_id as T-YYYYMMDD-NNN, writes to DB, then syncs to markdown.
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json(
        { error: "title is required and must be a string" },
        { status: 400 }
      );
    }

    if (body.title.length > 500) {
      return NextResponse.json(
        { error: "title must be 500 characters or fewer" },
        { status: 400 }
      );
    }

    if (body.success_criteria !== undefined) {
      if (!Array.isArray(body.success_criteria)) {
        if (typeof body.success_criteria === "string") {
          try {
            const parsed = JSON.parse(body.success_criteria);
            if (!Array.isArray(parsed)) {
              return NextResponse.json(
                { error: "success_criteria must be a JSON array" },
                { status: 400 }
              );
            }
          } catch {
            return NextResponse.json(
              { error: "success_criteria must be a valid JSON array string" },
              { status: 400 }
            );
          }
        } else {
          return NextResponse.json(
            { error: "success_criteria must be an array or JSON array string" },
            { status: 400 }
          );
        }
      }
    }

    const VALID_STATUSES = [
      "not started", "queued", "ready", "submitted", "running",
      "blocked", "waiting-user", "done", "cancelled", "archived",
    ];
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    if (body.scheduled_date) {
      const d = new Date(body.scheduled_date);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "scheduled_date must be a valid ISO date string" },
          { status: 400 }
        );
      }
    }

    const status = body.status || "not started";
    const now = new Date();
    // Allow custom IDs for projects/pipelines/phases; auto-generate for tasks
    const taskId = body.id || generateTaskId(db, now);

    db.insert(tasks)
      .values({
        id: taskId,
        title: body.title,
        status,
        kanbanColumn: statusToKanban(status),
        owner: body.owner || null,
        successCriteria: body.success_criteria
          ? JSON.stringify(body.success_criteria)
          : null,
        artifacts: body.artifacts ? JSON.stringify(body.artifacts) : null,
        nextAction: body.next_action || null,
        scheduledDate: body.scheduled_date || null,
        project: body.project || null,
        type: body.type || "task",
        parentId: body.parent_id || null,
        startDate: body.start_date || null,
        endDate: body.end_date || null,
        color: body.color || null,
        description: body.description || null,
        needsApproval: body.needs_approval !== undefined ? (body.needs_approval ? 1 : 0) : 1,
        triggerKind: body.trigger_kind || "none",
        triggerAt: body.trigger_at || null,
        triggerCron: body.trigger_cron || null,
        triggerTz: body.trigger_tz || "America/Montreal",
        isRecurring: body.is_recurring ? 1 : 0,
        capacityClass: body.capacity_class || "normal",
        autoPriority: body.auto_priority || 0,
        // Execution fields
        execution: body.execution || null,
        collaboration: body.collaboration ? JSON.stringify(body.collaboration) : null,
        preferredNodes: body.preferred_nodes?.length ? JSON.stringify(body.preferred_nodes) : null,
        excludeNodes: body.exclude_nodes?.length ? JSON.stringify(body.exclude_nodes) : null,
        clusterId: body.cluster_id || null,
        metric: body.metric || null,
        budgetMinutes: body.budget_minutes || 30,
        scope: body.scope?.length ? JSON.stringify(body.scope) : null,
        updatedAt: now.toISOString(),
        createdAt: now.toISOString(),
      })
      .run();

    // Sync DB state back to markdown
    syncTasksToMarkdown(db);

    // Log activity
    logActivity("task_created", `Created: ${body.title}`, taskId);

    // Immediately run scheduler tick so auto-start tasks dispatch without waiting for poll
    schedulerTick();

    // Wake bridge for mesh tasks
    if (body.execution === "mesh") {
      getNats().then((nc) => {
        if (nc) nc.publish("mesh.bridge.wake", sc.encode(""));
      }).catch(() => {});
    }

    const created = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();

    return NextResponse.json(
      {
        ...created,
        successCriteria: created?.successCriteria
          ? JSON.parse(created.successCriteria)
          : [],
        artifacts: created?.artifacts ? JSON.parse(created.artifacts) : [],
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/tasks error:", err);
    const status = err instanceof SyntaxError ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? String(err) : "Failed to create task" },
      { status }
    );
  }
}