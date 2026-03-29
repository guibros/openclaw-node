/**
 * kanban-io.js — Read/write active-tasks.md for the mesh bridge.
 *
 * Standalone parser (no Mission Control dependency).
 * Handles in-place field updates to avoid clobbering concurrent writers.
 *
 * ARCHITECTURE NOTE — SHELF LIFE:
 * This module uses flock() for write safety across 2-3 local processes
 * (mesh-bridge, memory-daemon, Mission Control). flock() is a LOCAL file lock —
 * it does NOT work across machines. When multi-node writes become necessary
 * (e.g., remote agents updating task state), active-tasks.md as the kanban
 * backing store must be replaced with a shared-state layer (cr-sqlite / JetStream KV).
 * That migration is Phase 3 in the original architecture plan.
 * Do NOT add more writers to this file. If you need a new writer, that's the signal
 * to migrate to the shared-state layer instead.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ACTIVE_TASKS_PATH = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'memory', 'active-tasks.md'
);
// ── File Locking ─────────────────────────────────────
// mkdir-based mutual exclusion for read-modify-write cycles.
// mkdir is atomic on POSIX — it either succeeds or fails, no partial state.
// Prevents lost updates when mesh-bridge and memory-daemon write concurrently.
// See architecture note above for why this is local-only.

function withMkdirLock(filePath, fn) {
  const lockDir = filePath + '.lk';
  const maxWait = 5000; // 5s max wait
  const start = Date.now();

  // Acquire: mkdir is atomic on POSIX
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break; // got the lock
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Lock held by another process — check for stale lock (>30s)
      try {
        const lockAge = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (lockAge > 30000) {
          // Stale lock — previous holder crashed
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch { /* stat failed, lock was just released */ continue; }

      if (Date.now() - start > maxWait) {
        throw new Error(`kanban-io: lock timeout after ${maxWait}ms on ${filePath}`);
      }
      // Sleep ~10ms — Atomics.wait is precise but throws on main thread
      // in some Node.js builds; fall back to busy-spin (rare contention path)
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      } catch {
        const end = Date.now() + 10;
        while (Date.now() < end) { /* busy-wait fallback */ }
      }
    }
  }

  try {
    return fn();
  } finally {
    try { fs.rmdirSync(lockDir); } catch { /* already released */ }
  }
}

// ── Parser ──────────────────────────────────────────

/**
 * Parse active-tasks.md into task objects.
 * Only reads the "## Live Tasks" section.
 */
function readTasks(filePath = ACTIVE_TASKS_PATH) {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseTasks(content);
}

