#!/usr/bin/env node
/**
 * mesh-lease-authz.test.js — review 2026-09-15 F1/R1, driven through the
 * daemon's REAL handlers (bin/mesh-task-daemon.js __test surface) over
 * in-memory KV.
 *
 * The owner path of lib/operator-auth.mjs takes node_id on faith and fences it
 * only with lease_token, so the token is the owner's whole credential. Here a
 * stranger reads it from get / list / mesh.events.* and acts as the owner, and
 * a forged submit steers an approved plan: the live PoC, in miniature. Against
 * the pre-fix daemon, every refusal asserted below came back { ok: true }.
 *
 * Run: node --test test/mesh-lease-authz.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pin the side channels before the daemon loads: the tracer's obs DB, and an
// operator allowlist holding a throwaway key (never ~/.openclaw/identity.key).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-authz-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { createTask, TaskStore } = require('../lib/mesh-tasks');
const { PlanStore } = require('../lib/mesh-plans');
const { CollabStore } = require('../lib/mesh-collab');

const sc = StringCodec();

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function harness() {
  const store = new TaskStore(new MockKV());
  const planStore = new PlanStore(new MockKV());
  const events = [];
  const nc = {
    publish(subject, data) { events.push({ subject, raw: sc.decode(data) }); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, planStore, collabStore: new CollabStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, planStore, events, rpc };
}

/** Submit + claim as `owner`; returns the claim reply (the only place the token may appear). */
async function claimedTask(h, { id = 'T-1', owner = 'victim' } = {}) {
  const sub = await h.rpc('handleSubmit', { task_id: id, title: 'victim work', metric: 'npm test' });
  assert.equal(sub.ok, true, sub.error);
  const claim = await h.rpc('handleClaim', { node_id: owner });
  assert.equal(claim.data.task_id, id);
  return claim.data;
}

/** Every lease_token a stranger can read about a task: from get, from list, from the event stream. */
async function whatAStrangerSees(h, taskId) {
  const got = (await h.rpc('handleGet', { task_id: taskId })).data;
  const listed = (await h.rpc('handleList', {})).data.find((t) => t.task_id === taskId);
  const broadcast = h.events
    .map((e) => JSON.parse(e.raw))
    .filter((e) => e.task_id === taskId && e.task)
    .map((e) => e.task.lease_token);
  return [got.lease_token, listed.lease_token, ...broadcast];
}

describe('F1/R1: the lease token reaches only the claimer', () => {
  it('the claim reply carries it — the worker fences every later call with it', async () => {
    const h = harness();
    const claim = await claimedTask(h);
    assert.match(claim.lease_token, /^[0-9a-f]{32}$/);
  });

  it('get, list and every mesh.events.* payload leave it out, through the whole lifecycle', async () => {
    const h = harness();
    const { lease_token } = await claimedTask(h);
    assert.equal('lease_token' in (await h.rpc('handleGet', { task_id: 'T-1' })).data, false);
    for (const filter of [{}, { status: 'claimed' }, { owner: 'victim' }]) {
      const { data } = await h.rpc('handleList', filter);
      assert.equal(data.length, 1);
      assert.equal('lease_token' in data[0], false, `list ${JSON.stringify(filter)}`);
    }

    const owner = { task_id: 'T-1', node_id: 'victim', lease_token };
    assert.equal((await h.rpc('handleStart', owner)).ok, true);
    assert.equal((await h.rpc('handleHeartbeat', owner)).ok, true);
    assert.equal((await h.rpc('handleAttempt', { ...owner, approach: 'a', result: 'r', keep: true })).ok, true);
    assert.equal((await h.rpc('handleComplete', { ...owner, result: { success: true, summary: 'done' } })).ok, true);

    const subjects = h.events.map((e) => e.subject);
    for (const s of ['submitted', 'claimed', 'started', 'heartbeat', 'completed']) {
      assert.ok(subjects.includes(`mesh.events.${s}`), `mesh.events.${s} was published`);
    }
    for (const e of h.events) assert.equal(e.raw.includes(lease_token), false, `${e.subject} broadcasts the token`);
  });

  it("owner-path replies don't echo it back", async () => {
    const h = harness();
    const { lease_token } = await claimedTask(h);
    const owner = { task_id: 'T-1', node_id: 'victim', lease_token };
    for (const [handler, extra] of [
      ['handleStart', {}],
      ['handleAttempt', { approach: 'a', keep: false }],
      ['handleComplete', { result: { success: true } }],
    ]) {
      const reply = await h.rpc(handler, { ...owner, ...extra });
      assert.equal(reply.ok, true, `${handler}: ${reply.error}`);
      assert.equal(JSON.stringify(reply).includes(lease_token), false, `${handler} reply echoes the token`);
    }
  });
});

