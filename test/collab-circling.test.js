#!/usr/bin/env node

/**
 * collab-circling.test.js — Unit tests for Circling Strategy collab mode.
 *
 * Tests: session creation, artifact store, getLatestArtifact backward scan,
 * compileDirectedInput per role per step, advanceCirclingStep state machine,
 * isCirclingStepComplete, parseCirclingReflection (single + multi-artifact).
 *
 * Run: node --test test/collab-circling.test.js
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

function makeCirclingSession() {
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
  });
}

async function makeStoreWithSession() {
  const kv = new MockKV();
  const store = new CollabStore(kv);
  const session = makeCirclingSession();
  await store.put(session);

  // Add 3 nodes
  await store.addNode(session.session_id, 'node-worker', 'worker');
  await store.addNode(session.session_id, 'node-revA', 'reviewer');
  await store.addNode(session.session_id, 'node-revB', 'reviewer');

  // Set role IDs (assigned at recruiting close)
  const s = await store.get(session.session_id);
  s.circling.worker_node_id = 'node-worker';
  s.circling.reviewerA_node_id = 'node-revA';
  s.circling.reviewerB_node_id = 'node-revB';
  await store.put(s);

  return { store, session, sessionId: session.session_id };
}

// ── Tests ──

describe('Circling Strategy: Session Creation', () => {
  it('creates session with circling fields', () => {
    const session = makeCirclingSession();
    assert.equal(session.mode, 'circling_strategy');
    assert.ok(session.circling);
    assert.equal(session.circling.phase, 'init');
    assert.equal(session.circling.current_subround, 0);
    assert.equal(session.circling.current_step, 0);
    assert.equal(session.circling.max_subrounds, 3);
    assert.equal(session.circling.automation_tier, 2);
    assert.deepEqual(session.circling.artifacts, {});
  });

  it('has reviewer ID slots initialized to null', () => {
    const session = makeCirclingSession();
    assert.equal(session.circling.reviewerA_node_id, null);
    assert.equal(session.circling.reviewerB_node_id, null);
  });

  it('has step_started_at initialized to null', () => {
    const session = makeCirclingSession();
    assert.equal(session.circling.step_started_at, null);
  });

  it('non-circling session has null circling field', () => {
    const session = createSession('test', { mode: 'parallel' });
    assert.equal(session.circling, null);
  });
});

describe('Circling Strategy: Artifact Store', () => {
  it('stores and retrieves artifacts', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'hello world');
    const session = await store.get(sessionId);
    assert.equal(store.getArtifactByKey(session, 'sr0_step0_worker_workArtifact'), 'hello world');
  });

  it('getLatestArtifact scans backward', async () => {
    const { store, sessionId } = await makeStoreWithSession();

    // Store init artifact
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'v0 content');

    // Store SR1 step 2 artifact (newer)
    await store.storeArtifact(sessionId, 'sr1_step2_worker_workArtifact', 'v1 content');

    const session = await store.get(sessionId);
    session.circling.current_subround = 2; // simulate being in SR2

    // Should find the SR1/step2 version (most recent)
    assert.equal(store.getLatestArtifact(session, 'worker', 'workArtifact'), 'v1 content');
  });

  it('getLatestArtifact falls back to init', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'init content');

    const session = await store.get(sessionId);
    session.circling.current_subround = 1;

    assert.equal(store.getLatestArtifact(session, 'worker', 'workArtifact'), 'init content');
  });

  it('getLatestArtifact returns null when not found', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const session = await store.get(sessionId);
    assert.equal(store.getLatestArtifact(session, 'worker', 'nonexistent'), null);
  });
});

describe('Circling Strategy: compileDirectedInput', () => {
  it('init phase gives all nodes the task plan', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const session = await store.get(sessionId);

    const workerInput = store.compileDirectedInput(session, 'node-worker', 'Build ManaToken');
    const revAInput = store.compileDirectedInput(session, 'node-revA', 'Build ManaToken');

    assert.ok(workerInput.includes('Task Plan'));
    assert.ok(workerInput.includes('Build ManaToken'));
    assert.ok(revAInput.includes('Task Plan'));
  });

  it('step 1: worker gets reviewStrategies, reviewers get workArtifact', async () => {
    const { store, sessionId } = await makeStoreWithSession();

    // Store init artifacts
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'pragma solidity ^0.8.0;');
    await store.storeArtifact(sessionId, 'sr0_step0_reviewerA_reviewStrategy', 'Focus on reentrancy');
    await store.storeArtifact(sessionId, 'sr0_step0_reviewerB_reviewStrategy', 'Focus on gas optimization');

    // Advance to circling/SR1/step1
    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 1;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', '');
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', '');

    assert.ok(workerInput.includes('Focus on reentrancy'), 'Worker should get reviewerA strategy');
    assert.ok(workerInput.includes('Focus on gas optimization'), 'Worker should get reviewerB strategy');
    assert.ok(revAInput.includes('pragma solidity'), 'Reviewer should get workArtifact');
    assert.ok(!revAInput.includes('Focus on reentrancy'), 'Reviewer should NOT get strategies');
  });

  it('step 1 SR1: reconciliationDoc is optional (skip silently)', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'code here');

    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 1;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const revInput = store.compileDirectedInput(fresh, 'node-revA', '');

    // Should NOT contain UNAVAILABLE notice for reconciliationDoc in SR1
    assert.ok(!revInput.includes('UNAVAILABLE'), 'reconciliationDoc should be skipped silently in SR1');
  });

  it('step 1 SR2+: worker gets reviewArtifacts alongside strategies', async () => {
    const { store, sessionId } = await makeStoreWithSession();

    // Store init + SR1 artifacts
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'pragma solidity ^0.8.0;');
    await store.storeArtifact(sessionId, 'sr0_step0_reviewerA_reviewStrategy', 'Focus on reentrancy');
    await store.storeArtifact(sessionId, 'sr0_step0_reviewerB_reviewStrategy', 'Focus on gas');
    await store.storeArtifact(sessionId, 'sr1_step1_reviewerA_reviewArtifact', 'Found reentrancy in withdraw()');
    await store.storeArtifact(sessionId, 'sr1_step1_reviewerB_reviewArtifact', 'Gas costs acceptable');

    // Advance to SR2/step1
    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 2;
    session.circling.current_step = 1;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', '');

    assert.ok(workerInput.includes('Focus on reentrancy'), 'Worker should get reviewerA strategy');
    assert.ok(workerInput.includes('Found reentrancy'), 'Worker should get reviewerA artifact in SR2+');
    assert.ok(workerInput.includes('Gas costs acceptable'), 'Worker should get reviewerB artifact in SR2+');
  });

  it('step 1 SR1: worker does NOT get reviewArtifacts (none exist yet)', async () => {
    const { store, sessionId } = await makeStoreWithSession();

    await store.storeArtifact(sessionId, 'sr0_step0_reviewerA_reviewStrategy', 'Focus on reentrancy');
    await store.storeArtifact(sessionId, 'sr0_step0_reviewerB_reviewStrategy', 'Focus on gas');

    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 1;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', '');

    assert.ok(workerInput.includes('Focus on reentrancy'), 'Worker should get strategies');
    // No Review Findings sections in SR1
    assert.ok(!workerInput.includes('Review Findings'), 'Worker should NOT get review findings in SR1');
  });

  it('step 2: reviewer gets cross-review from other reviewer', async () => {
    const { store, sessionId } = await makeStoreWithSession();

    await store.storeArtifact(sessionId, 'sr1_step1_reviewerA_reviewArtifact', 'Found reentrancy bug');
    await store.storeArtifact(sessionId, 'sr1_step1_reviewerB_reviewArtifact', 'Gas optimization needed');
    await store.storeArtifact(sessionId, 'sr1_step2_worker_workerReviewsAnalysis', 'Both strategies valid');

    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 2;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', '');
    const revBInput = store.compileDirectedInput(fresh, 'node-revB', '');

    // RevA gets worker analysis + RevB's cross-review
    assert.ok(revAInput.includes('Both strategies valid'), 'RevA should get worker analysis');
    assert.ok(revAInput.includes('Gas optimization needed'), 'RevA should get RevB cross-review');
    assert.ok(!revAInput.includes('Found reentrancy bug'), 'RevA should NOT get own review');

    // RevB gets worker analysis + RevA's cross-review
    assert.ok(revBInput.includes('Both strategies valid'), 'RevB should get worker analysis');
    assert.ok(revBInput.includes('Found reentrancy bug'), 'RevB should get RevA cross-review');
    assert.ok(!revBInput.includes('Gas optimization needed'), 'RevB should NOT get own review');
  });

  it('step 1 SR2+: missing reconciliationDoc shows UNAVAILABLE', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    await store.storeArtifact(sessionId, 'sr0_step0_worker_workArtifact', 'code here');

    const session = await store.get(sessionId);
    session.circling.phase = 'circling';
    session.circling.current_subround = 2; // SR2 — reconciliationDoc should exist
    session.circling.current_step = 1;
    await store.put(session);

    const fresh = await store.get(sessionId);
    const revInput = store.compileDirectedInput(fresh, 'node-revA', '');

    assert.ok(revInput.includes('UNAVAILABLE'), 'reconciliationDoc should show UNAVAILABLE in SR2+');
  });
});

describe('Circling Strategy: advanceCirclingStep state machine', () => {
  it('init → circling/SR1/step1', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling');
    assert.equal(result.subround, 1);
    assert.equal(result.step, 1);
    assert.equal(result.needsGate, false);
  });

  it('step1 → step2 (same subround)', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 1;
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling');
    assert.equal(result.subround, 1);
    assert.equal(result.step, 2);
  });

  it('step2 SR<max → next SR/step1', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1; // no gate
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling');
    assert.equal(result.subround, 2);
    assert.equal(result.step, 1);
    assert.equal(result.needsGate, false);
  });

  it('step2 SR<max tier3 → gates', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 3;
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.needsGate, true);
  });

  it('step2 SR==max → finalization', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 3; // max_subrounds = 3
    s.circling.current_step = 2;
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization');
    assert.equal(result.step, 0);
    assert.equal(result.needsGate, true); // tier 2 gates on finalization
  });

  it('finalization → complete', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'complete');
  });

  it('adaptive convergence: all converged in step 2 SR<max → early finalization', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1; // SR1, max=3 → SR<max
    s.circling.current_step = 2;
    s.circling.automation_tier = 1; // no gate
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revB', circling_step: 2, vote: 'converged' },
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization', 'should skip to finalization on all-converged');
    assert.equal(result.step, 0);
  });

  it('adaptive convergence: 2 converged + 1 continue → does NOT early exit', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'continue' },
        { node_id: 'node-revB', circling_step: 2, vote: 'converged' },
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling', 'should NOT early exit with mixed votes');
    assert.equal(result.subround, 2, 'should advance to next SR');
    assert.equal(result.step, 1);
  });

  it('adaptive convergence: all converged at SR==max → normal finalization (not early)', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 3; // SR==max
    s.circling.current_step = 2;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revB', circling_step: 2, vote: 'converged' },
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization', 'should finalize at SR==max regardless');
    assert.equal(result.needsGate, true, 'tier 2 gates on finalization');
  });
});

describe('Circling Strategy: isCirclingStepComplete', () => {
  it('returns false when not all nodes submitted', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.current_step = 1;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 1, vote: 'continue' },
        { node_id: 'node-revA', circling_step: 1, vote: 'continue' },
      ],
    }];
    await store.put(s);

    const fresh = await store.get(sessionId);
    assert.equal(store.isCirclingStepComplete(fresh), false);
  });

  it('returns true when all nodes submitted for current step', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.current_step = 1;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 1, vote: 'continue' },
        { node_id: 'node-revA', circling_step: 1, vote: 'continue' },
        { node_id: 'node-revB', circling_step: 1, vote: 'continue' },
      ],
    }];
    await store.put(s);

    const fresh = await store.get(sessionId);
    assert.equal(store.isCirclingStepComplete(fresh), true);
  });

  it('ignores reflections from different step', async () => {
    const { store, sessionId } = await makeStoreWithSession();
    const s = await store.get(sessionId);
    s.circling.current_step = 2;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 1, vote: 'continue' }, // wrong step
        { node_id: 'node-revA', circling_step: 2, vote: 'continue' },
        { node_id: 'node-revB', circling_step: 2, vote: 'continue' },
      ],
    }];
    await store.put(s);

    const fresh = await store.get(sessionId);
    assert.equal(store.isCirclingStepComplete(fresh), false);
  });
});

// Import the production parser — same module used by mesh-agent.js.
// No inline copy drift risk.
const { parseCirclingReflection: parseCirclingReflectionInline } = require('../lib/circling-parser');

describe('Circling Strategy: parseCirclingReflection', () => {

  it('parses single-artifact output', () => {
    const output = `pragma solidity ^0.8.0;
contract ManaToken { }

===CIRCLING_REFLECTION===
type: workArtifact
summary: Initial implementation of ManaToken
confidence: 0.8
vote: continue
===END_REFLECTION===`;

    const result = parseCirclingReflectionInline(output);
    assert.equal(result.parse_failed, false);
    assert.equal(result.vote, 'continue');
    assert.equal(result.confidence, 0.8);
    assert.equal(result.circling_artifacts.length, 1);
    assert.equal(result.circling_artifacts[0].type, 'workArtifact');
    assert.ok(result.circling_artifacts[0].content.includes('pragma solidity'));
  });

  it('parses multi-artifact output (Worker Step 2)', () => {
    const output = `pragma solidity ^0.8.0;
contract ManaToken { uint256 public expiry; }

===CIRCLING_ARTIFACT===
type: workArtifact
===END_ARTIFACT===

## Reconciliation
- ACCEPTED: Added expiry field (Reviewer A finding #1)
- REJECTED: Gas optimization unnecessary (Reviewer B finding #3)

===CIRCLING_ARTIFACT===
type: reconciliationDoc
===END_ARTIFACT===

===CIRCLING_REFLECTION===
summary: Integrated 2 findings, rejected 1
confidence: 0.85
vote: continue
===END_REFLECTION===`;

    const result = parseCirclingReflectionInline(output);
    assert.equal(result.parse_failed, false);
    assert.equal(result.circling_artifacts.length, 2);
    assert.equal(result.circling_artifacts[0].type, 'workArtifact');
    assert.ok(result.circling_artifacts[0].content.includes('pragma solidity'));
    assert.equal(result.circling_artifacts[1].type, 'reconciliationDoc');
    assert.ok(result.circling_artifacts[1].content.includes('ACCEPTED'));
  });

  it('falls back on missing delimiters', () => {
    const output = 'Just some text without any delimiters';
    const result = parseCirclingReflectionInline(output);
    assert.equal(result.parse_failed, true);
  });

  it('handles blocked vote', () => {
    const output = `Critical reentrancy vulnerability found.

===CIRCLING_REFLECTION===
type: reviewArtifact
summary: Found critical reentrancy in withdraw()
confidence: 0.95
vote: blocked
===END_REFLECTION===`;

    const result = parseCirclingReflectionInline(output);
    assert.equal(result.vote, 'blocked');
    assert.equal(result.confidence, 0.95);
  });
});
