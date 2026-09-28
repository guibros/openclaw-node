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
const { connect, StringCodec } = require('nats');
const codec = StringCodec();
const daemonEntry = process.env.TASK_DAEMON_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-task-daemon.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('condition deadline exceeded');
}

async function exited(daemon, timeoutMs = 10_000) {
  await until(() => daemon.result !== null, timeoutMs);
  return daemon.result;
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

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'task-daemon-drain-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) await stop(proc);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  await fs.mkdir(home, { mode: 0o700 });
  const port = await freePort();
  assert.ok(![4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224].includes(port));
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\njetstream { store_dir: ${JSON.stringify(path.join(root, 'store'))} }\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: 'owned-drain-fixture',
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
  };
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  const proc = spawn(process.execPath, [daemonEntry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  const daemon = { proc, result: null, output: '' };
  proc.on('error', (error) => { daemon.result = { error }; });
  proc.on('exit', (code, signal) => { daemon.result = { code, signal }; });
  proc.stdout.on('data', (data) => { daemon.output += data; });
  proc.stderr.on('data', (data) => { daemon.output += data; });
  await until(() => {
    assert.equal(daemon.result, null, daemon.output);
    return daemon.output.includes('Task daemon ready.');
  });
  nc = await connect({ servers: env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  const reply = await nc.request('mesh.tasks.list', codec.encode('{}'), { timeout: 3_000 });
  assert.equal(JSON.parse(codec.decode(reply.data)).ok, true);
  await nc.close();
  nc = null;
  return { daemon, server };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`task daemon ${signal} completes its real planned drain`, { skip, timeout: 20_000 }, async (t) => {
    const { daemon } = await fixture(t);
    daemon.proc.kill(signal);
    assert.deepEqual(await exited(daemon), { code: 0, signal: null }, daemon.output);
    assert.equal((daemon.output.match(/Shutdown complete\./g) || []).length, 1);
    assert.ok(!daemon.output.includes('permanently closed — exiting for launchd restart'));
  });
}

test('task daemon handles repeated signals during a pending real drain once', { skip, timeout: 20_000 }, async (t) => {
  const { daemon, server } = await fixture(t);
  server.proc.kill('SIGSTOP');
  daemon.proc.kill('SIGTERM');
  await until(() => daemon.output.includes('Draining NATS...'));
  daemon.proc.kill('SIGINT');
  daemon.proc.kill('SIGTERM');
  await delay(100);
  assert.equal(daemon.result, null, daemon.output);
  assert.equal((daemon.output.match(/Shutting down\.\.\./g) || []).length, 1);
  server.proc.kill('SIGCONT');
  assert.deepEqual(await exited(daemon), { code: 0, signal: null }, daemon.output);
  assert.equal((daemon.output.match(/Shutdown complete\./g) || []).length, 1);
});

test('task daemon unexpected permanent NATS loss still exits for restart', { skip, timeout: 60_000 }, async (t) => {
  const { daemon, server } = await fixture(t);
  await stop(server.proc);
  assert.deepEqual(await exited(daemon, 45_000), { code: 1, signal: null }, daemon.output);
  assert.ok(daemon.output.includes('permanently closed — exiting for launchd restart'));
  assert.ok(!daemon.output.includes('Shutdown complete.'));
});
