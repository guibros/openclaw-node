#!/usr/bin/env node

/**
 * mesh-agent.js — Mesh worker agent for OpenClaw.
 *
 * Option A architecture: external wrapper around Claude Code CLI.
 * The outer loop is mechanical Node.js code. The inner loop is the LLM.
 * The LLM has no awareness of the mesh — it gets a clean task prompt.
 *
 * Flow:
 *   1. Connect to NATS
 *   2. Claim next available task from mesh-task-daemon
 *   3. Construct prompt from task schema
 *   4. Run `claude -p` (non-interactive)
 *   5. Evaluate metric (if defined)
 *   6. If metric fails → log attempt, retry with failure context
 *   7. If metric passes or no metric → report completion
 *   8. If budget exhausted → report failure
 *   9. Loop back to step 2
 *
 * The Karpathy pattern: try → measure → keep/discard → retry.
 * The outer loop is deterministic. The LLM owns the problem-solving.
 *
 * Usage:
 *   node mesh-agent.js                    # run worker
 *   node mesh-agent.js --once             # claim one task, execute, exit
 *   node mesh-agent.js --model sonnet     # override model
 *   node mesh-agent.js --dry-run          # claim + build prompt, don't execute
 */

const { connect, StringCodec } = require('nats');
const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { getActivityState, getSessionInfo } = require('../lib/agent-activity');

const sc = StringCodec();
const { NATS_URL } = require('../lib/nats-resolve');
const NODE_ID = process.env.MESH_NODE_ID || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
const POLL_INTERVAL = parseInt(process.env.MESH_POLL_INTERVAL || '15000'); // 15s between polls
const MAX_ATTEMPTS = parseInt(process.env.MESH_MAX_ATTEMPTS || '3');
const HEARTBEAT_INTERVAL = parseInt(process.env.MESH_HEARTBEAT_INTERVAL || '60000'); // 60s heartbeat
const CLAUDE_PATH = process.env.CLAUDE_PATH || '/usr/local/bin/claude';
const WORKSPACE = process.env.MESH_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const DRY_RUN = args.includes('--dry-run');
const MODEL = (() => {
  const idx = args.indexOf('--model');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : 'sonnet';
})();

let nc;
let running = true;
let currentTaskId = null; // tracks active task for alive-check responses

// ── Agent State File (read by mesh-health-publisher) ──
const AGENT_STATE_PATH = path.join(os.homedir(), '.openclaw', '.tmp', 'agent-state.json');

function writeAgentState(status, taskId) {
  try {
    fs.writeFileSync(AGENT_STATE_PATH, JSON.stringify({
      status, taskId: taskId || null,
      llm: status === 'working' ? 'claude' : null,
      model: status === 'working' ? MODEL : null,
    }));
  } catch { /* best-effort */ }
}

// ── Logging ───────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [mesh-agent:${NODE_ID}] ${msg}`);
}

// ── NATS Helpers ──────────────────────────────────────

async function natsRequest(subject, payload, timeoutMs = 10000) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: timeoutMs });
  const response = JSON.parse(sc.decode(msg.data));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// ── Prompt Construction ───────────────────────────────

/**
 * Build the initial prompt from a task.
 * The LLM gets: what to do, what files to touch, how to verify success.
 * It does NOT get: NATS subjects, mesh protocol, budget deadlines.
 */
