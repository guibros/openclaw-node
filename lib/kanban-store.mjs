/**
 * kanban-store.mjs — SQLite projection for kanban events observed via federation.
 *
 * Every kanban event received by the subscriber is projected into a local
 * `tasks_observed` table. Tasks owned by the local node get full projection
 * (all data fields stored); tasks owned by other nodes get summary projection
 * (task_id, owner, status only — no detailed data blob).
 *
 * Provenance columns (source_type, source_node, source_event_id) are included
 * from table creation — no migration needed (per Step 4.4 carry-forward).
 */

import { openStore } from './sqlite-store.mjs';
import path from 'path';
import os from 'os';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');

/**
 * Create a kanban store connected to the session database.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — path to SQLite database (default: ~/.openclaw/state.db)
 * @returns {object} kanban store API
 */
export function createKanbanStore(opts = {}) {
  const dbPath = opts.dbPath || DEFAULT_DB_PATH;
  const db = openStore(dbPath);

  // ── Schema ────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks_observed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      owner TEXT,
      title TEXT,
      status TEXT,
      priority TEXT,
      data_json TEXT,
      is_owned INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_observed_task_id ON tasks_observed(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_observed_owner ON tasks_observed(owner);
    CREATE INDEX IF NOT EXISTS idx_tasks_observed_status ON tasks_observed(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_observed_source_type ON tasks_observed(source_type);
    CREATE INDEX IF NOT EXISTS idx_tasks_observed_received_at ON tasks_observed(received_at DESC);
  `);

  // ── Prepared Statements ────────────────────────────────

  const insertFull = db.prepare(`
    INSERT INTO tasks_observed
      (task_id, event_type, owner, title, status, priority, data_json, is_owned, received_at,
       source_type, source_node, source_event_id)
    VALUES
      (@task_id, @event_type, @owner, @title, @status, @priority, @data_json, @is_owned, @received_at,
       @source_type, @source_node, @source_event_id)
  `);

  const insertSummary = db.prepare(`
    INSERT INTO tasks_observed
      (task_id, event_type, owner, title, status, priority, data_json, is_owned, received_at,
       source_type, source_node, source_event_id)
    VALUES
      (@task_id, @event_type, @owner, NULL, @status, NULL, NULL, 0, @received_at,
       @source_type, @source_node, @source_event_id)
  `);

  // ── Core API ────────────────────────────────

  /**
   * Project a kanban event into the tasks_observed table.
   *
   * Full projection when owner matches nodeId (all fields stored).
   * Summary projection when owner differs (task_id, owner, status only).
   *
   * @param {object} event - Kanban event from the shared stream
   * @param {string} nodeId - This node's identifier
   * @param {object} [provenance] - { source_type, source_node, source_event_id }
   */
  function projectKanbanEvent(event, nodeId, provenance) {
    const now = new Date().toISOString();
    const data = event.data || {};
    const taskId = data.task_id || event.entity_id || event.event_id || 'unknown';
    const owner = data.owner || null;
    const eventType = event.event_type || 'unknown';
    const prov = provenance || { source_type: 'local', source_node: null, source_event_id: null };

    const isOwned = owner === nodeId ? 1 : 0;

    if (isOwned) {
      // Full projection — store all available fields
      insertFull.run({
        task_id: taskId,
        event_type: eventType,
        owner,
        title: data.title || null,
        status: data.status || null,
        priority: data.priority || null,
        data_json: JSON.stringify(data),
        is_owned: 1,
        received_at: now,
        source_type: prov.source_type,
        source_node: prov.source_node,
        source_event_id: prov.source_event_id,
      });
    } else {
      // Summary projection — task_id, owner, status only
      insertSummary.run({
        task_id: taskId,
        event_type: eventType,
        owner,
        status: data.status || null,
        received_at: now,
        source_type: prov.source_type,
        source_node: prov.source_node,
        source_event_id: prov.source_event_id,
      });
    }
  }

  /**
   * Query observed tasks with optional filters.
   *
   * @param {object} [filters]
   * @param {boolean} [filters.ownedOnly] - Only return tasks owned by this node
   * @param {string} [filters.status] - Filter by task status
   * @param {string} [filters.sourceType] - Filter by source_type ('local' or 'shared')
   * @param {number} [filters.limit] - Maximum number of results (default: 100)
   * @returns {Array<object>} task observation rows
   */
  function getObservedTasks(filters = {}) {
    const conditions = [];
    const params = {};

    if (filters.ownedOnly) {
      conditions.push('is_owned = 1');
    }
    if (filters.status) {
      conditions.push('status = @status');
      params.status = filters.status;
    }
    if (filters.sourceType) {
      conditions.push('source_type = @sourceType');
      params.sourceType = filters.sourceType;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;

    return db.prepare(`
      SELECT * FROM tasks_observed
      ${where}
      ORDER BY received_at DESC
      LIMIT ${limit}
    `).all(params);
  }

  /**
   * Get the latest observation for a specific task.
   *
   * @param {string} taskId - Task identifier
   * @returns {object|undefined} latest task observation row, or undefined if not found
   */
  function getTaskById(taskId) {
    return db.prepare(`
      SELECT * FROM tasks_observed
      WHERE task_id = ?
      ORDER BY received_at DESC
      LIMIT 1
    `).get(taskId);
  }

  /**
   * Get kanban store statistics.
   *
   * @returns {{ total: number, owned: number, summary: number, localCount: number, sharedCount: number }}
   */
  function getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM tasks_observed').get();
    const owned = db.prepare('SELECT COUNT(*) as count FROM tasks_observed WHERE is_owned = 1').get();
    const summary = db.prepare('SELECT COUNT(*) as count FROM tasks_observed WHERE is_owned = 0').get();
    const local = db.prepare("SELECT COUNT(*) as count FROM tasks_observed WHERE source_type = 'local'").get();
    const shared = db.prepare("SELECT COUNT(*) as count FROM tasks_observed WHERE source_type = 'shared'").get();

    return {
      total: total.count,
      owned: owned.count,
      summary: summary.count,
      localCount: local.count,
      sharedCount: shared.count,
    };
  }

  /**
   * Close the database connection.
   */
  function close() {
    db.close();
  }

  return {
    projectKanbanEvent,
    getObservedTasks,
    getTaskById,
    getStats,
    close,
    get dbPath() { return dbPath; },
  };
}
