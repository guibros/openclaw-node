-- Add soul tracking columns to tasks table
ALTER TABLE tasks ADD COLUMN soul_id TEXT;
ALTER TABLE tasks ADD COLUMN handoff_source TEXT;
ALTER TABLE tasks ADD COLUMN handoff_reason TEXT;

-- Create soul_handoffs table
CREATE TABLE IF NOT EXISTS soul_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  task_id TEXT NOT NULL,
  from_soul TEXT NOT NULL,
  to_soul TEXT NOT NULL,
  reason TEXT,
  context_path TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create soul_evolution_log table
CREATE TABLE IF NOT EXISTS soul_evolution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
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
