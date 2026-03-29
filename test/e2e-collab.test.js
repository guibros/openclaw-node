#!/usr/bin/env node

/**
 * e2e-collab.test.js — Full end-to-end collab pipeline test.
 *
 * Simulates the COMPLETE lifecycle:
 *   1. Submit collab task with ALL routing fields
 *   2. Verify collab session auto-created with correct spec
 *   3. Verify recruit signal published
 *   4. Two nodes join (subscribe-before-join pattern)
 *   5. Round 1 starts, both nodes submit reflections
 *   6. Session converges → completed
 *   7. Parent task marked completed with node_contributions
 *   8. ALL routing fields survived the round-trip
 *
 * Requires: NATS + mesh-task-daemon running.
 * Run: node test/e2e-collab.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();
const TEST_PREFIX = `e2e-${Date.now()}`;
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
// FULL END-TO-END COLLAB PIPELINE
// ════════════════════════════════════════════════════

describe('E2E collab pipeline', () => {
  const taskId = `${TEST_PREFIX}-full`;
  const nodeA = `${TEST_PREFIX}-nodeA`;
  const nodeB = `${TEST_PREFIX}-nodeB`;
  let sessionId;

  const collabSpec = {
    mode: 'parallel',
    min_nodes: 2,
    max_nodes: 2,
    join_window_s: 60,
    max_rounds: 3,
    convergence: { type: 'unanimous' },
    scope_strategy: 'shared',
  };

  it('Step 1: submits collab task with ALL routing fields', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'E2E collab pipeline test',
      description: 'Full round-trip: submit → session → join → round → reflect → converge',
      llm_provider: 'shell',
      llm_model: 'custom-e2e',
      preferred_nodes: [nodeA, nodeB],
      exclude_nodes: ['blocked-agent'],
      collaboration: collabSpec,
      budget_minutes: 10,
      scope: ['test/'],
    });
    createdTaskIds.push(taskId);

    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'queued');
    assert.ok(res.data.collab_session_id, 'Task should have collab_session_id');
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);
  });

  it('Step 2: collab session auto-created with correct spec', async () => {
    const res = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'recruiting');
    assert.equal(res.data.mode, 'parallel');
    assert.equal(res.data.max_rounds, 3);
    assert.equal(res.data.task_id, taskId);
  });

  it('Step 3: recruit signal published on collab task submit', async () => {
    // Verify via the recruiting RPC (signal already published during submit)
    const res = await rpc('mesh.collab.recruiting', {});
    assert.ok(Array.isArray(res) || (res.ok && Array.isArray(res.data)),
      'recruiting response should be array or { ok, data: [] }');
    const sessions = Array.isArray(res) ? res : res.data;
    const ours = sessions.find(s => s.task_id === taskId);
    assert.ok(ours, 'Our session should be in recruiting list');
    assert.equal(ours.mode, 'parallel');
    assert.equal(ours.min_nodes, 2);
  });

  it('Step 4: routing fields survived storage (task round-trip)', async () => {
    const res = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(res.ok, true);
    const task = res.data;
    assert.equal(task.llm_provider, 'shell');
    assert.equal(task.llm_model, 'custom-e2e');
    assert.deepEqual(task.preferred_nodes, [nodeA, nodeB]);
    assert.deepEqual(task.exclude_nodes, ['blocked-agent']);
    assert.equal(task.collaboration.mode, 'parallel');
    assert.equal(task.collaboration.min_nodes, 2);
    assert.equal(task.collaboration.max_nodes, 2);
    assert.equal(task.collaboration.convergence.type, 'unanimous');
    assert.equal(task.collaboration.scope_strategy, 'shared');
  });

  it('Step 5: node A joins the session', async () => {
    const res = await rpc('mesh.collab.join', {
      session_id: sessionId,
      node_id: nodeA,
      role: 'worker',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.nodes.length, 1);
  });

  it('Step 6: node B subscribes-before-join, receives round 1 notification', async () => {
    // Subscribe to round channel BEFORE joining (subscribe-before-join pattern)
    const roundPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Node B missed round 1 notification'));
      }, 15000);

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    // Join triggers round 1 start (max_nodes reached)
    const res = await rpc('mesh.collab.join', {
      session_id: sessionId,
      node_id: nodeB,
      role: 'worker',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.nodes.length, 2);

    // Verify round notification received
    const round = await roundPromise;
    assert.equal(round.round_number, 1);
    assert.equal(round.session_id, sessionId);
    assert.equal(round.mode, 'parallel');
    assert.ok(round.my_scope, 'Should include scope');
  });

  it('Step 7: session is active, round 1 running', async () => {
    const status = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(status.ok, true);
    assert.equal(status.data.status, 'active');
    assert.equal(status.data.current_round, 1);
    assert.equal(status.data.nodes.length, 2);
  });

  it('Step 8: node A submits reflection (vote: converged)', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'E2E node A: all checks passed',
      learnings: 'Pipeline fully functional',
      artifacts: ['e2e-output-A.txt'],
      confidence: 0.95,
      vote: 'converged',
    });
    assert.equal(res.ok, true);
  });

  it('Step 9: node B submits reflection (vote: converged) → convergence', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'E2E node B: cross-validated A output',
      learnings: 'Confirmed all routing fields survived',
      artifacts: ['e2e-output-B.txt'],
      confidence: 0.92,
      vote: 'converged',
    });
    assert.equal(res.ok, true);

    // Session should converge (unanimous: both voted converged)
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 2);
    assert.ok(status.data.artifacts.length > 0);
  });

  it('Step 10: parent task is completed with node contributions', async () => {
    const res = await pollUntil('mesh.tasks.get', { task_id: taskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(res.data.status, 'completed');
    assert.ok(res.data.result, 'Should have result');
    assert.ok(res.data.result.summary, 'Should have summary');
    assert.ok(res.data.result.node_contributions, 'Should have node_contributions');

    // Verify routing fields still intact on completed task
    assert.equal(res.data.llm_provider, 'shell');
    assert.equal(res.data.llm_model, 'custom-e2e');
    assert.deepEqual(res.data.preferred_nodes, [nodeA, nodeB]);
    assert.deepEqual(res.data.exclude_nodes, ['blocked-agent']);
    assert.equal(res.data.collaboration.mode, 'parallel');
  });
});

// ════════════════════════════════════════════════════
// E2E: MULTI-ROUND WITH ROUTING FIELDS
// ════════════════════════════════════════════════════

describe('E2E multi-round with routing fields', () => {
  const taskId = `${TEST_PREFIX}-multiround`;
  const nodeA = `${TEST_PREFIX}-mrA`;
  const nodeB = `${TEST_PREFIX}-mrB`;
  let sessionId;

  it('full multi-round lifecycle with provider passthrough', async () => {
    // Submit
    const submit = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'E2E multi-round test',
      llm_provider: 'shell',
      llm_model: 'test-model',
      collaboration: {
        mode: 'parallel', min_nodes: 2, max_nodes: 2,
        join_window_s: 60, max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = submit.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Both join
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });

    // Subscribe for round 2 (node A)
    const round2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`);
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round 2'));
      }, 15000);
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

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);

    // Round 1: both vote continue
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Still analyzing', learnings: 'Found edge case',
      artifacts: [], confidence: 0.4, vote: 'continue',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Need more time', learnings: 'Partial results',
      artifacts: [], confidence: 0.3, vote: 'continue',
    });

    // Wait for round 2
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.ok(round2.shared_intel.includes('ROUND 1'));

    // Round 2: both vote converged
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Done', learnings: 'Resolved edge case',
      artifacts: ['final-A.md'], confidence: 0.95, vote: 'converged',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Confirmed', learnings: 'Verified',
      artifacts: ['final-B.md'], confidence: 0.9, vote: 'converged',
    });

    // Session should complete
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 4);

    // Parent task completed with routing fields intact
    const task = await pollUntil('mesh.tasks.get', { task_id: taskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(task.data.llm_provider, 'shell');
    assert.equal(task.data.llm_model, 'test-model');
    assert.equal(task.data.collaboration.mode, 'parallel');
  });
});
