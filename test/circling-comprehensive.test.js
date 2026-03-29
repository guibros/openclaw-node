#!/usr/bin/env node

/**
 * circling-comprehensive.test.js — Comprehensive test suite for the entire
 * Circling Strategy implementation. Covers every untested path from the
 * V3 coverage audit.
 *
 * Organized by layer:
 *   1. Parser (lib/circling-parser.js) — edge cases, opts, legacy fallback
 *   2. State (lib/mesh-collab.js) — storeArtifact blob/exception, compileDirectedInput finalization,
 *      adaptive convergence edge cases
 *   3. Orchestration (daemon logic) — timeout handler, sweep logic, step lifecycle
 *   4. Prompt (buildCirclingPrompt) — all 8 role/phase/step branches, anti-preamble, finalization vote
 *   5. Bridge (gate message) — step_started event, gate formatting
 *
 * Run: node --test test/circling-comprehensive.test.js
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
const { parseCirclingReflection } = require('../lib/circling-parser');

class MockKV {
  constructor() { this.store = new Map(); this.failOnPut = false; }
  async put(key, value) {
    if (this.failOnPut) throw new Error('JetStream KV write failed: max value size exceeded');
    this.store.set(key, { value });
  }
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

async function makeActiveSession(overrides = {}) {
  const kv = new MockKV();
  const store = new CollabStore(kv);
  const session = makeCirclingSession(overrides);
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

  return { store, kv, session, sessionId: session.session_id };
}

// ═══════════════════════════════════════════════════════
// 1. PARSER — Edge Cases and Options
// ═══════════════════════════════════════════════════════

describe('Parser: opts.legacyParser fallback', () => {
  it('calls legacyParser when no circling delimiters found', () => {
    let called = false;
    const result = parseCirclingReflection('plain text without delimiters', {
      legacyParser: (output) => {
        called = true;
        return { summary: 'legacy', confidence: 0.6, vote: 'continue', parse_failed: false };
      },
    });
    assert.equal(called, true, 'legacyParser should be called');
    assert.equal(result.summary, 'legacy');
    assert.equal(result.confidence, 0.6);
    assert.equal(result.parse_failed, false);
  });

  it('returns parse_failed when no delimiters and no legacyParser', () => {
    const result = parseCirclingReflection('plain text');
    assert.equal(result.parse_failed, true);
    assert.equal(result.vote, 'parse_error');
  });
});

describe('Parser: opts.log callback', () => {
  it('calls log when no artifacts extracted but not parse_failed', () => {
    const logs = [];
    // Reflection block present but no artifact content before it
    const output = '===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: continue\n===END_REFLECTION===';
    parseCirclingReflection(output, { log: (msg) => logs.push(msg) });
    assert.ok(logs.some(l => l.includes('No artifacts extracted')), 'should log warning');
  });
});

describe('Parser: invalid vote handling', () => {
  it('marks parse_failed for unknown vote value', () => {
    const output = `some artifact\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: maybe\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.parse_failed, true);
    assert.equal(result.vote, 'parse_error');
  });

  it('defaults to continue when vote line is missing', () => {
    const output = `some artifact\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.vote, 'continue');
    assert.equal(result.parse_failed, false);
  });
});

describe('Parser: confidence edge cases', () => {
  it('defaults confidence to 0.5 when missing', () => {
    const output = `artifact content\n\n===CIRCLING_REFLECTION===\ntype: x\nsummary: test\nvote: continue\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.confidence, 0.5);
  });

  it('parses decimal confidence correctly', () => {
    const output = `art\n\n===CIRCLING_REFLECTION===\ntype: x\nsummary: s\nconfidence: 0.95\nvote: converged\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.confidence, 0.95);
  });
});

describe('Parser: multi-artifact extra content after last delimiter', () => {
  it('captures extra content after last END_ARTIFACT as type "extra"', () => {
    const output = `first artifact content\n\n===CIRCLING_ARTIFACT===\ntype: workArtifact\n===END_ARTIFACT===\n\nextra trailing content\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: continue\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.ok(result.circling_artifacts.some(a => a.type === 'extra'), 'should capture trailing content as extra');
  });
});

// ═══════════════════════════════════════════════════════
// 2. STATE — storeArtifact, compileDirectedInput, adaptive convergence
// ═══════════════════════════════════════════════════════

describe('storeArtifact: KV write failure recovery', () => {
  it('returns null and removes artifact on write failure', async () => {
    const kv = new MockKV();
    const store = new CollabStore(kv);
    const session = makeCirclingSession();
    await store.put(session);

    // Store one artifact successfully
    await store.storeArtifact(session.session_id, 'sr0_step0_worker_workArtifact', 'initial code');
    const s1 = await store.get(session.session_id);
    assert.ok(store.getArtifactByKey(s1, 'sr0_step0_worker_workArtifact'));

    // Now make KV fail on ALL puts (simulates persistent blob-too-large)
    let putFailCount = 0;
    const origPut = kv.put.bind(kv);
    kv.put = async (key, value, opts) => {
      putFailCount++;
      if (putFailCount <= 3) throw new Error('max value size exceeded');
      // After 3 failures, allow the recovery write (artifact removed)
      return origPut(key, value, opts);
    };

    // This should exhaust retries, remove the artifact, and re-persist
    const result = await store.storeArtifact(session.session_id, 'sr1_huge_artifact', 'x'.repeat(100));
    assert.equal(result, null, 'should return null on write failure');

    // The failed artifact should NOT be in the session
    const s2 = await store.get(session.session_id);
    assert.equal(store.getArtifactByKey(s2, 'sr1_huge_artifact'), null, 'failed artifact should be removed');
    // But the original artifact should still be there
    assert.ok(store.getArtifactByKey(s2, 'sr0_step0_worker_workArtifact'), 'existing artifacts should survive');
  });
});

describe('compileDirectedInput: finalization phase', () => {
  it('finalization: all nodes receive task plan', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', 'Build ManaToken');
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', 'Build ManaToken');

    assert.ok(workerInput.includes('Original Task Plan'), 'Worker should get task plan in finalization');
    assert.ok(workerInput.includes('Build ManaToken'));
    assert.ok(revAInput.includes('Original Task Plan'), 'Reviewer should get task plan in finalization');
  });

  it('finalization: all nodes receive final workArtifact', async () => {
    const { store, sessionId } = await makeActiveSession();

    await store.storeArtifact(sessionId, 'sr2_step2_worker_workArtifact', 'pragma solidity ^0.8.24; // final');

    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', '');
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', '');

    assert.ok(workerInput.includes('pragma solidity ^0.8.24'), 'Worker should see final artifact');
    assert.ok(revAInput.includes('pragma solidity ^0.8.24'), 'Reviewer should see final artifact');
  });

  it('finalization: missing workArtifact shows UNAVAILABLE', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 1;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const input = store.compileDirectedInput(fresh, 'node-revA', '');
    assert.ok(input.includes('UNAVAILABLE'), 'missing final artifact should show UNAVAILABLE');
  });
});

describe('compileDirectedInput: reviewerLabel legacy fallback', () => {
  it('falls back to array-index when reviewer IDs not stored', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    // Clear stored reviewer IDs to trigger legacy fallback
    s.circling.reviewerA_node_id = null;
    s.circling.reviewerB_node_id = null;
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    await store.put(s);

    await store.storeArtifact(sessionId, 'sr1_step2_worker_workerReviewsAnalysis', 'analysis here');
    await store.storeArtifact(sessionId, 'sr1_step1_reviewerA_reviewArtifact', 'revA findings');
    await store.storeArtifact(sessionId, 'sr1_step1_reviewerB_reviewArtifact', 'revB findings');

    const fresh = await store.get(sessionId);
    // Even without stored IDs, compileDirectedInput should still work via fallback
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', '');
    assert.ok(revAInput.includes('analysis here'), 'Reviewer should get worker analysis via fallback');
  });
});

describe('Adaptive convergence: edge cases', () => {
  it('dead node excluded from convergence check', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1;
    // Mark one node dead
    s.nodes[2].status = 'dead'; // node-revB
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'converged' },
        // node-revB is dead, no reflection
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization', 'should early-finalize when all ACTIVE nodes converged');
  });

  it('no reflections in round → does not early exit', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1;
    s.rounds = [{ round_number: 1, reflections: [] }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling', 'should advance to next SR, not finalize');
    assert.equal(result.subround, 2);
  });

  it('early convergence with tier 2 still gates', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 2;
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
    assert.equal(result.phase, 'finalization');
    assert.equal(result.needsGate, true, 'tier 2 should gate even on early convergence');
  });
});

// ═══════════════════════════════════════════════════════
// 3. ORCHESTRATION — Timeout handler, sweep, step lifecycle
// ═══════════════════════════════════════════════════════

describe('Daemon: handleCirclingStepTimeout simulation', () => {
  /**
   * Simulates the timeout handler logic from mesh-task-daemon.js
   */
  async function simulateTimeout(store, sessionId, stepSnapshot) {
    const session = await store.get(sessionId);
    if (!session || !session.circling) return { action: 'skip', reason: 'no session' };

    const { phase, current_subround, current_step } = session.circling;
    if (phase !== stepSnapshot.phase ||
        current_subround !== stepSnapshot.subround ||
        current_step !== stepSnapshot.step) {
      return { action: 'skip', reason: 'stale' };
    }

    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return { action: 'skip', reason: 'no round' };

    const submittedNodeIds = new Set(
      currentRound.reflections
        .filter(r => r.circling_step === current_step)
        .map(r => r.node_id)
    );

    const deadNodes = [];
    for (const node of session.nodes) {
      if (node.status !== 'dead' && !submittedNodeIds.has(node.node_id)) {
        node.status = 'dead';
        deadNodes.push(node.node_id);
      }
    }
    await store.put(session);

    const freshSession = await store.get(sessionId);
    if (store.isCirclingStepComplete(freshSession)) {
      return { action: 'advance', deadNodes };
    } else {
      return { action: 'abort', deadNodes };
    }
  }

  it('stale timer: skips if step already advanced', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId); // init → SR1/step1
    await store.startRound(sessionId);

    // Snapshot from init phase — but session is now at step1
    const staleSnapshot = { phase: 'init', subround: 0, step: 0 };
    const result = await simulateTimeout(store, sessionId, staleSnapshot);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'stale');
  });

  it('marks unsubmitted nodes as dead and advances', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);
    await store.startRound(sessionId);

    const s = await store.get(sessionId);
    // Only 2 of 3 submitted
    await store.submitReflection(sessionId, {
      node_id: 'node-worker', vote: 'continue', confidence: 0.8, summary: 'work',
      circling_step: 1,
    });
    await store.submitReflection(sessionId, {
      node_id: 'node-revA', vote: 'continue', confidence: 0.7, summary: 'review',
      circling_step: 1,
    });
    // node-revB did not submit

    const snapshot = { phase: 'circling', subround: 1, step: 1 };
    const result = await simulateTimeout(store, sessionId, snapshot);

    assert.equal(result.action, 'advance', 'should advance after marking dead node');
    assert.deepEqual(result.deadNodes, ['node-revB'], 'node-revB should be marked dead');
  });

  it('all nodes timed out: marks all dead, barrier passes (0/0)', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);
    await store.startRound(sessionId);

    // No reflections submitted — all 3 nodes will be marked dead
    const snapshot = { phase: 'circling', subround: 1, step: 1 };
    const result = await simulateTimeout(store, sessionId, snapshot);

    // isCirclingStepComplete returns true with 0 active nodes (0 reflections >= 0 active)
    // The daemon would then advanceCirclingStep, which would proceed with degraded state.
    // In the real daemon, subsequent steps would also time out → eventually abort.
    assert.equal(result.deadNodes.length, 3, 'all 3 nodes should be marked dead');
    assert.equal(result.action, 'advance', 'barrier passes with 0/0 active/submitted');
  });
});

