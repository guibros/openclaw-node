import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deIdentify } from '../bin/fed-benchmark.mjs';

describe('deIdentify — content-preserving blinding (operator hold 2026-08-05)', () => {
  it('PRESERVES domain vocabulary the tasks are about (the old sanitizer destroyed Task 5)', () => {
    const text = 'Kill the worker during circling; reviewerA signs off at finalization. The vote: converged path advances the sub-round barrier.';
    const out = deIdentify(text);
    for (const term of ['worker', 'circling', 'reviewerA', 'finalization', 'vote: converged', 'sub-round', 'barrier']) {
      assert.ok(out.includes(term), `domain term "${term}" must survive blinding`);
    }
    assert.ok(!out.includes('<role>') && !out.includes('<phase>'), 'no wholesale placeholders');
  });

  it('strips literal identity markers: node ids, session keys, task ids, worktree paths', () => {
    const text = [
      'bench-w2 joined collab-d14r2p4-watcher-grappe-1754367890 for d14r2p4-watcher-grappe',
      'work happened in /Users/moltymac/.openclaw/worktrees/d14r2p4-watcher-grappe-bench-w2 today',
      'solo id d14r2p4-watcher-solo also ran',
    ].join('\n');
    const out = deIdentify(text);
    assert.ok(!/bench-w\d/.test(out), 'node ids stripped');
    assert.ok(!/collab-/.test(out), 'session keys stripped');
    assert.ok(!/d14r2p4-watcher-(grappe|solo)/.test(out), 'task ids stripped');
    assert.ok(!/worktrees/.test(out), 'worktree paths stripped');
    assert.ok(out.includes('<node>') && out.includes('<session>') && out.includes('<task-id>') && out.includes('<workdir>'));
  });
});
