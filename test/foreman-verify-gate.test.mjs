/**
 * foreman-verify-gate.test.mjs — the no-metric completion gate in bin/mesh-agent.js
 * (`foremanVerify`) and the supervision wrapper (`superviseTask`), driven through the
 * agent's real runLLM with a registered stub provider: a node script that plays the
 * verifier (PASS, FAIL, no verdict, a quoted PASS, a writer, a committer, one that
 * exits 0 on SIGTERM after its PASS, a slow one) in a real git worktree.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { DIMENSIONS } from '../lib/foreman/assessment.mjs';
import { createSimulatedAssessor } from '../lib/foreman/assessor.mjs';
import { createSupervisor } from '../lib/foreman/supervisor.mjs';

const require = createRequire(import.meta.url);
const { registerProvider } = require('../lib/llm-providers.js');
const { foremanVerify, superviseTask } = require('../bin/mesh-agent.js');

const all = (value) => Object.fromEntries(DIMENSIONS.map((name) => [name, value]));
const HEALTHY = { ...all(0.05), implementation_complete: 0.4, meaningful_progress: 0.95 };
const READY = { ...all(0.02), implementation_complete: 0.99, tests_sufficient: 0.99, requirements_satisfied: 0.99, meaningful_progress: 0.99, ready_to_finish: 0.99 };
const HUMAN = { ...all(0.05), needs_human: 0.95 };
const STUCK = { ...all(0.05), worker_stuck: 0.95 };
const DOWN ={ name: 'down', async assess() { return { ok: false, reason: 'assessor unavailable: ollama-busy-extraction' }; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fastConfig = { min_interval_ms: 10, periodic_ms: 40 };
const CODING = { exitCode: 0, stdout: 'Implemented the limiter.\nFOREMAN_VERDICT: PASS', stderr: '' };

let scratch;
let invocations;
const STUB = `
const fs = require('fs');
const path = require('path');
const [dir, mode] = process.argv.slice(2);
const say = (text) => process.stdout.write(text + '\\n');
switch (mode) {
  case 'pass': say('Ran the limiter tests; the reset path is covered.'); say('FOREMAN_VERDICT: PASS'); break;
  case 'fail': say('The limiter never resets after the window.'); say('FOREMAN_VERDICT: FAIL'); break;
  case 'none': say('Looks fine to me.'); break;
  case 'quoted': say('The worker wrote:'); say('FOREMAN_VERDICT: PASS'); say('but the reset path is untested.'); say('FOREMAN_VERDICT: FAIL'); break;
  case 'pass-exit1': say('FOREMAN_VERDICT: PASS'); process.exitCode = 1; break;
  case 'writes':
    fs.writeFileSync(path.join(dir, 'verifier-notes.txt'), 'scratch');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'rewritten by the verifier\\n');
    say('Fixed a typo while checking.'); say('FOREMAN_VERDICT: PASS'); break;
  case 'stopped-pass':
    // A CLI that has printed PASS, then goes quiet, and exits 0 on SIGTERM. The handler is in place
    // before the verdict is printed, so a stop that follows the verdict always meets it.
    process.on('SIGTERM', () => process.exit(0));
    say('Checked the limiter; the tests pass.'); say('FOREMAN_VERDICT: PASS');
    setInterval(() => {}, 1000);
    setTimeout(() => process.exit(0), 20000);
    break;
  case 'commits':
    require('child_process').execFileSync('git', ['-C', dir, 'add', '-A']);
    require('child_process').execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'verifier: checkpoint']);
    say('Committed a checkpoint to compare against.'); say('FOREMAN_VERDICT: PASS'); break;
  case 'slow-pass': setTimeout(() => say('FOREMAN_VERDICT: PASS'), 15000); break;
}
`;

before(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-gate-'));
  const stubPath = path.join(scratch, 'verifier-stub.js');
  fs.writeFileSync(stubPath, STUB);
  invocations = path.join(scratch, 'invocations.jsonl');
  registerProvider('foreman-stub', {
    binary: process.execPath,
    buildArgs(prompt, model, task, targetDir) {
      fs.appendFileSync(invocations, `${JSON.stringify({ mode: task.stub_mode, targetDir, prompt })}\n`);
      return [stubPath, targetDir, task.stub_mode];
    },
  });
});
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function calls() {
  try { return fs.readFileSync(invocations, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}

/** A task worktree the coding worker has just left: one edited file, one new file. */
function worktree() {
  const dir = fs.mkdtempSync(path.join(scratch, 'wt-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nlimiter\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'limiter test\n');
  return dir;
}

/** A supervisor whose coding worker (attempt 1) just exited cleanly. */
function supervised({ assessor = createSimulatedAssessor([HEALTHY]), enforce = true, dir = worktree(), mode = 'pass', provider = 'foreman-stub', taskFields = {} } = {}) {
  const task = { task_id: `gate-${path.basename(dir)}`, title: 'Add rate limiting', description: 'to the API', llm_provider: provider, stub_mode: mode, budget_minutes: 1, ...taskFields };
  const supervisor = createSupervisor({ task, worktreePath: dir, assessor, config: { ...fastConfig, enforce }, log: () => {} }).start();
  supervisor.workerStarted({ attempt: 1 });
  supervisor.workerExited({ exitCode: 0 });
  return { task, dir, supervisor };
}

async function gate(options) {
  const before = calls().length;
  const setup = supervised(options);
  try {
    const result = await foremanVerify(setup.supervisor, setup.task, setup.dir, 1, CODING);
    return { ...setup, result, spawned: calls().slice(before) };
  } finally {
    // A gate that throws must not leave a live loop holding the test process open.
    await setup.supervisor.close();
  }
}

const verifications = (supervisor) => supervisor.state.verification_results.map((r) => [r.source, r.passed]);

describe('foremanVerify — enforcing, no metric: only a verifier PASS completes', () => {
  it('a PASS from the verifier completes the attempt', async () => {
    const { result, spawned, supervisor } = await gate({ mode: 'pass' });
    assert.deepEqual(result, { escalate: false, attemptRecord: null });
    assert.equal(spawned.length, 1);
    assert.deepEqual(verifications(supervisor), [['verifier', true]]);
    assert.equal(supervisor.state.workers.filter((w) => w.kind === 'verifier').length, 1);
  });

  it('the verifier runs whatever the post-exit decision is — START_WORKER, FINISH, or no answer at all', async () => {
    for (const assessor of [createSimulatedAssessor([HEALTHY]), createSimulatedAssessor([READY]), DOWN]) {
      const { result, spawned, supervisor } = await gate({ assessor, mode: 'fail' });
      assert.equal(spawned.length, 1, `verifier must run (assessor ${assessor.name})`);
      assert.ok(result.attemptRecord, 'a FAIL never completes');
      assert.deepEqual(verifications(supervisor), [['verifier', false]]);
    }
  });

  it('FAIL is a failed attempt carrying the findings for the retry', async () => {
    const { result } = await gate({ mode: 'fail' });
    assert.equal(result.escalate, false);
    assert.match(result.attemptRecord.approach, /^Attempt 1: Foreman verifier FAIL/);
    assert.match(result.attemptRecord.result, /FOREMAN_VERDICT: FAIL\nThe limiter never resets/);
    assert.equal(result.attemptRecord.keep, false);
  });

  it('no verdict line, a quoted PASS beside the real FAIL, or PASS with a failed exit — none completes', async () => {
    const none = await gate({ mode: 'none' });
    assert.match(none.result.attemptRecord.approach, /returned no verdict line/);
    const quoted = await gate({ mode: 'quoted' });
    assert.match(quoted.result.attemptRecord.approach, /returned 2 verdict lines/);
    const crashed = await gate({ mode: 'pass-exit1' });
    assert.match(crashed.result.attemptRecord.approach, /verifier PASS \(exit 1\)/);
    for (const { supervisor } of [none, quoted, crashed]) assert.deepEqual(verifications(supervisor), [['verifier', false]]);
  });

  it('the verifier sees every change the worker made and a report it cannot echo a verdict from', async () => {
    const { spawned } = await gate({ mode: 'pass' });
    const { prompt, targetDir } = spawned[0];
    assert.match(prompt, /- a\.txt\n- new\.txt/);
    const report = prompt.slice(prompt.indexOf('<<<WORKER REPORT'), prompt.indexOf('WORKER REPORT>>>'));
    assert.match(report, /Implemented the limiter\./);
    assert.doesNotMatch(report, /FOREMAN_VERDICT/);
    assert.ok(fs.existsSync(path.join(targetDir, 'new.txt')));
  });

  it('a verifier that writes voids its PASS, and everything it wrote is reverted', async () => {
    const { result, dir, supervisor } = await gate({ mode: 'writes' });
    assert.match(result.attemptRecord.approach, /Foreman verifier modified the worktree/);
    assert.match(result.attemptRecord.result, /verifier-notes\.txt/);
    assert.match(result.attemptRecord.result, /its changes were reverted/);
    assert.equal(fs.existsSync(path.join(dir, 'verifier-notes.txt')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\nlimiter\n', "the coding worker's edit is back");
    assert.equal(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'limiter test\n');
    assert.deepEqual(verifications(supervisor), [['verifier', false]]);
  });

  it('ESCALATE after the worker exits releases without running a verifier', async () => {
    const { result, spawned } = await gate({ assessor: createSimulatedAssessor([HUMAN]) });
    assert.equal(result.escalate, true);
    assert.match(result.attemptRecord.approach, /escalated by Foreman after the worker finished — .*human/);
    assert.equal(spawned.length, 0);
  });

  it('a shell task has no verifier: its exit status is the verification and the attempt completes', async () => {
    const dir = worktree();
    const { result, supervisor } = await gate({ dir, provider: 'shell' });
    assert.deepEqual(result, { escalate: false, attemptRecord: null });
    assert.equal(supervisor.state.workers.filter((w) => w.kind === 'verifier' && w.status === 'running').length, 0);
    assert.deepEqual(verifications(supervisor), [['exit-code', true]]);
    assert.equal(supervisor.state.workers.length, 2, 'the coding worker + the synthetic exit-code record, no verifier run');
  });
});

describe('foremanVerify — a stopped verifier, a committing verifier, and the task deadline (PR #32 review)', () => {
  /** Answers `reading` only once the running verifier has printed its PASS; HEALTHY otherwise. */
  const onVerifierPass = (reading) => createSimulatedAssessor([(obs) => (
    obs.active_workers.some((w) => w.kind === 'verifier' && /FOREMAN_VERDICT: PASS/.test(w.stdout_tail)) ? reading : HEALTHY
  )]);
  const verifierOf = (supervisor) => supervisor.state.workers.find((w) => w.kind === 'verifier');
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  it('a verifier Foreman STOPs voids its PASS even when it exits 0, and the attempt is retried', async () => {
    const { result, supervisor } = await gate({ mode: 'stopped-pass', assessor: onVerifierPass(STUCK) });
    const verifier = verifierOf(supervisor);
    assert.equal(supervisor.state.last_stop.worker_id, verifier.worker_id);
    assert.equal(supervisor.state.last_stop.action, 'STOP_WORKER');
    assert.equal(verifier.exit_code, 0, 'the CLI trapped SIGTERM and exited 0');
    assert.match(verifier.stdout, /FOREMAN_VERDICT: PASS/, 'having printed its PASS first');
    assert.equal(result.escalate, false, 'a STOP is a failed attempt, not a release');
    assert.match(result.attemptRecord.approach, /^Attempt 1: Foreman verifier stopped — active worker appears stuck/);
    assert.match(result.attemptRecord.result, /its verdict does not count/);
    assert.deepEqual(verifications(supervisor), [['verifier', false]]);
    assert.equal(verifier.status, 'stopped', 'recording the verdict must not turn the stop into a completion');
  });

  it('a verifier Foreman ESCALATEs voids its PASS and releases the task', async () => {
    const { result, supervisor } = await gate({ mode: 'stopped-pass', assessor: onVerifierPass(HUMAN) });
    const verifier = verifierOf(supervisor);
    assert.equal(supervisor.state.last_stop.worker_id, verifier.worker_id);
    assert.equal(supervisor.state.last_stop.action, 'ESCALATE');
    assert.equal(verifier.exit_code, 0);
    assert.equal(result.escalate, true);
    assert.match(result.attemptRecord.approach, /^Attempt 1: escalated by Foreman during verification — .*human/);
    assert.deepEqual(verifications(supervisor), [['verifier', false]]);
    assert.equal(verifier.status, 'stopped');
  });

  it('a verifier that commits is caught by HEAD, not the tree hash: voided, its commit dropped, the worker\'s changes kept', async () => {
    const dir = worktree();
    const head = git(dir, 'rev-parse', 'HEAD');
    const { result, supervisor } = await gate({ dir, mode: 'commits' });
    assert.match(result.attemptRecord.approach, /Foreman verifier modified the worktree/);
    assert.match(result.attemptRecord.result, /the verifier moved HEAD .*; HEAD was reset, the worker's changes kept/);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'HEAD is back where the verifier found it');
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\nlimiter\n');
    assert.equal(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'limiter test\n');
    assert.match(git(dir, 'status', '--porcelain'), /a\.txt[\s\S]*new\.txt/, 'the changes are still there for commitWorktree');
    assert.deepEqual(verifications(supervisor), [['verifier', false]]);
  });

  it('no verifier is started once the task deadline has passed; the attempt fails for the loop\'s budget check', async () => {
    const { result, spawned, supervisor } = await gate({ mode: 'pass', taskFields: { budget_deadline: new Date(Date.now() - 60_000).toISOString() } });
    assert.equal(spawned.length, 0);
    assert.equal(result.escalate, false);
    assert.match(result.attemptRecord.approach, /^Attempt 1: Foreman verifier not run/);
    assert.match(result.attemptRecord.result, /budget was exhausted/);
    assert.equal(verifierOf(supervisor), undefined);
    assert.deepEqual(verifications(supervisor), []);
  });

  it('the verifier runs on what is left of the deadline, not a fresh budget_minutes', async () => {
    const started = Date.now();
    // budget_minutes: 1 would let this verifier print PASS at 15 s; the deadline stops it at ~3 s.
    const { result, spawned, supervisor } = await gate({ mode: 'slow-pass', taskFields: { budget_deadline: new Date(Date.now() + 3_000).toISOString() } });
    assert.equal(spawned.length, 1);
    assert.ok(Date.now() - started < 12_000, `the verifier outlived the task deadline (${Date.now() - started} ms)`);
    assert.match(result.attemptRecord.approach, /Foreman verifier returned no verdict line/);
    assert.deepEqual(verifications(supervisor), [['verifier', false]]);
  });
});

describe('foremanVerify — shadow and off complete as before', () => {
  it('shadow mode completes without a verifier', async () => {
    const { result, spawned, supervisor } = await gate({ enforce: false, mode: 'fail' });
    assert.deepEqual(result, { escalate: false, attemptRecord: null });
    assert.equal(spawned.length, 0);
    assert.deepEqual(verifications(supervisor), []);
  });
  it('no supervisor (MESH_FOREMAN=0) completes without a verifier', async () => {
    const result = await foremanVerify(null, { task_id: 't', llm_provider: 'foreman-stub', stub_mode: 'fail' }, worktree(), 1, CODING);
    assert.deepEqual(result, { escalate: false, attemptRecord: null });
  });
});

describe('superviseTask — every exit closes the supervisor', () => {
  function timeline() {
    return path.join(fs.mkdtempSync(path.join(scratch, 'tl-')), 'task.jsonl');
  }
  const rows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  it('a throw in the attempt loop closes a supervisor that was watching a worker, and the loop stops', async () => {
    const assessor = createSimulatedAssessor([HEALTHY]);
    const timelinePath = timeline();
    const supervisor = createSupervisor({ task: { task_id: 'leak' }, assessor, config: fastConfig, timelinePath, log: () => {} }).start();
    supervisor.workerStarted({ attempt: 1 });
    try {
      await assert.rejects(superviseTask(supervisor, async () => { await sleep(60); throw new Error('natsRequest mesh.tasks.attempt: timeout'); }), (err) => {
        assert.match(err.message, /timeout/);
        // The main loop writes this task's telemetry row; the summary must reach it (step 1.2, 2026-09-27).
        assert.match(err.foremanNote, /^ Foreman\[shadow\] iterations=\d+ /);
        return true;
      });
      assert.equal(supervisor.closed, true);
      const last = rows(timelinePath).at(-1);
      assert.equal(last.type, 'foreman.closed');
      assert.equal(last.outcome, 'error');
      const settled = assessor.calls.length;
      await sleep(150);
      assert.equal(assessor.calls.length, settled, 'a closed supervisor never assesses again');
    } finally {
      await supervisor.close();
    }
  });

  it('a run that closed its supervisor is not closed twice; no supervisor is fine', async () => {
    const timelinePath = timeline();
    const supervisor = createSupervisor({ task: { task_id: 'ok' }, assessor: createSimulatedAssessor([HEALTHY]), config: fastConfig, timelinePath, log: () => {} }).start();
    const value = await superviseTask(supervisor, async () => { await supervisor.close({ outcome: 'success' }); return 'done'; });
    assert.equal(value, 'done');
    const closedRows = rows(timelinePath).filter((r) => r.type === 'foreman.closed');
    assert.deepEqual(closedRows.map((r) => r.outcome), ['success']);
    assert.equal(await superviseTask(null, async () => 42), 42);
  });
});
