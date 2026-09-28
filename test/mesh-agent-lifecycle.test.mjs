import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, natsServerBin, startNatsServer } from './helpers/nats-server.mjs';

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
const codec = StringCodec();
const entry = process.env.MESH_AGENT_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-agent.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../bin/mesh-task-daemon.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';
const livePorts = [4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224];

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('condition deadline exceeded');
}

async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGCONT');
  proc.kill('SIGTERM');
  try { await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000); }
  catch {
    proc.kill('SIGKILL');
    await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000);
  }
}

function observe(proc) {
  const child = { proc, result: null, output: '' };
  proc.on('error', error => { child.result = { error }; });
  proc.on('exit', (code, signal) => { child.result = { code, signal }; });
  proc.stdout.on('data', data => { child.output += data; });
  proc.stderr.on('data', data => { child.output += data; });
  return child;
}

async function exited(worker, timeoutMs = 10_000) {
  await until(() => worker.result !== null, timeoutMs);
  return worker.result;
}

async function fixture(t, interval = 1_000) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-agent-drain-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) await stop(proc);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const workspace = path.join(home, '.openclaw', 'workspace');
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  execFileSync('git', ['init', '--template=', '--initial-branch=fixture', workspace], {
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    stdio: 'ignore',
  });
  const port = await freePort();
  const monitorPort = await freePort();
  assert.ok(!livePorts.includes(port) && !livePorts.includes(monitorPort));
  assert.notEqual(port, monitorPort);
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nhttp: 127.0.0.1:${monitorPort}\njetstream { store_dir: ${JSON.stringify(path.join(root, 'store'))} }\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  const nodeId = `owned-worker-${randomBytes(8).toString('hex')}`;
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: root,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: nodeId,
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
    MESH_LLM_PROVIDER: 'openai',
    MESH_WORKSPACE: workspace,
    MESH_WORKTREE_BASE: path.join(root, 'worktrees'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  if (interval !== null) env.MESH_POLL_INTERVAL = String(interval);
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  const daemonProc = spawn(process.execPath, [daemonEntry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(daemonProc);
  const daemon = observe(daemonProc);
  await until(() => {
    assert.equal(daemon.result, null, daemon.output);
    return daemon.output.includes('Task daemon ready.');
  });
  nc = await connect({ servers: env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  const assertEmpty = async () => {
    const reply = JSON.parse(codec.decode((await nc.request('mesh.tasks.list', codec.encode('{}'), { timeout: 3_000 })).data));
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.data, []);
  };
  await assertEmpty();
  const claimReplies = new Map();
  nc.subscribe('mesh.tasks.claim', { callback: (_err, msg) => { claimReplies.set(msg.reply, null); } });
  nc.subscribe('_INBOX.>', { callback: (_err, msg) => {
    if (claimReplies.has(msg.subject)) claimReplies.set(msg.subject, JSON.parse(codec.decode(msg.data)));
  } });
  await nc.flush();
  const proc = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  const worker = observe(proc);
  const subjects = ['alive', 'approved', 'rejected'].map(suffix => `mesh.agent.${nodeId}.${suffix}`);
  subjects.push('mesh.collab.*.recruit');
  await until(async () => {
    assert.equal(worker.result, null, worker.output);
    const state = await fetch(`http://127.0.0.1:${monitorPort}/connz?subs=1`).then(r => r.json());
    return [...claimReplies.values()].some(reply => reply?.ok && reply.data === null)
      && state.connections.some(c => subjects.every(subject => c.subscriptions_list?.includes(subject)));
  });
  const alive = JSON.parse(codec.decode((await nc.request(subjects[0], codec.encode('{}'), { timeout: 3_000 })).data));
  assert.deepEqual(alive, { alive: false, task_id: null });
  assert.ok(!worker.output.includes('CLAIMED:'), worker.output);
  await assertEmpty();
  return { worker, server, assertEmpty };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`worker ${signal} completes its real idle drain`, { skip, timeout: 25_000 }, async t => {
    const { worker, assertEmpty } = await fixture(t);
    worker.proc.kill(signal);
    assert.deepEqual(await exited(worker), { code: 0, signal: null }, worker.output);
    assert.equal((worker.output.match(/Agent worker stopped\./g) || []).length, 1);
    assert.ok(!worker.output.includes('permanently closed — exiting for launchd restart'));
    await assertEmpty();
  });
}

test('worker default 15s poll completes an idle stop', { skip, timeout: 35_000 }, async t => {
  const { worker, assertEmpty } = await fixture(t, null);
  worker.proc.kill('SIGTERM');
  assert.deepEqual(await exited(worker, 20_000), { code: 0, signal: null }, worker.output);
  assert.equal((worker.output.match(/Agent worker stopped\./g) || []).length, 1);
  await assertEmpty();
});

test('worker repeated signals during a held real drain complete once', { skip, timeout: 25_000 }, async t => {
  const { worker, server, assertEmpty } = await fixture(t);
  server.proc.kill('SIGSTOP');
  worker.proc.kill('SIGTERM');
  await until(() => worker.output.includes('Received SIGTERM'));
  await delay(1_200);
  assert.equal(worker.result, null, worker.output);
  worker.proc.kill('SIGINT');
  worker.proc.kill('SIGTERM');
  server.proc.kill('SIGCONT');
  assert.deepEqual(await exited(worker), { code: 0, signal: null }, worker.output);
  assert.equal((worker.output.match(/Agent worker stopped\./g) || []).length, 1);
  await assertEmpty();
});

for (const stopRequested of [false, true]) {
  test(`worker unexpected permanent loss${stopRequested ? ' before requested drain starts' : ''} exits for restart`, { skip, timeout: 70_000 }, async t => {
    const { worker, server } = await fixture(t, stopRequested ? 60_000 : 1_000);
    if (stopRequested) {
      worker.proc.kill('SIGTERM');
      await until(() => worker.output.includes('Received SIGTERM'));
    }
    await stop(server.proc);
    assert.deepEqual(await exited(worker, 45_000), { code: 1, signal: null }, worker.output);
    assert.ok(worker.output.includes('permanently closed — exiting for launchd restart'), worker.output);
    assert.ok(!worker.output.includes('Agent worker stopped.'), worker.output);
  });
}

for (const interval of [null, 20_000]) {
  test(`worker ${interval === null ? 'default' : 'late'} request-subscription drain loss is not a clean stop`, { skip, timeout: 70_000 }, async t => {
    const { worker, server } = await fixture(t, interval);
    worker.proc.kill('SIGTERM');
    await until(() => worker.output.includes('Received SIGTERM'));
    await stop(server.proc);
    assert.deepEqual(await exited(worker, 45_000), { code: 1, signal: null }, worker.output);
    assert.ok(!worker.output.includes('Agent worker stopped.'), worker.output);
  });
}
