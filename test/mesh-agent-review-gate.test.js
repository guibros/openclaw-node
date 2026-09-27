#!/usr/bin/env node
/**
 * mesh-agent-review-gate.test.js — review 2026-09-15 F1, driven through
 * mesh-agent's REAL review handlers against a real git workspace; only NATS
 * is faked.
 *
 * The daemon announces a review outcome as a plain core publish on
 * mesh.agent.<node>.approved|rejected, so any bus peer can send one. The agent
 * used to merge (or delete) its kept branch on the notice alone, so a forged
 * `.approved` put unreviewed work on main. It must now ask the daemon first,
 * and act only on a task that is its own and in the matching state. The merge
 * report that follows is fenced by the claim-time lease. The daemon no longer
 * returns that lease on mesh.tasks.get, so the agent keeps it beside the
 * branch, in a 0600 file that goes when the branch goes.
 *
 * Run: node --test test/mesh-agent-review-gate.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The agent reads its workspace, lease dir, node id and obs DB at require time.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-'));
const WORKSPACE = path.join(TMP, 'workspace');
const LEASE_DIR = path.join(TMP, 'leases');
Object.assign(process.env, {
  MESH_WORKSPACE: WORKSPACE,
  MESH_LEASE_DIR: LEASE_DIR,
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  // git in a sandbox: no user/system config (hooks, signing), fixed identity.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
const git = (...args) => execFileSync('git', args, { cwd: WORKSPACE, encoding: 'utf-8', stdio: 'pipe' }).trim();
const branchExists = (branch) => {
  try { git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); return true; } catch { return false; }
};
const onMain = (sha) => {
  try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; }
};
const keptLeases = () => (fs.existsSync(LEASE_DIR) ? fs.readdirSync(LEASE_DIR) : []);
const mode = (p) => fs.statSync(p).mode & 0o777;

/**
 * A workspace whose mesh/T-1 branch the agent's own completion path kept
 * unmerged because the daemon answered pending_review. Returns the work sha.
 */
async function keptForReview(leaseToken = 'lease-from-claim') {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(LEASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'mesh/T-1');
  fs.writeFileSync(path.join(WORKSPACE, 'work.txt'), 'unreviewed task output\n');
  git('add', '.');
  git('commit', '-q', '-m', 'work for T-1');
  const sha = git('rev-parse', '--short', 'HEAD');
  git('checkout', '-q', 'main');

  const kept = await agent.__test.mergeIfApproved(
    { task_id: 'T-1', lease_token: leaseToken },
    { committed: true, branch: 'mesh/T-1', sha },
    { task_id: 'T-1', status: 'pending_review' },
  );
  assert.equal(kept, true, 'pending_review keeps the branch');
  assert.equal(onMain(sha), false);
  const leases = keptLeases();
  assert.equal(leases.length, 1, 'the claim-time lease is kept beside the branch');
  assert.equal(mode(LEASE_DIR), 0o700);
  assert.equal(mode(path.join(LEASE_DIR, leases[0])), 0o600);
  return sha;
}

/** Fake bus: mesh.tasks.get answers with the daemon's view of T-1 (as the post-fix daemon sends it — no lease_token). */
function daemonReports(task) {
  const sent = [];
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        sent.push({ subject, payload: JSON.parse(sc.decode(data)) });
        const reply = subject !== 'mesh.tasks.get'
          ? { ok: true, data: {} }
          : task ? { ok: true, data: { task_id: 'T-1', ...task } } : { ok: false, error: 'Task T-1 not found' };
        return { data: sc.encode(JSON.stringify(reply)) };
      },
    },
  });
  return sent;
}

describe('F1: `.approved` merges only what the daemon reports approved and ours', () => {
  for (const [label, task] of [
    ['still pending review', { status: 'pending_review', owner: 'node-self' }],
    ['owned by another node', { status: 'completed', owner: 'node-other' }],
    ['rejected and re-queued', { status: 'queued', owner: 'node-self', rejection_count: 1 }],
    ['unknown to the daemon', null],
  ]) {
    it(`a notice for a task ${label} merges nothing and keeps the branch`, async () => {
      const sha = await keptForReview();
      const sent = daemonReports(task);
      await agent.__test.onReviewApproved('T-1');
      assert.equal(onMain(sha), false, 'unreviewed work reached main');
      assert.equal(branchExists('mesh/T-1'), true);
      assert.equal(sent.some((m) => m.subject === 'mesh.tasks.merged'), false, 'no merge may be reported');
    });
  }

  it('a real approval merges, reports under the claim-time lease, and drops the branch', async () => {
    const sha = await keptForReview('lease-from-claim');
    const sent = daemonReports({ status: 'completed', owner: 'node-self' });
    await agent.__test.onReviewApproved('T-1');

    assert.equal(onMain(sha), true);
    assert.equal(branchExists('mesh/T-1'), false);
    const report = sent.find((m) => m.subject === 'mesh.tasks.merged');
    assert.ok(report, 'the merge was reported');
    assert.equal(report.payload.merged, true);
    assert.equal(report.payload.node_id, 'node-self');
    assert.equal(report.payload.lease_token, 'lease-from-claim', 'the fence is the kept lease, not anything mesh.tasks.get returned');
    assert.equal(sent.findIndex((m) => m.subject === 'mesh.tasks.get') < sent.indexOf(report), true, 'asked the daemon before merging');
    assert.deepEqual(keptLeases(), [], 'the lease went with the branch');
  });
});

describe('F1: `.rejected` drops only a branch the daemon reports rejected and ours', () => {
  for (const [label, task] of [
    ['still pending review', { status: 'pending_review', owner: 'node-self' }],
    ['approved, merge pending', { status: 'completed', owner: 'node-self' }],
    ['re-queued and since claimed by another node', { status: 'claimed', owner: 'node-other', rejection_count: 1 }],
    ['unknown to the daemon', null],
  ]) {
    it(`a notice for a task ${label} keeps the branch`, async () => {
      await keptForReview();
      daemonReports(task);
      await agent.__test.onReviewRejected('T-1');
      assert.equal(branchExists('mesh/T-1'), true, 'reviewable work was destroyed');
      assert.equal(keptLeases().length, 1, 'and its lease with it');
    });
  }

  for (const [label, task] of [
    ['re-queued for another attempt', { status: 'queued', owner: 'node-self', rejection_count: 1 }],
    ['failed at the rejection cap', { status: 'failed', owner: 'node-self', rejection_count: 3 }],
  ]) {
    it(`a real rejection (${label}) drops the branch and its lease`, async () => {
      await keptForReview();
      daemonReports(task);
      await agent.__test.onReviewRejected('T-1');
      assert.equal(branchExists('mesh/T-1'), false);
      assert.deepEqual(keptLeases(), [], 'the lease went with the branch');
    });
  }
});

describe('startup reconcile reports under the kept lease', () => {
  it('an approval missed while offline is merged and reported with the claim-time lease', async () => {
    const sha = await keptForReview('lease-from-claim');
    const sent = daemonReports({ status: 'completed', owner: 'node-self', result: { merged: false } });
    await agent.__test.reconcileKeptBranches();

    assert.equal(onMain(sha), true);
    const report = sent.find((m) => m.subject === 'mesh.tasks.merged');
    assert.equal(report.payload.lease_token, 'lease-from-claim');
  });
});
