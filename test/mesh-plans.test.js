#!/usr/bin/env node

/**
 * mesh-plans.test.js — Unit tests for lib/mesh-plans.js
 *
 * Covers: createPlan defaults, assignWaves DAG, routeDelegation decision tree,
 * autoRoutePlan, PlanStore lifecycle + subtask management.
 *
 * Run: node --test test/mesh-plans.test.js
 */

// ── Mock 'nats' before any require ──
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlan,
  assignWaves,
  routeDelegation,
  autoRoutePlan,
  PlanStore,
  PLAN_STATUS,
  SUBTASK_STATUS,
  DELEGATION_MODE,
} = require('../lib/mesh-plans');

// ── MockKV ──
class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return { next() { return Promise.resolve(iter.next()); } };
      },
    };
  }
}

// ── createPlan ──

describe('createPlan', () => {
  it('creates plan with correct defaults', () => {
    const plan = createPlan({
      parent_task_id: 'T-001',
      title: 'Test plan',
    });
    assert.ok(plan.plan_id.startsWith('PLAN-T-001-'));
    assert.equal(plan.status, PLAN_STATUS.DRAFT);
    assert.equal(plan.parent_task_id, 'T-001');
    assert.equal(plan.title, 'Test plan');
    assert.equal(plan.planner, 'daedalus');
    assert.equal(plan.requires_approval, true);
    assert.equal(plan.failure_policy, 'continue_best_effort');
    assert.equal(plan.subtasks.length, 0);
    assert.equal(plan.total_budget_minutes, 0);
    assert.equal(plan.estimated_waves, 1);
    assert.ok(plan.created_at);
    assert.equal(plan.approved_by, null);
    assert.equal(plan.started_at, null);
  });

  it('enriches subtasks with defaults', () => {
    const plan = createPlan({
      parent_task_id: 'T-002',
      title: 'With subtasks',
      subtasks: [
        { title: 'Do thing A' },
        { title: 'Do thing B', budget_minutes: 30, metric: 'tests pass' },
      ],
    });
    assert.equal(plan.subtasks.length, 2);

    const s1 = plan.subtasks[0];
    assert.ok(s1.subtask_id.includes('-S01'));
    assert.equal(s1.budget_minutes, 15); // default
    assert.equal(s1.status, SUBTASK_STATUS.PENDING);
    assert.deepEqual(s1.depends_on, []);
    assert.equal(s1.delegation.mode, DELEGATION_MODE.LOCAL);

    const s2 = plan.subtasks[1];
    assert.equal(s2.budget_minutes, 30);
    assert.equal(s2.metric, 'tests pass');
  });

  it('computes total budget from subtasks', () => {
    const plan = createPlan({
      parent_task_id: 'T-003',
      title: 'Budget test',
      subtasks: [
        { title: 'A', budget_minutes: 10 },
        { title: 'B', budget_minutes: 20 },
        { title: 'C', budget_minutes: 5 },
      ],
    });
    assert.equal(plan.total_budget_minutes, 35);
  });

  it('handles NaN budget_minutes gracefully', () => {
    const plan = createPlan({
      parent_task_id: 'T-004',
      title: 'NaN budget',
      subtasks: [{ title: 'A', budget_minutes: 'not-a-number' }],
    });
    assert.equal(plan.subtasks[0].budget_minutes, 15); // parseInt fallback
  });
});

// ── assignWaves ──

