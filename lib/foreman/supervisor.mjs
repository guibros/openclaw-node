/**
 * supervisor.mjs — the Foreman loop over one mesh task, in the worker's process.
 *
 * Two concurrent loops in one process (Foreman's shape, MASTER_PLAN §4.6 forbids a
 * sibling daemon): the coding worker streams output while this loop, debounced,
 * builds a bounded observation, asks the assessor the ten questions, runs the
 * deterministic policy, and records what it saw and decided. Bursts of output
 * collapse into one observation; lifecycle events (worker started / exited,
 * verification result) bypass the debounce.
 *
 * Enforcement (default; `MESH_FOREMAN_ENFORCE=0` for shadow): STOP_WORKER and
 * ESCALATE terminate the attached worker's process group here, in the loop, so a
 * stuck worker is stopped the moment the policy says so; ESCALATE also raises
 * `state.escalation` for the agent's attempt loop to release the task. Every
 * other action is advisory to the agent, which reads the decision through
 * `assessNow()` at its own decision points (verifier pass, completion). An
 * optional `onIntervention` handler can extend enforcement; its return value is
 * recorded next to the decision.
 *
 * Supervisor-originated events never re-trigger an assessment, so a cycle cannot
 * feed itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildObservation, DEFAULT_LIMITS, tail } from './observation.mjs';
import { ACTIONS, DEFAULT_POLICY, decide } from './policy.mjs';
import { buildSteeringMessage } from './steering.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  enforce: true,
  stop_grace_ms: 5_000,
  min_interval_ms: 5_000,
  periodic_ms: 30_000,
  assess_timeout_ms: 8_000,
  model: null,
  dir: null,
  limits: DEFAULT_LIMITS,
  policy: DEFAULT_POLICY,
  state_history_limit: 100,
});

const LIFECYCLE_TYPES = new Set(['worker.started', 'worker.exited', 'verification.recorded']);

export function foremanConfigFromEnv(env = process.env, home = env.HOME || '') {
  const num = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const attempts = Math.max(1, num('MESH_MAX_ATTEMPTS', 3));
  return {
    ...DEFAULT_CONFIG,
    enabled: env.MESH_FOREMAN !== '0',
    enforce: env.MESH_FOREMAN_ENFORCE !== '0',
    stop_grace_ms: num('MESH_FOREMAN_STOP_GRACE_MS', DEFAULT_CONFIG.stop_grace_ms),
    min_interval_ms: num('MESH_FOREMAN_MIN_INTERVAL_MS', DEFAULT_CONFIG.min_interval_ms),
    periodic_ms: num('MESH_FOREMAN_PERIODIC_MS', DEFAULT_CONFIG.periodic_ms),
    assess_timeout_ms: num('MESH_FOREMAN_ASSESS_TIMEOUT_MS', DEFAULT_CONFIG.assess_timeout_ms),
    model: env.MESH_FOREMAN_MODEL || env.LLM_MODEL || null,
    dir: env.MESH_FOREMAN_DIR || (home ? path.join(home, '.openclaw', 'foreman') : null),
    policy: {
      ...DEFAULT_POLICY,
      max_interventions: num('MESH_FOREMAN_MAX_INTERVENTIONS', DEFAULT_POLICY.max_interventions),
      // The agent's own attempt loop is the real retry budget: one coding worker plus one
      // metric verification record per attempt. Shadow decisions must not call "limit
      // reached" on an attempt the agent will make anyway.
      max_retries: num('MESH_FOREMAN_MAX_RETRIES', Math.max(0, attempts - 1)),
      max_workers: num('MESH_FOREMAN_MAX_WORKERS', attempts * 2 + 2),
      steering_grace_ms: num('MESH_FOREMAN_GRACE_MS', DEFAULT_POLICY.steering_grace_ms),
    },
  };
}

function nowIso(now) {
  return now().toISOString();
}

export function createSupervisor({
  task,
  nodeId = null,
  worktreePath = null,
  assessor,
  config = {},
  log = () => {},
  publish = null,
  timelinePath = null,
  onIntervention = null,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  exec,
}) {
  if (!task || !task.task_id) throw new Error('supervisor needs a task with task_id');
  if (!assessor || typeof assessor.assess !== 'function') throw new Error('supervisor needs an assessor');
  const cfg = { ...DEFAULT_CONFIG, ...config, limits: { ...DEFAULT_LIMITS, ...(config.limits || {}) }, policy: { ...DEFAULT_POLICY, ...(config.policy || {}) } };

  const state = {
    task_id: task.task_id,
    node_id: nodeId,
    status: 'created',
    started_at: null,
    finished_at: null,
    attempt: 0,
    iteration: 0,
    interventions: 0,
    workers: [],
    active_worker_id: null,
    latest_assessment: null,
    assessment_history: [],
    latest_intervention: null,
    intervention_history: [],
    verification_results: [],
    retry_count: 0,
    errors: [],
    assessor_failures: 0,
    actions: {},
    escalation: null,
    last_stop: null,
  };

  const recentEvents = [];
  let timer = null;
  let lastAssessment = -Infinity;
  let dirty = false;
  let force = false;
  let inFlight = null;
  let closed = false;
  let timelineOk = Boolean(timelinePath);
  let counter = 0;

  function record(type, payload = {}, { notify = false, bus = false } = {}) {
    const event = { ts: nowIso(now), type, task_id: task.task_id, node_id: nodeId, ...payload };
    recentEvents.push(event);
    if (recentEvents.length > cfg.limits.events * 2) recentEvents.splice(0, recentEvents.length - cfg.limits.events);
    if (timelineOk) {
      try {
        fs.appendFileSync(timelinePath, `${JSON.stringify(event)}\n`);
      } catch (error) {
        timelineOk = false;
        log(`timeline write failed (${timelinePath}): ${error.message}; continuing without a timeline`);
      }
    }
    if (bus && publish) {
      try {
        const maybe = publish(`mesh.foreman.${type.split('.').pop()}`, event);
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
      } catch { /* the bus is best-effort observability */ }
    }
    if (notify) kick(LIFECYCLE_TYPES.has(type));
    return event;
  }

  function kick(isLifecycle) {
    if (closed) return;
    dirty = true;
    if (isLifecycle) force = true;
    schedule();
  }

  function schedule() {
    if (closed) return;
    if (timer) clearTimer(timer);
    const since = now().getTime() - lastAssessment;
    const minRemaining = Math.max(0, cfg.min_interval_ms - since);
    const periodicRemaining = Math.max(0, cfg.periodic_ms - since);
    const delay = force ? 0 : dirty ? Math.min(minRemaining, periodicRemaining) : periodicRemaining;
    timer = setTimer(tick, Math.max(0, Number.isFinite(delay) ? delay : 0));
  }

  async function tick() {
    timer = null;
    if (closed) return;
    if (inFlight) { schedule(); return; }
    const since = now().getTime() - lastAssessment;
    const eligible = force || (dirty && since >= cfg.min_interval_ms) || since >= cfg.periodic_ms;
    if (!eligible) { schedule(); return; }
    inFlight = cycle().catch((error) => {
      state.errors.push(`cycle: ${error.message}`);
      log(`cycle failed: ${error.message}`);
    }).finally(() => {
      inFlight = null;
      lastAssessment = now().getTime();
      dirty = false;
      force = false;
      schedule();
    });
    await inFlight;
  }

  function trimHistories() {
    const limit = cfg.state_history_limit;
    if (state.assessment_history.length > limit) state.assessment_history.splice(0, state.assessment_history.length - limit);
    if (state.intervention_history.length > limit) state.intervention_history.splice(0, state.intervention_history.length - limit);
  }

  async function cycle() {
    state.iteration += 1;
    const observation = await buildObservation({ task, state, worktreePath, recentEvents, limits: cfg.limits, exec, now });
    record('foreman.observed', { iteration: state.iteration, changed_files: observation.changed_files.length, output_chars: observation.latest_worker_output.length });
    const answer = await assessor.assess(observation);
    if (!answer.ok) {
      state.assessor_failures += 1;
      state.errors.push(answer.reason);
      // Passthrough: no assessment, no decision, the worker keeps running as it would today.
      record('foreman.assessor_unavailable', { iteration: state.iteration, reason: answer.reason, failures: state.assessor_failures }, { bus: true });
      return null;
    }
    const assessment = answer.assessment;
    state.latest_assessment = assessment;
    state.assessment_history.push(assessment);
    record('foreman.assessed', { iteration: state.iteration, assessor: assessor.name, ms: answer.ms ?? null, assessment }, { bus: true });
    const intervention = decide(state, assessment, { ...cfg.policy, now: now().getTime() });
    state.latest_intervention = intervention;
    state.intervention_history.push(intervention);
    trimHistories();
    if (intervention.action !== ACTIONS.CONTINUE) state.interventions += 1;
    state.actions[intervention.action] = (state.actions[intervention.action] || 0) + 1;
    const enforced = cfg.enforce && intervention.action !== ACTIONS.CONTINUE;
    let outcome = null;
    if (enforced) {
      const guidance = buildSteeringMessage(assessment);
      if (intervention.action === ACTIONS.STOP_WORKER || intervention.action === ACTIONS.ESCALATE) {
        if (intervention.action === ACTIONS.ESCALATE) {
          state.escalation = { reason: intervention.reason, iteration: state.iteration, at: nowIso(now) };
        }
        outcome = await supervisor.stopActiveWorker({ reason: intervention.reason, guidance, action: intervention.action });
      } else {
        outcome = { applied: false, advisory: true };
      }
      if (typeof onIntervention === 'function') {
        try {
          const extra = await onIntervention(intervention, { assessment, state, steeringMessage: guidance, outcome });
          if (extra !== undefined) outcome = { ...(outcome || {}), handler: extra };
        } catch (error) {
          outcome = { ...(outcome || {}), handler_error: error.message };
          state.errors.push(`enforce ${intervention.action}: ${error.message}`);
        }
      }
    }
    record('foreman.intervened', { iteration: state.iteration, ...intervention, mode: enforced ? 'enforce' : 'shadow', outcome }, { bus: true });
    if (intervention.action !== ACTIONS.CONTINUE) {
      log(`${enforced ? 'ENFORCE' : 'shadow'} ${intervention.action} — ${intervention.reason} (iteration ${state.iteration})`);
    }
    return intervention;
  }

  /** SIGTERM the worker's process group, then SIGKILL after the grace period. */
  async function terminate(child, graceMs) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return { applied: false, reason: 'already exited' };
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* gone */ }
      }
    };
    const exited = new Promise((resolve) => child.once('close', () => resolve(true)));
    signalGroup('SIGTERM');
    const graceful = await Promise.race([exited, new Promise((resolve) => setTimer(() => resolve(false), graceMs))]);
    if (!graceful) {
      signalGroup('SIGKILL');
      await exited;
    }
    return { applied: true, graceful };
  }

  function activeWorker() {
    return state.workers.find((w) => w.worker_id === state.active_worker_id) || null;
  }

  const supervisor = {
    state,
    get closed() { return closed; },
    get enforce() { return cfg.enforce; },

    start() {
      if (state.status !== 'created') return supervisor;
      state.status = 'running';
      state.started_at = nowIso(now);
      if (timelinePath) {
        try {
          fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
        } catch (error) {
          timelineOk = false;
          log(`timeline dir unavailable (${path.dirname(timelinePath)}): ${error.message}`);
        }
      }
      record('foreman.started', { mode: cfg.enforce ? 'enforce' : 'shadow', assessor: assessor.name, worktree: worktreePath });
      return supervisor;
    },

    /** A new worker attempt (coding by default) is about to run. */
    workerStarted({ attempt = state.attempt + 1, kind = 'coding', supportsSteering = false } = {}) {
      if (kind === 'coding') state.attempt = attempt;
      if (kind === 'coding' && attempt > 1) state.retry_count = attempt - 1;
      counter += 1;
      const worker = {
        worker_id: `worker-${counter}`,
        kind,
        attempt,
        status: 'running',
        started_at: nowIso(now),
        finished_at: null,
        exit_code: null,
        stdout: '',
        stderr: '',
        supports_steering: supportsSteering,
        steer_count: 0,
        steer_failures: 0,
        last_steered_at: null,
        stopping: false,
        child: null,
      };
      state.workers.push(worker);
      state.active_worker_id = worker.worker_id;
      record('worker.started', { worker_id: worker.worker_id, kind, attempt }, { notify: true });
      return worker;
    },

    /** Attach a spawned child: its output feeds the observation (bounded), not the timeline. */
    attach(child) {
      const worker = activeWorker();
      if (!worker || !child) return;
      worker.child = child;
      const onData = (stream) => (chunk) => {
        const text = chunk.toString();
        worker[stream] = tail(worker[stream] + text, cfg.limits.output * 2);
        kick(false);
      };
      child.stdout?.on('data', onData('stdout'));
      child.stderr?.on('data', onData('stderr'));
    },

    workerExited({ exitCode = null, signal = null, stopped = false } = {}) {
      const worker = activeWorker();
      if (!worker) return;
      worker.finished_at = nowIso(now);
      worker.exit_code = exitCode;
      worker.child = null;
      if (stopped || worker.stopping) worker.status = 'stopped';
      else if (exitCode === 0) worker.status = 'completed';
      else worker.status = 'failed';
      state.active_worker_id = null;
      record('worker.exited', { worker_id: worker.worker_id, exit_code: exitCode, signal, status: worker.status }, { notify: true });
    },

    /**
     * A verification signal for the current tree: the task metric (a synthetic
     * verifier record is added) or a real verifier pass (`workerId` names the
     * worker that ran; the result attaches to it).
     */
    recordVerification({ passed, summary = '', source = 'metric', workerId = null }) {
      let verifier = workerId ? state.workers.find((w) => w.worker_id === workerId && w.kind === 'verifier') : null;
      if (!verifier) {
        counter += 1;
        verifier = {
          worker_id: `worker-${counter}`,
          kind: 'verifier',
          attempt: state.attempt,
          status: passed ? 'completed' : 'failed',
          started_at: nowIso(now),
          finished_at: nowIso(now),
          exit_code: passed ? 0 : 1,
          stdout: tail(summary, cfg.limits.output),
          stderr: '',
          supports_steering: false,
          steer_count: 0,
          steer_failures: 0,
          last_steered_at: null,
          stopping: false,
          child: null,
        };
        state.workers.push(verifier);
      } else {
        verifier.status = passed ? 'completed' : 'failed';
      }
      state.verification_results.push({ worker_id: verifier.worker_id, passed: Boolean(passed), source, summary: tail(summary, 2_000), recorded_at: nowIso(now) });
      record('verification.recorded', { worker_id: verifier.worker_id, passed: Boolean(passed), source }, { notify: true });
    },

    /**
     * Terminate the active worker (its whole process group). The agent's attempt
     * loop sees a signal exit; `state.last_stop` carries the reason and guidance
     * so the retry prompt can tell the next attempt what went wrong.
     */
    async stopActiveWorker({ reason, guidance = null, action = ACTIONS.STOP_WORKER } = {}) {
      const worker = activeWorker();
      if (!worker) return { applied: false, reason: 'no active worker' };
      worker.stopping = true;
      state.last_stop = { worker_id: worker.worker_id, attempt: worker.attempt, action, reason, guidance, at: nowIso(now) };
      if (!worker.child) return { applied: false, reason: 'no attached process', pending: true };
      const outcome = await terminate(worker.child, cfg.stop_grace_ms);
      return { ...outcome, worker_id: worker.worker_id };
    },

    /**
     * Run one assessment cycle now (after any in-flight one) and return the
     * decision. The agent calls this at its own decision points; a cycle that
     * cannot decide (assessor unavailable) returns null.
     */
    async assessNow() {
      if (closed) return null;
      if (inFlight) { try { await inFlight; } catch { /* recorded */ } }
      if (timer) clearTimer(timer);
      timer = null;
      let decision = null;
      inFlight = cycle().then((result) => { decision = result || null; }).catch((error) => {
        state.errors.push(`cycle: ${error.message}`);
        log(`cycle failed: ${error.message}`);
      }).finally(() => {
        inFlight = null;
        lastAssessment = now().getTime();
        dirty = false;
        force = false;
        schedule();
      });
      await inFlight;
      return decision;
    },

    /** Record a delivered (or rejected) steer against the active worker. */
    noteSteer({ delivered }) {
      const worker = activeWorker();
      if (!worker) return;
      if (delivered) {
        worker.steer_count += 1;
        worker.last_steered_at = nowIso(now);
      } else {
        worker.steer_failures += 1;
      }
    },

    async close({ outcome = null } = {}) {
      if (closed) return supervisor.summary();
      closed = true;
      if (timer) clearTimer(timer);
      timer = null;
      if (inFlight) { try { await inFlight; } catch { /* recorded by tick */ } }
      state.status = 'closed';
      state.finished_at = nowIso(now);
      const summary = supervisor.summary(outcome);
      record('foreman.closed', summary, { bus: true });
      return summary;
    },

    summary(outcome = null) {
      const last = state.latest_assessment;
      return {
        task_id: task.task_id,
        mode: cfg.enforce ? 'enforce' : 'shadow',
        outcome,
        iterations: state.iteration,
        interventions: state.interventions,
        actions: { ...state.actions },
        assessor: assessor.name,
        assessor_failures: state.assessor_failures,
        attempts: state.attempt,
        stops: state.workers.filter((w) => w.status === 'stopped').length,
        escalation: state.escalation ? state.escalation.reason : null,
        last_assessment: last ? Object.fromEntries(Object.entries(last).filter(([k]) => k !== 'assessed_at').map(([k, v]) => [k, Math.round(v * 100) / 100])) : null,
        timeline: timelineOk ? timelinePath : null,
      };
    },

    /** One line for hyperagent telemetry notes. */
    summaryLine(outcome = null) {
      const s = supervisor.summary(outcome);
      const acts = Object.entries(s.actions).map(([k, v]) => `${k}:${v}`).join(',') || 'none';
      const last = s.last_assessment
        ? `progress=${s.last_assessment.meaningful_progress} stuck=${s.last_assessment.worker_stuck} ready=${s.last_assessment.ready_to_finish}`
        : 'no assessment';
      return `Foreman[${s.mode}] iterations=${s.iterations} interventions=${s.interventions} actions=${acts} assessor=${s.assessor} failures=${s.assessor_failures} last(${last})`;
    },
  };

  return supervisor;
}
