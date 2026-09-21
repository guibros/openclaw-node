import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { DIMENSIONS } from '../lib/foreman/assessment.mjs';
import { createSimulatedAssessor } from '../lib/foreman/assessor.mjs';
import { ACTIONS } from '../lib/foreman/policy.mjs';
import { createSupervisor, foremanConfigFromEnv, DEFAULT_CONFIG } from '../lib/foreman/supervisor.mjs';

const all = (value) => Object.fromEntries(DIMENSIONS.map((name) => [name, value]));
const HEALTHY = { ...all(0.05), implementation_complete: 0.4, meaningful_progress: 0.95 };
const STUCK = { ...all(0.05), meaningful_progress: 0.05, worker_stuck: 0.95 };
const READY = { ...all(0.02), implementation_complete: 0.99, tests_sufficient: 0.99, requirements_satisfied: 0.99, meaningful_progress: 0.99, ready_to_finish: 0.99 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const task = { task_id: 'task-42', title: 'Add rate limiting', description: 'to the API', metric: 'npm test' };
const fastConfig = { min_interval_ms: 10, periodic_ms: 40 };

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}
function timelineFor(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `foreman-sup-${name}-`)), 'task-42.jsonl');
}
function readTimeline(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

describe('foreman supervisor — shadow loop', () => {
  it('observes a streaming worker, assesses, decides, and records a timeline without per-line writes', async () => {
    const assessor = createSimulatedAssessor([(obs) => (obs.active_workers.length ? HEALTHY : READY)]);
    const published = [];
    const timelinePath = timelineFor('shadow');
    const supervisor = createSupervisor({
      task, nodeId: 'node-a', assessor, config: { ...fastConfig, enforce: false }, timelinePath,
      publish: (subject, payload) => { published.push({ subject, payload }); },
    }).start();

    supervisor.workerStarted({ attempt: 1 });
    const child = fakeChild();
    supervisor.attach(child);
    for (let i = 0; i < 60; i += 1) { child.stdout.write(`reasoning delta ${i}\n`); await sleep(2); }
    await sleep(60);
    supervisor.workerExited({ exitCode: 0 });
    supervisor.recordVerification({ passed: true, summary: 'npm test: 12 passed', source: 'metric' });
    await sleep(60);
    const summary = await supervisor.close({ outcome: 'success' });

    assert.ok(summary.iterations >= 2, `iterations ${summary.iterations}`);
    assert.equal(summary.mode, 'shadow');
    assert.equal(summary.assessor_failures, 0);
    assert.ok(summary.actions.CONTINUE >= 1);
    assert.equal(summary.timeline, timelinePath);
    assert.ok(supervisor.state.workers[0].stdout.endsWith('reasoning delta 59\n'));

    const rows = readTimeline(timelinePath);
    const types = rows.map((row) => row.type);
    for (const expected of ['foreman.started', 'worker.started', 'foreman.observed', 'foreman.assessed', 'foreman.intervened', 'worker.exited', 'verification.recorded', 'foreman.closed']) {
      assert.ok(types.includes(expected), `timeline lacks ${expected}: ${types.join(',')}`);
    }
    assert.ok(!types.includes('worker.output'), 'output lines must not be written to the timeline');
    assert.ok(rows.filter((r) => r.type === 'foreman.observed').length < 20, 'bursts must coalesce');
    const intervened = rows.filter((row) => row.type === 'foreman.intervened');
    assert.ok(intervened.every((row) => row.mode === 'shadow' && row.outcome === null));
    assert.equal(rows[0].type, 'foreman.started');
    assert.equal(rows[rows.length - 1].type, 'foreman.closed');
    assert.ok(published.some((p) => p.subject === 'mesh.foreman.assessed' && p.payload.task_id === 'task-42'));
    assert.ok(published.some((p) => p.subject === 'mesh.foreman.closed'));
    // The metric passed after the worker exited, so the final shadow decision is FINISH.
    assert.equal(intervened[intervened.length - 1].action, ACTIONS.FINISH);
    assert.match(supervisor.summaryLine('success'), /^Foreman\[shadow\] iterations=\d+ interventions=\d+ actions=/);
  });

  it('records decisions in shadow mode and only calls the enforcement seam when enforce is on', async () => {
    const calls = [];
    const make = (enforce) => createSupervisor({
      task, assessor: createSimulatedAssessor([STUCK]), config: { ...fastConfig, enforce }, timelinePath: timelineFor(enforce ? 'enf' : 'shd'),
      onIntervention: async (intervention, context) => { calls.push({ intervention, hasMessage: Boolean(context.steeringMessage) }); return { applied: true }; },
    }).start();

    const shadow = make(false);
    shadow.workerStarted({ attempt: 1 }); shadow.attach(fakeChild());
    await sleep(50);
    const shadowSummary = await shadow.close();
    assert.equal(calls.length, 0);
    assert.ok(shadowSummary.actions.STOP_WORKER >= 1, JSON.stringify(shadowSummary.actions));
    assert.ok(shadowSummary.interventions >= 1);

    const enforcing = make(true);
    enforcing.workerStarted({ attempt: 1 }); enforcing.attach(fakeChild());
    await sleep(50);
    const enforcedSummary = await enforcing.close();
    assert.ok(calls.length >= 1);
    assert.equal(calls[0].intervention.action, ACTIONS.STOP_WORKER);
    assert.equal(calls[0].hasMessage, true);
    const rows = readTimeline(enforcedSummary.timeline).filter((r) => r.type === 'foreman.intervened');
    assert.equal(rows[0].mode, 'enforce');
    // No real process was attached, so the built-in stop could not apply; the
    // handler's own result rides along next to it.
    assert.equal(rows[0].outcome.applied, false);
    assert.deepEqual(rows[0].outcome.handler, { applied: true });
  });

  it('degrades to passthrough when the assessor is unavailable — never a decision, never an escalation', async () => {
    const assessor = { name: 'down', async assess() { return { ok: false, reason: 'assessor unavailable: ollama-busy-extraction' }; } };
    const timelinePath = timelineFor('down');
    const supervisor = createSupervisor({ task, assessor, config: fastConfig, timelinePath }).start();
    supervisor.workerStarted({ attempt: 1 }); supervisor.attach(fakeChild());
    await sleep(80);
    const summary = await supervisor.close();
    assert.ok(summary.assessor_failures >= 1);
    assert.equal(summary.interventions, 0);
    assert.deepEqual(summary.actions, {});
    const types = readTimeline(timelinePath).map((r) => r.type);
    assert.ok(types.includes('foreman.assessor_unavailable'));
    assert.ok(!types.includes('foreman.intervened'));
  });

  it('supervises a real child process end to end', async () => {
    const assessor = createSimulatedAssessor([HEALTHY]);
    const timelinePath = timelineFor('real');
    const supervisor = createSupervisor({ task, nodeId: 'node-a', assessor, config: fastConfig, timelinePath, log: () => {} }).start();
    supervisor.workerStarted({ attempt: 1 });
    const child = spawn(process.execPath, ['-e', 'let i=0;const t=setInterval(()=>{console.log("line "+(i++));if(i===30){clearInterval(t)}},3)'], { stdio: ['ignore', 'pipe', 'pipe'] });
    supervisor.attach(child);
    const exit = await new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
    supervisor.workerExited({ exitCode: exit.code, signal: exit.signal });
    await sleep(30);
    const summary = await supervisor.close({ outcome: 'success' });
    assert.equal(exit.code, 0);
    assert.ok(supervisor.state.workers[0].stdout.includes('line 29'));
    assert.equal(supervisor.state.workers[0].status, 'completed');
    assert.ok(summary.iterations >= 1);
    const rows = readTimeline(timelinePath);
    assert.ok(rows.some((r) => r.type === 'foreman.assessed' && r.assessment.meaningful_progress === 0.95));
    assert.ok(rows.some((r) => r.type === 'worker.exited' && r.exit_code === 0));
  });

  it('keeps running without a timeline when the directory cannot be created', async () => {
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-block-')), 'file');
    fs.writeFileSync(blocker, 'not a directory');
    const logs = [];
    const supervisor = createSupervisor({ task, assessor: createSimulatedAssessor([HEALTHY]), config: fastConfig, timelinePath: path.join(blocker, 'task-42.jsonl'), log: (m) => logs.push(m) }).start();
    supervisor.workerStarted({ attempt: 1 });
    await sleep(30);
    const summary = await supervisor.close();
    assert.equal(summary.timeline, null);
    assert.ok(summary.iterations >= 1);
    assert.ok(logs.some((m) => /timeline/.test(m)));
  });

  it('coalesces bursts of output into few assessments', async () => {
    const assessor = createSimulatedAssessor([HEALTHY]);
    const supervisor = createSupervisor({ task, assessor, config: { min_interval_ms: 40, periodic_ms: 200 } }).start();
    supervisor.workerStarted({ attempt: 1 });
    const child = fakeChild();
    supervisor.attach(child);
    for (let i = 0; i < 300; i += 1) child.stdout.write('x\n');
    await sleep(120);
    await supervisor.close();
    assert.ok(assessor.calls.length <= 5, `expected few assessments, got ${assessor.calls.length}`);
    assert.ok(assessor.calls.length >= 1);
  });
});

describe('foreman supervisor — configuration from the environment', () => {
  it('defaults to enforcement, enabled, with the operator home for timelines', () => {
    const config = foremanConfigFromEnv({}, '/home/op');
    assert.equal(config.enabled, true);
    assert.equal(config.enforce, true);
    assert.equal(config.stop_grace_ms, DEFAULT_CONFIG.stop_grace_ms);
    assert.equal(config.min_interval_ms, DEFAULT_CONFIG.min_interval_ms);
    assert.equal(config.dir, path.join('/home/op', '.openclaw', 'foreman'));
    assert.equal(config.policy.max_interventions, 20);
    // MESH_MAX_ATTEMPTS=3 by default: 2 retries, 3 coding + 3 metric records + headroom.
    assert.equal(config.policy.max_retries, 2);
    assert.equal(config.policy.max_workers, 8);
    const five = foremanConfigFromEnv({ MESH_MAX_ATTEMPTS: '5' }, '/home/op');
    assert.equal(five.policy.max_retries, 4);
    assert.equal(five.policy.max_workers, 12);
  });
  it('honours the MESH_FOREMAN_* overrides and ignores junk', () => {
    const config = foremanConfigFromEnv({
      MESH_FOREMAN: '0', MESH_FOREMAN_ENFORCE: '0', MESH_FOREMAN_MIN_INTERVAL_MS: '250', MESH_FOREMAN_PERIODIC_MS: 'junk',
      MESH_FOREMAN_MODEL: 'llama3.1:8b', MESH_FOREMAN_DIR: '/var/foreman', MESH_FOREMAN_MAX_INTERVENTIONS: '7', LLM_MODEL: 'qwen3:8b',
    }, '/home/op');
    assert.equal(config.enabled, false);
    assert.equal(config.enforce, false);
    assert.equal(config.min_interval_ms, 250);
    assert.equal(config.periodic_ms, DEFAULT_CONFIG.periodic_ms);
    assert.equal(config.model, 'llama3.1:8b');
    assert.equal(config.dir, '/var/foreman');
    assert.equal(config.policy.max_interventions, 7);
    assert.equal(foremanConfigFromEnv({ LLM_MODEL: 'qwen3:8b' }).model, 'qwen3:8b');
  });
});
