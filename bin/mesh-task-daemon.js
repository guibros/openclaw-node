#!/usr/bin/env node

/**
 * mesh-task-daemon.js — Task coordinator for the OpenClaw mesh.
 *
 * Responsibilities:
 *   1. Accept task submissions (mesh.tasks.submit)
 *   2. Handle task claims (mesh.tasks.claim) — agents request work
 *   3. Track task state transitions (running, completed, failed, released)
 *   4. Enforce budgets — auto-fail tasks that exceed budget_minutes
 *   5. Detect stalled tasks — no heartbeat for STALL_MINUTES → auto-release
 *   6. Provide task listing (mesh.tasks.list)
 *
 * NATS subjects:
 *   mesh.tasks.submit        — submit a new task (request/reply)
 *   mesh.tasks.claim         — agent claims next available task (request/reply)
 *   mesh.tasks.start         — agent signals it started work (request/reply)
 *   mesh.tasks.complete      — agent reports completion (request/reply)
 *   mesh.tasks.fail          — agent reports failure (request/reply)
 *   mesh.tasks.attempt       — agent logs an iteration attempt (request/reply)
 *   mesh.tasks.heartbeat     — agent activity signal for stall detection (request/reply)
 *   mesh.tasks.release       — mark task as released for human triage (request/reply)
 *   mesh.tasks.list          — list tasks with optional filter (request/reply)
 *   mesh.tasks.get           — get a single task by ID (request/reply)
 *   mesh.tasks.cancel        — cancel a task (request/reply)
 *
 * Enforcement loops run every 30s: budget check + stall detection.
 *
 * Usage:
 *   node mesh-task-daemon.js          # foreground
 *   node mesh-task-daemon.js &        # background
 */

const { connect, StringCodec } = require('nats');
const { createTask, TaskStore, TASK_STATUS, KV_BUCKET } = require('../lib/mesh-tasks');
const { createSession, CollabStore, COLLAB_STATUS, COLLAB_KV_BUCKET } = require('../lib/mesh-collab');
const { createPlan, autoRoutePlan, PlanStore, PLAN_STATUS, SUBTASK_STATUS, PLANS_KV_BUCKET } = require('../lib/mesh-plans');
const { findRole, findRoleByScope, validateRequiredOutputs, checkForbiddenPatterns } = require('../lib/role-loader');
const os = require('os');
const path = require('path');

// Role search directories
const ROLE_DIRS = [
  path.join(process.env.HOME || '/root', '.openclaw', 'roles'),
  path.join(__dirname, '..', 'config', 'roles'),
];

const sc = StringCodec();
const { NATS_URL } = require('../lib/nats-resolve');
const BUDGET_CHECK_INTERVAL = 30000; // 30s
const STALL_MINUTES = parseInt(process.env.MESH_STALL_MINUTES || '5'); // no heartbeat for this long → stalled
const NODE_ID = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');

let nc, store, collabStore, planStore;

// ── Logging ─────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ── Response helpers ────────────────────────────────

function respond(msg, data) {
  msg.respond(sc.encode(JSON.stringify({ ok: true, data })));
}

function respondError(msg, error) {
  msg.respond(sc.encode(JSON.stringify({ ok: false, error })));
}

function parseRequest(msg) {
  try {
    return JSON.parse(sc.decode(msg.data));
  } catch {
    return {};
  }
}

// ── Event Publishing ───────────────────────────────
// Fire-and-forget pub/sub events on every state change.
// Subscribers (mesh-bridge, MC, etc.) listen on mesh.events.>

function publishEvent(eventType, task) {
  nc.publish(`mesh.events.${eventType}`, sc.encode(JSON.stringify({
    event: eventType, task_id: task.task_id, task, timestamp: new Date().toISOString(),
  })));
}

// ── Subject Handlers ────────────────────────────────

/**
 * mesh.tasks.submit — Create a new task.
 * Expects: { task_id, title, description, budget_minutes, metric, on_fail, ... }
 */
async function handleSubmit(msg) {
  const params = parseRequest(msg);

  if (!params.task_id || !params.title) {
    return respondError(msg, 'task_id and title are required');
  }

  // Check if task already exists
  const existing = await store.get(params.task_id);
  if (existing) {
    return respondError(msg, `Task ${params.task_id} already exists`);
  }

  const task = createTask(params);
  await store.put(task);

  log(`SUBMIT ${task.task_id}: "${task.title}" (budget: ${task.budget_minutes}m, metric: ${task.metric || 'none'})`);
  publishEvent('submitted', task);

  // Auto-create collab session if task has collaboration spec
  if (task.collaboration && collabStore) {
    const session = createSession(task.task_id, task.collaboration);
    await collabStore.put(session);

    // Store session_id back in task for agent discovery
    task.collab_session_id = session.session_id;
    await store.put(task);

    log(`  → COLLAB SESSION ${session.session_id} auto-created (mode: ${session.mode})`);
    publishCollabEvent('created', session);

    // Broadcast recruit signal
    nc.publish(`mesh.collab.${session.session_id}.recruit`, sc.encode(JSON.stringify({
      session_id: session.session_id,
      task_id: task.task_id,
      mode: session.mode,
      min_nodes: session.min_nodes,
      max_nodes: session.max_nodes,
      task_title: task.title,
    })));
  }

  respond(msg, task);
}

/**
 * Abort any collab session tied to a task that is being terminated.
 * Shared by handleFail, handleRelease, handleCancel.
 *
 * NOT called from handleComplete — that path goes through evaluateRound
 * which already calls collabStore.markCompleted() on the session.
 *
 * markAborted() is idempotent: no-op if session is already completed/aborted.
 * This makes double-abort safe (e.g. stall detection → release race).
 */
async function cleanupTaskCollabSession(task, reason) {
  if (!task.collab_session_id || !collabStore) return;
  try {
    // markAborted returns null if session doesn't exist or is already completed/aborted.
    // Non-null means we actually transitioned the session to aborted.
    const session = await collabStore.markAborted(task.collab_session_id, reason);
    if (session) {
      await collabStore.appendAudit(task.collab_session_id, 'session_aborted', { reason });
      publishCollabEvent('aborted', session);
      log(`COLLAB ABORTED ${task.collab_session_id}: ${reason}`);
    }
    // Clean up audit error rate-limit counter
    // NOTE: sessions expiring via KV TTL bypass this — residual Map entry is negligible
    // for a homelab mesh but worth noting.
    collabStore.clearAuditErrorCount(task.collab_session_id);
  } catch (err) {
    log(`COLLAB CLEANUP WARN: could not abort session ${task.collab_session_id}: ${err.message}`);
  }
}

/**
 * mesh.tasks.claim — Agent requests the next available task.
 * Expects: { node_id }
 * Returns: the claimed task, or null if nothing available.
 */
async function handleClaim(msg) {
  const { node_id } = parseRequest(msg);

  if (!node_id) {
    return respondError(msg, 'node_id is required');
  }

  // Check if this node already has a running task
  const running = await store.list({ status: TASK_STATUS.RUNNING, owner: node_id });
  const claimed = await store.list({ status: TASK_STATUS.CLAIMED, owner: node_id });
  if (running.length > 0 || claimed.length > 0) {
    return respondError(msg, `Node ${node_id} already has an active task: ${(running[0] || claimed[0]).task_id}`);
  }

  const task = await store.claim(node_id);

  if (task) {
    // Pre-dispatch revalidation: re-read the task we just claimed to confirm
    // it's still ours (guards against race conditions with concurrent agents)
    const verified = await store.get(task.task_id);
    if (!verified || verified.status !== TASK_STATUS.CLAIMED || verified.owner !== node_id) {
      log(`CLAIM RACE ${task.task_id}: task state changed between claim and verify`);
      respond(msg, null);
      return;
    }
    log(`CLAIM ${task.task_id} → ${node_id} (budget deadline: ${task.budget_deadline})`);
    publishEvent('claimed', task);
    respond(msg, task);
  } else {
    respond(msg, null);
  }
}

