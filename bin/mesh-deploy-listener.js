#!/usr/bin/env node

/**
 * mesh-deploy-listener.js — Fleet deploy receiver daemon.
 *
 * Runs on every node. When the lead publishes a deploy trigger on NATS,
 * this daemon pulls from git and self-deploys. No SSH needed.
 *
 * NATS subjects:
 *   mesh.deploy.trigger    — deploy command from lead
 *   mesh.deploy.status     — status query from lead (request/reply)
 *
 * NATS KV buckets:
 *   MESH_DEPLOY_RESULTS    — write deploy result per node per SHA
 *   MESH_NODES             — update deployVersion after success
 */

const { connect, StringCodec } = require('nats');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-deploy-listener');

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = process.env.OPENCLAW_NODE_ID ||
  os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
// NOTE: REPO_DIR defaults to ~/openclaw (runtime). The git repo lives at
// ~/openclaw-node. See mesh-deploy.js "Two-directory problem" comment.
const REPO_DIR = process.env.OPENCLAW_REPO_DIR ||
  path.join(os.homedir(), 'openclaw');
const REPO_REMOTE_URL = process.env.OPENCLAW_REPO_URL ||
  'https://github.com/moltyguibros-design/openclaw-node.git';
const DEPLOY_SCRIPT = path.join(REPO_DIR, 'bin', 'mesh-deploy.js');

const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const sc = StringCodec();

const RESULTS_BUCKET = 'MESH_DEPLOY_RESULTS';
const NODES_BUCKET = 'MESH_NODES';
const IS_MAC = os.platform() === 'darwin';

