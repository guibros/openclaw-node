/**
 * mesh-plans.js — Plan decomposition and delegation routing for mesh tasks.
 *
 * A plan decomposes a parent task into subtasks with delegation routing
 * (solo_mesh, collab_mesh, local, soul, human), dependency waves, and
 * execution contracts. Plans are stored in MESH_PLANS JetStream KV bucket.
 *
 * Lifecycle: draft → review → approved → executing → completed | aborted
 */

const { StringCodec } = require('nats');
const sc = StringCodec();

const PLANS_KV_BUCKET = 'MESH_PLANS';

// ── Plan Statuses ──────────────────────────────────

const PLAN_STATUS = {
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
};

// ── Subtask Statuses ───────────────────────────────

const SUBTASK_STATUS = {
  PENDING: 'pending',           // not yet dispatched (waiting for wave)
  QUEUED: 'queued',             // dispatched to queue
  RUNNING: 'running',           // actively being worked
  PENDING_REVIEW: 'pending_review', // work done, awaiting human approval
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
};

// ── Delegation Modes ───────────────────────────────

const PLAN_TRANSITIONS = {
  approve: new Set(['review', 'draft']),
  startExecuting: new Set(['approved']),
  markCompleted: new Set(['executing']),
  markAborted: new Set(['draft', 'review', 'approved', 'executing']),
};

const DELEGATION_MODE = {
  SOLO_MESH: 'solo_mesh',
  COLLAB_MESH: 'collab_mesh',
  LOCAL: 'local',
  SOUL: 'soul',
  HUMAN: 'human',
};

// ── High-Criticality Detection ─────────────────────

const HIGH_CRIT_PATHS = ['contracts/', 'auth/', 'payments/', 'migration/'];
const HIGH_CRIT_KEYWORDS = [
  'security', 'audit', 'authentication', 'payment',
  'migration', 'selfdestruct', 'upgrade', 'proxy',
];

// ── Soul Routing Guide (from DELEGATION.md) ────────

const SOUL_ROUTING = {
  'smart-contract': 'blockchain-auditor',
  'narrative':      'lore-writer',
  'lore':           'lore-writer',
  'cicd':           'infra-ops',
  'deployment':     'infra-ops',
  'monitoring':     'infra-ops',
  'identity':       'identity-architect',
  'sbt':            'identity-architect',
  'trust':          'identity-architect',
};

// ── Plan Factory ───────────────────────────────────

/**
 * Create a new plan from a parent task.
 *
 * @param {string} parentTaskId — the task being decomposed
 * @param {object} opts — plan metadata
 * @param {Array} subtaskSpecs — array of subtask definitions
 */
function createPlan({
  parent_task_id,
  title,
  description = '',
  planner = 'daedalus',
  planner_soul = null,
  requires_approval = true,
  failure_policy = 'continue_best_effort',  // 'continue_best_effort' | 'abort_on_first_fail' | 'abort_on_critical_fail'
  subtasks = [],
}) {
  const planId = `PLAN-${parent_task_id}-${Date.now()}`;

  // Compute waves from dependency graph
  const enriched = subtasks.map((st, idx) => {
    const subtaskId = st.subtask_id || `${planId}-S${String(idx + 1).padStart(2, '0')}`;
    return {
      subtask_id: subtaskId,
      title: st.title || '',
      description: st.description || '',

      delegation: st.delegation || {
        mode: DELEGATION_MODE.LOCAL,
        soul_id: null,
        collaboration: null,
        reason: 'default fallback',
      },

      budget_minutes: parseInt(st.budget_minutes) || 15,
      // Track who set the budget estimate and how (for audit/debugging routing decisions)
      budget_source: st.budget_source || 'planner_estimate',  // 'planner_estimate' | 'user_override' | 'metric_based'
      metric: st.metric || null,
      scope: st.scope || [],
      success_criteria: st.success_criteria || [],

      critical: st.critical || false, // critical subtask failure can abort plan (abort_on_critical_fail policy)

      depends_on: st.depends_on || [],
      wave: 0, // computed below

      status: SUBTASK_STATUS.PENDING,
      mesh_task_id: null,
      kanban_task_id: null,
      owner: null,
      result: null,
    };
  });

  // Compute wave assignments
  assignWaves(enriched);

  // Mark cycle-blocked subtasks (wave === -1) so they don't prevent plan completion
  for (const st of enriched) {
    if (st.wave === -1 && st.status === 'pending') st.status = 'blocked';
  }

  const totalBudget = enriched.reduce((sum, st) => sum + st.budget_minutes, 0);
  const maxWave = enriched.reduce((max, st) => Math.max(max, st.wave), 0);

  return {
    plan_id: planId,
    parent_task_id,
    title,
    description,

    status: PLAN_STATUS.DRAFT,

    planner,
    planner_soul,

    subtasks: enriched,

    total_budget_minutes: totalBudget,
    estimated_waves: maxWave + 1,

    failure_policy,
    requires_approval,
    approved_by: null,
    approved_at: null,

    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
  };
}

