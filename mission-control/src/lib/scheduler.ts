import { eq, and, ne, or, lte, like, desc, isNull } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getDb } from "./db";
import { tasks, dependencies } from "./db/schema";
import { statusToKanban } from "./parsers/task-markdown";
import { syncTasksToMarkdown } from "./sync/tasks";
import { logActivity } from "./activity";
import { WORKSPACE_ROOT, AGENT_NAME, DISPATCH_SIGNAL_FILE } from "./config";
import { gatewayNotify } from "./gateway-notify";
import { traceCall } from "./tracer";


export interface Wave {
  index: number;
  taskIds: string[];
}

export interface TickResult {
  triggered: string[];
  dispatched: string[];
  recurring: string[];
  skipped: string[];
  waves?: Wave[];
}

/**
 * Compute execution waves from the dependency DAG using topological sort.
 * Tasks in the same wave have no dependencies on each other.
 * Wave N+1 tasks depend on at least one task in wave N or earlier.
 */
export function computeWaves(
  taskIds: string[],
  depTargetMap: Map<string, string[]>,
  taskStatusLookup: Map<string, string>
): Wave[] {
  const _start = Date.now();
  try {
    const taskSet = new Set(taskIds);

    // Build in-degree map (only count active edges within dispatchable set)
    const inDegree = new Map<string, number>();
    const successors = new Map<string, string[]>();

    for (const id of taskIds) {
      inDegree.set(id, 0);
      successors.set(id, []);
    }

    for (const id of taskIds) {
      const preds = depTargetMap.get(id) || [];
      for (const pred of preds) {
        const predStatus = taskStatusLookup.get(pred);
        // Done predecessors don't block us
        if (predStatus === "done") continue;
        // Only count predecessors in our dispatchable set
        if (taskSet.has(pred)) {
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
          const succs = successors.get(pred) || [];
          succs.push(id);
          successors.set(pred, succs);
        }
      }
    }

    // BFS layer-by-layer = waves
    const waves: Wave[] = [];
    let currentWave: string[] = [];

    for (const [id, deg] of inDegree) {
      if (deg === 0) currentWave.push(id);
    }

    while (currentWave.length > 0) {
      waves.push({ index: waves.length, taskIds: [...currentWave] });
      const nextWave: string[] = [];

      for (const id of currentWave) {
        for (const succ of successors.get(id) || []) {
          const newDeg = (inDegree.get(succ) || 1) - 1;
          inDegree.set(succ, newDeg);
          if (newDeg === 0) nextWave.push(succ);
        }
      }

      currentWave = nextWave;
    }

    traceCall("scheduler", "computeWaves", _start, `${waves.length} waves`);
    return waves;
  } catch (err: any) {
    traceCall("scheduler", "computeWaves", _start, undefined, err);
    throw err;
  }
}

/**
 * Main scheduler tick. Evaluates triggers and dispatches eligible tasks.
 * Designed to be called externally (API route, heartbeat, SWR poll).
 * Idempotent — safe to call repeatedly.
 */
