#!/usr/bin/env node

/**
 * collab-pipeline.test.js — Step 2.7 pipeline mode, store level (PIPELINE_MODE_SPEC, D18).
 *
 * Schema, pass arithmetic, the early-exit (not barrier) completeness rule, directed input with
 * VISIBLE degradation, the terminal-artifact rule (T2), and that a pipeline session carries no
 * convergence block at all. Daemon-level behaviour — deadline, cost ceiling, the unreachability
 * of the vote machinery — lives in daemon-pipeline-handlers.test.js.
 *
 * Run: node --test test/collab-pipeline.test.js
 */

// ── Mock 'nats' module ──
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
  connect: async () => ({}),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = { id: 'nats', filename: 'nats', loaded: true, exports: mockNats };

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession,
  CollabStore,
  COLLAB_MODE,
  COLLAB_STATUS,
  isModeImplemented,
  resolvePreferredMode,
  pipelineTerminalArtifact,
  PIPELINE_DEGRADATION,
  PIPELINE_DEFAULT_PASS_BUDGET_MS,
} = require('../lib/mesh-collab');

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

async function activeSession(spec = {}) {
  const store = new CollabStore(new MockKV());
  const s = createSession('t-pipe', { mode: 'pipeline', ...spec });
  await store.put(s);
  await store.addNode(s.session_id, 'w', 'worker');
  await store.addNode(s.session_id, 'ra', 'reviewer');
  await store.addNode(s.session_id, 'rb', 'reviewer');
  const joined = await store.get(s.session_id);
  store.assignPipelineRoles(joined);
  await store.put(joined);
  return { store, id: s.session_id };
}

const reflect = (node, pass, extra = {}) => ({
  node_id: node, summary: `${node} p${pass}`, confidence: 0.9, pipeline_pass: pass, ...extra,
});

describe('schema (SPEC §5)', () => {
  it('pipeline is an implemented mode and preferred_mode "pipeline" resolves to it', () => {
    assert.ok(isModeImplemented(COLLAB_MODE.PIPELINE));
    assert.equal(resolvePreferredMode('pipeline'), COLLAB_MODE.PIPELINE);
    assert.equal(createSession('t', { preferred_mode: 'pipeline' }).mode, 'pipeline');
  });

  it('the pipeline block exists only for pipeline; convergence is null; the topology is exactly 3', () => {
    const s = createSession('t', { mode: 'pipeline' });
    assert.ok(s.pipeline);
    assert.equal(s.convergence, null, 'D16: no agreement criterion, not even a default one');
    assert.equal(s.circling, null);
    assert.equal(s.cooperative, null);
    assert.equal(s.collaborative, null);
    assert.equal(s.min_nodes, 3);
    assert.equal(s.max_nodes, 3);
    assert.equal(s.pipeline.passes, 3);
    assert.equal(s.pipeline.current_pass, 0);
    assert.equal(s.pipeline.pass_budget_ms, PIPELINE_DEFAULT_PASS_BUDGET_MS);
    assert.equal(s.pipeline.max_cost_usd, null);
    assert.deepEqual(s.pipeline.artifacts, { workArtifact: null, reviewArtifacts: {}, finalArtifact: null });
    assert.deepEqual(s.pipeline.degraded, []);
    assert.equal(s.pipeline.outcome, null);
  });

  it('every other mode keeps its convergence block and carries no pipeline block', () => {
    for (const mode of ['circling_strategy', 'cooperative', 'collaborative', 'parallel']) {
      const s = createSession('t', { mode });
      assert.equal(s.pipeline, null, `${mode} carries no pipeline block`);
      assert.equal(s.convergence.type, 'unanimous', `${mode} keeps its convergence default`);
    }
  });

  it('passes must be an odd count >= 1 (draft → (review → revise)*)', () => {
    assert.equal(createSession('t', { mode: 'pipeline', passes: 1 }).pipeline.passes, 1);
    assert.equal(createSession('t', { mode: 'pipeline', passes: 5 }).pipeline.passes, 5);
    for (const bad of [0, 2, 4]) {
      assert.throws(() => createSession('t', { mode: 'pipeline', passes: bad }), /odd count/);
    }
  });

  it('the RUN_RULES knobs are carried: passes, pass_budget_ms, max_cost_usd', () => {
    const s = createSession('t', { mode: 'pipeline', passes: 5, pass_budget_ms: 1234, max_cost_usd: 2.5 });
    assert.equal(s.pipeline.passes, 5);
    assert.equal(s.pipeline.pass_budget_ms, 1234);
    assert.equal(s.pipeline.max_cost_usd, 2.5);
  });

  it('the pipeline block has no vote, sub-round, gate or convergence field anywhere', () => {
    const s = createSession('t', { mode: 'pipeline' });
    const keys = JSON.stringify(s.pipeline).toLowerCase();
    for (const banned of ['vote', 'subround', 'sub_round', 'gate', 'converge', 'quorum', 'unanim']) {
      assert.ok(!keys.includes(banned), `pipeline block must not carry "${banned}"`);
    }
  });
});

