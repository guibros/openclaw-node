#!/usr/bin/env node

/**
 * mesh-bridge.js — Bridge between kanban (active-tasks.md) and mesh (NATS).
 *
 * Dispatch (kanban → mesh): polls active-tasks.md for execution=mesh tasks,
 * submits to mesh-task-daemon via NATS.
 *
 * Results (mesh → kanban): subscribes to mesh.events.> for real-time state
 * changes. On completed/failed/released, writes results + log back to
 * active-tasks.md immediately.
 *
 * Usage:
 *   node mesh-bridge.js              # run daemon
 *   node mesh-bridge.js --dry-run    # find tasks but don't dispatch
 */

const { connect, StringCodec } = require('nats');
const fs = require('fs');
const path = require('path');
const { readTasks, updateTaskInPlace, isoTimestamp, ACTIVE_TASKS_PATH } = require('../lib/kanban-io');

const sc = StringCodec();
const { NATS_URL } = require('../lib/nats-resolve');
const DISPATCH_INTERVAL = parseInt(process.env.BRIDGE_DISPATCH_INTERVAL || '10000'); // 10s
const LOG_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'memory', 'mesh-logs');
const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

let nc;
let running = true;

// Track tasks we've dispatched (to avoid re-dispatching).
// KNOWN LIMITATION (#6): Serial dispatch only — ONE task at a time.
// The entire mesh stalls on a slow task. This is intentional for V1 safety.
// To scale: change `dispatched.size === 0` to `dispatched.size < MAX_CONCURRENT`
// with MAX_CONCURRENT configurable via env var.
const dispatched = new Set();

// Submit failure tracking for exponential backoff (#3)
let consecutiveSubmitFailures = 0;
const MAX_SUBMIT_FAILURES = 3;

// Heartbeat tracking for staleness warnings (#7)
// Maps task_id → last heartbeat timestamp (ms)
const lastHeartbeat = new Map();
const STALE_WARNING_MS = 2 * 60 * 1000; // 2 minutes without heartbeat → warn on card
const HEARTBEAT_CHECK_INTERVAL = 30000;  // check every 30s

// ── Logging ─────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [mesh-bridge] ${msg}`);
}

// ── NATS Helpers ────────────────────────────────────

async function natsRequest(subject, payload, timeoutMs = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: timeoutMs });
  const response = JSON.parse(sc.decode(msg.data));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// ── Startup Reconciliation ──────────────────────────
// On restart, recover state for any tasks that were in-flight when we crashed.
// Scans kanban for status:running + owner:mesh-agent, checks daemon KV for
// actual state. Processes completed/failed results we missed, resumes tracking
// for still-running tasks. Fixes #2 and #10 from the pipeline audit.

