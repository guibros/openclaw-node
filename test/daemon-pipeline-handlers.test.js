#!/usr/bin/env node

/**
 * daemon-pipeline-handlers.test.js — step 2.7: the daemon's REAL pipeline protocol, driven
 * through bin/mesh-task-daemon.js's __test surface (no replicas — replicated copies are how the
 * join-path divergence once shipped green).
 *
 * The §11 contract's `code:` leg:
 *   - checkConvergence / advanceCirclingStep / isCirclingStepComplete / markConverged are never
 *     called for a pipeline session, and no circling_gate or converged event is ever published
 *     (spies on the injected store + the captured bus);
 *   - the three T2 absence behaviours: draft absent ⇒ ABORTED/outcome failed; reviews absent ⇒
 *     advance; revision absent ⇒ ship the draft flagged degraded;
 *   - T3: the cost ceiling closes the pass and completes;
 *   - the direct regression for the 3-of-5 run-2 failure: one reviewer silent, session completes.
 *
 * Run: node --test test/daemon-pipeline-handlers.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, CollabStore, COLLAB_STATUS, PIPELINE_DEGRADATION } = require('../lib/mesh-collab');

const sc = StringCodec();
const BIG = 'The artifact body. '.repeat(30); // > 400 chars
const FINAL = 'The final artifact body, revised after review. '.repeat(15);

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

// Spies on the agreement machinery. Instance properties shadow the (tracer-wrapped)
// prototype methods, so every daemon call site lands here.
function spyStore(store) {
  const calls = { checkConvergence: 0, advanceCirclingStep: 0, isCirclingStepComplete: 0, markConverged: 0 };
  for (const name of Object.keys(calls)) {
    const orig = store[name].bind(store);
    store[name] = (...args) => { calls[name]++; return orig(...args); };
  }
  return calls;
}

function makeContext() {
  const collabStore = new CollabStore(new MockKV());
  const spy = spyStore(collabStore);
  const published = [];
  const completed = [];
  const failed = [];
  const released = [];
  const store = {
    async get(id) { return { task_id: id, title: 'pipe task', description: 'Write the design note.', scope: [] }; },
    async markReleased(taskId, reason) { released.push({ taskId, reason }); },
    async markFailed(taskId, reason) { failed.push({ taskId, reason }); },
    async markCompleted(taskId, result) { completed.push({ taskId, result }); },
  };
  const nc = {
    publish(subject, data) { published.push({ subject, payload: JSON.parse(sc.decode(data)) }); },
    request: async () => ({}),
  };
  daemon.__test.setContext({ collabStore, store, nc });
  return { collabStore, spy, published, completed, failed, released };
}

async function recruited(ctx, spec = {}, ids = ['w', 'ra', 'rb']) {
  const session = createSession('task-pipe', { mode: 'pipeline', automation_tier: 1, ...spec });
  await ctx.collabStore.put(session);
  for (const id of ids) await ctx.collabStore.addNode(session.session_id, id, 'worker');
  return ctx.collabStore.get(session.session_id);
}

async function dispatched(ctx, spec = {}) {
  const s = await recruited(ctx, spec);
  assert.equal(await daemon.__test.handleCollabJoinDispatch(s), true);
  return s.session_id;
}

const rounds = (ctx) => ctx.published.filter(p => p.subject.endsWith('.round'));
const roundsTo = (ctx, node) => rounds(ctx).filter(p => p.subject.endsWith(`.node.${node}.round`));
const events = (ctx, type) => ctx.published.filter(p => p.subject === `mesh.events.collab.${type}`);

function reflect(id, node, pass, content, extra = {}) {
  const type = extra.type || (pass % 2 === 0 ? 'reviewArtifact' : pass === 1 ? 'workArtifact' : 'finalArtifact');
  return daemon.__test.reflect({
    session_id: id, node_id: node, round: pass, summary: `${node} pass ${pass}`, confidence: 0.9,
    parse_failed: false, pipeline_pass: pass,
    circling_artifacts: content == null ? [] : [{ type, content }],
    ...extra,
  });
}

function assertNoVoteMachinery(ctx) {
  assert.deepEqual(ctx.spy, { checkConvergence: 0, advanceCirclingStep: 0, isCirclingStepComplete: 0, markConverged: 0 },
    'no agreement machinery may run for a pipeline session');
  assert.equal(events(ctx, 'circling_gate').length, 0, 'no gate event');
  assert.equal(events(ctx, 'converged').length, 0, 'no converged event');
}

describe('pipeline mode through the real daemon handlers (2.7)', () => {
  let ctx;
  beforeEach(() => { ctx = makeContext(); });
  afterEach(() => { daemon.__test.clearPipelineTimers(); });

  it('dispatch: roles assigned, pass 1 opened, only the worker is notified', async () => {
    const id = await dispatched(ctx);
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
    assert.equal(s.pipeline.worker_node_id, 'w');
    assert.deepEqual([s.pipeline.reviewerA_node_id, s.pipeline.reviewerB_node_id], ['ra', 'rb']);
    assert.equal(s.pipeline.current_pass, 1);
    assert.ok(s.pipeline.pass_started_at);
    assert.equal(s.rounds.length, 1);

    const msgs = rounds(ctx);
    assert.equal(msgs.length, 1, 'D-f: exactly one round message');
    assert.ok(msgs[0].subject.endsWith('.node.w.round'));
    const m = msgs[0].payload;
    assert.equal(m.mode, 'pipeline');
    assert.equal(m.pipeline_pass, 1);
    assert.equal(m.pipeline_passes, 3);
    assert.equal(m.pipeline_role, 'worker');
    assert.equal(m.pipeline_artifact_type, 'workArtifact');
    assert.match(m.directed_input, /Write the design note/);
    assert.equal(events(ctx, 'pipeline_pass_started').length, 1);
    assert.equal(daemon.__test.pipelineTimerCount(), 1, 'the deadline is armed');
    assertNoVoteMachinery(ctx);
  });

  it('happy path: draft → both reviews → final → completed, task completed, no vote anywhere', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);

    let s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 2);
    assert.equal(s.pipeline.artifacts.workArtifact, BIG);
    assert.deepEqual(rounds(ctx).slice(1).map(p => p.subject.split('.node.')[1]), ['ra.round', 'rb.round'], 'pass 2 goes to both reviewers only');
    assert.ok(rounds(ctx)[1].payload.directed_input.includes(BIG.slice(0, 50)), 'reviewers see the draft');
    assert.equal(rounds(ctx)[1].payload.pipeline_artifact_type, 'reviewArtifact');

    await reflect(id, 'ra', 2, 'Finding A: tighten section 2.');
    s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 2, 'one review does not close the pass early');
    await reflect(id, 'rb', 2, 'Finding B: add evidence.');
    s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 3);
    const p3 = roundsTo(ctx, 'w')[1].payload;
    assert.equal(p3.pipeline_artifact_type, 'finalArtifact');
    assert.match(p3.directed_input, /Finding A/);
    assert.match(p3.directed_input, /Finding B/);

    await reflect(id, 'w', 3, FINAL);
    s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.equal(s.pipeline.outcome, 'completed');
    assert.deepEqual(s.pipeline.degraded, []);
    assert.deepEqual(s.result.artifacts, ['finalArtifact']);
    assert.equal(s.result.pipeline_final_type, 'finalArtifact');
    assert.equal(s.result.pipeline_final_artifact, FINAL);
    assert.equal(ctx.completed.length, 1, 'parent task completed once');
    assert.equal(ctx.completed[0].result.pipeline_final_artifact, FINAL);
    assert.equal(events(ctx, 'completed').length, 1);
    assert.equal(daemon.__test.pipelineTimerCount(), 0, 'no timer left armed');
    assertNoVoteMachinery(ctx);
  });

  it('REGRESSION (run-2 3-of-5): one reviewer silent forever — the deadline closes the pass, the session completes, the ledger names them', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    await reflect(id, 'ra', 2, 'Finding A.');
    // rb never submits, never leaves, is never marked dead.
    let s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 2, 'still waiting inside the budget');
    assert.equal(daemon.__test.pipelineTimerCount(), 1);

    await daemon.__test.handlePipelinePassTimeout(id, { pass: 2 });
    s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 3, 'pass 3 opened by deadline, not by agreement');
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[2, 'rb', PIPELINE_DEGRADATION.TIMEOUT]]);
    assert.equal(s.nodes.find(n => n.node_id === 'rb').status, 'active', 'the silent reviewer is NOT marked dead');
    const p3 = roundsTo(ctx, 'w')[1].payload;
    assert.match(p3.directed_input, /Finding A/);
    assert.match(p3.directed_input, /\[REVIEW UNAVAILABLE — timeout\]/, 'the reviser sees the hole');

    await reflect(id, 'w', 3, FINAL);
    s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.equal(s.pipeline.outcome, 'completed_degraded');
    assert.equal(s.result.pipeline_final_type, 'finalArtifact');
    assert.deepEqual(s.result.pipeline_degraded.map(d => d.node_id), ['rb']);
    assert.equal(ctx.completed.length, 1);
    assertNoVoteMachinery(ctx);
  });

  it('T2 draft absent: the pass-1 deadline with no artifact is an honest FAILED (ABORTED + outcome failed), never a hang', async () => {
    const id = await dispatched(ctx);
    await daemon.__test.handlePipelinePassTimeout(id, { pass: 1 });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ABORTED);
    assert.equal(s.pipeline.outcome, 'failed');
    assert.match(s.result.summary, /no draft artifact/);
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[1, 'w', 'timeout']]);
    assert.equal(ctx.failed.length, 1, 'parent task failed');
    assert.equal(ctx.completed.length, 0);
    assert.equal(events(ctx, 'aborted').length, 1);
    assert.equal(daemon.__test.pipelineTimerCount(), 0);
    assertNoVoteMachinery(ctx);
  });

  it('T2 revision absent: the pass-3 deadline ships the DRAFT flagged degraded', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    await reflect(id, 'ra', 2, 'A.');
    await reflect(id, 'rb', 2, 'B.');
    await daemon.__test.handlePipelinePassTimeout(id, { pass: 3 });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.equal(s.pipeline.outcome, 'completed_degraded');
    assert.deepEqual(s.result.artifacts, ['workArtifact']);
    assert.equal(s.result.pipeline_final_type, 'workArtifact');
    assert.equal(s.result.pipeline_final_artifact, BIG);
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[3, 'w', 'timeout']]);
    assert.equal(ctx.completed.length, 1);
    assertNoVoteMachinery(ctx);
  });

  it('T3 cost ceiling: crossing max_cost_usd closes the pass and completes with what exists — no further pass spends', async () => {
    const id = await dispatched(ctx, { max_cost_usd: 1.0 });
    await reflect(id, 'w', 1, BIG, { usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.4 } });
    let s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 2);
    await reflect(id, 'ra', 2, 'A.', { usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.7 } });
    s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED, 'completed straight from pass 2');
    assert.equal(s.pipeline.current_pass, 2, 'pass 3 never opened');
    assert.ok(Math.abs(s.pipeline.usage_total.cost_usd - 1.1) < 1e-9);
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [
      [2, null, PIPELINE_DEGRADATION.COST_CEILING],
      [2, 'rb', PIPELINE_DEGRADATION.NEVER_SUBMITTED],
    ]);
    assert.equal(s.result.pipeline_final_type, 'workArtifact', 'no final exists; the draft ships');
    assert.equal(s.pipeline.outcome, 'completed_degraded');
    assert.equal(roundsTo(ctx, 'w').length, 1, 'the worker was never asked for a revision');
    assertNoVoteMachinery(ctx);
  });

  it('a reviewer leaving mid-pass degrades, never aborts; the pass closes once the other has spoken', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    await reflect(id, 'ra', 2, 'A.');
    await daemon.__test.leave({ session_id: id, node_id: 'rb', reason: 'crash' });
    let s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE, 'not aborted on member count');
    assert.equal(s.pipeline.current_pass, 3, 'closed early: only the departed member was still owed');
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[2, 'rb', PIPELINE_DEGRADATION.NODE_DEAD]]);
    await reflect(id, 'w', 3, FINAL);
    s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.equal(s.pipeline.outcome, 'completed_degraded');
    assertNoVoteMachinery(ctx);
  });

  it('the worker leaving during the draft pass fails fast — no budget burned waiting for the gone', async () => {
    const id = await dispatched(ctx);
    await daemon.__test.leave({ session_id: id, node_id: 'w', reason: 'crash' });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ABORTED);
    assert.equal(s.pipeline.outcome, 'failed');
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[1, 'w', PIPELINE_DEGRADATION.NODE_DEAD]]);
    assert.equal(ctx.failed.length, 1);
    assertNoVoteMachinery(ctx);
  });

  it('a dead member is skipped at notify time and ledgered node_dead at the deadline', async () => {
    const id = await dispatched(ctx);
    await ctx.collabStore.setNodeStatus(id, 'rb', 'dead');
    await reflect(id, 'w', 1, BIG);
    assert.deepEqual(rounds(ctx).slice(1).map(p => p.subject.split('.node.')[1]), ['ra.round'], 'the dead reviewer is not notified');
    await reflect(id, 'ra', 2, 'A.');
    await daemon.__test.handlePipelinePassTimeout(id, { pass: 2 });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 3);
    assert.equal(s.nodes.length, 3, 'the roster never shrinks');
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[2, 'rb', PIPELINE_DEGRADATION.NODE_DEAD]]);
    assertNoVoteMachinery(ctx);
  });

  it('parse failures: two retries then success stores the artifact with no ledger entry; three failures count as submitted with one', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    // reviewer A: fail, fail, succeed
    let r = await reflect(id, 'ra', 2, null, { parse_failed: true });
    assert.deepEqual(r.data, { status: 'retried', failure_count: 1 });
    assert.equal(roundsTo(ctx, 'ra').at(-1).payload.parse_retry, 1, 'the directed input was re-sent to A only');
    r = await reflect(id, 'ra', 2, null, { parse_failed: true });
    assert.deepEqual(r.data, { status: 'retried', failure_count: 2 });
    await reflect(id, 'ra', 2, 'A finally.');
    // reviewer B: fail ×3 → degraded, counts as submitted
    await reflect(id, 'rb', 2, null, { parse_failed: true });
    await reflect(id, 'rb', 2, null, { parse_failed: true });
    await reflect(id, 'rb', 2, null, { parse_failed: true });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 3, 'both reviewers counted; pass 3 opened without a deadline');
    assert.equal(s.pipeline.artifacts.reviewArtifacts.reviewerA, 'A finally.');
    assert.equal(s.pipeline.artifacts.reviewArtifacts.reviewerB, undefined);
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[2, 'rb', PIPELINE_DEGRADATION.PARSE_FAILURE]]);
    assert.match(roundsTo(ctx, 'w')[1].payload.directed_input, /\[REVIEW UNAVAILABLE — parse_failure\]/);
    assertNoVoteMachinery(ctx);
  });

  it('a mislabelled type: line does not cost the delivery — stored positionally and audited', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG, { type: 'reviewStrategy' });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.artifacts.workArtifact, BIG);
    assert.ok(s.audit_log.some(e => e.event === 'pipeline_artifact_relabelled' && e.declared === 'reviewStrategy' && e.stored_as === 'workArtifact'));
    assert.equal(s.pipeline.current_pass, 2);
  });

  it('a submission with nothing usable and no parse flag still counts, and is ledgered parse_failure', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    await reflect(id, 'ra', 2, '   ');
    await reflect(id, 'rb', 2, 'B.');
    const s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 3);
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[2, 'ra', PIPELINE_DEGRADATION.PARSE_FAILURE]]);
  });

  it('evaluateRound on a pipeline session is a no-op: no claim, no vote, no state change', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    const before = await ctx.collabStore.get(id);
    await daemon.__test.evaluateRound(id);
    const after = await ctx.collabStore.get(id);
    assert.equal(after.status, COLLAB_STATUS.ACTIVE);
    assert.equal(after.pipeline.current_pass, before.pipeline.current_pass);
    assert.equal(after.rounds.at(-1).evaluated, undefined, 'the round was never claimed');
    assertNoVoteMachinery(ctx);
  });

  it('restart rehydration: with in-memory timers gone, the sweep closes a stale pass from pass_started_at', async () => {
    const id = await dispatched(ctx, { pass_budget_ms: 1000 });
    daemon.__test.clearPipelineTimers();                 // simulate a daemon restart
    const s0 = await ctx.collabStore.get(id);
    s0.pipeline.pass_started_at = new Date(Date.now() - 5000).toISOString();
    await ctx.collabStore.put(s0);
    await daemon.__test.sweepPipelinePassTimeouts();
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ABORTED, 'pass 1 closed with no draft → failed');
    assert.deepEqual(s.pipeline.degraded.map(d => [d.pass, d.node_id, d.reason]), [[1, 'w', 'timeout']]);
    assertNoVoteMachinery(ctx);
  });

  it('the sweep leaves a fresh pass alone', async () => {
    const id = await dispatched(ctx, { pass_budget_ms: 60_000 });
    daemon.__test.clearPipelineTimers();
    await daemon.__test.sweepPipelinePassTimeouts();
    const s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
    assert.equal(s.pipeline.current_pass, 1);
  });

  it('a stale timeout snapshot (pass already moved on) is ignored', async () => {
    const id = await dispatched(ctx);
    await reflect(id, 'w', 1, BIG);
    await daemon.__test.handlePipelinePassTimeout(id, { pass: 1 });
    const s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 2);
    assert.deepEqual(s.pipeline.degraded, []);
  });

  it('five passes: draft → review → revise → review → final, with the revise overwriting the draft', async () => {
    const id = await dispatched(ctx, { passes: 5 });
    await reflect(id, 'w', 1, BIG);
    await reflect(id, 'ra', 2, 'A1.');
    await reflect(id, 'rb', 2, 'B1.');
    const REVISED = 'Revised draft after round one of review. '.repeat(15);
    await reflect(id, 'w', 3, REVISED, { type: 'workArtifact' });
    let s = await ctx.collabStore.get(id);
    assert.equal(s.pipeline.current_pass, 4);
    assert.equal(s.pipeline.artifacts.workArtifact, REVISED);
    assert.ok(roundsTo(ctx, 'ra')[1].payload.directed_input.includes(REVISED.slice(0, 40)), 'second review sees the revision');
    await reflect(id, 'ra', 4, 'A2.');
    await reflect(id, 'rb', 4, 'B2.');
    await reflect(id, 'w', 5, FINAL);
    s = await ctx.collabStore.get(id);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.equal(s.pipeline.outcome, 'completed');
    assert.equal(s.result.pipeline_final_artifact, FINAL);
    assertNoVoteMachinery(ctx);
  });

  it('recruit close below the topology aborts loudly and releases the task', async () => {
    const s = await recruited(ctx, { min_nodes: 2, max_nodes: 2 }, ['w', 'ra']);
    await daemon.__test.handleCollabJoinDispatch(s);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(ctx.released.length, 1);
    assert.match(ctx.released[0].reason, /insufficient role distribution/);
  });
});
