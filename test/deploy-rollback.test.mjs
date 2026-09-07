/**
 * deploy-rollback.test.mjs — REMEDIATION_PLAN P4-9.
 *
 * The catch-up decision used to be `HEAD != latest`, so a deploy that fast-
 * forwarded the tree and then failed (npm install, service restart) looked
 * "done" on every restart, and a sha that fails every time was retried on
 * every reconnect. shouldCatchUp is the pure decision; the listener consults
 * the local marker it writes after each attempt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldCatchUp } = require('../bin/mesh-deploy-listener.js');

describe('shouldCatchUp (deploy catch-up verdict)', () => {
  it('deploys when the tree is behind latest', () => {
    const v = shouldCatchUp({ currentSha: 'aaaaaaa', latestSha: 'bbbbbbb', lastDeploy: null });
    assert.equal(v.deploy, true);
  });

  it('does nothing when the tree is at latest and the last attempt succeeded', () => {
    const v = shouldCatchUp({ currentSha: 'bbbbbbb', latestSha: 'bbbbbbb', lastDeploy: { sha: 'bbbbbbb', status: 'success', attempts: 1 } });
    assert.equal(v.deploy, false);
  });

  it('does NOT treat merged-but-failed as deployed: tree at latest + failed marker → re-attempt', () => {
    const v = shouldCatchUp({ currentSha: 'bbbbbbb', latestSha: 'bbbbbbb', lastDeploy: { sha: 'bbbbbbb', status: 'failed', attempts: 1 }, maxAttempts: 2 });
    assert.equal(v.deploy, true);
    assert.match(v.reason, /deploy failed/);
  });

  it('stops retrying a sha that already failed maxAttempts times on this node', () => {
    const behind = shouldCatchUp({ currentSha: 'aaaaaaa', latestSha: 'bbbbbbb', lastDeploy: { sha: 'bbbbbbb', status: 'failed', attempts: 2 }, maxAttempts: 2 });
    assert.equal(behind.deploy, false);
    assert.match(behind.reason, /not retrying/);
  });

  it('a failed marker for a DIFFERENT sha does not block catching up to latest', () => {
    const v = shouldCatchUp({ currentSha: 'aaaaaaa', latestSha: 'ccccccc', lastDeploy: { sha: 'bbbbbbb', status: 'failed', attempts: 5 }, maxAttempts: 2 });
    assert.equal(v.deploy, true);
  });

  it('matches short and full shas', () => {
    const v = shouldCatchUp({ currentSha: 'bbbbbbb', latestSha: 'bbbbbbb1234567890', lastDeploy: { sha: 'bbbbbbb', status: 'success', attempts: 1 } });
    assert.equal(v.deploy, false);
  });
});
