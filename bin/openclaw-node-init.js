#!/usr/bin/env node

/**
 * openclaw-node-init.js — One-click mesh node provisioner.
 *
 * Takes a join token (from mesh-join-token.js) and bootstraps a fully
 * functional mesh worker node. Handles:
 *   1. Token validation (signature + expiry)
 *   2. OS detection (macOS/Linux)
 *   3. Dependency checks (Node.js, git, nats-server optional)
 *   4. Directory structure (~/.openclaw/)
 *   5. NATS configuration (from token)
 *   6. Mesh code installation (repo URL from token)
 *   7. Service installation (launchd/systemd)
 *   8. Health verification (service alive + NATS connectivity)
 *
 * Usage:
 *   MESH_JOIN_TOKEN=<token> node bin/openclaw-node-init.js
 *   node bin/openclaw-node-init.js --token <token>
 *   node bin/openclaw-node-init.js --token <token> --dry-run
 *   node bin/openclaw-node-init.js --token <token> --provider deepseek
 *
 * The token contains NATS URL, repo URL, role, and default provider.
 * API keys must be set separately in ~/.openclaw/openclaw.env after provisioning.
 */

const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REPAIR_MODE = args.includes('--repair');

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const TOKEN_RAW = getArg('--token', null) || process.env.MESH_JOIN_TOKEN;
const PROVIDER_OVERRIDE = getArg('--provider', null);
const SSH_PUBKEY = getArg('--ssh-key', null);

// Default repo URL — used when token is v1 (no repo field)
const DEFAULT_REPO = 'https://github.com/moltyguibros-design/openclaw-node.git';

// ── Logging ───────────────────────────────────────────

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg) { console.log(`${CYAN}[mesh-init]${RESET} ${msg}`); }
function ok(msg)  { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function warn(msg){ console.log(`${YELLOW}  ⚠${RESET} ${msg}`); }
function fail(msg){ console.error(`${RED}  ✗${RESET} ${msg}`); }
function step(n, msg) { console.log(`\n${BOLD}[${n}]${RESET} ${msg}`); }

// ── Token Parsing ─────────────────────────────────────

function parseToken(raw) {
  if (!raw) {
    fail('No join token provided. Use --token <token> or set MESH_JOIN_TOKEN env var.');
    fail('Generate a token on the lead node: node bin/mesh-join-token.js');
    process.exit(1);
  }

  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return { payload: decoded.p, signature: decoded.s };
  } catch (e) {
    fail(`Invalid token format: ${e.message}`);
    process.exit(1);
  }
}

function validateToken(payload) {
  // Accept v1 (no repo), v2 (with repo), v3 (with ssh_pubkey)
  if (payload.v !== 1 && payload.v !== 2 && payload.v !== 3) {
    fail(`Unsupported token version: ${payload.v}. This provisioner supports v1, v2, and v3.`);
    process.exit(1);
  }
  if (payload.expires && Date.now() > payload.expires) {
    fail(`Token expired at ${new Date(payload.expires).toISOString()}`);
    fail('Generate a new token on the lead node: node bin/mesh-join-token.js');
    process.exit(1);
  }
  if (!payload.nats) {
    fail('Token missing NATS URL');
    process.exit(1);
  }
}

// ── OS Detection ──────────────────────────────────────

function detectOS() {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  if (platform === 'darwin') return { os: 'macos', serviceType: 'launchd', arch, release };
  if (platform === 'linux') return { os: 'linux', serviceType: 'systemd', arch, release };
  fail(`Unsupported platform: ${platform}. OpenClaw mesh requires macOS or Linux.`);
  process.exit(1);
}

// ── Dependency Checks ─────────────────────────────────

function checkCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getNodeVersion() {
  try {
    const v = execSync('node --version', { encoding: 'utf8' }).trim();
    const major = parseInt(v.replace('v', '').split('.')[0]);
    return { version: v, major };
  } catch {
    return null;
  }
}

