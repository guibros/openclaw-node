#!/usr/bin/env node

/**
 * collab-integration.test.js — Full integration test against live NATS.
 *
 * Requires:
 *   - NATS server running (nats://100.91.131.61:4222)
 *   - mesh-task-daemon.js running (handles all RPC subjects)
 *
 * Run: node test/collab-integration.test.js
 *
 * Tests the full lifecycle via NATS request/reply — same protocol
 * real agents use. No mocks, no stubs.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();

// Test-unique prefix to avoid polluting real data
const TEST_PREFIX = `test-${Date.now()}`;

let nc;

// ── Helper: NATS request/reply ─────────────────────

async function rpc(subject, payload, timeout = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout });
  return JSON.parse(sc.decode(msg.data));
}

/**
 * Poll a NATS RPC endpoint until a condition is met, or timeout.
 * Replaces fragile `setTimeout(r, 500)` assertions with deterministic polling.
 *
 * @param {string} subject — NATS subject to poll
 * @param {object} payload — request payload
 * @param {function} predicate — (response) => bool, returns true when done
 * @param {object} opts — { intervalMs, timeoutMs }
 * @returns {object} — the response that matched the predicate
 */
async function pollUntil(subject, payload, predicate, { intervalMs = 100, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await rpc(subject, payload);
    if (predicate(res)) return res;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timeout after ${timeoutMs}ms on ${subject}`);
}

// ── Setup / Teardown ───────────────────────────────

const createdTaskIds = [];
const createdSessionIds = [];

before(async () => {
  try {
    nc = await connect({ servers: NATS_URL, timeout: 2000 });
    console.log(`Connected to NATS at ${NATS_URL}`);
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
  // Cleanup: cancel all test tasks and delete collab sessions
  for (const tid of createdTaskIds) {
    try {
      await rpc('mesh.tasks.cancel', { task_id: tid });
    } catch { /* best-effort */ }
  }
  // Abort any lingering collab sessions (best-effort — no delete RPC exists,
  // but abort prevents them from interfering with future test runs)
  for (const sid of createdSessionIds) {
    try {
      const status = await rpc('mesh.collab.status', { session_id: sid });
      if (status.ok && status.data && !['completed', 'aborted'].includes(status.data.status)) {
        // Leave all nodes to force abort
        for (const node of status.data.nodes || []) {
          await rpc('mesh.collab.leave', { session_id: sid, node_id: node.id, reason: 'test cleanup' });
        }
      }
    } catch { /* best-effort */ }
  }
  if (nc) await nc.close();
  console.log(`Cleaned up ${createdTaskIds.length} test tasks, ${createdSessionIds.length} collab sessions.`);
});

// ════════════════════════════════════════════════════
// 1. SOLO TASK LIFECYCLE
// ════════════════════════════════════════════════════

describe('Solo task lifecycle (live NATS)', () => {
  const taskId = `${TEST_PREFIX}-solo-1`;
  const nodeId = `${TEST_PREFIX}-node-A`;

  it('submits a task', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Integration test: solo task',
      description: 'Verify full lifecycle over live NATS',
      budget_minutes: 5,
      metric: 'echo "ok"',
    });
    createdTaskIds.push(taskId);

    assert.equal(res.ok, true);
    assert.equal(res.data.task_id, taskId);
    assert.equal(res.data.status, 'queued');
  });

  it('rejects duplicate submission', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Duplicate',
    });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('already exists'));
  });

  it('claims the task', async () => {
    const res = await rpc('mesh.tasks.claim', { node_id: nodeId });
    assert.equal(res.ok, true);
    assert.equal(res.data.task_id, taskId);
    assert.equal(res.data.status, 'claimed');
    assert.equal(res.data.owner, nodeId);
  });

  it('rejects double-claim from same node', async () => {
    const res = await rpc('mesh.tasks.claim', { node_id: nodeId });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('already has an active task'));
  });

  it('starts the task', async () => {
    const res = await rpc('mesh.tasks.start', { task_id: taskId });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'running');
    assert.ok(res.data.started_at);
  });

  it('sends heartbeat', async () => {
    const res = await rpc('mesh.tasks.heartbeat', { task_id: taskId });
    assert.equal(res.ok, true);
    assert.ok(res.data.last_activity);
  });

  it('logs an attempt', async () => {
    const res = await rpc('mesh.tasks.attempt', {
      task_id: taskId,
      approach: 'tried approach A',
      result: 'partial success',
      keep: true,
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.attempts.length, 1);
    assert.equal(res.data.attempts[0].approach, 'tried approach A');
    assert.equal(res.data.attempts[0].keep, true);
  });

  it('completes the task', async () => {
    const res = await rpc('mesh.tasks.complete', {
      task_id: taskId,
      result: {
        success: true,
        summary: 'Integration test passed',
        artifacts: ['test-output.txt'],
      },
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'completed');
    assert.ok(res.data.completed_at);
    assert.equal(res.data.result.success, true);
  });

  it('retrieves the completed task', async () => {
    const res = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'completed');
    assert.equal(res.data.result.artifacts[0], 'test-output.txt');
  });

  it('lists tasks including test task', async () => {
    const res = await rpc('mesh.tasks.list', {});
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.data));
    const found = res.data.find(t => t.task_id === taskId);
    assert.ok(found, 'Test task should appear in list');
  });
});

// ════════════════════════════════════════════════════
// 2. TASK FAILURE + RELEASE
// ════════════════════════════════════════════════════

describe('Task failure and release (live NATS)', () => {
  const taskId = `${TEST_PREFIX}-fail-1`;
  const nodeId = `${TEST_PREFIX}-node-B`;

  it('submits, claims, starts, then fails', async () => {
    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Integration test: fail path',
      budget_minutes: 5,
    });
    createdTaskIds.push(taskId);

    await rpc('mesh.tasks.claim', { node_id: nodeId });
    await rpc('mesh.tasks.start', { task_id: taskId });

    const res = await rpc('mesh.tasks.fail', {
      task_id: taskId,
      reason: 'intentional test failure',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'failed');
    assert.equal(res.data.result.success, false);
  });

  it('submits and releases a task', async () => {
    const releaseId = `${TEST_PREFIX}-release-1`;
    await rpc('mesh.tasks.submit', {
      task_id: releaseId,
      title: 'Integration test: release path',
      budget_minutes: 5,
    });
    createdTaskIds.push(releaseId);

    await rpc('mesh.tasks.claim', { node_id: `${TEST_PREFIX}-node-C` });
    await rpc('mesh.tasks.start', { task_id: releaseId });

    const res = await rpc('mesh.tasks.release', {
      task_id: releaseId,
      reason: 'all retries exhausted (test)',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'released');
    assert.equal(res.data.result.released, true);
  });
});

// ════════════════════════════════════════════════════
// 3. TASK CANCELLATION
// ════════════════════════════════════════════════════

describe('Task cancellation (live NATS)', () => {
  it('cancels a queued task', async () => {
    const cancelId = `${TEST_PREFIX}-cancel-1`;
    await rpc('mesh.tasks.submit', {
      task_id: cancelId,
      title: 'Integration test: cancel path',
      budget_minutes: 5,
    });
    createdTaskIds.push(cancelId);

    const res = await rpc('mesh.tasks.cancel', {
      task_id: cancelId,
      reason: 'test cancellation',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'cancelled');
  });
});

// ════════════════════════════════════════════════════
// 4. COLLABORATIVE TASK — FULL LIFECYCLE
// ════════════════════════════════════════════════════

describe('Collab task lifecycle (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-1`;
  const nodeA = `${TEST_PREFIX}-cnode-A`;
  const nodeB = `${TEST_PREFIX}-cnode-B`;
  let sessionId;

  it('submits a collaborative task → auto-creates session', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: collab task',
      description: 'Multi-node collaboration test',
      budget_minutes: 10,
      scope: ['test/'],
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
    createdTaskIds.push(collabTaskId);

    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'queued');
    assert.ok(res.data.collab_session_id, 'Task should have collab_session_id');
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);
  });

  it('discovers session via mesh.collab.find', async () => {
    const res = await rpc('mesh.collab.find', { task_id: collabTaskId });
    assert.equal(res.ok, true);
    assert.ok(res.data);
    assert.equal(res.data.session_id, sessionId);
    assert.equal(res.data.status, 'recruiting');
  });

  it('node A joins the session', async () => {
    const res = await rpc('mesh.collab.join', {
      session_id: sessionId,
      node_id: nodeA,
      role: 'worker',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.nodes.length, 1);
    assert.equal(res.data.nodes[0].node_id, nodeA);
  });

  it('rejects duplicate join from node A', async () => {
    const res = await rpc('mesh.collab.join', {
      session_id: sessionId,
      node_id: nodeA,
    });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('already joined') || res.error.includes('Cannot join'));
  });

  it('node B joins → max_nodes reached → round 1 auto-starts', async () => {
    // Subscribe to round notification before joining
    const roundPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round notification'));
      }, 15000);

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    const res = await rpc('mesh.collab.join', {
      session_id: sessionId,
      node_id: nodeB,
      role: 'worker',
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.nodes.length, 2);

    // Wait for round notification (should arrive since max_nodes reached → recruiting done → round starts)
    const roundNotif = await roundPromise;
    assert.equal(roundNotif.round_number, 1);
    assert.equal(roundNotif.session_id, sessionId);
    assert.ok(roundNotif.my_scope, 'Should include scope');
    assert.equal(roundNotif.mode, 'parallel');
  });

  it('gets session status (active, round 1)', async () => {
    const res = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'active');
    assert.equal(res.data.current_round, 1);
    assert.equal(res.data.nodes.length, 2);
  });

  it('node A submits reflection (vote: converged)', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Node A completed work on test/',
      learnings: 'All tests pass',
      artifacts: ['test/output-A.txt'],
      confidence: 0.95,
      vote: 'converged',
    });
    assert.equal(res.ok, true);
  });

  it('rejects duplicate reflection from node A', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'duplicate',
      learnings: '',
      artifacts: [],
      confidence: 0.5,
      vote: 'continue',
    });
    assert.equal(res.ok, false);
  });

  it('node B submits reflection (vote: converged) → convergence → completion', async () => {
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Node B verified test results',
      learnings: 'Cross-validated node A output',
      artifacts: ['test/output-B.txt'],
      confidence: 0.9,
      vote: 'converged',
    });
    assert.equal(res.ok, true);

    // Poll until session reaches completed status (deterministic, no fixed delay)
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 2);
    assert.ok(status.data.artifacts.length > 0);
  });

  it('parent task is marked completed', async () => {
    const res = await pollUntil('mesh.tasks.get', { task_id: collabTaskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(res.data.status, 'completed');
    assert.ok(res.data.result);
  });
});