describe('pass arithmetic', () => {
  it('expected submitters: worker on odd passes, both reviewers on even ones', async () => {
    const { store, id } = await activeSession({ passes: 5 });
    const s = await store.get(id);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 1), ['w']);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 2), ['ra', 'rb']);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 3), ['w']);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 4), ['ra', 'rb']);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 5), ['w']);
    assert.deepEqual(store.pipelineExpectedSubmitters(s, 0), [], 'nobody before the first pass');
  });

  it('artifact type is positional: draft, review, revised draft, final', () => {
    const store = new CollabStore(new MockKV());
    assert.equal(store.pipelineArtifactType(1, 3), 'workArtifact');
    assert.equal(store.pipelineArtifactType(2, 3), 'reviewArtifact');
    assert.equal(store.pipelineArtifactType(3, 3), 'finalArtifact');
    assert.equal(store.pipelineArtifactType(1, 1), 'finalArtifact', 'a one-pass pipeline ships the draft as final');
    assert.equal(store.pipelineArtifactType(3, 5), 'workArtifact', 'a mid revise overwrites the draft');
    assert.equal(store.pipelineArtifactType(4, 5), 'reviewArtifact');
    assert.equal(store.pipelineArtifactType(5, 5), 'finalArtifact');
  });

  it('roles and labels', async () => {
    const { store, id } = await activeSession();
    const s = await store.get(id);
    assert.equal(store.pipelineRoleOf(s, 'w'), 'worker');
    assert.equal(store.pipelineRoleOf(s, 'ra'), 'reviewerA');
    assert.equal(store.pipelineRoleOf(s, 'rb'), 'reviewerB');
    assert.equal(store.pipelineRoleOf(s, 'stranger'), null);
    assert.equal(store.pipelinePassLabel(1, 3), 'draft');
    assert.equal(store.pipelinePassLabel(2, 3), 'review');
    assert.equal(store.pipelinePassLabel(3, 3), 'revise (final)');
    assert.equal(store.pipelinePassLabel(1, 1), 'draft (final)');
  });

  it('advancePipelinePass counts up to passes and then returns null', async () => {
    const { store, id } = await activeSession();
    assert.deepEqual(await store.advancePipelinePass(id), { pass: 1, passes: 3 });
    assert.deepEqual(await store.advancePipelinePass(id), { pass: 2, passes: 3 });
    assert.deepEqual(await store.advancePipelinePass(id), { pass: 3, passes: 3 });
    assert.equal(await store.advancePipelinePass(id), null, 'T1: passes exhausted');
    const s = await store.get(id);
    assert.equal(s.pipeline.current_pass, 3);
    assert.ok(s.pipeline.pass_started_at);
  });
});

describe('completeness is an early exit, never a barrier', () => {
  async function inPass(pass) {
    const { store, id } = await activeSession();
    for (let p = 1; p <= pass; p++) {
      await store.advancePipelinePass(id);
      await store.startRound(id, { prune: false });
    }
    return { store, id };
  }

  it('pass 1 completes on the worker alone — the reviewers are not consulted', async () => {
    const { store, id } = await inPass(1);
    assert.equal(store.isPipelinePassComplete(await store.get(id)), false);
    await store.submitReflection(id, reflect('w', 1));
    assert.equal(store.isPipelinePassComplete(await store.get(id)), true);
  });

  it('pass 2 with one silent reviewer is NOT complete here — the deadline closes it, not this rule', async () => {
    const { store, id } = await inPass(2);
    await store.submitReflection(id, reflect('ra', 2));
    const s = await store.get(id);
    assert.equal(store.isPipelinePassComplete(s), false, 'silence is a deadline matter');
    assert.equal(store.isPipelinePassComplete(s, { ignore: ['rb'] }), true, 'a member known gone is not waited for');
  });

  it('pass 2 completes when both reviewers have spoken', async () => {
    const { store, id } = await inPass(2);
    await store.submitReflection(id, reflect('ra', 2));
    await store.submitReflection(id, reflect('rb', 2));
    assert.equal(store.isPipelinePassComplete(await store.get(id)), true);
  });

  it('a reflection tagged with another pass does not count for this one', async () => {
    const { store, id } = await inPass(1);
    await store.submitReflection(id, reflect('w', 2));
    assert.equal(store.isPipelinePassComplete(await store.get(id)), false);
  });

  it('a non-member cannot submit (membership gate still in force)', async () => {
    const { store, id } = await inPass(1);
    assert.equal(await store.submitReflection(id, reflect('stranger', 1)), null);
  });
});

