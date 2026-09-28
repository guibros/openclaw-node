#!/usr/bin/env node
/**
 * daemon-terminal-task.test.js — owner calls on a task that has already ended,
 * driven through the daemon's REAL handlers (bin/mesh-task-daemon.js __test
 * surface) over in-memory KV.
 *
 * The store's mutators return null for a task in a terminal state, and the
 * handlers reported that null as "Task … not found". The first sighting was on
 * the node on 2026-09-27 (foreman-step12-20260927). After a budget auto-fail,
 * the worker's heartbeats and attempts all said "not found" for a task that was
 * still there, marked failed. complete did not even answer: it crashed on
 * `task.started_at`. A task that has ended must be reported as what it is, with
 * a code the worker can act on. A missing task is still "not found".
 *
 * Run: node --test test/daemon-terminal-task.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-task-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore, TASK_TERMINAL } = require('../lib/mesh-tasks');
const { CollabStore } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

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
  const nc = { publish() {}, request: async () => { throw new Error('no agent on the test bus'); } };
  daemon.__test.setContext({ nc, store, collabStore: new CollabStore(new MockKV()), planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, rpc };
}

const BUDGET = 'Budget exceeded: 10.4m elapsed, 10m budget';

/** Submit + claim as `worker`; returns the owner's credentials for its later calls. */
async function claimedTask(h, { metric } = {}) {
  assert.equal((await h.rpc('handleSubmit', { task_id: 'T-1', title: 'work', ...(metric ? { metric } : {}) })).ok, true);
  const claim = await h.rpc('handleClaim', { node_id: 'worker' });
  assert.equal(claim.data.task_id, 'T-1');
  return { task_id: 'T-1', node_id: 'worker', lease_token: claim.data.lease_token };
}

/** A claimed task that the budget enforcer then failed, exactly as enforceBudgets does. */
async function budgetFailedTask(h, opts) {
  const owner = await claimedTask(h, opts);
  await h.store.markFailed('T-1', BUDGET, []);
  return owner;
}

describe('owner calls on a task the daemon already ended', () => {
  for (const [handler, extra] of [
    ['handleStart', {}],
    ['handleAttempt', { approach: 'a', result: 'r', keep: false }],
    ['handleHeartbeat', {}],
    ['handleFail', { reason: 'worker gave up' }],
    ['handleRelease', { reason: 'exhausted' }],
    ['handleComplete', { result: { success: true, summary: 'late' } }],
  ]) {
    it(`${handler} says the task is failed, not that it is missing`, async () => {
      const h = harness();
      const owner = await budgetFailedTask(h);
      const before = await h.store.get('T-1');

      const reply = await h.rpc(handler, { ...owner, ...extra });

      assert.equal(reply.ok, false);
      assert.equal(reply.code, TASK_TERMINAL);
      assert.equal(reply.status, 'failed');
      assert.match(reply.error, /T-1 is already failed \(Budget exceeded: 10\.4m elapsed, 10m budget\)/);
      assert.doesNotMatch(reply.error, /not found/);
      assert.deepEqual(await h.store.get('T-1'), before, 'the ended task stays as the daemon left it');
    });
  }

  it('handleComplete on the metric path answers too, instead of crashing on a null task', async () => {
    const h = harness();
    const owner = await budgetFailedTask(h, { metric: 'npm test' });
    const reply = await h.rpc('handleComplete', { ...owner, result: { success: true } });
    assert.equal(reply.ok, false);
    assert.equal(reply.code, TASK_TERMINAL);
  });
});

describe('"not found" still means not found', () => {
  it('a task that was never submitted', async () => {
    const h = harness();
    const reply = await h.rpc('handleHeartbeat', { task_id: 'NOPE', node_id: 'worker' });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /NOPE not found/);
    assert.equal(reply.code, undefined);
  });

  it('a task that vanishes between the ownership read and the write', async () => {
    const h = harness();
    const owner = await claimedTask(h);
    h.store.touchActivity = async (id) => { await h.store.delete(id); return null; };
    const reply = await h.rpc('handleHeartbeat', owner);
    assert.match(reply.error, /T-1 not found/);
    assert.equal(reply.code, undefined);
  });

  it('a live task is unaffected: its owner heartbeats as before', async () => {
    const h = harness();
    const owner = await claimedTask(h);
    const reply = await h.rpc('handleHeartbeat', owner);
    assert.equal(reply.ok, true, reply.error);
  });
});
