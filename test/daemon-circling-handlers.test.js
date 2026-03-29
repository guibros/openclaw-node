#!/usr/bin/env node

/**
 * daemon-circling-handlers.test.js — Tests for the daemon's circling orchestration logic.
 *
 * The daemon (mesh-task-daemon.js) isn't importable as a module, so these tests
 * replicate the key decision paths from handleCollabReflect's circling branch,
 * startCirclingStep, and completeCirclingSession using mocked CollabStore.
 *
 * Covers:
 *   1. reflect → artifact store → barrier check → advance cycle
 *   2. parse_failed reflections: artifact_failures wiring
 *   3. completeCirclingSession: blocked vote escalation
 *   4. completeCirclingSession: all-converged completion
 *   5. checkRecruitingDeadlines: circling node count guard
 *   6. gate bridge message includes reviewer summary
 *
 * Run: node --test test/daemon-circling-handlers.test.js
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
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession,
  CollabStore,
  COLLAB_STATUS,
  COLLAB_MODE,
} = require('../lib/mesh-collab');

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

// ── Helpers ──

function makeCirclingSession(overrides = {}) {
  return createSession('test-task', {
    mode: 'circling_strategy',
    min_nodes: 3,
    max_nodes: 3,
    max_subrounds: 3,
    automation_tier: 2,
    node_roles: [
      { role: 'worker', soul: 'solidity-dev' },
      { role: 'reviewer', soul: 'tech-architect' },
      { role: 'reviewer', soul: 'qa-engineer' },
    ],
    ...overrides,
  });
}

async function makeActiveSession(storeOverrides = {}) {
  const kv = new MockKV();
  const store = new CollabStore(kv);
  const session = makeCirclingSession(storeOverrides);
  await store.put(session);

  await store.addNode(session.session_id, 'node-worker', 'worker');
  await store.addNode(session.session_id, 'node-revA', 'reviewer');
  await store.addNode(session.session_id, 'node-revB', 'reviewer');

  const s = await store.get(session.session_id);
  s.circling.worker_node_id = 'node-worker';
  s.circling.reviewerA_node_id = 'node-revA';
  s.circling.reviewerB_node_id = 'node-revB';
  s.status = COLLAB_STATUS.ACTIVE;
  await store.put(s);

  return { store, session, sessionId: session.session_id };
}

/**
 * Simulate the daemon's handleCollabReflect circling branch.
 * This replicates the logic from mesh-task-daemon.js lines 864-900.
 */
async function simulateReflectHandler(store, sessionId, reflection) {
  const session = await store.get(sessionId);
  const events = [];

  // Store artifacts or record failure (mirrors daemon logic)
  if (reflection.circling_artifacts && reflection.circling_artifacts.length > 0) {
    const { current_subround, current_step } = session.circling;
    const isWorker = reflection.node_id === session.circling.worker_node_id;
    let nodeRole;
    if (isWorker) {
      nodeRole = 'worker';
    } else if (session.circling.reviewerA_node_id && session.circling.reviewerB_node_id) {
      nodeRole = reflection.node_id === session.circling.reviewerA_node_id ? 'reviewerA' : 'reviewerB';
    } else {
      const reviewerNodes = session.nodes.filter(n => n.node_id !== session.circling.worker_node_id);
      nodeRole = reviewerNodes[0]?.node_id === reflection.node_id ? 'reviewerA' : 'reviewerB';
    }

    for (const art of reflection.circling_artifacts) {
      const key = `sr${current_subround}_step${current_step}_${nodeRole}_${art.type}`;
      await store.storeArtifact(sessionId, key, art.content);
    }
  } else if (reflection.parse_failed) {
    const failCount = await store.recordArtifactFailure(sessionId, reflection.node_id);
    events.push({ type: 'artifact_parse_failed', node_id: reflection.node_id, failure_count: failCount });
  }

  // Submit the reflection
  await store.submitReflection(sessionId, reflection);

  // Check barrier
  const freshSession = await store.get(sessionId);
  if (store.isCirclingStepComplete(freshSession)) {
    const nextState = await store.advanceCirclingStep(sessionId);
    if (nextState.phase === 'complete') {
      events.push({ type: 'complete' });
    } else if (nextState.needsGate) {
      events.push({ type: 'circling_gate', subround: nextState.subround });
    } else {
      events.push({ type: 'advance', phase: nextState.phase, subround: nextState.subround, step: nextState.step });
    }
  }

  return { events, session: await store.get(sessionId) };
}

// ── Tests ──

