/**
 * observation.mjs — the compact, bounded snapshot the assessor sees.
 *
 * Never the repository: output tails, git status + a bounded diff + changed file
 * names from the task worktree, the task itself, timing, attempt history, the
 * prior assessment and decision, and (transiently) the repository's own
 * instruction file. Every text field is tail-bounded so a chatty worker cannot
 * blow the local model's context.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFileCb);

export const DEFAULT_LIMITS = Object.freeze({
  diff: 12_000,
  output: 8_000,
  field: 20_000,
  instructions: 6_000,
  events: 30,
  workers: 10,
});

export function tail(text, limit) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (value.length <= limit) return value;
  return `[... ${value.length - limit} earlier characters omitted ...]\n${value.slice(-limit)}`;
}

async function git(worktreePath, args, limit, exec) {
  try {
    const { stdout } = await exec('git', ['-C', worktreePath, ...args], {
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    });
    return tail(stdout, limit);
  } catch {
    // No evidence beats git's usage text: outside a repository, or on a timeout,
    // the assessor should see an empty field, not a page of options.
    return '';
  }
}

/**
 * git status/diff/names for the worktree, gathered concurrently; errors read as ''.
 * Measured against HEAD, so staged edits and new files count as changes — the
 * worker's own index is not the baseline.
 */
export async function gitEvidence(worktreePath, limits = DEFAULT_LIMITS, exec = execFileAsync) {
  if (!worktreePath) return { status: '', diff: '', changed_files: [] };
  const [status, diff, names, untracked] = await Promise.all([
    git(worktreePath, ['status', '--short'], limits.field, exec),
    git(worktreePath, ['diff', 'HEAD', '--no-ext-diff'], limits.diff, exec),
    git(worktreePath, ['diff', 'HEAD', '--name-only'], limits.field, exec),
    git(worktreePath, ['ls-files', '--others', '--exclude-standard'], limits.field, exec),
  ]);
  const files = [...names.split('\n'), ...untracked.split('\n')].filter((name) => name && !name.startsWith('[... '));
  return {
    status,
    diff,
    changed_files: [...new Set(files)].slice(0, limits.workers * 10),
  };
}

