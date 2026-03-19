#!/usr/bin/env node

/**
 * field-roundtrip.test.js — Verify all routing fields survive submit → KV → get.
 * Covers Steps 3 (bridge dispatch fields) and 7 (provider + routing round-trip).
 *
 * Requires: NATS + mesh-task-daemon running.
 * Run: node test/field-roundtrip.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, StringCodec } = require('nats');
const { NATS_URL } = require('../lib/nats-resolve');

const sc = StringCodec();
const TEST_PREFIX = `frt-${Date.now()}`;
let nc;
const createdTaskIds = [];

async function rpc(subject, payload, timeout = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout });
  return JSON.parse(sc.decode(msg.data));
}

before(async () => {
  nc = await connect({ servers: NATS_URL, timeout: 5000 });
});

after(async () => {
  for (const tid of createdTaskIds) {
    try { await rpc('mesh.tasks.cancel', { task_id: tid }); } catch {}
  }
  if (nc) await nc.close();
});

describe('Routing field round-trip: submit → KV → get', () => {
  it('llm_provider and llm_model survive round-trip', async () => {
    const taskId = `${TEST_PREFIX}-provider-1`;
    createdTaskIds.push(taskId);

    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Provider round-trip test',
      llm_provider: 'shell',
      llm_model: 'custom-model',
    });
    assert.equal(res.ok, true);

    const get = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(get.ok, true);
    assert.equal(get.data.llm_provider, 'shell');
    assert.equal(get.data.llm_model, 'custom-model');
  });

  it('preferred_nodes and exclude_nodes survive round-trip', async () => {
    const taskId = `${TEST_PREFIX}-routing-1`;
    createdTaskIds.push(taskId);

    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Routing round-trip test',
      preferred_nodes: ['node-a', 'node-b'],
      exclude_nodes: ['node-c'],
    });
    assert.equal(res.ok, true);

    const get = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(get.ok, true);
    assert.deepEqual(get.data.preferred_nodes, ['node-a', 'node-b']);
    assert.deepEqual(get.data.exclude_nodes, ['node-c']);
  });

  it('collaboration spec survives round-trip and auto-creates session', async () => {
    const taskId = `${TEST_PREFIX}-collab-1`;
    createdTaskIds.push(taskId);

    const collabSpec = {
      mode: 'parallel',
      min_nodes: 2,
      max_nodes: 3,
      join_window_s: 60,
      max_rounds: 2,
      convergence: { type: 'majority', threshold: 0.66, min_quorum: 2 },
      scope_strategy: 'shared',
    };

    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Collab round-trip test',
      llm_provider: 'shell',
      collaboration: collabSpec,
    });
    assert.equal(res.ok, true);
    assert.ok(res.data.collab_session_id, 'collab_session_id should be set');

    // Verify task has full collaboration spec
    const get = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(get.data.collaboration.mode, 'parallel');
    assert.equal(get.data.collaboration.min_nodes, 2);
    assert.equal(get.data.collaboration.max_nodes, 3);
    assert.equal(get.data.collaboration.convergence.type, 'majority');
    assert.equal(get.data.collaboration.convergence.threshold, 0.66);
    assert.equal(get.data.collaboration.scope_strategy, 'shared');

    // Verify session was created with matching spec
    const session = await rpc('mesh.collab.find', { task_id: taskId });
    assert.equal(session.ok, true);
    assert.equal(session.data.mode, 'parallel');
    assert.equal(session.data.min_nodes, 2);
    assert.equal(session.data.max_nodes, 3);
  });

  it('all routing fields together on one task', async () => {
    const taskId = `${TEST_PREFIX}-all-1`;
    createdTaskIds.push(taskId);

    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'All fields test',
      description: 'uname -a',
      llm_provider: 'shell',
      llm_model: null,
      preferred_nodes: ['moltymac'],
      exclude_nodes: ['bad-node'],
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, join_window_s: 30, max_rounds: 1, convergence: { type: 'unanimous' }, scope_strategy: 'shared' },
    });
    assert.equal(res.ok, true);

    const get = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(get.data.llm_provider, 'shell');
    assert.deepEqual(get.data.preferred_nodes, ['moltymac']);
    assert.deepEqual(get.data.exclude_nodes, ['bad-node']);
    assert.equal(get.data.collaboration.mode, 'parallel');
    assert.ok(get.data.collab_session_id);
  });

  it('null/empty routing fields get proper defaults', async () => {
    const taskId = `${TEST_PREFIX}-defaults-1`;
    createdTaskIds.push(taskId);

    const res = await rpc('mesh.tasks.submit', {
      task_id: taskId,
      title: 'Defaults test',
    });
    assert.equal(res.ok, true);

    const get = await rpc('mesh.tasks.get', { task_id: taskId });
    assert.equal(get.data.llm_provider, null);
    assert.equal(get.data.llm_model, null);
    assert.deepEqual(get.data.preferred_nodes, []);
    assert.deepEqual(get.data.exclude_nodes, []);
    assert.equal(get.data.collaboration, null);
    assert.equal(get.data.collab_session_id, undefined);
  });
});
