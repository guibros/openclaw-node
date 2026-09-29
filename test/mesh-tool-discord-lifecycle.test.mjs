import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, natsServerBin, startNatsServer } from './helpers/nats-server.mjs';

const entry = process.env.DISCORD_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-tool-discord.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';

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

async function fixture(t, config) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-inactive-'));
  const home = path.join(root, 'home');
  await fs.mkdir(path.join(home, '.openclaw'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(home, '.openclaw', 'openclaw.json'),
    typeof config === 'string' ? config : JSON.stringify(config), { mode: 0o600 });
  const children = [];
  t.after(async () => {
    for (const proc of children.reverse()) await stop(proc);
    await fs.rm(root, { recursive: true, force: true });
  });
  const env = {
    HOME: home,
    PATH: process.env.PATH,
    OPENCLAW_WORKSPACE: path.join(home, 'workspace'),
    OPENCLAW_OBS_DB: path.join(home, 'obs.db'),
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: 'owned-discord-fixture',
    OPENCLAW_NATS_AUTH: 'token',
  };
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  function launch(target = entry, prefix = []) {
    const proc = spawn(process.execPath, [...prefix, target], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(proc);
    const tool = { proc, result: null, output: '' };
    proc.on('error', error => { tool.result = { error }; });
    proc.on('exit', (code, signal) => { tool.result = { code, signal }; });
    proc.stdout.on('data', data => { tool.output += data; });
    proc.stderr.on('data', data => { tool.output += data; });
    return tool;
  }
  return { root, home, env, children, launch };
}

for (const token of [undefined, 'owned-fake-token']) {
  test(`explicit disabled Discord exits normally ${token ? 'with' : 'without'} a token and admits no bus or state work`, async t => {
    const f = await fixture(t, { channels: { discord: { enabled: false, token } } });
    let attempts = 0;
    const listener = net.createServer(socket => { attempts++; socket.destroy(); });
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => listener.close(resolve)));
    f.env.OPENCLAW_NATS = `nats://127.0.0.1:${listener.address().port}`;
    const probe = path.join(f.root, 'imports.cjs');
    await fs.writeFile(probe, String.raw`process.on('exit', () => require('fs').writeSync(2, '\nIMPORT_PROBE:' + JSON.stringify({runtimeLoaded: Object.keys(require.cache).some(p => /\/lib\/(mesh-registry|tracer|obs-db)\.js$|\/node_modules\/(nats|better-sqlite3)\//.test(p))}) + '\n'));`);
    const tool = f.launch(entry, ['--require', probe]);
    await until(() => tool.result !== null);
    assert.deepEqual(tool.result, { code: 0, signal: null }, tool.output);
    assert.match(tool.output, /disabled; inactive/);
    assert.match(tool.output, /IMPORT_PROBE:\{"runtimeLoaded":false\}/);
    assert.equal(attempts, 0);
    assert.deepEqual(await fs.readdir(f.home), ['.openclaw']);
    assert.deepEqual(await fs.readdir(path.join(f.home, '.openclaw')), ['openclaw.json']);
  });
}

test('missing Discord config is an unsuccessful configuration fault', async t => {
  const f = await fixture(t, { channels: { discord: { enabled: false } } });
  await fs.unlink(path.join(f.home, '.openclaw', 'openclaw.json'));
  const tool = f.launch();
  await until(() => tool.result !== null);
  assert.deepEqual(tool.result, { code: 1, signal: null }, tool.output);
  assert.match(tool.output, /ENOENT/);
  assert.doesNotMatch(tool.output, /disabled; inactive/);
});

test('disabled Discord exits before loading unavailable runtime libraries', async t => {
  const f = await fixture(t, { channels: { discord: { enabled: false } } });
  const isolated = path.join(f.root, 'tool.js');
  await fs.copyFile(entry, isolated);
  const tool = f.launch(isolated);
  await until(() => tool.result !== null);
  assert.deepEqual(tool.result, { code: 0, signal: null }, tool.output);
  assert.match(tool.output, /disabled; inactive/);
});

for (const config of [
  { channels: { discord: { enabled: true } } },
  { channels: { discord: {} } },
  '{invalid',
]) {
  test(`Discord configuration failure stays unsuccessful: ${typeof config === 'string' ? 'malformed' : config.channels.discord.enabled ? 'enabled without token' : 'legacy without token'}`, async t => {
    const f = await fixture(t, config);
    const tool = f.launch();
    await until(() => tool.result !== null);
    assert.deepEqual(tool.result, { code: 1, signal: null }, tool.output);
    assert.doesNotMatch(tool.output, /disabled; inactive/);
    assert.deepEqual(await fs.readdir(f.home), ['.openclaw']);
  });
}

async function registered(t, legacy = false) {
  const f = await fixture(t, { channels: { discord: legacy ? { token: 'owned-fake-token' } : { enabled: true, token: 'owned-fake-token' } } });
  const port = await freePort();
  assert.ok(![4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224].includes(port));
  const token = randomBytes(32).toString('hex');
  const config = path.join(f.root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nauthorization { token: ${JSON.stringify(token)} }\njetstream { store_dir: ${JSON.stringify(path.join(f.root, 'js'))} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  f.children.push(server.proc);
  f.env.OPENCLAW_NATS = `nats://127.0.0.1:${port}`;
  f.env.OPENCLAW_NATS_TOKEN = token;
  const tool = f.launch();
  await until(() => {
    assert.equal(tool.result, null, tool.output);
    return tool.output.includes('Tool registered in MESH_TOOLS KV.');
  });
  const { connect } = createRequire(import.meta.url)('nats');
  const nc = await connect({ servers: f.env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  t.after(() => nc.close());
  const kv = await nc.jetstream().views.kv('MESH_TOOLS');
  const nodeId = /Connected to NATS\. Node: ([^\n]+)/.exec(tool.output)?.[1];
  assert.ok(nodeId, tool.output);
  const value = await kv.get(`${nodeId}.discord-history`);
  assert.ok(value);
  assert.equal(JSON.parse(Buffer.from(value.value).toString()).name, 'discord-history');
  await nc.close();
  return { tool, server };
}

for (const legacy of [false, true]) {
  test(`enabled Discord ${legacy ? 'legacy token config' : 'explicit true'} still registers and stops normally`, { skip, timeout: 20_000 }, async t => {
    const { tool } = await registered(t, legacy);
    tool.proc.kill('SIGTERM');
    await until(() => tool.result !== null);
    assert.deepEqual(tool.result, { code: 0, signal: null }, tool.output);
  });
}

test('enabled Discord permanent bus loss remains unsuccessful for conditional restart', { skip, timeout: 60_000 }, async t => {
  const { tool, server } = await registered(t);
  await server.stop();
  await until(() => tool.result !== null, 45_000);
  assert.deepEqual(tool.result, { code: 1, signal: null }, tool.output);
  assert.match(tool.output, /Fatal:/);
});