describe('assignWaves', () => {
  it('assigns wave 0 to independent tasks', () => {
    const subtasks = [
      { subtask_id: 'A', depends_on: [] },
      { subtask_id: 'B', depends_on: [] },
    ];
    assignWaves(subtasks);
    assert.equal(subtasks[0].wave, 0);
    assert.equal(subtasks[1].wave, 0);
  });

  it('assigns sequential waves for linear dependencies', () => {
    const subtasks = [
      { subtask_id: 'A', depends_on: [] },
      { subtask_id: 'B', depends_on: ['A'] },
      { subtask_id: 'C', depends_on: ['B'] },
    ];
    assignWaves(subtasks);
    assert.equal(subtasks[0].wave, 0);
    assert.equal(subtasks[1].wave, 1);
    assert.equal(subtasks[2].wave, 2);
  });

  it('assigns same wave to parallel subtasks after shared dependency', () => {
    const subtasks = [
      { subtask_id: 'A', depends_on: [] },
      { subtask_id: 'B', depends_on: ['A'] },
      { subtask_id: 'C', depends_on: ['A'] },
      { subtask_id: 'D', depends_on: ['B', 'C'] },
    ];
    assignWaves(subtasks);
    assert.equal(subtasks[0].wave, 0); // A
    assert.equal(subtasks[1].wave, 1); // B
    assert.equal(subtasks[2].wave, 1); // C (parallel with B)
    assert.equal(subtasks[3].wave, 2); // D (after both B and C)
  });

  it('ignores unknown dependency IDs', () => {
    const subtasks = [
      { subtask_id: 'A', depends_on: ['NONEXISTENT'] },
    ];
    assignWaves(subtasks);
    assert.equal(subtasks[0].wave, 0);
  });
});

// ── routeDelegation ──

describe('routeDelegation', () => {
  it('routes trivial tasks locally (budget <= 2)', () => {
    const result = routeDelegation({ title: 'Fix typo', budget_minutes: 1 });
    assert.equal(result.mode, DELEGATION_MODE.LOCAL);
    assert.ok(result.reason.includes('Trivial'));
  });

  it('routes human-judgment tasks to HUMAN', () => {
    const result = routeDelegation({ title: 'Approve the contract changes', budget_minutes: 10 });
    assert.equal(result.mode, DELEGATION_MODE.HUMAN);
  });

  it('routes decision-required tasks to HUMAN', () => {
    const result = routeDelegation({ title: 'Choose between API options', budget_minutes: 10 });
    assert.equal(result.mode, DELEGATION_MODE.HUMAN);
  });

  it('routes specialist domain to SOUL', () => {
    const result = routeDelegation({ title: 'Write smart-contract tests', budget_minutes: 30 });
    assert.equal(result.mode, DELEGATION_MODE.SOUL);
    assert.equal(result.soul_id, 'blockchain-auditor');
  });

  it('routes lore tasks to lore-writer soul', () => {
    const result = routeDelegation({ title: 'Update faction lore', budget_minutes: 20 });
    assert.equal(result.mode, DELEGATION_MODE.SOUL);
    assert.equal(result.soul_id, 'lore-writer');
  });

  it('routes deployment tasks to infra-ops soul', () => {
    const result = routeDelegation({ title: 'Fix CICD pipeline', budget_minutes: 20 });
    assert.equal(result.mode, DELEGATION_MODE.SOUL);
    assert.equal(result.soul_id, 'infra-ops');
  });

  it('routes high-criticality paths to COLLAB_MESH review', () => {
    const result = routeDelegation({
      title: 'Update module',
      budget_minutes: 30,
      scope: ['contracts/Token.sol'],
    });
    assert.equal(result.mode, DELEGATION_MODE.COLLAB_MESH);
    assert.equal(result.collaboration.mode, 'review');
    assert.equal(result.collaboration.convergence.type, 'unanimous');
  });

  it('routes high-crit keywords to COLLAB_MESH review', () => {
    const result = routeDelegation({
      title: 'Security audit of auth layer',
      budget_minutes: 60,
      scope: ['src/auth/'],
    });
    assert.equal(result.mode, DELEGATION_MODE.COLLAB_MESH);
  });

  it('routes broad scope (>3 paths) to COLLAB_MESH parallel', () => {
    const result = routeDelegation({
      title: 'Refactor utils',
      budget_minutes: 30,
      scope: ['src/a/', 'src/b/', 'src/c/', 'src/d/'],
    });
    assert.equal(result.mode, DELEGATION_MODE.COLLAB_MESH);
    assert.equal(result.collaboration.mode, 'parallel');
    assert.equal(result.collaboration.convergence.type, 'majority');
  });

  it('routes mechanically verifiable to SOLO_MESH', () => {
    const result = routeDelegation({
      title: 'Add logging module',
      budget_minutes: 15,
      metric: 'all tests pass',
      scope: ['src/logging/'],
    });
    assert.equal(result.mode, DELEGATION_MODE.SOLO_MESH);
  });

  it('falls back to LOCAL for generic tasks', () => {
    const result = routeDelegation({
      title: 'Update readme',
      budget_minutes: 10,
    });
    assert.equal(result.mode, DELEGATION_MODE.LOCAL);
    assert.ok(result.reason.includes('Default fallback'));
  });
});

