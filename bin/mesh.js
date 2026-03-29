#!/usr/bin/env node

/**
 * mesh — CLI bridge for OpenClaw ↔ NATS mesh interaction.
 *
 * ARCHITECTURE:
 *   OpenClaw (via bash tool) → mesh CLI → NATS → agent.js on target node → result back
 *
 * This is a short-lived process: connects to NATS, sends the request,
 * waits for a response, prints the result, exits. No daemon. No state.
 *
 * SUBCOMMANDS:
 *   mesh status                          — show all online nodes
 *   mesh exec "<command>"                — run command on remote (Ubuntu) node
 *   mesh exec --node <id> "<command>"    — run command on specific node
 *   mesh capture                         — screenshot local machine
 *   mesh capture --node ubuntu           — screenshot remote node
 *   mesh ls [subdir]                     — list shared folder contents
 *   mesh put <filepath> [subdir]         — copy file into shared folder
 *   mesh broadcast "<message>"           — send message to all nodes
 *
 * ENVIRONMENT:
 *   OPENCLAW_NATS  — NATS server URL (auto-detected from env or ~/.openclaw/openclaw.env)
 */

const { connect, StringCodec, createInbox } = require('nats');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────
// ── NATS URL resolution: env var → ~/.openclaw/openclaw.env → fallback IP ──
const NATS_FALLBACK = 'nats://100.91.131.61:4222';
function resolveNatsUrl() {
  if (process.env.OPENCLAW_NATS) return process.env.OPENCLAW_NATS;
  try {
    const envFile = path.join(os.homedir(), '.openclaw', 'openclaw.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch {}
  return NATS_FALLBACK;
}
const NATS_URL = resolveNatsUrl();
const SHARED_DIR = path.join(os.homedir(), 'openclaw', 'shared');
const LOCAL_NODE = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
const sc = StringCodec();

// ─── Known nodes (for --node shortcuts) ──────────────
const NODE_ALIASES_DEFAULTS = {
  'ubuntu': 'calos-vmware-virtual-platform',
  'linux': 'calos-vmware-virtual-platform',
  'mac': 'moltymacs-virtual-machine-local',
  'macos': 'moltymacs-virtual-machine-local',
};

function loadNodeAliases() {
  const aliasPath = path.join(os.homedir(), '.openclaw', 'mesh-aliases.json');
  try {
    if (fs.existsSync(aliasPath)) {
      const custom = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
      return { ...NODE_ALIASES_DEFAULTS, ...custom };
    }
  } catch {}
  return NODE_ALIASES_DEFAULTS;
}
const NODE_ALIASES = loadNodeAliases();

/**
 * Resolve a node name — accepts aliases, full IDs, or "self"/"local"
 */
function resolveNode(name) {
  if (!name || name === 'self' || name === 'local') return LOCAL_NODE;
  const lower = name.toLowerCase();
  return NODE_ALIASES[lower] || lower;
}

/**
 * Find the "other" node (not this one).
 * Used as default target for exec/capture.
 */
function remoteNode() {
  const allNodes = Object.values(NODE_ALIASES);
  return allNodes.find(n => n !== LOCAL_NODE) || LOCAL_NODE;
}

// ─── Exec safety ─────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/,      // rm -rf, rm -fr, rm --recursive --force
  /\brm\s+(-[a-zA-Z]*)?f[a-zA-Z]*r/,       // rm -fr variants
  /\bmkfs\b/,                                // format filesystem
  /\bdd\s+.*of=/,                            // raw disk write
  /\b>\s*\/dev\/[sh]d/,                      // write to raw device
  /\bcurl\b.*\|\s*(ba)?sh/,                  // curl pipe to shell
  /\bwget\b.*\|\s*(ba)?sh/,                  // wget pipe to shell
  /\bchmod\s+(-[a-zA-Z]*\s+)?777\s+\//,     // chmod 777 on root paths
  /\b:(){ :\|:& };:/,                        // fork bomb
];

function checkExecSafety(command) {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      console.error(`BLOCKED: Command matches destructive pattern.`);
      console.error(`  Command: ${command}`);
      console.error(`  Pattern: ${pattern}`);
      console.error(`\nIf this is intentional, SSH into the node and run it directly.`);
      process.exit(1);
    }
  }
}

// ─── NATS helpers ────────────────────────────────────

/**
 * Connect to NATS with a short timeout (this is a CLI tool, not a daemon).
 */
async function natsConnect() {
  try {
    return await connect({ servers: NATS_URL, timeout: 5000 });
  } catch (err) {
    console.error(`Error: Cannot connect to NATS at ${NATS_URL}`);
    console.error(`Is the NATS server running? Is Tailscale connected?`);
    process.exit(1);
  }
}

/**
 * Send a NATS request and wait for a response (with timeout).
 */
