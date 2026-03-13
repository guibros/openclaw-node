#!/usr/bin/env node
/**
 * import-pipeline-v2.js — Parse the Day-by-Day Master Pipeline markdown
 * and import all tasks into Mission Control DB.
 *
 * Creates: 1 project + phases + 12 monthly pipelines + ~350 tasks + dependencies.
 * Safe to re-run: deletes existing ARCANE-* entries first.
 *
 * Usage: node scripts/import-pipeline-v2.js [--dry-run] [--json]
 *   --dry-run: parse and report without writing to DB
 *   --json: also write pipeline-data.json
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const WRITE_JSON = process.argv.includes("--json");
const DB_PATH = path.join(__dirname, "..", "data", "mission-control.db");
const PIPELINE_MD = path.join(
  __dirname,
  "..",
  "..",
  "arcane",
  "ARCANE_RAPTURE_DAY_BY_DAY_PIPELINE.md"
);

const DEPT_COLORS = {
  DEV: "#3B82F6",
  CHAIN: "#8B5CF6",
  ART: "#EC4899",
  DESIGN: "#F59E0B",
  NARR: "#14B8A6",
  QA: "#10B981",
  INFRA: "#6B7280",
  MKT: "#EF4444",
  COMM: "#06B6D4",
  BIZ: "#22C55E",
  LEGAL: "#F97316",
  HIRE: "#A855F7",
};

// Month name → number
const MONTH_MAP = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse a date string like "Mon Mar 02" with a known year into YYYY-MM-DD.
 * Also handles "Wed Apr 01", etc.
 */