async function reconcile() {
  let tasks;
  try {
    tasks = readTasks(ACTIVE_TASKS_PATH);
  } catch (err) {
    log(`RECONCILE: cannot read active-tasks.md: ${err.message}`);
    return;
  }

  const inflight = tasks.filter(t =>
    t.execution === 'mesh' &&
    (t.status === 'running' || t.status === 'submitted') &&
    (t.owner === 'mesh-agent' || t.owner === 'mesh')
  );
  if (inflight.length === 0) {
    log('RECONCILE: no orphaned mesh tasks found');
    return;
  }

  log(`RECONCILE: found ${inflight.length} orphaned mesh task(s), checking daemon state...`);

  for (const task of inflight) {
    try {
      const meshTask = await natsRequest('mesh.tasks.get', { task_id: task.task_id });

      if (!meshTask) {
        // Task doesn't exist in daemon KV. Two possible causes:
        // 1. Card was 'submitted' by the bridge but daemon lost it (crash/purge) → mark blocked
        // 2. Card is 'running' because user dragged a blocked card in MC → leave it alone
        //    (KANBAN_TO_STATUS maps in_progress → running, creating phantom "running" mesh cards)
        if (task.status === 'submitted') {
          log(`RECONCILE: ${task.task_id} submitted but not in daemon — marking blocked (needs re-submit)`);
          updateTaskInPlace(ACTIVE_TASKS_PATH, task.task_id, {
            status: 'blocked',
            next_action: 'Mesh task not found in daemon (bridge restarted, task may need re-submit)',
            updated_at: isoTimestamp(),
          });
        } else {
          // status === 'running' but daemon doesn't know about it — likely a user drag or stale state.
          // Don't bounce the card back to blocked. Just log and skip.
          log(`RECONCILE: ${task.task_id} shows running but not in daemon — skipping (possible MC drag artifact)`);
        }
        continue;
      }

      switch (meshTask.status) {
        case 'completed':
          log(`RECONCILE: ${task.task_id} already completed — processing result`);
          handleCompleted(task.task_id, meshTask);
          break;
        case 'failed':
          log(`RECONCILE: ${task.task_id} already failed — processing result`);
          handleFailed(task.task_id, meshTask, 'failed');
          break;
        case 'released':
          log(`RECONCILE: ${task.task_id} was released — processing result`);
          handleFailed(task.task_id, meshTask, 'released');
          break;
        case 'cancelled':
          log(`RECONCILE: ${task.task_id} was cancelled`);
          handleCancelled(task.task_id, meshTask);
          break;
        default:
          // Still queued, claimed, or running — resume tracking
          log(`RECONCILE: ${task.task_id} still ${meshTask.status} — resuming tracking`);
          dispatched.add(task.task_id);
          lastHeartbeat.set(task.task_id, Date.now()); // init staleness tracking (#3)
          break;
      }
    } catch (err) {
      log(`RECONCILE: error checking ${task.task_id}: ${err.message} — will retry via events`);
      // Add to dispatched so we at least listen for events
      dispatched.add(task.task_id);
      lastHeartbeat.set(task.task_id, Date.now()); // init staleness tracking (#3)
    }
  }

  log(`RECONCILE: done. Tracking ${dispatched.size} in-flight task(s)`);
}

// ── Dispatch: Kanban → Mesh ─────────────────────────

function findDispatchable() {
  let tasks;
  try {
    tasks = readTasks(ACTIVE_TASKS_PATH);
  } catch (err) {
    log(`Error reading active-tasks.md: ${err.message}`);
    return null;
  }

  const candidates = tasks
    .filter(t => t.execution === 'mesh' && t.status === 'queued' && !dispatched.has(t.task_id))
    .sort((a, b) => (b.auto_priority || 0) - (a.auto_priority || 0));

  return candidates[0] || null;
}

async function dispatchTask(task) {
  log(`DISPATCHING: ${task.task_id} "${task.title}"`);

  if (DRY_RUN) {
    log(`[DRY RUN] Would submit: ${task.task_id} "${task.title}" metric=${task.metric || 'none'}`);
    return;
  }

  const meshTask = await natsRequest('mesh.tasks.submit', {
    task_id: task.task_id,
    title: task.title,
    description: task.description || '',
    budget_minutes: task.budget_minutes || 30,
    metric: task.metric || null,
    success_criteria: task.success_criteria || [],
    scope: task.scope || [],
    priority: task.auto_priority || 0,
    llm_provider: task.llm_provider || null,
    llm_model: task.llm_model || null,
    preferred_nodes: task.preferred_nodes || [],
    exclude_nodes: task.exclude_nodes || [],
    collaboration: task.collaboration || undefined,
  });

  log(`SUBMITTED: ${meshTask.task_id} to mesh (budget: ${meshTask.budget_minutes}m)`);

  // Mark as 'submitted' — NOT 'running'. Card reflects actual mesh state.
  // The 'claimed' event handler below promotes to 'running'.
  updateTaskInPlace(ACTIVE_TASKS_PATH, task.task_id, {
    status: 'submitted',
    owner: 'mesh',
    updated_at: isoTimestamp(),
  });

  dispatched.add(task.task_id);
  lastHeartbeat.set(task.task_id, Date.now()); // start heartbeat tracking (#7)
  log(`UPDATED: ${task.task_id} → submitted`);
}

// ── Collab Events → Kanban ───────────────────────────

/**
 * Handle collab-specific events. Updates kanban with collaboration progress.
 */
