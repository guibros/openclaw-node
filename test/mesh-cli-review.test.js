#!/usr/bin/env node
/**
 * mesh-cli-review.test.js — the REAL `mesh tasks approve|reject|submit` CLI
 * against the live task daemon (the CI mesh stack; a visible skip elsewhere).
 *
 * The daemon refuses with a normal reply, { ok: false, error }, and the CLI
 * printed fields off the reply without looking at `ok`. A refused approval
 * printed "Task approved: undefined → undefined", which is how the operator
 * found it on 2026-09-27. Even a successful one printed undefined, because the
 * task is under `data`. A refusal must exit non-zero with the daemon's reason.
 * (`mesh submit` goes through the same helper, but it cannot run on a clean
 * install until the `yaml` module it requires is a declared dependency.)
 *
 * Run: node --test test/mesh-cli-review.test.js   (needs NATS + mesh-task-daemon)
 */
const { describe, it, before, after } = require('node:test');
const { meshSkipReason } = require('./helpers/mesh-available.cjs');
const { acquireMeshLock, releaseMeshLock } = require('./helpers/mesh-lock.cjs');
const skipReason = meshSkipReason();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { natsConnectOpts } = require('../lib/nats-resolve');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const REPO = path.join(__dirname, '..');
const NODE = `cli-review-${crypto.randomBytes(3).toString('hex')}`;
let nc;
let sc;

before(async () => {
  if (skipReason) return;
  await acquireMeshLock('mesh-cli-review.test.js');
  const { connect, StringCodec } = require('nats');
  sc = StringCodec();
  nc = await connect(natsConnectOpts({ timeout: 5000 }));
});

after(async () => {
  if (skipReason) return;
  if (nc && !nc.isClosed()) {
    for (const tid of createdTaskIds) {
      try { await rpc('mesh.tasks.cancel', signOperatorRequest({ task_id: tid })); } catch { /* best-effort */ }
    }
    await nc.close();
  }
  releaseMeshLock();
});

// Every task this file creates is cancelled in `after`, so none is left queued
// for the next suite's claim.
const createdTaskIds = [];
function uniqueTaskId() {
  const id = `T-CLI-${crypto.randomBytes(4).toString('hex')}`;
  createdTaskIds.push(id);
  return id;
}

async function rpc(subject, payload) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: 10000 });
  return JSON.parse(sc.decode(msg.data));
}

/**
 * A task this file owns, completed without a metric, so it waits in
 * pending_review. Each gets its own node: a rejected task goes back to the
 * queue, and a shared node would claim that one next.
 */
async function taskAwaitingReview() {
  const id = uniqueTaskId();
  const node = `${NODE}-${id}`;
  assert.equal((await rpc('mesh.tasks.submit', { task_id: id, title: 'cli review', priority: 1000, preferred_nodes: [node] })).ok, true);
  const claim = await rpc('mesh.tasks.claim', { node_id: node });
  assert.equal(claim.data?.task_id, id, 'claimed our own task');
  const done = await rpc('mesh.tasks.complete', {
    task_id: id, node_id: node, lease_token: claim.data.lease_token, result: { success: true, summary: 'cli review' },
  });
  assert.equal(done.data?.status, 'pending_review');
  return id;
}

function mesh(...args) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'mesh.js'), ...args], { cwd: REPO, env: process.env, encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('mesh tasks approve / reject report what the daemon did', { skip: skipReason }, () => {
  it('approve prints the task and its new status', async () => {
    const id = await taskAwaitingReview();
    const r = mesh('tasks', 'approve', id);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Task approved: ${id} → completed`));
  });

  it('a refused approve exits non-zero with the daemon\'s reason and never says "approved"', async () => {
    const id = await taskAwaitingReview();
    assert.equal(mesh('tasks', 'approve', id).status, 0);

    const again = mesh('tasks', 'approve', id); // completed now: the daemon refuses
    assert.equal(again.status, 1);
    assert.match(again.stderr, /mesh\.tasks\.approve refused: .*not in pending_review/);
    assert.doesNotMatch(again.stdout, /Task approved/);
  });

  it('reject re-queues the task and says so', async () => {
    const id = await taskAwaitingReview();
    const r = mesh('tasks', 'reject', id, '--reason', 'needs another pass');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Task rejected: ${id} → re-queued`));
  });

  it('a refused reject exits non-zero with the daemon\'s reason', async () => {
    const id = await taskAwaitingReview();
    assert.equal(mesh('tasks', 'reject', id).status, 0); // back in the queue now
    const again = mesh('tasks', 'reject', id);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /mesh\.tasks\.reject refused: .*not in pending_review/);
    assert.doesNotMatch(again.stdout, /Task rejected/);
  });
});

describe('mesh tasks review lists what awaits review', { skip: skipReason }, () => {
  it('shows a task awaiting review with its approve and reject commands', async () => {
    const id = await taskAwaitingReview();
    const r = mesh('tasks', 'review');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`${id}  "cli review"`));
    assert.match(r.stdout, new RegExp(`Approve: mesh tasks approve ${id}`));
  });
});