// ════════════════════════════════════════════════════
// 5. COLLAB — MULTI-ROUND (NO CONVERGENCE ON ROUND 1)
// ════════════════════════════════════════════════════

describe('Collab multi-round (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-multi`;
  const nodeA = `${TEST_PREFIX}-mnode-A`;
  const nodeB = `${TEST_PREFIX}-mnode-B`;
  let sessionId;

  before(async () => {
    // Submit collab task
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: multi-round collab',
      budget_minutes: 10,
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
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Both nodes join
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
  });

  it('round 1: nodes vote continue → round 2 starts', async () => {
    // Subscribe to round 2 notification for node A
    const round2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`);
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round 2 notification'));
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

    // Node B joins → round 1 starts
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });

    // Wait for round 1 to be fully started
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);

    // Both nodes vote "continue" → no convergence → round 2
    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Still working on analysis',
      learnings: 'Found some issues',
      artifacts: [],
      confidence: 0.4,
      vote: 'continue',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Need another pass',
      learnings: 'Edge cases found',
      artifacts: [],
      confidence: 0.3,
      vote: 'continue',
    });

    // Wait for round 2 notification
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.ok(round2.shared_intel.includes('ROUND 1'));
    assert.ok(round2.shared_intel.includes('Still working on analysis'));
  });

  it('round 2: nodes vote converged → session completes', async () => {
    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Analysis complete',
      learnings: 'All issues resolved',
      artifacts: ['result.md'],
      confidence: 0.95,
      vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Confirmed resolution',
      learnings: 'Cross-checked',
      artifacts: ['review.md'],
      confidence: 0.9,
      vote: 'converged',
    });

    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 4); // 2 per round × 2 rounds
  });
});

// ════════════════════════════════════════════════════
// 6. COLLAB — PARSE FAILURE HANDLING
// ════════════════════════════════════════════════════

describe('Collab parse failure handling (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-parse`;
  const nodeA = `${TEST_PREFIX}-pnode-A`;
  const nodeB = `${TEST_PREFIX}-pnode-B`;
  let sessionId;

  before(async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: parse failure in collab',
      budget_minutes: 10,
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
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    // Wait for round 1 to start
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);
  });

  it('parse_failed reflection blocks unanimous convergence', async () => {
    // Subscribe for round 2
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

    // Node A votes converged, node B has parse failure
    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Done',
      learnings: '',
      artifacts: [],
      confidence: 0.9,
      vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'garbled output',
      learnings: '',
      artifacts: [],
      confidence: 0.5,
      vote: 'parse_error',
      parse_failed: true,
    });

    // Should NOT converge (parse failure blocks unanimous) → round 2 should start
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.ok(round2.shared_intel.includes('PARSE FAILED'));
  });
});

