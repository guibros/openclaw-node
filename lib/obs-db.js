/**
 * obs-db.js — Direct SQLite writer for observability events.
 *
 * Every daemon, every lib, every logger writes trace events directly to the
 * mission-control SQLite database. No NATS. No HTTP. No buffering. No bullshit.
 *
 * WAL mode allows concurrent readers (MC Next.js) + one writer at a time.
 * better-sqlite3 serializes writes automatically.
 *
 * Usage:
 *   const { insertEvent, insertEvents } = require('./obs-db');
 *   insertEvent({ module: 'mesh-agent', function: 'log.info', ... });
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Same DB path as mission-control uses
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const DB_PATH = process.env.OPENCLAW_OBS_DB || path.join(WORKSPACE, 'projects', 'mission-control', 'data', 'mission-control.db');

let _db = null;
let _insertStmt = null;
let _initFailed = false;

function getDb() {
  if (_db) return _db;
  if (_initFailed) return null;

  try {
    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const Database = require('better-sqlite3');
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000'); // wait up to 5s if another writer holds the lock

    // Ensure the table exists (idempotent)
    _db.exec(`
      CREATE TABLE IF NOT EXISTS observability_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        module TEXT NOT NULL,
        function TEXT NOT NULL,
        tier INTEGER NOT NULL DEFAULT 2,
        category TEXT NOT NULL,
        args_summary TEXT,
        result_summary TEXT,
        duration_ms INTEGER,
        error TEXT,
        meta TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Prepare the insert statement once
    _insertStmt = _db.prepare(`
      INSERT OR IGNORE INTO observability_events
        (id, timestamp, node_id, module, function, tier, category, args_summary, result_summary, duration_ms, error, meta)
      VALUES
        (@id, @timestamp, @node_id, @module, @function, @tier, @category, @args_summary, @result_summary, @duration_ms, @error, @meta)
    `);

    return _db;
  } catch (err) {
    // better-sqlite3 may not be installed in all environments
    _initFailed = true;
    console.warn(`[obs-db] Failed to open ${DB_PATH}: ${err.message}`);
    return null;
  }
}

/**
 * Insert a single trace event directly into SQLite.
 * Fire-and-forget — silently drops on failure.
 *
 * @param {object} event — trace event with snake_case fields (node_id, args_summary, etc.)
 */
function insertEvent(event) {
  if (!getDb()) return;
  try {
    _insertStmt.run({
      id: event.id || require('crypto').randomUUID(),
      timestamp: event.timestamp || Date.now(),
      node_id: event.node_id || os.hostname(),
      module: event.module || 'unknown',
      function: event.function || 'unknown',
      tier: event.tier || 2,
      category: event.category || 'lifecycle',
      args_summary: (event.args_summary || '').slice(0, 120),
      result_summary: (event.result_summary || '').slice(0, 80),
      duration_ms: event.duration_ms || 0,
      error: event.error || null,
      meta: event.meta ? (typeof event.meta === 'string' ? event.meta : JSON.stringify(event.meta)) : null,
    });
  } catch {
    // Silently drop — don't let observability break the actual work
  }
}

/**
 * Insert multiple events in a single transaction.
 */
function insertEvents(events) {
  if (!getDb() || !events.length) return;
  try {
    const txn = _db.transaction((batch) => {
      for (const event of batch) {
        insertEvent(event);
      }
    });
    txn(events);
  } catch {
    // Silently drop
  }
}

module.exports = { insertEvent, insertEvents, DB_PATH };