describe('startRound prune:false — the roster never shrinks and the session never aborts on it', () => {
  it('a dead member stays a member and the round still opens', async () => {
    const { store, id } = await activeSession();
    await store.advancePipelinePass(id);
    await store.setNodeStatus(id, 'rb', 'dead');
    const round = await store.startRound(id, { prune: false });
    assert.ok(round, 'round opened');
    const s = await store.get(id);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
    assert.equal(s.nodes.length, 3, 'dead member NOT pruned');
    assert.equal(s.nodes.find(n => n.node_id === 'rb').status, 'dead');
  });

  it('control: the default prune path still prunes and aborts below min_nodes (other modes unchanged)', async () => {
    const store = new CollabStore(new MockKV());
    const s = createSession('t-circ', { mode: 'circling_strategy', min_nodes: 3 });
    await store.put(s);
    for (const [id, role] of [['a', 'worker'], ['b', 'reviewer'], ['c', 'reviewer']]) await store.addNode(s.session_id, id, role);
    await store.setNodeStatus(s.session_id, 'c', 'dead');
    const round = await store.startRound(s.session_id);
    assert.equal(round, null);
    const after = await store.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(after.nodes.length, 2, 'pruned');
  });
});

describe('artifacts, ledger, usage, outcome', () => {
  it('stores the draft, per-role reviews, and the final', async () => {
    const { store, id } = await activeSession();
    await store.storePipelineArtifact(id, 'worker', 'workArtifact', 'D');
    await store.storePipelineArtifact(id, 'reviewerA', 'reviewArtifact', 'RA');
    await store.storePipelineArtifact(id, 'reviewerB', 'reviewArtifact', 'RB');
    await store.storePipelineArtifact(id, 'worker', 'finalArtifact', 'F');
    const a = (await store.get(id)).pipeline.artifacts;
    assert.deepEqual(a, { workArtifact: 'D', reviewArtifacts: { reviewerA: 'RA', reviewerB: 'RB' }, finalArtifact: 'F' });
  });

  it('the degradation ledger appends with a timestamp', async () => {
    const { store, id } = await activeSession();
    await store.recordPipelineDegradation(id, { pass: 2, node_id: 'rb', reason: PIPELINE_DEGRADATION.TIMEOUT });
    await store.recordPipelineDegradation(id, { pass: 3, node_id: null, reason: PIPELINE_DEGRADATION.COST_CEILING });
    const d = (await store.get(id)).pipeline.degraded;
    assert.equal(d.length, 2);
    assert.equal(d[0].reason, 'timeout');
    assert.ok(d[0].observed_at);
    assert.equal(d[1].node_id, null);
  });

  it('parse-failure counts are per node per pass', async () => {
    const { store, id } = await activeSession();
    await store.advancePipelinePass(id);
    assert.equal(await store.recordPipelineArtifactFailure(id, 'w'), 1);
    assert.equal(await store.recordPipelineArtifactFailure(id, 'w'), 2);
    await store.advancePipelinePass(id);
    assert.equal(await store.recordPipelineArtifactFailure(id, 'w'), 1, 'a new pass starts a new count');
    assert.equal(await store.recordPipelineArtifactFailure(id, 'ra'), 1);
  });

  it('usage accumulates and returns the running total; absent usage is a no-op', async () => {
    const { store, id } = await activeSession();
    assert.equal(await store.addPipelineUsage(id, null), null);
    const t1 = await store.addPipelineUsage(id, { input_tokens: 10, output_tokens: 5, cost_usd: 0.4 });
    const t2 = await store.addPipelineUsage(id, { input_tokens: 1, cost_usd: 0.7 });
    assert.equal(t1.calls, 1);
    assert.equal(t2.calls, 2);
    assert.equal(t2.input_tokens, 11);
    assert.equal(t2.output_tokens, 5);
    assert.ok(Math.abs(t2.cost_usd - 1.1) < 1e-9);
  });

  it('setPipelineOutcome', async () => {
    const { store, id } = await activeSession();
    await store.setPipelineOutcome(id, 'completed_degraded');
    assert.equal((await store.get(id)).pipeline.outcome, 'completed_degraded');
  });

  it('none of the pipeline mutators touch a non-pipeline session', async () => {
    const store = new CollabStore(new MockKV());
    const s = createSession('t-c', { mode: 'circling_strategy' });
    await store.put(s);
    assert.equal(await store.advancePipelinePass(s.session_id), null);
    assert.equal(await store.storePipelineArtifact(s.session_id, 'worker', 'workArtifact', 'x'), null);
    assert.equal(await store.recordPipelineDegradation(s.session_id, { pass: 1 }), null);
    assert.equal(await store.recordPipelineArtifactFailure(s.session_id, 'a'), 0);
    assert.equal(await store.addPipelineUsage(s.session_id, { cost_usd: 1 }), null);
    assert.equal(await store.setPipelineOutcome(s.session_id, 'x'), null);
  });
});

