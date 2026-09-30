#!/usr/bin/env node

/**
 * mesh-deploy-listener.js — Fleet deploy receiver daemon.
 *
 * Runs on every node. When the lead publishes a signed deploy trigger on NATS,
 * this daemon fetches, checks out exactly the signed sha, and runs the pinned
 * deploy (`mesh-deploy.js --local --from <deployed> --to <sha>`). A failure
 * checks the previous sha back out and runs the same pinned deploy in reverse
 * — never a fetching deploy, which would fast-forward onto the failed commit
 * again. No SSH needed.
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
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
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
// mesh-deploy's record of the sha this node last deployed in full.
const DEPLOY_STATE = path.join(os.homedir(), '.openclaw', '.deploy-state.json');
// npm install + `next build` + rolling restarts; each step inside the deploy
// script has its own shorter timeout.
const DEPLOY_TIMEOUT_MS = 20 * 60 * 1000;
const execFileAsync = promisify(execFile);

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
 *   - latest failed preflight before checkout → no (operator must fix the target layout).
 *   - latest was skipped here (not for this role, or catch-up would have
 *     moved the tree backward) → no.
 */
function shouldCatchUp({ currentSha, latestSha, lastDeploy, maxAttempts = MAX_DEPLOY_ATTEMPTS }) {
  const same = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
  const lastForLatest = lastDeploy && same(lastDeploy.sha, latestSha) ? lastDeploy : null;
  if (lastForLatest && lastForLatest.status === 'failed' && (lastForLatest.attempts || 0) >= maxAttempts) {
    return { deploy: false, reason: `sha ${latestSha} failed ${lastForLatest.attempts}× here — not retrying automatically` };
  }
  if (lastForLatest && lastForLatest.status === 'skipped') {
    return { deploy: false, reason: `sha ${latestSha} was skipped here (${lastForLatest.reason || 'not applicable'})` };
  }
  if (lastForLatest && lastForLatest.status === 'refused') {
    return { deploy: false, reason: `sha ${latestSha} failed preflight here — operator must fix the target layout` };
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

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPO_DIR, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isAncestor(ancestor, descendant) {
  try { git('merge-base', '--is-ancestor', ancestor, descendant); return true; } catch { return false; }
}

// The diff base: the sha mesh-deploy last deployed here in full, not HEAD.
// HEAD moves without deploying — on the lead the repo is a working checkout
// and `mesh deploy` publishes its HEAD, so a HEAD-based diff is always empty.
function deployedBase() {
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(DEPLOY_STATE, 'utf8')).deployedSha; } catch { /* not recorded yet */ }
  if (/^[0-9a-f]{40}$/.test(recorded || '')) {
    try { return git('rev-parse', '--verify', '--quiet', `${recorded}^{commit}`); } catch { /* not in this clone */ }
  }
  return git('rev-parse', 'HEAD');
}

// The signed sha, resolved after the fetch: it must be a commit on the
// trigger's branch, not whatever the branch tip happens to be now.
function resolveSignedSha(sha, branch) {
  let full = null;
  try { full = git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`); } catch { /* unknown object */ }
  if (!full || !isAncestor(full, `origin/${branch}`)) {
    throw new Error(`signed sha ${sha} is not on origin/${branch}`);
  }
  return full;
}

// Run the checked-out tree's mesh-deploy.js in pinned mode (no fetch).
async function runDeployScript(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [DEPLOY_SCRIPT, '--local', ...args], {
      cwd: REPO_DIR, encoding: 'utf8', timeout: DEPLOY_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, OPENCLAW_REPO_DIR: REPO_DIR },
    }));
  } catch (err) {
    const reported = String(err.stdout || '').split('\n').reverse().find(l => l.startsWith('DEPLOY_ERROR '));
    if (reported) err.message = JSON.parse(reported.slice('DEPLOY_ERROR '.length));
    throw err;
  }
  const line = stdout.split('\n').reverse().find(l => l.startsWith('DEPLOY_RESULT '));
  if (!line) {
    throw Object.assign(new Error(`${DEPLOY_SCRIPT} printed no DEPLOY_RESULT — that tree's deploy script predates pinned deploys`), { stdout });
  }
  return { stdout, deployed: JSON.parse(line.slice('DEPLOY_RESULT '.length)) };
}

/**
 * Deploy exactly `trigger.sha` on this node and, if that fails, put the
 * previous deployed sha back. Returns the result record (status success |
 * skipped | refused | failed); never throws.
 *
 * forwardOnly (catch-up): never move the tree backward. The `latest` marker
 * is state read at every restart; a node ahead of it was moved on purpose
 * (the lead's working checkout), and rewinding it is not catching up.
 */