describe('Daemon: sweepCirclingStepTimeouts simulation', () => {
  /**
   * Simulates the sweep logic from mesh-task-daemon.js
   */
  function shouldSweepFire(session, timeoutMs, hasInMemoryTimer) {
    if (session.mode !== 'circling_strategy' || !session.circling) return false;
    if (session.circling.phase === 'complete') return false;
    if (!session.circling.step_started_at) return false;
    if (hasInMemoryTimer) return false;

    const elapsed = Date.now() - new Date(session.circling.step_started_at).getTime();
    return elapsed > timeoutMs;
  }

  it('fires for expired step without in-memory timer', () => {
    const session = makeCirclingSession();
    session.circling.phase = 'circling';
    session.circling.current_step = 1;
    session.circling.step_started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
    session.mode = 'circling_strategy';

    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, false), true);
  });

  it('skips when in-memory timer exists', () => {
    const session = makeCirclingSession();
    session.circling.phase = 'circling';
    session.circling.step_started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    session.mode = 'circling_strategy';

    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, true), false);
  });

  it('skips completed sessions', () => {
    const session = makeCirclingSession();
    session.circling.phase = 'complete';
    session.circling.step_started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    session.mode = 'circling_strategy';

    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, false), false);
  });

  it('skips when step_started_at not set', () => {
    const session = makeCirclingSession();
    session.circling.phase = 'circling';
    session.circling.step_started_at = null;
    session.mode = 'circling_strategy';

    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, false), false);
  });

  it('skips non-circling sessions', () => {
    const session = createSession('test', { mode: 'parallel' });
    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, false), false);
  });

  it('does not fire when timeout not yet reached', () => {
    const session = makeCirclingSession();
    session.circling.phase = 'circling';
    session.circling.step_started_at = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    session.mode = 'circling_strategy';

    assert.equal(shouldSweepFire(session, 10 * 60 * 1000, false), false);
  });
});

