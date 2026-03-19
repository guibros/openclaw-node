#!/usr/bin/env node

/**
 * openclaw-node-init.js — Zero-config mesh node provisioner.
 *
 * Tailscale IS the trust layer. No tokens. No secrets. No lead interaction.
 *
 * What it does:
 *   1. Scan Tailscale peers for NATS (port 4222)
 *   2. OS detection (macOS/Linux)
 *   3. Dependency checks (Node.js, git)
 *   4. Directory structure (~/.openclaw/)
 *   5. NATS configuration (auto-discovered)
 *   6. Mesh code installation (git clone)
 *   7. Service installation (launchd/systemd)
 *   8. Health verification (service alive + NATS connectivity)
 *
 * Usage:
 *   npx openclaw-node                                    # auto-discover everything
 *   node bin/openclaw-node-init.js                        # same
 *   node bin/openclaw-node-init.js --nats nats://x:4222   # explicit NATS URL
 *   node bin/openclaw-node-init.js --provider deepseek    # set default LLM
 *   node bin/openclaw-node-init.js --dry-run              # preview only
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const NATS_OVERRIDE = getArg('--nats', null);
const PROVIDER_OVERRIDE = getArg('--provider', 'claude');
const REPO = getArg('--repo', 'https://github.com/moltyguibros-design/openclaw-node.git');
const SSH_PUBKEY = getArg('--ssh-key', null);

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

// ── TCP Port Probe (pure Node, no nc dependency) ────

function probePort(ip, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, ip);
  });
}

// ── Tailscale NATS Discovery ─────────────────────────

async function discoverNats() {
  if (NATS_OVERRIDE) {
    ok(`Using explicit NATS URL: ${NATS_OVERRIDE}`);
    return NATS_OVERRIDE;
  }

  // Check existing config first
  const envPath = path.join(os.homedir(), '.openclaw', 'openclaw.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
    if (match) {
      const existing = match[1].trim();
      ok(`Found existing NATS config: ${existing}`);
      return existing;
    }
  }

  // Scan Tailscale peers
  log('Scanning Tailscale network for NATS...');

  let tsStatus;
  try {
    tsStatus = JSON.parse(execSync('tailscale status --json', { encoding: 'utf8', timeout: 10000 }));
  } catch (e) {
    fail('Tailscale not available or not connected.');
    fail('Install Tailscale and join your network, or use --nats nats://host:4222');
    process.exit(1);
  }

  // Collect all peer IPs (including self)
  const candidates = [];

  // Add self
  if (tsStatus.Self && tsStatus.Self.TailscaleIPs) {
    for (const ip of tsStatus.Self.TailscaleIPs) {
      if (ip.includes('.')) candidates.push(ip); // IPv4 only
    }
  }

  // Add peers
  if (tsStatus.Peer) {
    for (const [, peer] of Object.entries(tsStatus.Peer)) {
      if (peer.TailscaleIPs) {
        for (const ip of peer.TailscaleIPs) {
          if (ip.includes('.')) candidates.push(ip); // IPv4 only
        }
      }
    }
  }

  if (candidates.length === 0) {
    fail('No Tailscale peers found. Is Tailscale connected?');
    fail('Run: tailscale up');
    process.exit(1);
  }

  log(`Found ${candidates.length} Tailscale IPs. Probing port 4222...`);

  for (const ip of candidates) {
    if (await probePort(ip, 4222)) {
      const natsUrl = `nats://${ip}:4222`;
      ok(`NATS found at ${natsUrl}`);
      return natsUrl;
    }
  }

  fail('No NATS server found on any Tailscale peer (port 4222).');
  fail('Ensure NATS is running on your lead node, or use --nats nats://host:4222');
  process.exit(1);
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

function checkDependencies() {
  const deps = [];
  const missing = [];

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

  if (checkCommand('git')) {
    const v = execSync('git --version', { encoding: 'utf8' }).trim();
    deps.push({ name: 'Git', status: 'ok', detail: v });
  } else {
    deps.push({ name: 'Git', status: 'missing', detail: '' });
    missing.push('git');
  }

  if (checkCommand('tailscale')) {
    deps.push({ name: 'Tailscale', status: 'ok', detail: 'installed' });
  } else {
    deps.push({ name: 'Tailscale', status: 'missing', detail: 'required for mesh discovery' });
    if (!NATS_OVERRIDE) missing.push('tailscale');
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
        log('  Installing Node.js 22.x via NodeSource...');
        try {
          execSync('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -', { stdio: 'inherit' });
          execSync(`sudo ${pm} install -y nodejs`, { stdio: 'inherit' });
        } catch (e) {
          fail(`Node.js installation failed: ${e.message}`);
          process.exit(1);
        }
      } else if (dep === 'tailscale') {
        log('  Installing Tailscale...');
        try {
          execSync('curl -fsSL https://tailscale.com/install.sh | sh', { stdio: 'inherit' });
        } catch (e) {
          fail(`Tailscale installation failed: ${e.message}`);
          fail('Install manually: https://tailscale.com/download');
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

  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
    ok(`Created ${sshDir}`);
  } else {
    try { fs.chmodSync(sshDir, 0o700); } catch { /* best effort */ }
  }

  let existing = '';
  if (fs.existsSync(authKeysPath)) {
    existing = fs.readFileSync(authKeysPath, 'utf8');
    const keyParts = pubkey.trim().split(/\s+/);
    const keyFingerprint = keyParts.length >= 2 ? `${keyParts[0]} ${keyParts[1]}` : pubkey.trim();
    if (existing.includes(keyFingerprint)) {
      ok('SSH key already authorized');
      return;
    }
  }

  const entry = existing.endsWith('\n') || existing === ''
    ? `${pubkey.trim()}\n`
    : `\n${pubkey.trim()}\n`;
  fs.appendFileSync(authKeysPath, entry, { mode: 0o600 });
  try { fs.chmodSync(authKeysPath, 0o600); } catch { /* best effort */ }

  ok('SSH key added to authorized_keys');
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
    ok(`Mesh code exists at ${meshDir}`);
    if (!DRY_RUN) {
      log('  Pulling latest + installing deps...');
      spawnSync('git', ['pull', '--ff-only'], { cwd: meshDir, stdio: 'pipe' });
      spawnSync('npm', ['install', '--production'], { cwd: meshDir, stdio: 'pipe' });
      ok('Updated');
    }
    return meshDir;
  }

  if (DRY_RUN) {
    warn(`[DRY RUN] Would clone ${repoUrl} to ${meshDir}`);
    return meshDir;
  }

  log(`Cloning mesh code from ${repoUrl}...`);
  try {
    execSync(`git clone "${repoUrl}" "${meshDir}"`, { stdio: 'inherit', timeout: 60000 });
    spawnSync('npm', ['install', '--production'], { cwd: meshDir, stdio: 'pipe' });
    ok('Mesh code installed');
  } catch (e) {
    fail(`Failed to clone mesh code: ${e.message}`);
    process.exit(1);
  }

  return meshDir;
}