async function runDeploy(trigger, { forwardOnly = false } = {}) {
  const result = { status: 'success', sha: trigger.sha, preSha: null, componentsDeployed: [], warnings: [], errors: [], log: '' };

  // Requested components this role runs; a filtered run reinstalls them in full.
  const componentArgs = [];
  if (trigger.components && !trigger.components.includes('all')) {
    const applicable = trigger.components.filter(c => NODE_COMPONENTS.has(c));
    if (applicable.length === 0) {
      console.log(`[deploy-listener] No applicable components for role=${NODE_ROLE} — skipping`);
      return { ...result, status: 'skipped', log: `No matching components for role ${NODE_ROLE}` };
    }
    for (const c of applicable) componentArgs.push('--component', c);
  }

  // Pre-deploy SHA (P4-9): the point to roll back to. Null on the bootstrap
  // path (no git tree yet) — nothing to revert to; the failure is reported as-is.
  let preSha = null;
  let targetSha = null;
  let touched = false; // tree moved or deploy script ran: a failure needs a rollback
  try {
    // trigger.sha/branch come from NATS; they reach git as argv, never a shell.
    const branch = trigger.branch || 'main';
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
      throw new Error(`Invalid branch name: ${trigger.branch}`);
    }
    if (!/^[0-9a-f]{7,40}$/i.test(trigger.sha || '')) throw new Error(`Invalid sha: ${trigger.sha}`);

    let deployArgs;
    if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
      // Provisioner copied files without git clone: nothing recorded to diff
      // from, so every component is reinstalled at the signed sha.
      if (!fs.existsSync(REPO_DIR)) throw new Error(`Repo dir not found at ${REPO_DIR}`);
      console.log(`[deploy-listener] No .git found — bootstrapping git repo`);
      git('init', '--quiet');
      git('remote', 'add', 'origin', REPO_REMOTE_URL);
      git('fetch', 'origin', branch);
      targetSha = resolveSignedSha(trigger.sha, branch);
      git('reset', '--hard', '--quiet', targetSha);
      deployArgs = ['--from', targetSha, '--to', targetSha, ...(componentArgs.length ? componentArgs : ['--component', 'all'])];
    } else {
      preSha = deployedBase();
      console.log(`[deploy-listener] git fetch origin ${branch}...`);
      git('fetch', 'origin', branch);
      targetSha = resolveSignedSha(trigger.sha, branch);
      const head = git('rev-parse', 'HEAD');
      if (!isAncestor(head, `origin/${branch}`)) {
        throw new Error(`HEAD ${head.slice(0, 7)} has commits that are not on origin/${branch} — refusing to move this checkout`);
      }
      if (forwardOnly && !isAncestor(head, targetSha)) {
        console.log(`[deploy-listener] HEAD ${head.slice(0, 7)} is ahead of ${trigger.sha} — catch-up never moves a node backward`);
        return { ...result, status: 'skipped', log: `HEAD ${head.slice(0, 7)} is ahead of ${trigger.sha}` };
      }
      // Tracked edits are refused before anything moves: the daemons run this
      // checkout's files, so the edit would go live as the signed sha. The
      // deploy script refuses them too, but only after this checkout — and the
      // rollback could not then move the tree back over the same edit. Content
      // only, as there: mode-only changes never reach a runtime copy.
      const dirty = git('-c', 'core.fileMode=false', 'status', '--porcelain', '--untracked-files=no');
      if (dirty) {
        throw new Error(`tracked files differ from the commit (${dirty.split('\n').slice(0, 5).map(l => l.trim()).join(', ')}) — refusing to deploy over them`);
      }
      const preflightArgs = ['--from', preSha, '--to', targetSha, ...componentArgs, ...(trigger.force ? ['--force'] : []), '--preflight-only'];
      try {
        if (!fs.readFileSync(DEPLOY_SCRIPT, 'utf8').includes("args.includes('--preflight-only')")) {
          throw new Error('deployed mesh-deploy.js lacks preflight support');
        }
        const { deployed } = await runDeployScript(preflightArgs);
        if (deployed.preflight !== true) throw new Error('deploy script did not attest preflight');
      } catch (err) {
        result.status = 'refused';
        result.errors.push(err.message);
        result.log = String(err.stdout || err.stderr || err.message).slice(-5000);
        result.preSha = preSha.slice(0, 7);
        console.error(`[deploy-listener] Deploy REFUSED before checkout: ${err.message}`);
        return result;
      }
      if (head !== targetSha) {
        console.log(`[deploy-listener] Checking out ${targetSha.slice(0, 7)} (was ${head.slice(0, 7)})`);
        touched = true;
        git('checkout', '--detach', '--quiet', targetSha);
      }
      deployArgs = ['--from', preSha, '--to', targetSha, ...componentArgs];
    }
    if (trigger.force) deployArgs.push('--force');

    console.log(`[deploy-listener] Running: mesh-deploy.js --local ${deployArgs.join(' ')}`);
    touched = true;
    const { stdout, deployed } = await runDeployScript(deployArgs);
    const head = git('rev-parse', 'HEAD');
    if (head !== targetSha) throw new Error(`deploy left HEAD at ${head.slice(0, 7)}, expected ${targetSha.slice(0, 7)}`);

    result.log = stdout.slice(-5000);
    result.componentsDeployed = deployed.components;
    result.sha = git('rev-parse', '--short', 'HEAD');
    const ids = deployed.components.map(c => c.id).join(', ');
    console.log(`[deploy-listener] Success — now at ${result.sha} (${ids || 'no component changed'})`);
  } catch (err) {
    result.status = 'failed';
    result.errors.push(err.message);
    result.log = String(err.stdout || err.stderr || err.message).slice(-5000);
    console.error(`[deploy-listener] Deploy FAILED: ${err.message}`);

    // Rollback: check preSha back out and deploy the reverse diff with the
    // known-good tree's own script, pinned. The old path re-ran a fetching
    // deploy, which fast-forwarded straight back onto the failed commit.
    if (touched && preSha && targetSha && preSha !== targetSha) {
      try {
        if (git('rev-parse', 'HEAD') !== preSha) {
          console.log(`[deploy-listener] Rolling back ${targetSha.slice(0, 7)} → ${preSha.slice(0, 7)}`);
          git('checkout', '--detach', '--quiet', preSha);
        }
        await runDeployScript(['--from', targetSha, '--to', preSha, ...componentArgs]);
        const head = git('rev-parse', 'HEAD');
        if (head !== preSha) throw new Error(`rollback left HEAD at ${head.slice(0, 7)}`);
        result.rolledBack = true;
        result.rollbackSha = preSha.slice(0, 7);
        console.log(`[deploy-listener] Rolled back to ${preSha.slice(0, 7)} and redeployed`);
      } catch (rbErr) {
        result.rolledBack = false;
        result.errors.push(`rollback failed: ${rbErr.message}`);
        console.error(`[deploy-listener] ROLLBACK FAILED: ${rbErr.message} — node is at an unverified tree`);
      }
    }
  }
  result.preSha = preSha ? preSha.slice(0, 7) : null;
  return result;
}