// ── autoRoutePlan ─��

describe('autoRoutePlan', () => {
  it('routes unset delegations', () => {
    const plan = createPlan({
      parent_task_id: 'T-010',
      title: 'Auto route test',
      subtasks: [
        { title: 'Fix typo', budget_minutes: 1 },
        { title: 'Write smart-contract audit', budget_minutes: 60 },
      ],
    });
    // Reset delegations to auto
    plan.subtasks[0].delegation = { mode: 'auto' };
    plan.subtasks[1].delegation = { mode: 'auto' };

    const logs = [];
    autoRoutePlan(plan, { log: (msg) => logs.push(msg) });

    assert.equal(plan.subtasks[0].delegation.mode, DELEGATION_MODE.LOCAL);
    assert.equal(plan.subtasks[1].delegation.mode, DELEGATION_MODE.SOUL);
    assert.equal(logs.length, 2);
  });

  it('skips already-routed subtasks', () => {
    const plan = createPlan({
      parent_task_id: 'T-011',
      title: 'Skip routed',
      subtasks: [{ title: 'Already routed', budget_minutes: 10 }],
    });
    plan.subtasks[0].delegation = { mode: DELEGATION_MODE.HUMAN, reason: 'manually set' };

    autoRoutePlan(plan);
    assert.equal(plan.subtasks[0].delegation.mode, DELEGATION_MODE.HUMAN);
    assert.equal(plan.subtasks[0].delegation.reason, 'manually set');
  });
});

// ── PlanStore ──