// ════════════════════════════════════════════════════
// 7. COLLAB — MAJORITY MODE
// ════════════════════════════════════════════════════

describe('Collab majority convergence (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-majority`;
  const nodeA = `${TEST_PREFIX}-majA`;
  const nodeB = `${TEST_PREFIX}-majB`;
  const nodeC = `${TEST_PREFIX}-majC`;
  let sessionId;

  before(async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: majority convergence',
      budget_minutes: 10,
      collaboration: {
        mode: 'parallel',
        min_nodes: 3,
        max_nodes: 3,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'majority', threshold: 0.66, min_quorum: 2 },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeC });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);
  });

  it('2/3 converged votes → majority convergence', async () => {
    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Done', learnings: '', artifacts: [],
      confidence: 0.9, vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Done too', learnings: '', artifacts: [],
      confidence: 0.85, vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeC,
      summary: 'Not yet', learnings: '', artifacts: [],
      confidence: 0.3, vote: 'continue',
    });

    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
  });
});

// ════════════════════════════════════════════════════
// 8. COLLAB — NODE LEAVE MID-SESSION
// ════════════════════════════════════════════════════

describe('Collab node leave (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-leave`;
  const nodeA = `${TEST_PREFIX}-lnA`;
  const nodeB = `${TEST_PREFIX}-lnB`;
  const nodeC = `${TEST_PREFIX}-lnC`;
  let sessionId;

  before(async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: node leave',
      budget_minutes: 10,
      collaboration: {
        mode: 'parallel',
        min_nodes: 2,
        max_nodes: 3,
        join_window_s: 60,
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeC });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);
  });

  it('node C leaves gracefully, session continues', async () => {
    const res = await rpc('mesh.collab.leave', {
      session_id: sessionId,
      node_id: nodeC,
      reason: 'test: graceful leave',
    });
    assert.equal(res.ok, true);

    // Session should still be active (3-1=2 >= min_nodes=2)
    const status = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(status.ok, true);
    assert.equal(status.data.nodes.length, 2);
    assert.equal(status.data.status, 'active');
  });

  it('remaining nodes converge successfully', async () => {
    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Done', learnings: '', artifacts: [],
      confidence: 0.9, vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Done', learnings: '', artifacts: [],
      confidence: 0.9, vote: 'converged',
    });

    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
  });
});