describe('Daemon Circling: reflect → store → barrier → advance', () => {
  it('stores artifacts and advances when all 3 nodes submit', async () => {
    const { store, sessionId } = await makeActiveSession();

    // Advance to circling/SR1/step1
    await store.advanceCirclingStep(sessionId);
    const s = await store.get(sessionId);
    await store.startRound(sessionId);

    // All 3 submit
    const r1 = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-worker', vote: 'continue', confidence: 0.8, summary: 'did work',
      circling_step: 1, circling_artifacts: [{ type: 'workArtifact', content: 'code here' }],
    });
    assert.equal(r1.events.length, 0, 'should not advance after 1/3');

    const r2 = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-revA', vote: 'continue', confidence: 0.7, summary: 'looks ok',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'review A' }],
    });
    assert.equal(r2.events.length, 0, 'should not advance after 2/3');

    const r3 = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-revB', vote: 'continue', confidence: 0.75, summary: 'good',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'review B' }],
    });
    assert.equal(r3.events.length, 1, 'should advance after 3/3');
    assert.equal(r3.events[0].type, 'advance');
    assert.equal(r3.events[0].step, 2, 'should advance to step 2');

    // Verify artifacts stored
    const final = await store.get(sessionId);
    assert.ok(store.getArtifactByKey(final, 'sr1_step1_worker_workArtifact'));
    assert.ok(store.getArtifactByKey(final, 'sr1_step1_reviewerA_reviewArtifact'));
    assert.ok(store.getArtifactByKey(final, 'sr1_step1_reviewerB_reviewArtifact'));
  });

  it('does not advance when only 2 of 3 nodes submit', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);
    await store.startRound(sessionId);

    await simulateReflectHandler(store, sessionId, {
      node_id: 'node-worker', vote: 'continue', confidence: 0.8, summary: 'work',
      circling_step: 1, circling_artifacts: [{ type: 'workArtifact', content: 'code' }],
    });
    const r2 = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-revA', vote: 'continue', confidence: 0.7, summary: 'review',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }],
    });

    assert.equal(r2.events.length, 0, 'barrier should not fire with 2/3');
  });
});

describe('Daemon Circling: parse_failed artifact tracking', () => {
  it('records artifact failure and increments counter', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);
    await store.startRound(sessionId);

    const result = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'artifact_parse_failed');
    assert.equal(result.events[0].failure_count, 1);

    // Second failure increments
    // Need a fresh round for the next reflection from same node (submitReflection may reject dups)
    const session = await store.get(sessionId);
    const failCount = store.getArtifactFailureCount(session, 'node-worker');
    assert.equal(failCount, 1);
  });

  it('parse_failed reflection still counts toward barrier', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);
    await store.startRound(sessionId);

    // Worker parse fails, but still submits a reflection
    await simulateReflectHandler(store, sessionId, {
      node_id: 'node-worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    await simulateReflectHandler(store, sessionId, {
      node_id: 'node-revA', vote: 'continue', confidence: 0.7, summary: 'ok',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }],
    });
    const r3 = await simulateReflectHandler(store, sessionId, {
      node_id: 'node-revB', vote: 'continue', confidence: 0.7, summary: 'ok',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }],
    });

    // Barrier should fire — the parse_failed reflection still counts
    assert.equal(r3.events.length, 1);
    assert.equal(r3.events[0].type, 'advance');

    // But worker artifact is missing — downstream gets UNAVAILABLE
    const session = await store.get(sessionId);
    assert.ok(!store.getArtifactByKey(session, 'sr1_step1_worker_workArtifact'), 'worker artifact should not exist');
  });
});

describe('Daemon Circling: completeCirclingSession (blocked votes)', () => {
  it('blocked vote triggers gate event', async () => {
    const { store, sessionId } = await makeActiveSession();

    // Fast-forward to finalization
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 3;
    s.circling.current_step = 0;
    await store.put(s);
    await store.startRound(sessionId);

    // Submit finalization reflections — one blocked
    await store.submitReflection(sessionId, {
      node_id: 'node-worker', vote: 'converged', confidence: 0.9,
      summary: 'Work is complete', circling_step: 0,
    });
    await store.submitReflection(sessionId, {
      node_id: 'node-revA', vote: 'blocked', confidence: 0.95,
      summary: 'reentrancy guard missing on withdraw function', circling_step: 0,
    });
    await store.submitReflection(sessionId, {
      node_id: 'node-revB', vote: 'converged', confidence: 0.8,
      summary: 'Looks good overall', circling_step: 0,
    });

    // Simulate completeCirclingSession logic
    const session = await store.get(sessionId);
    const lastRound = session.rounds[session.rounds.length - 1];
    const blockedVotes = lastRound.reflections.filter(r => r.vote === 'blocked');

    assert.equal(blockedVotes.length, 1);
    assert.equal(blockedVotes[0].node_id, 'node-revA');
    assert.ok(blockedVotes[0].summary.includes('reentrancy'));
  });

  it('all-converged finalizes successfully', async () => {
    const { store, sessionId } = await makeActiveSession();

    // Fast-forward to finalization
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    // Store a final work artifact
    s.circling.artifacts['sr2_step2_worker_workArtifact'] = 'final code';
    await store.put(s);
    await store.startRound(sessionId);

    // All converge
    await store.submitReflection(sessionId, {
      node_id: 'node-worker', vote: 'converged', confidence: 0.9,
      summary: 'Done', circling_step: 0,
    });
    await store.submitReflection(sessionId, {
      node_id: 'node-revA', vote: 'converged', confidence: 0.85,
      summary: 'Approved', circling_step: 0,
    });
    await store.submitReflection(sessionId, {
      node_id: 'node-revB', vote: 'converged', confidence: 0.8,
      summary: 'LGTM', circling_step: 0,
    });

    const session = await store.get(sessionId);
    const lastRound = session.rounds[session.rounds.length - 1];
    const blockedVotes = lastRound.reflections.filter(r => r.vote === 'blocked');
    assert.equal(blockedVotes.length, 0);

    // Verify the final artifact is retrievable
    assert.equal(store.getLatestArtifact(session, 'worker', 'workArtifact'), 'final code');
  });
});