// ── Service Installation ─────────────────────────────

function installService(osInfo, meshDir, config) {
  const nodeId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const nodeBin = process.execPath;
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

  // Deploy listener plist
  const deployPlistPath = path.join(plistDir, 'ai.openclaw.deploy-listener.plist');
  const deployPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openclaw.deploy-listener</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${meshDir}/bin/mesh-deploy-listener.js</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/.openclaw/workspace/.tmp/mesh-deploy-listener.log</string>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/.openclaw/workspace/.tmp/mesh-deploy-listener.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCLAW_NATS</key>
    <string>${natsUrl}</string>
    <key>OPENCLAW_NODE_ID</key>
    <string>${nodeId}</string>
    <key>OPENCLAW_NODE_ROLE</key>
    <string>worker</string>
    <key>OPENCLAW_REPO_DIR</key>
    <string>${meshDir}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${os.homedir()}/.npm-global/bin</string>
    <key>NODE_PATH</key>
    <string>${meshDir}/node_modules:${meshDir}/lib</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>`;

  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(plistPath, plist);
  ok(`Mesh agent service written: ${plistPath}`);
  fs.writeFileSync(deployPlistPath, deployPlist);
  ok(`Deploy listener service written: ${deployPlistPath}`);

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    ok('Mesh agent loaded and started');
    execSync(`launchctl unload "${deployPlistPath}" 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`launchctl load "${deployPlistPath}"`, { stdio: 'pipe' });
    ok('Deploy listener loaded and started');
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
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:${os.homedir()}/.local/bin:${os.homedir()}/.npm-global/bin
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

  // Deploy listener service
  const deployServicePath = path.join(serviceDir, 'openclaw-deploy-listener.service');
  const deployService = `[Unit]
Description=OpenClaw Deploy Listener
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodeBin} ${meshDir}/bin/mesh-deploy-listener.js
Restart=always
RestartSec=30
Environment=OPENCLAW_NATS=${natsUrl}
Environment=OPENCLAW_NODE_ID=${nodeId}
Environment=OPENCLAW_NODE_ROLE=worker
Environment=OPENCLAW_REPO_DIR=${meshDir}
Environment=NODE_PATH=${meshDir}/node_modules:${meshDir}/lib
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:${os.homedir()}/.local/bin:${os.homedir()}/.npm-global/bin
WorkingDirectory=${meshDir}

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(deployServicePath, deployService);
  ok(`Deploy listener service written: ${deployServicePath}`);

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable openclaw-mesh-agent', { stdio: 'pipe' });
    execSync('systemctl --user start openclaw-mesh-agent', { stdio: 'pipe' });
    ok('Mesh agent enabled and started');
    execSync('systemctl --user enable openclaw-deploy-listener', { stdio: 'pipe' });
    execSync('systemctl --user start openclaw-deploy-listener', { stdio: 'pipe' });
    ok('Deploy listener enabled and started');
  } catch (e) {
    warn(`Service start warning: ${e.message}`);
    warn('Try manually: systemctl --user start openclaw-mesh-agent');
  }

  const username = os.userInfo().username;
  try {
    execSync(`loginctl enable-linger ${username}`, { stdio: 'pipe', timeout: 5000 });
    ok(`Linger enabled for ${username} (service survives logout)`);
  } catch {
    try {
      execSync(`sudo loginctl enable-linger ${username}`, { stdio: 'pipe', timeout: 5000 });
      ok(`Linger enabled for ${username} via sudo`);
    } catch {
      warn(`Could not enable linger. Service stops on logout.`);
      warn(`Fix: sudo loginctl enable-linger ${username}`);
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
  const start = Date.now();
  while (Date.now() - start < 8000) {
    spawnSync('sleep', ['1']);
  }

  if (osInfo.serviceType === 'launchd') {
    try {
      const out = execSync('launchctl list | grep mesh-agent', { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (out) {
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
    const nats = require('nats');
    const nc = await nats.connect({ servers: natsUrl, timeout: 10000 });

    ok(`NATS connected: ${nc.getServer()}`);

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

    try {
      const msg = await nc.request('mesh.tasks.list', sc.encode(JSON.stringify({ status: 'queued' })), { timeout: 5000 });
      const resp = JSON.parse(sc.decode(msg.data));
      if (resp.ok) ok(`Task daemon reachable — ${resp.data.length} queued task(s)`);
    } catch {
      warn('Task daemon not reachable (OK for worker-only nodes)');
    }

    await nc.drain();
    return true;
  } catch (e) {
    fail(`NATS connection failed: ${e.message}`);
    return false;
  }
}

// ── Mesh Topology Discovery ──────────────────────────

async function discoverTopology(natsUrl, localNodeId) {
  log('Discovering mesh topology...');

  if (DRY_RUN) {
    warn('[DRY RUN] Would query MESH_NODE_HEALTH and write mesh-aliases.json');
    return;
  }

  try {
    const nats = require('nats');
    const nc = await nats.connect({ servers: natsUrl, timeout: 10000 });
    const sc = nats.StringCodec();
    const js = nc.jetstream();

    const aliases = {};

    // Query MESH_NODE_HEALTH for all known nodes
    try {
      const kv = await js.views.kv('MESH_NODE_HEALTH');
      const keys = await kv.keys();
      for await (const key of keys) {
        const entry = await kv.get(key);
        if (entry && entry.value) {
          const health = JSON.parse(sc.decode(entry.value));
          const nodeId = health.nodeId || key;
          // Create short alias from node ID (strip common suffixes)
          const short = nodeId
            .replace(/-virtual-machine.*$/i, '')
            .replace(/-vmware.*$/i, '')
            .replace(/-local$/, '');
          aliases[short] = nodeId;
          if (health.role === 'lead') aliases['lead'] = nodeId;
          ok(`Peer: ${nodeId} (${health.role || 'worker'}, ${health.tailscaleIp || 'unknown'})`);
        }
      }
    } catch {
      warn('MESH_NODE_HEALTH bucket not available — skipping topology');
    }

    // Also add self
    const selfShort = localNodeId
      .replace(/-virtual-machine.*$/i, '')
      .replace(/-vmware.*$/i, '')
      .replace(/-local$/, '');
    aliases[selfShort] = localNodeId;
    aliases['self'] = localNodeId;

    await nc.drain();

    if (Object.keys(aliases).length > 1) {
      const aliasPath = path.join(os.homedir(), '.openclaw', 'mesh-aliases.json');
      fs.writeFileSync(aliasPath, JSON.stringify(aliases, null, 2) + '\n', { mode: 0o644 });
      ok(`Mesh aliases written: ${aliasPath} (${Object.keys(aliases).length} entries)`);
    } else {
      warn('No peers found in MESH_NODE_HEALTH — mesh-aliases.json will only have self');
      const aliasPath = path.join(os.homedir(), '.openclaw', 'mesh-aliases.json');
      fs.writeFileSync(aliasPath, JSON.stringify(aliases, null, 2) + '\n', { mode: 0o644 });
    }
  } catch (e) {
    warn(`Topology discovery failed: ${e.message} (non-fatal)`);
  }
}

// ── Main ──────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   OpenClaw Mesh — Join Network       ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}\n`);

  if (DRY_RUN) warn('DRY RUN MODE — no changes will be made\n');

  // ── Step 1: Detect OS ──
  step(1, 'Detecting environment...');
  const osInfo = detectOS();
  const nodeId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  ok(`OS: ${osInfo.os} (${osInfo.arch})`);
  ok(`Node ID: ${nodeId}`);
  ok(`Service type: ${osInfo.serviceType}`);

  // ── Step 2: Check & install dependencies (including Tailscale) ──
  step(2, 'Checking dependencies...');
  const { deps, missing } = checkDependencies();
  for (const d of deps) {
    if (d.status === 'ok') ok(`${d.name}: ${d.detail}`);
    else if (d.status === 'optional') warn(`${d.name}: ${d.detail}`);
    else fail(`${d.name}: ${d.status} ${d.detail}`);
  }

  if (missing.length > 0) {
    step('2b', 'Installing missing dependencies...');
    installMissing(missing, osInfo);
  }

  // ── Step 3: Discover NATS via Tailscale ──
  step(3, 'Discovering NATS server...');
  const natsUrl = await discoverNats();

  const config = {
    nats: natsUrl,
    provider: PROVIDER_OVERRIDE,
    repo: REPO,
  };

  // ── Step 4: Create directory structure ──
  step(4, 'Setting up directories...');
  setupDirectories();

  // ── Step 4b: Provision SSH key (if provided) ──
  if (SSH_PUBKEY) {
    step('4b', 'Provisioning SSH key...');
    provisionSSHKey(SSH_PUBKEY);
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

  // ── Step 8: Verify health ──
  step(8, 'Verifying health...');
  const serviceAlive = verifyServiceRunning(osInfo);
  const natsHealthy = await verifyNatsHealth(config.nats, nodeId);
  const healthy = serviceAlive && natsHealthy;

  // ── Step 9: Discover mesh topology ──
  step(9, 'Discovering mesh topology...');
  await discoverTopology(config.nats, nodeId);

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
    console.log(`${BOLD}${YELLOW}  Provisioned with warnings.${RESET}`);
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
  console.log('');
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});
