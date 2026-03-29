import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { DB_PATH } from "../config";
import fs, { chmodSync, existsSync } from "fs";
import path from "path";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      kanban_column TEXT NOT NULL,
      owner TEXT,
      success_criteria TEXT,
      artifacts TEXT,
      next_action TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS memory_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      category TEXT,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT,
      date TEXT,
      frontmatter TEXT,
      content TEXT NOT NULL,
      modified_at TEXT,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      task_id TEXT,
      description TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      title,
      content,
      category,
      source,
      content='memory_docs',
      content_rowid='id'
    );
  `);

  // Create triggers for FTS sync (idempotent via IF NOT EXISTS workaround)
  const triggerExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name='memory_docs_ai'"
    )
    .get();

  if (!triggerExists) {
    sqlite.exec(`
      CREATE TRIGGER memory_docs_ai AFTER INSERT ON memory_docs BEGIN
        INSERT INTO memory_fts(rowid, title, content, category, source)
        VALUES (new.id, new.title, new.content, new.category, new.source);
      END;

      CREATE TRIGGER memory_docs_ad AFTER DELETE ON memory_docs BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, category, source)
        VALUES ('delete', old.id, old.title, old.content, old.category, old.source);
      END;

      CREATE TRIGGER memory_docs_au AFTER UPDATE ON memory_docs BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, category, source)
        VALUES ('delete', old.id, old.title, old.content, old.category, old.source);
        INSERT INTO memory_fts(rowid, title, content, category, source)
        VALUES (new.id, new.title, new.content, new.category, new.source);
      END;
    `);
  }

  // Soul-related tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS soul_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      from_soul TEXT NOT NULL,
      to_soul TEXT NOT NULL,
      reason TEXT,
      context_path TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      soul_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      commit_hash TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_spawns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      soul_id TEXT NOT NULL,
      task_id TEXT,
      subagent_type TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add soul columns to tasks if missing
  const taskCols = sqlite.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const colNames = taskCols.map((c) => c.name);
  if (!colNames.includes("soul_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN soul_id TEXT");
  }
  if (!colNames.includes("handoff_source")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN handoff_source TEXT");
  }
  if (!colNames.includes("handoff_reason")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN handoff_reason TEXT");
  }
  if (!colNames.includes("scheduled_date")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN scheduled_date TEXT");
  }
  if (!colNames.includes("project")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN project TEXT");
  }

  // Hierarchy columns
  if (!colNames.includes("type")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'task'");
  }
  if (!colNames.includes("parent_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN parent_id TEXT");
  }
  if (!colNames.includes("start_date")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN start_date TEXT");
  }
  if (!colNames.includes("end_date")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN end_date TEXT");
  }
  if (!colNames.includes("color")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN color TEXT");
  }
  if (!colNames.includes("description")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN description TEXT");
  }

  // Scheduling columns (replaces auto_start*)
  if (!colNames.includes("needs_approval")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN needs_approval INTEGER DEFAULT 1");
  }
  if (!colNames.includes("trigger_kind")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN trigger_kind TEXT DEFAULT 'none'");
  }
  if (!colNames.includes("trigger_at")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN trigger_at TEXT");
  }
  if (!colNames.includes("trigger_cron")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN trigger_cron TEXT");
  }
  if (!colNames.includes("trigger_tz")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN trigger_tz TEXT DEFAULT 'America/Montreal'");
  }
  if (!colNames.includes("is_recurring")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN is_recurring INTEGER DEFAULT 0");
  }
  if (!colNames.includes("capacity_class")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN capacity_class TEXT DEFAULT 'normal'");
  }
  if (!colNames.includes("auto_priority")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN auto_priority INTEGER DEFAULT 0");
  }
  if (!colNames.includes("show_in_calendar")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN show_in_calendar INTEGER DEFAULT 0");
  }
  // FIX: acknowledged_at was in schema.ts but missing from migrations —
  // existing DBs would crash on any read/write touching this column.
  if (!colNames.includes("acknowledged_at")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN acknowledged_at TEXT");
  }

  // Mesh execution columns (synced from active-tasks.md via kanban-io)
  if (!colNames.includes("execution")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN execution TEXT");
  }
  if (!colNames.includes("metric")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN metric TEXT");
  }
  if (!colNames.includes("budget_minutes")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN budget_minutes INTEGER DEFAULT 30");
  }
  if (!colNames.includes("scope")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN scope TEXT");
  }

  // Mesh node tracking — links MC tasks to NATS KV tasks and claiming nodes
  if (!colNames.includes("mesh_task_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN mesh_task_id TEXT");
  }
  if (!colNames.includes("mesh_node")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN mesh_node TEXT");
  }

  // Data migration: convert old auto_start columns to new scheduling schema
  if (colNames.includes("auto_start")) {
    sqlite.exec(`
      UPDATE tasks SET
        needs_approval = CASE WHEN auto_start = 1 THEN 0 ELSE 1 END,
        trigger_kind = CASE
          WHEN auto_start = 1 AND auto_start_after IS NOT NULL THEN 'at'
          WHEN auto_start = 1 THEN 'none'
          ELSE 'none'
        END,
        trigger_at = auto_start_after
      WHERE auto_start IS NOT NULL AND needs_approval IS NULL
    `);
  }

  // Dependencies table (DAG edges)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'finish_to_start',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Indexes for hierarchy and dependency lookups
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
    CREATE INDEX IF NOT EXISTS idx_deps_source ON dependencies(source_id);
    CREATE INDEX IF NOT EXISTS idx_deps_target ON dependencies(target_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_trigger_kind ON tasks(trigger_kind);
    CREATE INDEX IF NOT EXISTS idx_tasks_needs_approval ON tasks(needs_approval);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_kanban_column ON tasks(kanban_column);
  `);

  // Memory items table (extracted atomic facts)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_text TEXT NOT NULL,
      confidence INTEGER DEFAULT 70,
      source_doc_id INTEGER,
      category TEXT,
      status TEXT DEFAULT 'active',
      gate_decision TEXT,
      gate_reason TEXT,
      extraction_source TEXT,
      last_accessed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      item_id INTEGER,
      detail TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_category ON memory_items(category);
    CREATE INDEX IF NOT EXISTS idx_items_status ON memory_items(status);
    CREATE INDEX IF NOT EXISTS idx_items_source ON memory_items(source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_audit_operation ON memory_audit(operation);
  `);

  // FTS5 index for memory items (fact-level search)
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
      fact_text,
      category,
      content='memory_items',
      content_rowid='id'
    );
  `);

  // FTS triggers for memory items
  const itemTriggerExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name='memory_items_ai'"
    )
    .get();

  if (!itemTriggerExists) {
    sqlite.exec(`
      CREATE TRIGGER memory_items_ai AFTER INSERT ON memory_items BEGIN
        INSERT INTO memory_items_fts(rowid, fact_text, category)
        VALUES (new.id, new.fact_text, new.category);
      END;

      CREATE TRIGGER memory_items_ad AFTER DELETE ON memory_items BEGIN
        INSERT INTO memory_items_fts(memory_items_fts, rowid, fact_text, category)
        VALUES ('delete', old.id, old.fact_text, old.category);
      END;

      CREATE TRIGGER memory_items_au AFTER UPDATE ON memory_items BEGIN
        INSERT INTO memory_items_fts(memory_items_fts, rowid, fact_text, category)
        VALUES ('delete', old.id, old.fact_text, old.category);
        INSERT INTO memory_items_fts(rowid, fact_text, category)
        VALUES (new.id, new.fact_text, new.category);
      END;
    `);
  }

  // --- Knowledge Graph tables ---
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      aliases TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      access_count INTEGER DEFAULT 1,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      confidence INTEGER DEFAULT 80,
      source_item_id INTEGER,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      valid_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_entity_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_name ON memory_entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON memory_entities(type);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON memory_relations(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
    CREATE INDEX IF NOT EXISTS idx_entity_items_entity ON memory_entity_items(entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_items_item ON memory_entity_items(item_id);
  `);

  // --- Temporal columns on memory_items ---
  const itemCols = sqlite.prepare("PRAGMA table_info(memory_items)").all() as { name: string }[];
  const itemColNames = itemCols.map((c) => c.name);
  if (!itemColNames.includes("superseded_by")) {
    sqlite.exec("ALTER TABLE memory_items ADD COLUMN superseded_by INTEGER");
  }
  if (!itemColNames.includes("valid_from")) {
    sqlite.exec("ALTER TABLE memory_items ADD COLUMN valid_from TEXT DEFAULT (datetime('now'))");
  }
  if (!itemColNames.includes("valid_to")) {
    sqlite.exec("ALTER TABLE memory_items ADD COLUMN valid_to TEXT");
  }

  // Add cross-soul propagation columns to soul_evolution_log if missing
  const evolCols = sqlite.prepare("PRAGMA table_info(soul_evolution_log)").all() as { name: string }[];
  const evolColNames = evolCols.map((c) => c.name);
  if (!evolColNames.includes("source_soul_id")) {
    sqlite.exec("ALTER TABLE soul_evolution_log ADD COLUMN source_soul_id TEXT");
  }
  if (!evolColNames.includes("source_event_id")) {
    sqlite.exec("ALTER TABLE soul_evolution_log ADD COLUMN source_event_id TEXT");
  }

  // --- Token usage tracking (mesh agent cost data) ---
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      node_id TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_node ON token_usage(node_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(timestamp);
  `);

  // --- Cowork: Clusters ---
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      default_mode TEXT DEFAULT 'parallel',
      default_convergence TEXT DEFAULT 'unanimous',
      convergence_threshold INTEGER DEFAULT 66,
      max_rounds INTEGER DEFAULT 5,
      status TEXT DEFAULT 'active',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cluster_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cluster_id, node_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
    CREATE INDEX IF NOT EXISTS idx_cluster_members_node ON cluster_members(node_id);
  `);

  // Migrate cluster_members: add created_at if missing (old table had joined_at)
  const cmCols = sqlite.prepare("PRAGMA table_info(cluster_members)").all() as Array<{ name: string }>;
  const cmColNames = cmCols.map((c) => c.name);
  if (!cmColNames.includes("created_at")) {
    sqlite.exec("ALTER TABLE cluster_members ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    if (cmColNames.includes("joined_at")) {
      sqlite.exec("UPDATE cluster_members SET created_at = joined_at WHERE joined_at IS NOT NULL");
    }
  }

  // Normalize: set execution='local' for pre-existing rows where it's NULL
  sqlite.exec("UPDATE tasks SET execution = 'local' WHERE execution IS NULL");

  // Add cluster_id to tasks if missing
  if (!colNames.includes("cluster_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN cluster_id TEXT");
  }

  // --- Distributed MC: mesh sync tracking columns ---
  if (!colNames.includes("mesh_revision")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN mesh_revision INTEGER");
  }
  if (!colNames.includes("mesh_synced_at")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN mesh_synced_at TEXT");
  }
  if (!colNames.includes("mesh_origin")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN mesh_origin TEXT");
  }

  // Collab routing columns — bridge reads these from markdown to build NATS payload
  if (!colNames.includes("collaboration")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN collaboration TEXT");
  }
  if (!colNames.includes("preferred_nodes")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN preferred_nodes TEXT");
  }
  if (!colNames.includes("exclude_nodes")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN exclude_nodes TEXT");
  }
}

export function getDb() {
  if (_db) return _db;

  ensureDataDir();

  _sqlite = new Database(DB_PATH);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");

  runMigrations(_sqlite);

  // Lock down DB file permissions — owner read/write only
  try {
    if (existsSync(DB_PATH)) {
      chmodSync(DB_PATH, 0o600);
    }
    const walPath = DB_PATH + "-wal";
    if (existsSync(walPath)) {
      chmodSync(walPath, 0o600);
    }
    const journalPath = DB_PATH + "-journal";
    if (existsSync(journalPath)) {
      chmodSync(journalPath, 0o600);
    }
  } catch {}

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getRawDb(): Database.Database {
  if (!_sqlite) getDb();
  return _sqlite!;
}