/**
 * mesh.tasks.start — Agent signals it started working.
 * Expects: { task_id }
 */
async function handleStart(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.markRunning(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  log(`START ${task_id} (owner: ${task.owner})`);
  publishEvent('started', task);
  respond(msg, task);
}

/**
 * mesh.tasks.complete — Agent reports task completion.
 * Expects: { task_id, result: { success, summary, artifacts?, diff_stat? } }
 */
async function handleComplete(msg) {
  const { task_id, result } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  // Determine if this task requires human review before completing.
  // requires_review logic:
  //   - explicit true/false on task → honor it
  //   - null (default) → auto-compute:
  //     * mode: human → always (by definition)
  //     * mode: soul → always (creative/strategic work, no mechanical verification)
  //     * collab_mesh without metric → yes (peer review without mechanical check)
  //     * solo_mesh WITH metric → no (metric IS the verification)
  //     * solo_mesh WITHOUT metric → yes (no mechanical check = human must validate)
  //     * local → no (Daedalus/companion handles these interactively)
  const existingTask = await store.get(task_id);
  if (!existingTask) return respondError(msg, `Task ${task_id} not found`);

  let needsReview = existingTask.requires_review;
  if (needsReview === null || needsReview === undefined) {
    const mode = existingTask.collaboration ? 'collab_mesh' : (existingTask.tags?.includes('soul') ? 'soul' : 'solo_mesh');
    const hasMetric = !!existingTask.metric;

    if (mode === 'soul' || existingTask.tags?.includes('human')) {
      needsReview = true;
    } else if (mode === 'collab_mesh' && !hasMetric) {
      needsReview = true;
    } else if (mode === 'solo_mesh' && !hasMetric) {
      needsReview = true;
    } else {
      needsReview = false;
    }
  }

  // Role-based post-completion validation — runs UNCONDITIONALLY on all tasks
  // with a role, regardless of review status. Validation results are included
  // in the pending_review metadata so human reviewers see structured checks.
  let roleValidation = { passed: true, issues: [] };
  if (existingTask.role) {
    const role = findRole(existingTask.role, ROLE_DIRS);
    if (role) {
      const outputFiles = result?.artifacts || [];
      const harnessFiles = (result?.harness?.violations || []).flatMap(v => v.files || []);
      const allFiles = [...new Set([...outputFiles, ...harnessFiles])];

      if (allFiles.length > 0) {
        const reqResult = validateRequiredOutputs(role, allFiles, null);
        if (!reqResult.passed) {
          roleValidation.passed = false;
          roleValidation.issues.push(...reqResult.failures.map(f => `[required_output] ${f.description}: ${f.detail}`));
        }
      }

      if (!roleValidation.passed) {
        log(`ROLE VALIDATION FAILED for ${task_id} (role: ${role.id}): ${roleValidation.issues.length} issue(s)`);
        for (const issue of roleValidation.issues) log(`  - ${issue}`);
        needsReview = true; // force review if validation failed on auto-complete path
      } else {
        log(`ROLE VALIDATION PASSED for ${task_id} (role: ${role.id})`);
      }
    }
  }

  let task;
  if (needsReview) {
    // Gate: task goes to pending_review instead of completed
    // Include role validation results in the review metadata
    const enrichedResult = {
      ...(result || { success: true }),
      role_validation: roleValidation,
    };
    task = await store.markPendingReview(task_id, enrichedResult);
    const elapsed = task.started_at
      ? ((new Date(task.review_requested_at) - new Date(task.started_at)) / 60000).toFixed(1)
      : '?';
    log(`PENDING REVIEW ${task_id} in ${elapsed}m: ${result?.summary || 'no summary'}`);
    log(`  Approve: mesh task approve ${task_id}  |  Reject: mesh task reject ${task_id} --reason "..."`);
    publishEvent('pending_review', task);
    // Update plan subtask status so `mesh plan show` reflects pending_review
    await updatePlanSubtaskStatus(task_id, 'pending_review');
    // Do NOT advance plan wave — task is not yet "completed" for dependency purposes
  } else {
    task = await store.markCompleted(task_id, result || { success: true });
    const elapsed = task.started_at
      ? ((new Date(task.completed_at) - new Date(task.started_at)) / 60000).toFixed(1)
      : '?';
    log(`COMPLETE ${task_id} in ${elapsed}m: ${result?.summary || 'no summary'}`);
    publishEvent('completed', task);
  }

  // NOTE: no cleanupTaskCollabSession here — collab tasks complete via
  // evaluateRound → markCompleted on the session, then store.markCompleted
  // on the parent task. Calling cleanupTaskCollabSession would markAborted
  // on an already-completed session. Clean up audit counter only.
  if (task.collab_session_id && collabStore) {
    collabStore.clearAuditErrorCount(task.collab_session_id);
  }

  // Only advance plan if actually completed (not pending_review)
  if (task.status === TASK_STATUS.COMPLETED) {
    await checkPlanProgress(task_id, 'completed');
  }

  respond(msg, task);
}

/**
 * mesh.tasks.fail — Agent reports task failure.
 * Expects: { task_id, reason, attempts? }
 */
async function handleFail(msg) {
  const { task_id, reason, attempts } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.markFailed(task_id, reason || 'unknown', attempts || []);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  log(`FAIL ${task_id}: ${reason}`);
  publishEvent('failed', task);
  await cleanupTaskCollabSession(task, `Parent task ${task_id} failed: ${reason}`);

  // Phase F: Escalation — if the task has a role with escalation mapping,
  // create an escalation task before cascading failure through the plan.
  let escalated = false;
  if (task.role) {
    const role = findRole(task.role, ROLE_DIRS);
    if (role && role.escalation) {
      // Determine failure type for escalation routing
      let failureType = 'on_metric_failure';
      if (reason && reason.includes('Budget exceeded')) failureType = 'on_budget_exceeded';
      if (reason && reason.includes('scope')) failureType = 'on_scope_violation';

      const escalationTarget = role.escalation[failureType];
      if (escalationTarget) {
        const escalationTask = createTask({
          task_id: `ESC-${task_id}-${Date.now()}`,
          title: `[Escalation] ${task.title}`,
          description: [
            `Escalated from ${task_id} (role: ${task.role}, failure: ${failureType}).`,
            `Original reason: ${reason}`,
            '',
            `Original description: ${task.description}`,
          ].join('\n'),
          budget_minutes: Math.ceil(task.budget_minutes * 1.5), // 50% more budget
          metric: task.metric,
          scope: task.scope,
          success_criteria: task.success_criteria,
          role: escalationTarget === 'human' ? null : escalationTarget,
          requires_review: escalationTarget === 'human' ? true : null,
          tags: [...(task.tags || []), 'escalation', `escalated_from:${task_id}`],
          plan_id: task.plan_id,
          subtask_id: task.subtask_id, // Wire back to original plan subtask for recovery
        });
        await store.put(escalationTask);
        publishEvent('submitted', escalationTask);
        log(`ESCALATED ${task_id} → ${escalationTask.task_id} (target role: ${escalationTarget})`);
        escalated = true;
      }
    }
  }

  // Check if this task belongs to a plan (escalation doesn't block cascade —
  // the escalation task is independent. If the plan has abort_on_critical_fail
  // and this was critical, it still aborts. The escalation is a parallel attempt.)
  await checkPlanProgress(task_id, 'failed');

  respond(msg, { ...task, escalated, escalation_task_id: escalated ? `ESC-${task_id}-${Date.now()}` : null });
}

/**
 * mesh.tasks.attempt — Agent logs an iteration attempt.
 * Expects: { task_id, approach, result, keep }
 *
 * This is the Karpathy pattern: try something, record whether it worked,
 * keep or discard. The agent owns the iteration loop.
 */
async function handleAttempt(msg) {
  const { task_id, approach, result, keep } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.logAttempt(task_id, { approach, result, keep });
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  const status = keep ? 'KEEP' : 'DISCARD';
  log(`ATTEMPT ${task_id} [${status}]: ${approach}`);
  respond(msg, task);
}

/**
 * mesh.tasks.list — List tasks with optional filter.
 * Expects: { status?, owner?, tag? }
 */
async function handleList(msg) {
  const filter = parseRequest(msg);
  const tasks = await store.list(filter);
  respond(msg, tasks);
}

/**
 * mesh.tasks.get — Get a single task by ID.
 * Expects: { task_id }
 */
async function handleGet(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.get(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  respond(msg, task);
}

/**
 * mesh.tasks.heartbeat — Agent signals it's still alive.
 * Expects: { task_id }
 * Updates last_activity for stall detection.
 */
async function handleHeartbeat(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.touchActivity(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  publishEvent('heartbeat', task);
  respond(msg, { task_id, last_activity: task.last_activity });
}

/**
 * mesh.tasks.release — Mark task as released (automation gave up, human triage needed).
 * Expects: { task_id, reason, attempts? }
 * Different from fail: "released" means all retries exhausted, escalation required.
 */
async function handleRelease(msg) {
  const { task_id, reason, attempts } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.markReleased(task_id, reason || 'released for human triage', attempts || []);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  log(`RELEASED ${task_id}: ${reason || 'no reason'} (needs human triage)`);
  publishEvent('released', task);
  await cleanupTaskCollabSession(task, `Parent task ${task_id} released: ${reason || 'human triage'}`);
  respond(msg, task);
}

/**
 * mesh.tasks.cancel — Cancel a task.
 * Expects: { task_id, reason? }
 */
async function handleCancel(msg) {
  const { task_id, reason } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.get(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  task.status = TASK_STATUS.CANCELLED;
  task.completed_at = new Date().toISOString();
  task.result = { success: false, summary: reason || 'cancelled' };
  await store.put(task);

  log(`CANCEL ${task_id}: ${reason || 'no reason'}`);
  publishEvent('cancelled', task);
  await cleanupTaskCollabSession(task, `Parent task ${task_id} cancelled: ${reason || 'no reason'}`);
  respond(msg, task);
}

// ── Task Review (Approval Gate) ─────────────────────

/**
 * mesh.tasks.approve — Human approves a pending_review task.
 * Transitions to completed and advances plan wave if applicable.
 */
async function handleTaskApprove(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.markApproved(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found or not in pending_review status`);

  log(`APPROVED ${task_id}: human review passed`);
  publishEvent('completed', task);

  // Now advance plan wave (this was blocked while in pending_review)
  await checkPlanProgress(task_id, 'completed');

  respond(msg, task);
}

/**
 * mesh.tasks.reject — Human rejects a pending_review task.
 * Re-queues the task with rejection reason injected for next attempt.
 */
async function handleTaskReject(msg) {
  const { task_id, reason } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.markRejected(task_id, reason || 'Rejected by reviewer');
  if (!task) return respondError(msg, `Task ${task_id} not found or not in pending_review status`);

  log(`REJECTED ${task_id}: ${reason || 'no reason'} — re-queued for retry`);
  publishEvent('rejected', task);
  respond(msg, task);
}

// ── Budget Enforcement + Stall Detection ────────────

async function detectStalls() {
  const stalled = await store.findStalled(STALL_MINUTES);

  for (const task of stalled) {
    const lastSignal = task.last_activity || task.started_at;
    const silentMin = ((Date.now() - new Date(lastSignal)) / 60000).toFixed(1);

    log(`STALL SUSPECTED ${task.task_id}: no heartbeat for ${silentMin}m (threshold: ${STALL_MINUTES}m). Checking agent...`);

    // Alive check: ask the agent directly before killing — cheap insurance against false stall detection
    if (task.owner) {
      try {
        const reply = await nc.request(
          `mesh.agent.${task.owner}.alive`,
          sc.encode(JSON.stringify({ task_id: task.task_id })),
          { timeout: 5000 }
        );
        const response = JSON.parse(sc.decode(reply.data));
        if (response.alive) {
          // Agent is still working — extend deadline by touching activity
          await store.touchActivity(task.task_id);
          log(`STALL CLEARED ${task.task_id}: agent ${task.owner} confirmed alive. Extended deadline.`);
          continue;
        }
      } catch {
        // No response within 5s — agent is truly unresponsive
        log(`STALL CONFIRMED ${task.task_id}: agent ${task.owner} did not respond to alive check.`);
      }
    }

    // Mark stalled node as dead in any collab sessions it belongs to.
    // This unblocks isRoundComplete() which otherwise waits forever for
    // a reflection from a crashed node.
    // Uses findActiveSessionsByNode() — O(sessions) single pass instead of
    // the previous O(sessions × nodes) list-then-find pattern.
    if (task.owner && collabStore) {
      try {
        const sessions = await collabStore.findActiveSessionsByNode(task.owner);
        for (const session of sessions) {
          const node = session.nodes.find(n => n.node_id === task.owner);
          if (node && node.status !== 'dead') {
            await collabStore.setNodeStatus(session.session_id, task.owner, 'dead');
            log(`STALL → COLLAB: marked ${task.owner} as dead in session ${session.session_id}`);
            await collabStore.appendAudit(session.session_id, 'node_marked_dead', {
              node_id: task.owner, reason: `Stall detected: no heartbeat for ${silentMin}m`,
            });

            // Re-check if the round is now complete (dead nodes excluded)
            const updated = await collabStore.get(session.session_id);
            if (updated && collabStore.isRoundComplete(updated)) {
              await evaluateRound(session.session_id);
            }
          }
        }
      } catch (err) {
        log(`STALL → COLLAB ERROR: ${err.message}`);
      }
    }

    const releasedTask = await store.markReleased(
      task.task_id,
      `Stall detected: no agent heartbeat for ${silentMin}m, alive check failed`,
      task.attempts
    );
    if (releasedTask) publishEvent('released', releasedTask);

    // Update plan progress if this task belongs to a plan
    await checkPlanProgress(task.task_id, 'failed');

    // Notify the agent's node (fire-and-forget)
    if (task.owner) {
      nc.publish(`mesh.agent.${task.owner}.stall`, sc.encode(JSON.stringify({
        task_id: task.task_id,
        silent_minutes: parseFloat(silentMin),
        threshold_minutes: STALL_MINUTES,
      })));
    }
  }
}

async function enforceBudgets() {
  const overBudget = await store.findOverBudget();

  for (const task of overBudget) {
    const elapsed = ((Date.now() - new Date(task.claimed_at)) / 60000).toFixed(1);

    log(`BUDGET EXCEEDED ${task.task_id}: ${elapsed}m > ${task.budget_minutes}m budget. Auto-failing.`);

    const failedTask = await store.markFailed(
      task.task_id,
      `Budget exceeded: ${elapsed}m elapsed, ${task.budget_minutes}m budget`,
      task.attempts
    );
    if (failedTask) publishEvent('failed', failedTask);

    // Clean up any collab session for this task
    if (collabStore && task.collab_session_id) {
      try {
        await collabStore.markAborted(task.collab_session_id, `Budget exceeded for task ${task.task_id}`);
        log(`BUDGET → COLLAB: aborted session ${task.collab_session_id}`);
      } catch (err) {
        log(`BUDGET → COLLAB ERROR: ${err.message}`);
      }
    }

    // Update plan progress if this task belongs to a plan
    await checkPlanProgress(task.task_id, 'failed');

    // Publish notification so the agent knows
    nc.publish(`mesh.agent.${task.owner}.budget_exceeded`, sc.encode(JSON.stringify({
      task_id: task.task_id,
      elapsed_minutes: parseFloat(elapsed),
      budget_minutes: task.budget_minutes,
    })));
  }
}

// ── Collab Event Publishing ──────────────────────────

function publishCollabEvent(eventType, session) {
  nc.publish(`mesh.events.collab.${eventType}`, sc.encode(JSON.stringify({
    event: eventType,
    session_id: session.session_id,
    task_id: session.task_id,
    session,
    timestamp: new Date().toISOString(),
  })));
}

// ── Collab Subject Handlers ─────────────────────────

/**
 * mesh.collab.create — Create a collab session for a collaborative task.
 * Expects: { task_id }
 * Called automatically when a task with collaboration spec is submitted.
 */
async function handleCollabCreate(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const task = await store.get(task_id);
  if (!task) return respondError(msg, `Task ${task_id} not found`);
  if (!task.collaboration) return respondError(msg, `Task ${task_id} has no collaboration spec`);

  // Check for existing session
  const existing = await collabStore.findByTaskId(task_id);
  if (existing) return respondError(msg, `Session already exists for task ${task_id}: ${existing.session_id}`);

  const session = createSession(task_id, task.collaboration);
  await collabStore.put(session);

  log(`COLLAB CREATE ${session.session_id} for task ${task_id} (mode: ${session.mode}, min: ${session.min_nodes}, max: ${session.max_nodes || '∞'})`);
  publishCollabEvent('created', session);

  // Broadcast recruit signal
  nc.publish(`mesh.collab.${session.session_id}.recruit`, sc.encode(JSON.stringify({
    session_id: session.session_id,
    task_id: task_id,
    mode: session.mode,
    min_nodes: session.min_nodes,
    max_nodes: session.max_nodes,
    task_title: task.title,
  })));

  respond(msg, session);
}

/**
 * mesh.collab.join — Node joins a collab session.
 * Expects: { session_id, node_id, role? }
 */
async function handleCollabJoin(msg) {
  const { session_id, node_id, role } = parseRequest(msg);
  if (!session_id || !node_id) return respondError(msg, 'session_id and node_id required');

  const session = await collabStore.addNode(session_id, node_id, role || 'worker');
  if (!session) return respondError(msg, `Cannot join ${session_id}: full, closed, or already joined`);

  log(`COLLAB JOIN ${session_id}: ${node_id} (${session.nodes.length}/${session.max_nodes || '∞'} nodes)`);
  await collabStore.appendAudit(session_id, 'node_joined', { node_id, role: role || 'worker', total_nodes: session.nodes.length });
  publishCollabEvent('joined', session);

  // Check if recruiting should close → start first round
  if (collabStore.isRecruitingDone(session)) {
    await startCollabRound(session.session_id);
  }

  respond(msg, session);
}

/**
 * mesh.collab.leave — Node leaves a collab session.
 * Expects: { session_id, node_id, reason? }
 */
async function handleCollabLeave(msg) {
  const { session_id, node_id, reason } = parseRequest(msg);
  if (!session_id || !node_id) return respondError(msg, 'session_id and node_id required');

  const session = await collabStore.removeNode(session_id, node_id);
  if (!session) return respondError(msg, `Session ${session_id} not found`);

  log(`COLLAB LEAVE ${session_id}: ${node_id} (${reason || 'no reason'})`);
  await collabStore.appendAudit(session_id, 'node_left', { node_id, reason: reason || null, remaining_nodes: session.nodes.length });

  // If below min_nodes and still active, abort
  if (session.status === COLLAB_STATUS.ACTIVE && session.nodes.length < session.min_nodes) {
    await collabStore.markAborted(session_id, `Below min_nodes: ${session.nodes.length} < ${session.min_nodes}`);
    publishCollabEvent('aborted', session);
  } else if (session.status === COLLAB_STATUS.ACTIVE) {
    // Re-check if the round is now complete (removed node excluded from quorum)
    const updated = await collabStore.get(session_id);
    if (updated && collabStore.isRoundComplete(updated)) {
      await evaluateRound(session_id);
    }
  }

  respond(msg, session);
}

/**
 * mesh.collab.status — Get session status.
 * Expects: { session_id }
 */
async function handleCollabStatus(msg) {
  const { session_id } = parseRequest(msg);
  if (!session_id) return respondError(msg, 'session_id required');

  const session = await collabStore.get(session_id);
  if (!session) return respondError(msg, `Session ${session_id} not found`);

  respond(msg, collabStore.getSummary(session));
}

/**
 * mesh.collab.find — Find collab session by task ID.
 * Expects: { task_id }
 * Returns: session summary or null.
 * Used by agents to discover session_id (which includes a timestamp suffix).
 */
async function handleCollabFind(msg) {
  const { task_id } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  const session = await collabStore.findByTaskId(task_id);
  if (!session) return respond(msg, null);

  respond(msg, session);
}

/**
 * mesh.collab.recruiting — List all sessions currently recruiting nodes.
 * Used by agents to discover collab sessions they should join.
 * Returns: array of { session_id, task_id, mode, min_nodes, max_nodes, current_nodes, recruiting_deadline }
 */
async function handleCollabRecruiting(msg) {
  const recruiting = await collabStore.list({ status: COLLAB_STATUS.RECRUITING });
  const summaries = recruiting.map(s => ({
    session_id: s.session_id,
    task_id: s.task_id,
    mode: s.mode,
    min_nodes: s.min_nodes,
    max_nodes: s.max_nodes,
    current_nodes: s.nodes.length,
    node_ids: s.nodes.map(n => n.node_id || n.id),
    recruiting_deadline: s.recruiting_deadline,
  }));
  respond(msg, summaries);
}

/**
 * mesh.collab.reflect — Node submits a reflection for the current round.
 * Expects: { session_id, node_id, summary, learnings, artifacts, confidence, vote }
 */
async function handleCollabReflect(msg) {
  const reflection = parseRequest(msg);
  const { session_id } = reflection;
  if (!session_id || !reflection.node_id) return respondError(msg, 'session_id and node_id required');

  const session = await collabStore.submitReflection(session_id, reflection);
  if (!session) return respondError(msg, `Cannot submit reflection to ${session_id}`);

  log(`COLLAB REFLECT ${session_id} R${session.current_round}: ${reflection.node_id} (vote: ${reflection.vote}, conf: ${reflection.confidence}${reflection.parse_failed ? ', PARSE FAILED' : ''})`);
  await collabStore.appendAudit(session_id, 'reflection_received', {
    node_id: reflection.node_id, round: session.current_round,
    vote: reflection.vote, confidence: reflection.confidence,
    parse_failed: reflection.parse_failed || false,
  });
  publishCollabEvent('reflection_received', session);

  // Sequential mode: advance turn, notify next node or evaluate round
  // Parallel mode: check if all reflections are in → evaluate convergence
  // NOTE: Node.js single-threaded event loop prevents concurrent execution of this
  // handler — no mutex needed. advanceTurn() is safe without CAS here.
  if (session.mode === 'sequential') {
    const nextNodeId = await collabStore.advanceTurn(session_id);
    if (nextNodeId) {
      // Notify only the next-turn node with accumulated intra-round intel
      await notifySequentialTurn(session_id, nextNodeId);
    } else {
      // All turns done → evaluate round
      await evaluateRound(session_id);
    }
  } else if (collabStore.isRoundComplete(session)) {
    await evaluateRound(session_id);
  }

  respond(msg, session);
}

// ── Collab Round Management ─────────────────────────

/**
 * Compute per-node scopes based on scope_strategy.
 *
 * Strategies:
 *   'shared'      — all nodes get full task scope (default)
 *   'leader_only' — first node (leader) gets full scope, others get read-only marker
 *   'partitioned' — task scope paths split evenly across nodes (round-robin)
 *
 * @returns {Object<string, string[]>} node_id → effective scope array
 */
function computeNodeScopes(nodes, taskScope, strategy) {
  const scopes = {};

  switch (strategy) {
    case 'leader_only': {
      // Leader = first node joined. Gets full write scope.
      // Others get the scope but marked as reviewers (read-only instruction).
      for (let i = 0; i < nodes.length; i++) {
        if (i === 0) {
          // Leader gets full scope
          scopes[nodes[i].node_id] = taskScope.length > 0 ? taskScope : ['*'];
          nodes[i].role = 'leader';
        } else {
          // Reviewers get scope with read-only marker — they review but don't modify
          scopes[nodes[i].node_id] = taskScope.length > 0
            ? taskScope.map(s => `[REVIEW-ONLY] ${s}`)
            : ['[REVIEW-ONLY] *'];
          nodes[i].role = 'reviewer';
        }
      }
      break;
    }

    case 'partitioned': {
      // Split scope paths across nodes round-robin
      if (taskScope.length === 0) {
        // No explicit scope — everyone gets full access
        for (const node of nodes) scopes[node.node_id] = ['*'];
      } else {
        for (const node of nodes) scopes[node.node_id] = [];
        for (let i = 0; i < taskScope.length; i++) {
          const nodeIdx = i % nodes.length;
          scopes[nodes[nodeIdx].node_id].push(taskScope[i]);
        }
        // Ensure every node got at least one path (if more nodes than paths)
        for (const node of nodes) {
          if (scopes[node.node_id].length === 0) {
            scopes[node.node_id] = ['[NO-SCOPE-ASSIGNED]'];
          }
        }
      }
      break;
    }

    case 'shared':
    default: {
      // Everyone gets full scope
      for (const node of nodes) {
        scopes[node.node_id] = taskScope.length > 0 ? taskScope : ['*'];
      }
      break;
    }
  }

  return scopes;
}

/**
 * Start a new round: compile shared intel and notify all nodes.
 */
async function startCollabRound(sessionId) {
  const round = await collabStore.startRound(sessionId);
  if (!round) {
    // startRound returns null if session is aborted (e.g., too few nodes after pruning dead)
    const session = await collabStore.get(sessionId);
    if (session && session.status === COLLAB_STATUS.ABORTED) {
      log(`COLLAB ABORTED ${sessionId}: not enough active nodes to continue (${session.nodes.length} < ${session.min_nodes})`);
      await collabStore.appendAudit(sessionId, 'session_aborted', {
        reason: 'insufficient_nodes', active: session.nodes.length, min_required: session.min_nodes,
        recruited: session.recruited_count,
      });
      publishCollabEvent('aborted', session);
      await store.markFailed(session.task_id, `Collab aborted: too few active nodes (${session.nodes.length} < ${session.min_nodes})`);
    }
    return;
  }

  const session = await collabStore.get(sessionId);
  log(`COLLAB ROUND ${sessionId} R${round.round_number} START (${session.nodes.length} nodes)`);
  await collabStore.appendAudit(sessionId, 'round_started', {
    round: round.round_number, active_nodes: session.nodes.map(n => n.node_id),
    recruited_count: session.recruited_count,
  });
  publishCollabEvent('round_started', session);

  // Compute effective scope per node based on scope_strategy
  const parentTask = await store.get(session.task_id);
  const taskScope = parentTask?.scope || [];
  const scopeStrategy = session.scope_strategy || 'shared';
  const nodeScopes = computeNodeScopes(session.nodes, taskScope, scopeStrategy);

  // Sequential mode: only notify the current_turn node.
  // Other nodes get notified via notifySequentialTurn() as turns advance.
  // Parallel mode: notify all nodes at once.
  const nodesToNotify = session.mode === 'sequential' && session.current_turn
    ? session.nodes.filter(n => n.node_id === session.current_turn)
    : session.nodes;

  for (const node of nodesToNotify) {
    const effectiveScope = nodeScopes[node.node_id] || node.scope;
    nc.publish(`mesh.collab.${sessionId}.node.${node.node_id}.round`, sc.encode(JSON.stringify({
      session_id: sessionId,
      task_id: session.task_id,
      round_number: round.round_number,
      shared_intel: round.shared_intel,
      my_scope: effectiveScope,
      my_role: node.role,
      mode: session.mode,
      current_turn: session.current_turn,  // for sequential mode
      scope_strategy: scopeStrategy,
    })));
  }
}

/**
 * Notify the next node in a sequential turn.
 * Includes intra-round reflections so far as additional shared intel.
 */
async function notifySequentialTurn(sessionId, nextNodeId) {
  const session = await collabStore.get(sessionId);
  if (!session) return;

  const currentRound = session.rounds[session.rounds.length - 1];
  if (!currentRound) return;

  // Compile intra-round intel from reflections already submitted this round
  const intraLines = [`=== INTRA-ROUND ${currentRound.round_number} (turns so far) ===\n`];
  for (const r of currentRound.reflections) {
    intraLines.push(`## Turn: ${r.node_id}${r.parse_failed ? ' [PARSE FAILED]' : ''}`);
    if (r.summary) intraLines.push(`Summary: ${r.summary}`);
    if (r.learnings) intraLines.push(`Learnings: ${r.learnings}`);
    if (r.artifacts.length > 0) intraLines.push(`Artifacts: ${r.artifacts.join(', ')}`);
    intraLines.push(`Confidence: ${r.confidence} | Vote: ${r.vote}`);
    intraLines.push('');
  }
  const intraRoundIntel = intraLines.join('\n');
  const combinedIntel = currentRound.shared_intel
    ? currentRound.shared_intel + '\n\n' + intraRoundIntel
    : intraRoundIntel;

  const parentTask = await store.get(session.task_id);
  const taskScope = parentTask?.scope || [];
  const scopeStrategy = session.scope_strategy || 'shared';
  const nodeScopes = computeNodeScopes(session.nodes, taskScope, scopeStrategy);
  const nextNode = session.nodes.find(n => n.node_id === nextNodeId);

  nc.publish(`mesh.collab.${sessionId}.node.${nextNodeId}.round`, sc.encode(JSON.stringify({
    session_id: sessionId,
    task_id: session.task_id,
    round_number: currentRound.round_number,
    shared_intel: combinedIntel,
    my_scope: nodeScopes[nextNodeId] || nextNode?.scope || ['*'],
    my_role: nextNode?.role || 'worker',
    mode: 'sequential',
    current_turn: nextNodeId,
    scope_strategy: scopeStrategy,
  })));

  log(`COLLAB SEQ ${sessionId} R${currentRound.round_number}: Turn advanced to ${nextNodeId}`);
  await collabStore.appendAudit(sessionId, 'turn_advanced', {
    round: currentRound.round_number, next_node: nextNodeId,
    reflections_so_far: currentRound.reflections.length,
  });
}

/**
 * Evaluate the current round: check convergence, advance or complete.
 */
async function evaluateRound(sessionId) {
  const session = await collabStore.get(sessionId);
  if (!session) return;

  const currentRound = session.rounds[session.rounds.length - 1];
  currentRound.completed_at = new Date().toISOString();
  await collabStore.put(session);

  // Check convergence
  const converged = collabStore.checkConvergence(session);
  const maxReached = collabStore.isMaxRoundsReached(session);

  // Audit the convergence evaluation
  const votes = currentRound.reflections.map(r => ({ node: r.node_id, vote: r.vote, confidence: r.confidence, parse_failed: r.parse_failed || false }));
  await collabStore.appendAudit(sessionId, 'round_evaluated', {
    round: session.current_round, votes,
    converged, max_reached: maxReached,
    outcome: converged ? 'converged' : maxReached ? 'max_rounds' : 'continue',
  });

  if (converged) {
    log(`COLLAB CONVERGED ${sessionId} after ${session.current_round} rounds`);
    await collabStore.markConverged(sessionId);
    publishCollabEvent('converged', session);

    // Re-fetch after markConverged to ensure fresh state
    const freshSession = await collabStore.get(sessionId);
    const allArtifacts = [];
    const contributions = {};
    for (const round of freshSession.rounds) {
      for (const r of round.reflections) {
        allArtifacts.push(...r.artifacts);
        contributions[r.node_id] = r.summary;
      }
    }

    await collabStore.markCompleted(sessionId, {
      artifacts: [...new Set(allArtifacts)],
      summary: `Converged after ${freshSession.current_round} rounds with ${freshSession.nodes.length} nodes`,
      node_contributions: contributions,
    });
    await collabStore.appendAudit(sessionId, 'session_completed', {
      outcome: 'converged', rounds: freshSession.current_round,
      artifacts: [...new Set(allArtifacts)].length,
      node_count: freshSession.nodes.length, recruited_count: freshSession.recruited_count,
    });

    // Complete the parent task
    const completedSession = await collabStore.get(sessionId);
    await store.markCompleted(freshSession.task_id, completedSession.result);
    publishEvent('completed', await store.get(freshSession.task_id));
    publishCollabEvent('completed', completedSession);

  } else if (maxReached) {
    log(`COLLAB MAX ROUNDS ${sessionId}: ${session.current_round}/${session.max_rounds}. Completing with current artifacts.`);

    const allArtifacts = [];
    const contributions = {};
    for (const round of session.rounds) {
      for (const r of round.reflections) {
        allArtifacts.push(...r.artifacts);
        contributions[r.node_id] = r.summary;
      }
    }

    await collabStore.markCompleted(sessionId, {
      artifacts: [...new Set(allArtifacts)],
      summary: `Max rounds (${session.max_rounds}) reached. ${session.nodes.length} nodes participated.`,
      node_contributions: contributions,
    });
    await collabStore.appendAudit(sessionId, 'session_completed', {
      outcome: 'max_rounds_reached', rounds: session.current_round,
      max_rounds: session.max_rounds, artifacts: [...new Set(allArtifacts)].length,
      node_count: session.nodes.length, recruited_count: session.recruited_count,
    });

    // Complete parent task (flagged for review since not truly converged)
    const updatedSession = await collabStore.get(sessionId);
    await store.markCompleted(session.task_id, {
      ...updatedSession.result,
      max_rounds_reached: true,
    });
    publishEvent('completed', await store.get(session.task_id));
    publishCollabEvent('completed', updatedSession);

  } else {
    // Not converged, not maxed out → next round
    log(`COLLAB ROUND ${sessionId} R${session.current_round} DONE. Not converged. Starting next round.`);
    await startCollabRound(sessionId);
  }
}

// ── Collab Recruiting Timer ─────────────────────────

/**
 * Check recruiting sessions whose join window has expired.
 * If min_nodes reached → start first round. Otherwise → abort.
 */
async function checkRecruitingDeadlines() {
  const recruiting = await collabStore.list({ status: COLLAB_STATUS.RECRUITING });
  for (const session of recruiting) {
    if (!collabStore.isRecruitingDone(session)) continue;

    if (session.nodes.length >= session.min_nodes) {
      log(`COLLAB RECRUIT DONE ${session.session_id}: ${session.nodes.length} nodes joined. Starting round 1.`);
      await startCollabRound(session.session_id);
    } else {
      log(`COLLAB RECRUIT FAILED ${session.session_id}: only ${session.nodes.length}/${session.min_nodes} nodes. Aborting.`);
      await collabStore.markAborted(session.session_id, `Not enough nodes: ${session.nodes.length} < ${session.min_nodes}`);
      publishCollabEvent('aborted', await collabStore.get(session.session_id));
      // Release the parent task
      await store.markReleased(session.task_id, `Collab session failed to recruit: ${session.nodes.length}/${session.min_nodes} nodes`);
    }
  }
}

// ── Plan Event Publishing ───────────────────────────

function publishPlanEvent(eventType, plan) {
  nc.publish(`mesh.events.plan.${eventType}`, sc.encode(JSON.stringify({
    event: eventType,
    plan_id: plan.plan_id,
    parent_task_id: plan.parent_task_id,
    plan,
    timestamp: new Date().toISOString(),
  })));
}

// ── Plan RPC Handlers ───────────────────────────────

/**
 * mesh.plans.create — Create a new plan from decomposition.
 * Expects: { parent_task_id, title, description, planner, subtasks[], requires_approval? }
 */
async function handlePlanCreate(msg) {
  const params = parseRequest(msg);
  if (!params.parent_task_id || !params.title) {
    return respondError(msg, 'parent_task_id and title are required');
  }

  // Verify parent task exists
  const parentTask = await store.get(params.parent_task_id);
  if (!parentTask) return respondError(msg, `Parent task ${params.parent_task_id} not found`);

  let plan = createPlan(params);

  // Auto-route subtasks that don't have explicit delegation
  plan = autoRoutePlan(plan);

  await planStore.put(plan);

  log(`PLAN CREATE ${plan.plan_id}: "${plan.title}" (${plan.subtasks.length} subtasks, ${plan.estimated_waves} waves)`);
  publishPlanEvent('created', plan);

  respond(msg, plan);
}

/**
 * mesh.plans.get — Get a plan by ID.
 * Expects: { plan_id }
 */
async function handlePlanGet(msg) {
  const { plan_id } = parseRequest(msg);
  if (!plan_id) return respondError(msg, 'plan_id is required');

  const plan = await planStore.get(plan_id);
  if (!plan) return respondError(msg, `Plan ${plan_id} not found`);

  respond(msg, plan);
}

/**
 * mesh.plans.list — List plans with optional filter.
 * Expects: { status?, parent_task_id? }
 */
async function handlePlanList(msg) {
  const filter = parseRequest(msg);
  const plans = await planStore.list(filter);
  respond(msg, plans.map(p => planStore.getSummary(p)));
}

/**
 * mesh.plans.approve — Approve a plan and materialize subtasks.
 * Expects: { plan_id, approved_by? }
 * Triggers: subtask materialization → dispatch wave 0
 */
async function handlePlanApprove(msg) {
  const { plan_id, approved_by } = parseRequest(msg);
  if (!plan_id) return respondError(msg, 'plan_id is required');

  const plan = await planStore.approve(plan_id, approved_by || 'gui');
  if (!plan) return respondError(msg, `Plan ${plan_id} not found`);

  log(`PLAN APPROVED ${plan_id} by ${plan.approved_by}`);
  publishPlanEvent('approved', plan);

  // Start execution → materialize wave 0
  await planStore.startExecuting(plan_id);
  await advancePlanWave(plan_id);

  respond(msg, await planStore.get(plan_id));
}

/**
 * mesh.plans.abort — Abort a plan and cancel pending subtasks.
 * Expects: { plan_id, reason? }
 */
async function handlePlanAbort(msg) {
  const { plan_id, reason } = parseRequest(msg);
  if (!plan_id) return respondError(msg, 'plan_id is required');

  const plan = await planStore.markAborted(plan_id, reason || 'manually aborted');
  if (!plan) return respondError(msg, `Plan ${plan_id} not found`);

  log(`PLAN ABORTED ${plan_id}: ${reason || 'no reason'}`);
  publishPlanEvent('aborted', plan);

  respond(msg, plan);
}

/**
 * mesh.plans.subtask.update — Update a subtask's status.
 * Called by mesh-bridge when a task completes/fails.
 * Expects: { plan_id, subtask_id, status, result?, mesh_task_id?, kanban_task_id?, owner? }
 */
async function handlePlanSubtaskUpdate(msg) {
  const { plan_id, subtask_id, ...updates } = parseRequest(msg);
  if (!plan_id || !subtask_id) return respondError(msg, 'plan_id and subtask_id required');

  const plan = await planStore.updateSubtask(plan_id, subtask_id, updates);
  if (!plan) return respondError(msg, `Plan ${plan_id} or subtask ${subtask_id} not found`);

  log(`PLAN SUBTASK ${plan_id}/${subtask_id}: ${updates.status || 'updated'}`);

  if (updates.status === SUBTASK_STATUS.COMPLETED) {
    publishPlanEvent('subtask_completed', plan);
    // Check if next wave should dispatch
    await advancePlanWave(plan_id);
  }

  respond(msg, plan);
}

// ── Plan Wave Advancement ───────────────────────────

/**
 * Check if next wave subtasks are ready and dispatch them.
 */
async function advancePlanWave(planId) {
  const plan = await planStore.get(planId);
  if (!plan || plan.status !== PLAN_STATUS.EXECUTING) return;

  // Check if plan is fully done
  if (planStore.isPlanComplete(plan)) {
    await planStore.markCompleted(planId);
    const completedPlan = await planStore.get(planId);
    log(`PLAN COMPLETED ${planId}: all ${plan.subtasks.length} subtasks done`);
    publishPlanEvent('completed', completedPlan);

    // Mark parent task as waiting-user (Gui reviews)
    const parentTask = await store.get(plan.parent_task_id);
    if (parentTask && parentTask.status !== TASK_STATUS.COMPLETED) {
      await store.markCompleted(plan.parent_task_id, {
        success: !planStore.hasFailures(plan),
        summary: `Plan ${planId} completed (${plan.subtasks.length} subtasks)`,
        plan_id: planId,
      });
      publishEvent('completed', await store.get(plan.parent_task_id));
    }
    return;
  }

  // Get next wave subtasks
  const ready = planStore.getNextWaveSubtasks(plan);
  if (ready.length === 0) return;

  const waveNum = ready[0].wave;
  log(`PLAN WAVE ${planId} W${waveNum}: dispatching ${ready.length} subtasks`);

  // Inherit routing fields from parent task so subtasks use the same LLM/node preferences.
  // CONSTRAINT: Subtasks cannot override routing independently — they always inherit from the
  // parent task. If per-subtask routing is needed, extend the subtask schema in mesh-plans.js
  // (e.g. subtask.llm_provider) and merge here with subtask fields taking priority.
  const parentTask = await store.get(plan.parent_task_id);
  const inheritedRouting = {};
  if (parentTask) {
    if (parentTask.llm_provider) inheritedRouting.llm_provider = parentTask.llm_provider;
    if (parentTask.llm_model) inheritedRouting.llm_model = parentTask.llm_model;
    if (parentTask.preferred_nodes) inheritedRouting.preferred_nodes = parentTask.preferred_nodes;
    if (parentTask.exclude_nodes) inheritedRouting.exclude_nodes = parentTask.exclude_nodes;
  }

  for (const st of ready) {
    st.status = SUBTASK_STATUS.QUEUED;

    // Dispatch based on delegation mode
    switch (st.delegation.mode) {
      case 'solo_mesh':
      case 'collab_mesh': {
        // Submit as mesh task — inherit routing fields from parent task
        // Auto-assign role from scope if subtask doesn't specify one
        const subtaskRole = st.role || (st.scope && st.scope.length > 0
          ? (findRoleByScope(st.scope, ROLE_DIRS)?.id || null)
          : null);

        const meshTask = createTask({
          task_id: st.subtask_id,
          title: st.title,
          description: st.description,
          budget_minutes: st.budget_minutes,
          metric: st.metric,
          scope: st.scope,
          success_criteria: st.success_criteria,
          tags: ['plan', planId],
          collaboration: st.delegation.collaboration || undefined,
          plan_id: planId,
          subtask_id: st.subtask_id,
          role: subtaskRole,
          ...inheritedRouting,
        });
        if (subtaskRole) log(`  → AUTO-ROLE ${st.subtask_id}: ${subtaskRole} (matched from scope)`);
        await store.put(meshTask);
        st.mesh_task_id = meshTask.task_id;
        publishEvent('submitted', meshTask);

        // Auto-create collab session if needed
        if (st.delegation.collaboration && collabStore) {
          const session = createSession(meshTask.task_id, st.delegation.collaboration);
          await collabStore.put(session);

          // Store session_id back in mesh task for agent discovery
          meshTask.collab_session_id = session.session_id;
          await store.put(meshTask);

          log(`  → COLLAB SESSION ${session.session_id} for subtask ${st.subtask_id}`);
          publishCollabEvent('created', session);

          nc.publish(`mesh.collab.${session.session_id}.recruit`, sc.encode(JSON.stringify({
            session_id: session.session_id,
            task_id: meshTask.task_id,
            mode: session.mode,
            min_nodes: session.min_nodes,
            max_nodes: session.max_nodes,
            task_title: meshTask.title,
          })));
        }

        log(`  → MESH ${st.subtask_id}: "${st.title}" (${st.delegation.mode})`);
        break;
      }

      case 'local':
      case 'soul': {
        // These are handled via kanban (active-tasks.md) by mesh-bridge
        // Just mark as queued — bridge will materialize in kanban
        st.kanban_task_id = st.subtask_id;
        log(`  → LOCAL ${st.subtask_id}: "${st.title}" (${st.delegation.mode}${st.delegation.soul_id ? `: ${st.delegation.soul_id}` : ''})`);
        break;
      }

      case 'human': {
        st.status = SUBTASK_STATUS.BLOCKED;
        st.kanban_task_id = st.subtask_id;
        log(`  → HUMAN ${st.subtask_id}: "${st.title}" (needs Gui)`);
        break;
      }
    }
  }

  await planStore.put(plan);

  publishPlanEvent('wave_started', plan);
}

/**
 * Update a plan subtask's status without triggering wave advancement.
 * Used for intermediate states like pending_review.
 */
async function updatePlanSubtaskStatus(taskId, newStatus) {
  const task = await store.get(taskId);
  if (!task || !task.plan_id) return;
  const plan = await planStore.get(task.plan_id);
  if (!plan) return;
  const st = plan.subtasks.find(s => s.mesh_task_id === taskId || s.subtask_id === taskId);
  if (!st) return;
  st.status = newStatus;
  await planStore.put(plan);
  log(`PLAN SUBTASK ${st.subtask_id} → ${newStatus} (no wave advance)`);
}

// ── Plan Progress on Task Completion ────────────────

/**
 * When a mesh task completes, check if it belongs to a plan and update accordingly.
 * Called after handleComplete/handleFail and from detectStalls/enforceBudgets.
 */
async function checkPlanProgress(taskId, status) {
  let plan = null;
  let st = null;

  // Fast path: O(1) lookup via plan_id back-reference on the task
  const task = await store.get(taskId);
  if (task && task.plan_id) {
    plan = await planStore.get(task.plan_id);
    if (plan) {
      // Match by mesh_task_id, subtask_id, OR the task's subtask_id field
      // (escalation tasks carry the original subtask_id for plan recovery)
      st = plan.subtasks.find(s =>
        s.mesh_task_id === taskId ||
        s.subtask_id === taskId ||
        (task.subtask_id && s.subtask_id === task.subtask_id)
      );
    }
  }

  // LEGACY: Remove after 2026-06-01. O(n*m) fallback for tasks created before
  // plan_id back-reference was added. Track invocations to know when safe to delete.
  if (!st) {
    const allPlans = await planStore.list({ status: PLAN_STATUS.EXECUTING });
    for (const p of allPlans) {
      const found = p.subtasks.find(s => s.mesh_task_id === taskId || s.subtask_id === taskId);
      if (found) {
        plan = p;
        st = found;
        break;
      }
    }
  }

  if (!plan || !st) return;

  // Escalation recovery: if a subtask was FAILED/BLOCKED but an escalation task
  // completes successfully for it, override status to COMPLETED and unblock dependents.
  const isEscalationRecovery = (
    status === 'completed' &&
    (st.status === SUBTASK_STATUS.FAILED || st.status === SUBTASK_STATUS.BLOCKED) &&
    task && task.tags && task.tags.includes('escalation')
  );

  if (isEscalationRecovery) {
    log(`ESCALATION RECOVERY ${plan.plan_id}: subtask ${st.subtask_id} recovered by ${taskId}`);
    st.status = SUBTASK_STATUS.COMPLETED;
    st.result = { success: true, summary: `Recovered by escalation task ${taskId}` };
    // Unblock any dependents that were blocked by the original failure
    for (const dep of plan.subtasks) {
      if (dep.status === SUBTASK_STATUS.BLOCKED && dep.depends_on.includes(st.subtask_id)) {
        dep.status = SUBTASK_STATUS.PENDING;
        dep.result = null;
        log(`  UNBLOCKED: ${dep.subtask_id} (dependency ${st.subtask_id} recovered)`);
      }
    }
    await planStore.put(plan);
    publishPlanEvent('subtask_recovered', plan);
    await advancePlanWave(plan.plan_id);
    return;
  }

  st.status = status === 'completed' ? SUBTASK_STATUS.COMPLETED : SUBTASK_STATUS.FAILED;
  await planStore.put(plan);

  log(`PLAN PROGRESS ${plan.plan_id}: subtask ${st.subtask_id} → ${st.status}`);

  if (st.status === SUBTASK_STATUS.COMPLETED) {
    publishPlanEvent('subtask_completed', plan);
    await advancePlanWave(plan.plan_id);
    return;
  }

  // Subtask failed — apply failure policy
  if (st.status === SUBTASK_STATUS.FAILED) {
    publishPlanEvent('subtask_failed', plan);

    // Cascade: block all transitive dependents
    const blockedIds = cascadeFailure(plan, st.subtask_id);
    await planStore.put(plan);

    const policy = plan.failure_policy || 'continue_best_effort';

    if (policy === 'abort_on_first_fail') {
      await planStore.markAborted(plan.plan_id, `Subtask ${st.subtask_id} failed (abort_on_first_fail)`);
      publishPlanEvent('aborted', await planStore.get(plan.plan_id));
      log(`PLAN ABORTED ${plan.plan_id}: ${st.subtask_id} failed (abort_on_first_fail policy)`);
      return;
    }

    if (policy === 'abort_on_critical_fail') {
      // Check direct failure
      if (st.critical) {
        await planStore.markAborted(plan.plan_id, `Critical subtask ${st.subtask_id} failed (abort_on_critical_fail)`);
        publishPlanEvent('aborted', await planStore.get(plan.plan_id));
        log(`PLAN ABORTED ${plan.plan_id}: critical subtask ${st.subtask_id} failed`);
        return;
      }

      // Check if cascade blocked any critical subtasks — a blocked critical is
      // functionally equivalent to a failed critical (the plan can't achieve its goal)
      const blockedCritical = plan.subtasks.filter(
        s => blockedIds.has(s.subtask_id) && s.critical
      );
      if (blockedCritical.length > 0) {
        const ids = blockedCritical.map(s => s.subtask_id).join(', ');
        await planStore.markAborted(
          plan.plan_id,
          `Critical subtask(s) ${ids} blocked by failed dependency ${st.subtask_id} (abort_on_critical_fail)`
        );
        publishPlanEvent('aborted', await planStore.get(plan.plan_id));
        log(`PLAN ABORTED ${plan.plan_id}: critical subtask(s) [${ids}] blocked by ${st.subtask_id}`);
        return;
      }
    }

    // continue_best_effort: try to advance independent branches
    await advancePlanWave(plan.plan_id);
  }
}

/**
 * Cascade failure: BFS from failed subtask, mark all transitive dependents as BLOCKED.
 * Mutates plan.subtasks in place.
 * @returns {Set<string>} IDs of all newly-blocked subtasks
 */
function cascadeFailure(plan, failedSubtaskId) {
  const blocked = new Set();
  const queue = [failedSubtaskId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const st of plan.subtasks) {
      if (st.depends_on.includes(current) && !blocked.has(st.subtask_id)) {
        if (st.status === SUBTASK_STATUS.PENDING || st.status === SUBTASK_STATUS.QUEUED) {
          st.status = SUBTASK_STATUS.BLOCKED;
          st.result = { success: false, summary: `Blocked by failed dependency: ${failedSubtaskId}` };
          blocked.add(st.subtask_id);
          queue.push(st.subtask_id);
          log(`  CASCADE: ${st.subtask_id} blocked by ${failedSubtaskId}`);
        }
      }
    }
  }

  return blocked;
}

// ── Main ────────────────────────────────────────────

async function main() {
  log('Starting mesh task daemon...');

  nc = await connect({ servers: NATS_URL, timeout: 5000 });
  log(`Connected to NATS at ${NATS_URL}`);

  // Initialize task store
  const js = nc.jetstream();
  const kv = await js.views.kv(KV_BUCKET);
  store = new TaskStore(kv);
  log(`Task store initialized (bucket: ${KV_BUCKET})`);

  // Initialize collab store
  const collabKv = await js.views.kv(COLLAB_KV_BUCKET);
  collabStore = new CollabStore(collabKv);
  log(`Collab store initialized (bucket: ${COLLAB_KV_BUCKET})`);

  // Initialize plan store
  const plansKv = await js.views.kv(PLANS_KV_BUCKET);
  planStore = new PlanStore(plansKv);
  log(`Plan store initialized (bucket: ${PLANS_KV_BUCKET})`);

  // Subscribe to all task subjects
  const handlers = {
    'mesh.tasks.submit':   handleSubmit,
    'mesh.tasks.claim':    handleClaim,
    'mesh.tasks.start':    handleStart,
    'mesh.tasks.complete': handleComplete,
    'mesh.tasks.fail':     handleFail,
    'mesh.tasks.attempt':   handleAttempt,
    'mesh.tasks.heartbeat': handleHeartbeat,
    'mesh.tasks.release':   handleRelease,
    'mesh.tasks.list':      handleList,
    'mesh.tasks.get':       handleGet,
    'mesh.tasks.cancel':    handleCancel,
    'mesh.tasks.approve':   handleTaskApprove,
    'mesh.tasks.reject':    handleTaskReject,
    // Collab handlers
    'mesh.collab.create':   handleCollabCreate,
    'mesh.collab.join':     handleCollabJoin,
    'mesh.collab.leave':    handleCollabLeave,
    'mesh.collab.status':   handleCollabStatus,
    'mesh.collab.find':     handleCollabFind,
    'mesh.collab.reflect':  handleCollabReflect,
    'mesh.collab.recruiting': handleCollabRecruiting,
    // Plan handlers
    'mesh.plans.create':          handlePlanCreate,
    'mesh.plans.get':             handlePlanGet,
    'mesh.plans.list':            handlePlanList,
    'mesh.plans.approve':         handlePlanApprove,
    'mesh.plans.abort':           handlePlanAbort,
    'mesh.plans.subtask.update':  handlePlanSubtaskUpdate,
  };

  const subs = [];
  for (const [subject, handler] of Object.entries(handlers)) {
    const sub = nc.subscribe(subject);
    subs.push(sub);
    (async () => {
      for await (const msg of sub) {
        try {
          await handler(msg);
        } catch (err) {
          log(`ERROR handling ${subject}: ${err.message}\n${err.stack}`);
          try { respondError(msg, err.message); } catch {}
        }
      }
    })();
    log(`  Listening: ${subject}`);
  }

  // Start enforcement loops
  const budgetTimer = setInterval(enforceBudgets, BUDGET_CHECK_INTERVAL);
  const stallTimer = setInterval(detectStalls, BUDGET_CHECK_INTERVAL);
  const recruitTimer = setInterval(checkRecruitingDeadlines, 5000); // check every 5s
  log(`Budget enforcement: every ${BUDGET_CHECK_INTERVAL / 1000}s`);
  log(`Stall detection: every ${BUDGET_CHECK_INTERVAL / 1000}s (threshold: ${STALL_MINUTES}m)`);
  log(`Collab recruiting check: every 5s`);


  log('Task daemon ready.');

  // Shutdown handler
  const shutdown = async () => {
    log('Shutting down...');
    clearInterval(budgetTimer);
    clearInterval(stallTimer);
    clearInterval(recruitTimer);
    for (const sub of subs) sub.unsubscribe();
    await nc.drain();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await nc.closed();
}

main().catch(err => {
  console.error(`[mesh-task-daemon] Fatal: ${err.message}`);
  process.exit(1);
});
