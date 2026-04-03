#!/usr/bin/env node

/**
 * mesh-node-remove.js — Clean removal of a mesh node.
 *
 * Can be run in two modes:
 *   1. LOCAL:  node bin/mesh-node-remove.js
 *              Removes the local node from the mesh (stops service, cleans KV state)
 *
 *   2. REMOTE: node bin/mesh-node-remove.js --node <nodeId>
 *              Removes a remote/dead node from the mesh (cleans KV state only)
 *
 * What it does:
 *   - Cancels any tasks claimed/running by the node (releases back to queue)
 *   - Publishes mesh.health.<nodeId> with status=removed
 *   - Removes node from MESH_NODES KV bucket (if it exists)
 *   - (Local mode only) Stops and removes the launchd/systemd service
 *   - (Local mode only) Optionally removes ~/.openclaw/ and ~/openclaw/
 *
 * Usage:
 *   node bin/mesh-node-remove.js                    # remove local node
 *   node bin/mesh-node-remove.js --node calos       # remove dead remote node
 *   node bin/mesh-node-remove.js --node calos --force  # skip confirmation
 *   node bin/mesh-node-remove.js --purge            # also delete code + config
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('mesh-node-remove');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const PURGE = args.includes('--purge');

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const TARGET_NODE = getArg('--node', null);
const LOCAL_MODE = !TARGET_NODE;
const NODE_ID = TARGET_NODE || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');

// ── Logging ───────────────────────────────────────────

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg) { console.log(`${CYAN}[mesh-remove]${RESET} ${msg}`); }
function ok(msg)  { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function warn(msg){ console.log(`${YELLOW}  ⚠${RESET} ${msg}`); }
function fail(msg){ console.error(`${RED}  ✗${RESET} ${msg}`); }

// ── Confirmation ─────────────────────────────────────

async function confirm(msg) {
  if (FORCE) return true;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${YELLOW}${msg} [y/N]: ${RESET}`, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ── NATS Operations ──────────────────────────────────

const cleanNatsState = tracer.wrapAsync('cleanNatsState', async function cleanNatsState(nodeId) {
  let natsUrl;
  try {
    const { NATS_URL } = require('../lib/nats-resolve');
    natsUrl = NATS_URL;
  } catch (err) {
    console.warn(`[mesh-node-remove] resolve NATS URL: ${err.message}`);
    // If we're running after code deletion, try env
    natsUrl = process.env.OPENCLAW_NATS || 'nats://100.91.131.61:4222';
  }

  let nats;
  try {
    nats = require('nats');
  } catch {
    warn('NATS module not available — skipping KV cleanup');
    warn('Tasks claimed by this node may need manual cleanup');
    return;
  }

  const sc = nats.StringCodec();

  try {
    const nc = await nats.connect({ servers: natsUrl, timeout: 10000 });
    ok(`NATS connected: ${nc.getServer()}`);

    const js = nc.jetstream();

    // 1. Release/cancel tasks owned by this node
    try {
      const kv = await js.views.kv('MESH_TASKS');
      const keys = await kv.keys();
      const allKeys = [];
      for await (const k of keys) allKeys.push(k);

      let released = 0;
      for (const k of allKeys) {
        const entry = await kv.get(k);
        if (!entry || !entry.value) continue;
        const task = JSON.parse(new TextDecoder().decode(entry.value));

        if (task.owner === nodeId && (task.status === 'claimed' || task.status === 'running')) {
          task.status = 'queued';
          task.owner = null;
          task.claimed_at = null;
          task.started_at = null;
          task.budget_deadline = null;
          task.last_activity = null;
          task.updated_at = new Date().toISOString();
          await kv.put(k, JSON.stringify(task));
          released++;
        }
      }

      if (released > 0) {
        ok(`Released ${released} task(s) back to queue`);
      } else {
        ok('No active tasks to release');
      }
    } catch (e) {
      warn(`Task cleanup error: ${e.message}`);
    }

    // 2. Clean node registry (if MESH_NODES bucket exists)
    try {
      const nodeKv = await js.views.kv('MESH_NODES');
      await nodeKv.delete(nodeId);
      ok(`Removed ${nodeId} from MESH_NODES registry`);
    } catch (err) {
      console.warn(`[mesh-node-remove] clean MESH_NODES entry: ${err.message}`);
      ok('No MESH_NODES registry entry to remove');
    }

    // 3. Publish removal announcement
    nc.publish(`mesh.health.${nodeId}`, sc.encode(JSON.stringify({
      node_id: nodeId,
      status: 'removed',
      event: 'node_removed',
      timestamp: new Date().toISOString(),
    })));
    ok('Removal announcement published');

    await nc.drain();
  } catch (e) {
    warn(`NATS cleanup failed: ${e.message}`);
    warn('The node may still appear in mesh state until TTL expires');
  }
}, { tier: 2, category: 'lifecycle' });

// ── Local Service Removal ────────────────────────────

const removeLocalService = tracer.wrap('removeLocalService', function removeLocalService() {
  const platform = os.platform();

  if (platform === 'darwin') {
    // launchd
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.mesh-agent.plist');
    if (fs.existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'pipe' });
        fs.unlinkSync(plistPath);
        ok('Launchd service stopped and removed');
      } catch (e) {
        warn(`Service removal warning: ${e.message}`);
      }
    } else {
      ok('No launchd service to remove');
    }
  } else if (platform === 'linux') {
    // systemd
    try {
      execSync('systemctl --user stop openclaw-mesh-agent 2>/dev/null || true', { stdio: 'pipe' });
      execSync('systemctl --user disable openclaw-mesh-agent 2>/dev/null || true', { stdio: 'pipe' });
      const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'openclaw-mesh-agent.service');
      if (fs.existsSync(servicePath)) {
        fs.unlinkSync(servicePath);
        execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      }
      ok('Systemd service stopped, disabled, and removed');
    } catch (e) {
      warn(`Service removal warning: ${e.message}`);
    }
  }
}, { tier: 2, category: 'lifecycle' });

// ── Purge Local Files ────────────────────────────────

const purgeLocalFiles = tracer.wrap('purgeLocalFiles', function purgeLocalFiles() {
  const dirs = [
    path.join(os.homedir(), '.openclaw'),
    path.join(os.homedir(), 'openclaw'),
  ];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        ok(`Removed: ${dir}`);
      } catch (e) {
        warn(`Could not remove ${dir}: ${e.message}`);
      }
    }
  }
}, { tier: 2, category: 'lifecycle' });

// ── Main ──────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${RED}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${RED}║   OpenClaw Mesh — Node Removal       ║${RESET}`);
  console.log(`${BOLD}${RED}╚══════════════════════════════════════╝${RESET}\n`);

  log(`Target node: ${BOLD}${NODE_ID}${RESET}`);
  log(`Mode: ${LOCAL_MODE ? 'LOCAL (this machine)' : 'REMOTE (KV cleanup only)'}`);
  if (PURGE) log(`${RED}PURGE MODE — will delete all local files${RESET}`);
  console.log('');

  // Confirmation
  const action = LOCAL_MODE
    ? `Remove local node "${NODE_ID}" from the mesh?`
    : `Remove remote node "${NODE_ID}" from mesh state?`;

  if (!(await confirm(action))) {
    log('Cancelled.');
    return;
  }

  // 1. Clean NATS state (both modes)
  log('Cleaning mesh state...');
  await cleanNatsState(NODE_ID);

  // 2. Stop local service (local mode only)
  if (LOCAL_MODE) {
    log('Removing local service...');
    removeLocalService();
  }

  // 3. Purge files (local mode + --purge only)
  if (LOCAL_MODE && PURGE) {
    if (await confirm('Delete ~/.openclaw/ and ~/openclaw/ permanently?')) {
      log('Purging local files...');
      purgeLocalFiles();
    }
  }

  // Done
  console.log(`\n${BOLD}${GREEN}═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${GREEN}  Node "${NODE_ID}" removed from mesh.${RESET}`);
  console.log(`${BOLD}${GREEN}═══════════════════════════════════════${RESET}\n`);

  if (!LOCAL_MODE) {
    console.log('Note: This only cleaned mesh state. If the node is still');
    console.log('running, its agent will reconnect and re-register.');
    console.log('To fully remove, also stop the service on that machine.');
  }
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});
