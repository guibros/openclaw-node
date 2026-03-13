/**
 * mesh-tasks.js — Task schema and utilities for mesh task coordination.
 *
 * Defines the enriched task schema (budget, metric, on_fail) and
 * provides helpers for task state management in NATS KV.
 */

const { StringCodec } = require('nats');
const sc = StringCodec();

const KV_BUCKET = 'MESH_TASKS';

// ── Task Schema ─────────────────────────────────────

/**
 * Task statuses and their meaning:
 *   queued    — available for claiming
 *   claimed   — agent has claimed, not yet started work
 *   running   — agent is actively working
 *   completed — agent reports success (pending human review)
 *   failed    — agent reports failure or budget exceeded
 *   released  — automation exhausted all retries, needs human triage
 *   cancelled — manually cancelled
 */
const TASK_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RELEASED: 'released',
  CANCELLED: 'cancelled',
};

/**
 * Create a new task with the enriched schema.
 * Karpathy-inspired fields: budget_minutes, metric, on_fail, scope.
 */
function createTask({
  task_id,
  title,
  description = '',
  budget_minutes = 30,
  metric = null,
  on_fail = 'revert and log approach',
  success_criteria = [],
  scope = [],
  priority = 0,
  depends_on = [],
  tags = [],
}) {
  return {
    task_id,
    title,
    description,

    // Execution contract (Karpathy pattern)
    budget_minutes: parseInt(budget_minutes) || 30, // NaN → 30m default. Prevents silent safety bypass.
    metric,                   // mechanical success check (e.g. "tests pass", "val_bpb < 0.99")
    on_fail,                  // what to do on failure
    scope,                    // which files/paths the agent can touch

    // Standard fields
    success_criteria,
    priority,
    depends_on,
    tags,

    // State (managed by daemon)
    status: TASK_STATUS.QUEUED,
    owner: null,              // node_id that claimed it
    created_at: new Date().toISOString(),
    claimed_at: null,
    started_at: null,
    completed_at: null,
    budget_deadline: null,    // set when claimed: claimed_at + budget_minutes
    last_activity: null,      // updated by agent heartbeats — stall detection key

    // Result (filled by agent)
    result: null,             // { success, summary, artifacts, attempts }
    attempts: [],             // log of approaches tried
  };
}

// ── KV Helpers ──────────────────────────────────────

class TaskStore {
  constructor(kv) {
    this.kv = kv;
  }

  async put(task) {
    await this.kv.put(task.task_id, sc.encode(JSON.stringify(task)));
    return task;
  }

  async get(taskId, { withRevision = false } = {}) {
    const entry = await this.kv.get(taskId);
    if (!entry || !entry.value) return null;
    const task = JSON.parse(sc.decode(entry.value));
    if (withRevision) {
      return { task, revision: entry.revision };
    }
    return task;
  }

  async delete(taskId) {
    await this.kv.delete(taskId);
  }

  async list(filter = {}) {
    const tasks = [];

    // Collect keys first, then fetch — avoids NATS KV iterator interference
    const allKeys = [];
    const keys = await this.kv.keys();
    for await (const key of keys) {
      allKeys.push(key);
    }

    for (const key of allKeys) {
      const entry = await this.kv.get(key);
      if (!entry || !entry.value) continue;
      const task = JSON.parse(sc.decode(entry.value));

      // Apply filters
      if (filter.status && task.status !== filter.status) continue;
      if (filter.owner && task.owner !== filter.owner) continue;
      if (filter.tag && !task.tags.includes(filter.tag)) continue;

      tasks.push(task);
    }

    // Sort by priority (higher first), then created_at (older first)
    tasks.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    return tasks;
  }