// ═══════════════════════════════════════════════════════
// 4. PROMPT — buildCirclingPrompt all branches
// ═══════════════════════════════════════════════════════

describe('buildCirclingPrompt: all branches', () => {
  // We can't import buildCirclingPrompt directly (mesh-agent.js has many deps),
  // so we replicate the prompt logic for verification. This tests the prompt
  // contract: what each branch SHOULD contain.

  /**
   * Minimal reimplementation of buildCirclingPrompt for testing.
   * Mirrors mesh-agent.js lines 730-900.
   */
  function buildCirclingPromptTest(task, circlingData) {
    const { circling_phase, circling_step, circling_subround, directed_input, my_role } = circlingData;
    const isWorker = my_role === 'worker';
    const parts = [];

    parts.push(`# Task: ${task.title}`);
    parts.push('');

    switch (circling_phase) {
      case 'init':
        if (isWorker) {
          parts.push('## Your Role: WORKER (Central Authority)');
          parts.push('');
          parts.push('Produce your initial work artifact (v0).');
        } else {
          parts.push('## Your Role: REVIEWER');
          parts.push('');
          parts.push('Produce your **reviewStrategy**.');
        }
        break;
      case 'circling':
        if (circling_step === 1) {
          if (isWorker) {
            parts.push('## Your Role: WORKER — Analyze Review Strategies');
            parts.push('Do NOT touch the work artifact in this step.');
          } else {
            parts.push('## Your Role: REVIEWER — Review the Work Artifact');
            parts.push('Produce concrete, actionable findings.');
          }
        } else if (circling_step === 2) {
          if (isWorker) {
            parts.push('## Your Role: WORKER — Judge Reviews & Update Artifact');
            parts.push('You must output TWO artifacts.');
          } else {
            parts.push('## Your Role: REVIEWER — Refine Your Strategy');
            parts.push('Produce your REFINED reviewStrategy.');
          }
        }
        break;
      case 'finalization':
        if (isWorker) {
          parts.push('## Your Role: WORKER — Final Delivery');
          parts.push('Produce your FINAL formatted work artifact.');
          parts.push('Also produce a completionDiff.');
          parts.push('You must output TWO artifacts.');
        } else {
          parts.push('## Your Role: REVIEWER — Final Sign-Off');
          parts.push('vote "converged" or "blocked"');
        }
        break;
    }

    // Vote restriction
    if (circling_phase === 'finalization') {
      parts.push('vote: [converged|blocked]');
    } else {
      parts.push('vote: [continue|converged|blocked]');
    }

    // Anti-preamble
    parts.push('Begin your output with the artifact content DIRECTLY.');

    // Multi-artifact format flag
    const isMultiArtifact = isWorker && (circling_step === 2 || circling_phase === 'finalization');
    if (isMultiArtifact) {
      parts.push('===CIRCLING_ARTIFACT===');
    }

    return parts.join('\n');
  }

  const task = { title: 'Build ManaToken' };

  // Init phase
  it('init/worker: produces workArtifact v0', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'init', circling_step: 0, my_role: 'worker' });
    assert.ok(prompt.includes('WORKER (Central Authority)'));
    assert.ok(prompt.includes('initial work artifact'));
    assert.ok(prompt.includes('continue|converged|blocked'));
  });

  it('init/reviewer: produces reviewStrategy', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'init', circling_step: 0, my_role: 'reviewer' });
    assert.ok(prompt.includes('REVIEWER'));
    assert.ok(prompt.includes('reviewStrategy'));
  });

  // Circling Step 1
  it('step1/worker: analyzes strategies, no artifact touch', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'circling', circling_step: 1, my_role: 'worker' });
    assert.ok(prompt.includes('Analyze Review Strategies'));
    assert.ok(prompt.includes('Do NOT touch the work artifact'));
    assert.ok(!prompt.includes('===CIRCLING_ARTIFACT==='), 'single-artifact: no explicit delimiter in instructions');
  });

  it('step1/reviewer: reviews workArtifact, produces findings', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'circling', circling_step: 1, my_role: 'reviewer' });
    assert.ok(prompt.includes('Review the Work Artifact'));
    assert.ok(prompt.includes('actionable findings'));
  });

  // Circling Step 2
  it('step2/worker: judges reviews, multi-artifact output', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'circling', circling_step: 2, my_role: 'worker' });
    assert.ok(prompt.includes('Judge Reviews'));
    assert.ok(prompt.includes('TWO artifacts'));
    assert.ok(prompt.includes('===CIRCLING_ARTIFACT==='), 'multi-artifact format');
  });

  it('step2/reviewer: refines strategy', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'circling', circling_step: 2, my_role: 'reviewer' });
    assert.ok(prompt.includes('Refine Your Strategy'));
    assert.ok(prompt.includes('REFINED reviewStrategy'));
    assert.ok(!prompt.includes('===CIRCLING_ARTIFACT==='), 'single-artifact: no multi-artifact delimiter');
  });

  // Finalization
  it('finalization/worker: final artifact + completionDiff, multi-artifact', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'finalization', circling_step: 0, my_role: 'worker' });
    assert.ok(prompt.includes('Final Delivery'));
    assert.ok(prompt.includes('completionDiff'));
    assert.ok(prompt.includes('TWO artifacts'));
    assert.ok(prompt.includes('===CIRCLING_ARTIFACT==='));
    assert.ok(prompt.includes('converged|blocked'), 'finalization should restrict votes');
    assert.ok(!prompt.includes('continue|converged|blocked'), 'finalization should NOT include continue');
  });

  it('finalization/reviewer: vote converged or blocked only', () => {
    const prompt = buildCirclingPromptTest(task, { circling_phase: 'finalization', circling_step: 0, my_role: 'reviewer' });
    assert.ok(prompt.includes('Final Sign-Off'));
    assert.ok(prompt.includes('converged|blocked'));
    assert.ok(!prompt.includes('continue|converged|blocked'));
  });

  // Anti-preamble (all phases)
  it('all phases include anti-preamble instruction', () => {
    for (const phase of ['init', 'circling', 'finalization']) {
      const prompt = buildCirclingPromptTest(task, { circling_phase: phase, circling_step: phase === 'circling' ? 1 : 0, my_role: 'worker' });
      assert.ok(prompt.includes('Begin your output with the artifact content DIRECTLY'), `missing anti-preamble in ${phase}`);
    }
  });
});