function parseDayHeader(dayStr, yearHint) {
  // dayStr is like "Mon Mar 02" or "Tue Sep 01"
  const parts = dayStr.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const monthAbbr = parts[1];
  const day = parseInt(parts[2], 10);
  const monthNum = MONTH_MAP[monthAbbr];
  if (monthNum === undefined || isNaN(day)) return null;
  const m = String(monthNum + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${yearHint}-${m}-${d}`;
}

/**
 * Extract department code from task ID (e.g., "DEV-M01-001" → "DEV")
 */
function extractDept(taskId) {
  const match = taskId.match(/^([A-Z]+)-/);
  return match ? match[1] : null;
}

/**
 * Parse the markdown file into structured data.
 */
function parseMarkdown(content) {
  const lines = content.split("\n");
  const months = [];
  const tasks = [];

  let currentMonth = null;
  let currentDate = null;
  let currentYear = 2026;
  let currentPhase = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match month header: # MONTH N — Title
    const monthMatch = line.match(/^# MONTH (\d+)\s*[—–-]\s*(.+)/);
    if (monthMatch) {
      const monthNum = parseInt(monthMatch[1], 10);
      const monthTitle = monthMatch[2].trim();

      // Look ahead for Phase and Calendar lines
      let phase = null;
      let calStart = null;
      let calEnd = null;

      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const phaseMatch = lines[j].match(/\*\*Phase:\*\*\s*(.+)/);
        if (phaseMatch) phase = phaseMatch[1].trim();

        const calMatch = lines[j].match(
          /\*\*Calendar:\*\*\s*(\w+\s+\d+)\s*[—–-]\s*(\w+\s+\d+),\s*(\d{4})/
        );
        if (calMatch) {
          const yearStr = calMatch[3];
          currentYear = parseInt(yearStr, 10);
          // Parse start/end dates
          const startParts = calMatch[1].split(/\s+/);
          const endParts = calMatch[2].split(/\s+/);
          const startMonth = MONTH_MAP[startParts[0].slice(0, 3)];
          const endMonth = MONTH_MAP[endParts[0].slice(0, 3)];
          if (startMonth !== undefined && endMonth !== undefined) {
            calStart = `${currentYear}-${String(startMonth + 1).padStart(2, "0")}-${String(parseInt(startParts[1])).padStart(2, "0")}`;
            calEnd = `${currentYear}-${String(endMonth + 1).padStart(2, "0")}-${String(parseInt(endParts[1])).padStart(2, "0")}`;
          }
        }
      }

      currentMonth = {
        num: monthNum,
        id: `ARCANE-M${String(monthNum).padStart(2, "0")}`,
        title: `Month ${monthNum} — ${monthTitle}`,
        phase: phase,
        startDate: calStart,
        endDate: calEnd,
      };
      currentPhase = phase;
      months.push(currentMonth);
      continue;
    }

    // Match day header: #### Day N — DayName MonthName DD
    const dayMatch = line.match(/^####\s+Day\s+\d+\s*[—–-]\s*(.+)/);
    if (dayMatch && currentMonth) {
      currentDate = parseDayHeader(dayMatch[1], currentYear);
      continue;
    }

    // Match task line: - [ ] **TASK-ID**: Description [Deps: X, Y]
    // Also handles: - [ ] **TASK-ID** 🔴: Description
    const taskMatch = line.match(
      /^- \[ \] \*\*([A-Z]+-[A-Z0-9_-]+)\*\*\s*(🔴|🟡)?\s*:?\s*(.+)/
    );
    if (taskMatch && currentMonth) {
      const taskId = taskMatch[1];
      let criticality = taskMatch[2] || null;
      let titleRaw = taskMatch[3].trim();

      // Extract dependencies: [Deps: X, Y, Z]
      const depsMatch = titleRaw.match(/\[Deps?:\s*([^\]]+)\]/);
      let deps = [];
      if (depsMatch) {
        deps = depsMatch[1]
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        titleRaw = titleRaw.replace(/\[Deps?:\s*[^\]]+\]/, "").trim();
      }

      // Clean up markers from title
      let title = titleRaw
        .replace(/^⚠️?\s*/, "")
        .replace(/^⚠\s*/, "")
        .replace(/^NEW:\s*/i, "")
        .replace(/^CRITICAL PATH:\s*/i, "")
        .replace(/^URGENT\s*/i, "")
        .trim();

      // Detect criticality from text if not from emoji
      if (!criticality && /⚠|CRITICAL PATH|URGENT|HARD GATE/i.test(titleRaw)) {
        criticality = "🔴";
      }

      const dept = extractDept(taskId);

      tasks.push({
        id: taskId,
        title,
        dept,
        month: currentMonth.num,
        monthId: currentMonth.id,
        scheduledDate: currentDate,
        deps,
        critical: criticality === "🔴",
        important: criticality === "🟡",
        phase: currentPhase,
      });
      continue;
    }
  }

  return { months, tasks };
}

/**
 * Derive phases from month data.
 */
function derivePhases(months) {
  const phaseMap = new Map();
  for (const m of months) {
    if (!m.phase) continue;
    const key = m.phase;
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        title: m.phase,
        months: [],
        startDate: m.startDate,
        endDate: m.endDate,
      });
    }
    const p = phaseMap.get(key);
    p.months.push(m.num);
    if (m.startDate && (!p.startDate || m.startDate < p.startDate)) {
      p.startDate = m.startDate;
    }
    if (m.endDate && (!p.endDate || m.endDate > p.endDate)) {
      p.endDate = m.endDate;
    }
  }

  const phaseColors = [
    "#1E40AF", "#7C3AED", "#B45309", "#0F766E", "#BE185D",
  ];
  let idx = 0;
  const phases = [];
  for (const [title, data] of phaseMap) {
    const id = `ARCANE-PHASE-${idx}`;
    phases.push({
      id,
      title,
      months: data.months.join(", "),
      startDate: data.startDate,
      endDate: data.endDate,
      color: phaseColors[idx % phaseColors.length],
    });
    idx++;
  }
  return phases;
}

function main() {
  if (!fs.existsSync(PIPELINE_MD)) {
    console.error(`Pipeline markdown not found: ${PIPELINE_MD}`);
    process.exit(1);
  }

  const content = fs.readFileSync(PIPELINE_MD, "utf-8");
  const { months, tasks } = parseMarkdown(content);
  const phases = derivePhases(months);

  // Build phase→id lookup for months
  const phaseIdMap = new Map();
  for (const p of phases) {
    for (const mNum of p.months.split(", ").map(Number)) {
      phaseIdMap.set(mNum, p.id);
    }
  }

  console.log(`Parsed: ${phases.length} phases, ${months.length} months, ${tasks.length} tasks`);

  // Department breakdown
  const deptCounts = {};
  for (const t of tasks) {
    deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
  }
  console.log("\nDepartment breakdown:");
  for (const [dept, count] of Object.entries(deptCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dept}: ${count} tasks`);
  }

  const criticals = tasks.filter((t) => t.critical);
  console.log(`\nCritical path items: ${criticals.length}`);
  const important = tasks.filter((t) => t.important);
  console.log(`Important items: ${important.length}`);

  const depCount = tasks.reduce((n, t) => n + t.deps.length, 0);
  console.log(`Dependencies: ${depCount}`);

  const withDates = tasks.filter((t) => t.scheduledDate);
  console.log(`Tasks with scheduled dates: ${withDates.length}/${tasks.length}`);

  // Write JSON if requested
  if (WRITE_JSON) {
    const jsonPath = path.join(__dirname, "..", "..", "arcane", "pipeline-data.json");
    const jsonData = { phases, months, tasks };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
    console.log(`\nWrote ${jsonPath}`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No DB changes made.");
    return;
  }

  // --- DB Import ---
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Guard: verify MC runtime migrations have run (import needs columns beyond the base drizzle schema)
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  const required = ["type", "parent_id", "project", "start_date", "end_date", "color", "description", "scheduled_date", "needs_approval"];
  const missing = required.filter(c => !cols.includes(c));
  if (missing.length > 0) {
    console.error(`DB schema missing columns: ${missing.join(", ")}`);
    console.error("Start Mission Control first (npm run dev) to run migrations, then re-run this script.");
    process.exit(1);
  }
  // Also ensure dependencies table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dependencies'").get();
  if (!tables) {
    console.error("DB missing 'dependencies' table. Start Mission Control first to run migrations.");
    process.exit(1);
  }

  const importAll = db.transaction(() => {
    // 1. Clean existing ARCANE pipeline entries
    const importIds = new Set([
      "ARCANE-RAPTURE",
      ...phases.map((p) => p.id),
      ...months.map((m) => m.id),
      ...tasks.map((t) => t.id),
    ]);

    // Also clean old phase IDs from v1 import
    const oldRows = db
      .prepare(`SELECT id FROM tasks WHERE project = 'arcane-rapture'`)
      .all();
    for (const row of oldRows) {
      importIds.add(row.id);
    }

    const allDepRows = db.prepare(`SELECT id, source_id, target_id FROM dependencies`).all();
    const deleteDep = db.prepare(`DELETE FROM dependencies WHERE id = ?`);
    let depsDeleted = 0;
    for (const row of allDepRows) {
      if (importIds.has(row.source_id) || importIds.has(row.target_id)) {
        deleteDep.run(row.id);
        depsDeleted++;
      }
    }

    const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);
    let tasksDeleted = 0;
    for (const id of importIds) {
      const result = deleteTask.run(id);
      tasksDeleted += result.changes;
    }

    if (tasksDeleted > 0 || depsDeleted > 0) {
      console.log(`\nCleaned ${tasksDeleted} existing tasks, ${depsDeleted} dependencies`);
    }

    const now = new Date().toISOString();

    const insertTask = db.prepare(`
      INSERT INTO tasks (id, title, status, kanban_column, type, parent_id, project,
        start_date, end_date, color, description, scheduled_date, owner, needs_approval,
        updated_at, created_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 2. Create the project
    insertTask.run(
      "ARCANE-RAPTURE",
      "Arcane Rapture — Day-by-Day Master Pipeline",
      "queued",
      "backlog",
      "project",
      null,
      "arcane-rapture",
      "2026-03-02",
      "2027-02-26",
      "#1E40AF",
      "12 departments, 12 months, day-by-day. Source: ARCANE_RAPTURE_DAY_BY_DAY_PIPELINE.md",
      null,
      null,
      1,
      now,
      now,
      0
    );
    console.log("Created project: ARCANE-RAPTURE");

    // 3. Create phases
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
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
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${phases.length} phases`);

    // 4. Create month pipeline nodes
    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const parentPhaseId = phaseIdMap.get(m.num) || phases[0]?.id || "ARCANE-RAPTURE";
      insertTask.run(
        m.id,
        m.title,
        "queued",
        "backlog",
        "pipeline",
        parentPhaseId,
        "arcane-rapture",
        m.startDate,
        m.endDate,
        null,
        null,
        null,
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${months.length} month pipelines`);

    // 5. Create all tasks
    const validIds = new Set(tasks.map((t) => t.id));
    let skippedDeps = 0;

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const deptColor = DEPT_COLORS[t.dept] || "#6B7280";
      let desc = t.dept || "";
      if (t.critical) desc = `\u26a0\ufe0f CRITICAL PATH \u2014 ${t.dept}`;
      else if (t.important) desc = `\u26a0 IMPORTANT \u2014 ${t.dept}`;

      insertTask.run(
        t.id,
        t.title,
        "queued",
        "backlog",
        "task",
        t.monthId,
        "arcane-rapture",
        t.scheduledDate,
        t.scheduledDate,
        deptColor,
        desc,
        t.scheduledDate,
        null,
        1,
        now,
        now,
        i + 1
      );
    }
    console.log(`Created ${tasks.length} tasks`);

    // 6. Create dependencies
    const insertDep = db.prepare(`
      INSERT INTO dependencies (source_id, target_id, type, created_at)
      VALUES (?, ?, 'finish_to_start', ?)
    `);

    let depInserted = 0;
    for (const t of tasks) {
      for (const depId of t.deps) {
        if (validIds.has(depId)) {
          insertDep.run(depId, t.id, now);
          depInserted++;
        } else {
          skippedDeps++;
        }
      }
    }
    console.log(`Created ${depInserted} dependencies`);
    if (skippedDeps > 0) {
      console.log(`Skipped ${skippedDeps} deps (unresolvable task IDs)`);
    }

    // 7. Summary
    const totalTasks = db
      .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project = 'arcane-rapture'`)
      .get();
    const totalDeps = db.prepare(`SELECT COUNT(*) as c FROM dependencies`).get();

    console.log("\n=== Import Complete ===");
    console.log(`Total arcane-rapture tasks in DB: ${totalTasks.c}`);
    console.log(`Total dependencies: ${totalDeps.c}`);
  });

  try {
    importAll();
  } catch (err) {
    console.error("Import failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }

  db.close();
}

main();
