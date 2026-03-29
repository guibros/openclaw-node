#!/usr/bin/env node

/**
 * mesh-agent.js — Mesh worker agent for OpenClaw.
 *
 * LLM-agnostic architecture: external wrapper around any LLM CLI.
 * The outer loop is mechanical Node.js code. The inner loop is the LLM.
 * The LLM has no awareness of the mesh — it gets a clean task prompt.
 *
 * Supported LLM backends (via lib/llm-providers.js):
 *   claude  — Anthropic Claude Code CLI
 *   openai  — OpenAI Codex/GPT CLI
 *   shell   — Raw shell execution (no LLM)
 *   (custom providers can be registered at runtime)
 *
 * Flow:
 *   1. Connect to NATS
 *   2. Claim next available task from mesh-task-daemon
 *   3. Construct prompt from task schema
 *   4. Run LLM CLI (non-interactive)
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
 *   node mesh-agent.js                        # run worker (default provider)
 *   node mesh-agent.js --once                 # claim one task, execute, exit
 *   node mesh-agent.js --model sonnet         # override model
 *   node mesh-agent.js --provider openai      # use OpenAI backend
 *   node mesh-agent.js --dry-run              # claim + build prompt, don't execute
 */

const { connect, StringCodec } = require('nats');
const { spawn, execSync, execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { getActivityState, getSessionInfo } = require('../lib/agent-activity');
const { loadAllRules, matchRules, formatRulesForPrompt, detectFrameworks, activateFrameworkRules } = require('../lib/rule-loader');
const { loadHarnessRules, runMeshHarness, runPostCommitValidation, formatHarnessForPrompt } = require('../lib/mesh-harness');
const { findRole, formatRoleForPrompt } = require('../lib/role-loader');

const sc = StringCodec();
const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const { resolveProvider, resolveModel } = require('../lib/llm-providers');
const NODE_ID = process.env.MESH_NODE_ID || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
const POLL_INTERVAL = parseInt(process.env.MESH_POLL_INTERVAL || '15000'); // 15s between polls
const MAX_ATTEMPTS = parseInt(process.env.MESH_MAX_ATTEMPTS || '3');
const HEARTBEAT_INTERVAL = parseInt(process.env.MESH_HEARTBEAT_INTERVAL || '60000'); // 60s heartbeat
const WORKSPACE = process.env.MESH_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');

// ── Rule loading (cached at startup, framework-filtered) ─────────────────
const RULES_DIR = process.env.OPENCLAW_RULES_DIR || path.join(process.env.HOME, '.openclaw', 'rules');
const HARNESS_PATH = process.env.OPENCLAW_HARNESS_RULES || path.join(process.env.HOME, '.openclaw', 'harness-rules.json');
let cachedRules = null;
let cachedHarnessRules = null;

function getRules() {
  if (!cachedRules) {
    const allRules = loadAllRules(RULES_DIR);
    const detected = detectFrameworks(WORKSPACE);
    cachedRules = activateFrameworkRules(allRules, detected);
  }
  return cachedRules;
}

function getHarnessRules() {
  if (!cachedHarnessRules) {
    cachedHarnessRules = loadHarnessRules(HARNESS_PATH, 'mesh');
  }
  return cachedHarnessRules;
}

/**
 * Inject matching coding rules into a prompt parts array based on task scope.
 */
function injectRules(parts, scope) {
  // Path-scoped coding standards
  const matched = matchRules(getRules(), scope || []);
  if (matched.length > 0) {
    parts.push(formatRulesForPrompt(matched));
    parts.push('');
  }

  // Harness behavioral rules (soft enforcement — LLM-agnostic prompt injection)
  const harnessText = formatHarnessForPrompt(getHarnessRules());
  if (harnessText) {
    parts.push(harnessText);
    parts.push('');
  }
}

// ── Role loading (cached per role ID) ─────────────────
const ROLE_DIRS = [
  path.join(process.env.HOME, '.openclaw', 'roles'),
  path.join(__dirname, '..', 'config', 'roles'),
];
const roleCache = new Map();

function getRole(roleId) {
  if (!roleId) return null;
  if (roleCache.has(roleId)) return roleCache.get(roleId);
  const role = findRole(roleId, ROLE_DIRS);
  if (role) roleCache.set(roleId, role);
  return role;
}

/**
 * Inject role profile into prompt parts array.
 */
function injectRole(parts, roleId) {
  const role = getRole(roleId);
  if (!role) return;
  const roleText = formatRoleForPrompt(role);
  if (roleText) {
    parts.push(roleText);
    parts.push('');
  }
}

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const DRY_RUN = args.includes('--dry-run');
const CLI_MODEL = (() => {
  const idx = args.indexOf('--model');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();
const CLI_PROVIDER = (() => {
  const idx = args.indexOf('--provider');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();
const ENV_PROVIDER = process.env.MESH_LLM_PROVIDER || null;

let nc;
let running = true;
let currentTaskId = null; // tracks active task for alive-check responses

// ── Agent State File (read by mesh-health-publisher) ──
const AGENT_STATE_PATH = path.join(os.homedir(), '.openclaw', '.tmp', 'agent-state.json');

function writeAgentState(status, taskId, provider, model) {
  try {
    fs.writeFileSync(AGENT_STATE_PATH, JSON.stringify({
      status, taskId: taskId || null,
      llm: status === 'working' ? (provider || 'unknown') : null,
      model: status === 'working' ? (model || null) : null,
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

  if (task.success_criteria && task.success_criteria.length > 0) {
    parts.push('## Success Criteria');
    for (const c of task.success_criteria) {
      parts.push(`- ${c}`);
    }
    parts.push('');
  }

  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`## Verification`);
    parts.push(`Run this command to check your work: \`${safeMetric}\``);
    parts.push(`Your changes are only accepted if this command exits with code 0.`);
    parts.push('');
  }

  if (task.scope && task.scope.length > 0) {
    parts.push('## Scope');
    parts.push('Only modify these files/paths:');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  // Inject path-scoped coding rules matching task scope
  injectRules(parts, task.scope);

  // Inject role profile (responsibilities, boundaries, framework)
  injectRole(parts, task.role);

  parts.push('## Instructions');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes. Do not add scope beyond what is asked.');
  parts.push('- If you hit a blocker you cannot resolve, explain what is blocking you clearly.');
  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`- After making changes, run \`${safeMetric}\` to verify.`);
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
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`## Verification`);
    parts.push(`Run: \`${safeMetric}\``);
    parts.push(`Must exit code 0.`);
    parts.push('');
  }

  if (task.scope && task.scope.length > 0) {
    parts.push('## Scope');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  // Inject path-scoped coding rules matching task scope
  injectRules(parts, task.scope);

  // Inject role profile (responsibilities, boundaries, framework)
  injectRole(parts, task.role);

  parts.push('## Instructions');
  parts.push('- Do NOT repeat a failed approach. Try something different.');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes.');
  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`- Run \`${safeMetric}\` to verify before finishing.`);
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
  if (!/^[\w][\w.-]{0,127}$/.test(taskId)) {
    throw new Error(`Invalid taskId: contains unsafe characters`);
  }
  const worktreePath = path.join(WORKTREE_BASE, taskId);
  const branch = `mesh/${taskId}`;

  try {
    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    // Clean up stale worktree if it exists from a previous crashed attempt
    if (fs.existsSync(worktreePath)) {
      log(`Cleaning stale worktree: ${worktreePath}`);
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: WORKSPACE, timeout: 10000 });
      } catch {
        // If git worktree remove fails, manually clean up
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      // Also clean up the branch if it exists
      try {
        execFileSync('git', ['branch', '-D', branch], { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
      } catch { /* branch may not exist */ }
    }

    // Create new worktree branched off HEAD
    execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
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

    // Pre-commit validation: check conventional commit format before committing
    const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert|mesh)(\(.+\))?: .+/;
    if (!conventionalPattern.test(commitMsg)) {
      log(`WARNING: commit message doesn't follow conventional format: "${commitMsg}"`);
    }

    execFileSync('git', ['commit', '-m', commitMsg], {
      cwd: worktreePath, timeout: 10000, stdio: 'pipe',
    });

    const sha = execSync('git rev-parse --short HEAD', {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();

    log(`Committed ${sha} on ${branch}: ${commitMsg}`);

    // Merge into main (from workspace).
    // Parallel collab: multiple nodes may merge concurrently. If the first attempt
    // fails (e.g., another node merged first), retry once after pulling.
    const mergeMsg = `Merge ${branch}: ${taskId}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        execFileSync('git', ['merge', '--no-ff', branch, '-m', mergeMsg], {
          cwd: WORKSPACE, timeout: 30000, stdio: 'pipe',
        });
        log(`Merged ${branch} into main${attempt > 0 ? ' (retry succeeded)' : ''}`);
        return { committed: true, merged: true, sha };
      } catch (mergeErr) {
        execSync('git merge --abort', { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
        if (attempt === 0) {
          // First failure: pull and retry (handles race with parallel merge)
          try {
            log(`Merge attempt 1 failed for ${branch} — fast-forward pulling and retrying`);
            execSync('git pull --ff-only', { cwd: WORKSPACE, timeout: 15000, stdio: 'pipe' });
          } catch { /* best effort pull */ }
        } else {
          // Second failure: real conflict — keep branch for human resolution
          log(`MERGE CONFLICT on ${branch} — branch kept for manual resolution`);
          return { committed: true, merged: false, sha, conflict: true };
        }
      }
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
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: WORKSPACE,
      timeout: 10000,
      stdio: 'pipe',
    });
    if (!keep) {
      execFileSync('git', ['branch', '-D', branch], {
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

// ── LLM Execution ────────────────────────────────────

/**
 * Run an LLM CLI with a prompt. Returns { exitCode, stdout, stderr, provider, model }.
 * LLM-agnostic: provider is resolved per-task from task.llm_provider, env, or CLI flag.
 * Sends heartbeats to the daemon every HEARTBEAT_INTERVAL to prevent stall detection.
 *
 * @param {string} prompt
 * @param {object} task
 * @param {string|null} worktreePath - If set, LLM accesses this worktree instead of WORKSPACE
 */
function runLLM(prompt, task, worktreePath) {
  return new Promise((resolve) => {
    const provider = resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER);
    const model = resolveModel(task, CLI_MODEL, provider);

    const targetDir = worktreePath || WORKSPACE;
    const llmArgs = provider.buildArgs(prompt, model, task, targetDir, WORKSPACE);

    log(`Spawning [${provider.name}]: ${provider.binary} ${llmArgs.slice(0, 6).join(' ')} ... (target: ${worktreePath ? 'worktree' : 'workspace'})`);

    // Use a clean temp directory as cwd to avoid loading workspace config files
    const cleanCwd = path.join(os.tmpdir(), 'mesh-agent-work');
    if (!fs.existsSync(cleanCwd)) fs.mkdirSync(cleanCwd, { recursive: true });

    const cleanEnv = provider.cleanEnv(process.env);

    const child = spawn(provider.binary, llmArgs, {
      cwd: cleanCwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin must be 'ignore' — some CLIs block on piped stdin
      timeout: (task.budget_minutes || 30) * 60 * 1000, // kill if exceeds budget
    });

    // Heartbeat: signal daemon with activity state.
    // getActivityState reads Claude JSONL files — only useful for Claude provider.
    // For other providers, send a basic heartbeat (process alive = active).
    const isClaude = provider.name === 'claude';
    const heartbeatTimer = setInterval(async () => {
      try {
        const payload = { task_id: task.task_id };
        if (isClaude) {
          const activity = await getActivityState(cleanCwd);
          if (activity) {
            payload.activity_state = activity.state;
            payload.activity_timestamp = activity.timestamp?.toISOString();
          }
        } else {
          // Non-Claude: process is running → active
          payload.activity_state = 'active';
          payload.activity_timestamp = new Date().toISOString();
        }
        await natsRequest('mesh.tasks.heartbeat', payload);
      } catch {
        // fire-and-forget
      }
    }, HEARTBEAT_INTERVAL);

    let stdout = '';
    let stderr = '';
    const MAX_OUTPUT = 1024 * 1024; // 1MB cap

    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString().slice(0, MAX_OUTPUT - stdout.length); });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString().slice(0, MAX_OUTPUT - stderr.length); });

    child.on('close', (code) => {
      clearInterval(heartbeatTimer);
      resolve({ exitCode: code, stdout, stderr, provider: provider.name, model });
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      resolve({ exitCode: 1, stdout: '', stderr: err.message, provider: provider.name, model });
    });
  });
}

// ── Metric Evaluation ─────────────────────────────────

const ALLOWED_METRIC_PREFIXES = [
  'npm test', 'npm run', 'node ', 'pytest', 'cargo test',
  'go test', 'make test', 'jest', 'vitest', 'mocha',
];

function isAllowedMetric(cmd) {
  return ALLOWED_METRIC_PREFIXES.some(prefix => cmd.startsWith(prefix));
}

/**
 * Run the task's metric command. Returns { passed, output }.
 */
function evaluateMetric(metric, cwd) {
  if (!isAllowedMetric(metric)) {
    log(`WARNING: Metric command blocked by security filter: ${metric}`);
    return Promise.resolve({ passed: false, output: 'Metric command blocked by security filter' });
  }
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

// ── Collab Prompt Construction ────────────────────────

/**
 * Build a prompt for a collaborative round.
 * Includes: task description, round number, shared intel from previous round, scope.
 */
function buildCollabPrompt(task, roundNumber, sharedIntel, myScope, myRole) {
  const parts = [];

  parts.push(`# Task: ${task.title} (Collaborative Round ${roundNumber})`);
  parts.push('');
  parts.push(`You are working on this task as part of a **${task.collaboration.mode}** collaboration with other nodes.`);
  parts.push(`Your role: **${myRole}**`);
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  if (roundNumber > 1 && sharedIntel) {
    parts.push('## Shared Intelligence from Previous Round');
    parts.push('Other nodes shared the following reflections. Use this to inform your work:');
    parts.push('');
    parts.push(sharedIntel);
    parts.push('');
  }

  if (myScope && myScope !== '*' && Array.isArray(myScope) && myScope[0] !== '*') {
    const isReviewOnly = Array.isArray(myScope) && myScope.some(s => typeof s === 'string' && s.startsWith('[REVIEW-ONLY]'));
    if (isReviewOnly) {
      parts.push('## Your Scope (REVIEW ONLY)');
      parts.push('You are a **reviewer**. Read and analyze these files but do NOT modify them:');
      for (const s of myScope) {
        parts.push(`- ${s.replace('[REVIEW-ONLY] ', '')}`);
      }
      parts.push('');
      parts.push('Your job is to review the leader\'s changes, identify issues, and report findings in your reflection.');
      parts.push('Do NOT write or edit any files. Focus on code review, correctness, and security analysis.');
      parts.push('');
    } else {
      parts.push('## Your Scope');
      parts.push('Only modify these files/paths:');
      for (const s of myScope) {
        parts.push(`- ${s}`);
      }
      parts.push('');
    }
  }

  // Inject path-scoped coding rules matching task scope
  const collabScope = Array.isArray(myScope) ? myScope.map(s => s.replace('[REVIEW-ONLY] ', '')) : task.scope;
  injectRules(parts, collabScope);
  injectRole(parts, task.role);

  if (task.success_criteria && task.success_criteria.length > 0) {
    parts.push('## Success Criteria');
    for (const c of task.success_criteria) {
      parts.push(`- ${c}`);
    }
    parts.push('');
  }

  parts.push('## Instructions');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes within your scope.');
  parts.push('- Focus on YOUR contribution — other nodes handle their parts.');
  if (roundNumber > 1) {
    parts.push('- Incorporate learnings from the shared intelligence above.');
  }
  parts.push('');

  parts.push('## After You Finish');
  parts.push('At the very end of your response, output ONLY a JSON reflection block.');
  parts.push('This block MUST be the last thing in your output, wrapped in triple backticks with `json` language tag.');
  parts.push('Do NOT add any text after this block.');
  parts.push('');
  parts.push('```json');
  parts.push('{');
  parts.push('  "reflection": {');
  parts.push('    "summary": "1-2 sentences: what you did this round",');
  parts.push('    "learnings": "what you discovered that other nodes should know",');
  parts.push('    "confidence": 0.85,');
  parts.push('    "vote": "continue"');
  parts.push('  }');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('Rules for the reflection block:');
  parts.push('- `confidence`: a number between 0.0 and 1.0');
  parts.push('- `vote`: exactly one of `"continue"`, `"converged"`, or `"blocked"`');
  parts.push('- `summary` and `learnings`: plain strings, no nested objects');
  parts.push('- The JSON must be valid. No trailing commas, no comments.');

  return parts.join('\n');
}

/**
 * Parse a JSON reflection block from Claude's output.
 * Returns { summary, learnings, confidence, vote, parse_failed }.
 *
 * On parse failure: parse_failed=true, vote='parse_error' (never silent 'continue').
 * The caller and convergence logic can distinguish real votes from parse failures.
 */
const VALID_VOTES = new Set(['continue', 'converged', 'blocked']);

function parseReflection(output) {
  // Strategy: find the last ```json ... ``` block in the output
  const jsonBlocks = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)];

  if (jsonBlocks.length > 0) {
    const lastBlock = jsonBlocks[jsonBlocks.length - 1][1].trim();
    try {
      const parsed = JSON.parse(lastBlock);
      const r = parsed.reflection || parsed;

      const summary = typeof r.summary === 'string' ? r.summary : '';
      const learnings = typeof r.learnings === 'string' ? r.learnings : '';
      const confidence = typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
        ? r.confidence : null;
      const vote = typeof r.vote === 'string' && VALID_VOTES.has(r.vote.toLowerCase())
        ? r.vote.toLowerCase() : null;

      if (vote === null || confidence === null) {
        log(`REFLECTION PARSE: JSON found but invalid fields (vote=${r.vote}, confidence=${r.confidence})`);
        return {
          summary: summary || output.slice(-300),
          learnings,
          confidence: confidence ?? 0.5,
          vote: vote ?? 'parse_error',
          parse_failed: true,
        };
      }

      return { summary, learnings, confidence, vote, parse_failed: false };
    } catch (err) {
      log(`REFLECTION PARSE: JSON block found but invalid JSON: ${err.message}`);
    }
  }

  // Fallback: try legacy REFLECTION_START format for backwards compat
  const legacyMatch = output.match(/REFLECTION_START\n?([\s\S]*?)REFLECTION_END/);
  if (legacyMatch) {
    log(`REFLECTION PARSE: Using legacy REFLECTION_START format (deprecated)`);
    const block = legacyMatch[1];
    const summary = (block.match(/SUMMARY:\s*(.+)/)?.[1] || '').trim();
    const learnings = (block.match(/LEARNINGS:\s*(.+)/)?.[1] || '').trim();
    const confidence = parseFloat(block.match(/CONFIDENCE:\s*([\d.]+)/)?.[1] || 'NaN');
    const voteRaw = (block.match(/VOTE:\s*(\w+)/)?.[1] || '').trim().toLowerCase();
    const vote = VALID_VOTES.has(voteRaw) ? voteRaw : 'parse_error';

    return {
      summary, learnings,
      confidence: isNaN(confidence) ? 0.5 : confidence,
      vote,
      parse_failed: vote === 'parse_error',
    };
  }

  // No reflection block found at all
  log(`REFLECTION PARSE FAILED: No JSON or legacy reflection block found in output`);
  return {
    summary: output.slice(-300),
    learnings: '',
    confidence: 0.5,
    vote: 'parse_error',
    parse_failed: true,
  };
}

// ── Circling Strategy: Prompt Builder + Parser ───────

/**
 * Build a prompt for a circling strategy step.
 * Role-specific: Worker gets different instructions than Reviewers at each step.
 */
function buildCirclingPrompt(task, circlingData) {
  const { circling_phase, circling_step, circling_subround, directed_input, my_role } = circlingData;
  const isWorker = my_role === 'worker';
  const parts = [];

  parts.push(`# Task: ${task.title}`);
  parts.push('');

  switch (circling_phase) {
    case 'init':
      if (isWorker) {
        parts.push('## Your Role: WORKER (Central Authority)');
        parts.push('');
        parts.push('You are the Worker in a Circling Strategy collaboration. You OWN the deliverable.');
        parts.push('Produce your initial work artifact (v0) — your first draft/implementation based on the task plan below.');
        parts.push('');
      } else {
        parts.push('## Your Role: REVIEWER');
        parts.push('');
        parts.push('You are a Reviewer in a Circling Strategy collaboration.');
        parts.push('Produce your **reviewStrategy** — your methodology and focus areas for reviewing this type of work.');
        parts.push('Define: what you will look for, what frameworks you will apply, what your evaluation criteria are.');
        parts.push('');
      }
      break;

    case 'circling':
      if (circling_step === 1) {
        // Step 1 — Review Pass
        parts.push(`## Sub-Round ${circling_subround}, Step 1: Review Pass`);
        parts.push('');
        if (isWorker) {
          parts.push('## Your Role: WORKER — Analyze Review Strategies');
          parts.push('');
          parts.push('Below are the review STRATEGIES from both reviewers (NOT their review findings).');
          parts.push('Analyze each strategy: what they focus on well, what they miss, how they could improve.');
          parts.push('Your feedback will help reviewers sharpen their approaches.');
          parts.push('Do NOT touch the work artifact in this step.');
          parts.push('');
        } else {
          parts.push('## Your Role: REVIEWER — Review the Work Artifact');
          parts.push('');
          parts.push('Below is the work artifact. Review it using your review strategy.');
          parts.push('Produce concrete, actionable findings. For each finding, specify:');
          parts.push('- What you found (the issue or observation)');
          parts.push('- Where in the artifact (location/line/section)');
          parts.push('- Why it matters (impact)');
          parts.push('- What you recommend (suggested fix or improvement)');
          parts.push('');
        }
      } else if (circling_step === 2) {
        // Step 2 — Integration + Refinement
        parts.push(`## Sub-Round ${circling_subround}, Step 2: Integration & Refinement`);
        parts.push('');
        if (isWorker) {
          parts.push('## Your Role: WORKER — Judge Reviews & Update Artifact');
          parts.push('');
          parts.push('Below are the review artifacts from both reviewers.');
          parts.push('For EACH review finding, judge it:');
          parts.push('- **ACCEPTED**: implement the suggestion and note where');
          parts.push('- **REJECTED**: explain why with reasoning');
          parts.push('- **MODIFIED**: implement differently and explain why');
          parts.push('');
          parts.push('Then produce your UPDATED work artifact incorporating accepted changes.');
          parts.push('Also produce a reconciliationDoc summarizing all judgments.');
          parts.push('');
          parts.push('You must output TWO artifacts using the multi-artifact format below.');
          parts.push('');
        } else {
          parts.push('## Your Role: REVIEWER — Refine Your Strategy');
          parts.push('');
          parts.push("Below is the Worker's analysis of your review strategy (and the other reviewer's).");
          parts.push("Evaluate the Worker's feedback honestly:");
          parts.push("- If the feedback is valid, adjust your strategy accordingly");
          parts.push("- If you disagree, explain why and keep your approach");
          parts.push('Produce your REFINED reviewStrategy.');
          parts.push('');
        }
      }
      break;

    case 'finalization':
      parts.push('## FINALIZATION');
      parts.push('');
      if (isWorker) {
        parts.push('## Your Role: WORKER — Final Delivery');
        parts.push('');
        parts.push('Produce your FINAL formatted work artifact.');
        parts.push('Also produce a completionDiff — a checklist comparing original plan items vs what was delivered:');
        parts.push('  [x] Item implemented');
        parts.push('  [ ] Item NOT implemented — reason / deferred to follow-up');
        parts.push('');
        parts.push('You must output TWO artifacts using the multi-artifact format below.');
        parts.push('');
      } else {
        parts.push('## Your Role: REVIEWER — Final Sign-Off');
        parts.push('');
        parts.push('Review the final work artifact against the original task plan.');
        parts.push('Either:');
        parts.push('- **APPROVE**: vote "converged" — the work meets quality standards');
        parts.push('- **FLAG CONCERN**: vote "blocked" — describe remaining critical concerns');
        parts.push('');
      }
      break;
  }

  // Add directed input
  if (directed_input) {
    parts.push('---');
    parts.push('');
    parts.push(directed_input);
    parts.push('');
  }

  // Add artifact output instructions
  const isMultiArtifact = isWorker && (circling_step === 2 || circling_phase === 'finalization');
  parts.push('---');
  parts.push('');

  if (isMultiArtifact) {
    // Multi-artifact output format (Worker Step 2 and Finalization)
    const art1Type = circling_phase === 'finalization' ? 'workArtifact' : 'workArtifact';
    const art2Type = circling_phase === 'finalization' ? 'completionDiff' : 'reconciliationDoc';

    parts.push('## Output Format (TWO artifacts required)');
    parts.push('');
    parts.push('Produce your first artifact, then wrap it:');
    parts.push('');
    parts.push('===CIRCLING_ARTIFACT===');
    parts.push(`type: ${art1Type}`);
    parts.push('===END_ARTIFACT===');
    parts.push('');
    parts.push('Then produce your second artifact:');
    parts.push('');
    parts.push('===CIRCLING_ARTIFACT===');
    parts.push(`type: ${art2Type}`);
    parts.push('===END_ARTIFACT===');
    parts.push('');
    parts.push('Then end with:');
  } else {
    parts.push('## Output Format');
    parts.push('');
    parts.push('Produce your work above, then end with:');
  }

  // Determine the correct type for single-artifact output
  let artifactType = 'workArtifact'; // default
  if (!isWorker) {
    if (circling_phase === 'init' || circling_step === 2) artifactType = 'reviewStrategy';
    else if (circling_step === 1) artifactType = 'reviewArtifact';
    else if (circling_phase === 'finalization') artifactType = 'reviewSignOff';
  } else {
    if (circling_step === 1) artifactType = 'workerReviewsAnalysis';
  }

  parts.push('');
  parts.push('===CIRCLING_REFLECTION===');
  parts.push(`type: ${artifactType}`);
  parts.push('summary: [1-2 sentences about what you did]');
  parts.push('confidence: [0.0 to 1.0]');
  if (circling_phase === 'finalization') {
    parts.push('vote: [converged|blocked]');
  } else {
    parts.push('vote: [continue|converged|blocked]');
  }
  parts.push('===END_REFLECTION===');
  parts.push('');
  parts.push('Rules:');
  parts.push('- Begin your output with the artifact content DIRECTLY. Do NOT include any preamble, explanation, or commentary before the artifact. Any text before the artifact delimiters (or before the reflection block for single-artifact output) is treated as part of the artifact.');
  parts.push('- confidence: a number between 0.0 and 1.0');
  if (circling_phase === 'finalization') {
    parts.push('- vote: "converged" (work meets quality standards) or "blocked" (critical issue remains)');
  } else {
    parts.push('- vote: "continue" (more work needed), "converged" (satisfied), or "blocked" (critical issue)');
  }
  parts.push('- The reflection block MUST be the last thing in your response');

  return parts.join('\n');
}

// Parser extracted to lib/circling-parser.js — single source of truth for both
// production code and tests. Zero external dependencies.
const { parseCirclingReflection: _parseCircling } = require('../lib/circling-parser');

/**
 * Parse a circling strategy output. Delegates to lib/circling-parser.js
 * with agent-specific options (logger, legacy fallback).
 */
function parseCirclingReflection(output) {
  return _parseCircling(output, {
    log: (msg) => log(msg),
    legacyParser: parseReflection,
  });
}

// ── Collaborative Task Execution ──────────────────────

/**
 * Execute a collaborative task: join session, work in rounds, submit reflections.
 */
async function executeCollabTask(task) {
  const collabSpec = task.collaboration;
  log(`COLLAB EXECUTING: ${task.task_id} "${task.title}" (mode: ${collabSpec.mode})`);

  // Discover session ID — three strategies in priority order:
  // 1. task.collab_session_id (set by daemon on auto-create)
  // 2. mesh.collab.find RPC (lookup by task_id)
  // 3. Brief wait + retry (race condition: task claimed before session created)
  let sessionId = task.collab_session_id || null;

  if (!sessionId) {
    log(`COLLAB: No session_id in task. Discovering via mesh.collab.find...`);
    try {
      const found = await natsRequest('mesh.collab.find', { task_id: task.task_id }, 5000);
      if (found) sessionId = found.session_id;
    } catch { /* find RPC unavailable or no session yet */ }
  }

  if (!sessionId) {
    // Brief wait — session may still be creating (race between claim and session auto-create)
    log(`COLLAB: Session not found. Waiting 3s for daemon to create it...`);
    await new Promise(r => setTimeout(r, 3000));
    try {
      const found = await natsRequest('mesh.collab.find', { task_id: task.task_id }, 5000);
      if (found) sessionId = found.session_id;
    } catch { /* still nothing */ }
  }

  if (!sessionId) {
    // EXPLICIT FAILURE — do NOT silently fall back to solo execution.
    // A collab task running solo loses the multi-node quality guarantee
    // with zero indication in the output. This must be a visible error.
    log(`COLLAB FAILED: No session found for task ${task.task_id}. Refusing silent solo fallback.`);
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      reason: `Collab session not found for task ${task.task_id}. Task requires collaborative execution (mode: ${collabSpec.mode}) but no session could be discovered. Solo fallback refused — collab tasks must run collaboratively.`,
    }).catch(() => {});
    writeAgentState('idle', null);
    return;
  }

  // Subscribe to round notifications BEFORE joining — prevents race condition
  // where the daemon starts round 1 immediately upon last node joining,
  // but the joining node hasn't subscribed yet and misses the notification.
  const roundSub = nc.subscribe(`mesh.collab.${sessionId}.node.${NODE_ID}.round`);
  let roundsDone = false;
  let lastKnownSessionStatus = null; // tracks why rounds ended (completed/aborted/converged)

  // Join the session using the discovered session_id
  let session;
  try {
    const joinResult = await natsRequest('mesh.collab.join', {
      session_id: sessionId,
      node_id: NODE_ID,
    }, 10000);
    session = joinResult;
  } catch (err) {
    log(`COLLAB JOIN FAILED: ${err.message} (session: ${sessionId})`);
    roundSub.unsubscribe();
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      reason: `Failed to join collab session ${sessionId}: ${err.message}`,
    }).catch(() => {});
    writeAgentState('idle', null);
    return;
  }

  if (!session) {
    log(`COLLAB JOIN RETURNED NULL for session ${sessionId}`);
    roundSub.unsubscribe();
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      reason: `Collab session ${sessionId} rejected join (full, closed, or duplicate node).`,
    }).catch(() => {});
    writeAgentState('idle', null);
    return;
  }

  log(`COLLAB JOINED: ${sessionId} (${session.nodes.length} nodes)`);
  writeAgentState('working', task.task_id);

  // Create worktree for isolation
  const worktreePath = createWorktree(`${task.task_id}-${NODE_ID}`);
  const taskDir = worktreePath || WORKSPACE;

  // Periodic session heartbeat — detects abort/completion while waiting for rounds
  const sessionHeartbeat = setInterval(async () => {
    try {
      const status = await natsRequest('mesh.collab.status', { session_id: sessionId }, 5000);
      if (['aborted', 'completed'].includes(status.status)) {
        log(`COLLAB HEARTBEAT: Session ${sessionId} is ${status.status}. Unsubscribing.`);
        lastKnownSessionStatus = status.status;
        roundsDone = true;
        roundSub.unsubscribe();
      }
    } catch { /* best effort */ }
  }, 10000);

  // Signal start
  await natsRequest('mesh.tasks.start', { task_id: task.task_id }).catch(() => {});

  try {
    for await (const roundMsg of roundSub) {
      if (roundsDone) break;

      const roundData = JSON.parse(sc.decode(roundMsg.data));
      const { round_number, shared_intel, directed_input, my_scope, my_role, mode, current_turn,
              circling_phase, circling_step, circling_subround } = roundData;

      // Sequential mode safety guard: skip if it's not our turn.
      if (mode === 'sequential' && current_turn && current_turn !== NODE_ID) {
        log(`COLLAB R${round_number}: Not our turn (current: ${current_turn}). Waiting.`);
        continue;
      }

      const isCircling = mode === 'circling_strategy';
      const stepLabel = isCircling
        ? `${circling_phase === 'init' ? 'Init' : circling_phase === 'finalization' ? 'Final' : `SR${circling_subround}/S${circling_step}`}`
        : `R${round_number}`;
      log(`COLLAB ${stepLabel}: Starting work (role: ${my_role}, scope: ${JSON.stringify(my_scope)})`);

      // Build prompt — circling uses directed inputs, other modes use shared intel
      const prompt = isCircling
        ? buildCirclingPrompt(task, roundData)
        : buildCollabPrompt(task, round_number, shared_intel, my_scope, my_role);

      if (DRY_RUN) {
        log(`[DRY RUN] Collab prompt:\n${prompt}`);
        break;
      }

      // Execute provider (LLM or shell)
      const llmResult = await runLLM(prompt, task, worktreePath);
      const output = llmResult.stdout || '';

      // Parse reflection — circling uses delimiter-based parser, others use JSON-block parser
      let reflection;
      let circlingArtifacts = [];

      if (llmResult.provider === 'shell') {
        reflection = {
          summary: output.trim().slice(-500) || '(no output)',
          learnings: '',
          confidence: llmResult.exitCode === 0 ? 1.0 : 0.0,
          vote: llmResult.exitCode === 0 ? 'converged' : 'continue',
          parse_failed: false,
        };
      } else if (isCircling) {
        const circResult = parseCirclingReflection(output);
        reflection = {
          summary: circResult.summary,
          learnings: '',
          confidence: circResult.confidence,
          vote: circResult.vote,
          parse_failed: circResult.parse_failed,
        };
        circlingArtifacts = circResult.circling_artifacts;
      } else {
        reflection = parseReflection(output);
      }

      // List modified files
      let artifacts = [];
      try {
        if (worktreePath) {
          const status = require('child_process').execSync('git status --porcelain', {
            cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
          }).trim();
          artifacts = status.split('\n').filter(Boolean).map(line => line.slice(3));
        }
      } catch { /* best effort */ }

      // Submit reflection
      try {
        await natsRequest('mesh.collab.reflect', {
          session_id: sessionId,
          node_id: NODE_ID,
          round: round_number,
          summary: reflection.summary,
          learnings: reflection.learnings || '',
          artifacts,
          confidence: reflection.confidence,
          vote: reflection.vote,
          parse_failed: reflection.parse_failed,
          // Circling extensions
          circling_step: isCircling ? circling_step : null,
          circling_artifacts: circlingArtifacts,
        });
        const parseTag = reflection.parse_failed ? ' [PARSE FAILED]' : '';
        const artCount = circlingArtifacts.length > 0 ? `, ${circlingArtifacts.length} artifact(s)` : '';
        log(`COLLAB ${stepLabel}: Reflection submitted (vote: ${reflection.vote}, conf: ${reflection.confidence}${parseTag}${artCount})`);
      } catch (err) {
        log(`COLLAB ${stepLabel}: Reflection submit failed: ${err.message}`);
      }

      // Check if session is done (converged/completed/aborted)
      try {
        const status = await natsRequest('mesh.collab.status', { session_id: sessionId });
        if (['converged', 'completed', 'aborted'].includes(status.status)) {
          log(`COLLAB: Session ${sessionId} is ${status.status}. Done.`);
          lastKnownSessionStatus = status.status;
          roundsDone = true;
        }
      } catch { /* continue listening */ }
    }
  } finally {
    clearInterval(sessionHeartbeat);
    roundSub.unsubscribe();
  }

  // Commit and merge only on successful convergence — don't merge partial
  // work from aborted/failed sessions into main.
  // Uses lastKnownSessionStatus (set during round loop or heartbeat) instead of
  // a fresh network read, which could see stale state due to NATS latency.
  try {
    if (['completed', 'converged'].includes(lastKnownSessionStatus)) {
      const mergeResult = commitAndMergeWorktree(worktreePath, `${task.task_id}-${NODE_ID}`, `collab contribution from ${NODE_ID}`);
      cleanupWorktree(worktreePath, mergeResult && !mergeResult?.merged);
    } else {
      log(`COLLAB: Session ${sessionId} ended as ${lastKnownSessionStatus || 'unknown'} — discarding worktree`);
      cleanupWorktree(worktreePath, false);
    }
  } catch (err) {
    log(`COLLAB WORKTREE CLEANUP FAILED: ${err.message}`);
  }

  writeAgentState('idle', null);
  log(`COLLAB DONE: ${task.task_id} (node: ${NODE_ID})`);
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

    // Run LLM (with worktree isolation if available)
    const llmResult = await runLLM(prompt, task, worktreePath);
    const summary = llmResult.stdout.slice(-500) || '(no output)';

    log(`${llmResult.provider} exited with code ${llmResult.exitCode}`);

    // Extract cost + summary from JSONL session file (zero-cost observability)
    const cleanCwd = path.join(os.tmpdir(), 'mesh-agent-work');
    const sessionInfo = await getSessionInfo(cleanCwd).catch(() => null);
    if (sessionInfo?.cost) {
      log(`Cost: $${sessionInfo.cost.estimatedCostUsd.toFixed(4)} (${sessionInfo.cost.inputTokens} in / ${sessionInfo.cost.outputTokens} out)`);
    }

    if (llmResult.exitCode !== 0) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: ${llmResult.provider} exited with error (code ${llmResult.exitCode})`,
        result: llmResult.stderr.slice(-500) || 'unknown error',
        keep: false,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });

      // Two-tier retry: abnormal exit → exponential backoff (agent crash, OOM, etc.)
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 1s, 2s, 4s... max 30s
      log(`Attempt ${attempt} failed (${llmResult.provider} error, code ${llmResult.exitCode}). Backoff ${backoffMs}ms before retry.`);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    // ── Mesh Harness: Mechanical Enforcement (LLM-agnostic) ──
    // Runs AFTER LLM exits successfully, BEFORE commit. This is the hard
    // enforcement layer — it doesn't depend on the LLM obeying prompt rules.
    const harnessResult = runMeshHarness({
      rules: getHarnessRules(),
      worktreePath,
      taskScope: task.scope,
      llmOutput: llmResult.stdout,
      hasMetric: !!task.metric,
      log,
      role: getRole(task.role),
    });

    if (!harnessResult.pass) {
      log(`HARNESS BLOCKED: ${harnessResult.violations.length} violation(s)`);
      for (const v of harnessResult.violations) {
        log(`  - [${v.rule}] ${v.message}`);
      }
      // Scope violations were already reverted by enforceScopeCheck.
      // Secret violations block the commit entirely.
      const hasSecrets = harnessResult.violations.some(v => v.rule === 'no-hardcoded-secrets');
      if (hasSecrets) {
        const attemptRecord = {
          approach: `Attempt ${attempt}: harness blocked — secrets detected`,
          result: harnessResult.violations.map(v => v.message).join('; '),
          keep: false,
        };
        attempts.push(attemptRecord);
        await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, ...attemptRecord });
        log(`Attempt ${attempt}: harness blocked commit (secrets). Retrying.`);
        continue;
      }
      // Non-secret violations (scope reverts, output blocks): proceed with warnings
    }

    if (harnessResult.warnings.length > 0) {
      log(`HARNESS WARNINGS: ${harnessResult.warnings.length}`);
      for (const w of harnessResult.warnings) {
        log(`  - [${w.rule}] ${w.message}`);
      }
    }

    // If no metric, trust LLM output and complete
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

      // Post-commit validation (conventional commits, etc.)
      if (mergeResult?.committed) {
        runPostCommitValidation(getHarnessRules(), worktreePath, log);
      }

      await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        result: {
          success: true, summary, artifacts: [],
          cost: sessionInfo?.cost || null,
          harness: {
            violations: harnessResult.violations,
            warnings: harnessResult.warnings,
          },
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

      // Post-commit validation (conventional commits, etc.)
      if (mergeResult?.committed) {
        runPostCommitValidation(getHarnessRules(), worktreePath, log);
      }

      await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        result: {
          success: true,
          summary: `Metric passed on attempt ${attempt}. ${summary.slice(0, 200)}`,
          artifacts: [],
          cost: sessionInfo?.cost || null,
          sha: mergeResult?.sha || null,
          merged: mergeResult?.merged ?? null,
          harness: {
            violations: harnessResult.violations,
            warnings: harnessResult.warnings,
          },
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
  const defaultProvider = resolveProvider(null, CLI_PROVIDER, ENV_PROVIDER);
  const defaultModel = resolveModel(null, CLI_MODEL, defaultProvider);
  log(`Starting mesh agent worker`);
  log(`  Node ID:     ${NODE_ID}`);
  log(`  NATS:        ${NATS_URL}`);
  log(`  LLM:         ${defaultProvider.name} (${defaultProvider.binary})`);
  log(`  Model:       ${defaultModel || '(per-task)'}`);
  log(`  Workspace:   ${WORKSPACE}`);
  log(`  Max attempts: ${MAX_ATTEMPTS}`);
  log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`  Mode:        ${ONCE ? 'single task' : 'continuous'} ${DRY_RUN ? '(dry run)' : ''}`);

  const natsOpts = natsConnectOpts();
  nc = await connect({
    ...natsOpts,
    timeout: 5000,
    reconnect: true,
    maxReconnectAttempts: 10,
    reconnectTimeWait: 2000,
  });
  log(`Connected to NATS`);

  // Exit on permanent NATS disconnect so launchd restarts us
  (async () => {
    for await (const s of nc.status()) {
      log(`NATS status: ${s.type}`);
      if (s.type === 'disconnect') {
        log('NATS disconnected — will attempt reconnect');
      }
    }
  })();
  nc.closed().then(() => {
    log('NATS connection permanently closed — exiting for launchd restart');
    process.exit(1);
  });

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

  // Subscribe to collab recruit broadcasts — allows this node to join
  // collab sessions without being the claiming node
  const recruitSub = nc.subscribe('mesh.collab.*.recruit');
  (async () => {
    for await (const msg of recruitSub) {
      try {
        const recruit = JSON.parse(sc.decode(msg.data));
        if (currentTaskId) continue; // busy

        // Fetch task to check preferences and get collab spec
        const task = await natsRequest('mesh.tasks.get', { task_id: recruit.task_id }, 5000);
        if (!task || !task.collaboration) continue;
        if (task.owner === NODE_ID) continue; // we claimed it, already handling

        // Check preferred_nodes
        if (task.preferred_nodes && task.preferred_nodes.length > 0) {
          if (!task.preferred_nodes.includes(NODE_ID)) continue;
        }
        // Check exclude_nodes
        if (task.exclude_nodes && task.exclude_nodes.length > 0) {
          if (task.exclude_nodes.includes(NODE_ID)) continue;
        }

        log(`RECRUIT: Joining collab session ${recruit.session_id} for task ${recruit.task_id}`);
        currentTaskId = task.task_id;
        await executeCollabTask(task);
        currentTaskId = null;
      } catch (err) {
        log(`RECRUIT ERROR: ${err.message}`);
        currentTaskId = null;
      }
    }
  })();
  log(`  Listening: mesh.collab.*.recruit (collab recruiting)`);

  // Also poll for recruiting sessions on idle — catches recruits we missed
  async function checkRecruitingSessions() {
    if (currentTaskId) return; // busy
    try {
      const sessions = await natsRequest('mesh.collab.recruiting', {}, 5000);
      if (!sessions || !Array.isArray(sessions) || sessions.length === 0) return;

      for (const s of sessions) {
        if (currentTaskId) break; // became busy
        // Skip if we already joined this session
        if (s.node_ids && s.node_ids.includes(NODE_ID)) continue;
        // Skip if session is full
        if (s.max_nodes && s.current_nodes >= s.max_nodes) continue;

        // Fetch task to check preferences
        const task = await natsRequest('mesh.tasks.get', { task_id: s.task_id }, 5000);
        if (!task || !task.collaboration) continue;
        if (task.preferred_nodes && task.preferred_nodes.length > 0) {
          if (!task.preferred_nodes.includes(NODE_ID)) continue;
        }
        if (task.exclude_nodes && task.exclude_nodes.length > 0) {
          if (task.exclude_nodes.includes(NODE_ID)) continue;
        }

        log(`RECRUIT POLL: Joining collab session ${s.session_id} for task ${s.task_id}`);
        currentTaskId = task.task_id;
        await executeCollabTask(task);
        currentTaskId = null;
      }
    } catch { /* silent — recruiting poll is best-effort */ }
  }

  while (running) {
    try {
      // Check for recruiting collab sessions before trying to claim
      await checkRecruitingSessions();
      if (currentTaskId) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }

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

      // Execute the task (collab or solo)
      currentTaskId = task.task_id;
      if (task.collaboration) {
        await executeCollabTask(task);
      } else {
        await executeTask(task);
      }
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
// deploy-v7f0130b