  /**
   * Claim the highest-priority available task for a node.
   * Uses NATS KV revision-based CAS to prevent race conditions.
   * Returns the claimed task, or null if nothing available.
   */
  async claim(nodeId) {
    const available = await this.list({ status: TASK_STATUS.QUEUED });

    // Respect dependencies: only claim tasks whose deps are all completed
    for (const task of available) {
      if (task.depends_on.length > 0) {
        const depsReady = await this._checkDeps(task.depends_on);
        if (!depsReady) continue;
      }

      // Re-read with revision for CAS
      const result = await this.get(task.task_id, { withRevision: true });
      if (!result || result.task.status !== TASK_STATUS.QUEUED) continue;

      // Claim it
      result.task.status = TASK_STATUS.CLAIMED;
      result.task.owner = nodeId;
      result.task.claimed_at = new Date().toISOString();
      result.task.budget_deadline = new Date(
        Date.now() + result.task.budget_minutes * 60 * 1000
      ).toISOString();

      // Atomic CAS update — fails if another agent claimed it first
      try {
        await this.kv.update(
          task.task_id,
          sc.encode(JSON.stringify(result.task)),
          result.revision
        );
        return result.task;
      } catch (err) {
        // Revision mismatch — another agent got there first, try next task
        continue;
      }
    }

    return null;
  }

  /**
   * Mark a task as running (agent started work).
   */
  async markRunning(taskId) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.status = TASK_STATUS.RUNNING;
    task.started_at = new Date().toISOString();
    await this.put(task);
    return task;
  }

  /**
   * Mark a task as completed with result.
   */
  async markCompleted(taskId, result) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.status = TASK_STATUS.COMPLETED;
    task.completed_at = new Date().toISOString();
    task.result = result;
    await this.put(task);
    return task;
  }

  /**
   * Mark a task as failed with reason.
   */
  async markFailed(taskId, reason, attempts = []) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.status = TASK_STATUS.FAILED;
    task.completed_at = new Date().toISOString();
    task.result = { success: false, summary: reason };
    task.attempts = attempts;
    await this.put(task);
    return task;
  }

  /**
   * Log an attempt on a task (agent tried something, may or may not have worked).
   */
  async logAttempt(taskId, attempt) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.attempts.push({
      ...attempt,
      timestamp: new Date().toISOString(),
    });
    await this.put(task);
    return task;
  }

  /**
   * Mark a task as released — automation gave up, human must triage.
   * Distinct from failed: failed = "didn't work", released = "we tried everything."
   */
  async markReleased(taskId, reason, attempts = []) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.status = TASK_STATUS.RELEASED;
    task.completed_at = new Date().toISOString();
    task.result = { success: false, summary: reason, released: true };
    if (attempts.length > 0) task.attempts = attempts;
    await this.put(task);
    return task;
  }

  /**
   * Update last_activity timestamp (agent heartbeat).
   */
  async touchActivity(taskId) {
    const task = await this.get(taskId);
    if (!task) return null;
    task.last_activity = new Date().toISOString();
    await this.put(task);
    return task;
  }

  /**
   * Check if a task has exceeded its budget.
   */
  isOverBudget(task) {
    if (!task.budget_deadline) return false;
    return new Date() > new Date(task.budget_deadline);
  }

  /**
   * Find all running tasks that have exceeded their budget.
   */
  async findOverBudget() {
    const running = await this.list({ status: TASK_STATUS.RUNNING });
    const claimed = await this.list({ status: TASK_STATUS.CLAIMED });
    return [...running, ...claimed].filter(t => this.isOverBudget(t));
  }

  /**
   * Find running tasks with no activity for `stallMinutes`.
   * Stall detection is separate from budget — a task can be within budget
   * but the agent process may have died silently.
   */
  async findStalled(stallMinutes = 5) {
    const running = await this.list({ status: TASK_STATUS.RUNNING });
    const cutoff = Date.now() - stallMinutes * 60 * 1000;
    return running.filter(t => {
      const lastSignal = t.last_activity || t.started_at;
      return lastSignal && new Date(lastSignal) < cutoff;
    });
  }

  async _checkDeps(depIds) {
    for (const depId of depIds) {
      const dep = await this.get(depId);
      if (!dep || dep.status !== TASK_STATUS.COMPLETED) return false;
    }
    return true;
  }
}

module.exports = { createTask, TaskStore, TASK_STATUS, KV_BUCKET };
