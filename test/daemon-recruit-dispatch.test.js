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