describe('F1/R1: a stranger cannot act as the owner with what get/list/events expose', () => {
  const OWNER_ACTIONS = [
    ['handleComplete', { result: { success: true, summary: 'FORGED' } }],
    ['handleFail', { reason: 'forged' }],
    ['handleRelease', { reason: 'forged' }],
    ['handleStart', {}],
    ['handleHeartbeat', {}],
    ['handleAttempt', { approach: 'forged', keep: true }],
  ];

  for (const [handler, extra] of OWNER_ACTIONS) {
    it(`${handler} as the owner is refused and the task is untouched`, async () => {
      const h = harness();
      await claimedTask(h);
      const before = await h.store.get('T-1');
      for (const leaked of await whatAStrangerSees(h, 'T-1')) {
        const reply = await h.rpc(handler, { task_id: 'T-1', node_id: 'victim', lease_token: leaked, ...extra });
        assert.equal(reply.ok, false, `${handler} accepted a token read off the bus`);
      }
      assert.deepEqual(await h.store.get('T-1'), before);
    });
  }

  it('the claimer, holding its claim-reply token, still completes', async () => {
    const h = harness();
    const claim = await claimedTask(h);
    const reply = await h.rpc('handleComplete', {
      task_id: 'T-1', node_id: 'victim', lease_token: claim.lease_token, result: { success: true, summary: 'real' },
    });
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'completed');
  });

  it('mesh.tasks.merged after completion: stranger refused, claimer recorded', async () => {
    const h = harness();
    const claim = await claimedTask(h);
    await h.rpc('handleComplete', { task_id: 'T-1', node_id: 'victim', lease_token: claim.lease_token, result: { success: true } });
    for (const leaked of await whatAStrangerSees(h, 'T-1')) {
      const forged = await h.rpc('handleTaskMerged', { task_id: 'T-1', node_id: 'victim', lease_token: leaked, merged: true, sha: 'f0f0f0f' });
      assert.equal(forged.ok, false, 'a stranger recorded a merge');
    }
    assert.equal((await h.store.get('T-1')).result.sha, undefined);

    const real = await h.rpc('handleTaskMerged', { task_id: 'T-1', node_id: 'victim', lease_token: claim.lease_token, merged: true, sha: 'abc1234' });
    assert.equal(real.ok, true, real.error);
    assert.equal((await h.store.get('T-1')).result.sha, 'abc1234');
  });
});

