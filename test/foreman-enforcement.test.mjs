import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DIMENSIONS } from '../lib/foreman/assessment.mjs';
import { createSimulatedAssessor } from '../lib/foreman/assessor.mjs';
import { ACTIONS } from '../lib/foreman/policy.mjs';
import { createSupervisor } from '../lib/foreman/supervisor.mjs';

const all = (value) => Object.fromEntries(DIMENSIONS.map((name) => [name, value]));
const HEALTHY = { ...all(0.05), implementation_complete: 0.4, meaningful_progress: 0.95 };
const STUCK = { ...all(0.05), meaningful_progress: 0.05, worker_stuck: 0.95 };
const HUMAN = { ...all(0.05), needs_human: 0.95 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const task = { task_id: 'task-enf', title: 'Add rate limiting', description: 'to the API' };
const fastConfig = { min_interval_ms: 10, periodic_ms: 40, stop_grace_ms: 400 };
const children = [];
after(() => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } } });

/**
 * A worker that prints forever; leads its own process group like runLLM's children.
 * `ready` resolves on its first line, i.e. once the script (and any signal handler
 * it registers) is actually running — a signal sent during Node's startup would
 * hit the default handler instead.
 */
function worker({ ignoreTerm = false } = {}) {
  const script = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}setInterval(() => console.log('working'), 10);`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  child.ready = new Promise((resolve) => child.stdout.once('data', () => resolve()));
  return child;
}
const closed = (child) => new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
function timelineFor(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `foreman-enf-${name}-`)), 'task.jsonl');
}
const rows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

describe('foreman enforcement — the supervisor acts on its own decisions', () => {
  it('STOP_WORKER terminates a stuck worker\'s process group and records why', async () => {
    const timelinePath = timelineFor('stop');
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([STUCK]), config: fastConfig, timelinePath }).start();
    supervisor.workerStarted({ attempt: 1 });
    const child = worker();
    supervisor.attach(child);
    const exit = await closed(child);
    supervisor.workerExited({ exitCode: exit.code, signal: exit.signal });
    const summary = await supervisor.close({ outcome: 'stopped' });

    assert.equal(exit.signal, 'SIGTERM');
    assert.equal(supervisor.state.workers[0].status, 'stopped');
    assert.match(supervisor.state.last_stop.reason, /stuck/);
    assert.equal(supervisor.state.last_stop.attempt, 1);
    assert.match(supervisor.state.last_stop.guidance, /Foreman supervisory update/);
    assert.equal(supervisor.state.escalation, null);
    assert.equal(summary.stops, 1);
    const intervened = rows(timelinePath).filter((r) => r.type === 'foreman.intervened');
    assert.equal(intervened[0].action, ACTIONS.STOP_WORKER);
    assert.equal(intervened[0].mode, 'enforce');
    assert.equal(intervened[0].outcome.applied, true);
    assert.equal(intervened[0].outcome.graceful, true);
  });

  it('ESCALATE terminates the worker and raises the escalation for the agent to release', async () => {
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([HUMAN]), config: fastConfig, timelinePath: timelineFor('esc') }).start();
    supervisor.workerStarted({ attempt: 2 });
    const child = worker();
    supervisor.attach(child);
    const exit = await closed(child);
    supervisor.workerExited({ exitCode: exit.code, signal: exit.signal });
    const summary = await supervisor.close();

    assert.equal(exit.signal, 'SIGTERM');
    assert.match(supervisor.state.escalation.reason, /human/);
    assert.equal(supervisor.state.last_stop.action, ACTIONS.ESCALATE);
    assert.equal(supervisor.state.last_stop.attempt, 2);
    assert.match(summary.escalation, /human/);
  });

  it('falls back to SIGKILL when the worker ignores SIGTERM past the grace period', async () => {
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([STUCK]), config: { ...fastConfig, stop_grace_ms: 60 }, timelinePath: timelineFor('kill') }).start();
    const child = worker({ ignoreTerm: true });
    await child.ready;
    supervisor.workerStarted({ attempt: 1 });
    supervisor.attach(child);
    const exit = await closed(child);
    supervisor.workerExited({ exitCode: exit.code, signal: exit.signal });
    await supervisor.close();
    assert.equal(exit.signal, 'SIGKILL');
    const intervened = rows(supervisor.summary().timeline).filter((r) => r.type === 'foreman.intervened');
    assert.equal(intervened[0].outcome.graceful, false);
  });

  it('shadow mode records the same decision and leaves the worker alone', async () => {
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([STUCK]), config: { ...fastConfig, enforce: false }, timelinePath: timelineFor('shadow') }).start();
    supervisor.workerStarted({ attempt: 1 });
    const child = worker();
    supervisor.attach(child);
    await sleep(150);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    process.kill(-child.pid, 'SIGTERM');
    const exit = await closed(child);
    supervisor.workerExited({ exitCode: exit.code, signal: exit.signal });
    const summary = await supervisor.close();
    assert.equal(summary.stops, 0);
    assert.equal(supervisor.state.last_stop, null);
    const intervened = rows(summary.timeline).filter((r) => r.type === 'foreman.intervened');
    assert.ok(intervened.length >= 1);
    assert.ok(intervened.every((r) => r.mode === 'shadow' && r.action === ACTIONS.STOP_WORKER));
  });

  it('assessNow() returns the decision at the agent\'s decision points, or null without an assessment', async () => {
    const assessor = createSimulatedAssessor([HEALTHY]);
    const supervisor = createSupervisor({ task, assessor, config: { ...fastConfig, periodic_ms: 10_000 } }).start();
    const before = supervisor.state.iteration;
    const decision = await supervisor.assessNow();
    assert.equal(decision.action, ACTIONS.START_WORKER);
    assert.equal(supervisor.state.iteration, before + 1);
    await supervisor.close();

    const down = createSupervisor({ task, assessor: { name: 'down', async assess() { return { ok: false, reason: 'busy' }; } }, config: fastConfig }).start();
    assert.equal(await down.assessNow(), null);
    await down.close();
    assert.equal(await down.assessNow(), null);
  });

  it('a real verifier worker owns its verification result; a metric adds a synthetic one', async () => {
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([HEALTHY]), config: { ...fastConfig, periodic_ms: 10_000 } }).start();
    const verifier = supervisor.workerStarted({ attempt: 1, kind: 'verifier' });
    supervisor.workerExited({ exitCode: 0 });
    supervisor.recordVerification({ passed: false, summary: 'FOREMAN_VERDICT: FAIL\nmissing tests', source: 'verifier', workerId: verifier.worker_id });
    assert.equal(supervisor.state.workers.length, 1);
    assert.equal(supervisor.state.workers[0].status, 'failed');
    assert.deepEqual(supervisor.state.verification_results.map((r) => [r.worker_id, r.passed, r.source]), [[verifier.worker_id, false, 'verifier']]);
    supervisor.recordVerification({ passed: true, summary: 'ok', source: 'metric' });
    assert.equal(supervisor.state.workers.length, 2);
    assert.equal(supervisor.state.workers[1].kind, 'verifier');
    await supervisor.close();
  });
});