// Node role — determines which components this node runs.
function resolveNodeRole() {
  if (process.env.OPENCLAW_NODE_ROLE) return process.env.OPENCLAW_NODE_ROLE;
  try {
    const envFile = path.join(os.homedir(), '.openclaw', 'openclaw.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NODE_ROLE\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch (err) { console.warn(`[deploy-listener] resolve node role: ${err.message}`); }
  return IS_MAC ? 'lead' : 'worker';
}
const NODE_ROLE = resolveNodeRole();

const { ROLE_COMPONENTS } = require('../lib/mesh-roles');
const NODE_COMPONENTS = new Set(ROLE_COMPONENTS[NODE_ROLE] || ROLE_COMPONENTS.worker);

let deploying = false; // prevent concurrent deploys

// ── Deploy Execution ─────────────────────────────────────────────────────

async function executeDeploy(trigger, resultsKv, nodesKv) {
  if (deploying) {
    console.log(`[deploy-listener] Already deploying — ignoring trigger for ${trigger.sha} (from ${trigger.initiator || 'unknown'})`);
    return;
  }

  deploying = true;
  const startedAt = new Date().toISOString();
  // Sanitize sha for NATS KV key safety (KV rejects whitespace, path seps, etc.)
  const safeSha = (trigger.sha || 'unknown').replace(/[^a-fA-F0-9.-]/g, '');
  const resultKey = `${safeSha}-${NODE_ID}`;

  try {
    console.log(`[deploy-listener] ═══ Deploy triggered: ${trigger.sha} by ${trigger.initiator} ═══`);

    // Write "deploying" status so lead sees we're working
    try {
      await resultsKv.put(resultKey, sc.encode(JSON.stringify({
        nodeId: NODE_ID, sha: trigger.sha, status: 'deploying', startedAt,
      })));
    } catch (err) { console.warn(`[deploy-listener] write deploying status: ${err.message}`); }

    const result = {
      nodeId: NODE_ID,
      sha: trigger.sha,
      status: 'success',
      startedAt,
      completedAt: null,
      durationSeconds: 0,
      componentsDeployed: [],
      warnings: [],
      errors: [],
      log: '',
    };

    try {
      // Validate branch name to prevent command injection (trigger.branch comes from NATS)
      const branch = (trigger.branch || 'main').replace(/[^a-zA-Z0-9._/-]/g, '');
      if (!branch || branch !== (trigger.branch || 'main')) {
        throw new Error(`Invalid branch name: ${trigger.branch}`);
      }

      // Bootstrap git repo if directory exists but .git doesn't
      // (provisioner may have copied files without git clone)
      if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
        if (!fs.existsSync(REPO_DIR)) {
          throw new Error(`Repo dir not found at ${REPO_DIR}`);
        }
        console.log(`[deploy-listener] No .git found — bootstrapping git repo`);
        execSync('git init', { cwd: REPO_DIR, encoding: 'utf8', timeout: 10000 });
        execSync(`git remote add origin ${REPO_REMOTE_URL}`, {
          cwd: REPO_DIR, encoding: 'utf8', timeout: 10000,
        });
        console.log(`[deploy-listener] git fetch origin ${branch}...`);
        execSync(`git fetch origin ${branch}`, {
          cwd: REPO_DIR, encoding: 'utf8', timeout: 60000,
        });
        console.log(`[deploy-listener] git reset --hard origin/${branch}...`);
        execSync(`git reset --hard origin/${branch}`, {
          cwd: REPO_DIR, encoding: 'utf8', timeout: 30000,
        });
        console.log(`[deploy-listener] Git bootstrapped from origin/${branch}`);
      } else {
        // Normal path: fetch + ff merge
        console.log(`[deploy-listener] git fetch origin ${branch}...`);
        execSync(`git fetch origin ${branch}`, {
          cwd: REPO_DIR, encoding: 'utf8', timeout: 60000,
        });
        console.log(`[deploy-listener] git merge origin/${branch} --ff-only...`);
        execSync(`git merge origin/${branch} --ff-only`, {
          cwd: REPO_DIR, encoding: 'utf8', timeout: 30000,
        });
      }

      // Build deploy command — filter requested components against what this node runs
      let cmd = `"${process.execPath}" "${DEPLOY_SCRIPT}" --local`;
      if (trigger.components && !trigger.components.includes('all')) {
        const applicable = trigger.components.filter(c => NODE_COMPONENTS.has(c));
        if (applicable.length === 0) {
          console.log(`[deploy-listener] No applicable components for role=${NODE_ROLE} — skipping`);
          result.status = 'skipped';
          result.log = `No matching components for role ${NODE_ROLE}`;
          result.completedAt = new Date().toISOString();
          try { await resultsKv.put(resultKey, sc.encode(JSON.stringify(result))); } catch (err) { console.warn(`[deploy-listener] write skipped result: ${err.message}`); }
          return;
        }
        for (const c of applicable) cmd += ` --component ${c}`;
      }
      if (trigger.force) cmd += ' --force';

      console.log(`[deploy-listener] Running: ${cmd}`);
      const output = execSync(cmd, {
        cwd: REPO_DIR,
        encoding: 'utf8',
        timeout: 300000, // 5 min max (npm install can be slow)
        env: { ...process.env, OPENCLAW_REPO_DIR: REPO_DIR },
      });

      result.log = output.slice(-5000);
      result.status = 'success';
      result.sha = execSync('git rev-parse --short HEAD', {
        cwd: REPO_DIR, encoding: 'utf8',
      }).trim();

      console.log(`[deploy-listener] Success — now at ${result.sha}`);

    } catch (err) {
      result.status = 'failed';
      result.errors.push(err.message);
      result.log = (err.stdout || err.stderr || err.message).slice(-5000);
      console.error(`[deploy-listener] Deploy FAILED: ${err.message}`);
    }

    result.completedAt = new Date().toISOString();
    result.durationSeconds = Math.round(
      (new Date(result.completedAt) - new Date(result.startedAt)) / 1000
    );

    // Write final result to KV
    try {
      await resultsKv.put(resultKey, sc.encode(JSON.stringify(result)));
    } catch (err) {
      console.error(`[deploy-listener] Failed to write result: ${err.message}`);
    }

    // Update our deployVersion in the nodes registry
    if (result.status === 'success' && nodesKv) {
      try {
        const existing = await nodesKv.get(NODE_ID);
        if (existing && existing.value) {
          const node = JSON.parse(sc.decode(existing.value));
          node.deployVersion = result.sha;
          node.lastDeploy = result.completedAt;
          await nodesKv.put(NODE_ID, sc.encode(JSON.stringify(node)));
          console.log(`[deploy-listener] Updated node registry: deployVersion=${result.sha.slice(0,7)}`);
        }
      } catch (err) { console.warn(`[deploy-listener] update node deploy version: ${err.message}`); }
    }
  } finally {
    deploying = false;
  }
}

// ── Auto-Catch-Up ────────────────────────────────────────────────────────

/**
 * On startup, check if we're behind the latest deployed version.
 * If another deploy happened while we were offline, catch up now.
 */
async function checkAndCatchUp(resultsKv, nodesKv) {
  try {
    // Read the latest deploy SHA from the "latest" key
    const latest = await resultsKv.get('latest');
    if (!latest || !latest.value) return;

    const { sha, branch } = JSON.parse(sc.decode(latest.value));
    const currentSha = execSync('git rev-parse --short HEAD', {
      cwd: REPO_DIR, encoding: 'utf8',
    }).trim();

    if (currentSha !== sha) {
      console.log(`[deploy-listener] Behind: local=${currentSha} latest=${sha} — catching up`);
      await executeDeploy(
        { sha, branch: branch || 'main', components: ['all'], initiator: 'auto-catchup' },
        resultsKv, nodesKv
      );
    } else {
      console.log(`[deploy-listener] Up to date at ${currentSha}`);
    }
  } catch (err) {
    console.log(`[deploy-listener] Catch-up check skipped: ${err.message}`);
  }
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
executeDeploy = tracer.wrapAsync('executeDeploy', executeDeploy, { tier: 2, category: 'lifecycle' });
checkAndCatchUp = tracer.wrapAsync('checkAndCatchUp', checkAndCatchUp, { tier: 2, category: 'lifecycle' });

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[deploy-listener] Node: ${NODE_ID}`);
  console.log(`[deploy-listener] Repo: ${REPO_DIR}`);
  console.log(`[deploy-listener] NATS: ${NATS_URL}`);

  // Connect to NATS with infinite retry
  let nc;
  while (true) {
    try {
      nc = await connect(natsConnectOpts({
        name: `deploy-listener-${NODE_ID}`,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 5000,
        timeout: 10000,
      }));
      break;
    } catch (err) {
      console.log(`[deploy-listener] NATS connect failed, retrying in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  console.log(`[deploy-listener] NATS connected`);
  setNatsConnection(nc, sc);

  // Get KV buckets
  const js = nc.jetstream();
  const resultsKv = await js.views.kv(RESULTS_BUCKET, { history: 5, ttl: 7 * 24 * 60 * 60 * 1000 });
  let nodesKv = null;
  try {
    nodesKv = await js.views.kv(NODES_BUCKET, { history: 1 }); // No TTL — node identity persists
  } catch (err) { console.warn(`[deploy-listener] open MESH_NODES bucket: ${err.message}`); }

  // Check for missed deploys while we were offline
  await checkAndCatchUp(resultsKv, nodesKv);

  // Subscribe to deploy triggers
  const sub = nc.subscribe('mesh.deploy.trigger');
  console.log(`[deploy-listener] Listening on mesh.deploy.trigger`);

  (async () => {
    for await (const msg of sub) {
      try {
        const trigger = JSON.parse(sc.decode(msg.data));

        // Ignore triggers for specific nodes that don't include us
        if (trigger.nodes && !trigger.nodes.includes(NODE_ID) && !trigger.nodes.includes('all')) {
          console.log(`[deploy-listener] Trigger not for us — target: ${trigger.nodes.join(', ')}`);
          continue;
        }

        await executeDeploy(trigger, resultsKv, nodesKv);
      } catch (err) {
        console.error(`[deploy-listener] Error handling trigger: ${err.message}`);
      }
    }
  })();

  // Respond to status queries (request/reply)
  const statusSub = nc.subscribe(`mesh.deploy.status.${NODE_ID}`);
  (async () => {
    for await (const msg of statusSub) {
      let currentSha = 'unknown';
      try {
        currentSha = execSync('git rev-parse --short HEAD', {
          cwd: REPO_DIR, encoding: 'utf8',
        }).trim();
      } catch (err) { console.warn(`[deploy-listener] read git HEAD: ${err.message}`); }

      const response = {
        nodeId: NODE_ID,
        deployVersion: currentSha,
        deploying,
        repoDir: REPO_DIR,
        platform: os.platform(),
      };

      if (msg.reply) {
        msg.respond(sc.encode(JSON.stringify(response)));
      }
    }
  })();

  // NATS status monitoring
  (async () => {
    for await (const s of nc.status()) {
      console.log(`[deploy-listener] NATS: ${s.type}`);
      // On reconnect, check for missed deploys
      if (s.type === 'reconnect') {
        await checkAndCatchUp(resultsKv, nodesKv);
      }
    }
  })();

  // Graceful shutdown
  const shutdown = async (sig) => {
    console.log(`[deploy-listener] ${sig} — shutting down`);
    await nc.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[deploy-listener] ═══ Ready ═══`);
}

main().catch(err => {
  console.error(`[deploy-listener] Fatal: ${err.message}`);
  process.exit(1);
});
