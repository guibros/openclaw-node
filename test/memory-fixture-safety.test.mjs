import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertMemoryFixtureSafety } from '../lib/memory-fixture-safety.mjs';
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
    await fs.writeFile(config, '{"enabled":false}');
    const env = {
      ACCEPT_ISOLATED_MEMORY: '1', OPENCLAW_HOME: root, OPENCLAW_WORKSPACE: workspace,
      OPENCLAW_NATS: 'nats://127.0.0.1:14222', OPENCLAW_NATS_TOKEN: 'fixture-only',
      OPENCLAW_OBSIDIAN_SYNC_CONFIG: config, OBSIDIAN_VAULT_PATH: vault,
    };
    const args = { env, home, script: path.join(workspace, 'bin', 'memory-daemon.mjs'), workspace, configuredWorkspace: workspace };
    assert.doesNotThrow(() => assertMemoryFixtureSafety(args));
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, OPENCLAW_DB_DIR: path.join(os.homedir(), '.openclaw') } }), /OPENCLAW_DB_DIR/);
    assert.throws(() => assertMemoryFixtureSafety({ ...args, env: { ...env, MC_URL: 'http://127.0.0.1:3000' } }), /MC_URL/);
    await fs.writeFile(config, '{"enabled":true}');
    assert.throws(() => assertMemoryFixtureSafety(args), /Obsidian sync/);
    await fs.writeFile(config, '{"enabled":false}');
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