function checkDependencies(osInfo) {
  const deps = [];
  const missing = [];

  // Node.js 18+
  const nodeInfo = getNodeVersion();
  if (nodeInfo && nodeInfo.major >= 18) {
    deps.push({ name: 'Node.js', status: 'ok', detail: nodeInfo.version });
  } else if (nodeInfo) {
    deps.push({ name: 'Node.js', status: 'upgrade', detail: `${nodeInfo.version} (need 18+)` });
    missing.push('node');
  } else {
    deps.push({ name: 'Node.js', status: 'missing', detail: '' });
    missing.push('node');
  }

  // Git
  if (checkCommand('git')) {
    const v = execSync('git --version', { encoding: 'utf8' }).trim();
    deps.push({ name: 'Git', status: 'ok', detail: v });
  } else {
    deps.push({ name: 'Git', status: 'missing', detail: '' });
    missing.push('git');
  }

  // Tailscale (optional but recommended)
  if (checkCommand('tailscale')) {
    deps.push({ name: 'Tailscale', status: 'ok', detail: 'installed' });
  } else {
    deps.push({ name: 'Tailscale', status: 'optional', detail: 'not installed (recommended for secure mesh)' });
  }

  return { deps, missing };
}

function installMissing(missing, osInfo) {
  if (missing.length === 0) return;

  log(`Installing missing dependencies: ${missing.join(', ')}`);

  if (DRY_RUN) {
    warn('[DRY RUN] Would install: ' + missing.join(', '));
    return;
  }

  if (osInfo.os === 'macos') {
    if (!checkCommand('brew')) {
      fail('Homebrew not found. Install it first: https://brew.sh');
      process.exit(1);
    }
    for (const dep of missing) {
      const pkg = dep === 'node' ? 'node@22' : dep;
      log(`  brew install ${pkg}`);
      spawnSync('brew', ['install', pkg], { stdio: 'inherit' });
    }
  } else {
    // Linux — try apt, then yum, then dnf
    const pm = checkCommand('apt-get') ? 'apt-get'
             : checkCommand('yum') ? 'yum'
             : checkCommand('dnf') ? 'dnf'
             : null;

    if (!pm) {
      fail('No supported package manager found (need apt, yum, or dnf)');
      process.exit(1);
    }

    for (const dep of missing) {
      if (dep === 'node') {
        // Use NodeSource for recent Node.js
        log('  Installing Node.js 22.x via NodeSource...');
        try {
          execSync('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -', { stdio: 'inherit' });
          execSync(`sudo ${pm} install -y nodejs`, { stdio: 'inherit' });
        } catch (e) {
          fail(`Node.js installation failed: ${e.message}`);
          process.exit(1);
        }
      } else {
        log(`  sudo ${pm} install -y ${dep}`);
        spawnSync('sudo', [pm, 'install', '-y', dep], { stdio: 'inherit' });
      }
    }
  }
}

// ── Directory Setup ───────────────────────────────────

function setupDirectories() {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.openclaw'),
    path.join(home, '.openclaw', 'workspace'),
    path.join(home, '.openclaw', 'workspace', '.tmp'),
    path.join(home, '.openclaw', 'workspace', 'memory'),
    path.join(home, '.openclaw', 'worktrees'),
    path.join(home, '.openclaw', 'config'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      if (DRY_RUN) {
        warn(`[DRY RUN] Would create: ${dir}`);
      } else {
        fs.mkdirSync(dir, { recursive: true });
        ok(`Created: ${dir}`);
      }
    } else {
      ok(`Exists: ${dir}`);
    }
  }
}

// ── SSH Key Provisioning ─────────────────────────────

