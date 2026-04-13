/**
 * mesh-tasks.js — Task schema and utilities for mesh task coordination.
 *
 * Defines the enriched task schema (budget, metric, on_fail) and
 * provides helpers for task state management in NATS KV.
 */

const { StringCodec } = require('nats');
const { createTracer } = require('./tracer');
const sc = StringCodec();
const tracer = createTracer('mesh-tasks');

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
/**
 * Task statuses:
 *   queued         — available for claiming
 *   claimed        — agent has claimed, not yet started work
 *   running        — agent is actively working
 *   pending_review — work done, awaiting human approval (requires_review gate)
 *   completed      — agent reports success (or human approved)
 *   failed         — agent reports failure or budget exceeded
 *   released       — automation exhausted all retries, needs human triage
 *   cancelled      — manually cancelled
 */
const TASK_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  PENDING_REVIEW: 'pending_review',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RELEASED: 'released',
  CANCELLED: 'cancelled',
  PROPOSED: 'proposed',
  REJECTED: 'rejected',
};

const TERMINAL_STATES = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.RELEASED,
  TASK_STATUS.CANCELLED,
  TASK_STATUS.REJECTED,
]);

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
  collaboration = null,
  preferred_nodes = [],
  exclude_nodes = [],
  llm_provider = null,
  llm_model = null,
  plan_id = null,
  subtask_id = null,
  role = null,
  requires_review = null,     // null = auto-compute from mode + metric
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
    role,                     // role profile ID (e.g. "solidity-dev") for prompt injection + output validation
    requires_review,          // null = auto-computed by daemon; true/false = explicit override

    // Standard fields
    success_criteria,
    priority,
    depends_on,
    tags,

    // Node routing
    preferred_nodes,          // try these nodes first (ordered by preference)
    exclude_nodes,            // never assign to these nodes

    // LLM selection (null = use agent default)
    llm_provider,             // 'claude' | 'openai' | 'shell' | custom
    llm_model,                // model override (e.g. 'gpt-4.1', 'opus', 'sonnet')

    // N-node collaboration (null = solo task, backward compatible)
    // When set, mesh-task-daemon creates a collab session and N nodes
    // coordinate via rounds/reflections instead of single-agent execution.
    collaboration,            // { mode, min_nodes, max_nodes, join_window_s, max_rounds, convergence, scope_strategy }

    // State (managed by daemon)
    status: TASK_STATUS.QUEUED,
    owner: null,              // node_id that claimed it (solo) or first claimer (collab)
    created_at: new Date().toISOString(),
    claimed_at: null,
    started_at: null,
    completed_at: null,
    budget_deadline: null,    // set when claimed: claimed_at + budget_minutes
    last_activity: null,      // updated by agent heartbeats — stall detection key

    // Plan back-reference (O(1) lookup in checkPlanProgress)
    plan_id,                  // parent plan ID (null if standalone task)
    subtask_id,               // subtask ID within the plan (null if standalone task)

    // Result (filled by agent)
    result: null,             // { success, summary, artifacts, attempts }
    attempts: [],             // log of approaches tried
  };
}

// ── KV Helpers ──────────────────────────────────────

class TaskStore {
  constructor(kv) {
    this.kv = kv;
    tracer.wrapClass(this, [
      'put', 'get', 'delete', 'list',
      'claim', 'markRunning', 'markCompleted', 'markPendingReview',
      'markApproved', 'markRejected', 'markFailed', 'logAttempt',
      'markReleased', 'touchActivity', 'findStalled', 'findOverBudget'
    ], { tier: 1, category: 'state_transition' });
  }

  async put(task) {
    await this.kv.put(task.task_id, sc.encode(JSON.stringify(task)));
    return task;
  }

  async get(taskId) {
    const entry = await this.kv.get(taskId);
    if (!entry || !entry.value) return null;
    return JSON.parse(sc.decode(entry.value));
  }

  /**
   * Compare-and-swap helper: read → mutate → write with optimistic concurrency.
   * Re-reads and retries on conflict (up to maxRetries).
   * mutateFn receives the parsed data and must return the updated object, or falsy to skip.
   */
  async _updateWithCAS(key, mutateFn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const entry = await this.kv.get(key);
      if (!entry) return null;
      const data = JSON.parse(sc.decode(entry.value));
      const updated = mutateFn(data);
      if (!updated) return null;
      try {
        await this.kv.update(key, sc.encode(JSON.stringify(updated)), entry.revision);
        return updated;
      } catch (err) {
        const isCasConflict = err.code === '10071' || (err.message && err.message.includes('wrong last sequence'));
        if (!isCasConflict || attempt === maxRetries - 1) throw err;
        // CAS conflict — retry
      }
    }
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
      if (filter.tag && (!task.tags || !task.tags.includes(filter.tag))) continue;

