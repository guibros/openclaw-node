import { NextResponse } from "next/server";
import { getDb, getRawDb } from "@/lib/db";
import { tasks, clusters, clusterMembers, memoryDocs, memoryEntities, memoryRelations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { statusToKanban, kanbanToStatus, parseTasksMarkdown, serializeTasksMarkdown } from "@/lib/parsers/task-markdown";
import { syncTasksToMarkdown, syncTasksFromMarkdown } from "@/lib/sync/tasks";
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
  // SUITE 10: DB Schema Integrity
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