async function executeDeploy(trigger, resultsKv, nodesKv, opts = {}) {
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

    const prior = readDeployMarker();
    const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
    const attempts = (prior && sameSha(prior.sha, trigger.sha) ? (prior.attempts || 0) : 0) + 1;

    const result = { nodeId: NODE_ID, startedAt, ...(await runDeploy(trigger, opts)) };
    result.completedAt = new Date().toISOString();
    result.attempts = attempts;
    // Local marker: what this node last tried, and how it ended.
    writeDeployMarker({
      sha: trigger.sha, status: result.status, attempts,
      completedAt: result.completedAt, preSha: result.preSha,
      rolledBack: result.rolledBack ?? null, initiator: trigger.initiator || null,
      ...(result.status === 'skipped' ? { reason: result.log } : {}),
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
    } else if (result.status === 'refused') {
      notifyDesktop('error', 'Mesh deploy REFUSED', `${NODE_ID} unchanged: ${result.errors[0]?.slice(0, 160) || 'preflight failed'}`);
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

    // C2: the marker steers a checkout + deploy exactly like a live trigger —
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
    const currentSha = git('rev-parse', '--short', 'HEAD');

    // P4-9: "HEAD == latest" is not "deployed" — a merged-but-failed deploy
    // leaves the tree there too. The local marker breaks the tie, and caps
    // automatic retries of a sha that keeps failing on this node.
    const verdict = shouldCatchUp({ currentSha, latestSha: sha, lastDeploy: readDeployMarker() });
    console.log(`[deploy-listener] Catch-up: ${verdict.reason}`);
    if (verdict.deploy) {
      await executeDeploy(
        { sha, branch: branch || 'main', components: ['all'], initiator: 'auto-catchup' },
        resultsKv, nodesKv, { forwardOnly: true }
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
        currentSha = git('rev-parse', '--short', 'HEAD');
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

module.exports = { shouldCatchUp, runDeploy };

if (require.main === module) {
  main().catch(err => {
    console.error(`[deploy-listener] Fatal: ${err.message}`);
    process.exit(1);
  });
}
