#!/usr/bin/env node

/**
 * agent-recruit.test.js — Tests for collab recruit signal and node filtering.
 * Covers Step 5 (recruit listener) from the plan.
 *
 * Requires: NATS + mesh-task-daemon running.
 * Run: node test/agent-recruit.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();
const TEST_PREFIX = `recruit-${Date.now()}`;
let nc;
const createdTaskIds = [];

async function rpc(subject, payload, timeout = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout });
  return JSON.parse(sc.decode(msg.data));
}

before(async () => {
  try {
    nc = await connect({ servers: NATS_URL, timeout: 2000 });
  } catch {
    console.log('⏭ Skipping: NATS server not available');
    process.exit(0);
  }

  // Verify mesh-task-daemon is responding
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
  if (nc) await nc.close();
});

describe('Collab recruit signal', () => {
  it('recruit broadcast is published when collab task is submitted', async () => {
    const taskId = `${TEST_PREFIX}-signal-1`;
    createdTaskIds.push(taskId);

    // Subscribe to recruit wildcard BEFORE submitting
    const recruitPromise = new Promise((resolve, reject) => {
      const sub = nc.subscribe('mesh.collab.*.recruit', { max: 1, timeout: 10000 });
      (async () => {
        for await (const msg of sub) {
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      })();
      setTimeout(() => reject(new Error('No recruit signal within 10s')), 10000);
    });

    // Submit collab task
    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Recruit signal test',
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 30, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });

    const recruit = await recruitPromise;
    assert.ok(recruit.session_id, 'recruit should have session_id');
    assert.equal(recruit.task_id, taskId);
    assert.equal(recruit.mode, 'parallel');
    assert.equal(recruit.min_nodes, 2);
    assert.equal(recruit.max_nodes, 2);
  });

  it('mesh.collab.recruiting RPC returns recruiting sessions', async () => {
    const taskId = `${TEST_PREFIX}-recruiting-1`;
    createdTaskIds.push(taskId);

    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Recruiting poll test',
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 60, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });

    const res = await rpc('mesh.collab.recruiting', {});
    assert.equal(res.ok, true);
    const session = res.data.find(s => s.task_id === taskId);
    assert.ok(session, 'Should find recruiting session for our task');
    assert.equal(session.mode, 'parallel');
    assert.equal(session.min_nodes, 2);
    assert.equal(session.current_nodes, 0);
  });

  it('preferred_nodes filtering: non-preferred node should not match', async () => {
    const taskId = `${TEST_PREFIX}-prefer-1`;
    createdTaskIds.push(taskId);

    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Preferred nodes test',
      preferred_nodes: ['specific-node-only'],
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 30, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });

    // Simulate agent checking: fetch task and check preferred_nodes
    const task = await rpc('mesh.tasks.get', { task_id: taskId });
    const agentNodeId = 'some-other-node';
    const isPreferred = !task.data.preferred_nodes.length ||
      task.data.preferred_nodes.includes(agentNodeId);
    assert.equal(isPreferred, false, 'Agent not in preferred_nodes should not match');
  });

  it('exclude_nodes filtering: excluded node should not match', async () => {
    const taskId = `${TEST_PREFIX}-exclude-1`;
    createdTaskIds.push(taskId);

    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Exclude nodes test',
      exclude_nodes: ['blocked-agent'],
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 30, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });

    const task = await rpc('mesh.tasks.get', { task_id: taskId });
    const agentNodeId = 'blocked-agent';
    const isExcluded = task.data.exclude_nodes.includes(agentNodeId);
    assert.equal(isExcluded, true, 'Agent in exclude_nodes should be blocked');
  });

  it('node with no preference restrictions can join', async () => {
    const taskId = `${TEST_PREFIX}-open-1`;
    createdTaskIds.push(taskId);

    await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Open recruit test',
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 30, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });

    const task = await rpc('mesh.tasks.get', { task_id: taskId });
    const agentNodeId = 'any-node';
    const isPreferred = !task.data.preferred_nodes.length ||
      task.data.preferred_nodes.includes(agentNodeId);
    const isExcluded = task.data.exclude_nodes.includes(agentNodeId);
    assert.equal(isPreferred, true, 'No preferred_nodes = open to all');
    assert.equal(isExcluded, false, 'No exclude_nodes = nobody blocked');
  });
});
