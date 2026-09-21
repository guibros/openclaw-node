import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildObservation, gitEvidence, readInstructions, tail, DEFAULT_LIMITS } from '../lib/foreman/observation.mjs';

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-obs-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  return dir;
}

function baseState(overrides = {}) {
  return {
    status: 'running', started_at: new Date(Date.now() - 5_000).toISOString(), attempt: 1, iteration: 2,
    workers: [], active_worker_id: null, verification_results: [], errors: [], latest_assessment: null,
    latest_intervention: null, ...overrides,
  };
}

describe('foreman observation — bounds', () => {
  it('tail keeps the end and says how much it dropped', () => {
    const text = 'x'.repeat(50) + 'END';
    const bounded = tail(text, 10);
    assert.ok(bounded.endsWith('END'));
    assert.match(bounded, /43 earlier characters omitted/);
    assert.equal(tail('short', 10), 'short');
  });
});

describe('foreman observation — git evidence', () => {
  it('reports status, a bounded diff and changed file names from the worktree', async () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n');
    const evidence = await gitEvidence(dir, DEFAULT_LIMITS);
    assert.match(evidence.status, /M a\.txt/);
    assert.match(evidence.status, /\?\? new\.txt/);
    assert.match(evidence.diff, /\+two/);
    assert.deepEqual(evidence.changed_files, ['a.txt']);
  });
  it('bounds the diff to the configured limit', async () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line\n'.repeat(5_000));
    const evidence = await gitEvidence(dir, { ...DEFAULT_LIMITS, diff: 500 });
    assert.ok(evidence.diff.length < 700, `diff length ${evidence.diff.length}`);
    assert.match(evidence.diff, /earlier characters omitted/);
  });
  it('reads as empty outside a git repository and never throws', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-nogit-'));
    const evidence = await gitEvidence(dir, DEFAULT_LIMITS);
    assert.equal(evidence.diff, '');
    assert.deepEqual(evidence.changed_files, []);
    assert.deepEqual(await gitEvidence(null), { status: '', diff: '', changed_files: [] });
  });
});

describe('foreman observation — repository instructions', () => {
  it('prefers AGENTS.override.md, then AGENTS.md, then CLAUDE.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-instr-'));
    assert.deepEqual(readInstructions(dir), { path: null, text: '' });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'claude rules');
    assert.equal(readInstructions(dir).path, 'CLAUDE.md');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'agents rules');
    assert.equal(readInstructions(dir).path, 'AGENTS.md');
    fs.writeFileSync(path.join(dir, 'AGENTS.override.md'), 'override rules');
    assert.equal(readInstructions(dir).text, 'override rules');
  });
  it('skips a symlinked instruction file and truncates long ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-instr-'));
    fs.writeFileSync(path.join(dir, 'real.md'), 'linked');
    fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'AGENTS.md'));
    assert.equal(readInstructions(dir).path, null);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'r'.repeat(100));
    const bounded = readInstructions(dir, 20);
    assert.ok(bounded.text.startsWith('r'.repeat(20)));
    assert.match(bounded.text, /truncated/);
  });
});

describe('foreman observation — the snapshot', () => {
  it('carries the task, bounded worker tails, git evidence, instructions and prior decisions', async () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Do not edit generated files.');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const worker = {
      worker_id: 'worker-1', kind: 'coding', attempt: 1, status: 'running', started_at: new Date().toISOString(),
      stdout: 'y'.repeat(20_000) + 'LAST', stderr: '', supports_steering: false, steer_count: 0, steer_failures: 0,
    };
    const state = baseState({
      workers: [worker], active_worker_id: 'worker-1',
      latest_assessment: { worker_stuck: 0.2 }, latest_intervention: { action: 'CONTINUE' },
      verification_results: [{ worker_id: 'v', passed: true }], errors: ['boom'],
    });
    const task = { task_id: 't1', title: 'Add rate limiting', description: 'to the API', metric: 'npm test', scope: ['src/'], budget_minutes: 30 };
    const observation = await buildObservation({ task, state, worktreePath: dir, recentEvents: [{ type: 'x' }], limits: { ...DEFAULT_LIMITS, output: 100 } });

    assert.equal(observation.task_id, 't1');
    assert.match(observation.original_task, /Add rate limiting\n\nto the API/);
    assert.equal(observation.metric, 'npm test');
    assert.equal(observation.active_workers.length, 1);
    assert.ok(observation.active_workers[0].stdout_tail.endsWith('LAST'));
    assert.ok(observation.active_workers[0].stdout_tail.length < 200);
    assert.ok(observation.latest_worker_output.length < 200);
    assert.match(observation.git_diff, /\+changed/);
    assert.deepEqual(observation.changed_files, ['a.txt']);
    assert.equal(observation.instructions_path, 'CLAUDE.md');
    assert.match(observation.instructions, /generated files/);
    assert.deepEqual(observation.previous_assessment, { worker_stuck: 0.2 });
    assert.equal(observation.previous_intervention.action, 'CONTINUE');
    assert.equal(observation.verification_results[0].passed, true);
    assert.deepEqual(observation.failures, ['boom']);
    assert.deepEqual(observation.recent_events, [{ type: 'x' }]);
    assert.ok(observation.elapsed_seconds >= 4);
  });
});