function provisionSSHKey(pubkey) {
  if (!pubkey) return;

  const sshDir = path.join(os.homedir(), '.ssh');
  const authKeysPath = path.join(sshDir, 'authorized_keys');

  if (DRY_RUN) {
    warn(`[DRY RUN] Would add SSH key to ${authKeysPath}`);
    return;
  }

  // Ensure .ssh dir exists with correct permissions
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
    ok(`Created ${sshDir}`);
  } else {
    try { fs.chmodSync(sshDir, 0o700); } catch { /* best effort */ }
  }

  // Check if key already present
  let existing = '';
  if (fs.existsSync(authKeysPath)) {
    existing = fs.readFileSync(authKeysPath, 'utf8');
    // Extract the key portion (type + base64) for comparison, ignore comment
    const keyParts = pubkey.trim().split(/\s+/);
    const keyFingerprint = keyParts.length >= 2 ? `${keyParts[0]} ${keyParts[1]}` : pubkey.trim();
    if (existing.includes(keyFingerprint)) {
      ok('Lead node SSH key already authorized');
      return;
    }
  }

  // Append key
  const entry = existing.endsWith('\n') || existing === ''
    ? `${pubkey.trim()}\n`
    : `\n${pubkey.trim()}\n`;
  fs.appendFileSync(authKeysPath, entry, { mode: 0o600 });

  // Fix permissions
  try { fs.chmodSync(authKeysPath, 0o600); } catch { /* best effort */ }

  ok('Lead node SSH key added to authorized_keys');
}

// ── NATS Configuration ───────────────────────────────

function configureNats(natsUrl) {
  const envPath = path.join(os.homedir(), '.openclaw', 'openclaw.env');

  if (DRY_RUN) {
    warn(`[DRY RUN] Would write NATS URL to ${envPath}`);
    return;
  }

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
    // Update existing OPENCLAW_NATS line or append
    if (content.match(/^\s*OPENCLAW_NATS\s*=/m)) {
      content = content.replace(/^\s*OPENCLAW_NATS\s*=.*/m, `OPENCLAW_NATS=${natsUrl}`);
    } else {
      content += `\nOPENCLAW_NATS=${natsUrl}\n`;
    }
  } else {
    content = `# OpenClaw Mesh Configuration\n# Generated by openclaw-node-init.js\nOPENCLAW_NATS=${natsUrl}\n`;
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  ok(`NATS URL configured: ${natsUrl}`);
}

// ── Mesh Code Installation ───────────────────────────

function installMeshCode(repoUrl) {
  const meshDir = path.join(os.homedir(), 'openclaw');

  if (fs.existsSync(path.join(meshDir, 'package.json'))) {
    ok(`Mesh code already installed at ${meshDir}`);
    // npm install to ensure deps are current
    if (!DRY_RUN) {
      log('  Updating dependencies...');
      spawnSync('npm', ['install', '--production'], { cwd: meshDir, stdio: 'pipe' });
      ok('Dependencies updated');
    }
    return meshDir;
  }

  if (DRY_RUN) {
    warn(`[DRY RUN] Would clone ${repoUrl} to ${meshDir}`);
    return meshDir;
  }

  log(`Cloning mesh code from ${repoUrl}...`);
  try {
    execSync(
      `git clone "${repoUrl}" "${meshDir}"`,
      { stdio: 'inherit', timeout: 60000 }
    );
    spawnSync('npm', ['install', '--production'], { cwd: meshDir, stdio: 'pipe' });
    ok('Mesh code installed');
  } catch (e) {
    fail(`Failed to clone mesh code: ${e.message}`);
    fail(`Repo URL: ${repoUrl}`);
    process.exit(1);
  }

  return meshDir;
}

// ── Service Installation ─────────────────────────────

function installService(osInfo, meshDir, config) {
  const nodeId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const nodeBin = process.execPath; // path to current node binary
  const provider = config.provider;

  if (osInfo.serviceType === 'launchd') {
    return installLaunchdService(meshDir, nodeBin, nodeId, provider, config.nats);
  } else {
    return installSystemdService(meshDir, nodeBin, nodeId, provider, config.nats);
  }
}

