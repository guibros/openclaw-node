#!/usr/bin/env node
/**
 * mesh-cli-submit.test.js — the REAL `mesh submit` CLI against the live task
 * daemon (the CI mesh stack; a visible skip elsewhere), through all three of
 * its inputs: a YAML file, YAML on stdin, and `--id` from the kanban.
 *
 * cmdSubmit's first line required the `yaml` module, which the package never
 * declared. So `mesh submit` failed on every clean install with "Cannot find
 * module 'yaml'" before reaching the daemon, even on the `--id` path, which
 * parses no YAML at all. The repo's YAML parser is js-yaml; the CLI now uses it.
 *
 * Run: node --test test/mesh-cli-submit.test.js   (needs NATS + mesh-task-daemon)
 */
const { describe, it, before, after } = require('node:test');
const { meshSkipReason } = require('./helpers/mesh-available.cjs');
const { acquireMeshLock, releaseMeshLock } = require('./helpers/mesh-lock.cjs');
const skipReason = meshSkipReason();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { natsConnectOpts } = require('../lib/nats-resolve');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-submit-'));
let nc;
let sc;

before(async () => {
  if (skipReason) return;
  await acquireMeshLock('mesh-cli-submit.test.js');
  const { connect, StringCodec } = require('nats');
  sc = StringCodec();
  nc = await connect(natsConnectOpts({ timeout: 5000 }));
});

after(async () => {
  if (skipReason) return;
  if (nc && !nc.isClosed()) {
    for (const tid of createdTaskIds) {
      try { await rpc('mesh.tasks.cancel', signOperatorRequest({ task_id: tid })); } catch { /* best-effort */ }
    }
    await nc.close();
  }
  releaseMeshLock();
});

// Every task this file submits is cancelled in `after`, so none is left queued
// for the next suite's claim.
const createdTaskIds = [];
function uniqueTaskId() {
  const id = `T-SUBMIT-${crypto.randomBytes(4).toString('hex')}`;
  createdTaskIds.push(id);
  return id;
}

async function rpc(subject, payload) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: 10000 });
  return JSON.parse(sc.decode(msg.data));
}

function mesh(args, { input, env } = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'mesh.js'), ...args], {
    cwd: REPO, env: { ...process.env, ...env }, input, encoding: 'utf8', timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const specFor = (id) => [
  `task_id: ${id}`,
  'title: submitted from YAML',
  'description: |',
  '  two lines',
  '  of description',
  'budget_minutes: 7',
  'metric: npm test',
  'scope:',
  '  - lib/a.js',
  '  - lib/b.js',
  'tags: [cli-submit]',
  '',
].join('\n');

describe('mesh submit reaches the daemon', { skip: skipReason }, () => {
  it('from a YAML file, with every field intact', async () => {
    const id = uniqueTaskId();
    const file = path.join(TMP, `${id}.yaml`);
    fs.writeFileSync(file, specFor(id));

    const r = mesh(['submit', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Submitted: ${id} "submitted from YAML"`));

    const { data: task } = await rpc('mesh.tasks.get', { task_id: id });
    assert.equal(task.status, 'queued');
    assert.equal(task.description, 'two lines\nof description\n');
    assert.equal(task.budget_minutes, 7);
    assert.equal(task.metric, 'npm test');
    assert.deepEqual(task.scope, ['lib/a.js', 'lib/b.js']);
    assert.deepEqual(task.tags, ['cli-submit']);
  });

  it('from YAML on stdin', async () => {
    const id = uniqueTaskId();
    const r = mesh(['submit'], { input: specFor(id) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Submitted: ${id}`));
    assert.equal((await rpc('mesh.tasks.get', { task_id: id })).data?.status, 'queued');
  });

  it('with --id from the kanban, and marks the card submitted', async () => {
    const id = uniqueTaskId();
    const home = fs.mkdtempSync(path.join(TMP, 'home-'));
    const kanban = path.join(home, '.openclaw', 'workspace', 'memory', 'active-tasks.md');
    fs.mkdirSync(path.dirname(kanban), { recursive: true });
    fs.writeFileSync(kanban, `# Active Tasks\n\n## Live Tasks\n\n- task_id: ${id}\n  title: from the kanban\n  status: queued\n  updated_at: 2026-09-27\n`);

    // The CLI reads the kanban from $HOME; its NATS identity comes from OPENCLAW_IDENTITY_DIR.
    const r = mesh(['submit', '--id', id], { env: { HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Submitted: ${id} \\[queued\\]`));
    assert.match(fs.readFileSync(kanban, 'utf8'), /status: submitted/);
    assert.equal((await rpc('mesh.tasks.get', { task_id: id })).data?.status, 'queued');
  });
});
