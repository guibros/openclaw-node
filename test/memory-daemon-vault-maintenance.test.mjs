import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vault sync and graph refresh run on their own throttle without a session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-vault-maintenance-'));
  try {
    const home = path.join(root, 'home');
    const workspace = path.join(root, 'workspace');
    const vault = path.join(root, 'vault');
    const syncMarker = path.join(root, 'sync-runs');
    fs.mkdirSync(path.join(home, '.openclaw', 'config'), { recursive: true });
    fs.mkdirSync(path.join(workspace, '.tmp'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'concepts'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'concepts', 'Alpha.md'), 'Alpha links to [[Beta]].\n');
    fs.writeFileSync(path.join(home, '.openclaw', 'config', 'obsidian-sync.json'),
      JSON.stringify({ memoryVaultPath: vault }));
    fs.writeFileSync(path.join(workspace, 'bin', 'obsidian-sync.mjs'),
      "import fs from 'node:fs'; fs.appendFileSync(process.env.TEST_SYNC_MARKER, 'x');\n");

    const child = `
      const daemon = await import('./workspace-bin/memory-daemon.mjs');
      const config = { intervals: { obsidianSyncMs: 60000, maintenanceMs: 60000 } };
      await daemon.runNodeVaultMaintenance(config);
      await daemon.runNodeVaultMaintenance(config);
      const { createGraphCache } = await import('./bin/obsidian-graph-cache.mjs');
      const cache = createGraphCache();
      console.log(JSON.stringify(cache.getStats()));
      cache.close();
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
      cwd: repo,
      env: {
        HOME: home,
        PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
        OPENCLAW_WORKSPACE: workspace,
        OPENCLAW_OBSIDIAN_SYNC_CONFIG: path.join(home, '.openclaw', 'config', 'obsidian-sync.json'),
        GRAPH_CACHE_DB_PATH: path.join(root, 'graph-cache.db'),
        OPENCLAW_OBS_DB: path.join(root, 'obs.db'),
        OPENCLAW_NATS: 'nats://127.0.0.1:1',
        LLM_BASE_URL: 'http://127.0.0.1:1',
        OPENCLAW_NODE_ID: 'owned-vault-test',
        OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART: '1',
        TEST_SYNC_MARKER: syncMarker,
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(syncMarker, 'utf8'), 'x');
    const stats = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.ok(stats.nodeCount > 0);
    assert.ok(stats.lastRefreshAt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
