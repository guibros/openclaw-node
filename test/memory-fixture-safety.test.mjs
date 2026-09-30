import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertMemoryFixtureSafety, verifyMemoryFixtureBus } from '../lib/memory-fixture-safety.mjs';
import { acquireMemoryDaemonSingleton } from '../lib/memory-daemon-singleton.mjs';

test('fixture startup refuses live service access before any daemon work', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-fixture-safety-'));
  const root = path.join(home, '.openclaw');
  const workspace = path.join(root, 'workspace');
  const config = path.join(root, 'config', 'obsidian-sync.json');
  const vault = path.join(root, 'vault');
  try {
    await fs.mkdir(path.join(workspace, 'bin'), { recursive: true });
    await fs.mkdir(path.dirname(config), { recursive: true });
    await fs.mkdir(vault);
    await fs.mkdir(path.join(root, 'model-cache'));
    await fs.writeFile(config, '{"enabled":false}');
    await fs.writeFile(path.join(root, 'ACCEPTANCE_FIXTURE'), '{"type":"node-readiness-memory-fixture-v1","natsServerName":"acc-test1234"}');
    const env = {
      ACCEPT_ISOLATED_MEMORY: '1', OPENCLAW_HOME: root, OPENCLAW_WORKSPACE: workspace,
      OPENCLAW_NATS: 'nats://127.0.0.1:14222', OPENCLAW_NATS_TOKEN: 'fixture-only',
      OPENCLAW_NODE_ID: 'acc-test1234', NATS_MONITOR_URL: 'http://127.0.0.1:18222',
      OPENCLAW_OBSIDIAN_SYNC_CONFIG: config, OBSIDIAN_VAULT_PATH: vault,
      OPENCLAW_MODEL_CACHE: path.join(root, 'model-cache'),
    };
    const args = { env, home, accountHome: path.join(home, 'fresh-account'),
      script: path.join(workspace, 'bin', 'memory-daemon.mjs'), workspace, configuredWorkspace: workspace };
    assert.doesNotThrow(() => assertMemoryFixtureSafety(args));
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, ACCEPT_ISOLATED_MEMORY: undefined } }), /marker and ACCEPT_ISOLATED_MEMORY/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, accountHome: home }), /overlaps live/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, OPENCLAW_DB_DIR: path.join(os.homedir(), '.openclaw') } }), /OPENCLAW_DB_DIR/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, OPENCLAW_NODE_ID: 'live-node' } }), /marker and node identity/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, MC_URL: 'http://127.0.0.1:3000' } }), /MC_URL/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, OPENCLAW_MODEL_CACHE: path.join(os.homedir(), '.cache') } }), /write path outside/);
    await fs.writeFile(config, '{"enabled":true}');
    assert.throws(() => assertMemoryFixtureSafety(args), /Obsidian sync/);
    await fs.writeFile(config, '{"enabled":false}');
    const alternate = path.join(root, 'config', 'alternate.json');
    await fs.writeFile(alternate, '{"enabled":true}');
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, OPENCLAW_OBSIDIAN_SYNC_CONFIG: alternate } }), /Obsidian config/);
    await fs.writeFile(path.join(root, 'config', 'mc-session-token'), 'fixture-secret');
    assert.throws(() => assertMemoryFixtureSafety(args), /live-service credentials/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('only one daemon can own a HOME and a stopped owner releases it', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-daemon-lock-'));
  try {
    const owner = await acquireMemoryDaemonSingleton(home);
    await assert.rejects(() => acquireMemoryDaemonSingleton(home), /already owns this HOME/);
    await owner.close();
    const next = await acquireMemoryDaemonSingleton(home);
    await next.close();
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('fixture bus refuses a different monitor or linked topology before the daemon uses JetStream', async () => {
  const fixture = { natsServerName: 'acc-test1234' };
  const nc = { info: { server_name: fixture.natsServerName, server_id: 'private-id' } };
  const bodies = {
    varz: { server_id: 'private-id', server_name: fixture.natsServerName },
    routez: { server_id: 'private-id', routes: [] },
    leafz: { server_id: 'private-id', leafnodes: 0 },
    gatewayz: { server_id: 'private-id', inbound_gateways: {}, outbound_gateways: {} },
  };
  const monitor = async (url) => ({ ok: true, json: async () => bodies[url.split('/').at(-1)] });
  await verifyMemoryFixtureBus(nc, fixture, 'http://127.0.0.1:18222', monitor);
  await assert.rejects(() => verifyMemoryFixtureBus({ info: { ...nc.info, server_name: 'live' } }, fixture,
    'http://127.0.0.1:18222', monitor), /identity/);
  bodies.routez.routes.push({ rid: 1 });
  await assert.rejects(() => verifyMemoryFixtureBus(nc, fixture,
    'http://127.0.0.1:18222', monitor), /routez/);
  bodies.routez.routes.length = 0;
  bodies.varz.server_id = 'other-server';
  await assert.rejects(() => verifyMemoryFixtureBus(nc, fixture,
    'http://127.0.0.1:18222', monitor), /varz/);
});
