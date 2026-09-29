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
const entry = process.env.MESH_TASK_DAEMON_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-task-daemon.js', import.meta.url));
const daemonRequire = createRequire(entry);
const natsImplementation = path.join(path.dirname(daemonRequire.resolve('nats/package.json')), 'lib/nats-base-client/nats.js');
const skip = natsServerBin() ? false : 'nats-server not found on PATH';
const livePorts = new Set([4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224]);

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail('owned readiness condition deadline exceeded');
}

async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  try {
    await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000);
  } catch {
    proc.kill('SIGKILL');
    await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000);
    assert.fail('owned process needed forced cleanup');
  }
  assert.equal(proc.exitCode, 0, 'owned process did not stop normally');
  assert.equal(proc.signalCode, null);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-task-ready-'));
  await fs.chmod(root, 0o700);
  const children = [];
  let nc;
  t.after(async () => {
    const failures = [];
    for (const proc of children.reverse()) {
      try { await stop(proc); } catch (error) { failures.push(error.message); }
    }
    if (nc) await nc.close();
    if (failures.length) assert.fail(`owned cleanup failed; retained ${root}: ${failures.join('; ')}`);
    await fs.rm(root, { recursive: true, force: true });
  });
  const port = await freePort();
  const monitorPort = await freePort();
  assert.ok(!livePorts.has(port) && !livePorts.has(monitorPort));
  assert.notEqual(port, monitorPort);
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nhttp: 127.0.0.1:${monitorPort}\njetstream { store_dir: ${JSON.stringify(path.join(root, 'store'))} }\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  nc = await connect({ servers: `nats://127.0.0.1:${port}`, token, maxReconnectAttempts: 0 });
  await nc.flush();
  const preloader = path.join(root, 'hold-flush.cjs');
  await fs.writeFile(preloader, `
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { NatsConnectionImpl } = require(${JSON.stringify(natsImplementation)});
const connect = NatsConnectionImpl.connect;
NatsConnectionImpl.connect = async function (...args) {
  const nc = await connect.apply(this, args);
  let handlersInstalled = false, held = false;
  const subscribe = nc.subscribe.bind(nc), flush = nc.flush.bind(nc);
  nc.subscribe = (subject, ...options) => {
    const sub = subscribe(subject, ...options);
    if (subject === 'mesh.plans.subtask.update') handlersInstalled = true;
    return sub;
  };
  nc.flush = async (...options) => {
    await flush(...options);
    if (!handlersInstalled || held) return;
    held = true;
    fs.writeFileSync(process.env.OWNED_FLUSH_MARKER, 'held', { mode: 0o600 });
    if (process.env.OWNED_FLUSH_MODE === 'fail') throw Error('owned final flush failure');
    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(process.env.OWNED_FLUSH_RELEASE)) {
      if (Date.now() >= deadline) throw Error('owned flush release deadline exceeded');
      await delay(10);
    }
  };
  return nc;
};
`, { mode: 0o600 });

  const start = async (index, mode) => {
    const home = path.join(root, `home-${index}`);
    await fs.mkdir(home, { mode: 0o700 });
    const marker = path.join(home, 'flush-held');
    const release = path.join(home, 'flush-release');
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: root,
      OPENCLAW_HOME: home,
      OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
      OPENCLAW_NODE_ID: `owned-ready-${randomBytes(8).toString('hex')}`,
      OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
      OPENCLAW_NATS_AUTH: 'token',
      OPENCLAW_NATS_TOKEN: token,
    };
    if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
    if (mode) Object.assign(env, { OWNED_FLUSH_MODE: mode, OWNED_FLUSH_MARKER: marker, OWNED_FLUSH_RELEASE: release });
    const proc = spawn(process.execPath, [...(mode ? ['--require', preloader] : []), entry], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(proc);
    const child = { proc, result: null, output: '', ready: false, reply: null, marker, release };
    proc.on('error', error => { child.result = { error }; });
    proc.on('exit', (code, signal) => { child.result = { code, signal }; });
    proc.stdout.on('data', bytes => {
      child.output += bytes;
      if (!child.ready && child.output.includes('Task daemon ready.')) {
        child.ready = true;
        child.reply = nc.request('mesh.tasks.list', codec.encode('{}'), { timeout: 3_000 })
          .then(msg => ({ data: JSON.parse(codec.decode(msg.data)) }), error => ({ error: error.code || error.name }));
      }
    });
    proc.stderr.on('data', bytes => { child.output += bytes; });
    return child;
  };
  const ready = async child => {
    await until(() => {
      assert.equal(child.result, null, child.output.replaceAll(token, '[owned token]'));
      return child.ready;
    });
    assert.deepEqual(await child.reply, { data: { ok: true, data: [] } });
  };
  const stopped = async child => {
    await stop(child.proc);
    assert.deepEqual(child.result, { code: 0, signal: null });
    assert.equal((child.output.match(/Shutdown complete\./g) || []).length, 1);
    await until(async () => {
      const state = await fetch(`http://127.0.0.1:${monitorPort}/connz`).then(r => r.json());
      return state.num_connections === 1;
    });
  };
  return { start, ready, stopped };
}

test('task ready immediately serves a preconnected client without retry', { skip, timeout: 60_000 }, async t => {
  const { start, ready, stopped } = await fixture(t);
  for (let index = 0; index < 10; index++) {
    const child = await start(index);
    await ready(child);
    await stopped(child);
  }
});

test('task ready waits for the real final flush to return', { skip, timeout: 25_000 }, async t => {
  const { start, ready, stopped } = await fixture(t);
  const child = await start(0, 'hold');
  await until(async () => {
    assert.equal(child.result, null, child.output);
    assert.equal(child.ready, false, 'ready preceded the registration barrier');
    return fs.stat(child.marker).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
  });
  await delay(150);
  assert.equal(child.ready, false, 'ready escaped a held flush');
  await fs.writeFile(child.release, 'release', { mode: 0o600 });
  await ready(child);
  await stopped(child);
});

test('task final-flush failure exits without publishing ready', { skip, timeout: 25_000 }, async t => {
  const { start } = await fixture(t);
  const child = await start(0, 'fail');
  await until(() => child.result !== null);
  assert.deepEqual(child.result, { code: 1, signal: null }, child.output);
  assert.equal(child.ready, false);
  assert.ok(child.output.includes('owned final flush failure'), child.output);
  assert.ok(!child.output.includes('Shutdown complete.'), child.output);
});