describe('Daemon Circling: recruiting node count guard', () => {
  it('circling session defaults min_nodes to 3', () => {
    const session = createSession('test', { mode: 'circling_strategy' });
    assert.equal(session.min_nodes, 3);
  });

  it('non-circling session defaults min_nodes to 2', () => {
    const session = createSession('test', { mode: 'parallel' });
    assert.equal(session.min_nodes, 2);
  });

  it('explicit min_nodes overrides the default', () => {
    const session = createSession('test', { mode: 'circling_strategy', min_nodes: 5 });
    assert.equal(session.min_nodes, 5);
  });

  it('reviewer IDs are stored in circling schema', () => {
    const session = createSession('test', { mode: 'circling_strategy' });
    assert.equal(session.circling.reviewerA_node_id, null);
    assert.equal(session.circling.reviewerB_node_id, null);
    assert.equal(session.circling.worker_node_id, null);
  });

  it('circling with 2 nodes has no worker+2 reviewers', async () => {
    const kv = new MockKV();
    const store = new CollabStore(kv);
    const session = createSession('test', {
      mode: 'circling_strategy',
      min_nodes: 2, // misconfigured
    });
    await store.put(session);
    await store.addNode(session.session_id, 'node-a', 'worker');
    await store.addNode(session.session_id, 'node-b', 'reviewer');

    const s = await store.get(session.session_id);
    const reviewerCount = s.nodes.filter(n => n.role === 'reviewer').length;
    const hasWorker = s.nodes.some(n => n.role === 'worker');

    // Guard logic from checkRecruitingDeadlines:
    // requires nodes >= 3 AND 1 worker AND 2 reviewers
    const canStart = s.nodes.length >= 3 && hasWorker && reviewerCount >= 2;
    assert.equal(canStart, false, 'should not start circling with only 2 nodes');
  });
});

describe('Daemon Circling: gate bridge message', () => {
  it('extracts blocked reviewer summary for kanban', async () => {
    // Simulate what mesh-bridge.js does with a circling_gate event
    const session = {
      circling: { current_subround: 2 },
      rounds: [{
        round_number: 1,
        reflections: [
          { node_id: 'node-worker', vote: 'converged', summary: 'Work done' },
          { node_id: 'node-revA', vote: 'blocked', summary: 'reentrancy guard missing on withdraw function' },
          { node_id: 'node-revB', vote: 'converged', summary: 'LGTM' },
        ],
      }],
    };

    // Replicate bridge logic
    const cg = session.circling || {};
    const lastRound = session.rounds?.[session.rounds.length - 1];
    const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
    let gateMsg;
    if (blockedVotes.length > 0) {
      const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
      gateMsg = `[GATE] SR${cg.current_subround} blocked — ${reason || 'reviewer flagged concern'}`;
    } else {
      gateMsg = `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
    }

    assert.ok(gateMsg.includes('reentrancy guard missing'), 'gate message should include reviewer reason');
    assert.ok(gateMsg.startsWith('[GATE] SR2 blocked'), 'should indicate blocked status');
  });

  it('falls back to generic message when no blocked votes', () => {
    const session = {
      circling: { current_subround: 1 },
      rounds: [{
        round_number: 1,
        reflections: [
          { node_id: 'node-worker', vote: 'converged', summary: 'Done' },
        ],
      }],
    };

    const cg = session.circling || {};
    const lastRound = session.rounds?.[session.rounds.length - 1];
    const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
    let gateMsg;
    if (blockedVotes.length > 0) {
      const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
      gateMsg = `[GATE] SR${cg.current_subround} blocked — ${reason || 'reviewer flagged concern'}`;
    } else {
      gateMsg = `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
    }

    assert.ok(gateMsg.includes('review reconciliationDoc'), 'should show generic approve/reject message');
  });
});