describe('PlanStore', () => {
  it('put and get round-trip', async () => {
    const store = new PlanStore(new MockKV());
    const plan = createPlan({ parent_task_id: 'T-100', title: 'Stored plan' });
    await store.put(plan);
    const retrieved = await store.get(plan.plan_id);
    assert.equal(retrieved.title, 'Stored plan');
    assert.equal(retrieved.parent_task_id, 'T-100');
  });

  it('get returns null for missing plan', async () => {
    const store = new PlanStore(new MockKV());
    const result = await store.get('nonexistent');
    assert.equal(result, null);
  });

  it('delete removes plan', async () => {
    const store = new PlanStore(new MockKV());
    const plan = createPlan({ parent_task_id: 'T-101', title: 'Delete me' });
    await store.put(plan);
    await store.delete(plan.plan_id);
    assert.equal(await store.get(plan.plan_id), null);
  });

  it('list returns all plans sorted by created_at', async () => {
    const store = new PlanStore(new MockKV());
    const p1 = createPlan({ parent_task_id: 'T-A', title: 'First' });
    const p2 = createPlan({ parent_task_id: 'T-B', title: 'Second' });
    await store.put(p1);
    await store.put(p2);
    const all = await store.list();
    assert.equal(all.length, 2);
  });

  it('list filters by status', async () => {
    const store = new PlanStore(new MockKV());
    const p1 = createPlan({ parent_task_id: 'T-C', title: 'Draft plan' });
    const p2 = createPlan({ parent_task_id: 'T-D', title: 'Approved plan' });
    p2.status = PLAN_STATUS.APPROVED;
    await store.put(p1);
    await store.put(p2);
    const drafts = await store.list({ status: PLAN_STATUS.DRAFT });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].title, 'Draft plan');
  });

  it('lifecycle: draft → review → approved → executing → completed', async () => {
    const store = new PlanStore(new MockKV());
    const plan = createPlan({ parent_task_id: 'T-200', title: 'Lifecycle' });
    await store.put(plan);

    await store.submitForReview(plan.plan_id);
    let p = await store.get(plan.plan_id);
    assert.equal(p.status, PLAN_STATUS.REVIEW);

    await store.approve(plan.plan_id, 'gui');
    p = await store.get(plan.plan_id);
    assert.equal(p.status, PLAN_STATUS.APPROVED);
    assert.equal(p.approved_by, 'gui');
    assert.ok(p.approved_at);

    await store.startExecuting(plan.plan_id);
    p = await store.get(plan.plan_id);
    assert.equal(p.status, PLAN_STATUS.EXECUTING);
    assert.ok(p.started_at);

    await store.markCompleted(plan.plan_id);
    p = await store.get(plan.plan_id);
    assert.equal(p.status, PLAN_STATUS.COMPLETED);
    assert.ok(p.completed_at);
  });

  it('abort blocks pending subtasks', async () => {
    const store = new PlanStore(new MockKV());
    const plan = createPlan({
      parent_task_id: 'T-201',
      title: 'Abort test',
      subtasks: [
        { title: 'Done', budget_minutes: 5 },
        { title: 'Pending', budget_minutes: 5 },
        { title: 'Queued', budget_minutes: 5 },
      ],
    });
    plan.subtasks[0].status = SUBTASK_STATUS.COMPLETED;
    plan.subtasks[2].status = SUBTASK_STATUS.QUEUED;
    await store.put(plan);

    await store.markAborted(plan.plan_id, 'critical failure');
    const p = await store.get(plan.plan_id);
    assert.equal(p.status, PLAN_STATUS.ABORTED);
    assert.equal(p.subtasks[0].status, SUBTASK_STATUS.COMPLETED); // unchanged
    assert.equal(p.subtasks[1].status, SUBTASK_STATUS.BLOCKED);
    assert.equal(p.subtasks[2].status, SUBTASK_STATUS.BLOCKED);
  });

  it('getNextWaveSubtasks returns ready subtasks', () => {
    const store = new PlanStore(new MockKV());
    const plan = {
      status: PLAN_STATUS.EXECUTING,
      subtasks: [
        { subtask_id: 'A', status: SUBTASK_STATUS.COMPLETED, depends_on: [] },
        { subtask_id: 'B', status: SUBTASK_STATUS.PENDING, depends_on: ['A'] },
        { subtask_id: 'C', status: SUBTASK_STATUS.PENDING, depends_on: ['A', 'B'] },
      ],
    };
    const ready = store.getNextWaveSubtasks(plan);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].subtask_id, 'B');
  });

  it('getNextWaveSubtasks returns empty for non-executing plans', () => {
    const store = new PlanStore(new MockKV());
    const plan = {
      status: PLAN_STATUS.DRAFT,
      subtasks: [{ subtask_id: 'A', status: SUBTASK_STATUS.PENDING, depends_on: [] }],
    };
    assert.equal(store.getNextWaveSubtasks(plan).length, 0);
  });

  it('isPlanComplete detects all-terminal subtasks', () => {
    const store = new PlanStore(new MockKV());
    assert.equal(store.isPlanComplete({
      subtasks: [
        { status: SUBTASK_STATUS.COMPLETED },
        { status: SUBTASK_STATUS.FAILED },
        { status: SUBTASK_STATUS.BLOCKED },
      ],
    }), true);
    assert.equal(store.isPlanComplete({
      subtasks: [
        { status: SUBTASK_STATUS.COMPLETED },
        { status: SUBTASK_STATUS.RUNNING },
      ],
    }), false);
  });

  it('getSummary aggregates correctly', () => {
    const store = new PlanStore(new MockKV());
    const plan = createPlan({
      parent_task_id: 'T-300',
      title: 'Summary test',
      subtasks: [
        { title: 'A', budget_minutes: 10 },
        { title: 'B', budget_minutes: 20 },
      ],
    });
    const summary = store.getSummary(plan);
    assert.equal(summary.total_subtasks, 2);
    assert.equal(summary.total_budget_minutes, 30);
    assert.ok(summary.subtask_status.pending === 2);
  });
});