// ── Wave Computation ───────────────────────────────

/**
 * Assign wave numbers to subtasks based on dependency DAG.
 * Mutates subtasks in place. Same algorithm as MC's computeWaves.
 */
function assignWaves(subtasks) {
  const idMap = new Map(subtasks.map(st => [st.subtask_id, st]));

  // BFS topological layers
  const inDegree = new Map();
  const successors = new Map();

  for (const st of subtasks) {
    inDegree.set(st.subtask_id, 0);
    successors.set(st.subtask_id, []);
  }

  for (const st of subtasks) {
    for (const depId of st.depends_on) {
      if (idMap.has(depId)) {
        inDegree.set(st.subtask_id, (inDegree.get(st.subtask_id) || 0) + 1);
        const succs = successors.get(depId) || [];
        succs.push(st.subtask_id);
        successors.set(depId, succs);
      }
    }
  }

  let wave = 0;
  let currentWave = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) currentWave.push(id);
  }

  while (currentWave.length > 0) {
    for (const id of currentWave) {
      idMap.get(id).wave = wave;
    }

    const nextWave = [];
    for (const id of currentWave) {
      for (const succ of successors.get(id) || []) {
        const newDeg = (inDegree.get(succ) || 1) - 1;
        inDegree.set(succ, newDeg);
        if (newDeg === 0) nextWave.push(succ);
      }
    }

    wave++;
    currentWave = nextWave;
  }

  // Detect cycles: any node with remaining in-degree > 0 is in a cycle
  for (const [taskId, degree] of inDegree.entries()) {
    if (degree > 0) {
      const subtask = idMap.get(taskId);
      if (subtask) subtask.wave = -1; // blocked by cycle
    }
  }
}

// ── Delegation Decision Tree ───────────────────────

/**
 * Route a subtask to the appropriate delegation mode.
 * Returns a delegation object: { mode, soul_id, collaboration, reason }.
 */
