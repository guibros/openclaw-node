/**
 * fleet-deploy.js — Lead-side fleet deploy orchestrator.
 *
 * This replaces the SSH remote block in mesh-deploy-v2.js.
 * Instead of SSH-ing to each node, it:
 *   1. Reads MESH_NODES KV to discover the fleet
 *   2. Publishes mesh.deploy.trigger on NATS
 *   3. Watches MESH_DEPLOY_RESULTS KV for results
 *   4. Prints results as they arrive
 *
 * Integrate into mesh-deploy-v2.js by replacing the "Remote deploy" section
 * with: await fleetDeploy(opts)
 *
 * Can also be called standalone: node fleet-deploy.js [options]
 */

const { connect, StringCodec } = require('nats');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ───────────────────────────────────────────────────────────────

const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const sc = StringCodec();
const REPO_DIR = process.env.OPENCLAW_REPO_DIR || path.join(os.homedir(), 'openclaw');
const NODE_ID = process.env.OPENCLAW_NODE_ID ||
  os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');

const RESULTS_BUCKET = 'MESH_DEPLOY_RESULTS';
const NODES_BUCKET = 'MESH_NODES';
const HEALTH_BUCKET = 'MESH_NODE_HEALTH';

// Console helpers
const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function ok(msg)     { console.log(`  ${C.green('[OK]')} ${msg}`); }
function warn(msg)   { console.log(`  ${C.yellow('[WARN]')} ${msg}`); }
function fail(msg)   { console.log(`  ${C.red('[FAIL]')} ${msg}`); }
function info(msg)   { console.log(`  ${C.cyan('-->>')} ${msg}`); }
function header(msg) { console.log(`\n${C.bold(`═══ ${msg} ═══`)}\n`); }

function exec(cmd, opts = {}) {
  const { execSync } = require('child_process');
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 60000, ...opts }).trim();
  } catch (err) {
    if (opts.ignoreError) return err.stdout?.trim() || '';
    throw err;
  }
}

// ── Fleet Discovery ──────────────────────────────────────────────────────

/**
 * Discover all nodes in the fleet from NATS KV.
 * Reads from MESH_NODES first, falls back to MESH_NODE_HEALTH.
 */
async function discoverNodes(nc) {
  const js = nc.jetstream();
  const nodes = [];

  // Try MESH_NODES bucket first (deploy-aware registry)
  try {
    const kv = await js.views.kv(NODES_BUCKET, { history: 1 }); // No TTL — node identity persists
    const keys = await kv.keys();
    for await (const key of keys) {
      try {
        const entry = await kv.get(key);
        if (entry && entry.value) {
          nodes.push(JSON.parse(sc.decode(entry.value)));
        }
      } catch {}
    }
  } catch {}

  // Fall back to MESH_NODE_HEALTH if MESH_NODES is empty
  if (nodes.length === 0) {
    try {
      const kv = await js.views.kv(HEALTH_BUCKET, { history: 1, ttl: 120000 });
      const keys = await kv.keys();
      for await (const key of keys) {
        try {
          const entry = await kv.get(key);
          if (entry && entry.value) {
            const health = JSON.parse(sc.decode(entry.value));
            nodes.push({
              nodeId: health.nodeId || key,
              role: health.role || 'worker',
              platform: health.platform || 'unknown',
              deployVersion: null,
              lastSeen: health.reportedAt || null,
            });
          }
        } catch {}
      }
    } catch {}
  }

  return nodes;
}

// ── Fleet Status ─────────────────────────────────────────────────────────