function buildInitialPrompt(task) {
  const parts = [];

  parts.push(`# Task: ${task.title}`);
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  if (task.success_criteria.length > 0) {
    parts.push('## Success Criteria');
    for (const c of task.success_criteria) {
      parts.push(`- ${c}`);
    }
    parts.push('');
  }

  if (task.metric) {
    parts.push(`## Verification`);
    parts.push(`Run this command to check your work: \`${task.metric}\``);
    parts.push(`Your changes are only accepted if this command exits with code 0.`);
    parts.push('');
  }

  if (task.scope.length > 0) {
    parts.push('## Scope');
    parts.push('Only modify these files/paths:');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  parts.push('## Instructions');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes. Do not add scope beyond what is asked.');
  parts.push('- If you hit a blocker you cannot resolve, explain what is blocking you clearly.');
  if (task.metric) {
    parts.push(`- After making changes, run \`${task.metric}\` to verify.`);
    parts.push('- If verification fails, analyze the failure and iterate on your approach.');
  }

  return parts.join('\n');
}

/**
 * Build a retry prompt after a failed attempt.
 * Includes: what was tried, why it failed, what to try differently.
 */
function buildRetryPrompt(task, previousAttempts, attemptNumber) {
  const parts = [];

  parts.push(`# Task: ${task.title} (Attempt ${attemptNumber}/${MAX_ATTEMPTS})`);
  parts.push('');
  parts.push('Previous attempts have not passed verification. Review what was tried and take a different approach.');
  if (attemptNumber >= 3) {
    parts.push('');
    parts.push('**This is attempt 3+. Previous approaches did not work. Try a fundamentally different strategy.**');
    parts.push('Do not iterate on the same idea — rethink the problem from scratch.');
  }
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  parts.push('## Previous Attempts');
  for (let i = 0; i < previousAttempts.length; i++) {
    const a = previousAttempts[i];
    parts.push(`### Attempt ${i + 1}`);
    parts.push(`- Approach: ${a.approach || 'unknown'}`);
    parts.push(`- Result: ${a.result || 'unknown'}`);
    parts.push(`- Kept: ${a.keep ? 'yes' : 'no (reverted)'}`);
    parts.push('');
  }

  if (task.metric) {
    parts.push(`## Verification`);
    parts.push(`Run: \`${task.metric}\``);
    parts.push(`Must exit code 0.`);
    parts.push('');
  }

  if (task.scope.length > 0) {
    parts.push('## Scope');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  parts.push('## Instructions');
  parts.push('- Do NOT repeat a failed approach. Try something different.');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes.');
  if (task.metric) {
    parts.push(`- Run \`${task.metric}\` to verify before finishing.`);
  }

  return parts.join('\n');
}

// ── Worktree Isolation ────────────────────────────────

const WORKTREE_BASE = process.env.MESH_WORKTREE_BASE || path.join(process.env.HOME, '.openclaw', 'worktrees');

/**
 * Create a git worktree for a task. Returns the worktree path.
 * Each task gets an isolated branch and working directory.
 * On failure, returns null (falls back to shared workspace).
 */
function createWorktree(taskId) {
  const worktreePath = path.join(WORKTREE_BASE, taskId);
  const branch = `mesh/${taskId}`;

  try {
    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    // Clean up stale worktree if it exists from a previous crashed attempt
    if (fs.existsSync(worktreePath)) {
      log(`Cleaning stale worktree: ${worktreePath}`);
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: WORKSPACE, timeout: 10000 });
      } catch {
        // If git worktree remove fails, manually clean up
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      // Also clean up the branch if it exists
      try {
        execSync(`git branch -D "${branch}"`, { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
      } catch { /* branch may not exist */ }
    }

    // Create new worktree branched off HEAD
    execSync(`git worktree add -b "${branch}" "${worktreePath}" HEAD`, {
      cwd: WORKSPACE,
      timeout: 30000,
      stdio: 'pipe',
    });

    log(`Worktree created: ${worktreePath} (branch: ${branch})`);
    return worktreePath;
  } catch (err) {
    log(`WORKTREE FAILED: ${err.message} — falling back to shared workspace`);
    return null;
  }
}

/**
 * Clean up a worktree after task completion or failure.
 * @param {string} worktreePath
 * @param {boolean} keep - If true, leave the branch for manual review
 */
/**
 * Commit any changes in the worktree and merge to main.
 * Returns { committed, merged, sha } or null if nothing to commit.
 */
function commitAndMergeWorktree(worktreePath, taskId, summary) {
  if (!worktreePath) return null;
  const branch = `mesh/${taskId}`;

  try {
    // Check for changes
    const status = execSync('git status --porcelain', {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();

    if (!status) {
      log(`Worktree has no changes to commit (${taskId})`);
      return null;
    }

    // Stage and commit all changes
    execSync('git add -A', { cwd: worktreePath, timeout: 10000, stdio: 'pipe' });
    const commitMsg = `mesh(${taskId}): ${(summary || 'task completed').slice(0, 72)}`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath, timeout: 10000, stdio: 'pipe',
    });

    const sha = execSync('git rev-parse --short HEAD', {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();

    log(`Committed ${sha} on ${branch}: ${commitMsg}`);

    // Merge into main (from workspace)
    try {
      execSync(`git merge --no-ff "${branch}" -m "Merge ${branch}: ${taskId}"`, {
        cwd: WORKSPACE, timeout: 30000, stdio: 'pipe',
      });
      log(`Merged ${branch} into main`);
      return { committed: true, merged: true, sha };
    } catch (mergeErr) {
      // Merge conflict — abort and keep branch for human resolution
      execSync('git merge --abort', { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
      log(`MERGE CONFLICT on ${branch} — branch kept for manual resolution`);
      return { committed: true, merged: false, sha };
    }
  } catch (err) {
    log(`Commit/merge warning: ${err.message}`);
    return null;
  }
}

/**
 * Clean up a worktree after task completion or failure.
 * @param {string} worktreePath
 * @param {boolean} keep - If true, leave the branch for manual review
 */
function cleanupWorktree(worktreePath, keep = false) {
  if (!worktreePath || !worktreePath.startsWith(WORKTREE_BASE)) return;

  const taskId = path.basename(worktreePath);
  const branch = `mesh/${taskId}`;

  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: WORKSPACE,
      timeout: 10000,
      stdio: 'pipe',
    });
    if (!keep) {
      execSync(`git branch -D "${branch}"`, {
        cwd: WORKSPACE,
        timeout: 5000,
        stdio: 'ignore',
      });
    }
    log(`Worktree cleaned: ${worktreePath} (branch ${keep ? 'kept' : 'deleted'})`);
  } catch (err) {
    log(`Worktree cleanup warning: ${err.message}`);
  }
}

// ── Claude Execution ──────────────────────────────────

/**
 * Run Claude Code CLI with a prompt. Returns { exitCode, stdout, stderr, cwd }.
 * Sends heartbeats to the daemon every HEARTBEAT_INTERVAL to prevent stall detection.
 *
 * @param {string} prompt
 * @param {object} task
 * @param {string|null} worktreePath - If set, Claude accesses this worktree instead of WORKSPACE
 */
function runClaude(prompt, task, worktreePath) {
  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      '--output-format', 'text',
      '--model', MODEL,
      '--permission-mode', 'bypassPermissions',
      // SECURITY NOTE: bypassPermissions is intentional for mesh agents.
      // Tasks run in isolated worktrees with no interactive terminal.
      // The agent needs autonomous execution without permission prompts.
      // Safety is enforced at the mesh level: budget limits, scope restrictions,
      // and human review of all results before merge to main.
      // Note: --no-session-persistence removed to enable JSONL activity tracking
      // Claude writes session files to ~/.claude/projects/{encoded-cwd}/
      // which agent-activity.js reads for cost, summary, and activity state
    ];

    // Use worktree if available, otherwise fall back to workspace
    const targetDir = worktreePath || WORKSPACE;
    args.push('--add-dir', targetDir);

    // When using a worktree, also give read access to the workspace
    // (scope files may be untracked and absent from worktree)
    if (worktreePath) {
      args.push('--add-dir', WORKSPACE);
    }

    // Add scope directories if specified (with path traversal validation)
    if (task.scope.length > 0) {
      const addedDirs = new Set([targetDir, WORKSPACE]);
      for (const s of task.scope) {
        // Resolve against both workspace and worktree
        for (const base of [targetDir, WORKSPACE]) {
          const resolved = path.resolve(base, s);
          const resolvedDir = path.dirname(resolved);
          if (!resolved.startsWith(base) && !resolved.startsWith('/tmp/')) continue;
          if (addedDirs.has(resolvedDir)) continue;
          addedDirs.add(resolvedDir);
          args.push('--add-dir', resolvedDir);
        }
      }
    }

    log(`Spawning: claude ${args.slice(0, 6).join(' ')} ... (target: ${worktreePath ? 'worktree' : 'workspace'})`);

    // Use a clean temp directory as cwd to avoid loading workspace CLAUDE.md
    // (which triggers the full Daedalus boot sequence and eats the entire budget)
    const cleanCwd = path.join(os.tmpdir(), 'mesh-agent-work');
    if (!fs.existsSync(cleanCwd)) fs.mkdirSync(cleanCwd, { recursive: true });

    // Strip CLAUDECODE env var to allow nested sessions
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const child = spawn(CLAUDE_PATH, args, {
      cwd: cleanCwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin must be 'ignore' — 'pipe' causes Claude to block
      timeout: (task.budget_minutes || 30) * 60 * 1000, // kill if exceeds budget
    });

    // Heartbeat: signal daemon with JSONL-enriched activity state
    const heartbeatTimer = setInterval(async () => {
      try {
        // Read Claude's JSONL session file for real activity state (zero token cost)
        // KNOWN LIMITATION: If Claude transitions working→ready→working within one
        // heartbeat interval (60s), the ready state is missed. Acceptable for V1
        // (used for visibility only, not triggering reactions). Revisit if reactions
        // depend on seeing transient states.
        const activity = await getActivityState(cleanCwd);
        const payload = { task_id: task.task_id };
        if (activity) {
          payload.activity_state = activity.state; // starting|active|ready|idle|waiting_input|blocked
          payload.activity_timestamp = activity.timestamp?.toISOString();
        }
        await natsRequest('mesh.tasks.heartbeat', payload);
      } catch {
        // fire-and-forget, don't crash on NATS hiccup or JSONL read failure
      }
    }, HEARTBEAT_INTERVAL);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearInterval(heartbeatTimer);
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });
  });
}