// ════════════════════════════════════════════════════
// 9. SESSION DISCOVERY (collab.find)
// ════════════════════════════════════════════════════

describe('Session discovery (live NATS)', () => {
  it('returns null for nonexistent task', async () => {
    const res = await rpc('mesh.collab.find', { task_id: 'nonexistent-999' });
    assert.equal(res.ok, true);
    assert.equal(res.data, null);
  });
});

// ════════════════════════════════════════════════════
// 10. COLLAB — MAX ROUNDS EXHAUSTION
// ════════════════════════════════════════════════════

describe('Collab max rounds exhaustion (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-maxrounds`;
  const nodeA = `${TEST_PREFIX}-mrA`;
  const nodeB = `${TEST_PREFIX}-mrB`;
  let sessionId;

  before(async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: max rounds exhaustion',
      budget_minutes: 10,
      collaboration: {
        mode: 'parallel',
        min_nodes: 2,
        max_nodes: 2,
        join_window_s: 60,
        max_rounds: 2,  // low cap — will exhaust after 2 rounds of 'continue'
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);
  });

  it('round 1: both vote continue', async () => {
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Not done yet', learnings: '', artifacts: [],
      confidence: 0.3, vote: 'continue',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Still working', learnings: '', artifacts: [],
      confidence: 0.3, vote: 'continue',
    });

    // Wait for round 2 to start
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.current_round >= 2);
  });

  it('round 2 (max): both vote continue → session completes with max_rounds_reached', async () => {
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Still not converging', learnings: '', artifacts: ['partial.md'],
      confidence: 0.4, vote: 'continue',
    });
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Also not converging', learnings: '', artifacts: [],
      confidence: 0.4, vote: 'continue',
    });

    // Session should complete (not converged, but max_rounds reached)
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
  });

  it('parent task is completed with max_rounds_reached flag', async () => {
    const res = await pollUntil('mesh.tasks.get', { task_id: collabTaskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(res.data.status, 'completed');
    assert.equal(res.data.result.max_rounds_reached, true);
  });
});

