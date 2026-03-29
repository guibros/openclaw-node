#!/usr/bin/env node

/**
 * collab-agent-lifecycle.test.js — Tests for subscribe-before-join pattern
 * and session heartbeat detection.
 *
 * Requires: NATS + mesh-task-daemon running.
 * Run: node test/collab-agent-lifecycle.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();
const TEST_PREFIX = `lifecycle-${Date.now()}`;
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
// SUBSCRIBE-BEFORE-JOIN: last node must not miss round 1
// ════════════════════════════════════════════════════

describe('Subscribe-before-join pattern', () => {
  const taskId = `${TEST_PREFIX}-sbj-1`;
  const nodeA = `${TEST_PREFIX}-sbjA`;
  const nodeB = `${TEST_PREFIX}-sbjB`;
  let sessionId;

  it('last joining node receives round notification when subscribing BEFORE join', async () => {
    // Submit collab task
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Subscribe-before-join test',
      collaboration: {
        mode: 'parallel', min_nodes: 2, max_nodes: 2,
        join_window_s: 60, max_rounds: 1,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Node A joins first
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });

    // KEY PATTERN: Node B subscribes to its round channel BEFORE joining
    const roundPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${nodeB}.round`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Node B missed round notification — subscribe-before-join race'));
      }, 15000);

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
    });

    // Now join — round should auto-start since max_nodes reached
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });

    // If subscribe-before-join works, we get the notification
    const round = await roundPromise;
    assert.equal(round.round_number, 1);
    assert.equal(round.session_id, sessionId);
    assert.ok(round.mode, 'Should include mode');
  });

  it('node A also received round notification', async () => {
    // Verify session is active with round 1
    const status = await rpc('mesh.collab.status', { session_id: sessionId });
    assert.equal(status.ok, true);
    assert.equal(status.data.status, 'active');
    assert.equal(status.data.current_round, 1);
  });
});

// ════════════════════════════════════════════════════
// SESSION HEARTBEAT: detect abort while waiting for rounds
// ════════════════════════════════════════════════════

describe('Session heartbeat detection', () => {
  const taskId = `${TEST_PREFIX}-hb-1`;
  const nodeA = `${TEST_PREFIX}-hbA`;
  const nodeB = `${TEST_PREFIX}-hbB`;
  let sessionId;

  it('can detect session abort via status polling', async () => {
    // Submit collab task
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Heartbeat detection test',
      collaboration: {
        mode: 'parallel', min_nodes: 2, max_nodes: 2,
        join_window_s: 60, max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId);
    sessionId = res.data.collab_session_id;
    createdSessionIds.push(sessionId);

    // Both nodes join, round 1 starts
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeA });
    await rpc('mesh.collab.join', { session_id: sessionId, node_id: nodeB });
    await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && r.data.status === 'active' && r.data.current_round >= 1);

    // Simulate external abort: both nodes leave (below min_nodes)
    await rpc('mesh.collab.leave', { session_id: sessionId, node_id: nodeA, reason: 'test abort' });
    await rpc('mesh.collab.leave', { session_id: sessionId, node_id: nodeB, reason: 'test abort' });

    // Heartbeat pattern: poll status to detect abort
    const status = await pollUntil('mesh.collab.status', { session_id: sessionId },
      r => r.ok && ['aborted', 'completed'].includes(r.data.status),
      { intervalMs: 200, timeoutMs: 10000 });

    assert.ok(['aborted', 'completed'].includes(status.data.status),
      `Session should be aborted or completed after all nodes leave, got: ${status.data.status}`);
  });

  it('active session is detectable as not-aborted', async () => {
    const taskId2 = `${TEST_PREFIX}-hb-2`;
    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId2,
      title: 'Heartbeat active detection',
      collaboration: {
        mode: 'parallel', min_nodes: 2, max_nodes: 2,
        join_window_s: 60, max_rounds: 3,
        convergence: { type: 'unanimous' },
        scope_strategy: 'shared',
      },
    });
    createdTaskIds.push(taskId2);
    const sid2 = res.data.collab_session_id;
    createdSessionIds.push(sid2);

    await rpc('mesh.collab.join', { session_id: sid2, node_id: `${TEST_PREFIX}-hbC` });
    await rpc('mesh.collab.join', { session_id: sid2, node_id: `${TEST_PREFIX}-hbD` });
    await pollUntil('mesh.collab.status', { session_id: sid2 },
      r => r.ok && r.data.status === 'active');

    // Heartbeat check: session is still active (not aborted/completed)
    const status = await rpc('mesh.collab.status', { session_id: sid2 });
    assert.equal(status.data.status, 'active');
    assert.ok(!['aborted', 'completed'].includes(status.data.status));
  });
});
