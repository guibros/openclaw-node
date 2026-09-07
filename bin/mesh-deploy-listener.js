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
const { execSync, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-deploy-listener');

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = require('../lib/node-id').resolveNodeId();
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

// Local deploy marker (P4-9): the last outcome on THIS node, per sha. The KV
// result can be lost with the bucket; this file survives restarts and is what
// the catch-up check consults before re-running a deploy that already failed.
const DEPLOY_MARKER = process.env.OPENCLAW_DEPLOY_MARKER ||
  path.join(os.homedir(), '.openclaw', '.last-deploy.json');
// A failed deploy self-reverts and is re-attempted at most this many times
// per sha (a broken commit must not be retried on every restart forever).
const MAX_DEPLOY_ATTEMPTS = parseInt(process.env.OPENCLAW_MAX_DEPLOY_ATTEMPTS || '2', 10);

function readDeployMarker() {
  try { return JSON.parse(fs.readFileSync(DEPLOY_MARKER, 'utf8')); } catch { return null; }
}
function writeDeployMarker(marker) {
  try {
    fs.mkdirSync(path.dirname(DEPLOY_MARKER), { recursive: true });
    fs.writeFileSync(DEPLOY_MARKER, JSON.stringify(marker, null, 2) + '\n');
  } catch (err) { console.warn(`[deploy-listener] write deploy marker: ${err.message}`); }
}

/**
 * Decide whether the catch-up check should (re)deploy `latest`.
 * Pure so it is unit-testable. `lastDeploy` is this node's local marker.
 *   - HEAD already at latest AND the last attempt for it succeeded → no.
 *   - HEAD at latest but that deploy FAILED (rollback impossible or
 *     incomplete) → yes, it is not done just because the tree moved.
 *   - latest already failed `maxAttempts` times here → no (operator's turn).
 */
function shouldCatchUp({ currentSha, latestSha, lastDeploy, maxAttempts = MAX_DEPLOY_ATTEMPTS }) {
  const same = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
  const lastForLatest = lastDeploy && same(lastDeploy.sha, latestSha) ? lastDeploy : null;
  if (lastForLatest && lastForLatest.status === 'failed' && (lastForLatest.attempts || 0) >= maxAttempts) {
    return { deploy: false, reason: `sha ${latestSha} failed ${lastForLatest.attempts}× here — not retrying automatically` };
  }
  if (same(currentSha, latestSha)) {
    if (lastForLatest && lastForLatest.status === 'failed') {
      return { deploy: true, reason: `tree is at ${latestSha} but its deploy failed — re-attempting` };
    }
    return { deploy: false, reason: `up to date at ${currentSha}` };
  }
  return { deploy: true, reason: `behind: local=${currentSha} latest=${latestSha}` };
}

// A deploy rewrites this node (`git reset --hard`) — every outcome is worth a
// ledgered desktop popup, not just a console line nobody watches.
const NOTIFY_CLI = path.join(__dirname, 'openclaw-notify.mjs');
const MC_MESH_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/mesh`;
function notifyDesktop(kind, title, message) {
  try {
    execFile(process.execPath, [
      NOTIFY_CLI, '--source', 'mesh-deploy', '--kind', kind,
      '--title', title, '--message', message, '--url', MC_MESH_URL,
    ], { timeout: 10_000 }, () => {});
  } catch { /* best-effort */ }
}

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

    // Pre-deploy SHA (P4-9): the point to roll back to if anything after the
    // fetch fails. Null when there is no git tree yet (bootstrap path) — then
    // there is nothing to revert to and the failure is reported as-is.
    let preSha = null;
    try {
      preSha = execSync('git rev-parse HEAD', { cwd: REPO_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    } catch { /* no repo yet */ }
    const prior = readDeployMarker();
    const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
    const attempts = (prior && sameSha(prior.sha, trigger.sha) ? (prior.attempts || 0) : 0) + 1;

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

      // Rollback (P4-9): a failed deploy used to leave the tree at the new
      // commit with services half-restarted, and the catch-up check then saw
      // HEAD == latest and called it done. Revert the tree and re-run the
      // deploy script on the known-good commit so services match the tree.
      if (preSha) {
        try {
          const nowSha = execSync('git rev-parse HEAD', { cwd: REPO_DIR, encoding: 'utf8', timeout: 5000 }).trim();
          if (nowSha !== preSha) {
            console.log(`[deploy-listener] Rolling back ${nowSha.slice(0, 7)} → ${preSha.slice(0, 7)}`);
            execFileSync('git', ['reset', '--hard', preSha], { cwd: REPO_DIR, encoding: 'utf8', timeout: 30000 });
            execSync(`"${process.execPath}" "${DEPLOY_SCRIPT}" --local`, {
              cwd: REPO_DIR, encoding: 'utf8', timeout: 300000,
              env: { ...process.env, OPENCLAW_REPO_DIR: REPO_DIR },
            });
            result.rolledBack = true;
            result.rollbackSha = preSha.slice(0, 7);
            console.log(`[deploy-listener] Rolled back to ${preSha.slice(0, 7)} and redeployed`);
          }
        } catch (rbErr) {
          result.rolledBack = false;
          result.errors.push(`rollback failed: ${rbErr.message}`);
          console.error(`[deploy-listener] ROLLBACK FAILED: ${rbErr.message} — node is at an unverified tree`);
        }
      }
    }

    result.completedAt = new Date().toISOString();
    result.attempts = attempts;
    // Local marker: what this node last tried, and how it ended.
    writeDeployMarker({
      sha: trigger.sha, status: result.status, attempts,
      completedAt: result.completedAt, preSha: preSha ? preSha.slice(0, 7) : null,
      rolledBack: result.rolledBack ?? null, initiator: trigger.initiator || null,
    });
    result.durationSeconds = Math.round(
      (new Date(result.completedAt) - new Date(result.startedAt)) / 1000
    );

    // Write final result to KV
    try {
      await resultsKv.put(resultKey, sc.encode(JSON.stringify(result)));
    } catch (err) {
      console.error(`[deploy-listener] Failed to write result: ${err.message}`);
    }

    if (result.status === 'success') {
      notifyDesktop('success', 'Mesh deploy applied', `${NODE_ID} now at ${result.sha} (${result.durationSeconds}s)`);
    } else if (result.status === 'failed') {
      const where = result.rolledBack ? `rolled back to ${result.rollbackSha}` : (result.rolledBack === false ? 'ROLLBACK FAILED' : 'no rollback point');
      notifyDesktop('error', 'Mesh deploy FAILED', `${NODE_ID} (${where}, attempt ${attempts}/${MAX_DEPLOY_ATTEMPTS}): ${result.errors[0]?.slice(0, 160) || 'unknown'}`);
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
    // Read the latest deploy marker from the "latest" key
    const latest = await resultsKv.get('latest');
    if (!latest || !latest.value) return;

    const marker = JSON.parse(sc.decode(latest.value));

    // C2: the marker steers a `git reset --hard` exactly like a live trigger —
    // it gets the same signature+trust gate (no freshness: markers are state,
    // read possibly days after the deploy). Without this, the signed-trigger
    // check was fully bypassed on every startup/reconnect by whoever could
    // write one KV key.
    const { verifyDeployMarker } = await import('../lib/deploy-trigger-auth.mjs');
    const auth = verifyDeployMarker(marker);
    if (!auth.ok) {
      console.error(`[deploy-listener] REJECTED catch-up marker: ${auth.reason} (sha=${marker.sha})`);
      return;
    }

    const { sha, branch } = marker;
    const currentSha = execSync('git rev-parse --short HEAD', {
      cwd: REPO_DIR, encoding: 'utf8',
    }).trim();

    // P4-9: "HEAD == latest" is not "deployed" — a merged-but-failed deploy
    // leaves the tree there too. The local marker breaks the tie, and caps
    // automatic retries of a sha that keeps failing on this node.
    const verdict = shouldCatchUp({ currentSha, latestSha: sha, lastDeploy: readDeployMarker() });
    console.log(`[deploy-listener] Catch-up: ${verdict.reason}`);
    if (verdict.deploy) {
      await executeDeploy(
        { sha, branch: branch || 'main', components: ['all'], initiator: 'auto-catchup' },
        resultsKv, nodesKv
      );
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

  // C2 fix (deep review 2026-07-03): authenticate the trigger before running
  // `git reset --hard` + deploy. Opt-in via OPENCLAW_REQUIRE_SIGNED_DEPLOY=1
  // (+ OPENCLAW_DEPLOY_TRUSTED_KEYS); default off preserves current behavior
  // but warns on unsigned triggers. ESM helper loaded dynamically (this is CJS).
  const { verifyDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');

  (async () => {
    for await (const msg of sub) {
      try {
        const trigger = JSON.parse(sc.decode(msg.data));

        // Ignore triggers for specific nodes that don't include us
        if (trigger.nodes && !trigger.nodes.includes(NODE_ID) && !trigger.nodes.includes('all')) {
          console.log(`[deploy-listener] Trigger not for us — target: ${trigger.nodes.join(', ')}`);
          continue;
        }

        const auth = verifyDeployTrigger(trigger);
        if (!auth.ok) {
          console.error(`[deploy-listener] REJECTED deploy trigger: ${auth.reason} (sha=${trigger.sha}, initiator=${trigger.initiator || 'unknown'})`);
          notifyDesktop('block', 'Mesh deploy REJECTED', `${auth.reason} (sha=${trigger.sha}, from ${trigger.initiator || 'unknown'})`);
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

module.exports = { shouldCatchUp };

if (require.main === module) {
  main().catch(err => {
    console.error(`[deploy-listener] Fatal: ${err.message}`);
    process.exit(1);
  });
}
