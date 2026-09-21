import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, decide, currentVerificationPassed } from '../lib/foreman/policy.mjs';

const BASE = {
  implementation_complete: 0.8,
  tests_sufficient: 0.7,
  requirements_satisfied: 0.8,
  needs_verification: 0.4,
  meaningful_progress: 0.9,
  worker_stuck: 0.1,
  work_off_track: 0.1,
  agents_md_drift: 0.0,
  ready_to_finish: 0.7,
  needs_human: 0.0,
};
const scores = (updates = {}) => ({ ...BASE, ...updates });

function state(overrides = {}) {
  return {
    iteration: 1, interventions: 0, workers: [], active_worker_id: null,
    latest_intervention: null, retry_count: 0, verification_results: [], ...overrides,
  };
}
function worker(id, kind, status, extra = {}) {
  return { worker_id: id, kind, status, supports_steering: false, steer_count: 0, steer_failures: 0, last_steered_at: null, ...extra };
}
function active(st, { supportsSteering = true } = {}) {
  st.workers.push(worker('worker-1', 'coding', 'running', { supports_steering: supportsSteering }));
  st.active_worker_id = 'worker-1';
  return st.workers[0];
}
const confident = () => scores({ implementation_complete: 0.95, tests_sufficient: 0.9, requirements_satisfied: 0.9, needs_verification: 0.99, ready_to_finish: 0.9 });

describe('foreman policy — precedence', () => {
  it('continues a healthy active worker', () => {
    const st = state(); active(st);
    assert.equal(decide(st, scores()).action, ACTIONS.CONTINUE);
  });
  it('starts a worker when nothing is active and work remains', () => {
    assert.equal(decide(state(), scores()).action, ACTIONS.START_WORKER);
  });
  it('starts a verifier when implementation is complete and verification is warranted', () => {
    assert.equal(decide(state(), scores({ implementation_complete: 0.9, needs_verification: 0.9 })).action, ACTIONS.START_VERIFIER);
  });
  it('escalates on human need before anything else', () => {
    const st = state(); active(st);
    assert.equal(decide(st, scores({ needs_human: 0.95, worker_stuck: 0.99 })).action, ACTIONS.ESCALATE);
  });
  it('finishes when completion thresholds hold and verification is not needed', () => {
    const ready = scores({ ready_to_finish: 0.95, requirements_satisfied: 0.95, tests_sufficient: 0.95 });
    assert.equal(decide(state(), ready).action, ACTIONS.FINISH);
  });
});

describe('foreman policy — drift, stuck, steering', () => {
  it('stops an off-track worker that cannot be steered', () => {
    const st = state(); active(st, { supportsSteering: false });
    const result = decide(st, scores({ work_off_track: 0.95 }));
    assert.equal(result.action, ACTIONS.STOP_WORKER);
    assert.equal(result.worker_id, 'worker-1');
  });
  it('steers a steerable worker drifting from instructions, naming the drift', () => {
    const st = state(); active(st);
    const result = decide(st, scores({ agents_md_drift: 0.95 }));
    assert.equal(result.action, ACTIONS.STEER_WORKER);
    assert.match(result.reason, /instructions/);
  });
  it('after a delivered steer the worker gets the grace period, then is stopped', () => {
    const st = state(); const w = active(st);
    const stuck = scores({ meaningful_progress: 0.1, worker_stuck: 0.95 });
    assert.equal(decide(st, stuck).action, ACTIONS.STEER_WORKER);
    w.steer_count = 1; w.last_steered_at = new Date(1_000_000).toISOString();
    assert.equal(decide(st, stuck, { now: 1_000_000 + 1_000 }).action, ACTIONS.CONTINUE);
    assert.equal(decide(st, stuck, { now: 1_000_000 + 31_000 }).action, ACTIONS.STOP_WORKER);
  });
  it('a rejected steer is retried and does not spend the budget; repeated rejections stop', () => {
    const st = state(); const w = active(st);
    const stuck = scores({ worker_stuck: 0.95 });
    w.steer_failures = 1;
    assert.equal(decide(st, stuck).action, ACTIONS.STEER_WORKER);
    w.steer_failures = 2;
    assert.equal(decide(st, stuck).action, ACTIONS.STOP_WORKER);
  });
  it('steering disabled by policy stops instead', () => {
    const st = state(); active(st);
    assert.equal(decide(st, scores({ worker_stuck: 0.95 }), { steering_enabled: false }).action, ACTIONS.STOP_WORKER);
  });
});

describe('foreman policy — retry and limits', () => {
  it('retries once after a stop, then escalates', () => {
    const st = state(); active(st);
    const stopped = decide(st, scores({ worker_stuck: 0.95 }), { steering_enabled: false });
    assert.equal(stopped.action, ACTIONS.STOP_WORKER);
    st.active_worker_id = null; st.latest_intervention = stopped;
    assert.equal(decide(st, scores()).action, ACTIONS.RETRY_WORKER);
    st.retry_count = 1;
    assert.equal(decide(st, scores(), { max_retries: 1 }).action, ACTIONS.ESCALATE);
  });
  it('escalates when the worker limit is reached before completion', () => {
    const st = state({ workers: [worker('w', 'coding', 'completed')] });
    assert.equal(decide(st, scores(), { max_workers: 1 }).action, ACTIONS.ESCALATE);
  });
  it('the ceiling counts interventions, never assessments', () => {
    const st = state({ iteration: 10_000, interventions: 0 }); active(st);
    assert.equal(decide(st, scores()).action, ACTIONS.CONTINUE);
    st.interventions = 20;
    const result = decide(st, scores());
    assert.equal(result.action, ACTIONS.ESCALATE);
    assert.match(result.reason, /interventions/);
  });
});

describe('foreman policy — verification gate', () => {
  it('does not repeat verification when the latest worker is a verifier', () => {
    const st = state({ workers: [worker('v', 'verifier', 'completed')] });
    const result = decide(st, scores({ implementation_complete: 0.95, needs_verification: 0.95 }));
    assert.equal(result.action, ACTIONS.START_WORKER);
  });
  it('a FAILED verifier does not satisfy the gate', () => {
    const st = state({
      workers: [worker('worker-1', 'coding', 'completed'), worker('worker-2', 'verifier', 'failed')],
      verification_results: [{ worker_id: 'worker-2', passed: false }],
    });
    assert.equal(currentVerificationPassed(st), false);
    assert.equal(decide(st, confident()).action, ACTIONS.START_WORKER);
  });
  it('a PASSED verifier satisfies the gate', () => {
    const st = state({
      workers: [worker('worker-1', 'coding', 'completed'), worker('worker-2', 'verifier', 'completed')],
      verification_results: [{ worker_id: 'worker-2', passed: true }],
    });
    assert.equal(currentVerificationPassed(st), true);
    assert.equal(decide(st, confident()).action, ACTIONS.FINISH);
  });
  it('a verification that predates the latest coding pass is stale', () => {
    const st = state({
      workers: [worker('worker-1', 'coding', 'completed'), worker('worker-2', 'verifier', 'completed'), worker('worker-3', 'coding', 'completed')],
      verification_results: [{ worker_id: 'worker-2', passed: true }],
    });
    assert.equal(currentVerificationPassed(st), false);
    assert.equal(decide(st, confident(), { max_workers: 4 }).action, ACTIONS.START_VERIFIER);
  });
});