async function showStatus(nc) {
  header('Fleet Deploy Status');

  const nodes = await discoverNodes(nc);
  const localSha = exec('git rev-parse --short HEAD', { cwd: REPO_DIR, ignoreError: true });

  // Fetch to see if remote is ahead
  exec(`git fetch origin main`, { cwd: REPO_DIR, ignoreError: true });
  const remoteSha = exec('git rev-parse --short origin/main', { cwd: REPO_DIR, ignoreError: true });

  console.log(`  Repo:     main @ ${remoteSha} ${localSha === remoteSha ? C.green('(pushed)') : C.yellow('(local: ' + localSha + ')')}`);
  console.log(`  Nodes:    ${nodes.length} registered\n`);

  if (nodes.length === 0) {
    warn('No nodes found in registry. Nodes need to run mesh-deploy-listener or health-publisher.');
    return;
  }

  // Table header
  const pad = (s, n) => (s || '').slice(0, n).padEnd(n);
  console.log(`  ${C.dim(pad('NODE', 22) + pad('ROLE', 10) + pad('VERSION', 10) + pad('STATUS', 10) + 'LAST SEEN')}`);
  console.log(`  ${C.dim('─'.repeat(70))}`);

  for (const node of nodes) {
    const version = node.deployVersion || '—';
    const isCurrent = version === remoteSha;
    const isUs = node.nodeId === NODE_ID;

    // Calculate staleness from lastSeen
    let lastSeen = '—';
    let online = false;
    if (node.lastSeen) {
      const ageMs = Date.now() - new Date(node.lastSeen).getTime();
      const ageSec = Math.round(ageMs / 1000);
      online = ageSec < 120;
      if (ageSec < 60) lastSeen = `${ageSec}s ago`;
      else if (ageSec < 3600) lastSeen = `${Math.floor(ageSec / 60)}m ago`;
      else if (ageSec < 86400) lastSeen = `${Math.floor(ageSec / 3600)}h ago`;
      else lastSeen = `${Math.floor(ageSec / 86400)}d ago`;
    }

    const status = !online ? C.red('OFFLINE')
      : !isCurrent && version !== '—' ? C.yellow('BEHIND')
      : version === '—' ? C.dim('UNKNOWN')
      : C.green('current');

    const nameStr = isUs ? C.bold(node.nodeId) + C.dim(' (you)') : node.nodeId;

    console.log(`  ${pad(nameStr, 22)}${pad(node.role || '—', 10)}${pad(version, 10)}${pad(status, 10)}${lastSeen}`);
  }
  console.log('');
}

// ── Fleet Deploy ─────────────────────────────────────────────────────────

/**
 * Deploy to the fleet:
 *   1. Discover nodes from NATS KV
 *   2. Publish trigger on mesh.deploy.trigger
 *   3. Watch MESH_DEPLOY_RESULTS for results (with timeout)
 *   4. Print results as they stream in
 */
