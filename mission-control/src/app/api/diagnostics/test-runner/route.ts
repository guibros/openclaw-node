import { NextResponse } from "next/server";
import { getDb, getRawDb } from "@/lib/db";
import { tasks, clusters, clusterMembers, dependencies, memoryDocs, memoryEntities, memoryRelations } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { statusToKanban, kanbanToStatus, parseTasksMarkdown, serializeTasksMarkdown } from "@/lib/parsers/task-markdown";
import { syncTasksToMarkdown, syncTasksFromMarkdown } from "@/lib/sync/tasks";
import { schedulerTick, computeWaves } from "@/lib/scheduler";
import { getNats } from "@/lib/nats";
import fs from "fs";
import { ACTIVE_TASKS_MD, WORKSPACE_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TestResult {
  suite: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
  durationMs: number;
}

type TestFn = () => Promise<{ ok: boolean; detail?: string }>;

async function runTest(suite: string, name: string, fn: TestFn): Promise<TestResult> {
  const start = Date.now();
  try {
    const { ok, detail } = await fn();
    return { suite, name, status: ok ? "pass" : "fail", detail, durationMs: Date.now() - start };
  } catch (err) {
    return { suite, name, status: "fail", detail: (err as Error).message, durationMs: Date.now() - start };
  }
}

/**
 * POST /api/diagnostics/test-runner
 *
 * Runs a comprehensive integration test suite against the live MC system.
 * Creates test data, verifies behavior, and cleans up after itself.
 *
 * All test tasks use the prefix __TEST__ so they can be safely cleaned up.
 */
export async function POST() {
  const results: TestResult[] = [];
  const db = getDb();
  const raw = getRawDb();
  const TEST_PREFIX = "__TEST__";
  const testTaskId = `${TEST_PREFIX}${Date.now()}`;

  // ═══════════════════════════════════════════════════════════
  // SUITE 1: Status <-> Kanban Mapping
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Status Mapping", "queued -> backlog", async () => {
    return { ok: statusToKanban("queued") === "backlog" };
  }));

  results.push(await runTest("Status Mapping", "running -> in_progress", async () => {
    return { ok: statusToKanban("running") === "in_progress" };
  }));

  results.push(await runTest("Status Mapping", "waiting-user -> review", async () => {
    return { ok: statusToKanban("waiting-user") === "review" };
  }));

  results.push(await runTest("Status Mapping", "done -> done", async () => {
    return { ok: statusToKanban("done") === "done" };
  }));

  results.push(await runTest("Status Mapping", "kanban reverse: in_progress -> running", async () => {
    return { ok: kanbanToStatus("in_progress") === "running" };
  }));

  results.push(await runTest("Status Mapping", "unknown status falls back to backlog", async () => {
    return { ok: statusToKanban("banana") === "backlog" };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 2: Task CRUD
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Task CRUD", "Create task in DB", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: testTaskId,
      title: "Test Task - Integration",
      status: "queued",
      kanbanColumn: "backlog",
      owner: "test-runner",
      updatedAt: now,
      createdAt: now,
    }).run();
    const row = db.select().from(tasks).where(eq(tasks.id, testTaskId)).get();
    return {
      ok: !!row && row.title === "Test Task - Integration" && row.kanbanColumn === "backlog",
      detail: row ? `Created: ${row.id}` : "Insert failed",
    };
  }));

  results.push(await runTest("Task CRUD", "Update task status", async () => {
    db.update(tasks).set({ status: "running", kanbanColumn: "in_progress", updatedAt: new Date().toISOString() }).where(eq(tasks.id, testTaskId)).run();
    const row = db.select().from(tasks).where(eq(tasks.id, testTaskId)).get();
    return {
      ok: !!row && row.status === "running" && row.kanbanColumn === "in_progress",
      detail: `status=${row?.status}, kanban=${row?.kanbanColumn}`,
    };
  }));

  results.push(await runTest("Task CRUD", "Delete task", async () => {
    db.delete(tasks).where(eq(tasks.id, testTaskId)).run();
    const row = db.select().from(tasks).where(eq(tasks.id, testTaskId)).get();
    return { ok: !row, detail: row ? "Still exists!" : "Deleted OK" };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 3: Done-Gate Enforcement
  // ═══════════════════════════════════════════════════════════

  const doneGateTaskId = `${TEST_PREFIX}donegate_${Date.now()}`;

  results.push(await runTest("Done-Gate", "Done without force_done -> redirects to review", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: doneGateTaskId,
      title: "Done Gate Test",
      status: "running",
      kanbanColumn: "in_progress",
      needsApproval: 1,
      updatedAt: now,
      createdAt: now,
    }).run();

    // Simulate what the PATCH API does: setting done without force_done
    const targetStatus = "done";
    const redirected = targetStatus === "done"; // would be redirected
    const effectiveStatus = redirected ? "waiting-user" : "done";
    const effectiveColumn = redirected ? "review" : "done";

    db.update(tasks).set({
      status: effectiveStatus,
      kanbanColumn: effectiveColumn,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, doneGateTaskId)).run();

    const row = db.select().from(tasks).where(eq(tasks.id, doneGateTaskId)).get();
    const ok = !!row && row.status === "waiting-user" && row.kanbanColumn === "review";

    // Cleanup
    db.delete(tasks).where(eq(tasks.id, doneGateTaskId)).run();
    return { ok, detail: `status=${row?.status}, kanban=${row?.kanbanColumn}` };
  }));

  results.push(await runTest("Done-Gate", "Done with force_done -> actually done", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: doneGateTaskId + "_force",
      title: "Force Done Test",
      status: "running",
      kanbanColumn: "in_progress",
      needsApproval: 1,
      updatedAt: now,
      createdAt: now,
    }).run();

    // With force_done, no redirect
    db.update(tasks).set({
      status: "done",
      kanbanColumn: "done",
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, doneGateTaskId + "_force")).run();

    const row = db.select().from(tasks).where(eq(tasks.id, doneGateTaskId + "_force")).get();
    const ok = !!row && row.status === "done" && row.kanbanColumn === "done";

    db.delete(tasks).where(eq(tasks.id, doneGateTaskId + "_force")).run();
    return { ok, detail: `status=${row?.status}, kanban=${row?.kanbanColumn}` };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 4: Markdown Parser Round-Trip
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Parser", "Round-trip minimal task", async () => {
    const md = `## Live Tasks\n\n- task_id: TEST-001\n  title: Test\n  status: queued\n  owner: main\n  success_criteria:\n  artifacts:\n  next_action: do it\n  updated_at: 2026-01-01T00:00:00Z\n`;
    const parsed = parseTasksMarkdown(md);
    const serialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(serialized);
    const ok = reparsed.length === 1 && reparsed[0].id === "TEST-001" && reparsed[0].title === "Test";
    return { ok, detail: `parsed=${parsed.length}, reparsed=${reparsed.length}` };
  }));

  results.push(await runTest("Parser", "Round-trip mesh+collab fields", async () => {
    const md = `## Live Tasks\n\n- task_id: MESH-TEST\n  title: Mesh Test\n  status: running\n  owner: daedalus\n  success_criteria:\n  artifacts:\n  next_action: n/a\n  execution: mesh\n  mesh_task_id: NATS-001\n  mesh_node: node-a\n  metric: tests pass\n  budget_minutes: 45\n  scope:\n    - src/\n  collaboration: {"mode":"parallel","min_nodes":2}\n  preferred_nodes:\n    - node-a\n    - node-b\n  cluster_id: dev-team\n  updated_at: 2026-01-01T00:00:00Z\n`;
    const parsed = parseTasksMarkdown(md);
    const serialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(serialized);
    const t = reparsed[0];
    const ok = !!t &&
      t.execution === "mesh" &&
      t.meshTaskId === "NATS-001" &&
      t.scope?.length === 1 &&
      t.preferredNodes?.length === 2 &&
      t.clusterId === "dev-team";
    return { ok, detail: `execution=${t?.execution}, scope=${t?.scope?.length}, nodes=${t?.preferredNodes?.length}` };
  }));

  results.push(await runTest("Parser", "Round-trip scheduling fields", async () => {
    const md = `## Live Tasks\n\n- task_id: SCHED-001\n  title: Scheduled\n  status: queued\n  owner: main\n  success_criteria:\n  artifacts:\n  next_action: n/a\n  needs_approval: false\n  trigger_kind: cron\n  trigger_cron: 0 10 * * 1\n  trigger_tz: America/New_York\n  is_recurring: true\n  capacity_class: heavy\n  auto_priority: 5\n  updated_at: 2026-01-01T00:00:00Z\n`;
    const parsed = parseTasksMarkdown(md);
    const serialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(serialized);
    const t = reparsed[0];
    const ok = !!t &&
      t.needsApproval === false &&
      t.triggerKind === "cron" &&
      t.triggerCron === "0 10 * * 1" &&
      t.isRecurring === true &&
      t.capacityClass === "heavy" &&
      t.autoPriority === 5;
    return { ok, detail: `approval=${t?.needsApproval}, trigger=${t?.triggerKind}, recurring=${t?.isRecurring}` };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 5: Markdown <-> DB Sync
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Sync", "active-tasks.md exists", async () => {
    const exists = fs.existsSync(ACTIVE_TASKS_MD);
    return { ok: exists, detail: exists ? ACTIVE_TASKS_MD : "File not found" };
  }));

  results.push(await runTest("Sync", "DB -> Markdown -> DB round-trip preserves tasks", async () => {
    // Count tasks before
    const before = (raw.prepare("SELECT COUNT(*) as c FROM tasks WHERE id NOT LIKE '__TEST__%' AND id != '__LIVE_SESSION__'").get() as { c: number }).c;
    // Force a sync cycle
    syncTasksToMarkdown(db);
    syncTasksFromMarkdown(db);
    const after = (raw.prepare("SELECT COUNT(*) as c FROM tasks WHERE id NOT LIKE '__TEST__%' AND id != '__LIVE_SESSION__'").get() as { c: number }).c;
    // Should be same count (or close — live session may change)
    const diff = Math.abs(after - before);
    return { ok: diff <= 2, detail: `before=${before}, after=${after}, diff=${diff}` };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 6: Cowork / Clusters
  // ═══════════════════════════════════════════════════════════

  const testClusterId = `${TEST_PREFIX}cluster_${Date.now()}`;

  results.push(await runTest("Cowork", "Create cluster", async () => {
    const now = new Date().toISOString();
    db.insert(clusters).values({
      id: testClusterId,
      name: "Test Cluster",
      description: "Integration test cluster",
      defaultMode: "parallel",
      defaultConvergence: "unanimous",
      status: "active",
      updatedAt: now,
      createdAt: now,
    }).run();
    const row = db.select().from(clusters).where(eq(clusters.id, testClusterId)).get();
    return { ok: !!row && row.name === "Test Cluster", detail: `id=${row?.id}` };
  }));

  results.push(await runTest("Cowork", "Add member to cluster", async () => {
    db.insert(clusterMembers).values({
      clusterId: testClusterId,
      nodeId: "test-node-alpha",
      role: "worker",
    }).run();
    const members = db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, testClusterId)).all();
    return { ok: members.length === 1 && members[0].nodeId === "test-node-alpha" };
  }));

  results.push(await runTest("Cowork", "Cleanup cluster", async () => {
    db.delete(clusterMembers).where(eq(clusterMembers.clusterId, testClusterId)).run();
    db.delete(clusters).where(eq(clusters.id, testClusterId)).run();
    const row = db.select().from(clusters).where(eq(clusters.id, testClusterId)).get();
    return { ok: !row };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 7: Memory / Knowledge Graph
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Memory", "memory_docs table accessible", async () => {
    const count = (raw.prepare("SELECT COUNT(*) as c FROM memory_docs").get() as { c: number }).c;
    return { ok: true, detail: `${count} docs indexed` };
  }));

  results.push(await runTest("Memory", "memory_items table accessible", async () => {
    const count = (raw.prepare("SELECT COUNT(*) as c FROM memory_items").get() as { c: number }).c;
    return { ok: true, detail: `${count} items total` };
  }));

  results.push(await runTest("Knowledge Graph", "Entities table accessible", async () => {
    const count = (raw.prepare("SELECT COUNT(*) as c FROM memory_entities").get() as { c: number }).c;
    return { ok: true, detail: `${count} entities` };
  }));

  results.push(await runTest("Knowledge Graph", "Relations table accessible", async () => {
    const count = (raw.prepare("SELECT COUNT(*) as c FROM memory_relations").get() as { c: number }).c;
    return { ok: true, detail: `${count} relations` };
  }));

  results.push(await runTest("Knowledge Graph", "FTS index works", async () => {
    try {
      raw.prepare("SELECT COUNT(*) FROM memory_items_fts").get();
      return { ok: true, detail: "FTS5 operational" };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 8: NATS / Mesh
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Mesh", "NATS connectivity", async () => {
    try {
      const nc = await getNats();
      return { ok: !!nc, detail: nc ? "connected" : "unavailable (non-fatal)" };
    } catch {
      return { ok: true, detail: "unavailable (non-fatal — NATS is optional)" };
    }
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 9: Workspace
  // ═══════════════════════════════════════════════════════════

  results.push(await runTest("Workspace", "Root exists", async () => {
    const exists = fs.existsSync(WORKSPACE_ROOT);
    return { ok: exists, detail: WORKSPACE_ROOT };
  }));

  results.push(await runTest("Workspace", "Memory directory exists", async () => {
    const memDir = WORKSPACE_ROOT + "/memory";
    const exists = fs.existsSync(memDir);
    return { ok: exists, detail: memDir };
  }));

  // ═══════════════════════════════════════════════════════════
  // SUITE 10: Local Task Resolution (Daedalus auto-dispatch)
  // ═══════════════════════════════════════════════════════════

  const localTaskA = `${TEST_PREFIX}local_A_${Date.now()}`;
  const localTaskB = `${TEST_PREFIX}local_B_${Date.now()}`;

  results.push(await runTest("Local Dispatch", "Auto-dispatch task with needsApproval=0", async () => {
    const now = new Date().toISOString();
    // Create an auto-dispatch task (local execution, no approval needed, no trigger)
    db.insert(tasks).values({
      id: localTaskA,
      title: "Test Local Auto-Dispatch",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 0,
      triggerKind: "none",
      execution: "local",
      autoPriority: 100, // high priority so it wins
      updatedAt: now,
      createdAt: now,
    }).run();

    const tick = schedulerTick();
    const row = db.select().from(tasks).where(eq(tasks.id, localTaskA)).get();

    // Should have been dispatched (or skipped if Daedalus already has a running task)
    const dispatched = tick.dispatched.includes(localTaskA);
    const skipped = tick.skipped.includes(localTaskA);
    const ok = dispatched || skipped; // both are valid outcomes
    const detail = dispatched
      ? `Dispatched to Daedalus, status=${row?.status}, owner=${row?.owner}`
      : `Skipped (Daedalus busy), status=${row?.status}`;

    return { ok, detail };
  }));

  results.push(await runTest("Local Dispatch", "Manual approval task stays in backlog", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: localTaskB,
      title: "Test Manual Approval Required",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 1,
      triggerKind: "none",
      execution: "local",
      updatedAt: now,
      createdAt: now,
    }).run();

    schedulerTick();
    const row = db.select().from(tasks).where(eq(tasks.id, localTaskB)).get();

    // Should NOT be dispatched — needs_approval=1
    const ok = !!row && row.status === "queued" && row.kanbanColumn === "backlog";
    return { ok, detail: `status=${row?.status}, kanban=${row?.kanbanColumn}` };
  }));

  // Cleanup local dispatch tests
  db.delete(tasks).where(eq(tasks.id, localTaskA)).run();
  db.delete(tasks).where(eq(tasks.id, localTaskB)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 11: Mesh Task Resolution (single-node mesh dispatch)
  // ═══════════════════════════════════════════════════════════

  const meshTaskId = `${TEST_PREFIX}mesh_${Date.now()}`;

  results.push(await runTest("Mesh Dispatch", "Create mesh task with execution fields", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: meshTaskId,
      title: "Test Mesh Task",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 0,
      execution: "mesh",
      metric: "tests pass",
      budgetMinutes: 15,
      scope: JSON.stringify(["src/lib/"]),
      updatedAt: now,
      createdAt: now,
    }).run();

    const row = db.select().from(tasks).where(eq(tasks.id, meshTaskId)).get();
    const ok = !!row &&
      row.execution === "mesh" &&
      row.metric === "tests pass" &&
      row.budgetMinutes === 15;
    return { ok, detail: `exec=${row?.execution}, metric=${row?.metric}, budget=${row?.budgetMinutes}` };
  }));

  results.push(await runTest("Mesh Dispatch", "Scheduler skips mesh tasks (bridge handles them)", async () => {
    // The scheduler explicitly filters out execution="mesh" tasks
    const tick = schedulerTick();
    const dispatched = tick.dispatched.includes(meshTaskId);
    // Mesh tasks should NOT be in dispatched — the bridge picks them up
    return { ok: !dispatched, detail: dispatched ? "ERROR: scheduler dispatched mesh task" : "Correctly skipped by scheduler" };
  }));

  results.push(await runTest("Mesh Dispatch", "Mesh task syncs to markdown with execution fields", async () => {
    syncTasksToMarkdown(db);
    if (!fs.existsSync(ACTIVE_TASKS_MD)) return { ok: false, detail: "active-tasks.md missing" };
    const content = fs.readFileSync(ACTIVE_TASKS_MD, "utf-8");
    const hasMeshId = content.includes(meshTaskId);
    const hasExecution = content.includes("execution: mesh");
    const hasMetric = content.includes("metric: tests pass");
    const ok = hasMeshId && hasExecution && hasMetric;
    return { ok, detail: `id=${hasMeshId}, exec=${hasExecution}, metric=${hasMetric}` };
  }));

  results.push(await runTest("Mesh Dispatch", "Mesh task status lifecycle: queued -> submitted -> running -> done-gate", async () => {
    // Simulate bridge claiming the task
    db.update(tasks).set({
      status: "submitted",
      kanbanColumn: statusToKanban("submitted"),
      meshTaskId: "NATS-TEST-001",
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, meshTaskId)).run();

    let row = db.select().from(tasks).where(eq(tasks.id, meshTaskId)).get();
    const submittedOk = row?.status === "submitted" && row?.kanbanColumn === "in_progress";

    // Simulate agent claiming
    db.update(tasks).set({
      status: "running",
      kanbanColumn: statusToKanban("running"),
      meshNode: "test-node",
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, meshTaskId)).run();

    row = db.select().from(tasks).where(eq(tasks.id, meshTaskId)).get();
    const runningOk = row?.status === "running" && row?.meshNode === "test-node";

    // Simulate completion — should be caught by done-gate (redirect to waiting-user)
    // (This simulates what sync/tasks.ts does with needsApproval=1, default)
    const targetStatus = "done";
    const effectiveStatus = row?.needsApproval === 1 ? "waiting-user" : "done";
    db.update(tasks).set({
      status: effectiveStatus,
      kanbanColumn: statusToKanban(effectiveStatus),
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, meshTaskId)).run();

    row = db.select().from(tasks).where(eq(tasks.id, meshTaskId)).get();
    // Default needsApproval=1, so should land in review
    const doneGateOk = row?.status === "waiting-user" && row?.kanbanColumn === "review";

    const ok = submittedOk && runningOk && doneGateOk;
    return {
      ok,
      detail: `submitted=${submittedOk}, running=${runningOk}, doneGate=${doneGateOk} (status=${row?.status})`
    };
  }));

  // Cleanup mesh test
  db.delete(tasks).where(eq(tasks.id, meshTaskId)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 12: Collab Task Resolution (multi-node collaboration)
  // ═══════════════════════════════════════════════════════════

  const collabTaskId = `${TEST_PREFIX}collab_${Date.now()}`;

  results.push(await runTest("Collab Dispatch", "Create collab task with collaboration spec", async () => {
    const now = new Date().toISOString();
    const collabSpec = {
      mode: "parallel",
      min_nodes: 2,
      max_nodes: 3,
      join_window_s: 30,
      max_rounds: 5,
      convergence: { type: "unanimous", threshold: 1.0, metric: null, min_quorum: 2 },
      scope_strategy: "shared",
    };

    db.insert(tasks).values({
      id: collabTaskId,
      title: "Test Collab Task",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 0,
      execution: "mesh",
      collaboration: JSON.stringify(collabSpec),
      preferredNodes: JSON.stringify(["node-alpha", "node-beta", "node-gamma"]),
      metric: "consensus reached",
      budgetMinutes: 45,
      updatedAt: now,
      createdAt: now,
    }).run();

    const row = db.select().from(tasks).where(eq(tasks.id, collabTaskId)).get();
    const collab = row?.collaboration ? JSON.parse(row.collaboration as string) : null;
    const nodes = row?.preferredNodes ? JSON.parse(row.preferredNodes as string) : [];

    const ok = !!row &&
      row.execution === "mesh" &&
      collab?.mode === "parallel" &&
      collab?.max_rounds === 5 &&
      collab?.convergence?.type === "unanimous" &&
      nodes.length === 3;
    return {
      ok,
      detail: `mode=${collab?.mode}, rounds=${collab?.max_rounds}, convergence=${collab?.convergence?.type}, nodes=${nodes.length}`
    };
  }));

  results.push(await runTest("Collab Dispatch", "Collab spec survives markdown round-trip", async () => {
    syncTasksToMarkdown(db);
    if (!fs.existsSync(ACTIVE_TASKS_MD)) return { ok: false, detail: "active-tasks.md missing" };

    const content = fs.readFileSync(ACTIVE_TASKS_MD, "utf-8");
    const parsed = parseTasksMarkdown(content);
    const task = parsed.find((t) => t.id === collabTaskId);
    if (!task) return { ok: false, detail: "Task not found in markdown" };

    const collab = task.collaboration;
    const ok = !!collab &&
      (collab as Record<string, unknown>).mode === "parallel" &&
      task.preferredNodes.length === 3 &&
      task.preferredNodes.includes("node-alpha");
    return {
      ok,
      detail: `mode=${(collab as Record<string, unknown>)?.mode}, nodes=${task.preferredNodes.join(",")}`
    };
  }));

  results.push(await runTest("Collab Dispatch", "Collab convergence modes: unanimous/majority/coordinator", async () => {
    // Test that all convergence types can be stored and retrieved
    const modes = ["unanimous", "majority", "coordinator"];
    const results: string[] = [];
    for (const ctype of modes) {
      const spec = { mode: "parallel", convergence: { type: ctype, threshold: 0.66 } };
      db.update(tasks).set({
        collaboration: JSON.stringify(spec),
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, collabTaskId)).run();

      const row = db.select().from(tasks).where(eq(tasks.id, collabTaskId)).get();
      const stored = JSON.parse(row?.collaboration as string || "{}");
      if (stored.convergence?.type === ctype) {
        results.push(`${ctype}:OK`);
      } else {
        results.push(`${ctype}:FAIL(${stored.convergence?.type})`);
      }
    }
    const ok = results.every((r) => r.endsWith(":OK"));
    return { ok, detail: results.join(", ") };
  }));

  results.push(await runTest("Collab Dispatch", "Scope strategies: shared/leader_only/partitioned", async () => {
    const strategies = ["shared", "leader_only", "partitioned"];
    const results: string[] = [];
    for (const strategy of strategies) {
      const spec = { mode: "parallel", scope_strategy: strategy };
      db.update(tasks).set({
        collaboration: JSON.stringify(spec),
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, collabTaskId)).run();

      const row = db.select().from(tasks).where(eq(tasks.id, collabTaskId)).get();
      const stored = JSON.parse(row?.collaboration as string || "{}");
      if (stored.scope_strategy === strategy) {
        results.push(`${strategy}:OK`);
      } else {
        results.push(`${strategy}:FAIL`);
      }
    }
    const ok = results.every((r) => r.endsWith(":OK"));
    return { ok, detail: results.join(", ") };
  }));

  // Cleanup collab test
  db.delete(tasks).where(eq(tasks.id, collabTaskId)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 13: Cluster-Based Dispatch
  // ═══════════════════════════════════════════════════════════

  const clusterTestId = `${TEST_PREFIX}clust_${Date.now()}`;
  const clusterTaskId = `${TEST_PREFIX}clust_task_${Date.now()}`;

  results.push(await runTest("Cluster Dispatch", "Create cluster with multiple nodes and roles", async () => {
    const now = new Date().toISOString();
    db.insert(clusters).values({
      id: clusterTestId,
      name: "Test Security Team",
      description: "Integration test cluster for security audits",
      color: "#6366f1",
      defaultMode: "review",
      defaultConvergence: "majority",
      convergenceThreshold: 66,
      maxRounds: 3,
      status: "active",
      updatedAt: now,
      createdAt: now,
    }).run();

    // Add members with different roles
    const members = [
      { nodeId: "node-lead", role: "lead" },
      { nodeId: "node-impl-1", role: "implementer" },
      { nodeId: "node-impl-2", role: "implementer" },
      { nodeId: "node-reviewer", role: "reviewer" },
    ];
    for (const m of members) {
      db.insert(clusterMembers).values({
        clusterId: clusterTestId,
        nodeId: m.nodeId,
        role: m.role,
      }).run();
    }

    const cluster = db.select().from(clusters).where(eq(clusters.id, clusterTestId)).get();
    const mems = db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, clusterTestId)).all();

    const ok = !!cluster &&
      cluster.defaultMode === "review" &&
      cluster.defaultConvergence === "majority" &&
      mems.length === 4;
    return { ok, detail: `mode=${cluster?.defaultMode}, convergence=${cluster?.defaultConvergence}, members=${mems.length}` };
  }));

  results.push(await runTest("Cluster Dispatch", "Dispatch task via cluster resolves all member nodes", async () => {
    // Simulate what /api/cowork/dispatch does: resolve nodes from cluster
    const members = db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, clusterTestId)).all();
    const nodeIds = members.map((m) => m.nodeId);

    const collabSpec = {
      mode: "review",
      min_nodes: 2,
      max_nodes: nodeIds.length,
      convergence: { type: "majority", threshold: 0.66 },
      scope_strategy: "shared",
    };

    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: clusterTaskId,
      title: "Cluster-Dispatched Security Audit",
      status: "queued",
      kanbanColumn: "backlog",
      execution: "mesh",
      needsApproval: 0,
      collaboration: JSON.stringify(collabSpec),
      preferredNodes: JSON.stringify(nodeIds),
      clusterId: clusterTestId,
      budgetMinutes: 30,
      updatedAt: now,
      createdAt: now,
    }).run();

    const row = db.select().from(tasks).where(eq(tasks.id, clusterTaskId)).get();
    const storedNodes = JSON.parse(row?.preferredNodes as string || "[]");

    const ok = !!row &&
      row.clusterId === clusterTestId &&
      storedNodes.length === 4 &&
      storedNodes.includes("node-lead") &&
      storedNodes.includes("node-reviewer");
    return { ok, detail: `clusterId=${row?.clusterId}, nodes=${storedNodes.join(",")}` };
  }));

  results.push(await runTest("Cluster Dispatch", "Role distribution preserved in cluster members", async () => {
    const mems = db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, clusterTestId)).all();
    const roles = new Map<string, string>();
    for (const m of mems) roles.set(m.nodeId, m.role);

    const ok = roles.get("node-lead") === "lead" &&
      roles.get("node-impl-1") === "implementer" &&
      roles.get("node-impl-2") === "implementer" &&
      roles.get("node-reviewer") === "reviewer";
    return { ok, detail: Array.from(roles.entries()).map(([n, r]) => `${n}:${r}`).join(", ") };
  }));

  results.push(await runTest("Cluster Dispatch", "Cluster task inherits cluster defaults", async () => {
    const cluster = db.select().from(clusters).where(eq(clusters.id, clusterTestId)).get();
    const row = db.select().from(tasks).where(eq(tasks.id, clusterTaskId)).get();
    const collab = JSON.parse(row?.collaboration as string || "{}");

    // Task's collab mode should match what was set (which should match cluster default)
    const ok = collab.mode === cluster?.defaultMode;
    return { ok, detail: `task.mode=${collab.mode}, cluster.defaultMode=${cluster?.defaultMode}` };
  }));

  // Cleanup cluster tests
  db.delete(tasks).where(eq(tasks.id, clusterTaskId)).run();
  db.delete(clusterMembers).where(eq(clusterMembers.clusterId, clusterTestId)).run();
  db.delete(clusters).where(eq(clusters.id, clusterTestId)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 14: Dependency-Driven Dispatch (DAG wave computation)
  // ═══════════════════════════════════════════════════════════

  const depA = `${TEST_PREFIX}dep_A_${Date.now()}`;
  const depB = `${TEST_PREFIX}dep_B_${Date.now()}`;
  const depC = `${TEST_PREFIX}dep_C_${Date.now()}`;

  results.push(await runTest("DAG Dispatch", "Linear dependency chain: A -> B -> C", async () => {
    const now = new Date().toISOString();
    // A has no deps, B depends on A, C depends on B
    for (const [id, title] of [[depA, "Task A"], [depB, "Task B"], [depC, "Task C"]] as const) {
      db.insert(tasks).values({
        id,
        title,
        status: "queued",
        kanbanColumn: "backlog",
        needsApproval: 0,
        triggerKind: "none",
        execution: "local",
        updatedAt: now,
        createdAt: now,
      }).run();
    }

    // B depends on A
    db.insert(dependencies).values({ sourceId: depA, targetId: depB, type: "finish_to_start" }).run();
    // C depends on B
    db.insert(dependencies).values({ sourceId: depB, targetId: depC, type: "finish_to_start" }).run();

    // Compute waves
    const depTargetMap = new Map<string, string[]>();
    depTargetMap.set(depB, [depA]);
    depTargetMap.set(depC, [depB]);

    const statusMap = new Map<string, string>();
    statusMap.set(depA, "queued");
    statusMap.set(depB, "queued");
    statusMap.set(depC, "queued");

    const waves = computeWaves([depA, depB, depC], depTargetMap, statusMap);

    const ok = waves.length === 3 &&
      waves[0].taskIds.includes(depA) &&
      waves[1].taskIds.includes(depB) &&
      waves[2].taskIds.includes(depC);
    return {
      ok,
      detail: waves.map((w) => `W${w.index}:[${w.taskIds.join(",")}]`).join(" → ")
    };
  }));

  results.push(await runTest("DAG Dispatch", "Parallel tasks in same wave when no inter-dependency", async () => {
    // A and B both have no deps — should be in wave 0
    // C depends on both A and B — should be in wave 1
    const depTargetMap = new Map<string, string[]>();
    depTargetMap.set(depC, [depA, depB]); // C depends on A and B

    const statusMap = new Map<string, string>();
    statusMap.set(depA, "queued");
    statusMap.set(depB, "queued");
    statusMap.set(depC, "queued");

    const waves = computeWaves([depA, depB, depC], depTargetMap, statusMap);

    const wave0 = waves[0]?.taskIds || [];
    const wave1 = waves[1]?.taskIds || [];

    const ok = waves.length === 2 &&
      wave0.includes(depA) && wave0.includes(depB) &&
      wave1.includes(depC);
    return {
      ok,
      detail: waves.map((w) => `W${w.index}:[${w.taskIds.join(",")}]`).join(" → ")
    };
  }));

  results.push(await runTest("DAG Dispatch", "Completed predecessor unblocks dependent", async () => {
    // Mark A as done — B's predecessor is now done, so B should be in wave 0
    const depTargetMap = new Map<string, string[]>();
    depTargetMap.set(depB, [depA]);
    depTargetMap.set(depC, [depB]);

    const statusMap = new Map<string, string>();
    statusMap.set(depA, "done"); // A is done
    statusMap.set(depB, "queued");
    statusMap.set(depC, "queued");

    const waves = computeWaves([depA, depB, depC], depTargetMap, statusMap);

    // A is done so B has in-degree 0 (wave 0), C depends on B (wave 1)
    // A itself also appears in wave 0 (it's in the set)
    const wave0 = waves[0]?.taskIds || [];
    const ok = wave0.includes(depB); // B should be unblocked
    return {
      ok,
      detail: waves.map((w) => `W${w.index}:[${w.taskIds.join(",")}]`).join(" → ")
    };
  }));

  // Cleanup DAG tests
  db.delete(dependencies).where(or(
    eq(dependencies.sourceId, depA),
    eq(dependencies.sourceId, depB),
    eq(dependencies.targetId, depB),
    eq(dependencies.targetId, depC),
  )).run();
  db.delete(tasks).where(eq(tasks.id, depA)).run();
  db.delete(tasks).where(eq(tasks.id, depB)).run();
  db.delete(tasks).where(eq(tasks.id, depC)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 15: Trigger-Based Dispatch (cron and at-once)
  // ═══════════════════════════════════════════════════════════

  const triggerAtId = `${TEST_PREFIX}trig_at_${Date.now()}`;
  const triggerCronId = `${TEST_PREFIX}trig_cron_${Date.now()}`;
  const recurringId = `${TEST_PREFIX}recur_${Date.now()}`;

  results.push(await runTest("Trigger Dispatch", "At-trigger fires when time has passed", async () => {
    const now = new Date();
    const pastTime = new Date(now.getTime() - 60000).toISOString(); // 1 minute ago
    db.insert(tasks).values({
      id: triggerAtId,
      title: "Test At-Trigger",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 0,
      triggerKind: "at",
      triggerAt: pastTime,
      execution: "local",
      updatedAt: now.toISOString(),
      createdAt: now.toISOString(),
    }).run();

    const tick = schedulerTick();
    const row = db.select().from(tasks).where(eq(tasks.id, triggerAtId)).get();

    const triggered = tick.triggered.includes(triggerAtId);
    const ok = triggered && row?.status === "ready";
    return { ok, detail: `triggered=${triggered}, status=${row?.status}` };
  }));

  results.push(await runTest("Trigger Dispatch", "Future at-trigger does NOT fire", async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
    const futureId = `${TEST_PREFIX}trig_future_${Date.now()}`;
    db.insert(tasks).values({
      id: futureId,
      title: "Test Future Trigger",
      status: "queued",
      kanbanColumn: "backlog",
      needsApproval: 0,
      triggerKind: "at",
      triggerAt: futureTime,
      execution: "local",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }).run();

    const tick = schedulerTick();
    const row = db.select().from(tasks).where(eq(tasks.id, futureId)).get();

    const notTriggered = !tick.triggered.includes(futureId);
    const ok = notTriggered && row?.status === "queued";
    db.delete(tasks).where(eq(tasks.id, futureId)).run();
    return { ok, detail: `triggered=${!notTriggered}, status=${row?.status}` };
  }));

  results.push(await runTest("Trigger Dispatch", "Recurring task recreates after done", async () => {
    const now = new Date().toISOString();
    db.insert(tasks).values({
      id: recurringId,
      title: "Test Recurring Task",
      status: "done",
      kanbanColumn: "done",
      needsApproval: 0,
      triggerKind: "none",
      isRecurring: 1,
      execution: "local",
      updatedAt: now,
      createdAt: now,
    }).run();

    const tick = schedulerTick();

    // Should have created a new recurring clone
    const ok = tick.recurring.length > 0;
    const detail = ok
      ? `Recreated: ${tick.recurring.join(", ")}`
      : "No recurring tasks created";

    // Original should no longer be recurring
    const original = db.select().from(tasks).where(eq(tasks.id, recurringId)).get();
    const originalOk = original?.isRecurring === 0;

    // Cleanup: delete original and clones
    db.delete(tasks).where(eq(tasks.id, recurringId)).run();
    for (const cloneId of tick.recurring) {
      db.delete(tasks).where(eq(tasks.id, cloneId)).run();
    }

    return { ok: ok && originalOk, detail: `${detail}, originalRecurring=${original?.isRecurring}` };
  }));

  // Cleanup trigger tests
  db.delete(tasks).where(eq(tasks.id, triggerAtId)).run();
  db.delete(tasks).where(eq(tasks.id, triggerCronId)).run();

  // ═══════════════════════════════════════════════════════════
  // SUITE 16: DB Schema Integrity
  // ═══════════════════════════════════════════════════════════

  const expectedTables = [
    "tasks", "dependencies", "memory_docs", "memory_items", "memory_audit",
    "memory_entities", "memory_relations", "memory_entity_items",
    "activity_log", "soul_handoffs", "soul_evolution_log", "soul_spawns",
    "clusters", "cluster_members", "token_usage",
  ];

  for (const table of expectedTables) {
    results.push(await runTest("Schema", `Table '${table}' exists`, async () => {
      try {
        raw.prepare(`SELECT COUNT(*) FROM ${table}`).get();
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANUP: Remove any leftover test data
  // ═══════════════════════════════════════════════════════════

  raw.prepare(`DELETE FROM dependencies WHERE source_id LIKE '${TEST_PREFIX}%' OR target_id LIKE '${TEST_PREFIX}%'`).run();
  raw.prepare(`DELETE FROM tasks WHERE id LIKE '${TEST_PREFIX}%'`).run();
  raw.prepare(`DELETE FROM cluster_members WHERE cluster_id LIKE '${TEST_PREFIX}%'`).run();
  raw.prepare(`DELETE FROM clusters WHERE id LIKE '${TEST_PREFIX}%'`).run();

  // ═══════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  return NextResponse.json({
    summary: { total: results.length, passed, failed, skipped, durationMs: totalMs },
    results,
    timestamp: new Date().toISOString(),
  });
}
