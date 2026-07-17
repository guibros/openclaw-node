#!/usr/bin/env node
/**
 * collab-p1-hardening.test.js — deep-review P1s #3–#9 driven against the REAL
 * daemon/store functions (mesh-task-daemon __test surface + lib/mesh-collab),
 * never replicas. Each case is the failure the review named.
 *
 * Run: node --test test/collab-p1-hardening.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');
const { isOpenClawWorkerProvider } = require('../lib/llm-providers');

class MockKV {
  constructor() { this.store = new Map(); this.rev = 0; }
  async put(key, value) { this.store.set(key, { value, revision: ++this.rev }); }
  async update(key, value, expectedRev) {
    const cur = this.store.get(key);
    if (cur && expectedRev !== undefined && cur.revision !== expectedRev) {
      const err = new Error('wrong last sequence'); err.code = '10071'; throw err;
    }
    this.store.set(key, { value, revision: ++this.rev });
  }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function makeContext() {
  const collabStore = new CollabStore(new MockKV());
  const failed = [], completed = [], released = [];
  const tasks = new Map();
  const store = {
    async get(id) { return tasks.get(id) || { task_id: id, title: 't', description: 'd', scope: [] }; },
    async markFailed(id, reason, attempts) {
      const t = tasks.get(id); if (t) { t.status = 'failed'; t.fail_reason = reason; }
      failed.push({ id, reason }); return t || { task_id: id };
    },
    async markCompleted(id, result) { completed.push({ id, result }); return { task_id: id }; },
    async markReleased(id, reason) { released.push({ id, reason }); return { task_id: id }; },
    _tasks: tasks,
  };
  const published = [];
  const nc = { publish(subject) { published.push(subject); }, request: async () => ({}) };
  daemon.__test.setContext({ collabStore, store, nc, planStore: { list: async () => [] } });
  return { collabStore, store, failed, completed, released, published };
}

async function activeSession(collabStore, spec, nodeIds, { setup } = {}) {
  const session = createSession('task-' + spec.mode + '-' + Math.random().toString(36).slice(2, 7), {
    min_nodes: 3, max_nodes: 3, automation_tier: 1, ...spec,
  });
  await collabStore.put(session);
  for (const id of nodeIds) await collabStore.addNode(session.session_id, id, 'worker');
  await collabStore._updateWithCAS(session.session_id, (s) => {
    s.status = COLLAB_STATUS.ACTIVE;
    s.current_round = 1;
    s.rounds.push({ round_number: 1, started_at: new Date().toISOString(), completed_at: null, shared_intel: '', reflections: [] });
    if (setup) setup(s);
    return s;
  });
  return collabStore.get(session.session_id);
}

const reflect = (node_id, vote = 'continue', extra = {}) =>
  ({ node_id, summary: `${node_id} work`, artifacts: [], confidence: 0.9, vote, ...extra });

describe('P1 #7 — zombie reflections cannot trip barriers', () => {
  let ctx;
  beforeEach(() => { ctx = makeContext(); });

  it('submitReflection rejects a non-member', async () => {
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c']);
    const out = await ctx.collabStore.submitReflection(s.session_id, reflect('zombie'));
    assert.equal(out, null, 'non-member reflection must be refused');
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.rounds[0].reflections.length, 0);
  });

  it('isRoundComplete requires EVERY active member — a stale entry cannot stand in', async () => {
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c']);
    // simulate the pre-fix corruption: a removed node's reflection already recorded
    await ctx.collabStore._updateWithCAS(s.session_id, (sess) => {
      sess.rounds[0].reflections.push({ node_id: 'ghost', vote: 'continue', artifacts: [] });
      sess.rounds[0].reflections.push({ node_id: 'a', vote: 'continue', artifacts: [] });
      sess.rounds[0].reflections.push({ node_id: 'b', vote: 'continue', artifacts: [] });
      return sess;
    });
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(ctx.collabStore.isRoundComplete(after), false, '3 entries but c never reflected — NOT complete');
  });
});

describe('P1 #6 — evaluateRound fires exactly once per round', () => {
  it('claimRoundEvaluation: one winner, losers get null', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; },
    });
    const first = await ctx.collabStore.claimRoundEvaluation(s.session_id);
    const second = await ctx.collabStore.claimRoundEvaluation(s.session_id);
    assert.ok(first, 'first claim wins');
    assert.equal(second, null, 'second claim must lose');
  });

  it('two concurrent evaluateRound calls record ONE integration', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative', rounds: 3 }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; sess.cooperative.rounds_target = 3; },
    });
    for (const n of ['a', 'b', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await Promise.all([daemon.__test.evaluateRound(s.session_id), daemon.__test.evaluateRound(s.session_id)]);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.integrations.length, 1, 'double-fire must not double-integrate');
  });
});

describe('P1 #3 — collaborative merge-review votes are BINDING', () => {
  async function mergePhaseSession(ctx, votes, { mergerReflects = true } = {}) {
    const s = await activeSession(ctx.collabStore, { mode: 'collaborative' }, ['m', 'r1', 'r2'], {
      setup: (sess) => {
        sess.collaborative.merger_node_id = 'm';
        sess.collaborative.phase = 'merge';
        sess.collaborative.subtasks = { m: { summary: 'x' }, r1: { summary: 'y' }, r2: { summary: 'z' } };
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id, status: 'in_progress' });
    if (mergerReflects) await ctx.collabStore.submitReflection(s.session_id, reflect('m', 'converged', { summary: 'merged result' }));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r1', votes[0]));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r2', votes[1]));
    await daemon.__test.evaluateRound(s.session_id);
    return ctx.collabStore.get(s.session_id);
  }

  it('REGRESSION: two blocked votes ABORT the session and fail the task (used to complete)', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['blocked', 'blocked']);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(ctx.failed.length, 1, 'parent task failed');
    assert.match(ctx.failed[0].reason, /merge gate/i);
    assert.equal(ctx.completed.length, 0);
  });

  it('two converged votes complete the session', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['converged', 'converged']);
    assert.equal(after.status, COLLAB_STATUS.COMPLETED);
    assert.equal(ctx.failed.length, 0);
  });

  it('split vote (1-1) does NOT complete — approvals must exceed rejections', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['converged', 'blocked']);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
  });

  it('P1 #5: merger absent → abort, never a placeholder completion', async () => {
    const ctx = makeContext();
    // merger dead: only reviewers reflect; mark m dead so the barrier can pass
    const s = await activeSession(ctx.collabStore, { mode: 'collaborative' }, ['m', 'r1', 'r2'], {
      setup: (sess) => {
        sess.collaborative.merger_node_id = 'm';
        sess.collaborative.phase = 'merge';
        sess.nodes.find(n => n.node_id === 'm').status = 'dead';
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id });
    await ctx.collabStore.submitReflection(s.session_id, reflect('r1', 'converged'));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r2', 'converged'));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.match(after.result?.summary || JSON.stringify(after.audit_log.slice(-3)), /merge/i);
  });
});

describe('P1 #5 — cooperative rotation skips the dead; degraded is loud', () => {
  it('next integrator in order is dead → rotation lands on the next ALIVE node', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.cooperative.rounds_target = 3;
        sess.nodes.find(n => n.node_id === 'b').status = 'dead';
      },
    });
    for (const n of ['a', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.current_integrator, 'c', 'skipped dead b → c');
  });

  it('missing integrator reflection → integration marked degraded (never silent)', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.cooperative.rounds_target = 3;
        sess.nodes.find(n => n.node_id === 'a').status = 'dead';
      },
    });
    for (const n of ['b', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.integrations[0].degraded, true);
    assert.ok(after.audit_log.some(a => a.event === 'cooperative_integration_degraded'));
  });
});

describe('P1 #4 — round timeout: sessions can no longer hang forever', () => {
  it('stale round, too few survivors → session ABORTED + task failed', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.rounds[0].started_at = new Date(Date.now() - 20 * 60_000).toISOString();
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id });
    await ctx.collabStore.submitReflection(s.session_id, reflect('a'));
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED, 'b+c marked dead, 1/3 < min_nodes → abort');
    assert.equal(ctx.failed.length, 1);
  });

  it('fresh rounds are untouched by the sweep', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; },
    });
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ACTIVE);
  });
});

describe('P1 #8 — D11 guard: mock providers are gated, local providers enumerated', () => {
  it('shell is refused by default and allowed ONLY with MESH_ALLOW_MOCK_WORKERS=1', () => {
    assert.equal(isOpenClawWorkerProvider('shell', {}), false);
    assert.equal(isOpenClawWorkerProvider('shell', { MESH_ALLOW_MOCK_WORKERS: '1' }), true);
  });
  it('other local-model providers are refused too (was: only the literal string ollama)', () => {
    for (const p of ['ollama', 'llamacpp', 'lmstudio', 'vllm', 'mlx']) {
      assert.equal(isOpenClawWorkerProvider(p, {}), false, `${p} must be refused`);
    }
    assert.equal(isOpenClawWorkerProvider('claude', {}), true);
  });
});

describe('P1 #9 — one node cannot poison the mesh', () => {
  function fakeMsg(payload) {
    const responses = [];
    return {
      data: new TextEncoder().encode(JSON.stringify(payload)),
      respond(data) { responses.push(new TextDecoder().decode(data)); },
      _responses: responses,
    };
  }

  it('handleFail rejects a non-owner (task and session untouched)', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t1', { task_id: 't1', owner: 'alpha', status: 'in_progress' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't1', node_id: 'mallory', reason: 'nope' }));
    assert.equal(ctx.failed.length, 0, 'markFailed must not run');
    assert.equal(ctx.store._tasks.get('t1').status, 'in_progress');
  });

  it('handleFail rejects when the task is unclaimed (no external fail at all)', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t2', { task_id: 't2', owner: null, status: 'pending' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't2', node_id: 'alpha', reason: 'x' }));
    assert.equal(ctx.failed.length, 0);
  });

  it('handleFail accepts the owner', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t3', { task_id: 't3', owner: 'alpha', status: 'in_progress' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't3', node_id: 'alpha', reason: 'legit failure' }));
    assert.equal(ctx.failed.length, 1);
    assert.equal(ctx.failed[0].id, 't3');
  });
});