function installLaunchdService(meshDir, nodeBin, nodeId, provider, natsUrl) {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, 'ai.openclaw.mesh-agent.plist');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openclaw.mesh-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${meshDir}/bin/mesh-agent.js</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/.openclaw/workspace/.tmp/mesh-agent.log</string>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/.openclaw/workspace/.tmp/mesh-agent.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCLAW_NATS</key>
    <string>${natsUrl}</string>
    <key>MESH_NODE_ID</key>
    <string>${nodeId}</string>
    <key>MESH_LLM_PROVIDER</key>
    <string>${provider}</string>
    <key>MESH_WORKSPACE</key>
    <string>${os.homedir()}/.openclaw/workspace</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${os.homedir()}/.npm-global/bin</string>
    <key>NODE_PATH</key>
    <string>${meshDir}/node_modules:${meshDir}/lib</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>`;

  if (DRY_RUN) {
    warn(`[DRY RUN] Would write launchd plist to ${plistPath}`);
    return;
  }

  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(plistPath, plist);
  ok(`Launchd service written: ${plistPath}`);

  // Load the service
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    ok('Service loaded and started');
  } catch (e) {
    warn(`Service load warning: ${e.message}`);
  }
}

function installSystemdService(meshDir, nodeBin, nodeId, provider, natsUrl) {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, 'openclaw-mesh-agent.service');

  const service = `[Unit]
Description=OpenClaw Mesh Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodeBin} ${meshDir}/bin/mesh-agent.js
Restart=always
RestartSec=30
Environment=OPENCLAW_NATS=${natsUrl}
Environment=MESH_NODE_ID=${nodeId}
Environment=MESH_LLM_PROVIDER=${provider}
Environment=MESH_WORKSPACE=${os.homedir()}/.openclaw/workspace
Environment=NODE_PATH=${meshDir}/node_modules:${meshDir}/lib
WorkingDirectory=${meshDir}