describe('compilePipelineInput makes degradation visible to the model', () => {
  it('pass 1: the task only', async () => {
    const { store, id } = await activeSession();
    await store.advancePipelinePass(id);
    const text = store.compilePipelineInput(await store.get(id), 'Build X');
    assert.match(text, /## Task\n\nBuild X/);
    assert.ok(!text.includes('Work Artifact'));
  });

  it('pass 2: the task and the draft', async () => {
    const { store, id } = await activeSession();
    await store.advancePipelinePass(id);
    await store.storePipelineArtifact(id, 'worker', 'workArtifact', 'THE DRAFT');
    await store.advancePipelinePass(id);
    const text = store.compilePipelineInput(await store.get(id), 'Build X');
    assert.match(text, /## Work Artifact \(current draft\)\n\nTHE DRAFT/);
    assert.ok(!text.includes('Review from'));
  });

  it('pass 3: the draft, the review that landed, and the missing one WITH its ledger reason', async () => {
    const { store, id } = await activeSession();
    await store.advancePipelinePass(id);
    await store.storePipelineArtifact(id, 'worker', 'workArtifact', 'THE DRAFT');
    await store.advancePipelinePass(id);
    await store.storePipelineArtifact(id, 'reviewerA', 'reviewArtifact', 'REVIEW A SAYS');
    await store.recordPipelineDegradation(id, { pass: 2, node_id: 'rb', reason: PIPELINE_DEGRADATION.TIMEOUT });
    await store.advancePipelinePass(id);
    const text = store.compilePipelineInput(await store.get(id), 'Build X');
    assert.match(text, /## Review from reviewerA\n\nREVIEW A SAYS/);
    assert.match(text, /## Review from reviewerB\n\n\[REVIEW UNAVAILABLE — timeout\]/);
  });

  it('a missing review with no ledger entry reads "not submitted"', async () => {
    const { store, id } = await activeSession();
    for (let p = 0; p < 3; p++) await store.advancePipelinePass(id);
    await store.storePipelineArtifact(id, 'worker', 'workArtifact', 'D');
    const text = store.compilePipelineInput(await store.get(id), 'Build X');
    assert.match(text, /\[REVIEW UNAVAILABLE — not submitted\]/);
  });
});

describe('terminal artifact (SPEC §3 T2)', () => {
  const s = (artifacts) => ({ pipeline: { artifacts: { workArtifact: null, reviewArtifacts: {}, finalArtifact: null, ...artifacts } } });

  it('the final ships as final', () => {
    assert.deepEqual(pipelineTerminalArtifact(s({ workArtifact: 'D', finalArtifact: 'F' })), { type: 'finalArtifact', content: 'F', degraded: false });
  });
  it('no final: the draft ships, flagged degraded', () => {
    assert.deepEqual(pipelineTerminalArtifact(s({ workArtifact: 'D' })), { type: 'workArtifact', content: 'D', degraded: true });
  });
  it('no draft either: null — the one genuine failure', () => {
    assert.equal(pipelineTerminalArtifact(s({})), null);
    assert.equal(pipelineTerminalArtifact({ circling: {} }), null);
  });
  it('the store method and the module export are the same rule', () => {
    const store = new CollabStore(new MockKV());
    assert.deepEqual(store.pipelineTerminalArtifact(s({ workArtifact: 'D' })), pipelineTerminalArtifact(s({ workArtifact: 'D' })));
  });
});
