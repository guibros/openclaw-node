#!/usr/bin/env node
/**
 * enrich-descriptions.js — Helper for bulk-enriching Arcane task descriptions.
 *
 * Usage:
 *   node scripts/enrich-descriptions.js list [--dept DEV]
 *   node scripts/enrich-descriptions.js update <id> <description>
 *   node scripts/enrich-descriptions.js batch-update < updates.jsonl
 *   node scripts/enrich-descriptions.js verify
 *
 * Commands:
 *   list         List tasks (optionally filtered by dept prefix)
 *   update       Update a single task's description
 *   batch-update Read JSONL from stdin: {"id":"...","desc":"..."} per line
 *   verify       Check enrichment coverage
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

const DB_PATH = path.join(__dirname, "..", "data", "mission-control.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const command = process.argv[2];
const args = process.argv.slice(3);

function getDept(id) {
  const m = id.match(/^([A-Z]+)-/);
  return m ? m[1] : null;
}

function listTasks() {
  const deptFlag = args.indexOf("--dept");
  const dept = deptFlag >= 0 ? args[deptFlag + 1] : null;

  let rows;
  if (dept) {
    rows = db
      .prepare(
        `SELECT id, title, description FROM tasks
         WHERE type = 'task' AND project = 'arcane-rapture' AND id LIKE ? || '-%'
         ORDER BY id`
      )
      .all(dept);
  } else {
    rows = db
      .prepare(
        `SELECT id, title, description FROM tasks
         WHERE type = 'task' AND project = 'arcane-rapture'
         ORDER BY id`
      )
      .all();
  }

  for (const row of rows) {
    const hasRich = row.description && row.description.includes("\n\n");
    console.log(
      JSON.stringify({
        id: row.id,
        title: row.title,
        currentDesc: row.description,
        enriched: hasRich,
      })
    );
  }
  console.error(`\nTotal: ${rows.length}, Enriched: ${rows.filter((r) => r.description && r.description.includes("\n\n")).length}`);
}

function updateOne() {
  const [id, ...descParts] = args;
  const desc = descParts.join(" ");
  if (!id || !desc) {
    console.error("Usage: update <id> <description>");
    process.exit(1);
  }

  // Get existing metadata line
  const row = db.prepare("SELECT description FROM tasks WHERE id = ?").get(id);
  if (!row) {
    console.error(`Task not found: ${id}`);
    process.exit(1);
  }

  const existing = row.description || "";
  const nlIdx = existing.indexOf("\n\n");
  const metaLine = nlIdx >= 0 ? existing.slice(0, nlIdx) : existing;
  const newDesc = metaLine ? `${metaLine}\n\n${desc}` : desc;

  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?").run(newDesc, now, id);
  console.log(`Updated: ${id}`);
}

async function batchUpdate() {
  const rl = readline.createInterface({ input: process.stdin });
  const updates = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const { id, desc } = JSON.parse(trimmed);
      if (id && desc) updates.push({ id, desc });
    } catch {
      console.error(`Skipping invalid line: ${trimmed.slice(0, 80)}`);
    }
  }

  const stmt = db.prepare("SELECT id, description FROM tasks WHERE id = ?");
  const update = db.prepare("UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?");
  const now = new Date().toISOString();

  const tx = db.transaction((entries) => {
    let count = 0;
    for (const { id, desc } of entries) {
      const row = stmt.get(id);
      if (!row) {
        console.error(`Not found: ${id}`);
        continue;
      }
      const existing = row.description || "";
      const nlIdx = existing.indexOf("\n\n");
      const metaLine = nlIdx >= 0 ? existing.slice(0, nlIdx) : existing;
      const newDesc = metaLine ? `${metaLine}\n\n${desc}` : desc;
      update.run(newDesc, now, id);
      count++;
    }
    return count;
  });

  const count = tx(updates);
  console.log(`Updated ${count} tasks`);
}

function verify() {
  const total = db
    .prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE type = 'task' AND project = 'arcane-rapture'"
    )
    .get().c;

  const enriched = db
    .prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE type = 'task' AND project = 'arcane-rapture' AND description LIKE '%' || char(10) || char(10) || '%'"
    )
    .get().c;

  const missing = db
    .prepare(
      `SELECT id, title FROM tasks
       WHERE type = 'task' AND project = 'arcane-rapture'
       AND (description NOT LIKE '%' || char(10) || char(10) || '%' OR description IS NULL)
       LIMIT 20`
    )
    .all();

  console.log(`Total: ${total}`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Missing: ${total - enriched}`);
  if (missing.length > 0) {
    console.log("\nSample missing:");
    for (const m of missing) {
      console.log(`  ${m.id}: ${m.title.slice(0, 60)}`);
    }
  }
}

// Main
async function main() {
  switch (command) {
    case "list":
      listTasks();
      break;
    case "update":
      updateOne();
      break;
    case "batch-update":
      await batchUpdate();
      break;
    case "verify":
      verify();
      break;
    default:
      console.error("Usage: enrich-descriptions.js <list|update|batch-update|verify> [args]");
      process.exit(1);
  }
  db.close();
}

main();
