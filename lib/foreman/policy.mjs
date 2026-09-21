/**
 * policy.mjs — the deterministic decision. The model only assesses; this file
 * alone chooses an action, from a fixed vocabulary, in a fixed precedence.
 *
 * Precedence (safety first): human need → intervention ceiling → drift/off-track/
 * stuck on the active worker (steer if the worker can be steered and the budget
 * allows, else stop) → retry after a stop → finish → verify → start → continue.
 *
 * Three rules carried in from the review of upstream Foreman (D1):
 *   - the ceiling counts interventions other than CONTINUE, never assessments, so a
 *     healthy worker is not escalated for being watched;
 *   - only a verifier that ran after the latest coding pass and PASSED satisfies the
 *     completion gate — a failed, timed-out or never-launched verifier leaves it closed;
 *   - a steer the transport rejects is retried and does not spend the steer budget.
 */

export const ACTIONS = Object.freeze({
  CONTINUE: 'CONTINUE',
  STEER_WORKER: 'STEER_WORKER',
  STOP_WORKER: 'STOP_WORKER',
  RETRY_WORKER: 'RETRY_WORKER',
  START_VERIFIER: 'START_VERIFIER',
  START_WORKER: 'START_WORKER',
  FINISH: 'FINISH',
  ESCALATE: 'ESCALATE',
});

export const DEFAULT_THRESHOLDS = Object.freeze({
  human: 0.8,
  off_track: 0.8,
  drift: 0.8,
  stuck: 0.8,
  verification: 0.65,
  implementation_for_verification: 0.75,
  finish: 0.75,
  requirements: 0.75,
  tests: 0.75,
});

export const DEFAULT_POLICY = Object.freeze({
  thresholds: DEFAULT_THRESHOLDS,
  max_interventions: 20,
  max_retries: 1,
  max_workers: 3,
  steering_enabled: true,
  max_steers_per_worker: 1,
  steering_grace_ms: 30_000,
});

function latestWorkerIsVerifier(state) {
  const last = state.workers[state.workers.length - 1];
  return Boolean(last) && last.kind === 'verifier';
}

/** Only a verifier that ran after the latest coding pass vouches for the current tree. */
export function currentVerificationPassed(state) {
  if (!latestWorkerIsVerifier(state)) return false;
  const verifierId = state.workers[state.workers.length - 1].worker_id;
  return (state.verification_results || []).some(
    (result) => result.worker_id === verifierId && result.passed === true,
  );
}

/**
 * @param {object} state — see supervisor.mjs for the shape; the fields read here are
 *   iteration, interventions, workers[], active_worker_id, latest_intervention,
 *   retry_count, verification_results[].
 * @param {object} assessment — normalized ten probabilities.
 * @param {object} [policy] — DEFAULT_POLICY overrides; `now` (ms) for the grace clock.
 */
export function decide(state, assessment, policy = {}) {
  const cfg = { ...DEFAULT_POLICY, ...policy, thresholds: { ...DEFAULT_THRESHOLDS, ...(policy.thresholds || {}) } };
  const t = cfg.thresholds;
  const now = typeof cfg.now === 'number' ? cfg.now : Date.now();
  const iteration = Math.max(1, state.iteration || 0);
  const result = (action, reason, workerId = null) => ({ action, reason, worker_id: workerId, iteration });

  const activeId = state.active_worker_id || null;
  const worker = activeId ? state.workers.find((w) => w.worker_id === activeId) : null;

  if (assessment.needs_human >= t.human) {
    return result(ACTIONS.ESCALATE, 'semantic assessment requires human input');
  }
  if ((state.interventions || 0) >= cfg.max_interventions) {
    return result(ACTIONS.ESCALATE, 'maximum Foreman interventions reached');
  }

  if (worker) {
    const offTrack = assessment.work_off_track >= t.off_track;
    const drift = assessment.agents_md_drift >= t.drift;
    const stuck = assessment.worker_stuck >= t.stuck;
    if (offTrack || drift || stuck) {
      const warnings = [
        [drift ? assessment.agents_md_drift : -1, 'active worker appears to be drifting from repository instructions'],
        [offTrack ? assessment.work_off_track : -1, 'active worker appears off track'],
        [stuck ? assessment.worker_stuck : -1, 'active worker appears stuck'],
      ];
      const reason = warnings.reduce((best, item) => (item[0] > best[0] ? item : best))[1];
      if (worker.last_steered_at) {
        const sinceSteer = now - Date.parse(worker.last_steered_at);
        if (sinceSteer < cfg.steering_grace_ms) {
          return result(ACTIONS.CONTINUE, 'active worker is within the post-steering grace period', activeId);
        }
      }
      const canSteer = cfg.steering_enabled
        && worker.supports_steering === true
        && (worker.steer_count || 0) < cfg.max_steers_per_worker
        // A rejected delivery is a transport failure, not a spent steer.
        && (worker.steer_failures || 0) <= cfg.max_steers_per_worker;
      if (canSteer) return result(ACTIONS.STEER_WORKER, reason, activeId);
      return result(ACTIONS.STOP_WORKER, reason, activeId);
    }
  }

  if (!activeId && state.latest_intervention && state.latest_intervention.action === ACTIONS.STOP_WORKER) {
    const retryAllowed = (state.retry_count || 0) < cfg.max_retries;
    const workerAllowed = state.workers.length < cfg.max_workers;
    if (retryAllowed && workerAllowed) {
      return result(ACTIONS.RETRY_WORKER, 'retrying stopped worker with a fresh attempt');
    }
    return result(ACTIONS.ESCALATE, 'worker retry limit reached');
  }

  const finishReady = assessment.ready_to_finish >= t.finish
    && assessment.requirements_satisfied >= t.requirements
    && assessment.tests_sufficient >= t.tests;
  const verificationResolved = currentVerificationPassed(state)
    || assessment.needs_verification < t.verification;
  if (!activeId && finishReady && verificationResolved) {
    return result(ACTIONS.FINISH, 'completion thresholds satisfied');
  }

  const shouldVerify = !activeId
    && assessment.needs_verification >= t.verification
    && assessment.implementation_complete >= t.implementation_for_verification
    && !latestWorkerIsVerifier(state);
  if (shouldVerify) {
    if (state.workers.length >= cfg.max_workers) {
      return result(ACTIONS.ESCALATE, 'verification needed but worker limit reached');
    }
    return result(ACTIONS.START_VERIFIER, 'independent verification is warranted');
  }

  if (!activeId) {
    if (state.workers.length >= cfg.max_workers) {
      return result(ACTIONS.ESCALATE, 'worker limit reached before completion');
    }
    return result(ACTIONS.START_WORKER, 'meaningful implementation work remains');
  }
  return result(ACTIONS.CONTINUE, 'active worker may continue', activeId);
}