async function natsRequest(nc, subject, payload, timeoutMs = 35000) {
  try {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const msg = await nc.request(subject, sc.encode(data), { timeout: timeoutMs });
    return JSON.parse(sc.decode(msg.data));
  } catch (err) {
    if (err.code === '503' || err.message?.includes('503')) {
      console.error(`Error: No responder on subject "${subject}". Is the target node's agent running?`);
    } else if (err.code === 'TIMEOUT' || err.message?.includes('TIMEOUT')) {
      console.error(`Error: Request timed out after ${timeoutMs / 1000}s. The target node may be offline or the command is taking too long.`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Collect recent heartbeats to build node status.
 */
async function collectHeartbeats(nc, waitMs = 3000) {
  const nodes = {};
  const sub = nc.subscribe('openclaw.*.heartbeat');

  // Also grab our own status
  nodes[LOCAL_NODE] = {
    node: LOCAL_NODE, platform: os.platform(), status: 'online (local)',
    mem: { total: Math.round(os.totalmem() / 1048576), free: Math.round(os.freemem() / 1048576) },
    uptime: os.uptime(),
  };

  // Listen for heartbeats for a few seconds
  const deadline = Date.now() + waitMs;
  for await (const msg of sub) {
    const s = JSON.parse(sc.decode(msg.data));
    if (s.node !== LOCAL_NODE) {
      nodes[s.node] = s;
    }
    if (Date.now() >= deadline) break;
  }
  sub.unsubscribe();
  return nodes;
}

// ─── Subcommands ─────────────────────────────────────

/**
 * mesh status — show online nodes with platform, memory, uptime, shared files.
 */
async function cmdStatus() {
  const nc = await natsConnect();
  console.log('Scanning mesh...\n');
  const nodes = await collectHeartbeats(nc, 3000);

  for (const [id, info] of Object.entries(nodes)) {
    const memFree = info.mem?.free || '?';
    const memTotal = info.mem?.total || '?';
    const upHours = info.uptime ? (info.uptime / 3600).toFixed(1) : '?';
    const shared = info.sharedFiles ?? '?';
    const role = id === 'moltymacs-virtual-machine-local' ? 'LEAD' : 'WORKER';
    const local = id === LOCAL_NODE ? ' (this machine)' : '';

    console.log(`  ${info.status === 'online' || info.status === 'online (local)' ? '●' : '○'} ${id}${local}`);
    console.log(`    Platform:     ${info.platform}`);
    console.log(`    Role:         ${role}`);
    console.log(`    Memory:       ${memFree}MB free / ${memTotal}MB total`);
    console.log(`    Uptime:       ${upHours}h`);
    console.log(`    Shared files: ${shared}`);
    console.log('');
  }

  await nc.close();
}

/**
 * mesh exec "<command>" — run command on remote node.
 */
async function cmdExec(args) {
  // Parse --node flag
  let targetNode = remoteNode();
  let command = '';

  let i = 0;
  while (i < args.length) {
    if (args[i] === '--node' && args[i + 1]) {
      targetNode = resolveNode(args[i + 1]);
      i += 2;
    } else {
      command += (command ? ' ' : '') + args[i];
      i++;
    }
  }

  if (!command) {
    console.error('Usage: mesh exec [--node <name>] "<command>"');
    process.exit(1);
  }

  checkExecSafety(command);

  const nc = await natsConnect();
  const result = await natsRequest(nc, `openclaw.${targetNode}.exec`, command);

  // Print output cleanly
  if (result.output) process.stdout.write(result.output);
  if (result.exitCode !== 0) {
    console.error(`\n[exit code: ${result.exitCode}]`);
  }

  await nc.close();
  process.exit(result.exitCode || 0);
}

/**
 * mesh capture — take screenshot on a node.
 */
async function cmdCapture(args) {
  let targetNode = LOCAL_NODE;
  let label = 'capture';

  let i = 0;
  while (i < args.length) {
    if (args[i] === '--node' && args[i + 1]) {
      targetNode = resolveNode(args[i + 1]);
      i += 2;
    } else if (args[i] === '--label' && args[i + 1]) {
      label = args[i + 1];
      i += 2;
    } else {
      i++;
    }
  }

  const nc = await natsConnect();
  const result = await natsRequest(nc, `openclaw.${targetNode}.capture`, { label });

  if (result.sharedPath) {
    console.log(result.sharedPath);
  } else if (result.screenshotPath) {
    console.log(result.screenshotPath);
  } else {
    console.error('Screenshot failed — no path returned.');
    process.exit(1);
  }

  await nc.close();
}

/**
 * mesh ls [subdir] — list shared folder contents.
 */
function cmdLs(args) {
  const subdir = args[0] || '';
  const target = path.join(SHARED_DIR, subdir);

  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    // Single file — show info
    console.log(`${target} (${(stat.size / 1024).toFixed(1)}KB, ${stat.mtime.toISOString()})`);
    return;
  }

  // List directory recursively with sizes
  listDir(target, '');
}

function listDir(dir, prefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`);
      listDir(full, prefix + '  ');
    } else {
      const size = fs.statSync(full).size;
      const sizeStr = size < 1024 ? `${size}B` : size < 1048576 ? `${(size / 1024).toFixed(1)}KB` : `${(size / 1048576).toFixed(1)}MB`;
      console.log(`${prefix}${entry.name}  (${sizeStr})`);
    }
  }
}

/**
 * mesh put <filepath> [subdir] — copy file into shared folder.
 */
function cmdPut(args) {
  const srcPath = args[0];
  const destSubdir = args[1] || '';

  if (!srcPath) {
    console.error('Usage: mesh put <filepath> [subdir]');
    process.exit(1);
  }

  if (!fs.existsSync(srcPath)) {
    console.error(`Not found: ${srcPath}`);
    process.exit(1);
  }

  const destDir = path.join(SHARED_DIR, destSubdir);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const filename = path.basename(srcPath);
  const destPath = path.join(destDir, filename);

  fs.copyFileSync(srcPath, destPath);
  const relPath = path.relative(SHARED_DIR, destPath);
  console.log(`~/openclaw/shared/${relPath}`);
  console.log(`(will sync to other nodes automatically)`);
}

/**
 * mesh broadcast "<message>" — send to all nodes.
 */
async function cmdBroadcast(args) {
  const message = args.join(' ');
  if (!message) {
    console.error('Usage: mesh broadcast "<message>"');
    process.exit(1);
  }

  const nc = await natsConnect();
  nc.publish('openclaw.broadcast', sc.encode(JSON.stringify({
    fromNode: LOCAL_NODE,
    message,
    timestamp: new Date().toISOString(),
  })));

  // Give it a moment to flush
  await nc.flush();
  console.log(`Broadcast sent: "${message}"`);
  await nc.close();
}

/**
 * mesh submit <task.yaml|-> — submit a task to the mesh.
 *
 * Reads YAML from a file or stdin, publishes to mesh.tasks.submit.
 * Also accepts --id <task-id> to submit a task from active-tasks.md.
 */
async function cmdSubmit(args) {
  const yaml = require('yaml');

  // Option A: submit from active-tasks.md by ID
  const idIdx = args.indexOf('--id');
  if (idIdx >= 0 && args[idIdx + 1]) {
    const taskId = args[idIdx + 1];
    const { readTasks, updateTaskInPlace, isoTimestamp, ACTIVE_TASKS_PATH } = require('../lib/kanban-io');
    const tasks = readTasks(ACTIVE_TASKS_PATH);
    const task = tasks.find(t => t.task_id === taskId);
    if (!task) { console.error(`Task ${taskId} not found in active-tasks.md`); process.exit(1); }
    if (task.status !== 'queued') { console.error(`Task ${taskId} is ${task.status}, not queued`); process.exit(1); }

    const nc = await natsConnect();
    const result = await natsRequest(nc, 'mesh.tasks.submit', {
      task_id: task.task_id,
      title: task.title,
      description: task.description || '',
      budget_minutes: task.budget_minutes || 30,
      metric: task.metric || null,
      success_criteria: task.success_criteria || [],
      scope: task.scope || [],
      priority: task.auto_priority || 0,
      llm_provider: task.provider || task.llm_provider || null,
      llm_model: task.model || task.llm_model || null,
      preferred_nodes: task.preferred_nodes || [],
      exclude_nodes: task.exclude_nodes || [],
    });
    console.log(`Submitted: ${result.data.task_id} [${result.data.status}]`);
    // Mark as 'submitted' — NOT 'running'. The card reflects actual mesh state.
    // The bridge event handler promotes to 'running' when mesh.events.claimed fires.
    // This prevents the Schrödinger state where kanban says 'running' before any agent has claimed.
    updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, { status: 'submitted', owner: 'mesh', updated_at: isoTimestamp() });
    console.log(`Kanban updated: ${taskId} → submitted (will become 'running' on agent claim)`);
    await nc.close();
    return;
  }

  // Option B: read YAML from file or stdin
  let input;
  const filePath = args.find(a => !a.startsWith('-'));
  if (filePath && filePath !== '-') {
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    input = fs.readFileSync(filePath, 'utf8');
  } else {
    // Stdin mode — but only if actually piped (not interactive TTY)
    if (process.stdin.isTTY) {
      console.error('Usage: mesh submit <task.yaml>');
      console.error('       mesh submit --id <task-id>');
      console.error('       cat task.yaml | mesh submit');
      process.exit(1);
    }
    // Read from stdin with 5s timeout
    const chunks = [];
    process.stdin.setEncoding('utf8');
    const stdinTimeout = setTimeout(() => {
      console.error('Error: stdin read timed out after 5s');
      process.exit(1);
    }, 5000);
    for await (const chunk of process.stdin) { chunks.push(chunk); }
    clearTimeout(stdinTimeout);
    input = chunks.join('');
  }

  if (!input.trim()) { console.error('No input. Provide a YAML file or pipe from stdin.'); process.exit(1); }

  const task = yaml.parse(input);
  if (!task.task_id || !task.title) { console.error('YAML must have task_id and title.'); process.exit(1); }

  const nc = await natsConnect();
  const result = await natsRequest(nc, 'mesh.tasks.submit', {
    task_id: task.task_id,
    title: task.title,
    description: task.description || '',
    budget_minutes: task.budget_minutes || 30,
    metric: task.metric || null,
    on_fail: task.on_fail || 'revert and log approach',
    success_criteria: task.success_criteria || [],
    scope: task.scope || [],
    priority: task.priority || 0,
    tags: task.tags || [],
    llm_provider: task.provider || task.llm_provider || null,
    llm_model: task.model || task.llm_model || null,
    preferred_nodes: task.preferred_nodes || [],
    exclude_nodes: task.exclude_nodes || [],
    collaboration: task.collaboration || undefined,
  });

  console.log(`Submitted: ${result.data.task_id} "${result.data.title}"`);
  console.log(`  Status:  ${result.data.status}`);
  console.log(`  Budget:  ${result.data.budget_minutes}m`);
  console.log(`  Metric:  ${result.data.metric || 'none'}`);
  if (result.data.llm_provider) console.log(`  Provider: ${result.data.llm_provider}`);
  await nc.close();
}

/**
 * mesh tasks [--status <filter>] — list mesh tasks.
 */
async function cmdTasks(args) {
  const subCmd = args[0];

  // Subcommands: approve, reject
  if (subCmd === 'approve') {
    const taskId = args[1];
    if (!taskId) { console.error('Usage: mesh tasks approve <task-id>'); process.exit(1); }
    const nc = await natsConnect();
    try {
      const result = await natsRequest(nc, 'mesh.tasks.approve', { task_id: taskId });
      console.log(`Task approved: ${result.task_id} → ${result.status}`);
    } finally { await nc.close(); }
    return;
  }

  if (subCmd === 'reject') {
    const taskId = args[1];
    if (!taskId) { console.error('Usage: mesh tasks reject <task-id> [--reason "..."]'); process.exit(1); }
    let reason = 'Rejected by reviewer';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--reason' && args[i + 1]) { reason = args[++i]; }
    }
    const nc = await natsConnect();
    try {
      const result = await natsRequest(nc, 'mesh.tasks.reject', { task_id: taskId, reason });
      console.log(`Task rejected: ${result.task_id} → re-queued`);
      console.log(`  Reason: ${reason}`);
    } finally { await nc.close(); }
    return;
  }

  if (subCmd === 'review') {
    // List only pending_review tasks
    const nc = await natsConnect();
    const result = await natsRequest(nc, 'mesh.tasks.list', { status: 'pending_review' });
    const tasks = result.data || [];
    if (tasks.length === 0) {
      console.log('No tasks pending review.');
      await nc.close();
      return;
    }
    console.log(`Tasks pending review (${tasks.length}):\n`);
    for (const t of tasks) {
      console.log(`  ${t.task_id}  "${t.title}"`);
      if (t.result?.summary) console.log(`    Result: ${t.result.summary.slice(0, 200)}`);
      if (t.result?.harness?.warnings?.length) {
        console.log(`    Harness warnings: ${t.result.harness.warnings.length}`);
      }
      console.log(`    Approve: mesh tasks approve ${t.task_id}`);
      console.log(`    Reject:  mesh tasks reject ${t.task_id} --reason "..."`);
      console.log('');
    }
    await nc.close();
    return;
  }

  // Default: list all tasks
  const nc = await natsConnect();
  const filter = {};
  const statusIdx = args.indexOf('--status');
  if (statusIdx >= 0 && args[statusIdx + 1]) filter.status = args[statusIdx + 1];

  const result = await natsRequest(nc, 'mesh.tasks.list', filter);
  const tasks = result.data || [];

  if (tasks.length === 0) {
    console.log('No tasks in mesh.');
    await nc.close();
    return;
  }

  for (const t of tasks) {
    const elapsed = t.started_at && t.completed_at
      ? ((new Date(t.completed_at) - new Date(t.started_at)) / 1000).toFixed(0) + 's'
      : t.started_at
        ? ((Date.now() - new Date(t.started_at)) / 1000).toFixed(0) + 's (running)'
        : '-';
    const reviewTag = t.status === 'pending_review' ? ' ⏳' : '';
    console.log(`  ${t.task_id}  [${t.status}]${reviewTag}  "${t.title}"`);
    console.log(`    Owner: ${t.owner || '-'}  Elapsed: ${elapsed}  Attempts: ${t.attempts.length}`);
    if (t.metric) console.log(`    Metric: ${t.metric}`);
    if (t.result?.summary) console.log(`    Result: ${t.result.summary.slice(0, 120)}`);
    console.log('');
  }

  await nc.close();
}

/**
 * mesh health [--json] [--all] — run health check on this node or all nodes.
 *
 * --all: also runs health on remote node via NATS exec.
 * --json: structured JSON output for programmatic parsing.
 */
async function cmdHealth(args) {
  const jsonMode = args.includes('--json');
  const allNodes = args.includes('--all');
  const scriptDir = path.join(os.homedir(), 'openclaw', 'bin');
  const healthScript = path.join(scriptDir, 'mesh-health.sh');

  if (!fs.existsSync(healthScript)) {
    console.error(`Health script not found at ${healthScript}`);
    console.error('Run install-mesh-skill.sh to install.');
    process.exit(1);
  }

  // Run local health check
  const localArgs = jsonMode ? '--json' : '';
  try {
    const { execSync } = require('child_process');
    const output = execSync(`bash "${healthScript}" ${localArgs}`, {
      encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe']
    });
    process.stdout.write(output);
  } catch (err) {
    // exit code 1 = unhealthy, still valid output
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
  }

  // If --all, also check the remote node
  if (allNodes) {
    const remote = remoteNode();
    if (!jsonMode) console.log(`\n── Remote node: ${remote} ──\n`);
    const nc = await natsConnect();
    try {
      const remoteCmd = `bash openclaw/bin/mesh-health.sh ${localArgs}`;
      const result = await natsRequest(nc, `openclaw.${remote}.exec`, remoteCmd, 20000);
      if (result.output) process.stdout.write(result.output);
    } catch (e) {
      console.error('Could not reach remote node for health check.');
    }
    await nc.close();
  }
}

/**
 * mesh repair [--all] — self-repair this node (or all nodes).
 *
 * Runs health check first, then fixes every failed service.
 * Requires sudo for service restarts.
 * --all: also repairs the remote node via NATS exec.
 */
async function cmdRepair(args) {
  const allNodes = args.includes('--all');
  const scriptDir = path.join(os.homedir(), 'openclaw', 'bin');
  const repairScript = path.join(scriptDir, 'mesh-repair.sh');

  if (!fs.existsSync(repairScript)) {
    console.error(`Repair script not found at ${repairScript}`);
    console.error('Run install-mesh-skill.sh to install.');
    process.exit(1);
  }

  // Run local repair (needs sudo for service restarts)
  try {
    const { execSync } = require('child_process');
    execSync(`sudo bash "${repairScript}"`, {
      encoding: 'utf8', timeout: 120000, stdio: 'inherit'
    });
  } catch (err) {
    // repair may exit non-zero if some repairs failed
  }

  // If --all, also repair remote
  if (allNodes) {
    const remote = remoteNode();
    console.log(`\n══ Remote repair: ${remote} ══\n`);
    const nc = await natsConnect();
    try {
      const result = await natsRequest(nc,
        `openclaw.${remote}.exec`,
        `bash openclaw/bin/mesh-repair.sh`,
        120000
      );
      if (result.output) process.stdout.write(result.output);
    } catch (e) {
      console.error('Could not reach remote node for repair.');
      console.error('SSH in and run: sudo bash openclaw/bin/mesh-repair.sh');
    }
    await nc.close();
  }
}

/**
 * mesh deploy [--force] [--component <name>] [--node <name>] — trigger fleet deploy.
 *
 * Publishes mesh.deploy.trigger to NATS. All nodes with mesh-deploy-listener
 * will pull from git and self-deploy. Polls MESH_DEPLOY_RESULTS for status.
 */
async function cmdDeploy(args) {
  const { execSync } = require('child_process');
  // Prefer openclaw-node (git repo) over openclaw (runtime)
  const defaultRepo = fs.existsSync(path.join(os.homedir(), 'openclaw-node', '.git'))
    ? path.join(os.homedir(), 'openclaw-node')
    : path.join(os.homedir(), 'openclaw');
  const repoDir = process.env.OPENCLAW_REPO_DIR || defaultRepo;
  const force = args.includes('--force');

  // Parse --component flags
  const components = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' && args[i + 1]) {
      components.push(args[i + 1]);
      i++;
    }
  }

  // Parse --node flags (target specific nodes, default: all)
  const targetNodes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      targetNodes.push(resolveNode(args[i + 1]));
      i++;
    }
  }

  // Get current SHA and branch
  let sha, branch;
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
  } catch {
    console.error(`Error: Cannot read git state from ${repoDir}`);
    process.exit(1);
  }

  console.log(`Deploying ${sha} (${branch})${force ? ' [FORCE]' : ''}`);
  if (components.length > 0) console.log(`  Components: ${components.join(', ')}`);
  if (targetNodes.length > 0) console.log(`  Targets: ${targetNodes.join(', ')}`);
  else console.log('  Targets: all nodes');

  const nc = await natsConnect();

  const trigger = {
    sha,
    branch,
    components: components.length > 0 ? components : ['all'],
    nodes: targetNodes.length > 0 ? targetNodes : ['all'],
    force,
    initiator: LOCAL_NODE,
    timestamp: new Date().toISOString(),
  };

  // Write "latest" marker so offline nodes can catch up
  try {
    const js = nc.jetstream();
    const resultsKv = await js.views.kv('MESH_DEPLOY_RESULTS', { history: 5, ttl: 7 * 24 * 60 * 60 * 1000 });
    await resultsKv.put('latest', sc.encode(JSON.stringify({ sha, branch })));
  } catch {}

  // Publish trigger
  nc.publish('mesh.deploy.trigger', sc.encode(JSON.stringify(trigger)));
  await nc.flush();
  console.log('Deploy trigger sent.\n');

  // Poll for results (10s timeout)
  console.log('Waiting for node responses...');
  const deadline = Date.now() + 15000;
  const seen = new Set();

  try {
    const js = nc.jetstream();
    const resultsKv = await js.views.kv('MESH_DEPLOY_RESULTS');

    while (Date.now() < deadline) {
      // Check all nodes
      const allAliasNodes = [...new Set(Object.values(NODE_ALIASES))];
      const checkNodes = targetNodes.length > 0 ? targetNodes : allAliasNodes;

      for (const nodeId of checkNodes) {
        if (seen.has(nodeId)) continue;
        const key = `${sha}-${nodeId}`;
        try {
          const entry = await resultsKv.get(key);
          if (entry && entry.value) {
            const result = JSON.parse(sc.decode(entry.value));
            if (result.status === 'success' || result.status === 'failed' || result.status === 'skipped') {
              const icon = result.status === 'success' ? '\x1b[32m✓\x1b[0m' : result.status === 'skipped' ? '\x1b[33m-\x1b[0m' : '\x1b[31m✗\x1b[0m';
              console.log(`  ${icon} ${nodeId}: ${result.status} (${result.durationSeconds || 0}s)`);
              if (result.errors && result.errors.length > 0) {
                for (const e of result.errors) console.log(`    Error: ${e}`);
              }
              seen.add(nodeId);
            }
          }
        } catch {}
      }

      if (seen.size >= checkNodes.length) break;
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch {}

  if (seen.size === 0) {
    console.log('  (no responses yet — nodes may still be deploying)');
  }

  console.log('');
  await nc.close();
}

/**
 * mesh help — show usage.
 */
// ── Plan Commands ──────────────────────────────────

async function cmdPlan(args) {
  const { loadTemplate, listTemplates, validateTemplate, instantiateTemplate } = require('../lib/plan-templates');
  const TEMPLATES_DIR = process.env.OPENCLAW_TEMPLATES_DIR || path.join(process.env.HOME, '.openclaw', 'plan-templates');
  const FALLBACK_DIR = path.join(__dirname, '..', 'config', 'plan-templates');

  const sub = args[0];

  switch (sub) {
    case 'templates': {
      // List available templates
      const templates = [
        ...listTemplates(TEMPLATES_DIR),
        ...listTemplates(FALLBACK_DIR),
      ];
      // Deduplicate by id
      const seen = new Set();
      const unique = templates.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

      if (unique.length === 0) {
        console.log('No plan templates found.');
        console.log(`Checked: ${TEMPLATES_DIR}`);
        return;
      }

      console.log('Available plan templates:\n');
      for (const t of unique) {
        console.log(`  ${t.id.padEnd(20)} ${t.description}`);
      }
      return;
    }

    case 'create': {
      // Parse --template, --context, --parent-task, and --set flags
      let templateId = null;
      let context = '';
      let parentTaskId = null;
      const overrides = []; // [{path: 'implement.delegation.mode', value: 'collab_mesh'}, ...]

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--template' && args[i + 1]) { templateId = args[++i]; continue; }
        if (args[i] === '--context' && args[i + 1]) { context = args[++i]; continue; }
        if (args[i] === '--parent-task' && args[i + 1]) { parentTaskId = args[++i]; continue; }
        if (args[i] === '--set' && args[i + 1]) {
          // Format: subtask_id.field.path=value
          const raw = args[++i];
          const eqIdx = raw.indexOf('=');
          if (eqIdx === -1) {
            console.error(`Invalid --set format: "${raw}" (expected subtask_id.field=value)`);
            process.exit(1);
          }
          overrides.push({ path: raw.slice(0, eqIdx), value: raw.slice(eqIdx + 1) });
          continue;
        }
      }

      if (!templateId) {
        console.error('Usage: mesh plan create --template <id> --context "<description>" [--parent-task <task-id>] [--set subtask.field=value]');
        process.exit(1);
      }

      // Find template file
      let templatePath = null;
      for (const dir of [TEMPLATES_DIR, FALLBACK_DIR]) {
        const candidate = path.join(dir, `${templateId}.yaml`);
        if (fs.existsSync(candidate)) { templatePath = candidate; break; }
        const candidateYml = path.join(dir, `${templateId}.yml`);
        if (fs.existsSync(candidateYml)) { templatePath = candidateYml; break; }
      }

      if (!templatePath) {
        console.error(`Template not found: ${templateId}`);
        console.error(`Run "mesh plan templates" to see available templates.`);
        process.exit(1);
      }

      const template = loadTemplate(templatePath);
      const validation = validateTemplate(template);
      if (!validation.valid) {
        console.error('Template validation failed:');
        validation.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      const plan = instantiateTemplate(template, context, { parent_task_id: parentTaskId });

      // Apply --set overrides to instantiated plan subtasks
      // Format: subtask_id.field.nested=value (e.g., implement.delegation.mode=collab_mesh)
      for (const { path: setPath, value } of overrides) {
        const parts = setPath.split('.');
        const subtaskId = parts[0];
        const st = plan.subtasks.find(s => s.subtask_id === subtaskId);
        if (!st) {
          console.error(`--set: unknown subtask "${subtaskId}". Available: ${plan.subtasks.map(s => s.subtask_id).join(', ')}`);
          process.exit(1);
        }
        // Walk the nested path and set the value
        let target = st;
        for (let j = 1; j < parts.length - 1; j++) {
          if (target[parts[j]] === undefined || target[parts[j]] === null) target[parts[j]] = {};
          target = target[parts[j]];
        }
        const finalKey = parts[parts.length - 1];
        // Auto-coerce numbers and booleans
        let coerced = value;
        if (value === 'true') coerced = true;
        else if (value === 'false') coerced = false;
        else if (/^\d+$/.test(value)) coerced = parseInt(value, 10);
        target[finalKey] = coerced;
      }

      // Submit to mesh via NATS
      const nc = await connect({ servers: NATS_URL, timeout: 5000 });
      try {
        const reply = await nc.request(
          'mesh.plans.create',
          sc.encode(JSON.stringify(plan)),
          { timeout: 10000 }
        );
        const result = JSON.parse(sc.decode(reply.data));
        console.log(`Plan created: ${result.plan_id}`);
        console.log(`  Subtasks: ${result.subtasks.length}`);
        console.log(`  Waves: ${result.estimated_waves}`);
        console.log(`  Budget: ${result.total_budget_minutes}min`);
        console.log(`  Status: ${result.status}`);
        if (result.requires_approval) {
          console.log(`\n  Approve with: mesh plan approve ${result.plan_id}`);
        }
      } finally {
        await nc.close();
      }
      return;
    }

    case 'list': {
      let statusFilter = null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--status' && args[i + 1]) { statusFilter = args[++i]; }
      }

      const nc = await connect({ servers: NATS_URL, timeout: 5000 });
      try {
        const payload = statusFilter ? { status: statusFilter } : {};
        const reply = await nc.request(
          'mesh.plans.list',
          sc.encode(JSON.stringify(payload)),
          { timeout: 10000 }
        );
        const plans = JSON.parse(sc.decode(reply.data));
        if (plans.length === 0) {
          console.log('No plans found.');
          return;
        }

        console.log(`Plans (${plans.length}):\n`);
        for (const p of plans) {
          const status = p.status.padEnd(12);
          const subtasks = `${p.total_subtasks} subtasks`;
          console.log(`  ${p.plan_id}  ${status}  ${subtasks}  "${p.title}"`);
        }
      } finally {
        await nc.close();
      }
      return;
    }

    case 'show': {
      const planId = args[1];
      if (!planId) {
        console.error('Usage: mesh plan show <plan-id>');
        process.exit(1);
      }

      const nc = await connect({ servers: NATS_URL, timeout: 5000 });
      try {
        const reply = await nc.request(
          'mesh.plans.get',
          sc.encode(JSON.stringify({ plan_id: planId })),
          { timeout: 10000 }
        );
        const plan = JSON.parse(sc.decode(reply.data));
        if (!plan || plan.error) {
          console.error(plan?.error || `Plan not found: ${planId}`);
          process.exit(1);
        }

        // Header
        console.log(`\nPlan: ${plan.plan_id}`);
        console.log(`  Title:    ${plan.title}`);
        console.log(`  Status:   ${plan.status}`);
        console.log(`  Policy:   ${plan.failure_policy || 'continue_best_effort'}`);
        console.log(`  Approval: ${plan.requires_approval ? 'required' : 'auto'}`);
        if (plan.created_at) console.log(`  Created:  ${plan.created_at}`);
        if (plan.parent_task_id) console.log(`  Parent:   ${plan.parent_task_id}`);

        // Compute waves from subtask dependencies
        const subtasks = plan.subtasks || [];
        const waves = new Map();
        for (const st of subtasks) {
          const wave = st.wave ?? 0;
          if (!waves.has(wave)) waves.set(wave, []);
          waves.get(wave).push(st);
        }

        // If no wave field, group by dependency depth
        if (waves.size <= 1 && subtasks.length > 1) {
          waves.clear();
          const idToSt = new Map(subtasks.map(s => [s.subtask_id, s]));
          const depths = new Map();
          function getDepth(id) {
            if (depths.has(id)) return depths.get(id);
            const st = idToSt.get(id);
            if (!st || !st.depends_on || st.depends_on.length === 0) { depths.set(id, 0); return 0; }
            const d = 1 + Math.max(...st.depends_on.map(dep => getDepth(dep)));
            depths.set(id, d);
            return d;
          }
          for (const st of subtasks) getDepth(st.subtask_id);
          for (const st of subtasks) {
            const w = depths.get(st.subtask_id) || 0;
            if (!waves.has(w)) waves.set(w, []);
            waves.get(w).push(st);
          }
        }

        // Render subtask tree
        const sortedWaves = [...waves.keys()].sort((a, b) => a - b);
        for (const w of sortedWaves) {
          console.log(`\n  ── Wave ${w} ${'─'.repeat(50)}`);
          for (const st of waves.get(w)) {
            const status = (st.status || 'pending').toUpperCase();
            const critical = st.critical ? ' [CRITICAL]' : '';
            const mode = st.delegation?.mode || 'auto';
            const reason = st.delegation?.reason ? ` (${st.delegation.reason})` : '';
            const budget = st.budget_minutes ? ` ${st.budget_minutes}min` : '';
            const metric = st.metric ? ` metric:"${st.metric}"` : '';
            const deps = st.depends_on?.length ? ` deps:[${st.depends_on.join(',')}]` : '';

            console.log(`    ${status.padEnd(10)} ${st.subtask_id}${critical}`);
            console.log(`               "${st.title}"`);
            console.log(`               route:${mode}${reason}${budget}${metric}${deps}`);

            if (st.result) {
              const success = st.result.success ? '✓' : '✗';
              const summary = st.result.summary || '';
              console.log(`               result: ${success} ${summary}`);
            }
          }
        }

        // Summary
        const completed = subtasks.filter(s => s.status === 'completed').length;
        const failed = subtasks.filter(s => s.status === 'failed').length;
        const blocked = subtasks.filter(s => s.status === 'blocked').length;
        const pending = subtasks.filter(s => s.status === 'pending' || s.status === 'queued').length;
        const running = subtasks.filter(s => s.status === 'running').length;
        console.log(`\n  Summary: ${subtasks.length} subtasks — ${completed} done, ${running} running, ${pending} pending, ${failed} failed, ${blocked} blocked`);

      } finally {
        await nc.close();
      }
      return;
    }

    case 'approve': {
      const planId = args[1];
      if (!planId) {
        console.error('Usage: mesh plan approve <plan-id>');
        process.exit(1);
      }

      const nc = await connect({ servers: NATS_URL, timeout: 5000 });
      try {
        const reply = await nc.request(
          'mesh.plans.approve',
          sc.encode(JSON.stringify({ plan_id: planId })),
          { timeout: 10000 }
        );
        const result = JSON.parse(sc.decode(reply.data));
        console.log(`Plan approved: ${result.plan_id}`);
        console.log(`  Status: ${result.status}`);
        console.log(`  Wave 0 dispatched with ${result.subtasks.filter(s => s.status !== 'pending').length} subtasks`);
      } finally {
        await nc.close();
      }
      return;
    }

    case 'abort': {
      const planId = args[1];
      let reason = 'Manual abort';
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--reason' && args[i + 1]) { reason = args[++i]; }
      }

      if (!planId) {
        console.error('Usage: mesh plan abort <plan-id> [--reason "..."]');
        process.exit(1);
      }

      const nc = await connect({ servers: NATS_URL, timeout: 5000 });
      try {
        const reply = await nc.request(
          'mesh.plans.abort',
          sc.encode(JSON.stringify({ plan_id: planId, reason })),
          { timeout: 10000 }
        );
        const result = JSON.parse(sc.decode(reply.data));
        console.log(`Plan aborted: ${result.plan_id}`);
      } finally {
        await nc.close();
      }
      return;
    }

    default:
      console.log([
        '',
        'mesh plan -- Plan management commands',
        '',
        '  mesh plan templates                     List available templates',
        '  mesh plan create --template <id>        Create plan from template',
        '    --context "<description>"              Context for template variables',
        '    --parent-task <task-id>                Link to parent task',
        '    --set subtask.field=value              Override subtask fields post-instantiation',
        '                                           e.g., --set implement.delegation.mode=collab_mesh',
        '                                                 --set test.budget_minutes=30',
        '  mesh plan list                          List all plans',
        '    --status <status>                      Filter by status',
        '  mesh plan show <plan-id>                Show full plan with subtask tree',
        '  mesh plan approve <plan-id>             Approve and start executing',
        '  mesh plan abort <plan-id>               Abort a plan',
        '    --reason "..."                         Reason for abort',
        '',
      ].join('\n'));
  }
}

function cmdHelp() {
  console.log([
    '',
    'mesh -- OpenClaw multi-node mesh CLI',
    '',
    'USAGE:',
    '  mesh status                             Show online nodes',
    '  mesh exec "<command>"                   Run command on remote node',
    '  mesh exec --node <n> "<command>"        Run command on specific node',
    '  mesh capture                            Screenshot this machine',
    '  mesh capture --node ubuntu              Screenshot remote node',
    '  mesh ls [subdir]                        List shared folder',
    '  mesh put <file> [subdir]                Copy file to shared folder',
    '  mesh broadcast "<message>"              Send message to all nodes',
    '  mesh submit <task.yaml>                 Submit a task YAML to the mesh',
    '  mesh submit --id <task-id>              Submit a kanban card by ID',
    '  cat task.yaml | mesh submit             Submit from stdin',
    '  mesh tasks                              List all mesh tasks',
    '  mesh tasks --status running             Filter mesh tasks by status',
    '  mesh tasks review                       List tasks pending human review',
    '  mesh tasks approve <task-id>            Approve a pending_review task',
    '  mesh tasks reject <task-id>             Reject and re-queue a task',
    '    --reason "..."                         Reason for rejection',
    '  mesh plan <subcommand>                  Plan management (templates, create, approve)',
    '  mesh health                             Health check this node',
    '  mesh health --all                       Health check ALL nodes',
    '  mesh health --json                      Health check (JSON output)',
    '  mesh repair                             Self-repair this node',
    '  mesh repair --all                       Self-repair ALL nodes',
    '  mesh deploy                             Deploy to all nodes',
    '  mesh deploy --force                     Force deploy (skip cache)',
    '  mesh deploy --node ubuntu               Deploy to specific node',
    '  mesh deploy --component mesh-daemons    Deploy specific component',
    '',
    'NODE ALIASES:',
    '  ubuntu, linux   = Ubuntu VM (calos-vmware-virtual-platform)',
    '  mac, macos      = macOS VM (moltymacs-virtual-machine-local)',
    '',
    'SHARED FOLDER:',
    '  ~/openclaw/shared/  -- auto-synced between all nodes via NATS',
    '',
    'ENVIRONMENT:',
    '  OPENCLAW_NATS  -- NATS server URL (auto-detected from env or ~/.openclaw/openclaw.env)',
    '',
  ].join('\n'));
}

// --- Main dispatch ---------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'status':    return cmdStatus();
    case 'exec':      return cmdExec(args);
    case 'capture':   return cmdCapture(args);
    case 'ls':        return cmdLs(args);
    case 'put':       return cmdPut(args);
    case 'broadcast': return cmdBroadcast(args);
    case 'submit':    return cmdSubmit(args);
    case 'tasks':     return cmdTasks(args);
    case 'health':    return cmdHealth(args);
    case 'repair':    return cmdRepair(args);
    case 'deploy':    return cmdDeploy(args);
    case 'plan':      return cmdPlan(args);
    case 'help':
    case '--help':
    case '-h':        return cmdHelp();
    default:
      if (!cmd) return cmdHelp();
      console.error(`Unknown command: ${cmd}`);
      console.error(`Run "mesh help" for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`mesh error: ${err.message}`);
  process.exit(1);
});
