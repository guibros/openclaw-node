/**
 * mesh-tasks.js — Task schema and utilities for mesh task coordination.
 *
 * Defines the enriched task schema (budget, metric, on_fail) and
 * provides helpers for task state management in NATS KV.
 */

const { StringCodec } = require('nats');
const crypto = require('crypto');
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

// Reject → requeue cap. Override per daemon with MESH_MAX_REJECTIONS.
const DEFAULT_MAX_REJECTIONS = 3;

// Lease (review P4-5): a CLAIMED/RUNNING task is held under a lease that the
// owner renews with every heartbeat/attempt. A dead worker stops renewing,
// the lease expires, and the task is re-queued — before this, a killed
// worker's task sat CLAIMED until the 5-minute stall detector released it
// for human triage. The lease token is a FENCING token: the owner must
// present it on every mutation, so a worker that comes back after its task
// was re-claimed by someone else cannot complete/fail the new owner's run.
const DEFAULT_LEASE_MS = 3 * 60 * 1000;
const DEFAULT_MAX_LEASE_REQUEUES = 3;

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
  constructor(kv, { leaseMs = DEFAULT_LEASE_MS } = {}) {
    this.kv = kv;
    this.leaseMs = leaseMs;
    tracer.wrapClass(this, [
      'put', 'get', 'delete', 'list',
      'claim', 'markRunning', 'markCompleted', 'markPendingReview',
      'markApproved', 'markRejected', 'markFailed', 'logAttempt',
      'markReleased', 'touchActivity', 'findStalled', 'findOverBudget',
      'recordMerge', 'pruneTerminal', 'reapExpiredLeases'
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
      // New lease + new fencing token on every claim (a re-claim after expiry
      // invalidates whatever the previous holder still has).
      t.lease_token = crypto.randomBytes(16).toString('hex');
      t.lease_expires_at = new Date(Date.now() + this.leaseMs).toISOString();
      return t;
    });
    return result;
  }

  /** Owner-side fencing check: a task with a lease accepts only its current token. */
  static leaseMatches(task, token) {
    if (!task || !task.lease_token) return true; // pre-lease task (or terminal): nothing to fence
    return typeof token === 'string' && token === task.lease_token;
  }

  _renewLease(task) {
    if (task.lease_token) task.lease_expires_at = new Date(Date.now() + this.leaseMs).toISOString();
  }

  /**
   * Re-queue every CLAIMED/RUNNING task whose lease has expired. After
   * `maxRequeues` expiries the task is RELEASED for human triage instead —
   * a task that kills every worker it lands on must not circulate forever.
   * Returns { requeued: [...ids], released: [...ids] }.
   */
  async reapExpiredLeases({ now = Date.now(), maxRequeues = DEFAULT_MAX_LEASE_REQUEUES } = {}) {
    const live = [
      ...(await this.list({ status: TASK_STATUS.CLAIMED })),
      ...(await this.list({ status: TASK_STATUS.RUNNING })),
    ];
    const requeued = [];
    const released = [];
    for (const t of live) {
      if (!t.lease_expires_at || Date.parse(t.lease_expires_at) > now) continue;
      const updated = await this._updateWithCAS(t.task_id, (task) => {
        if (task.status !== TASK_STATUS.CLAIMED && task.status !== TASK_STATUS.RUNNING) return null;
        if (!task.lease_expires_at || Date.parse(task.lease_expires_at) > now) return null;
        const holder = task.owner || 'unknown';
        task.lease_requeues = (task.lease_requeues || 0) + 1;
        task.attempts = task.attempts || [];
        task.attempts.push({
          approach: `lease expired while held by ${holder}`,
          result: task.lease_requeues >= maxRequeues ? 'released for triage' : 'requeued',
          keep: false,
          timestamp: new Date(now).toISOString(),
        });
        task.last_activity = new Date(now).toISOString();
        if (task.lease_requeues >= maxRequeues) {
          task.status = TASK_STATUS.RELEASED;
          task.completed_at = new Date(now).toISOString();
          task.result = { success: false, summary: `Lease expired ${task.lease_requeues}× (last holder ${holder}) — released for triage`, released: true };
          return task;
        }
        task.status = TASK_STATUS.QUEUED;
        task.owner = null;
        task.claimed_at = null;
        task.started_at = null;
        task.lease_token = null;
        task.lease_expires_at = null;
        task.budget_deadline = null;
        return task;
      });
      if (!updated) continue;
      (updated.status === TASK_STATUS.RELEASED ? released : requeued).push(updated.task_id);
    }
    return { requeued, released };
  }

  /**
   * Mark a task as running (agent started work).
   */
  async markRunning(taskId) {
    return this._updateWithCAS(taskId, (task) => {
      if (TERMINAL_STATES.has(task.status)) return null;
      task.status = TASK_STATUS.RUNNING;
      task.started_at = new Date().toISOString();
      this._renewLease(task);
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
   *
   * Bounded (review P4-5): every reject used to re-queue forever, so one
   * reviewer could burn unlimited worker budget on a task nobody accepts.
   * After `maxRejections` the task terminates as FAILED instead; the caller
   * reads `task.status` to see which happened.
   */
  async markRejected(taskId, reason, { maxRejections = DEFAULT_MAX_REJECTIONS } = {}) {
    return this._updateWithCAS(taskId, (task) => {
      if (task.status !== TASK_STATUS.PENDING_REVIEW) return null;
      task.rejection_count = (task.rejection_count || 0) + 1;
      task.rejection_reason = reason;
      task.review_requested_at = null;
      if (task.rejection_count >= maxRejections) {
        task.status = TASK_STATUS.FAILED;
        task.completed_at = new Date().toISOString();
        task.result = { success: false, summary: `Rejected ${task.rejection_count}× (cap ${maxRejections}); last reason: ${reason}` };
        return task;
      }
      task.status = TASK_STATUS.QUEUED;
      task.result = null;
      return task;
    });
  }

  /**
   * Record the post-review merge outcome on an already-completed task.
   * Merge now happens AFTER approval (review P4-4), so the completion result
   * carries `merged: false` until the owning agent reports back here.
   */
  async recordMerge(taskId, merge) {
    return this._updateWithCAS(taskId, (task) => {
      if (task.status !== TASK_STATUS.COMPLETED) return null;
      task.result = { ...(task.result || {}), ...merge };
      task.merged_at = new Date().toISOString();
      return task;
    });
  }

  /**
   * Delete terminal tasks older than `maxAgeMs` (review P4-5: MESH_TASKS grew
   * without bound, and every list()/claim() scanned the whole bucket).
   * A terminal task still named in a live task's `depends_on` is kept —
   * _checkDeps treats a missing dependency as unmet, so pruning it would
   * strand the dependent forever. Returns the pruned task ids.
   */
  async pruneTerminal({ maxAgeMs, now = Date.now() } = {}) {
    if (!maxAgeMs || maxAgeMs <= 0) return [];
    const all = await this.list();
    const referenced = new Set();
    for (const t of all) {
      if (TERMINAL_STATES.has(t.status)) continue;
      for (const dep of t.depends_on || []) referenced.add(dep);
    }
    const cutoff = now - maxAgeMs;
    const pruned = [];
    for (const t of all) {
      if (!TERMINAL_STATES.has(t.status) || referenced.has(t.task_id)) continue;
      const stamp = Date.parse(t.completed_at || t.last_activity || t.created_at || '');
      if (!Number.isFinite(stamp) || stamp > cutoff) continue;
      await this.delete(t.task_id);
      pruned.push(t.task_id);
    }
    return pruned;
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
      this._renewLease(task);
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
      this._renewLease(task);
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

module.exports = { createTask, TaskStore, TASK_STATUS, TERMINAL_STATES, DEFAULT_MAX_REJECTIONS, DEFAULT_LEASE_MS, DEFAULT_MAX_LEASE_REQUEUES, KV_BUCKET };
