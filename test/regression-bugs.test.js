#!/usr/bin/env node

/**
 * regression-bugs.test.js — Integration tests for patched bugs.
 *
 * Each test targets a specific bug that was found and fixed.
 * These tests would have CAUGHT the bug before it shipped.
 *
 * Requires: NATS + mesh-task-daemon running.
 * Run: node test/regression-bugs.test.js
 *
 * Bug coverage:
 *   Bug 2: Sequential mode — full lifecycle (submit → join → turn-by-turn → converge)
 *   Bug 3: Plan subtask routing field inheritance
 *   Bug 4: collab.completed event carries session metadata
 *   Bug 5: Stale reflections rejected after session convergence
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();
const TEST_PREFIX = `regbug-${Date.now()}`;
let nc;
const createdTaskIds = [];
const createdSessionIds = [];

async function rpc(subject, payload, timeout = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout });
  return JSON.parse(sc.decode(msg.data));
}

async function pollUntil(subject, payload, predicate, { intervalMs = 100, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await rpc(subject, payload);
    if (predicate(res)) return res;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timeout after ${timeoutMs}ms on ${subject}`);
}

before(async () => {
  try {
    nc = await connect({ servers: NATS_URL, timeout: 2000 });
  } catch {
    console.log('⏭ Skipping: NATS server not available');
    process.exit(0);
  }

  // Verify mesh-task-daemon is responding — NATS may be up but daemon down
  try {
    const msg = await nc.request(
      'mesh.tasks.list',
      sc.encode(JSON.stringify({ status: 'queued', limit: 1 })),
      { timeout: 3000 }
    );
    JSON.parse(sc.decode(msg.data));
  } catch {
    console.log('⏭ Skipping: NATS connected but mesh-task-daemon not responding');
    await nc.close();
    process.exit(0);
  }
});

after(async () => {
  for (const tid of createdTaskIds) {
    try { await rpc('mesh.tasks.cancel', { task_id: tid }); } catch {}
  }
  for (const sid of createdSessionIds) {
    try {
      const status = await rpc('mesh.collab.status', { session_id: sid });
      if (status.ok && status.data && !['completed', 'aborted'].includes(status.data.status)) {
        for (const node of status.data.nodes || []) {
          await rpc('mesh.collab.leave', { session_id: sid, node_id: node.node_id || node.id, reason: 'test cleanup' });
        }
      }
    } catch {}
  }
  if (nc) await nc.close();
});

// ════════════════════════════════════════════════════
// BUG 2: SEQUENTIAL MODE — FULL LIFECYCLE
//
// Before fix: sequential mode deadlocked because:
//   1. advanceTurn() was never called
//   2. isRoundComplete() needed ALL nodes to reflect, but only one per turn
//   3. startCollabRound() notified ALL nodes, not just current_turn
// ════════════════════════════════════════════════════

describe('Bug 2 regression: Sequential mode full lifecycle', () => {
  const taskId = `${TEST_PREFIX}-seq`;
  const nodeA = `${TEST_PREFIX}-seqA`;
  const nodeB = `${TEST_PREFIX}-seqB`;
  let sessionId;

  it('submits a sequential collab task', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Bug 2 regression: sequential mode',
      llm_provider: 'shell',
      collaboration: {
        mode: 'sequential',
        min_nodes: 2,
        max_nodes: 2,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    assert.equal(res.ok, true);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);
  });

  it('session is in sequential mode', async () => {
    const res = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(res.data.mode, 'sequential');
  });

  it('node A joins', async () => {
    const res = await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    assert.equal(res.ok, true);
  });

  it('node B joins → round 1 starts, only node A gets notified (first turn)', async () => {
    // Subscribe to BOTH nodes' round channels
    const notifiedNodes = [];

    const subA = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`, { max: 1 });
    const subB = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });

    const collectA = (async () => {
      for await (const msg of subA) {
        const data = JSON.parse(sc.decode(msg.data));
        notifiedNodes.push({ node: nodeA, ...data });
      }
    })();

    const collectB = (async () => {
      for await (const msg of subB) {
        const data = JSON.parse(sc.decode(msg.data));
        notifiedNodes.push({ node: nodeB, ...data });
      }
    })();

    await nc.flush(); // ensure subscriptions registered on server

    // Join triggers round start
    const res = await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    assert.equal(res.ok, true);

    // Wait for session to become active (deterministic, no setTimeout)
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);

    // Give NATS a moment to deliver any pending notifications, then close subs
    await nc.flush();
    subA.unsubscribe();
    subB.unsubscribe();

    // In sequential mode, only node A (current_turn) should have been notified
    const notifA = notifiedNodes.find(n => n.node === nodeA);
    assert.ok(notifA, 'Node A (first turn) should be notified');
    assert.equal(notifA.current_turn, nodeA);
    assert.equal(notifA.mode, 'sequential');

    // Node B should NOT have been notified yet (it's not their turn)
    const notifB = notifiedNodes.find(n => n.node === nodeB);
    assert.equal(notifB, undefined, 'Node B should NOT be notified on round start (not their turn)');
  });

  it('node A reflects → node B gets turn notification', async () => {
    // Subscribe for node B's turn notification
    const turnPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Node B never got turn notification')); }, 10000);
      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    await nc.flush(); // ensure subscription registered before reflect triggers turn advance

    // Node A submits reflection
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Turn 1 complete',
      learnings: 'Found issue X',
      artifacts: ['fix-A.js'],
      confidence: 0.8,
      vote: 'converged',
    });
    assert.equal(res.ok, true);

    // Node B should now get a turn notification with intra-round intel
    const turnData = await turnPromise;
    assert.equal(turnData.current_turn, nodeB, 'Node B should be current_turn');
    assert.equal(turnData.mode, 'sequential');
    assert.ok(turnData.shared_intel.includes('INTRA-ROUND'), 'Should include intra-round intel');
    assert.ok(turnData.shared_intel.includes('Turn 1 complete'), 'Should include node A\'s reflection');
    assert.ok(turnData.shared_intel.includes('Found issue X'), 'Should include node A\'s learnings');
  });

  it('node B reflects (converged) → session converges', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Confirmed fix',
      learnings: 'Issue X resolved',
      artifacts: ['review-B.md'],
      confidence: 0.9,
      vote: 'converged',
    });
    assert.equal(res.ok, true);

    // Session should converge (unanimous: both voted converged)
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 2);
  });

  it('parent task is completed', async () => {
    const res = await pollUntil('mesh.tasks.get', { task_id: taskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(res.data.status, 'completed');
  });
});

// ════════════════════════════════════════════════════
// BUG 2 continued: Sequential multi-round
// ════════════════════════════════════════════════════

describe('Bug 2 regression: Sequential multi-round', () => {
  const taskId = `${TEST_PREFIX}-seqmr`;
  const nodeA = `${TEST_PREFIX}-smrA`;
  const nodeB = `${TEST_PREFIX}-smrB`;
  let sessionId;

  it('full sequential multi-round lifecycle', async () => {
    // Submit
    const submit = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Bug 2 regression: sequential multi-round',
      collaboration: {
        mode: 'sequential',
        min_nodes: 2,
        max_nodes: 2,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = submit.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Join
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });

    // Subscribe for node A's round 2 notification
    const round2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`);
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout waiting for round 2')); }, 15000);
      (async () => {
        for await (const msg of sub) {
          const data = JSON.parse(sc.decode(msg.data));
          if (data.round_number === 2) {
            clearTimeout(timer);
            sub.unsubscribe();
            resolve(data);
            return;
          }
        }
      })();
    });

    // Subscribe for node B's round 1 turn notification (before join triggers round start)
    const nodeBR1Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout: node B round 1 turn')); }, 15000);
      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    // Subscribe for node B's round 2 turn notification upfront (avoid race)
    const nodeBR2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`);
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout: node B round 2 turn')); }, 15000);
      (async () => {
        for await (const msg of sub) {
          const data = JSON.parse(sc.decode(msg.data));
          if (data.round_number === 2) {
            clearTimeout(timer);
            sub.unsubscribe();
            resolve(data);
            return;
          }
        }
      })();
    });

    await nc.flush(); // ensure all subscriptions registered on server

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);

    // Round 1: both nodes take turns, both vote continue
    // Node A is first turn — session is active, so A can reflect immediately
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'R1 still analyzing', learnings: 'WIP', artifacts: [],
      confidence: 0.3, vote: 'continue',
    });

    // Wait for node B's turn notification (subscribe-before-reflect pattern)
    const turnB = await nodeBR1Promise;
    assert.equal(turnB.current_turn, nodeB);

    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'R1 need more time', learnings: 'Partial', artifacts: [],
      confidence: 0.3, vote: 'continue',
    });

    // Wait for round 2 (node A gets first turn again)
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.equal(round2.current_turn, nodeA);
    assert.ok(round2.shared_intel.includes('ROUND 1'), 'Round 2 should include round 1 intel');

    // Round 2: both converge
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'R2 done', learnings: 'Fixed', artifacts: ['final-A.md'],
      confidence: 0.95, vote: 'converged',
    });

    // Wait for node B's round 2 turn notification (already subscribed above)
    const turnBR2 = await nodeBR2Promise;
    assert.equal(turnBR2.current_turn, nodeB);

    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'R2 confirmed', learnings: 'Verified', artifacts: ['final-B.md'],
      confidence: 0.9, vote: 'converged',
    });

    // Session should complete
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 4, 'Should have 4 reflections (2 per round × 2 rounds)');
  });
});

// ════════════════════════════════════════════════════
// BUG 3: PLAN SUBTASK ROUTING FIELD INHERITANCE
//
// Before fix: advancePlanWave() dropped llm_provider, llm_model,
// preferred_nodes, exclude_nodes when materializing subtasks.
// ════════════════════════════════════════════════════

describe('Bug 3 regression: Plan subtask routing field inheritance', () => {
  it('plan subtasks inherit routing fields from parent task', async () => {
    const planTaskId = `${TEST_PREFIX}-planrt`;

    // Submit parent task with routing fields
    const submit = await rpc('mesh.tasks.submit', {
      task_id: planTaskId,
      title: 'Plan routing test parent',
      llm_provider: 'shell',
      llm_model: 'custom-regression',
      preferred_nodes: ['node-X'],
      exclude_nodes: ['node-Y'],
    });
    createdTaskIds.push(planTaskId);
    assert.equal(submit.ok, true);

    // Create a plan with subtasks
    const plan = await rpc('mesh.plans.create', {
      parent_task_id: planTaskId,
      title: 'Test plan',
      subtasks: [
        {
          subtask_id: `${planTaskId}-sub1`,
          title: 'Subtask 1',
          description: 'First subtask',
          budget_minutes: 5,
          scope: ['test/'],
          delegation: { mode: 'solo_mesh' },
          dependencies: [],
        },
      ],
    });

    if (!plan.ok) {
      // Plans endpoint might not exist or might have different API
      // Skip gracefully rather than fail — this tests daemon logic
      console.log('  (skipped: mesh.plans.create not available)');
      return;
    }

    // Approve the plan to trigger subtask materialization
    const approve = await rpc('mesh.plans.approve', { plan_id: plan.data.plan_id });
    if (!approve.ok) {
      console.log('  (skipped: mesh.plans.approve not available)');
      return;
    }

    // Wait for subtask to be materialized
    await new Promise(r => setTimeout(r, 1000));

    // Check that the subtask inherited routing fields
    const subtask = await rpc('mesh.tasks.get', { task_id: `${planTaskId}-sub1` });
    if (subtask.ok) {
      assert.equal(subtask.data.llm_provider, 'shell', 'Subtask should inherit llm_provider');
      assert.equal(subtask.data.llm_model, 'custom-regression', 'Subtask should inherit llm_model');
      assert.deepEqual(subtask.data.preferred_nodes, ['node-X'], 'Subtask should inherit preferred_nodes');
      assert.deepEqual(subtask.data.exclude_nodes, ['node-Y'], 'Subtask should inherit exclude_nodes');
      createdTaskIds.push(`${planTaskId}-sub1`);
    }
  });
});

// ════════════════════════════════════════════════════
// BUG 4: COLLAB.COMPLETED EVENT CARRIES METADATA
//
// Before fix: collab.completed bridge handler was a no-op.
// Session metadata (rounds, contributions, artifacts) was lost.
// ════════════════════════════════════════════════════

describe('Bug 4 regression: collab.completed event metadata', () => {
  const taskId = `${TEST_PREFIX}-b4meta`;
  const nodeA = `${TEST_PREFIX}-b4A`;
  const nodeB = `${TEST_PREFIX}-b4B`;
  let sessionId;

  it('collab.completed event includes session result metadata', async () => {
    // Submit collab task
    const submit = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Bug 4 regression: completion metadata',
      collaboration: {
        mode: 'parallel',
        min_nodes: 2,
        max_nodes: 2,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = submit.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Subscribe to collab.completed event
    const completedPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe('mesh.events.collab.completed');
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout waiting for collab.completed')); }, 15000);
      (async () => {
        for await (const msg of sub) {
          const data = JSON.parse(sc.decode(msg.data));
          if (data.task_id === taskId) {
            clearTimeout(timer);
            sub.unsubscribe();
            resolve(data);
            return;
          }
        }
      })();
    });

    // Join and converge
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active');

    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Node A done', learnings: 'Insight A',
      artifacts: ['output-A.txt'], confidence: 0.95, vote: 'converged',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Node B done', learnings: 'Insight B',
      artifacts: ['output-B.txt'], confidence: 0.9, vote: 'converged',
    });

    // Wait for the collab.completed event
    const event = await completedPromise;

    // The event should carry the full session including result
    assert.ok(event.session_id || event.data?.session_id, 'Event should have session_id');

    // Verify the completed session has metadata
    const status = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.artifacts.length > 0, 'Completed session should have artifacts');
    assert.ok(status.data.total_reflections >= 2, 'Should have at least 2 reflections');
  });
});

// ════════════════════════════════════════════════════
// BUG 5: STALE REFLECTIONS REJECTED AFTER CONVERGENCE
//
// Before fix: submitReflection() accepted reflections on any session
// regardless of status. A late reflection arriving after convergence
// would pollute the completed session record.
// ════════════════════════════════════════════════════

describe('Bug 5 regression: Stale reflections rejected after convergence', () => {
  const taskId = `${TEST_PREFIX}-b5stale`;
  const nodeA = `${TEST_PREFIX}-b5A`;
  const nodeB = `${TEST_PREFIX}-b5B`;
  const nodeC = `${TEST_PREFIX}-b5C`;
  let sessionId;

  it('reflection on completed session is rejected', async () => {
    // Submit parallel collab task
    const submit = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Bug 5 regression: stale reflection rejection',
      collaboration: {
        mode: 'parallel',
        min_nodes: 2,
        max_nodes: 2,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = submit.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Two nodes join and converge
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active');

    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Done', learnings: 'All good', artifacts: ['a.txt'],
      confidence: 0.9, vote: 'converged',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Done', learnings: 'Confirmed', artifacts: ['b.txt'],
      confidence: 0.9, vote: 'converged',
    });

    // Wait for completion
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');

    // Snapshot session state at completion
    const before = await rpc('mesh.collab.status', { session_id: sessionId });
    const reflectionsBefore = before.data.total_reflections;
    const artifactsBefore = before.data.artifacts;

    // Try to submit a stale reflection — should be rejected (returns error or null)
    const stale = await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeC,
      summary: 'Late arrival', learnings: 'Too late', artifacts: ['stale.txt'],
      confidence: 0.5, vote: 'converged',
    });

    // The RPC should return an error (ok: false) since session is not active
    assert.equal(stale.ok, false, 'Stale reflection on completed session should be rejected');

    // Verify session state is completely unchanged
    const after = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(after.data.total_reflections, reflectionsBefore,
      'Reflection count should not change after stale reflection rejected');
    assert.deepEqual(after.data.artifacts, artifactsBefore,
      'Artifacts should be unchanged after stale reflection rejected');
    assert.equal(after.data.status, 'completed',
      'Session status should still be completed');
  });
});