function handleCollabEvent(eventType, taskId, data) {
  // Only process events for tasks we dispatched
  if (!dispatched.has(taskId)) return;

  const session = data; // collab events include the session object

  switch (eventType) {
    case 'collab.created':
      log(`COLLAB CREATED: session ${session.session_id} for task ${taskId} (mode: ${session.mode})`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `Collab session created (mode: ${session.mode}). Recruiting ${session.min_nodes}+ nodes...`,
        updated_at: isoTimestamp(),
      });
      break;

    case 'collab.joined':
      log(`COLLAB JOINED: ${session.nodes?.length || '?'} nodes in session for ${taskId}`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `${session.nodes?.length || '?'} nodes joined. ${session.status === 'recruiting' ? 'Recruiting...' : 'Working...'}`,
        updated_at: isoTimestamp(),
      });
      break;

    case 'collab.round_started':
      log(`COLLAB ROUND ${session.current_round}: started for ${taskId}`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `Round ${session.current_round}/${session.max_rounds} in progress (${session.nodes?.length || '?'} nodes)`,
        updated_at: isoTimestamp(),
      });
      break;

    case 'collab.reflection_received': {
      const totalReflections = session.rounds?.[session.rounds.length - 1]?.reflections?.length || 0;
      const totalNodes = session.nodes?.length || '?';
      log(`COLLAB REFLECT: ${totalReflections}/${totalNodes} for R${session.current_round} of ${taskId}`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `R${session.current_round}: ${totalReflections}/${totalNodes} reflections received`,
        updated_at: isoTimestamp(),
      });
      break;
    }

    case 'collab.converged':
      log(`COLLAB CONVERGED: ${taskId} after ${session.current_round} rounds`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `Converged after ${session.current_round} rounds. Collecting artifacts...`,
        updated_at: isoTimestamp(),
      });
      break;

    case 'collab.completed': {
      const result = session.result || {};
      const nodeNames = Object.keys(result.node_contributions || {});
      const artifactCount = (result.artifacts || []).length;
      log(`COLLAB COMPLETED: ${taskId} — ${result.rounds_taken} rounds, ${nodeNames.length} nodes, ${artifactCount} artifacts`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        next_action: `Collab completed: ${result.rounds_taken || '?'} rounds, ${nodeNames.length} nodes. ${artifactCount} artifact(s). ${result.summary || ''}`.trim(),
        collab_result: {
          rounds_taken: result.rounds_taken,
          node_contributions: result.node_contributions,
          artifacts: result.artifacts,
          summary: result.summary,
        },
        updated_at: isoTimestamp(),
      });
      break;
    }

    case 'collab.aborted':
      log(`COLLAB ABORTED: ${taskId} — ${session.result?.summary || 'unknown reason'}`);
      break;

    // Circling Strategy events
    case 'collab.circling_step_started': {
      if (!dispatched.has(taskId)) {
        // Auto-track CLI-submitted circling tasks
        try {
          const tasks = readTasks(ACTIVE_TASKS_PATH);
          if (tasks.find(t => t.task_id === taskId && t.execution === 'mesh')) {
            dispatched.add(taskId);
            lastHeartbeat.set(taskId, Date.now());
            log(`CIRCLING AUTO-TRACK: ${taskId} (CLI-submitted)`);
          } else { break; }
        } catch { break; }
      }
      const c = session.circling || {};
      const stepName = c.phase === 'init' ? 'Init'
        : c.phase === 'finalization' ? 'Finalization'
        : `SR${c.current_subround}/${c.max_subrounds} Step${c.current_step}`;
      log(`CIRCLING ${stepName}: started for ${taskId}`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        circling_phase: c.phase || null,
        circling_subround: c.current_subround || 0,
        circling_step: c.current_step || 0,
        next_action: `${stepName} in progress (${session.nodes?.length || '?'} nodes)`,
        updated_at: isoTimestamp(),
      });
      break;
    }

    case 'collab.circling_gate': {
      const cg = session.circling || {};
      // Extract blocked reviewer summaries from the last round (if any)
      const lastRound = session.rounds?.[session.rounds.length - 1];
      const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
      let gateMsg;
      if (blockedVotes.length > 0) {
        const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
        gateMsg = `[GATE] SR${cg.current_subround} blocked — ${reason || 'reviewer flagged concern'}`;
      } else {
        gateMsg = `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
      }
      log(`CIRCLING GATE: ${taskId} — SR${cg.current_subround} waiting for approval`);
      updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
        status: 'waiting-user',
        next_action: gateMsg,
        updated_at: isoTimestamp(),
      });
      break;
    }

    default:
      log(`COLLAB EVENT: ${eventType} for ${taskId}`);
  }
}

// ── Plan Events → Kanban ────────────────────────────

/**
 * Handle plan-specific events. Materializes subtasks in kanban and tracks progress.
 */
function handlePlanEvent(eventType, data) {
  const plan = data;
  const parentTaskId = plan?.parent_task_id;

  switch (eventType) {
    case 'plan.created':
      log(`PLAN CREATED: ${plan.plan_id} for task ${parentTaskId} (${plan.subtasks?.length || 0} subtasks, ${plan.estimated_waves || 0} waves)`);
      if (parentTaskId) {
        updateTaskInPlace(ACTIVE_TASKS_PATH, parentTaskId, {
          next_action: `Plan created: ${plan.subtasks?.length || 0} subtasks in ${plan.estimated_waves || 0} waves. ${plan.requires_approval ? 'Awaiting approval.' : 'Auto-executing.'}`,
          updated_at: isoTimestamp(),
        });
      }
      break;

    case 'plan.approved':
      log(`PLAN APPROVED: ${plan.plan_id}`);
      if (parentTaskId) {
        updateTaskInPlace(ACTIVE_TASKS_PATH, parentTaskId, {
          status: 'running',
          next_action: `Plan approved. Dispatching wave 0...`,
          updated_at: isoTimestamp(),
        });
      }
      break;

    case 'plan.wave_started': {
      // Materialize new subtasks into kanban as child tasks
      const readySubtasks = (plan.subtasks || []).filter(st => st.status === 'queued' || st.status === 'blocked');
      log(`PLAN WAVE: ${plan.plan_id} — materializing ${readySubtasks.length} subtasks in kanban`);

      for (const st of readySubtasks) {
        // Only materialize local/soul/human subtasks — mesh subtasks are tracked via mesh events
        if (st.delegation?.mode === 'local' || st.delegation?.mode === 'soul' || st.delegation?.mode === 'human') {
          materializeSubtask(plan, st);
        }
      }

      if (parentTaskId) {
        const completed = (plan.subtasks || []).filter(s => s.status === 'completed').length;
        const total = (plan.subtasks || []).length;
        updateTaskInPlace(ACTIVE_TASKS_PATH, parentTaskId, {
          next_action: `Plan executing: ${completed}/${total} subtasks done`,
          updated_at: isoTimestamp(),
        });
      }
      break;
    }

    case 'plan.subtask_completed': {
      const completed = (plan.subtasks || []).filter(s => s.status === 'completed').length;
      const total = (plan.subtasks || []).length;
      log(`PLAN PROGRESS: ${plan.plan_id} — ${completed}/${total} subtasks done`);
      if (parentTaskId) {
        updateTaskInPlace(ACTIVE_TASKS_PATH, parentTaskId, {
          next_action: `Plan: ${completed}/${total} subtasks complete`,
          updated_at: isoTimestamp(),
        });
      }
      break;
    }

    case 'plan.completed':
      log(`PLAN COMPLETED: ${plan.plan_id}`);
      // Parent task completion handled by the daemon (marks waiting-user)
      break;

    case 'plan.aborted':
      log(`PLAN ABORTED: ${plan.plan_id}`);
      if (parentTaskId) {
        updateTaskInPlace(ACTIVE_TASKS_PATH, parentTaskId, {
          status: 'blocked',
          next_action: `Plan aborted — needs triage`,
          updated_at: isoTimestamp(),
        });
      }
      break;

    default:
      log(`PLAN EVENT: ${eventType} for plan ${plan?.plan_id || 'unknown'}`);
  }
}

/**
 * Materialize a plan subtask as a child task in active-tasks.md.
 * For local/soul/human delegation modes only — mesh subtasks use the existing mesh dispatch.
 */
function materializeSubtask(plan, subtask) {
  try {
    const tasks = readTasks(ACTIVE_TASKS_PATH);

    // Check if already materialized
    if (tasks.find(t => t.task_id === subtask.subtask_id)) {
      log(`  SKIP: ${subtask.subtask_id} already in kanban`);
      return;
    }

    const mode = subtask.delegation?.mode || 'local';
    const soulId = subtask.delegation?.soul_id || null;

    const taskEntry = {
      task_id: subtask.subtask_id,
      title: subtask.title,
      status: mode === 'human' ? 'blocked' : 'queued',
      owner: mode === 'soul' ? 'Daedalus' : null,
      soul_id: soulId,
      success_criteria: subtask.success_criteria || [],
      artifacts: [],
      next_action: mode === 'human'
        ? 'Needs Gui input'
        : `Plan subtask (${mode}${soulId ? `: ${soulId}` : ''})`,
      parent_id: plan.parent_task_id,
      project: null, // inherited from parent via MC
      description: `${subtask.description || ''}\n\n_Delegation: ${mode}${soulId ? ` → ${soulId}` : ''} | Plan: ${plan.plan_id} | Budget: ${subtask.budget_minutes}m_`,
      updated_at: isoTimestamp(),
    };

    // Append to active-tasks.md
    const content = fs.readFileSync(ACTIVE_TASKS_PATH, 'utf-8');
    const yamlEntry = formatTaskYaml(taskEntry);
    fs.writeFileSync(ACTIVE_TASKS_PATH, content + '\n' + yamlEntry);

    log(`  MATERIALIZED: ${subtask.subtask_id} → kanban (${mode})`);
  } catch (err) {
    log(`  ERROR materializing ${subtask.subtask_id}: ${err.message}`);
  }
}

/**
 * Format a task entry as YAML for active-tasks.md.
 */
function formatTaskYaml(task) {
  const lines = [];
  lines.push(`- task_id: ${task.task_id}`);
  lines.push(`  title: ${task.title}`);
  lines.push(`  status: ${task.status}`);
  if (task.owner) lines.push(`  owner: ${task.owner}`);
  if (task.soul_id) lines.push(`  soul_id: ${task.soul_id}`);
  if (task.success_criteria?.length > 0) {
    lines.push('  success_criteria:');
    for (const sc of task.success_criteria) {
      lines.push(`    - ${sc}`);
    }
  }
  lines.push(`  artifacts:`);
  if (task.next_action) lines.push(`  next_action: "${task.next_action.replace(/"/g, '\\"')}"`);
  if (task.parent_id) lines.push(`  parent_id: ${task.parent_id}`);
  if (task.description) lines.push(`  description: "${task.description.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  lines.push(`  updated_at: ${task.updated_at}`);
  return lines.join('\n');
}

// ── Results: Mesh → Kanban (event-driven) ───────────

/**
 * Handle a mesh event. Called immediately when the daemon publishes to mesh.events.>
 */
function handleEvent(eventType, taskId, meshTask) {
  // Ignore events for tasks we didn't dispatch — prevents cross-bridge overwrites
  if (!dispatched.has(taskId)) {
    if (['completed', 'failed', 'released', 'cancelled'].includes(eventType)) {
      log(`EVENT IGNORED: ${eventType} ${taskId} (not in dispatched set)`);
    }
    return;
  }

  try {
    switch (eventType) {
      case 'completed':
        handleCompleted(taskId, meshTask);
        break;
      case 'failed':
        handleFailed(taskId, meshTask, 'failed');
        break;
      case 'released':
        handleFailed(taskId, meshTask, 'released');
        break;
      case 'cancelled':
        handleCancelled(taskId, meshTask);
        break;
      case 'claimed':
        // Agent has claimed the task — NOW it's truly running.
        // This is the moment the card should say 'running'.
        log(`CLAIMED: ${taskId} by ${meshTask.owner}`);
        updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
          status: 'running',
          owner: meshTask.owner || 'mesh-agent',
          updated_at: isoTimestamp(),
        });
        log(`KANBAN: ${taskId} → running (agent: ${meshTask.owner})`);
        return;
      case 'heartbeat':
        // Track heartbeat for staleness detection (#7)
        lastHeartbeat.set(taskId, Date.now());
        return;
      default:
        // Handle collab events
        if (eventType.startsWith('collab.')) {
          handleCollabEvent(eventType, taskId, meshTask);
          return;
        }
        // submitted, started — informational only
        log(`EVENT: ${eventType} ${taskId}`);
        return;
    }
    dispatched.delete(taskId);
    lastHeartbeat.delete(taskId);
  } catch (err) {
    log(`ERROR handling event ${eventType} for ${taskId}: ${err.message}`);
  }
}

function handleCompleted(taskId, meshTask) {
  const elapsed = meshTask.started_at && meshTask.completed_at
    ? ((new Date(meshTask.completed_at) - new Date(meshTask.started_at)) / 1000).toFixed(0)
    : '?';
  const attemptCount = meshTask.attempts?.length || 0;

  log(`COMPLETED: ${taskId} in ${elapsed}s (${attemptCount} attempts)`);

  const logPath = writeLog(taskId, meshTask, 'completed');
  const relLogPath = path.relative(WORKSPACE, logPath);

  updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
    status: 'waiting-user',
    next_action: `Gui review — mesh completed in ${elapsed}s (${attemptCount} attempt${attemptCount !== 1 ? 's' : ''})`,
    updated_at: isoTimestamp(),
  }, {
    artifacts: [relLogPath],
  });

  log(`KANBAN: ${taskId} → waiting-user (log: ${relLogPath})`);
}

function handleFailed(taskId, meshTask, reason) {
  const attemptCount = meshTask.attempts?.length || 0;
  const summary = truncateAtLine(meshTask.result?.summary || 'unknown failure', 100);

  log(`${reason.toUpperCase()}: ${taskId} after ${attemptCount} attempts`);

  const logPath = writeLog(taskId, meshTask, reason);
  const relLogPath = path.relative(WORKSPACE, logPath);

  updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
    status: 'blocked',
    next_action: `Mesh agent ${reason} after ${attemptCount} attempt${attemptCount !== 1 ? 's' : ''} — ${summary}`,
    updated_at: isoTimestamp(),
  }, {
    artifacts: [relLogPath],
  });

  log(`KANBAN: ${taskId} → blocked (log: ${relLogPath})`);
}

function handleCancelled(taskId, meshTask) {
  log(`CANCELLED: ${taskId}`);
  updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
    status: 'cancelled',
    next_action: 'Cancelled in mesh',
    updated_at: isoTimestamp(),
  });
}

// ── Heartbeat Staleness Check (#7) ──────────────────
// Periodically checks if dispatched tasks have gone silent.
// Updates kanban card next_action with a visual warning if no heartbeat for 2m.
// The daemon's stall detection (5m) will eventually release the task.

function checkStaleness() {
  const now = Date.now();
  for (const taskId of dispatched) {
    const last = lastHeartbeat.get(taskId);
    if (!last) continue;

    const silentMs = now - last;
    if (silentMs >= STALE_WARNING_MS) {
      const silentMin = (silentMs / 60000).toFixed(1);
      log(`STALE WARNING: ${taskId} — no heartbeat for ${silentMin}m`);
      try {
        updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, {
          next_action: `[!] Agent silent for ${silentMin}m — may be stalled (daemon kills at 5m)`,
          updated_at: isoTimestamp(),
        });
      } catch (err) {
        log(`ERROR updating stale warning for ${taskId}: ${err.message}`);
      }
      // Don't warn again until next heartbeat resets the timer
      lastHeartbeat.set(taskId, now);
    }
  }
}

// ── Helpers ─────────────────────────────────────────

/** Truncate string at the last newline before maxLen (#8 — clean line boundaries) */
function truncateAtLine(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  const cut = str.slice(0, maxLen);
  const lastNl = cut.lastIndexOf('\n');
  return lastNl > 0 ? cut.slice(0, lastNl) : cut;
}

// ── Log Writer ──────────────────────────────────────

function writeLog(taskId, meshTask, finalStatus) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const logPath = path.join(LOG_DIR, `${taskId}.md`);
  const lines = [];

  lines.push(`# Mesh Execution Log: ${taskId}`);
  lines.push(`## Task: ${meshTask.title}`);
  lines.push('');
  lines.push(`- **Submitted:** ${meshTask.created_at}`);
  if (meshTask.claimed_at) lines.push(`- **Claimed:** ${meshTask.claimed_at}`);
  if (meshTask.started_at) lines.push(`- **Started:** ${meshTask.started_at}`);
  if (meshTask.completed_at) lines.push(`- **Finished:** ${meshTask.completed_at}`);

  const elapsed = meshTask.started_at && meshTask.completed_at
    ? ((new Date(meshTask.completed_at) - new Date(meshTask.started_at)) / 1000).toFixed(0)
    : '?';
  lines.push(`- **Duration:** ${elapsed}s`);
  lines.push(`- **Final Status:** ${finalStatus}`);
  lines.push(`- **Attempts:** ${(meshTask.attempts || []).length}`);
  if (meshTask.metric) lines.push(`- **Metric:** \`${meshTask.metric}\``);
  if (meshTask.owner) lines.push(`- **Agent:** ${meshTask.owner}`);
  lines.push('');

  if (meshTask.description) {
    lines.push('## Description');
    lines.push(meshTask.description);
    lines.push('');
  }

  if (meshTask.attempts && meshTask.attempts.length > 0) {
    lines.push('## Attempts');
    for (let i = 0; i < meshTask.attempts.length; i++) {
      const a = meshTask.attempts[i];
      lines.push(`### Attempt ${i + 1}`);
      lines.push(`- **Approach:** ${a.approach || 'unknown'}`);
      lines.push(`- **Kept:** ${a.keep ? 'yes' : 'no (reverted)'}`);
      lines.push(`- **Timestamp:** ${a.timestamp || 'unknown'}`);
      if (a.result) {
        lines.push('');
        lines.push('**Result:**');
        lines.push('```');
        lines.push(truncateAtLine(a.result, 2000));
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (meshTask.result) {
    lines.push('## Result');
    lines.push(`- **Success:** ${meshTask.result.success}`);
    if (meshTask.result.summary) {
      lines.push('');
      lines.push('**Summary:**');
      lines.push('```');
      lines.push(truncateAtLine(meshTask.result.summary, 3000));
      lines.push('```');
    }
  }

  fs.writeFileSync(logPath, lines.join('\n') + '\n');
  log(`LOG: ${logPath}`);
  return logPath;
}

// ── Main ────────────────────────────────────────────

async function main() {
  log('Starting mesh bridge (event-driven)');
  log(`  NATS:             ${NATS_URL}`);
  log(`  Active Tasks:     ${ACTIVE_TASKS_PATH}`);
  log(`  Log Dir:          ${LOG_DIR}`);
  log(`  Dispatch interval: ${DISPATCH_INTERVAL / 1000}s`);
  log(`  Mode:             ${DRY_RUN ? 'dry run' : 'live'}`);

  nc = await connect({
    servers: NATS_URL,
    timeout: 5000,
    reconnect: true,
    maxReconnectAttempts: 10,
    reconnectTimeWait: 2000,
  });
  log('Connected to NATS');

  // Re-reconcile on reconnect — catches events missed during NATS blip (#2)
  // Exit on permanent disconnect so launchd restarts us
  (async () => {
    for await (const s of nc.status()) {
      log(`NATS status: ${s.type}`);
      if (s.type === 'reconnect') {
        log('NATS reconnected — running reconciliation');
        reconcile().catch(err => log(`RECONCILE on reconnect failed: ${err.message}`));
      }
    }
  })();
  nc.closed().then(() => {
    log('NATS connection permanently closed — exiting for launchd restart');
    process.exit(1);
  });

  // Reconcile any orphaned tasks from a previous crash (#2, #10)
  await reconcile();

  // Subscribe to ALL mesh events (wildcard)
  const sub = nc.subscribe('mesh.events.>');
  log('Subscribed to mesh.events.>');

  // Event listener (runs in background)
  (async () => {
    for await (const msg of sub) {
      try {
        const payload = JSON.parse(sc.decode(msg.data));
        // Route plan events separately (they use plan_id, not task_id)
        if (payload.event && payload.event.startsWith('plan.')) {
          handlePlanEvent(payload.event, payload.plan || payload);
        } else {
          handleEvent(payload.event, payload.task_id, payload.task);
        }
      } catch (err) {
        log(`ERROR parsing event: ${err.message}`);
      }
    }
  })();

  // Heartbeat staleness checker (#7)
  const stalenessTimer = setInterval(checkStaleness, HEARTBEAT_CHECK_INTERVAL);
  log(`Heartbeat staleness check: every ${HEARTBEAT_CHECK_INTERVAL / 1000}s (warn at ${STALE_WARNING_MS / 60000}m)`);

  // Wake signal — MC publishes mesh.bridge.wake after creating a mesh task
  // so the bridge picks it up in ~1s instead of waiting for the next poll cycle
  let wakeResolve = null;
  const wakeSub = nc.subscribe('mesh.bridge.wake', {
    callback: () => {
      log('WAKE: received wake signal, triggering immediate poll');
      if (wakeResolve) { wakeResolve(); wakeResolve = null; }
    },
  });

  // Dispatch loop (polls active-tasks.md)
  while (running) {
    try {
      // Only dispatch if no active tasks in the mesh from this bridge
      if (dispatched.size === 0) {
        const task = findDispatchable();
        if (task) {
          await dispatchTask(task);
          consecutiveSubmitFailures = 0; // reset on success
        }
      }

      // Defensive: check tracked tasks still have execution:mesh in the kanban.
      // MC's syncTasksToMarkdown can silently strip mesh fields if the DB schema
      // doesn't have mesh columns yet. Detect this immediately, not at restart.
      if (dispatched.size > 0) {
        try {
          const allTasks = readTasks(ACTIVE_TASKS_PATH);
          for (const taskId of dispatched) {
            const card = allTasks.find(t => t.task_id === taskId);
            if (card && !card.execution) {
              log(`FIELD-STRIP DETECTED: ${taskId} lost execution:mesh — likely MC write-back. Card owner=${card.owner}, status=${card.status}. Mesh fields may need manual restore.`);
            }
          }
        } catch { /* read failure already logged by findDispatchable */ }
      }
    } catch (err) {
      consecutiveSubmitFailures++;
      log(`DISPATCH ERROR (${consecutiveSubmitFailures}/${MAX_SUBMIT_FAILURES}): ${err.message}`);

      if (consecutiveSubmitFailures >= MAX_SUBMIT_FAILURES) {
        // Find the task we were trying to dispatch and mark it blocked
        const failedTask = findDispatchable();
        if (failedTask) {
          log(`BLOCKING: ${failedTask.task_id} after ${MAX_SUBMIT_FAILURES} consecutive submit failures`);
          try {
            updateTaskInPlace(ACTIVE_TASKS_PATH, failedTask.task_id, {
              status: 'blocked',
              next_action: `Mesh submit failed ${MAX_SUBMIT_FAILURES}x — check NATS connectivity`,
              updated_at: isoTimestamp(),
            });
          } catch (e) {
            log(`ERROR marking task blocked: ${e.message}`);
          }
        }
        consecutiveSubmitFailures = 0;
      }
    }

    // Sleep until next poll OR wake signal, whichever comes first
    await Promise.race([
      new Promise(r => setTimeout(r, DISPATCH_INTERVAL)),
      new Promise(r => { wakeResolve = r; }),
    ]);
    wakeResolve = null;
  }

  clearInterval(stalenessTimer);
  wakeSub.unsubscribe();
  sub.unsubscribe();
  await nc.drain();
  log('Bridge stopped.');
}

// ── Shutdown ────────────────────────────────────────

process.on('SIGINT', () => { running = false; log('SIGINT received...'); });
process.on('SIGTERM', () => { running = false; log('SIGTERM received...'); });

main().catch(err => {
  console.error(`[mesh-bridge] Fatal: ${err.message}`);
  process.exit(1);
});
