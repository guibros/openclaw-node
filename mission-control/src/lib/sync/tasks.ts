import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { tasks } from "@/lib/db/schema";
import { ACTIVE_TASKS_MD } from "@/lib/config";
import {
  parseTasksMarkdown,
  serializeTasksMarkdown,
  statusToKanban,
} from "@/lib/parsers/task-markdown";

type DrizzleDb = ReturnType<typeof import("@/lib/db")["getDb"]>;

/* ------------------------------------------------------------------ */
/*  Mtime tracking — only re-sync from markdown when the file changes */
/* ------------------------------------------------------------------ */

let lastKnownMtime = 0;
let lastWriteMtime = 0; // mtime right after WE wrote the file
let lastImportTime = 0; // when we last ran a full import

// Debounce: bridge writes every 10s, memory-daemon every 3s — each changes
// mtime and triggers a full parse+upsert of every task. 5s cooldown prevents
// redundant re-imports during active mesh operations.
const MIN_REIMPORT_INTERVAL_MS = 5000;

/**
 * Check if active-tasks.md was modified externally (by Daedalus/user)
 * since we last read or wrote it.
 */
function markdownChangedExternally(): boolean {
  if (!fs.existsSync(ACTIVE_TASKS_MD)) return false;

  // Debounce: don't re-import if we just imported less than 5s ago
  if (Date.now() - lastImportTime < MIN_REIMPORT_INTERVAL_MS) return false;

  const stat = fs.statSync(ACTIVE_TASKS_MD);
  const mtime = stat.mtimeMs;

  // If the mtime matches what we set after our last write, skip.
  // This prevents re-importing our own writes.
  // Use tolerance window for cross-platform filesystem compatibility.
  if (Math.abs(mtime - lastWriteMtime) < 50) return false;

  if (Math.abs(mtime - lastKnownMtime) > 50) {
    lastKnownMtime = mtime;
    return true;
  }
  return false;
}

/**
 * Sync tasks from active-tasks.md into SQLite.
 * ONLY called when the file has been modified externally.
 * Merges markdown state into DB without blindly overwriting DB-only fields.
 */
export function syncTasksFromMarkdown(db: DrizzleDb): void {
  if (!fs.existsSync(ACTIVE_TASKS_MD)) return;

  lastImportTime = Date.now(); // stamp BEFORE work — prevents re-entry during long imports

  const raw = fs.readFileSync(ACTIVE_TASKS_MD, "utf-8");
  const parsed = parseTasksMarkdown(raw);
  const now = new Date().toISOString();

  const incomingIds = new Set<string>();

  for (const task of parsed) {
    incomingIds.add(task.id);

    // Check if task already exists in DB
    const existing = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get();

    if (existing) {
      // MERGE: update fields from markdown but preserve DB-authoritative fields
      // Done-gate: if markdown says "done" but task requires approval, redirect to "review"
      let effectiveStatus = task.status;
      if (task.status === "done" && existing.needsApproval === 1 && existing.status !== "done") {
        effectiveStatus = "waiting-user";
      }
      // If status changed in markdown, update kanbanColumn to match
      const statusChanged = existing.status !== effectiveStatus;
      const update: Record<string, unknown> = {
        title: task.title,
        status: effectiveStatus,
        owner: task.owner || null,
        successCriteria: task.successCriteria.length
          ? JSON.stringify(task.successCriteria)
          : null,
        artifacts: task.artifacts.length
          ? JSON.stringify(task.artifacts)
          : null,
        nextAction: task.nextAction || null,
        scheduledDate: task.scheduledDate || null,
        project: task.project || null,
        type: task.type || "task",
        parentId: task.parentId || null,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        color: task.color || null,
        description: task.description || null,
        needsApproval: task.needsApproval ? 1 : 0,
        triggerKind: task.triggerKind || "none",
        triggerAt: task.triggerAt || null,
        triggerCron: task.triggerCron || null,
        triggerTz: task.triggerTz || "America/Montreal",
        isRecurring: task.isRecurring ? 1 : 0,
        capacityClass: task.capacityClass || "normal",
        autoPriority: task.autoPriority || 0,
        // Mesh execution fields
        execution: task.execution || null,
        meshTaskId: task.meshTaskId || null,
        meshNode: task.meshNode || null,
        metric: task.metric || null,
        budgetMinutes: task.budgetMinutes || 30,
        scope: task.scope?.length ? JSON.stringify(task.scope) : null,
        // Collab routing fields
        collaboration: task.collaboration ? JSON.stringify(task.collaboration) : null,
        preferredNodes: task.preferredNodes?.length ? JSON.stringify(task.preferredNodes) : null,
        excludeNodes: task.excludeNodes?.length ? JSON.stringify(task.excludeNodes) : null,
        clusterId: task.clusterId || null,
        updatedAt: task.updatedAt || now,
      };

      // Only update kanbanColumn if status actually changed in the markdown
      if (statusChanged) {
        update.kanbanColumn = statusToKanban(effectiveStatus);
      }
      // Otherwise, preserve the existing kanbanColumn (user may have dragged it)

      db.update(tasks).set(update).where(eq(tasks.id, task.id)).run();
    } else {
      // INSERT: new task from markdown
      db.insert(tasks)
        .values({
          id: task.id,
          title: task.title,
          status: task.status,
          kanbanColumn: statusToKanban(task.status),
          owner: task.owner || null,
          successCriteria: task.successCriteria.length
            ? JSON.stringify(task.successCriteria)
            : null,
          artifacts: task.artifacts.length
            ? JSON.stringify(task.artifacts)
            : null,
          nextAction: task.nextAction || null,
          scheduledDate: task.scheduledDate || null,
          project: task.project || null,
          type: task.type || "task",
          parentId: task.parentId || null,
          startDate: task.startDate || null,
          endDate: task.endDate || null,
          color: task.color || null,
          description: task.description || null,
          needsApproval: task.needsApproval ? 1 : 0,
          triggerKind: task.triggerKind || "none",
          triggerAt: task.triggerAt || null,
          triggerCron: task.triggerCron || null,
          triggerTz: task.triggerTz || "America/Montreal",
          isRecurring: task.isRecurring ? 1 : 0,
          capacityClass: task.capacityClass || "normal",
          autoPriority: task.autoPriority || 0,
          // Mesh execution fields
          execution: task.execution || null,
          meshTaskId: task.meshTaskId || null,
          meshNode: task.meshNode || null,
          metric: task.metric || null,
          budgetMinutes: task.budgetMinutes || 30,
          scope: task.scope?.length ? JSON.stringify(task.scope) : null,
          // Collab routing fields
          collaboration: task.collaboration ? JSON.stringify(task.collaboration) : null,
          preferredNodes: task.preferredNodes?.length ? JSON.stringify(task.preferredNodes) : null,
          excludeNodes: task.excludeNodes?.length ? JSON.stringify(task.excludeNodes) : null,
          clusterId: task.clusterId || null,
          updatedAt: task.updatedAt || now,
          createdAt: now,
        })
        .run();
    }
  }

  // Remove tasks that no longer exist in the markdown —
  // but PRESERVE roadmap/pipeline tasks (project, phase, pipeline types)
  // and any tasks tagged with a project (they live in the DB, not markdown).
  const allDbTasks = db
    .select({ id: tasks.id, type: tasks.type, project: tasks.project, execution: tasks.execution, status: tasks.status })
    .from(tasks)
    .all();
  for (const row of allDbTasks) {
    if (row.id === "__LIVE_SESSION__") continue;
    // Preserve hierarchy nodes (project, phase, pipeline) — they're roadmap-only
    if (row.type === "project" || row.type === "phase" || row.type === "pipeline") continue;
    // Preserve tasks owned by a project (imported via pipeline, not markdown-managed)
    if (row.project) continue;
    // Preserve in-flight mesh tasks (only clean up terminal ones)
    if (row.execution === "mesh" && row.status !== "done" && row.status !== "cancelled") continue;
    if (!incomingIds.has(row.id)) {
      db.delete(tasks).where(eq(tasks.id, row.id)).run();
    }
  }
}