      tasks.push(task);
    }

    // Sort by priority (higher first), then created_at (older first)
    tasks.sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return (new Date(a.created_at || 0)) - (new Date(b.created_at || 0));
    });

    return tasks;
  }

  /**
   * Claim the highest-priority available task for a node.
   * Respects exclude_nodes (hard block) and preferred_nodes (soft priority).
   * Returns the claimed task, or null if nothing available.
   */
  async claim(nodeId) {
    const available = await this.list({ status: TASK_STATUS.QUEUED });

    // Filter and sort: excluded tasks removed, preferred tasks first
    const claimable = [];
    for (const task of available) {
      // Hard exclusion
      if (task.exclude_nodes && task.exclude_nodes.includes(nodeId)) continue;

      // Respect dependencies
      if (task.depends_on && task.depends_on.length > 0) {
        const depsReady = await this._checkDeps(task.depends_on);
        if (!depsReady) continue;
      }

      claimable.push(task);
    }

    // Sort: preferred tasks for this node first, then by existing priority/date order
    claimable.sort((a, b) => {
      const aPreferred = a.preferred_nodes && a.preferred_nodes.includes(nodeId) ? 1 : 0;
      const bPreferred = b.preferred_nodes && b.preferred_nodes.includes(nodeId) ? 1 : 0;
      if (bPreferred !== aPreferred) return bPreferred - aPreferred;
      // Fall back to existing sort (priority desc, then created_at asc — already applied by list())
      return 0;
    });

    if (claimable.length === 0) return null;

    const task = claimable[0];
    const result = await this._updateWithCAS(task.task_id, (t) => {
      // Re-check status under CAS — another node may have claimed it
      if (t.status !== TASK_STATUS.QUEUED) return null;
      t.status = TASK_STATUS.CLAIMED;
      t.owner = nodeId;
      t.claimed_at = new Date().toISOString();
      const budgetMs = (t.budget_minutes || 30) * 60 * 1000;
      t.budget_deadline = new Date(Date.now() + budgetMs).toISOString();
      return t;
    });
    return result;
  }

  /**
   * Mark a task as running (agent started work).
   */
  async markRunning(taskId) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.RUNNING;
      task.started_at = new Date().toISOString();
      return task;
    });
  }

  /**
   * Mark a task as completed with result.
   */
  async markCompleted(taskId, result) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.COMPLETED;
      task.completed_at = new Date().toISOString();
      task.result = result;
      return task;
    });
  }

  /**
   * Mark a task as pending_review (work done, needs human approval).
   * Stores the result but doesn't transition to completed.
   */
  async markPendingReview(taskId, result) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.PENDING_REVIEW;
      task.result = result;
      task.review_requested_at = new Date().toISOString();
      return task;
    });
  }

  /**
   * Approve a pending_review task → completed.
   */
  async markApproved(taskId) {
    return this._updateWithCAS(taskId, (task) => {
      if (task.status !== TASK_STATUS.PENDING_REVIEW) return null;
      task.status = TASK_STATUS.COMPLETED;
      task.completed_at = new Date().toISOString();
      task.reviewed_by = 'human';
      return task;
    });
  }

  /**
   * Reject a pending_review task → re-queue with reason.
   */
  async markRejected(taskId, reason) {
    return this._updateWithCAS(taskId, (task) => {
      if (task.status !== TASK_STATUS.PENDING_REVIEW) return null;
      task.status = TASK_STATUS.QUEUED;
      task.rejection_reason = reason;
      task.result = null;
      task.review_requested_at = null;
      return task;
    });
  }

  /**
   * Mark a task as failed with reason.
   */
  async markFailed(taskId, reason, attempts = []) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.FAILED;
      task.completed_at = new Date().toISOString();
      task.result = { success: false, summary: reason };
      task.attempts = attempts;
      return task;
    });
  }

  /**
   * Log an attempt on a task (agent tried something, may or may not have worked).
   */
  async logAttempt(taskId, attempt) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.attempts.push({
        ...attempt,
        timestamp: new Date().toISOString(),
      });
      return task;
    });
  }

  /**
   * Mark a task as released — automation gave up, human must triage.
   * Distinct from failed: failed = "didn't work", released = "we tried everything."
   */
  async markReleased(taskId, reason, attempts = []) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.RELEASED;
      task.completed_at = new Date().toISOString();
      task.result = { success: false, summary: reason, released: true };
      if (attempts.length > 0) task.attempts = attempts;
      return task;
    });
  }

  /**
   * Update last_activity timestamp (agent heartbeat).
   */
  async touchActivity(taskId) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.last_activity = new Date().toISOString();
      return task;
    });
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
   * Find running or claimed tasks with no activity for `stallMinutes`.
   * Stall detection is separate from budget — a task can be within budget
   * but the agent process may have died silently.
   * Claimed tasks that never transition to running (agent crashed after claim)
   * are also detected and released back to queued.
   */
  async findStalled(stallMinutes = 5) {
    const running = await this.list({ status: TASK_STATUS.RUNNING });
    const claimed = await this.list({ status: TASK_STATUS.CLAIMED });
    const cutoff = Date.now() - stallMinutes * 60 * 1000;
    return [...running, ...claimed].filter(t => {
      const lastSignal = t.last_activity || t.started_at || t.claimed_at;
      return lastSignal && new Date(lastSignal) < cutoff;
    });
  }

  async _checkDeps(depIds) {
    const deps = await Promise.all(depIds.map(id => this.get(id)));
    return deps.every(dep => dep && dep.status === TASK_STATUS.COMPLETED);
  }
}

module.exports = { createTask, TaskStore, TASK_STATUS, KV_BUCKET };