// ════════════════════════════════════════════════════
// 11. COLLAB — JOIN WINDOW TIMEOUT (RECRUITING FAILURE)
// ════════════════════════════════════════════════════

describe('Collab join window timeout (live NATS)', { timeout: 30000 }, () => {
  const collabTaskId = `${TEST_PREFIX}-collab-joinexp`;
  const nodeA = `${TEST_PREFIX}-jeA`;
  let sessionId;

  it('session aborts when join window expires without enough nodes', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: join window timeout',
      budget_minutes: 10,
      collaboration: {
        mode: 'parallel',
        min_nodes: 3,        // need 3 nodes
        max_nodes: null,
        join_window_s: 2,    // 2-second window
        max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Join only 1 of 3 required nodes (starts the recruiting deadline)
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });

    // Daemon checks recruiting deadlines every 5s.
    // join_window_s=2 means deadline is ~2s after first join.
    // After 2s + next 5s poll = ~7s max wait.
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'aborted',
      { intervalMs: 500, timeoutMs: 20000 });
    assert.equal(status.data.status, 'aborted');

    // Parent task should be released (needs human triage)
    const task = await pollUntil('mesh.tasks.get', { task_id: collabTaskId },
      r => r.ok && r.data.status === 'released',
      { intervalMs: 500, timeoutMs: 5000 });
    assert.equal(task.data.status, 'released');
    assert.ok(task.data.result.summary.includes('recruit'));
  });
});

// ════════════════════════════════════════════════════
// 12. COLLAB — BLOCKED VOTE SEMANTICS
// ════════════════════════════════════════════════════