// ── Metric Evaluation ─────────────────────────────────

/**
 * Run the task's metric command. Returns { passed, output }.
 */
function evaluateMetric(metric, cwd) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', metric], {
      cwd: cwd || WORKSPACE,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000, // 60s max for metric evaluation
    });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });

    child.on('close', (code) => {
      resolve({ passed: code === 0, output: output.slice(-2000) }); // last 2K chars
    });

    child.on('error', (err) => {
      resolve({ passed: false, output: err.message });
    });
  });
}

// ── Task Execution ────────────────────────────────────

/**
 * Execute a task with the Karpathy iteration pattern.
 * Try → measure → keep/discard → retry.
 */
async function executeTask(task) {
  log(`EXECUTING: ${task.task_id} "${task.title}" (budget: ${task.budget_minutes}m, metric: ${task.metric || 'none'}, max attempts: ${MAX_ATTEMPTS})`);

  // Create isolated worktree for this task (falls back to shared workspace on failure)
  const worktreePath = createWorktree(task.task_id);
  const taskDir = worktreePath || WORKSPACE;

  // Signal start
  await natsRequest('mesh.tasks.start', { task_id: task.task_id });
  writeAgentState('working', task.task_id);
  log(`Started: ${task.task_id} (dir: ${worktreePath ? 'worktree' : 'workspace'})`);

  const attempts = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Check budget before each attempt
    const budgetDeadline = new Date(task.budget_deadline);
    const remaining = (budgetDeadline - Date.now()) / 60000;
    if (remaining <= 0) {
      log(`Budget exhausted before attempt ${attempt}`);
      break;
    }
    log(`Attempt ${attempt}/${MAX_ATTEMPTS} (${remaining.toFixed(1)}m remaining)`);

    // Build prompt — attempt number injected as discrete integer for strategy branching
    const prompt = attempt === 1
      ? buildInitialPrompt(task)
      : buildRetryPrompt(task, attempts, attempt);

    if (DRY_RUN) {
      log(`[DRY RUN] Prompt:\n${prompt}`);
      return;
    }

    // Run Claude (with worktree isolation if available)
    const claudeResult = await runClaude(prompt, task, worktreePath);
    const summary = claudeResult.stdout.slice(-500) || '(no output)';

    log(`Claude exited with code ${claudeResult.exitCode}`);

    // Extract cost + summary from JSONL session file (zero-cost observability)
    const cleanCwd = path.join(os.tmpdir(), 'mesh-agent-work');
    const sessionInfo = await getSessionInfo(cleanCwd).catch(() => null);
    if (sessionInfo?.cost) {
      log(`Cost: $${sessionInfo.cost.estimatedCostUsd.toFixed(4)} (${sessionInfo.cost.inputTokens} in / ${sessionInfo.cost.outputTokens} out)`);
    }

    if (claudeResult.exitCode !== 0) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: Claude exited with error (code ${claudeResult.exitCode})`,
        result: claudeResult.stderr.slice(-500) || 'unknown error',
        keep: false,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });

      // Two-tier retry: abnormal exit → exponential backoff (agent crash, OOM, etc.)
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 1s, 2s, 4s... max 30s
      log(`Attempt ${attempt} failed (Claude error, code ${claudeResult.exitCode}). Backoff ${backoffMs}ms before retry.`);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    // If no metric, trust Claude's output and complete
    if (!task.metric) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: executed without metric`,
        result: summary,
        keep: true,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });

      // Commit changes and merge to main before cleanup
      const mergeResult = commitAndMergeWorktree(worktreePath, task.task_id, summary);
      const keepBranch = mergeResult && !mergeResult.merged; // keep on merge conflict

      await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        result: {
          success: true, summary, artifacts: [],
          cost: sessionInfo?.cost || null,
          sha: mergeResult?.sha || null,
          merged: mergeResult?.merged ?? null,
        },
      });
      cleanupWorktree(worktreePath, keepBranch);
      writeAgentState('idle', null);
      log(`COMPLETED: ${task.task_id} (no metric, attempt ${attempt})`);
      return;
    }

    // Evaluate metric (run in worktree if available)
    log(`Evaluating metric: ${task.metric} (in ${worktreePath ? 'worktree' : 'workspace'})`);
    const metricResult = await evaluateMetric(task.metric, taskDir);

    if (metricResult.passed) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: metric passed`,
        result: metricResult.output.slice(-300),
        keep: true,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });

      // Commit changes and merge to main before cleanup
      const mergeResult = commitAndMergeWorktree(worktreePath, task.task_id, summary);
      const keepBranch = mergeResult && !mergeResult.merged;

      await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        result: {
          success: true,
          summary: `Metric passed on attempt ${attempt}. ${summary.slice(0, 200)}`,
          artifacts: [],
          cost: sessionInfo?.cost || null,
          sha: mergeResult?.sha || null,
          merged: mergeResult?.merged ?? null,
        },
      });
      cleanupWorktree(worktreePath, keepBranch);
      writeAgentState('idle', null);
      log(`COMPLETED: ${task.task_id} (metric passed, attempt ${attempt})`);
      return;
    }

    // Metric failed — log attempt, quick continuation (normal exit, just didn't pass)
    const attemptRecord = {
      approach: `Attempt ${attempt}: metric failed`,
      result: metricResult.output.slice(-500),
      keep: false,
    };
    attempts.push(attemptRecord);
    await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });
    log(`Attempt ${attempt}: metric failed. Quick retry (1s). Output: ${metricResult.output.slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 1000)); // two-tier: normal exit → 1s continuation
  }

  // All attempts exhausted or budget exceeded → RELEASE (not fail)
  // "Released" = automation tried everything, human must triage.
  // "Failed" = a single attempt failed (used by daemon for budget/stall).
  // Commit whatever partial work exists — preserve for post-mortem
  const partialResult = commitAndMergeWorktree(worktreePath, task.task_id, 'partial: released after exhausting attempts');

  const reason = `Exhausted ${attempts.length}/${MAX_ATTEMPTS} attempts. Last: ${attempts[attempts.length - 1]?.result?.slice(0, 200) || 'unknown'}`;
  await natsRequest('mesh.tasks.release', {
    task_id: task.task_id,
    reason,
    attempts,
  });
  // Keep worktree branch on release for post-mortem debugging (don't merge partial work)
  cleanupWorktree(worktreePath, true);
  writeAgentState('idle', null);
  log(`RELEASED: ${task.task_id} — ${reason}`);
}