function gitRunner(worktreePath, exec, timeoutMs) {
  return (args, env = null) => exec('git', ['-C', worktreePath, ...args], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

async function withScratchIndex(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-index-'));
  try {
    return await fn(path.join(dir, 'index'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The tree `git add -A` would commit right now (tracked, staged and untracked
 * non-ignored files), hashed through a scratch copy of the worktree's index so the
 * worker's own staging is never touched. Equal hashes mean an unchanged tree; null
 * means it could not be read.
 */
export async function treeSnapshot(worktreePath, { exec = execFileAsync, timeoutMs = 10_000 } = {}) {
  if (!worktreePath) return null;
  const run = gitRunner(worktreePath, exec, timeoutMs);
  try {
    return await withScratchIndex(async (index) => {
      const { stdout: indexPath } = await run(['rev-parse', '--git-path', 'index']);
      // Starting from the real index keeps its stat cache: only changed files are re-hashed.
      try { fs.copyFileSync(path.resolve(worktreePath, indexPath.trim()), index); } catch { /* none yet */ }
      await run(['add', '-A', '--', '.'], { GIT_INDEX_FILE: index });
      const { stdout } = await run(['write-tree'], { GIT_INDEX_FILE: index });
      return stdout.trim() || null;
    });
  } catch {
    return null;
  }
}

/**
 * Put the worktree back to snapshot `tree` after it drifted to `changedTree`: paths
 * added since are deleted, paths changed or deleted are rewritten from the snapshot
 * (through a scratch index — the worker's staging stays as it was). Ignored files are
 * outside both snapshots and are left alone. Returns the paths it touched.
 */
export async function restoreTree(worktreePath, tree, changedTree, { exec = execFileAsync, timeoutMs = 60_000 } = {}) {
  const run = gitRunner(worktreePath, exec, timeoutMs);
  const { stdout } = await run(['diff-tree', '-r', '-z', '--no-renames', '--name-status', tree, changedTree]);
  const fields = stdout.split('\0').filter(Boolean);
  const added = [];
  const rewrite = [];
  for (let i = 0; i + 1 < fields.length; i += 2) (fields[i] === 'A' ? added : rewrite).push(fields[i + 1]);
  for (const file of added) fs.rmSync(path.join(worktreePath, file), { force: true });
  if (rewrite.length) {
    await withScratchIndex(async (index) => {
      await run(['read-tree', tree], { GIT_INDEX_FILE: index });
      for (let i = 0; i < rewrite.length; i += 200) {
        await run(['checkout-index', '-f', '--', ...rewrite.slice(i, i + 200)], { GIT_INDEX_FILE: index });
      }
    });
  }
  return [...added, ...rewrite];
}

/** The repository's own instruction file, read fresh each time and never persisted. */
export function readInstructions(worktreePath, limit = DEFAULT_LIMITS.instructions) {
  if (!worktreePath) return { path: null, text: '' };
  for (const name of ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md']) {
    const file = path.join(worktreePath, name);
    try {
      if (fs.lstatSync(file).isSymbolicLink()) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!text.trim()) continue;
      return { path: name, text: text.length > limit ? `${text.slice(0, limit)}\n[... instructions truncated ...]` : text };
    } catch {
      continue;
    }
  }
  return { path: null, text: '' };
}

function boundedWorker(worker, limits) {
  return {
    worker_id: worker.worker_id,
    kind: worker.kind,
    attempt: worker.attempt,
    status: worker.status,
    started_at: worker.started_at ?? null,
    finished_at: worker.finished_at ?? null,
    elapsed_seconds: worker.started_at
      ? Math.max(0, (Date.parse(worker.finished_at ?? new Date().toISOString()) - Date.parse(worker.started_at)) / 1000)
      : null,
    exit_code: worker.exit_code ?? null,
    stdout_tail: tail(worker.stdout || '', limits.output),
    stderr_tail: tail(worker.stderr || '', limits.output),
    supports_steering: worker.supports_steering === true,
    steer_count: worker.steer_count || 0,
    steer_failures: worker.steer_failures || 0,
    last_steered_at: worker.last_steered_at ?? null,
  };
}

/**
 * @param {object} args
 * @param {object} args.task — the mesh task (task_id, title, description, metric, scope, budget_minutes).
 * @param {object} args.state — the supervisor state (see supervisor.mjs).
 * @param {string|null} args.worktreePath
 * @param {Array<object>} [args.recentEvents]
 * @param {object} [args.limits]
 * @param {Function} [args.exec] — execFile-compatible, injectable for tests.
 * @param {Function} [args.now]
 */
export async function buildObservation({ task, state, worktreePath, recentEvents = [], limits = DEFAULT_LIMITS, exec = execFileAsync, now = () => new Date() }) {
  const evidence = await gitEvidence(worktreePath, limits, exec);
  const instructions = readInstructions(worktreePath, limits.instructions);
  const history = state.workers.slice(-limits.workers);
  const active = state.workers.filter((w) => w.worker_id === state.active_worker_id);
  const latest = history[history.length - 1] || null;
  const elapsed = state.started_at ? Math.max(0, (now().getTime() - Date.parse(state.started_at)) / 1000) : 0;
  return {
    task_id: task.task_id,
    original_task: tail([task.title, task.description].filter(Boolean).join('\n\n'), limits.field),
    metric: task.metric || null,
    scope: Array.isArray(task.scope) ? task.scope.slice(0, 50) : [],
    budget_minutes: task.budget_minutes ?? null,
    factory_status: state.status,
    iteration: state.iteration,
    attempt: state.attempt,
    active_workers: active.map((w) => boundedWorker(w, limits)),
    worker_history: history.map((w) => boundedWorker(w, limits)),
    latest_worker_output: latest ? tail(`${latest.stdout || ''}\n${latest.stderr || ''}`, limits.output) : '',
    git_status: evidence.status,
    git_diff: evidence.diff,
    changed_files: evidence.changed_files,
    instructions_path: instructions.path,
    instructions: instructions.text,
    verification_results: (state.verification_results || []).slice(-limits.workers),
    recent_events: recentEvents.slice(-limits.events),
    previous_assessment: state.latest_assessment ?? null,
    previous_intervention: state.latest_intervention ?? null,
    failures: (state.errors || []).slice(-limits.workers),
    elapsed_seconds: elapsed,
  };
}
