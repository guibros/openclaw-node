#!/usr/bin/env node
/**
 * mesh-agent-terminal-task.test.js — what mesh-agent does when the daemon
 * reports that its task already ended (budget auto-fail, stall release,
 * cancel). Real agent code in a real git workspace; only NATS is faked.
 *
 * The first daemon call after the task ended threw a bare error out of
 * executeTask into the main loop, which logged ERROR and moved on. The worktree
 * stayed checked out, the agent state still said "working", and the telemetry
 * called it an "unhandled worker error". That was seen on the node on
 * 2026-09-27. A task the daemon ended means stop, not crash.
 *
 * Run: node --test test/mesh-agent-terminal-task.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The agent reads its paths and identity at require time; keep all of them in a sandbox.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-'));
const WORKSPACE = path.join(TMP, 'workspace');
const STATE_DB = path.join(TMP, 'state.db');
const AGENT_STATE = path.join(TMP, '.openclaw', '.tmp', 'agent-state.json');
fs.mkdirSync(path.dirname(AGENT_STATE), { recursive: true });
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: STATE_DB,
  MESH_LLM_PROVIDER: 'claude', // telemetry resolves the worker's provider; nothing is run
  // git in a sandbox: no user/system config (hooks, signing), fixed identity.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');
const { TASK_TERMINAL } = require('../lib/mesh-tasks');

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

function freshWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
}

/** The daemon's reply to any owner call once enforceBudgets has failed the task. */
const ENDED = {
  ok: false,
  error: 'Task T-1 is already failed (Budget exceeded: 10.4m elapsed, 10m budget)',
  code: TASK_TERMINAL,
  status: 'failed',
};

function daemonAnswers(reply) {
  agent.__test.setContext({ nc: { async request() { return { data: sc.encode(JSON.stringify(reply)) }; } } });
}

async function telemetryFor(taskId) {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const store = createHyperAgentStore({ dbPath: STATE_DB });
  try {
    return store.getTelemetry({ last: 1000 }).filter((row) => row.task_id === taskId);
  } finally {
    store.close();
  }
}

describe('a daemon reply that the task already ended', () => {
  it('reaches the caller with its code and the task status', async () => {
    daemonAnswers(ENDED);
    await assert.rejects(agent.__test.natsRequest('mesh.tasks.attempt', { task_id: 'T-1' }), (err) => {
      assert.equal(err.code, TASK_TERMINAL);
      assert.equal(err.taskStatus, 'failed');
      assert.match(err.message, /T-1 is already failed/);
      return true;
    });
  });
});

describe('the worker stops cleanly on a task the daemon ended', () => {
  beforeEach(freshWorkspace);

  it('keeps the partial work on the task branch, frees the worktree, goes idle and records why', async () => {
    const worktree = agent.__test.createWorktree('T-1');
    fs.writeFileSync(path.join(worktree, 'partial.txt'), 'half done\n');
    fs.writeFileSync(AGENT_STATE, JSON.stringify({ status: 'working', taskId: 'T-1' }));
    daemonAnswers(ENDED);
    const err = await agent.__test.natsRequest('mesh.tasks.attempt', { task_id: 'T-1' }).catch((e) => e);

    await agent.__test.onWorkerError({ task_id: 'T-1', title: 'work' }, Date.now() - 60_000, err);

    assert.equal(fs.existsSync(worktree), false, 'the worktree is removed');
    assert.match(git(WORKSPACE, 'log', '-1', '--format=%s', 'mesh/T-1'), /partial: the daemon ended this task \(failed\)/);
    assert.equal(git(WORKSPACE, 'show', 'mesh/T-1:partial.txt'), 'half done');
    assert.equal(JSON.parse(fs.readFileSync(AGENT_STATE, 'utf8')).status, 'idle');
    const rows = await telemetryFor('T-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'failure');
    assert.match(rows[0].meta_notes, /^Stopped: Task T-1 is already failed \(Budget exceeded/);
  });

  it('any other error is still reported as an unhandled worker error', async () => {
    agent.__test.createWorktree('T-2');
    await agent.__test.onWorkerError({ task_id: 'T-2', title: 'work' }, Date.now(), new Error('boom'));
    const rows = await telemetryFor('T-2');
    assert.equal(rows.length, 1);
    assert.match(rows[0].meta_notes, /^Unhandled worker error: boom/);
  });
});