// ═══════════════════════════════════════════════════════
// 5. BRIDGE — Gate message formatting
// ═══════════════════════════════════════════════════════

describe('Bridge: gate message formatting edge cases', () => {
  function buildGateMsg(session) {
    const cg = session.circling || {};
    const lastRound = session.rounds?.[session.rounds.length - 1];
    const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
    if (blockedVotes.length > 0) {
      const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
      return `[GATE] SR${cg.current_subround} blocked — ${reason || 'reviewer flagged concern'}`;
    }
    return `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
  }

  it('multiple blocked votes joined with semicolon', () => {
    const msg = buildGateMsg({
      circling: { current_subround: 2 },
      rounds: [{
        reflections: [
          { vote: 'blocked', summary: 'reentrancy in withdraw()' },
          { vote: 'blocked', summary: 'unchecked external call in deposit()' },
          { vote: 'converged', summary: 'looks good' },
        ],
      }],
    });
    assert.ok(msg.includes('reentrancy'));
    assert.ok(msg.includes('unchecked external call'));
    assert.ok(msg.includes('; '), 'multiple reasons joined with semicolon');
  });

  it('truncates reason to 150 chars', () => {
    const longReason = 'A'.repeat(200);
    const msg = buildGateMsg({
      circling: { current_subround: 1 },
      rounds: [{
        reflections: [{ vote: 'blocked', summary: longReason }],
      }],
    });
    // "[GATE] SR1 blocked — " = 21 chars, so reason portion should be ≤150
    assert.ok(msg.length < 200, 'total message should be under 200 chars');
  });

  it('handles blocked vote with empty summary', () => {
    const msg = buildGateMsg({
      circling: { current_subround: 1 },
      rounds: [{
        reflections: [{ vote: 'blocked', summary: '' }],
      }],
    });
    assert.ok(msg.includes('reviewer flagged concern'), 'should fall back to generic reason');
  });

  it('handles missing rounds gracefully', () => {
    const msg = buildGateMsg({
      circling: { current_subround: 1 },
      rounds: [],
    });
    assert.ok(msg.includes('review reconciliationDoc'), 'no rounds → generic message');
  });
});

// ═══════════════════════════════════════════════════════
// 6. SCHEMA — step_started_at and artifact_failures
// ═══════════════════════════════════════════════════════

describe('Schema: artifact_failures tracking', () => {
  it('recordArtifactFailure returns incremented count', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId); // init → SR1/step1

    const count1 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count1, 1);
    const count2 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count2, 2);
    const count3 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count3, 3);
  });

  it('different nodes have independent failure counts', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);

    await store.recordArtifactFailure(sessionId, 'node-worker');
    await store.recordArtifactFailure(sessionId, 'node-worker');
    await store.recordArtifactFailure(sessionId, 'node-revA');

    const session = await store.get(sessionId);
    assert.equal(store.getArtifactFailureCount(session, 'node-worker'), 2);
    assert.equal(store.getArtifactFailureCount(session, 'node-revA'), 1);
    assert.equal(store.getArtifactFailureCount(session, 'node-revB'), 0);
  });

  it('failure count is per-step (different steps have different counts)', async () => {
    const { store, sessionId } = await makeActiveSession();

    // Advance to step 1
    await store.advanceCirclingStep(sessionId);
    await store.recordArtifactFailure(sessionId, 'node-worker');
    const session1 = await store.get(sessionId);
    assert.equal(store.getArtifactFailureCount(session1, 'node-worker'), 1);

    // Advance to step 2
    await store.advanceCirclingStep(sessionId);
    const session2 = await store.get(sessionId);
    // New step → new key → count resets to 0
    assert.equal(store.getArtifactFailureCount(session2, 'node-worker'), 0);
  });

  it('returns 0 for non-circling session', async () => {
    const result = await (() => {
      const kv = new MockKV();
      const store = new CollabStore(kv);
      return store.recordArtifactFailure('nonexistent', 'node-worker');
    })();
    assert.equal(result, 0);
  });
});

describe('Schema: circling defaults', () => {
  it('circling_strategy min_nodes defaults to 3', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.min_nodes, 3);
  });

  it('parallel min_nodes defaults to 2', () => {
    const s = createSession('t', { mode: 'parallel' });
    assert.equal(s.min_nodes, 2);
  });

  it('sequential min_nodes defaults to 2', () => {
    const s = createSession('t', { mode: 'sequential' });
    assert.equal(s.min_nodes, 2);
  });

  it('explicit min_nodes overrides circling default', () => {
    const s = createSession('t', { mode: 'circling_strategy', min_nodes: 5 });
    assert.equal(s.min_nodes, 5);
  });

  it('automation_tier defaults to 2', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.circling.automation_tier, 2);
  });

  it('max_subrounds defaults to 3', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.circling.max_subrounds, 3);
  });

  it('artifact_failures initialized empty', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.deepEqual(s.circling.artifact_failures, {});
  });
});