// ── Main Loop ─────────────────────────────────────────

async function main() {
  log(`Starting mesh agent worker`);
  log(`  Node ID:     ${NODE_ID}`);
  log(`  NATS:        ${NATS_URL}`);
  log(`  Model:       ${MODEL}`);
  log(`  Workspace:   ${WORKSPACE}`);
  log(`  Max attempts: ${MAX_ATTEMPTS}`);
  log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`  Mode:        ${ONCE ? 'single task' : 'continuous'} ${DRY_RUN ? '(dry run)' : ''}`);

  nc = await connect({ servers: NATS_URL, timeout: 5000 });
  log(`Connected to NATS`);

  // Subscribe to alive-check requests from the daemon's stall detector
  const aliveSub = nc.subscribe(`mesh.agent.${NODE_ID}.alive`);
  (async () => {
    for await (const msg of aliveSub) {
      try {
        const { task_id } = JSON.parse(sc.decode(msg.data));
        const alive = currentTaskId != null && (task_id === currentTaskId || !task_id);
        msg.respond(sc.encode(JSON.stringify({ alive, task_id: currentTaskId })));
        log(`ALIVE CHECK: responded ${alive} (asked about ${task_id}, working on ${currentTaskId})`);
      } catch {
        msg.respond(sc.encode(JSON.stringify({ alive: currentTaskId != null, task_id: currentTaskId })));
      }
    }
  })();
  log(`  Listening: mesh.agent.${NODE_ID}.alive`);

  while (running) {
    try {
      // Claim next available task (longer timeout — KV operations on remote NATS can be slow)
      const task = await natsRequest('mesh.tasks.claim', { node_id: NODE_ID }, 60000);

      if (!task) {
        if (ONCE) {
          log('No tasks available. Exiting (--once mode).');
          break;
        }
        // Wait and retry
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }

      log(`CLAIMED: ${task.task_id} "${task.title}"`);

      // Execute the task
      currentTaskId = task.task_id;
      await executeTask(task);
      currentTaskId = null;

    } catch (err) {
      log(`ERROR: ${err.message}`);
      // Don't crash the loop — wait and retry
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    if (ONCE) break;
  }

  aliveSub.unsubscribe();
  await nc.drain();
  log('Agent worker stopped.');
}

// ── Shutdown ──────────────────────────────────────────

process.on('SIGINT', () => { running = false; log('Received SIGINT, finishing current task...'); });
process.on('SIGTERM', () => { running = false; log('Received SIGTERM, finishing current task...'); });

main().catch(err => {
  console.error(`[mesh-agent] Fatal: ${err.message}`);
  process.exit(1);
});