describe('Collab blocked vote (live NATS)', () => {
  const collabTaskId = `${TEST_PREFIX}-collab-blocked`;
  const nodeA = `${TEST_PREFIX}-blkA`;
  const nodeB = `${TEST_PREFIX}-blkB`;
  let sessionId;

  before(async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: blocked vote',
      budget_minutes: 10,
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
    createdTaskIds.push(collabTaskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);
  });

  it('blocked vote is accepted and prevents convergence', async () => {
    // Subscribe for round 2 notification
    const round2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`);
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round 2 after blocked vote'));
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

    // Node A votes converged, node B votes blocked (stuck, needs help)
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Done from my side', learnings: '', artifacts: [],
      confidence: 0.9, vote: 'converged',
    });

    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Cannot proceed — missing dependency', learnings: '', artifacts: [],
      confidence: 0.2, vote: 'blocked',
    });

    // blocked ≠ converged → unanimous fails → round 2 starts
    // Shared intel should show node B's blocked vote
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.ok(round2.shared_intel.includes('blocked'));
  });
});

// ════════════════════════════════════════════════════
// 13. NODE ROUTING — EXCLUDE AND PREFERRED NODES
// ════════════════════════════════════════════════════

describe('Node routing: exclude and preferred (live NATS)', () => {
  const excludedNode = `${TEST_PREFIX}-excluded`;
  const preferredNode = `${TEST_PREFIX}-preferred`;
  const otherNode = `${TEST_PREFIX}-other`;

  it('excluded node cannot claim a task with exclude_nodes', async () => {
    const taskId = `${TEST_PREFIX}-route-excl`;
    // Use high priority so this is the first task any node would normally grab
    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Routing test: excluded node',
      budget_minutes: 5,
      priority: 999,
      exclude_nodes: [excludedNode],
    });
    createdTaskIds.push(taskId);

    // Excluded node tries to claim — should NOT get the excluded task
    const res = await rpc('mesh.tasks.claim', { node_id: excludedNode });
    if (res.ok && res.data) {
      // Might claim a different queued task — that's fine, just not this one
      assert.notEqual(res.data.task_id, taskId, 'excluded node should not claim the excluded task');
      await rpc('mesh.tasks.cancel', { task_id: res.data.task_id });
    }
    // Either null or a different task — both are correct

    // Non-excluded node can claim it
    const res2 = await rpc('mesh.tasks.claim', { node_id: otherNode });
    assert.equal(res2.ok, true);
    assert.equal(res2.data.task_id, taskId);
    assert.equal(res2.data.owner, otherNode);

    // Cleanup
    await rpc('mesh.tasks.cancel', { task_id: taskId });
  });

  it('preferred node gets task before non-preferred node', async () => {
    const taskId1 = `${TEST_PREFIX}-route-pref1`;
    const taskId2 = `${TEST_PREFIX}-route-pref2`;

    // Submit two tasks at same priority: one preferred for preferredNode, one not
    await rpc('mesh.tasks.submit', {
      task_id: taskId1,
      title: 'Routing test: no preference',
      budget_minutes: 5,
      priority: 998,
    });
    await rpc('mesh.tasks.submit', {
      task_id: taskId2,
      title: 'Routing test: preferred node',
      budget_minutes: 5,
      priority: 998,
      preferred_nodes: [preferredNode],
    });
    createdTaskIds.push(taskId1, taskId2);

    // Preferred node claims — should get the preferred task first (despite same priority)
    const res = await rpc('mesh.tasks.claim', { node_id: preferredNode });
    assert.equal(res.ok, true);
    assert.equal(res.data.task_id, taskId2);

    // Cleanup
    await rpc('mesh.tasks.cancel', { task_id: taskId1 });
    await rpc('mesh.tasks.cancel', { task_id: taskId2 });
  });

  it('non-preferred node CAN still claim a preferred task (soft preference)', async () => {
    const taskId = `${TEST_PREFIX}-route-soft`;
    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Routing test: soft preference',
      budget_minutes: 5,
      priority: 997,
      preferred_nodes: ['some-other-node'],
    });
    createdTaskIds.push(taskId);

    // Non-preferred node claims — should succeed (soft preference, not hard block)
    const nonPrefNode = `${TEST_PREFIX}-nonpref`;
    const res = await rpc('mesh.tasks.claim', { node_id: nonPrefNode });
    assert.equal(res.ok, true);
    assert.equal(res.data.task_id, taskId);
    assert.equal(res.data.owner, nonPrefNode);

    // Cleanup
    await rpc('mesh.tasks.cancel', { task_id: taskId });
  });
});

// ════════════════════════════════════════════════════
// 14. ERROR HANDLING
// ════════════════════════════════════════════════════

describe('Error handling (live NATS)', () => {
  it('rejects task submit without required fields', async () => {
    const res = await rpc('mesh.tasks.submit', { description: 'no id or title' });
    assert.equal(res.ok, false);
  });

  it('rejects claim without node_id', async () => {
    const res = await rpc('mesh.tasks.claim', {});
    assert.equal(res.ok, false);
  });

  it('rejects start for nonexistent task', async () => {
    const res = await rpc('mesh.tasks.start', { task_id: 'ghost-task' });
    assert.equal(res.ok, false);
  });

  it('rejects collab join without session_id', async () => {
    const res = await rpc('mesh.collab.join', { node_id: 'x' });
    assert.equal(res.ok, false);
  });

  it('rejects collab reflect without session_id', async () => {
    const res = await rpc('mesh.collab.reflect', { node_id: 'x', vote: 'converged' });
    assert.equal(res.ok, false);
  });
});

// ════════════════════════════════════════════════════
// 11. EVENT STREAM VERIFICATION
// ════════════════════════════════════════════════════

describe('Event stream (live NATS)', () => {
  it('publishes events on task state changes', async () => {
    const eventTaskId = `${TEST_PREFIX}-events-1`;
    const events = [];

    // Subscribe to events before creating task
    const sub = nc.subscribe('mesh.events.>');
    const eventCollector = (async () => {
      for await (const msg of sub) {
        const ev = JSON.parse(sc.decode(msg.data));
        if (ev.task_id === eventTaskId) {
          events.push(ev.event);
        }
      }
    })();

    // Wait for subscription to be fully established on the server
    await nc.flush();
    await new Promise(r => setTimeout(r, 200));

    // Run lifecycle (skip claim — store.claim grabs any queued task, not necessarily ours.
    // Claim events are already verified in solo lifecycle tests.)
    await rpc('mesh.tasks.submit', {
      task_id: eventTaskId,
      title: 'Event test',
      budget_minutes: 5,
    });
    createdTaskIds.push(eventTaskId);

    await rpc('mesh.tasks.start', { task_id: eventTaskId });
    await rpc('mesh.tasks.complete', {
      task_id: eventTaskId,
      result: { success: true, summary: 'done' },
    });

    // Give events time to propagate
    await nc.flush();
    await new Promise(r => setTimeout(r, 500));
    sub.unsubscribe();

    assert.ok(events.includes('submitted'), `Expected 'submitted' event, got: ${events}`);
    assert.ok(events.includes('started'), `Expected 'started' event, got: ${events}`);
    assert.ok(events.includes('completed'), `Expected 'completed' event, got: ${events}`);
  });
});

// ════════════════════════════════════════════════════
// 15. SEQUENTIAL MODE — FULL ROUND FLOW
// ════════════════════════════════════════════════════

describe('Sequential mode — full round flow (live NATS)', { timeout: 30000 }, () => {
  const collabTaskId = `${TEST_PREFIX}-seq-full`;
  const nodeA = `${TEST_PREFIX}-seqA`;
  const nodeB = `${TEST_PREFIX}-seqB`;
  const nodeC = `${TEST_PREFIX}-seqC`;
  let sessionId;

  it('submits a sequential collab task', async () => {
    const res = await rpc('mesh.tasks.submit', {
      task_id: collabTaskId,
      title: 'Integration test: sequential full flow',
      description: 'Tests turn-by-turn sequential mode end-to-end',
      budget_minutes: 10,
      scope: ['test/'],
      collaboration: {
        mode: 'sequential',
        min_nodes: 3,
        max_nodes: 3,
        join_window_s: 60,
        max_rounds: 2,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(collabTaskId);

    assert.equal(res.ok, true);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);
    assert.ok(sessionId);
  });

  it('all three nodes join', async () => {
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });

    // Subscribe to node A's round notification before the final join triggers round start
    const roundPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round 1 notification to nodeA'));
      }, 15000);
      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    const res = await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeC });
    assert.equal(res.ok, true);
    assert.equal(res.data.nodes.length, 3);

    // In sequential mode, only the first-turn node should be notified
    const notif = await roundPromise;
    assert.equal(notif.round_number, 1);
    assert.equal(notif.mode, 'sequential');
    assert.equal(notif.current_turn, nodeA);
  });

  it('verifies session is active, round 1, sequential mode', async () => {
    const res = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(res.ok, true);
    assert.equal(res.data.status, 'active');
    assert.equal(res.data.current_round, 1);
    assert.equal(res.data.mode, 'sequential');
  });

  it('node A reflects → daemon publishes turn notification to node B', async () => {
    // Subscribe to node B's round notification BEFORE A reflects
    const nodeBNotifPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for sequential turn notification to nodeB'));
      }, 15000);
      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    // Node A submits its reflection
    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeA,
      summary: 'Node A analyzed test/ directory',
      learnings: 'Found 3 test files',
      artifacts: ['test/analysis-A.md'],
      confidence: 0.7,
      vote: 'continue',
    });
    assert.equal(res.ok, true);

    // Node B should receive a sequential turn notification with intra-round intel
    const notifB = await nodeBNotifPromise;
    assert.equal(notifB.round_number, 1);
    assert.equal(notifB.mode, 'sequential');
    assert.equal(notifB.current_turn, nodeB);
    // Intra-round intel should include node A's reflection
    assert.ok(notifB.shared_intel.includes('Node A analyzed test/ directory'),
      'Node B should see node A\'s summary in shared intel');
    assert.ok(notifB.shared_intel.includes('INTRA-ROUND'),
      'Should include intra-round intel header');
  });

  it('node B reflects → daemon publishes turn notification to node C', async () => {
    const nodeCNotifPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeC}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for sequential turn notification to nodeC'));
      }, 15000);
      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeB,
      summary: 'Node B reviewed A\'s output',
      learnings: 'Confirmed findings, added edge cases',
      artifacts: ['test/review-B.md'],
      confidence: 0.8,
      vote: 'continue',
    });
    assert.equal(res.ok, true);

    // Node C should see both A's and B's reflections in intra-round intel
    const notifC = await nodeCNotifPromise;
    assert.equal(notifC.current_turn, nodeC);
    assert.ok(notifC.shared_intel.includes('Node A analyzed'),
      'Node C should see node A\'s summary');
    assert.ok(notifC.shared_intel.includes('Node B reviewed'),
      'Node C should see node B\'s summary');
  });

  it('node C reflects (last turn) → round evaluates → no convergence → round 2 starts', async () => {
    // Subscribe to node A's round 2 notification (first turn of new round)
    const round2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeA}.round`);
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for round 2 notification to nodeA'));
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

    const res = await rpc('mesh.collab.reflect', {
      session_id: sessionId,
      node_id: nodeC,
      summary: 'Node C synthesized A+B findings',
      learnings: 'Full picture assembled',
      artifacts: ['test/synthesis-C.md'],
      confidence: 0.75,
      vote: 'continue',
    });
    assert.equal(res.ok, true);

    // All 3 voted continue → no convergence → round 2 starts
    const round2 = await round2Promise;
    assert.equal(round2.round_number, 2);
    assert.equal(round2.current_turn, nodeA, 'Node A should be first turn again in round 2');
    // Round 2 shared intel should include round 1 summaries
    assert.ok(round2.shared_intel.includes('ROUND 1'),
      'Round 2 should include round 1 intel');
  });

  it('round 2: all nodes vote converged sequentially → session completes', async () => {
    // Subscribe to BOTH B and C channels upfront before any round 2 reflections.
    // This avoids a race where the daemon publishes a turn notification before
    // the subscription is server-registered.
    const nodeBR2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout waiting for B round 2')); }, 15000);
      (async () => { for await (const msg of sub) { clearTimeout(timer); resolve(JSON.parse(sc.decode(msg.data))); } })();
    });

    const nodeCR2Promise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeC}.round`, { max: 1 });
      const timer = setTimeout(() => { sub.unsubscribe(); reject(new Error('Timeout waiting for C round 2')); }, 15000);
      (async () => { for await (const msg of sub) { clearTimeout(timer); resolve(JSON.parse(sc.decode(msg.data))); } })();
    });

    // Ensure subscriptions are registered on the server before proceeding
    await nc.flush();

    // Node A reflects → daemon advances turn → B gets notified
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeA,
      summary: 'Final pass complete', learnings: 'All issues resolved',
      artifacts: [], confidence: 0.95, vote: 'converged',
    });
    await nodeBR2Promise; // wait for B's turn

    // Node B reflects → daemon advances turn → C gets notified
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeB,
      summary: 'Confirmed', learnings: 'Cross-checked',
      artifacts: [], confidence: 0.9, vote: 'converged',
    });
    await nodeCR2Promise; // wait for C's turn

    // Node C reflects (last turn → round evaluates → unanimous convergence)
    await rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: nodeC,
      summary: 'Agreed', learnings: 'All aligned',
      artifacts: [], confidence: 0.92, vote: 'converged',
    });

    // Session should complete
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(status.data.status, 'completed');
    assert.ok(status.data.total_reflections >= 6, 'Should have 6 reflections (3 per round x 2 rounds)');
  });

  it('parent task is marked completed', async () => {
    const res = await pollUntil('mesh.tasks.get', { task_id: collabTaskId },
      r => r.ok && r.data.status === 'completed');
    assert.equal(res.data.status, 'completed');
  });
});