describe('F1: a forged submit cannot touch a plan', () => {
  /** An approved, executing plan: P-S1 dispatched as a mesh task, P-S2 pending behind it. */
  async function approvedPlan(h, { failure_policy = 'abort_on_first_fail' } = {}) {
    // The parent is the planner's own claimed task (dispatch copies its routing
    // fields onto every subtask, so it must not exclude anyone).
    const parent = await h.rpc('handleSubmit', { task_id: 'PARENT', title: 'parent' });
    assert.equal(parent.ok, true, parent.error);
    assert.equal((await h.rpc('handleClaim', { node_id: 'planner' })).data.task_id, 'PARENT');
    const created = await h.rpc('handlePlanCreate', {
      parent_task_id: 'PARENT', title: 'plan', failure_policy,
      subtasks: [
        { subtask_id: 'P-S1', title: 's1', metric: 'npm test', delegation: { mode: 'solo_mesh' } },
        { subtask_id: 'P-S2', title: 's2', metric: 'npm test', depends_on: ['P-S1'], delegation: { mode: 'solo_mesh' } },
      ],
    });
    assert.equal(created.ok, true, created.error);
    const approved = await h.rpc('handlePlanApprove', signOperatorRequest({ plan_id: created.data.plan_id }, { identity: operator, nodeId: 'operator' }));
    assert.equal(approved.ok, true, approved.error);
    return created.data.plan_id;
  }

  async function planState(h, planId) {
    const plan = await h.planStore.get(planId);
    return { status: plan.status, subtasks: plan.subtasks.map((s) => `${s.subtask_id}:${s.status}`) };
  }

  it('the plan fixture is live: executing, P-S1 queued, P-S2 pending', async () => {
    const h = harness();
    const planId = await approvedPlan(h);
    assert.deepEqual(await planState(h, planId), { status: 'executing', subtasks: ['P-S1:queued', 'P-S2:pending'] });
  });

  for (const field of ['plan_id', 'subtask_id', 'requires_review']) {
    it(`a bus submit setting ${field} is refused`, async () => {
      const h = harness();
      const planId = await approvedPlan(h);
      const before = await planState(h, planId);
      const forged = { plan_id: planId, subtask_id: 'P-S2', requires_review: false }[field];
      const reply = await h.rpc('handleSubmit', { task_id: 'FORGE', title: 'forged', metric: 'npm test', [field]: forged });
      assert.equal(reply.ok, false, `submit accepted ${field}`);
      assert.match(reply.error, new RegExp(field));
      assert.equal(await h.store.get('FORGE'), null);
      assert.deepEqual(await planState(h, planId), before);
    });
  }

  for (const [verb, handler, extra] of [
    ['fails', 'handleFail', { reason: 'forged failure' }],
    ['completes', 'handleComplete', { result: { success: true, summary: 'forged' } }],
  ]) {
    it(`a task named after a pending subtask ${verb} without moving the plan`, async () => {
      const h = harness();
      const planId = await approvedPlan(h);
      const before = await planState(h, planId);

      const sub = await h.rpc('handleSubmit', { task_id: 'P-S2', title: 'squatter', metric: 'npm test', preferred_nodes: ['attacker'] });
      assert.equal(sub.ok, true, 'a plain task with a colliding id is still just a task');
      const claim = await h.rpc('handleClaim', { node_id: 'attacker' });
      assert.equal(claim.data.task_id, 'P-S2');
      const reply = await h.rpc(handler, { task_id: 'P-S2', node_id: 'attacker', lease_token: claim.data.lease_token, ...extra });
      assert.equal(reply.ok, true, `the attacker may finish its own task: ${reply.error}`);

      assert.deepEqual(await planState(h, planId), before);
    });
  }

  it('a KV proposal carrying plan fields is rejected; a plain one is still queued', async () => {
    const h = harness();
    const planId = await approvedPlan(h);
    const before = await planState(h, planId);
    await h.store.put({ ...createTask({ task_id: 'PROP-FORGED', title: 'proposed' }), status: 'proposed', origin: 'worker-x', plan_id: planId, subtask_id: 'P-S2' });
    await h.store.put({ ...createTask({ task_id: 'PROP-PLAIN', title: 'proposed' }), status: 'proposed', origin: 'worker-x' });

    await daemon.__test.processProposals();

    const forged = await h.store.get('PROP-FORGED');
    assert.equal(forged.status, 'rejected');
    assert.match(forged.result.summary, /plan_id/);
    assert.equal((await h.store.get('PROP-PLAIN')).status, 'queued');
    assert.deepEqual(await planState(h, planId), before);
  });

  it("the daemon's own dispatch still links the subtask and advances the plan", async () => {
    const h = harness();
    const planId = await approvedPlan(h);
    const s1 = await h.store.get('P-S1');
    assert.equal(s1.plan_id, planId);
    assert.equal(s1.subtask_id, 'P-S1');

    const claim = await h.rpc('handleClaim', { node_id: 'worker' });
    assert.equal(claim.data.task_id, 'P-S1');
    const done = await h.rpc('handleComplete', { task_id: 'P-S1', node_id: 'worker', lease_token: claim.data.lease_token, result: { success: true } });
    assert.equal(done.ok, true, done.error);

    assert.deepEqual(await planState(h, planId), { status: 'executing', subtasks: ['P-S1:completed', 'P-S2:queued'] });
    assert.equal((await h.store.get('P-S2')).plan_id, planId, 'wave 1 dispatched with its back-reference');
  });
});