/**
 * Conditionally sync from markdown — only if file changed externally.
 * This is what GET /api/tasks should call instead of unconditional sync.
 */
export function syncTasksFromMarkdownIfChanged(db: DrizzleDb): void {
  if (markdownChangedExternally()) {
    syncTasksFromMarkdown(db);
  }
}

/**
 * Sync tasks from SQLite back to active-tasks.md.
 * Reads all tasks from the DB, converts to parsed format,
 * serializes to markdown, and writes atomically (tmp + rename).
 * Tracks the mtime after write to avoid re-importing our own changes.
 */
export function syncTasksToMarkdown(db: DrizzleDb): void {
  const allTasks = db
    .select()
    .from(tasks)
    .orderBy(tasks.sortOrder, tasks.id)
    .all();

  // Filter out the live session task — it's synthetic
  const parsed = allTasks
    .filter((t) => t.id !== "__LIVE_SESSION__")
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      owner: t.owner || "",
      successCriteria: t.successCriteria ? JSON.parse(t.successCriteria) : [],
      artifacts: t.artifacts ? JSON.parse(t.artifacts) : [],
      nextAction: t.nextAction || "",
      scheduledDate: t.scheduledDate || null,
      project: t.project || null,
      type: t.type || null,
      parentId: t.parentId || null,
      startDate: t.startDate || null,
      endDate: t.endDate || null,
      color: t.color || null,
      description: t.description || null,
      needsApproval: !!t.needsApproval,
      triggerKind: t.triggerKind || "none",
      triggerAt: t.triggerAt || null,
      triggerCron: t.triggerCron || null,
      triggerTz: t.triggerTz || "America/Montreal",
      isRecurring: !!t.isRecurring,
      capacityClass: t.capacityClass || "normal",
      autoPriority: t.autoPriority || 0,
      // Mesh execution fields — MUST be preserved on DB→markdown round-trip
      execution: t.execution || null,
      meshTaskId: t.meshTaskId || null,
      meshNode: t.meshNode || null,
      metric: t.metric || null,
      budgetMinutes: t.budgetMinutes || 30,
      scope: t.scope ? JSON.parse(t.scope) : [],
      // Collab routing fields
      collaboration: t.collaboration ? JSON.parse(t.collaboration) : null,
      preferredNodes: t.preferredNodes ? JSON.parse(t.preferredNodes) : [],
      excludeNodes: t.excludeNodes ? JSON.parse(t.excludeNodes) : [],
      clusterId: t.clusterId || null,
      updatedAt: t.updatedAt,
    }));

  const markdown = serializeTasksMarkdown(parsed);

  // Atomic write: write to .tmp, then rename over original
  const tmpPath = ACTIVE_TASKS_MD + ".tmp";
  const dir = path.dirname(ACTIVE_TASKS_MD);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tmpPath, markdown, "utf-8");
  fs.renameSync(tmpPath, ACTIVE_TASKS_MD);

  // Record mtime of our own write so we don't re-import it
  const stat = fs.statSync(ACTIVE_TASKS_MD);
  lastWriteMtime = stat.mtimeMs;
  lastKnownMtime = stat.mtimeMs;
}
