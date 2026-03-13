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
const os = require('os');

const sc = StringCodec();
const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const BUDGET_CHECK_INTERVAL = 30000; // 30s
const STALL_MINUTES = parseInt(process.env.MESH_STALL_MINUTES || '5'); // no heartbeat for this long → stalled
const NODE_ID = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');

let nc, store;

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
  respond(msg, task);
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

  const task = await store.markCompleted(task_id, result || { success: true });
  if (!task) return respondError(msg, `Task ${task_id} not found`);

  const elapsed = task.started_at
    ? ((new Date(task.completed_at) - new Date(task.started_at)) / 60000).toFixed(1)
    : '?';

  log(`COMPLETE ${task_id} in ${elapsed}m: ${result?.summary || 'no summary'}`);
  publishEvent('completed', task);
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
  respond(msg, task);
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
  // Return null (not error) for missing tasks so callers can distinguish
  // "not found" from actual errors (used by bridge reconciliation)
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
  respond(msg, task);
}

/**
 * mesh.tasks.cancel — Cancel a task.
 * Expects: { task_id, reason? }
 */
async function handleCancel(msg) {
  const { task_id, reason } = parseRequest(msg);
  if (!task_id) return respondError(msg, 'task_id is required');

  // Use CAS to prevent race between cancel and claim
  const result = await store.get(task_id, { withRevision: true });
  if (!result) return respondError(msg, `Task ${task_id} not found`);

  const task = result.task;
  task.status = TASK_STATUS.CANCELLED;
  task.completed_at = new Date().toISOString();
  task.result = { success: false, summary: reason || 'cancelled' };

  try {
    await store.kv.update(task_id, sc.encode(JSON.stringify(task)), result.revision);
  } catch (err) {
    return respondError(msg, `Cancel conflict — task ${task_id} was modified concurrently. Retry.`);
  }

  log(`CANCEL ${task_id}: ${reason || 'no reason'}`);
  publishEvent('cancelled', task);
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

    const releasedTask = await store.markReleased(
      task.task_id,
      `Stall detected: no agent heartbeat for ${silentMin}m, alive check failed`,
      task.attempts
    );
    if (releasedTask) publishEvent('released', releasedTask);

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

    // Publish notification so the agent knows
    nc.publish(`mesh.agent.${task.owner}.budget_exceeded`, sc.encode(JSON.stringify({
      task_id: task.task_id,
      elapsed_minutes: parseFloat(elapsed),
      budget_minutes: task.budget_minutes,
    })));
  }
}

// ── Main ────────────────────────────────────────────

async function main() {
  log('Starting mesh task daemon...');

  nc = await connect(natsConnectOpts({ timeout: 5000, reconnect: true, maxReconnectAttempts: -1, reconnectTimeWait: 5000 }));
  log(`Connected to NATS at ${NATS_URL}`);

  // Initialize task store
  const js = nc.jetstream();
  const kv = await js.views.kv(KV_BUCKET);
  store = new TaskStore(kv);
  log(`Task store initialized (bucket: ${KV_BUCKET})`);

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
          log(`ERROR handling ${subject}: ${err.message}`);
          try { respondError(msg, err.message); } catch {}
        }
      }
    })();
    log(`  Listening: ${subject}`);
  }

  // Start enforcement loops
  const budgetTimer = setInterval(enforceBudgets, BUDGET_CHECK_INTERVAL);
  const stallTimer = setInterval(detectStalls, BUDGET_CHECK_INTERVAL);
  log(`Budget enforcement: every ${BUDGET_CHECK_INTERVAL / 1000}s`);
  log(`Stall detection: every ${BUDGET_CHECK_INTERVAL / 1000}s (threshold: ${STALL_MINUTES}m)`);


  log('Task daemon ready.');

  // Shutdown handler
  const shutdown = async () => {
    log('Shutting down...');
    clearInterval(budgetTimer);
    clearInterval(stallTimer);
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