function routeDelegation(subtask) {
  const title = (subtask.title || '').toLowerCase();
  const desc = (subtask.description || '').toLowerCase();
  const scope = subtask.scope || [];
  const combined = `${title} ${desc}`;

  // 1. Is it trivial? (< 2 min, indicated by budget)
  // NOTE: budget_minutes is typically a planner estimate (Claude's guess during decomposition).
  // This gate is only as reliable as the estimate. budget_source tracks provenance.
  if (subtask.budget_minutes && subtask.budget_minutes <= 2) {
    return {
      mode: DELEGATION_MODE.LOCAL,
      soul_id: null,
      collaboration: null,
      reason: `Trivial task (budget=${subtask.budget_minutes}min, source=${subtask.budget_source || 'planner_estimate'}), Daedalus inline`,
    };
  }

  // 2. Does it require human judgment?
  if (combined.includes('approve') || combined.includes('decision') ||
      combined.includes('choose between') || combined.includes('user input')) {
    return {
      mode: DELEGATION_MODE.HUMAN,
      soul_id: null,
      collaboration: null,
      reason: 'Requires human judgment or approval',
    };
  }

  // 3. Does it match a specialist soul domain?
  for (const [keyword, soulId] of Object.entries(SOUL_ROUTING)) {
    if (combined.includes(keyword)) {
      return {
        mode: DELEGATION_MODE.SOUL,
        soul_id: soulId,
        collaboration: null,
        reason: `Domain match: "${keyword}" → ${soulId}`,
      };
    }
  }

  // 4. Is it high-criticality? → collab_mesh with review mode
  const isHighCrit = HIGH_CRIT_PATHS.some(p => scope.some(s => s.includes(p)))
    || HIGH_CRIT_KEYWORDS.some(kw => combined.includes(kw));

  if (isHighCrit) {
    return {
      mode: DELEGATION_MODE.COLLAB_MESH,
      soul_id: null,
      collaboration: {
        mode: 'review',
        min_nodes: 2,
        max_nodes: 3,
        join_window_s: 30,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'leader_only',
      },
      reason: 'High-criticality path detected, N-node review mode',
    };
  }

  // 5. Does it have broad scope? → collab_mesh parallel
  if (scope.length > 3) {
    return {
      mode: DELEGATION_MODE.COLLAB_MESH,
      soul_id: null,
      collaboration: {
        mode: 'parallel',
        min_nodes: 2,
        max_nodes: null,
        join_window_s: 30,
        max_rounds: 5,
        convergence: { type: 'majority', threshold: 0.66 },
        scope_strategy: 'partitioned',
      },
      reason: 'Broad scope (>3 paths), parallel collab',
    };
  }

  // 6. Mechanically verifiable? → solo_mesh
  if (subtask.metric) {
    return {
      mode: DELEGATION_MODE.SOLO_MESH,
      soul_id: null,
      collaboration: null,
      reason: 'Has mechanical metric, solo mesh agent',
    };
  }

  // 7. Default → local (safest fallback)
  return {
    mode: DELEGATION_MODE.LOCAL,
    soul_id: null,
    collaboration: null,
    reason: 'Default fallback, Daedalus local execution',
  };
}

/**
 * Auto-route all subtasks in a plan that don't already have delegation set.
 * Mutates subtasks in place. Each routing decision is logged to the subtask's
 * delegation.reason field for inspection via `mesh plan show`.
 */
function autoRoutePlan(plan, { log } = {}) {
  const logger = log || (() => {});
  for (const st of plan.subtasks) {
    if (!st.delegation || !st.delegation.mode || st.delegation.mode === 'auto') {
      st.delegation = routeDelegation(st);
      logger(`AUTO-ROUTE ${st.subtask_id} → ${st.delegation.mode}: ${st.delegation.reason}`);
    }
  }
  return plan;
}

// ── PlanStore (KV-backed) ──────────────────────────

class PlanStore {
  constructor(kv) {
    this.kv = kv;
  }

  async put(plan) {
    await this.kv.put(plan.plan_id, sc.encode(JSON.stringify(plan)));
    return plan;
  }