export function schedulerTick(): TickResult {
  const _start = Date.now();
  try {
  const db = getDb();
  const now = new Date();
  const result: TickResult = {
    triggered: [],
    dispatched: [],
    recurring: [],
    skipped: [],
  };

  // --- Phase 1: Trigger evaluation ---

  // 1a. One-shot triggers: trigger_kind="at", status="queued", trigger_at <= now
  const atTasks = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.triggerKind, "at"),
        eq(tasks.status, "queued"),
        lte(tasks.triggerAt, now.toISOString())
      )
    )
    .all();

  for (const t of atTasks) {
    db.update(tasks)
      .set({
        status: "ready",
        kanbanColumn: statusToKanban("ready"),
        updatedAt: now.toISOString(),
      })
      .where(eq(tasks.id, t.id))
      .run();
    result.triggered.push(t.id);
    logActivity("scheduler_trigger", `Trigger fired (at): ${t.title}`, t.id);
  }

  // 1b. Cron triggers: trigger_kind="cron", status="queued"
  const cronTasks = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.triggerKind, "cron"), eq(tasks.status, "queued")))
    .all();

  for (const t of cronTasks) {
    if (!t.triggerCron) continue;
    try {
      const tz = t.triggerTz || "America/Montreal";
      const interval = CronExpressionParser.parse(t.triggerCron, {
        tz,
        currentDate: now,
      });
      const prev = interval.prev().toDate();
      const diffMs = now.getTime() - prev.getTime();
      // 20-min window matches heartbeat interval
      if (diffMs >= 0 && diffMs < 20 * 60 * 1000) {
        db.update(tasks)
          .set({
            status: "ready",
            kanbanColumn: statusToKanban("ready"),
            updatedAt: now.toISOString(),
          })
          .where(eq(tasks.id, t.id))
          .run();
        result.triggered.push(t.id);
        logActivity(
          "scheduler_trigger",
          `Trigger fired (cron): ${t.title}`,
          t.id
        );
      }
    } catch (err) {
      logActivity(
        "scheduler_error",
        `Invalid cron for ${t.id}: ${(err as Error).message}`,
        t.id
      );
    }
  }

  // 1c. Recurring task recreation: is_recurring=1, status="done"
  const recurringDone = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.isRecurring, 1), eq(tasks.status, "done")))
    .all();

  for (const t of recurringDone) {
    const newId = generateNextId(db, now);

    // Compute next trigger_at for cron-based recurring tasks
    let nextTriggerAt: string | null = null;
    if (t.triggerKind === "cron" && t.triggerCron) {
      try {
        const interval = CronExpressionParser.parse(t.triggerCron, {
          tz: t.triggerTz || "America/Montreal",
          currentDate: now,
        });
        nextTriggerAt = interval.next().toDate().toISOString();
      } catch {
        // keep null
      }
    }

    db.insert(tasks)
      .values({
        id: newId,
        title: t.title,
        status: "queued",
        kanbanColumn: "backlog",
        owner: t.owner,
        soulId: t.soulId,
        successCriteria: t.successCriteria,
        nextAction: t.nextAction,
        project: t.project,
        type: t.type,
        parentId: t.parentId,
        needsApproval: t.needsApproval,
        triggerKind: t.triggerKind,
        triggerAt: nextTriggerAt,
        triggerCron: t.triggerCron,
        triggerTz: t.triggerTz,
        isRecurring: 1,
        capacityClass: t.capacityClass,
        autoPriority: t.autoPriority,
        updatedAt: now.toISOString(),
        createdAt: now.toISOString(),
      })
      .run();

    // Mark original as non-recurring (historical record)
    db.update(tasks)
      .set({ isRecurring: 0 })
      .where(eq(tasks.id, t.id))
      .run();

    result.recurring.push(newId);
    logActivity(
      "scheduler_recur",
      `Recurring task recreated: ${t.title} → ${newId}`,
      newId
    );
  }

  // --- Phase 2: Single-task dispatch ---
  // Rule: ONE auto-start task at a time. The agent owns it and works autonomously.
  // Next task only dispatched when current is done, blocked, or waiting-user.

  // Check if the agent already has an active auto-dispatched task
  const agentRunning = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "running"),
        eq(tasks.owner, AGENT_NAME),
        ne(tasks.id, "__LIVE_SESSION__")
      )
    )
    .all();

  const hasActiveTask = agentRunning.length > 0;

  // Dispatchable: needs_approval=0 AND (status="ready" OR (status="queued" AND trigger_kind="none"))
  const dispatchable = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.needsApproval, 0),
        or(isNull(tasks.execution), ne(tasks.execution, "mesh")),
        or(
          eq(tasks.status, "ready"),
          and(eq(tasks.status, "queued"), eq(tasks.triggerKind, "none"))
        )
      )
    )
    .all();

  // Build dependency map for dispatch eligibility check
  const allDeps = db.select().from(dependencies).all();
  const depTargetMap = new Map<string, string[]>();
  for (const dep of allDeps) {
    const existing = depTargetMap.get(dep.targetId) || [];
    existing.push(dep.sourceId);
    depTargetMap.set(dep.targetId, existing);
  }
  const taskStatusLookup = new Map(
    db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .all()
      .map((t) => [t.id, t.status] as const)
  );

  // Filter to tasks whose predecessors are all done
  const eligible = dispatchable
    .filter((t) => {
      const preds = depTargetMap.get(t.id) || [];
      return preds.every((pid) => taskStatusLookup.get(pid) === "done");
    })
    .sort((a, b) => (b.autoPriority || 0) - (a.autoPriority || 0));

  // Compute waves for visibility (backlog info) but only dispatch 1
  const eligibleIds = eligible.map((t) => t.id);
  const waves = computeWaves(eligibleIds, depTargetMap, taskStatusLookup);
  result.waves = waves.length > 0 ? waves : undefined;

  if (!hasActiveTask && eligible.length > 0) {
    // Dispatch exactly ONE task — highest priority eligible
    const next = eligible[0];

    db.update(tasks)
      .set({
        status: "running",
        kanbanColumn: statusToKanban("running"),
        owner: AGENT_NAME,
        updatedAt: now.toISOString(),
      })
      .where(eq(tasks.id, next.id))
      .run();

    result.dispatched.push(next.id);
    logActivity(
      "scheduler_dispatch",
      `Auto-dispatched: ${next.title}`,
      next.id
    );

    // Notify via gateway message (TUI chat)
    const notifyText = `MC-Kanban: NEW AUTOTASK FOR ${AGENT_NAME.toUpperCase()} READY: "${next.title}"`;
    gatewayNotify(notifyText).catch((err) => {
      console.error("MC gateway notify failed:", err);
    });

    // Also write dispatch signal with full details (auto-checkpoint picks it up)
    try {
      const signalDir = path.join(WORKSPACE_ROOT, ".tmp");
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(
        path.join(signalDir, DISPATCH_SIGNAL_FILE),
        JSON.stringify({
          taskId: next.id,
          title: next.title,
          description: next.description,
          dispatchedAt: now.toISOString(),
        }),
        "utf-8"
      );
    } catch (err) {
      console.error("Failed to write dispatch signal:", err);
    }

    // Everything else stays in backlog
    for (const t of eligible.slice(1)) {
      result.skipped.push(t.id);
    }
  } else {
    // All eligible tasks stay in backlog (agent busy or nothing to dispatch)
    for (const t of eligible) {
      result.skipped.push(t.id);
    }
  }

  // Sync changes to markdown if anything happened
  if (
    result.triggered.length > 0 ||
    result.dispatched.length > 0 ||
    result.recurring.length > 0
  ) {
    syncTasksToMarkdown(db);
  }

  traceCall("scheduler", "schedulerTick", _start, `t:${result.triggered.length} d:${result.dispatched.length} r:${result.recurring.length}`);
  return result;
  } catch (err: any) {
    traceCall("scheduler", "schedulerTick", _start, undefined, err);
    throw err;
  }
}

function generateNextId(
  db: ReturnType<typeof getDb>,
  date: Date
): string {
  const dateStr =
    date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    date.getDate().toString().padStart(2, "0");

  const prefix = `T-${dateStr}-`;
  const row = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(like(tasks.id, `${prefix}%`))
    .orderBy(desc(tasks.id))
    .limit(1)
    .get();

  let nextSeq = 1;
  if (row) {
    nextSeq = (parseInt(row.id.slice(prefix.length), 10) || 0) + 1;
  }
  return `${prefix}${nextSeq.toString().padStart(3, "0")}`;
}
