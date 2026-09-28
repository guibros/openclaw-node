import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, natsServerBin, startNatsServer } from './helpers/nats-server.mjs';

const require = createRequire(import.meta.url);
const { connect } = require('nats');
const entry = process.env.BRIDGE_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-bridge.js', import.meta.url));
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

async function exited(bridge, timeoutMs = 10_000) {
  await until(() => bridge.result !== null, timeoutMs);
  return bridge.result;
}

async function fixture(t, interval = 100) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bridge-drain-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) await stop(proc);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const memory = path.join(home, '.openclaw', 'workspace', 'memory');
  await fs.mkdir(memory, { recursive: true, mode: 0o700 });
  const kanban = path.join(memory, 'active-tasks.md');
  const original = '# Owned fixture\n\n## Live Tasks\n\n- task_id: owned-local-card\n  title: Preserve this local card\n  status: waiting-user\n  execution: local\n';
  await fs.writeFile(kanban, original, { mode: 0o600 });
  const port = await freePort();
  const monitorPort = await freePort();
  assert.ok(!livePorts.includes(port) && !livePorts.includes(monitorPort));
  assert.notEqual(port, monitorPort);
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nhttp: 127.0.0.1:${monitorPort}\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: 'owned-bridge-fixture',
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
  };
  if (interval !== null) env.BRIDGE_DISPATCH_INTERVAL = String(interval);
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  const proc = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  const bridge = { proc, result: null, output: '' };
  proc.on('error', (error) => { bridge.result = { error }; });
  proc.on('exit', (code, signal) => { bridge.result = { code, signal }; });
  proc.stdout.on('data', (data) => { bridge.output += data; });
  proc.stderr.on('data', (data) => { bridge.output += data; });
  await until(async () => {
    assert.equal(bridge.result, null, bridge.output);
    const state = await fetch(`http://127.0.0.1:${monitorPort}/connz?subs=1`).then(r => r.json());
    return state.connections.some(c => c.subscriptions_list?.includes('mesh.events.>') && c.subscriptions_list?.includes('mesh.bridge.wake'));
  });
  nc = await connect({ servers: env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  nc.publish('mesh.bridge.wake');
  await nc.flush();
  await until(() => bridge.output.includes('WAKE: received wake signal'));
  await nc.close();
  nc = null;
  assert.ok(bridge.output.includes('RECONCILE: no orphaned mesh tasks found'), bridge.output);
  const assertKanban = async () => assert.equal(await fs.readFile(kanban, 'utf8'), original);
  return { bridge, server, assertKanban };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`bridge ${signal} completes its real planned drain`, { skip, timeout: 20_000 }, async (t) => {
    const { bridge, assertKanban } = await fixture(t);
    bridge.proc.kill(signal);
    assert.deepEqual(await exited(bridge), { code: 0, signal: null }, bridge.output);
    assert.equal((bridge.output.match(/Bridge stopped\./g) || []).length, 1);
    assert.ok(!bridge.output.includes('permanently closed — exiting for launchd restart'));
    await assertKanban();
  });
}

test('bridge default poll interval still completes a planned stop', { skip, timeout: 25_000 }, async (t) => {
  const { bridge, assertKanban } = await fixture(t, null);
  bridge.proc.kill('SIGTERM');
  assert.deepEqual(await exited(bridge, 15_000), { code: 0, signal: null }, bridge.output);
  assert.equal((bridge.output.match(/Bridge stopped\./g) || []).length, 1);
  await assertKanban();
});

test('bridge repeated signals during a pending real drain complete once', { skip, timeout: 20_000 }, async (t) => {
  const { bridge, server, assertKanban } = await fixture(t);
  server.proc.kill('SIGSTOP');
  bridge.proc.kill('SIGTERM');
  await until(() => bridge.output.includes('SIGTERM received'));
  await delay(300);
  assert.equal(bridge.result, null, bridge.output);
  bridge.proc.kill('SIGINT');
  bridge.proc.kill('SIGTERM');
  await delay(100);
  assert.equal(bridge.result, null, bridge.output);
  server.proc.kill('SIGCONT');
  assert.deepEqual(await exited(bridge), { code: 0, signal: null }, bridge.output);
  assert.equal((bridge.output.match(/Bridge stopped\./g) || []).length, 1);
  await assertKanban();
});

for (const stopRequested of [false, true]) {
  test(`bridge unexpected permanent loss${stopRequested ? ' before the requested drain starts' : ''} still exits for restart`, { skip, timeout: 60_000 }, async (t) => {
    const { bridge, server, assertKanban } = await fixture(t, stopRequested ? 60_000 : 100);
    if (stopRequested) {
      bridge.proc.kill('SIGTERM');
      await until(() => bridge.output.includes('SIGTERM received'));
    }
    await stop(server.proc);
    assert.deepEqual(await exited(bridge, 45_000), { code: 1, signal: null }, bridge.output);
    assert.ok(bridge.output.includes('permanently closed — exiting for launchd restart'));
    assert.ok(!bridge.output.includes('Bridge stopped.'));
    await assertKanban();
  });
}