  async get(planId) {
    const entry = await this.kv.get(planId);
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
        await this.kv.put(key, sc.encode(JSON.stringify(updated)), { previousSeq: entry.revision });
        return updated;
      } catch (err) {
        if (attempt === maxRetries - 1) throw err;
        // conflict — retry
      }
    }
  }

  async delete(planId) {
    await this.kv.delete(planId);
  }

  async list(filter = {}) {
    const plans = [];
    const allKeys = [];
    const keys = await this.kv.keys();
    for await (const key of keys) {
      allKeys.push(key);
    }

    for (const key of allKeys) {
      const entry = await this.kv.get(key);
      if (!entry || !entry.value) continue;
      const plan = JSON.parse(sc.decode(entry.value));

      if (filter.status && plan.status !== filter.status) continue;
      if (filter.parent_task_id && plan.parent_task_id !== filter.parent_task_id) continue;

      plans.push(plan);
    }

    plans.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return plans;
  }

  /**
   * Find plan by parent task ID.
   */
  async findByParentTask(parentTaskId) {
    const plans = await this.list({ parent_task_id: parentTaskId });
    return plans[0] || null;
  }

  // ── Lifecycle ───────────────────────────────────

  async submitForReview(planId) {
    return this._updateWithCAS(planId, (plan) => {
      if (plan.status !== 'draft') return null;
      plan.status = PLAN_STATUS.REVIEW;
      return plan;
    });
  }

  async approve(planId, approvedBy = 'gui') {
    return this._updateWithCAS(planId, (plan) => {
      if (!PLAN_TRANSITIONS.approve.has(plan.status)) return null;
      plan.status = PLAN_STATUS.APPROVED;
      plan.approved_by = approvedBy;
      plan.approved_at = new Date().toISOString();
      return plan;
    });
  }

  async startExecuting(planId) {
    return this._updateWithCAS(planId, (plan) => {
      if (!PLAN_TRANSITIONS.startExecuting.has(plan.status)) return null;
      plan.status = PLAN_STATUS.EXECUTING;
      plan.started_at = new Date().toISOString();
      return plan;
    });
  }

  async markCompleted(planId) {
    return this._updateWithCAS(planId, (plan) => {
      if (!PLAN_TRANSITIONS.markCompleted.has(plan.status)) return null;
      plan.status = PLAN_STATUS.COMPLETED;
      plan.completed_at = new Date().toISOString();
      return plan;
    });
  }

  async markAborted(planId, reason) {
    return this._updateWithCAS(planId, (plan) => {
      if (!PLAN_TRANSITIONS.markAborted.has(plan.status)) return null;
      plan.status = PLAN_STATUS.ABORTED;
      plan.completed_at = new Date().toISOString();
      for (const st of plan.subtasks) {
        if (st.status === SUBTASK_STATUS.PENDING || st.status === SUBTASK_STATUS.QUEUED) {
          st.status = SUBTASK_STATUS.BLOCKED;
          st.result = { success: false, summary: `Plan aborted: ${reason}` };
        }
      }
      return plan;
    });
  }

  // ── Subtask Management ──────────────────────────

  async updateSubtask(planId, subtaskId, updates) {
    return this._updateWithCAS(planId, (plan) => {
      const st = plan.subtasks.find(s => s.subtask_id === subtaskId);
      if (!st) return null;
      Object.assign(st, updates);
      return plan;
    });
  }

  /**
   * Get subtasks ready for the next wave.
   * Returns subtasks whose dependencies are all completed and status is pending.
   */
  getNextWaveSubtasks(plan) {
    if (plan.status !== PLAN_STATUS.EXECUTING) return [];

    const completedIds = new Set(
      plan.subtasks
        .filter(st => st.status === SUBTASK_STATUS.COMPLETED)
        .map(st => st.subtask_id)
    );

    return plan.subtasks.filter(st => {
      if (st.status !== SUBTASK_STATUS.PENDING) return false;
      return st.depends_on.every(depId => completedIds.has(depId));
    });
  }

  /**
   * Check if a plan is fully completed (all subtasks done or failed).
   */
  isPlanComplete(plan) {
    return plan.subtasks.every(
      st => st.status === SUBTASK_STATUS.COMPLETED ||
            st.status === SUBTASK_STATUS.FAILED ||
            st.status === SUBTASK_STATUS.BLOCKED
    );
  }

  /**
   * Check if a plan has any failed subtasks (needs attention).
   */
  hasFailures(plan) {
    return plan.subtasks.some(st => st.status === SUBTASK_STATUS.FAILED);
  }

  /**
   * Get plan summary for reporting.
   */
  getSummary(plan) {
    const byStatus = {};
    for (const st of plan.subtasks) {
      byStatus[st.status] = (byStatus[st.status] || 0) + 1;
    }

    const byMode = {};
    for (const st of plan.subtasks) {
      const mode = st.delegation?.mode || 'unknown';
      byMode[mode] = (byMode[mode] || 0) + 1;
    }

    return {
      plan_id: plan.plan_id,
      parent_task_id: plan.parent_task_id,
      title: plan.title,
      status: plan.status,
      total_subtasks: plan.subtasks.length,
      subtask_status: byStatus,
      delegation_modes: byMode,
      estimated_waves: plan.estimated_waves,
      total_budget_minutes: plan.total_budget_minutes,
      duration_ms: plan.completed_at
        ? new Date(plan.completed_at) - new Date(plan.created_at)
        : Date.now() - new Date(plan.created_at),
    };
  }
}

module.exports = {
  createPlan,
  assignWaves,
  routeDelegation,
  autoRoutePlan,
  PlanStore,
  PLAN_STATUS,
  SUBTASK_STATUS,
  DELEGATION_MODE,
  PLANS_KV_BUCKET,
};