async function fleetDeploy(nc, opts) {
  const { components, targetNodes, dryRun, force, timeoutMs } = opts;
  const timeout = timeoutMs || 120000; // 2 min default

  const nodes = await discoverNodes(nc);
  // Exclude ourselves (we already deployed locally)
  const remoteNodes = targetNodes
    ? nodes.filter(n => targetNodes.includes(n.nodeId))
    : nodes.filter(n => n.nodeId !== NODE_ID);

  if (remoteNodes.length === 0) {
    info('No remote nodes to deploy to');
    return;
  }

  // Get the current SHA to deploy
  const sha = exec('git rev-parse --short HEAD', { cwd: REPO_DIR });
  const rawBranch = exec('git rev-parse --abbrev-ref HEAD', { cwd: REPO_DIR });
  const branch = rawBranch.replace(/[^a-zA-Z0-9._/-]/g, '');
  if (!branch || branch !== rawBranch) {
    throw new Error(`Unsafe branch name from local git: ${rawBranch}`);
  }

  header(`Fleet Deploy: ${sha} → ${remoteNodes.length} node(s)`);

  for (const n of remoteNodes) {
    const online = n.lastSeen && (Date.now() - new Date(n.lastSeen).getTime()) < 120000;
    console.log(`  ${online ? C.green('●') : C.red('●')} ${n.nodeId} (${n.role})${online ? '' : C.dim(' — offline, will catch up')}`);
  }
  console.log('');

  if (dryRun) {
    info('Dry run — would publish deploy trigger. No changes made.');
    return;
  }

  // Get the results KV bucket
  const js = nc.jetstream();
  const resultsKv = await js.views.kv(RESULTS_BUCKET, { history: 5, ttl: 7 * 24 * 60 * 60 * 1000 });

  // Also write a "latest" marker so offline nodes know what to catch up to
  await resultsKv.put('latest', sc.encode(JSON.stringify({ sha, branch, timestamp: new Date().toISOString() })));

  // Publish the trigger
  const trigger = {
    sha,
    branch,
    components: components || ['all'],
    initiator: NODE_ID,
    timestamp: new Date().toISOString(),
    nodes: targetNodes || ['all'],
    force: !!force,
  };

  nc.publish('mesh.deploy.trigger', sc.encode(JSON.stringify(trigger)));
  info(`Trigger published: ${sha} → mesh.deploy.trigger`);

  // Watch for results
  info(`Waiting for ${remoteNodes.length} node(s) to report (${timeout / 1000}s timeout)...`);
  console.log('');

  const expectedNodes = new Set(remoteNodes.map(n => n.nodeId));
  const nodeResults = new Map(); // nodeId → { status, ... }
  const startTime = Date.now();
  let allDone = false;

  // Poll results KV (watching would be better but polling is simpler and reliable)
  while (!allDone && (Date.now() - startTime) < timeout) {
    for (const nodeId of expectedNodes) {
      if (nodeResults.has(nodeId)) continue;

      try {
        const entry = await resultsKv.get(`${sha}-${nodeId}`);
        if (entry && entry.value) {
          const result = JSON.parse(sc.decode(entry.value));

          if (result.status === 'deploying') {
            // Still working — skip for now
            continue;
          }

          nodeResults.set(nodeId, result);
          const dur = result.durationSeconds || '?';

          if (result.status === 'success') {
            ok(`${nodeId} — deployed to ${result.sha} in ${dur}s`);
            if (result.warnings && result.warnings.length > 0) {
              for (const w of result.warnings) {
                warn(`  ${nodeId}: ${w}`);
              }
            }
          } else {
            fail(`${nodeId} — ${result.status} after ${dur}s`);
            if (result.errors) {
              for (const e of result.errors) {
                console.log(`    ${C.red(e)}`);
              }
            }
          }
        }
      } catch {}
    }

    allDone = nodeResults.size >= expectedNodes.size;
    if (!allDone) await new Promise(r => setTimeout(r, 2000)); // Poll every 2s
  }

  // Report stragglers
  console.log('');
  const missing = [...expectedNodes].filter(n => !nodeResults.has(n));
  if (missing.length > 0) {
    warn(`${missing.length} node(s) did not report within ${timeout / 1000}s:`);
    for (const n of missing) {
      console.log(`    ${C.yellow('●')} ${n} — may be offline, will auto-catch-up on reconnect`);
    }
  }

  // Summary — count actual success vs failure from collected results
  const succeeded = [...nodeResults.values()].filter(r => r.status === 'success').length;
  const failed = [...nodeResults.values()].filter(r => r.status !== 'success').length;

  header('Fleet Deploy Summary');
  console.log(`  SHA:       ${sha}`);
  console.log(`  Reported:  ${nodeResults.size}/${expectedNodes.size}`);
  console.log(`  Succeeded: ${C.green(succeeded.toString())}`);
  if (failed > 0) console.log(`  Failed:    ${C.red(failed.toString())}`);
  if (missing.length > 0) console.log(`  Pending:   ${C.yellow(missing.length.toString())} (will auto-catch-up)`);
  console.log('');
}

// ── Standalone CLI ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const showStatusFlag = args.includes('--status');
  const force = args.includes('--force');

  // Parse --component flags
  const components = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' && args[i + 1]) {
      components.push(args[i + 1]);
      i++;
    }
  }

  // Parse --node flags (target specific nodes)
  const targetNodes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      targetNodes.push(args[i + 1]);
      i++;
    }
  }

  // Parse --timeout
  let timeoutMs = 120000;
  const ti = args.indexOf('--timeout');
  if (ti >= 0 && args[ti + 1]) timeoutMs = parseInt(args[ti + 1]) * 1000;

  // Connect to NATS
  let nc;
  try {
    nc = await connect(natsConnectOpts({ name: `deploy-cli-${NODE_ID}`, timeout: 10000 }));
  } catch {
    fail(`Cannot connect to NATS at ${NATS_URL}`);
    process.exit(1);
  }

  try {
    if (showStatusFlag) {
      await showStatus(nc);
    } else {
      await fleetDeploy(nc, {
        components: components.length > 0 ? components : null,
        targetNodes: targetNodes.length > 0 ? targetNodes : null,
        dryRun, force, timeoutMs,
      });
    }
  } finally {
    await nc.close();
  }
}

// Export for integration into mesh-deploy-v2.js
module.exports = { fleetDeploy, showStatus, discoverNodes };

// Standalone mode
if (require.main === module) {
  main().catch(err => { fail(err.message); process.exit(1); });
}
