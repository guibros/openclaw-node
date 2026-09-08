#!/usr/bin/env node
/**
 * daemon-recruit-dispatch.test.js — drives the daemon's REAL recruiting-close
 * dispatch (bin/mesh-task-daemon.js __test surface), not a replica.
 *
 * Why this file exists: recruiting closes through two paths — the deadline sweep
 * and the Nth-join close (max_nodes reached). Only the sweep got the 3.1 mode
 * dispatch; the join path kept a stale pre-3.1 binary copy, so under the natural
 * grappe config (min=max=3) cooperative sessions started with an EMPTY integrator
 * rotation and "completed" placeholder rounds (observed live: integrations
 * attributed to null/undefined, artifact "(integrator submitted no reflection)").
 * The prior daemon tests REPLICATED the dispatch logic inline, so they stayed
 * green while the two real call sites diverged. These tests require the daemon
 * and call its actual function.
 *
 * Run: node --test test/daemon-recruit-dispatch.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function makeContext() {
  const collabStore = new CollabStore(new MockKV());
  const released = [];
  const failed = [];
  const published = [];
  const store = {
    async get() { return { title: 'repro task', description: 'd', scope: [] }; },
    async markReleased(taskId, reason) { released.push({ taskId, reason }); },
    async markFailed(taskId, reason) { failed.push({ taskId, reason }); },
  };
  const nc = { publish(subject) { published.push(subject); }, request: async () => ({}) };
  daemon.__test.setContext({ collabStore, store, nc });
  return { collabStore, released, failed, published };
}

async function recruitedSession(collabStore, collabSpec, nodeIds) {
  const session = createSession('task-' + collabSpec.mode, {
    min_nodes: 3, max_nodes: 3, automation_tier: 1, ...collabSpec,
  });
  await collabStore.put(session);
  for (const id of nodeIds) await collabStore.addNode(session.session_id, id, 'worker');
  return collabStore.get(session.session_id);
}

describe('startRecruitedSession — the ONE dispatch both close paths share', () => {
  let ctx;
  beforeEach(() => { ctx = makeContext(); });

  it('REGRESSION cooperative join-close: integrator rotation is SET (was [] live)', async () => {
    const s = await recruitedSession(ctx.collabStore, { mode: 'cooperative', rounds: 2 }, ['alpha', 'bravo', 'charlie']);
    assert.equal(s.nodes.length, 3, 'third join reached max_nodes');
    assert.equal(ctx.collabStore.isRecruitingDone(s), true, 'join path would fire here');

    const handled = await daemon.__test.handleCollabJoinDispatch(s);
    assert.equal(handled, true);

    const after = await ctx.collabStore.get(s.session_id);
    assert.deepEqual(after.cooperative.integrator_order, ['alpha', 'bravo', 'charlie']);
    assert.equal(after.cooperative.current_integrator, 'alpha');
    assert.equal(after.rounds.length, 1, 'round 1 started');
  });

  it('REGRESSION collaborative join-close: merger + partitioned scope are SET', async () => {
    const s = await recruitedSession(ctx.collabStore, { mode: 'collaborative' }, ['alpha', 'bravo', 'charlie']);
    await daemon.__test.handleCollabJoinDispatch(s);

    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.collaborative.merger_node_id, 'alpha');
    assert.equal(after.collaborative.phase, 'work');
    assert.equal(after.scope_strategy, 'partitioned');
    assert.equal(after.rounds.length, 1);
  });

  it('REGRESSION unbuilt mode (management) join-close: aborts LOUDLY, releases the task — never runs legacy', async () => {
    const s = await recruitedSession(ctx.collabStore, { mode: 'management' }, ['alpha', 'bravo', 'charlie']);
    await daemon.__test.handleCollabJoinDispatch(s);

    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(after.rounds.length, 0, 'no legacy round was started');
    assert.equal(ctx.released.length, 1, 'parent task released');
    assert.match(ctx.released[0].reason, /not yet implemented/);
  });

  it('deadline-close below min_nodes: aborts + releases (sweep semantics preserved)', async () => {
    const session = createSession('task-undermin', {
      mode: 'cooperative', min_nodes: 3, max_nodes: null, automation_tier: 1,
    });
    await ctx.collabStore.put(session);
    await ctx.collabStore.addNode(session.session_id, 'alpha', 'worker');
    await ctx.collabStore.addNode(session.session_id, 'bravo', 'worker');
    // createSession ignores a spec deadline (it's stamped at first join) — force
    // it into the past so isRecruitingDone fires the sweep-style deadline close.
    const stamped = await ctx.collabStore.get(session.session_id);
    stamped.recruiting_deadline = new Date(Date.now() - 60_000).toISOString();
    await ctx.collabStore.put(stamped);

    const handled = await daemon.__test.startRecruitedSession(session.session_id);
    assert.equal(handled, true);
    const after = await ctx.collabStore.get(session.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(ctx.released.length, 1);
  });

  it('idempotent: a second close attempt (join+sweep race) no-ops', async () => {
    const s = await recruitedSession(ctx.collabStore, { mode: 'cooperative' }, ['alpha', 'bravo', 'charlie']);
    assert.equal(await daemon.__test.startRecruitedSession(s.session_id), true);
    const once = await ctx.collabStore.get(s.session_id);
    assert.equal(await daemon.__test.startRecruitedSession(s.session_id), false, 'no longer RECRUITING → no-op');
    const twice = await ctx.collabStore.get(s.session_id);
    assert.equal(twice.rounds.length, once.rounds.length, 'no double round');
    assert.deepEqual(twice.cooperative.integrator_order, once.cooperative.integrator_order);
  });
});

// The join-close and the 5s recruiting sweep can call startRecruitedSession
// for the same session at the same time. With the old read-then-proceed guard
// both passed and round 1 started twice — the second start went out as round 2
// with no prior intelligence (CI, 2026-09-08). The claim must be a real CAS, so
// this KV enforces revisions the way JetStream does (error code 10071).
class CasKV {
  constructor() { this.store = new Map(); this.rev = new Map(); }
  async put(key, value) { this.store.set(key, { value }); this.rev.set(key, (this.rev.get(key) || 0) + 1); }
  async update(key, value, revision) {
    if (revision !== undefined && revision !== this.rev.get(key)) { const e = new Error('wrong last sequence'); e.code = '10071'; throw e; }
    return this.put(key, value);
  }
  async get(key) { const e = this.store.get(key); return e ? { value: e.value, revision: this.rev.get(key) } : null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

describe('startRecruitedSession — concurrent join-close and sweep start ONE round', () => {
  it('two simultaneous dispatches: one wins, one round, no round 2', async () => {
    const collabStore = new CollabStore(new CasKV());
    const published = [];
    daemon.__test.setContext({
      collabStore,
      store: { async get() { return { title: 't', description: 'd', scope: [] }; }, async markReleased() {}, async markFailed() {} },
      nc: { publish(subject) { published.push(subject); }, request: async () => ({}) },
    });
    const session = createSession('task-parallel-race', { mode: 'parallel', min_nodes: 2, max_nodes: 2, automation_tier: 1 });
    await collabStore.put(session);
    for (const id of ['a', 'b']) await collabStore.addNode(session.session_id, id, 'worker');

    const results = await Promise.all([
      daemon.__test.startRecruitedSession(session.session_id),
      daemon.__test.startRecruitedSession(session.session_id),
    ]);
    assert.deepEqual(results.filter(Boolean).length, 1, 'exactly one dispatch wins');
    const after = await collabStore.get(session.session_id);
    assert.equal(after.current_round, 1);
    assert.equal(after.rounds.length, 1, 'round 1 started once');
    assert.equal(published.filter((s) => s.endsWith('.round')).length, 2, 'one round notification per node');
  });

  it('claimRecruitClose: one winner, losers get null; not claimable before recruiting is done', async () => {
    const collabStore = new CollabStore(new CasKV());
    const session = createSession('task-claim', { mode: 'parallel', min_nodes: 2, max_nodes: 2, automation_tier: 1 });
    await collabStore.put(session);
    await collabStore.addNode(session.session_id, 'a', 'worker');
    assert.equal(await collabStore.claimRecruitClose(session.session_id), null, 'only one of two nodes joined');
    await collabStore.addNode(session.session_id, 'b', 'worker');
    assert.ok(await collabStore.claimRecruitClose(session.session_id));
    assert.equal(await collabStore.claimRecruitClose(session.session_id), null);
  });
});