[Install]
WantedBy=default.target
`;

  if (DRY_RUN) {
    warn(`[DRY RUN] Would write systemd service to ${servicePath}`);
    return;
  }

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(servicePath, service);
  ok(`Systemd service written: ${servicePath}`);

  // Enable and start
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable openclaw-mesh-agent', { stdio: 'pipe' });
    execSync('systemctl --user start openclaw-mesh-agent', { stdio: 'pipe' });
    ok('Service enabled and started');
  } catch (e) {
    warn(`Service start warning: ${e.message}`);
    warn('Try manually: systemctl --user start openclaw-mesh-agent');
  }

  // Enable lingering — requires either sudo or polkit permission.
  // Without linger, the service dies when the user logs out.
  const username = os.userInfo().username;
  try {
    // Try without sudo first (works if polkit allows it)
    execSync(`loginctl enable-linger ${username}`, { stdio: 'pipe', timeout: 5000 });
    ok(`Linger enabled for ${username} (service survives logout)`);
  } catch {
    try {
      // Try with sudo
      execSync(`sudo loginctl enable-linger ${username}`, { stdio: 'pipe', timeout: 5000 });
      ok(`Linger enabled for ${username} via sudo (service survives logout)`);
    } catch (e2) {
      warn(`Could not enable linger for ${username}: ${e2.message}`);
      warn('Without linger, the mesh-agent service will stop when you log out.');
      warn(`Fix manually: sudo loginctl enable-linger ${username}`);
    }
  }
}

// ── Service Health Polling ───────────────────────────

function verifyServiceRunning(osInfo) {
  if (DRY_RUN) {
    warn('[DRY RUN] Would verify service is running');
    return true;
  }

  log('Waiting 8s for service to stabilize...');

  // Wait for the service to either stabilize or crash
  const waitMs = 8000;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    spawnSync('sleep', ['1']); // cross-platform 1s sleep
  }

  if (osInfo.serviceType === 'launchd') {
    try {
      const out = execSync('launchctl list | grep mesh-agent', { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (out) {
        // launchctl list format: PID\tStatus\tLabel
        const parts = out.split(/\s+/);
        const pid = parts[0];
        const exitStatus = parts[1];
        if (pid && pid !== '-') {
          ok(`Service running (PID ${pid})`);
          return true;
        } else {
          fail(`Service not running (exit status: ${exitStatus})`);
          fail('Check logs: tail -f ~/.openclaw/workspace/.tmp/mesh-agent.err');
          return false;
        }
      }
    } catch {
      fail('Service not found in launchctl');
      return false;
    }
  } else {
    // systemd
    try {
      const result = spawnSync('systemctl', ['--user', 'is-active', 'openclaw-mesh-agent'], { encoding: 'utf8', stdio: 'pipe' });
      const status = (result.stdout || '').trim();
      if (status === 'active') {
        ok('Service running (systemd active)');
        return true;
      } else {
        fail(`Service not running (systemd status: ${status})`);
        fail('Check logs: journalctl --user -u openclaw-mesh-agent -n 20');
        return false;
      }
    } catch {
      fail('Could not check systemd service status');
      return false;
    }
  }
  return false;
}

// ── NATS Health Verification ─────────────────────────

async function verifyNatsHealth(natsUrl, nodeId) {
  log('Verifying NATS connectivity...');

  if (DRY_RUN) {
    warn('[DRY RUN] Would verify NATS connectivity');
    return true;
  }

  try {
    // Dynamic require — nats module should be installed by now
    const nats = require('nats');
    const nc = await nats.connect({ servers: natsUrl, timeout: 10000 });

    ok(`NATS connected: ${nc.getServer()}`);

    // Publish a health announcement
    const sc = nats.StringCodec();
    nc.publish(`mesh.health.${nodeId}`, sc.encode(JSON.stringify({
      node_id: nodeId,
      status: 'online',
      event: 'node_joined',
      os: os.platform(),
      arch: os.arch(),
      timestamp: new Date().toISOString(),
    })));

    ok('Health announcement published');

    // Try to reach the task daemon
    try {
      const msg = await nc.request('mesh.tasks.list', sc.encode(JSON.stringify({ status: 'queued' })), { timeout: 5000 });
      const resp = JSON.parse(sc.decode(msg.data));
      if (resp.ok) {
        ok(`Task daemon reachable — ${resp.data.length} queued task(s)`);
      } else {
        warn(`Task daemon responded with error: ${resp.error}`);
      }
    } catch {
      warn('Task daemon not reachable (may not be running yet — this is OK for worker-only nodes)');
    }

    await nc.drain();
    return true;
  } catch (e) {
    fail(`NATS connection failed: ${e.message}`);
    fail('Check that the NATS server is running and the node has network access');
    return false;
  }
}

// ── Main ──────────────────────────────────────────────

// ── Repair Mode ──────────────────────────────────────

function loadExistingConfig() {
  const envPath = path.join(os.homedir(), '.openclaw', 'openclaw.env');
  const config = { nats: null, role: 'worker', provider: 'claude', repo: DEFAULT_REPO };

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const natsMatch = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
    if (natsMatch) config.nats = natsMatch[1].trim();
    const providerMatch = content.match(/^\s*MESH_LLM_PROVIDER\s*=\s*(.+)/m);
    if (providerMatch) config.provider = providerMatch[1].trim();
  }

  return config;
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const title = REPAIR_MODE ? 'OpenClaw Mesh — Repair Mode' : 'OpenClaw Mesh Node Provisioner';
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   ${title.padEnd(35)}║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}\n`);

  if (DRY_RUN) warn('DRY RUN MODE — no changes will be made\n');

  let payload, config;

  if (REPAIR_MODE) {
    // ── Repair mode: skip token, use existing config ──
    step(1, 'Loading existing configuration...');
    config = loadExistingConfig();
    if (!config.nats) {
      fail('No NATS URL found in ~/.openclaw/openclaw.env');
      fail('Cannot repair without existing config. Use a join token instead.');
      process.exit(1);
    }
    ok(`NATS: ${config.nats}`);
    ok(`Provider: ${config.provider}`);
    payload = { ssh_pubkey: null };

    // Accept SSH key from CLI in repair mode
    if (SSH_PUBKEY) {
      payload.ssh_pubkey = SSH_PUBKEY;
    }
  } else {
    // ── Normal mode: parse and validate token ──
    step(1, 'Validating join token...');
    const parsed = parseToken(TOKEN_RAW);
    payload = parsed.payload;
    validateToken(payload);
    ok(`Token valid (v${payload.v}, role: ${payload.role}, provider: ${payload.provider}, lead: ${payload.lead})`);
    ok(`Expires: ${new Date(payload.expires).toISOString()}`);

    // Extract config from token (with defaults for v1 tokens)
    const repoUrl = payload.repo || DEFAULT_REPO;
    config = {
      nats: payload.nats,
      role: payload.role,
      provider: PROVIDER_OVERRIDE || payload.provider,
      repo: repoUrl,
    };

    if (payload.repo) {
      ok(`Repo: ${repoUrl}`);
    } else {
      warn(`Token v1 (no repo field) — using default: ${DEFAULT_REPO}`);
    }
  }

  // ── Step 2: Detect OS ──
  step(2, 'Detecting environment...');
  const osInfo = detectOS();
  const nodeId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  ok(`OS: ${osInfo.os} (${osInfo.arch})`);
  ok(`Node ID: ${nodeId}`);
  ok(`Service type: ${osInfo.serviceType}`);

  // ── Step 3: Check dependencies ──
  step(3, 'Checking dependencies...');
  const { deps, missing } = checkDependencies(osInfo);
  for (const d of deps) {
    if (d.status === 'ok') ok(`${d.name}: ${d.detail}`);
    else if (d.status === 'optional') warn(`${d.name}: ${d.detail}`);
    else fail(`${d.name}: ${d.status} ${d.detail}`);
  }

  if (missing.length > 0) {
    step('3b', 'Installing missing dependencies...');
    installMissing(missing, osInfo);
  }

  // ── Step 4: Create directory structure ──
  step(4, 'Setting up directories...');
  setupDirectories();

  // ── Step 4b: Provision SSH key (if provided in token or CLI) ──
  const sshKey = SSH_PUBKEY || payload.ssh_pubkey || null;
  if (sshKey) {
    step('4b', 'Provisioning lead node SSH key...');
    provisionSSHKey(sshKey);
  }

  // ── Step 5: Configure NATS ──
  step(5, 'Configuring NATS connection...');
  configureNats(config.nats);

  // ── Step 6: Install mesh code ──
  step(6, 'Installing mesh code...');
  const meshDir = installMeshCode(config.repo);

  // ── Step 7: Install service ──
  step(7, `Installing ${osInfo.serviceType} service...`);
  installService(osInfo, meshDir, config);

  // ── Step 8: Verify health (service + NATS) ──
  step(8, 'Verifying health...');
  const serviceAlive = verifyServiceRunning(osInfo);
  const natsHealthy = await verifyNatsHealth(config.nats, nodeId);
  const healthy = serviceAlive && natsHealthy;

  // ── Done ──
  console.log(`\n${BOLD}${GREEN}═══════════════════════════════════════${RESET}`);
  if (healthy) {
    console.log(`${BOLD}${GREEN}  Node "${nodeId}" joined the mesh!${RESET}`);
  } else if (serviceAlive && !natsHealthy) {
    console.log(`${BOLD}${YELLOW}  Service running but NATS unreachable.${RESET}`);
    console.log(`${YELLOW}  The agent will retry automatically.${RESET}`);
  } else if (!serviceAlive) {
    console.log(`${BOLD}${RED}  Service failed to start.${RESET}`);
    console.log(`${RED}  Provisioning complete but agent is not running.${RESET}`);
  } else {
    console.log(`${BOLD}${YELLOW}  Node provisioned but health check failed.${RESET}`);
    console.log(`${YELLOW}  The service is installed and will retry automatically.${RESET}`);
  }
  console.log(`${BOLD}${GREEN}═══════════════════════════════════════${RESET}\n`);

  console.log('Next steps:');
  console.log(`  1. Add API keys to ~/.openclaw/openclaw.env`);
  console.log(`     Example: ANTHROPIC_API_KEY=sk-ant-...`);
  if (osInfo.serviceType === 'systemd') {
    console.log(`  2. Check service: systemctl --user status openclaw-mesh-agent`);
    console.log(`  3. View logs: journalctl --user -u openclaw-mesh-agent -f`);
  } else {
    console.log(`  2. Check service: launchctl list | grep mesh-agent`);
    console.log(`  3. View logs: tail -f ~/.openclaw/workspace/.tmp/mesh-agent.log`);
  }
  console.log(`  4. Submit a test task from lead: node bin/mesh.js submit --title "hello" --provider shell`);
  if (!serviceAlive) {
    console.log(`\n  ${RED}IMPORTANT: Fix the service error above before proceeding.${RESET}`);
  }
  console.log('');
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});