function parseTasks(content) {
  const tasks = [];
  const liveIdx = content.indexOf('## Live Tasks');
  if (liveIdx === -1) return tasks;

  const liveSection = content.slice(liveIdx);
  const lines = liveSection.split('\n');

  let current = null;
  let currentArrayKey = null;

  function flush() {
    if (current && current.task_id) {
      tasks.push({
        task_id: current.task_id,
        title: current.title || '',
        status: current.status || 'queued',
        owner: current.owner || null,
        success_criteria: current.success_criteria || [],
        artifacts: current.artifacts || [],
        next_action: current.next_action || null,
        description: current.description || null,
        needs_approval: current.needs_approval !== false, // default true
        auto_priority: current.auto_priority || 0,
        project: current.project || null,
        parent_id: current.parent_id || null,
        // Mesh-specific fields
        execution: current.execution || null,
        metric: current.metric || null,
        budget_minutes: current.budget_minutes || 30,
        scope: current.scope || [],
        updated_at: current.updated_at || '',
        // Mesh routing
        llm_provider: current.llm_provider || null,
        llm_model: current.llm_model || null,
        preferred_nodes: current.preferred_nodes || [],
        exclude_nodes: current.exclude_nodes || [],
        collaboration: current.collaboration || null,
        collab_result: current.collab_result || null,
      });
    }
  }

  for (const line of lines) {
    // New task block
    const taskIdMatch = line.match(/^- task_id:\s*(.+)$/);
    if (taskIdMatch) {
      flush();
      current = { task_id: taskIdMatch[1].trim(), success_criteria: [], artifacts: [], scope: [], preferred_nodes: [], exclude_nodes: [] };
      currentArrayKey = null;
      continue;
    }

    if (!current) continue;

    // Array item: 4-space indent + dash
    const arrayItemMatch = line.match(/^    - (.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      current[currentArrayKey].push(arrayItemMatch[1].trim());
      continue;
    }

    // Field: 2-space indent
    const fieldMatch = line.match(/^  (\w[\w_]*):\s*(.*)$/);
    if (fieldMatch) {
      const [, key, rawValue] = fieldMatch;
      const value = rawValue.trim();

      switch (key) {
        case 'title': current.title = value; currentArrayKey = null; break;
        case 'status': current.status = value; currentArrayKey = null; break;
        case 'owner': current.owner = value || null; currentArrayKey = null; break;
        case 'next_action': current.next_action = value || null; currentArrayKey = null; break;
        case 'project': current.project = value || null; currentArrayKey = null; break;
        case 'parent_id': current.parent_id = value || null; currentArrayKey = null; break;
        case 'auto_priority': current.auto_priority = parseInt(value, 10) || 0; currentArrayKey = null; break;
        case 'updated_at': current.updated_at = value; currentArrayKey = null; break;
        case 'description':
          current.description = value ? value.replace(/\\n/g, '\n') : null;
          currentArrayKey = null;
          break;
        case 'needs_approval':
          current.needs_approval = value === 'true' || value === '1';
          currentArrayKey = null;
          break;
        // Mesh fields
        case 'execution': current.execution = value || null; currentArrayKey = null; break;
        case 'metric': current.metric = value || null; currentArrayKey = null; break;
        case 'budget_minutes':
          current.budget_minutes = parseInt(value, 10) || 30;
          currentArrayKey = null;
          break;
        // Array fields
        case 'success_criteria':
          current.success_criteria = [];
          currentArrayKey = 'success_criteria';
          break;
        case 'artifacts':
          current.artifacts = [];
          currentArrayKey = 'artifacts';
          break;
        case 'scope':
          current.scope = [];
          currentArrayKey = 'scope';
          break;
        // Mesh routing fields
        case 'llm_provider':
        case 'provider':
          current.llm_provider = value || null; currentArrayKey = null; break;
        case 'llm_model':
        case 'model':
          current.llm_model = value || null; currentArrayKey = null; break;
        case 'preferred_nodes':
          current.preferred_nodes = [];
          currentArrayKey = 'preferred_nodes';
          break;
        case 'exclude_nodes':
          current.exclude_nodes = [];
          currentArrayKey = 'exclude_nodes';
          break;
        case 'collaboration':
          try { current.collaboration = value ? JSON.parse(value) : null; }
          catch { current.collaboration = null; }
          currentArrayKey = null;
          break;
        case 'collab_result':
          try { current.collab_result = value ? JSON.parse(value) : null; }
          catch { current.collab_result = null; }
          currentArrayKey = null;
          break;
        // Circling Strategy display fields
        case 'circling_phase': current.circling_phase = value || null; currentArrayKey = null; break;
        case 'circling_subround': current.circling_subround = parseInt(value, 10) || 0; currentArrayKey = null; break;
        case 'circling_step': current.circling_step = parseInt(value, 10) || 0; currentArrayKey = null; break;
        case 'circling_nodes':
          try { current.circling_nodes = value ? JSON.parse(value) : null; }
          catch { current.circling_nodes = null; }
          currentArrayKey = null;
          break;
        default:
          currentArrayKey = null;
          break;
      }
      continue;
    }

    if (line.trim() === '') {
      currentArrayKey = null;
    }
  }

  flush();
  return tasks;
}

// ── In-Place Updater ────────────────────────────────

/**
 * Update specific fields of a task in active-tasks.md without re-serializing the whole file.
 * Finds the task block by task_id, modifies/adds fields, writes atomically.
 *
 * fieldUpdates: { status: 'waiting-user', owner: 'mesh-agent', ... }
 * arrayUpdates: { artifacts: ['path/to/log'], success_criteria: ['Step 1 PASS'] }
 *   - Arrays are APPENDED to existing values, not replaced
 * arrayReplace: { success_criteria: ['new list'] }
 *   - Arrays are REPLACED entirely
 */
function updateTaskInPlace(filePath, taskId, fieldUpdates = {}, arrayAppend = {}, arrayReplace = {}) {
  return withMkdirLock(filePath, () => _updateTaskInPlaceUnsafe(filePath, taskId, fieldUpdates, arrayAppend, arrayReplace));
}

function _updateTaskInPlaceUnsafe(filePath, taskId, fieldUpdates = {}, arrayAppend = {}, arrayReplace = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find task block boundaries
  let blockStart = -1;
  let blockEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^- task_id:\s*(.+)$/);
    if (match) {
      if (match[1].trim() === taskId) {
        blockStart = i;
      } else if (blockStart >= 0) {
        blockEnd = i;
        break;
      }
    }
  }

  if (blockStart === -1) {
    throw new Error(`Task ${taskId} not found in ${filePath}`);
  }

  // Extract the block
  const blockLines = lines.slice(blockStart, blockEnd);

  // Update scalar fields
  for (const [key, rawValue] of Object.entries(fieldUpdates)) {
    // Serialize objects/arrays as JSON so the parser can read them back
    const value = (rawValue !== null && typeof rawValue === 'object')
      ? JSON.stringify(rawValue)
      : rawValue;
    const fieldRegex = new RegExp(`^  ${key}:\\s*.*$`);
    let found = false;
    for (let i = 1; i < blockLines.length; i++) {
      if (fieldRegex.test(blockLines[i])) {
        blockLines[i] = `  ${key}: ${value}`;
        found = true;
        break;
      }
    }
    if (!found) {
      // Insert before updated_at if it exists, otherwise at end of block
      const updatedAtIdx = blockLines.findIndex(l => l.match(/^  updated_at:/));
      const insertIdx = updatedAtIdx > 0 ? updatedAtIdx : blockLines.length;
      blockLines.splice(insertIdx, 0, `  ${key}: ${value}`);
    }
  }

  // Replace arrays entirely
  for (const [key, items] of Object.entries(arrayReplace)) {
    const headerRegex = new RegExp(`^  ${key}:`);
    let headerIdx = blockLines.findIndex(l => headerRegex.test(l));

    if (headerIdx === -1) {
      // Insert the array before updated_at
      const updatedAtIdx = blockLines.findIndex(l => l.match(/^  updated_at:/));
      const insertIdx = updatedAtIdx > 0 ? updatedAtIdx : blockLines.length;
      const newLines = [`  ${key}:`];
      for (const item of items) {
        newLines.push(`    - ${item}`);
      }
      blockLines.splice(insertIdx, 0, ...newLines);
    } else {
      // Remove existing array items
      let endIdx = headerIdx + 1;
      while (endIdx < blockLines.length && blockLines[endIdx].match(/^    - /)) {
        endIdx++;
      }
      const newLines = [`  ${key}:`];
      for (const item of items) {
        newLines.push(`    - ${item}`);
      }
      blockLines.splice(headerIdx, endIdx - headerIdx, ...newLines);
    }
  }

  // Append to arrays
  for (const [key, items] of Object.entries(arrayAppend)) {
    const headerRegex = new RegExp(`^  ${key}:`);
    let headerIdx = blockLines.findIndex(l => headerRegex.test(l));

    if (headerIdx === -1) {
      // Insert the array before updated_at
      const updatedAtIdx = blockLines.findIndex(l => l.match(/^  updated_at:/));
      const insertIdx = updatedAtIdx > 0 ? updatedAtIdx : blockLines.length;
      const newLines = [`  ${key}:`];
      for (const item of items) {
        newLines.push(`    - ${item}`);
      }
      blockLines.splice(insertIdx, 0, ...newLines);
    } else {
      // Find end of existing array items
      let endIdx = headerIdx + 1;
      while (endIdx < blockLines.length && blockLines[endIdx].match(/^    - /)) {
        endIdx++;
      }
      // Append new items
      const newLines = [];
      for (const item of items) {
        newLines.push(`    - ${item}`);
      }
      blockLines.splice(endIdx, 0, ...newLines);
    }
  }

  // Reassemble
  const newLines = [
    ...lines.slice(0, blockStart),
    ...blockLines,
    ...lines.slice(blockEnd),
  ];

  // Atomic write
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, newLines.join('\n'));
  fs.renameSync(tmpPath, filePath);
}

// ── Timestamp Helper ────────────────────────────────

function montrealTimestamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(',', '') + ' America/Montreal';
}

function isoTimestamp() {
  return new Date().toISOString();
}

module.exports = {
  readTasks,
  parseTasks,
  updateTaskInPlace,
  montrealTimestamp,
  isoTimestamp,
  ACTIVE_TASKS_PATH,
};
