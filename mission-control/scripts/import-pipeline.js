#!/usr/bin/env node
/**
 * import-pipeline.js — Bulk import Arcane Rapture pipeline into Mission Control DB.
 *
 * Creates: 1 project + 3 phases + 8 months (pipeline nodes) + 233 tasks + all dependencies.
 * Safe to re-run: deletes existing ARCANE-* entries first.
 *
 * Usage: node scripts/import-pipeline.js [--dry-run]
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const DB_PATH = path.join(__dirname, "..", "data", "mission-control.db");
const PIPELINE_JSON = path.join(
  __dirname,
  "..",
  "..",
  "arcane",
  "pipeline-data.json"
);

// Department → color mapping
const DEPT_COLORS = {
  DEV: "#3B82F6",
  CHAIN: "#8B5CF6",
  ART: "#EC4899",
  DESIGN: "#F59E0B",
  QA: "#10B981",
  INFRA: "#6B7280",
  MKT: "#EF4444",
  COMM: "#06B6D4",
  BIZ: "#22C55E",
  LEGAL: "#F97316",
  HIRE: "#A855F7",
};

function main() {
  if (!fs.existsSync(PIPELINE_JSON)) {
    console.error(`Pipeline data not found: ${PIPELINE_JSON}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(PIPELINE_JSON, "utf-8"));
  console.log(
    `Loaded pipeline: ${data.phases.length} phases, ${data.months.length} months, ${data.tasks.length} tasks`
  );

  if (DRY_RUN) {
    console.log("[DRY RUN] Would import the following:");
    console.log(`  1 project: ARCANE-RAPTURE`);
    console.log(`  ${data.phases.length} phases`);
    console.log(`  ${data.months.length} month pipelines`);
    console.log(`  ${data.tasks.length} tasks`);

    const depCount = data.tasks.reduce((n, t) => n + t.deps.length, 0);
    console.log(`  ${depCount} dependencies`);
    return;
  }

  // Ensure data dir exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Guard: verify MC runtime migrations have run
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  const required = ["type", "parent_id", "project", "start_date", "end_date", "color", "description", "needs_approval"];
  const missing = required.filter(c => !cols.includes(c));
  if (missing.length > 0) {
    console.error(`DB schema missing columns: ${missing.join(", ")}`);
    console.error("Start Mission Control first (npm run dev) to run migrations, then re-run this script.");
    process.exit(1);
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dependencies'").get();
  if (!tables) {
    console.error("DB missing 'dependencies' table. Start Mission Control first to run migrations.");
    process.exit(1);
  }

  // Wrap everything in a transaction
  const importAll = db.transaction(() => {
    // 1. Clean existing ARCANE pipeline entries (safe re-run)
    // Build the full set of IDs we're about to import
    const importIds = new Set([
      "ARCANE-RAPTURE",
      ...data.phases.map((p) => p.id),
      ...data.months.map((m) => m.id),
      ...data.tasks.map((t) => t.id),
    ]);

    // Delete ALL dependencies that reference any of these IDs
    const allDepRows = db
      .prepare(`SELECT id, source_id, target_id FROM dependencies`)
      .all();
    const deleteDep = db.prepare(`DELETE FROM dependencies WHERE id = ?`);
    let depsDeleted = 0;
    for (const row of allDepRows) {
      if (importIds.has(row.source_id) || importIds.has(row.target_id)) {
        deleteDep.run(row.id);
        depsDeleted++;
      }
    }

    // Delete ALL tasks that match our import IDs
    const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);
    let tasksDeleted = 0;
    for (const id of importIds) {
      const result = deleteTask.run(id);
      tasksDeleted += result.changes;
    }

    if (tasksDeleted > 0 || depsDeleted > 0) {
      console.log(
        `Cleaned ${tasksDeleted} existing tasks, ${depsDeleted} dependencies`
      );
    }

    const now = new Date().toISOString();

    // 2. Create the project
    const insertTask = db.prepare(`
      INSERT INTO tasks (id, title, status, kanban_column, type, parent_id, project,
        start_date, end_date, color, description, owner, needs_approval,
        updated_at, created_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTask.run(
      "ARCANE-RAPTURE",
      "Arcane Rapture — Master Pipeline",
      "queued",
      "backlog",
      "project",
      null,
      "arcane-rapture",
      "2026-03-01",
      "2026-10-31",
      "#1E40AF",
      "Full execution pipeline: 11 departments, 8 months, 233 tasks. Extracted from Master Unified Pipeline document.",
      null,
      1,
      now,
      now,
      0
    );
    console.log("Created project: ARCANE-RAPTURE");

    // 3. Create phases
    for (let i = 0; i < data.phases.length; i++) {
      const p = data.phases[i];
      insertTask.run(
        p.id,
        p.title,
        "queued",
        "backlog",
        "phase",
        "ARCANE-RAPTURE",
        "arcane-rapture",
        p.startDate,
        p.endDate,
        p.color,
        `Months ${p.months}`,
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${data.phases.length} phases`);

    // 4. Create month pipeline nodes
    for (let i = 0; i < data.months.length; i++) {
      const m = data.months[i];
      insertTask.run(
        m.id,
        m.title,
        "queued",
        "backlog",
        "pipeline",
        m.phase,
        "arcane-rapture",
        m.startDate,
        m.endDate,
        null,
        null,
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${data.months.length} month pipelines`);

    // 5. Create all tasks
    // Build a set of valid task IDs for dependency validation
    const validIds = new Set(data.tasks.map((t) => t.id));
    let skippedDeps = 0;

    for (let i = 0; i < data.tasks.length; i++) {
      const t = data.tasks[i];
      const monthId = `ARCANE-M${String(t.month).padStart(2, "0")}`;
      const month = data.months.find((m) => m.id === monthId);
      const deptColor = DEPT_COLORS[t.dept] || "#6B7280";

      insertTask.run(
        t.id,
        t.title,
        "queued",
        "backlog",
        "task",
        monthId,
        "arcane-rapture",
        month ? month.startDate : null,
        month ? month.endDate : null,
        deptColor,
        t.critical ? `⚠️ CRITICAL PATH — ${t.dept}` : t.dept,
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${data.tasks.length} tasks`);

    // 6. Create dependencies
    const insertDep = db.prepare(`
      INSERT INTO dependencies (source_id, target_id, type, created_at)
      VALUES (?, ?, 'finish_to_start', ?)
    `);

    let depCount = 0;
    for (const t of data.tasks) {
      for (const depId of t.deps) {
        if (validIds.has(depId)) {
          insertDep.run(depId, t.id, now);
          depCount++;
        } else {
          skippedDeps++;
        }
      }
    }
    console.log(`Created ${depCount} dependencies`);
    if (skippedDeps > 0) {
      console.log(`Skipped ${skippedDeps} deps (unresolvable task IDs)`);
    }

    // 7. Summary stats
    const totalTasks = db
      .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project = 'arcane-rapture'`)
      .get();
    const totalDeps = db.prepare(`SELECT COUNT(*) as c FROM dependencies`).get();
    const criticals = data.tasks.filter((t) => t.critical);

    console.log("\n=== Import Complete ===");
    console.log(`Total tasks in DB: ${totalTasks.c}`);
    console.log(`Total dependencies: ${totalDeps.c}`);
    console.log(
      `Critical path items: ${criticals.map((t) => t.id).join(", ")}`
    );
    console.log(
      `\nDepartment breakdown:`
    );
    const deptCounts = {};
    for (const t of data.tasks) {
      deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
    }
    for (const [dept, count] of Object.entries(deptCounts).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${dept}: ${count} tasks`);
    }
  });

  try {
    importAll();
  } catch (err) {
    console.error("Import failed:", err.message);
    process.exit(1);
  }

  db.close();
}

main();
