#!/usr/bin/env node

/**
 * openclaw-node-init.js — Zero-config mesh node provisioner.
 *
 * Tailscale is the network layer; the join token (MESH_JOIN_TOKEN) is the
 * bootstrap channel. Phase 7: the token carries the lead's identity pubkey
 * (PUBLIC, raw base64) and the bus auth mode, so the worker leaves this
 * script trusting lead-signed deploys/operator actions and knowing how to
 * authenticate to NATS. No secrets travel in the token.
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
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('openclaw-node-init');

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
// Lead identity pubkey when there is no join token (raw base64 ed25519).
const LEAD_PUBKEY_OVERRIDE = getArg('--lead-pubkey', null);

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

// ── Join token ───────────────────────────────────────

/**
 * Decode MESH_JOIN_TOKEN (or --lead-pubkey) into the bootstrap facts this
 * node needs. The HMAC on the token is the LEAD's integrity check — a fresh
 * worker holds no copy of the secret, so it cannot verify it. What protects
 * the worker is the channel the operator pasted the token through: the key it
 * carries becomes the worker's deploy/operator trust root from here on, so we
 * print it and ask the operator to compare it with `openclaw-trust-peer
 * --my-pubkey` on the lead.
 *
 * @returns {{ nats?: string, leadNodeId?: string, leadPubkey?: string, natsAuth?: string, provider?: string }}
 */
function parseJoinToken() {
  const raw = process.env.MESH_JOIN_TOKEN;
  if (!raw) {
    if (LEAD_PUBKEY_OVERRIDE) {
      ok('No join token — using --lead-pubkey for the trust root');
      return { leadPubkey: LEAD_PUBKEY_OVERRIDE };
    }
    warn('No MESH_JOIN_TOKEN and no --lead-pubkey: lead-signed deploys will NOT be trusted until');
    warn('the operator adds the lead key (OPENCLAW_DEPLOY_TRUSTED_KEYS / openclaw-trust-peer)');
    return {};
  }
  const { decodeJoinToken, isJoinTokenExpired } = require('../lib/join-token');
  const { payload } = decodeJoinToken(raw);
  if (isJoinTokenExpired(payload)) {
    fail(`Join token expired at ${new Date(payload.expires).toISOString()} — ask the lead for a fresh one (node bin/mesh-join-token.js)`);
    process.exit(1);
  }
  const out = {
    nats: typeof payload.nats === 'string' ? payload.nats : undefined,
    provider: typeof payload.provider === 'string' ? payload.provider : undefined,
    leadNodeId: typeof payload.lead_node_id === 'string' ? payload.lead_node_id : undefined,
    leadPubkey: LEAD_PUBKEY_OVERRIDE || (typeof payload.lead_identity_pubkey === 'string' ? payload.lead_identity_pubkey : undefined),
    natsAuth: typeof payload.nats_auth === 'string' ? payload.nats_auth : undefined,
  };
  ok(`Join token v${payload.v || 1} from ${payload.lead || 'lead'}${out.leadNodeId ? ` (${out.leadNodeId})` : ''}`);
  if (out.leadPubkey) {
    ok(`Lead identity pubkey: ${out.leadPubkey}`);
    warn('Compare it with `openclaw-trust-peer --my-pubkey` on the lead before trusting this node with deploys.');
  } else {
    warn('Token predates v4: no lead identity pubkey — add it with --lead-pubkey or openclaw-trust-peer');
  }
  if (out.natsAuth) ok(`Bus auth mode: ${out.natsAuth}`);
  return out;
}

/**
 * Read ~/.openclaw/openclaw.env as an ordered list of lines and set/merge keys
 * in place. `merges` maps a key to the values to add to its comma-separated
 * allowlist: each is appended only when absent (operator-added entries stay).
 */
function updateEnvFile(sets, merges = {}) {
  const envPath = path.join(os.homedir(), '.openclaw', 'openclaw.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '# OpenClaw Mesh Configuration\n# Generated by openclaw-node-init.js\n';
  const final = {};
  const setKey = (key, value) => {
    final[key] = value;
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    content = re.test(content) ? content.replace(re, `${key}=${value}`) : `${content.replace(/\n?$/, '\n')}${key}=${value}\n`;
  };
  for (const [key, value] of Object.entries(sets)) setKey(key, value);
  for (const [key, values] of Object.entries(merges)) {
    const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    const current = (m ? m[1].trim().replace(/^["']|["']$/g, '') : '').split(',').map(x => x.trim()).filter(Boolean);
    for (const value of [].concat(values)) if (!current.includes(value)) current.push(value);
    setKey(key, current.join(','));
  }
  if (DRY_RUN) {
    warn(`[DRY RUN] Would update ${envPath}: ${[...Object.keys(sets), ...Object.keys(merges)].join(', ')}`);
    return final;
  }
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  return final;
}

/**
 * Turn the join facts into durable local state: this node's own identity
 * (created here so the nkey exists before the first connect), the lead key in
 * both trust allowlists and in the identity registry, and the bus auth mode.
 * Also exports the values so serviceTemplateVars renders the units with them.
 */
function provisionTrust(join, nodeId) {
  const { getOrCreateIdentity, createIdentityRegistry } = require('../lib/node-identity.mjs');
  const identityDir = process.env.OPENCLAW_IDENTITY_DIR || path.join(os.homedir(), '.openclaw');
  let self = null;
  if (DRY_RUN && !fs.existsSync(path.join(identityDir, 'identity.key'))) {
    warn(`[DRY RUN] Would create the node identity at ${identityDir}`);
  } else {
    self = getOrCreateIdentity(identityDir);
    ok(`Node identity: ${self.publicKeyBase64}`);
  }

  const sets = {};
  if (join.natsAuth) {
    sets.OPENCLAW_NATS_AUTH = join.natsAuth;
    process.env.OPENCLAW_NATS_AUTH = join.natsAuth;
  }
  const trusted = [self && self.publicKeyBase64, join.leadPubkey].filter(Boolean);
  const final = updateEnvFile(sets, { OPENCLAW_DEPLOY_TRUSTED_KEYS: trusted, OPENCLAW_OPERATOR_TRUSTED_KEYS: trusted });
  // The service units render from process.env (serviceTemplateVars): expose
  // the merged allowlists — file entries the operator added included.
  for (const name of ['OPENCLAW_DEPLOY_TRUSTED_KEYS', 'OPENCLAW_OPERATOR_TRUSTED_KEYS']) {
    const fromEnv = (process.env[name] || '').split(',').map(x => x.trim()).filter(Boolean);
    const merged = (final[name] || '').split(',').filter(Boolean);
    for (const key of fromEnv) if (!merged.includes(key)) merged.push(key);
    process.env[name] = merged.join(',');
  }

  if (join.leadPubkey && join.leadNodeId) {
    if (DRY_RUN) {
      warn(`[DRY RUN] Would register ${join.leadNodeId} in the identity registry`);
    } else {
      const registry = createIdentityRegistry({ path: path.join(identityDir, 'identity-registry.json'), mode: 'strict' });
      const added = registry.trust(join.leadNodeId, join.leadPubkey, 'join-token');
      if (added) ok(`Identity registry: trusted lead ${join.leadNodeId}`);
      else if (registry.get(join.leadNodeId)?.pubkey === join.leadPubkey) ok(`Identity registry: lead ${join.leadNodeId} already trusted`);
      else warn(`Identity registry already holds a DIFFERENT key for ${join.leadNodeId} — not overwriting (openclaw-trust-peer --remove first)`);
    }
  }
  if (join.leadPubkey) ok('Lead key merged into OPENCLAW_DEPLOY_TRUSTED_KEYS and OPENCLAW_OPERATOR_TRUSTED_KEYS');

  if (self) {
    console.log('');
    log('Run this on the LEAD so it trusts this node (required before any connect in nkey mode):');
    console.log(`    node bin/openclaw-trust-peer.mjs ${nodeId} ${self.publicKeyBase64} --role worker --sync-nats`);
    console.log('');
  }
  return self;
}

// ── Tailscale NATS Discovery ─────────────────────────

async function discoverNats(tokenNats) {
  if (NATS_OVERRIDE) {
    ok(`Using explicit NATS URL: ${NATS_OVERRIDE}`);
    return NATS_OVERRIDE;
  }
  if (tokenNats) {
    ok(`Using NATS URL from the join token: ${tokenNats}`);
    return tokenNats;
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
  const nodeId = require('../lib/node-id').resolveNodeId();
  const vars = serviceTemplateVars({ meshDir, nodeId, config });
  if (osInfo.serviceType === 'launchd') {
    return installLaunchdService(meshDir, vars);
  }
  return installSystemdService(meshDir, vars);
}

// Review P4-8: node-init used to carry its OWN inline plist/unit text for the
// agent and a second deploy listener (`ai.openclaw.deploy-listener`), so a
// worker provisioned this way ran a different service definition from every
// other node — without the env-file NATS URL, the node id, the trusted-key
// list, or the strict signed-deploy default. It now renders the same
// services/{launchd,systemd} templates install.sh renders, with the same
// ${VAR} substitution, and retires the legacy second listener.
const SERVICE_TEMPLATE_VARS = [
  'HOME', 'NODE_BIN', 'NPM_BIN', 'NATS_SERVER_BIN', 'OPENCLAW_WORKSPACE', 'OPENCLAW_REPO_DIR',
  'OPENCLAW_NATS', 'OPENCLAW_NATS_TOKEN', 'OPENCLAW_NODE_ID', 'OPENCLAW_NODE_ROLE',
  'OPENCLAW_DEPLOY_TRUSTED_KEYS', 'MESH_LLM_PROVIDER', 'LLM_MODEL', 'LLM_BASE_URL',
];

function serviceTemplateVars({ meshDir, nodeId, config }) {
  const home = os.homedir();
  const env = process.env;
  return {
    HOME: home,
    NODE_BIN: process.execPath,
    NPM_BIN: env.NPM_BIN || path.join(path.dirname(process.execPath), 'npm'),
    NATS_SERVER_BIN: env.NATS_SERVER_BIN || '/usr/local/bin/nats-server',
    OPENCLAW_WORKSPACE: env.OPENCLAW_WORKSPACE || path.join(home, '.openclaw', 'workspace'),
    OPENCLAW_REPO_DIR: meshDir,
    OPENCLAW_NATS: config.nats,
    OPENCLAW_NATS_TOKEN: env.OPENCLAW_NATS_TOKEN || '',
    OPENCLAW_NODE_ID: nodeId,
    OPENCLAW_NODE_ROLE: env.OPENCLAW_NODE_ROLE || 'worker',
    OPENCLAW_DEPLOY_TRUSTED_KEYS: env.OPENCLAW_DEPLOY_TRUSTED_KEYS || '',
    MESH_LLM_PROVIDER: config.provider || env.MESH_LLM_PROVIDER || 'claude',
    LLM_MODEL: env.LLM_MODEL || '',
    LLM_BASE_URL: env.LLM_BASE_URL || '',
  };
}

/**
 * Substitute ${VAR} placeholders. Every known variable is replaced (an
 * empty value is a legitimate render); any OTHER placeholder left in the
 * output is a template/renderer drift and fails loudly — the install.sh
 * path has the same check_rendered guard.
 */
function renderServiceTemplate(templateText, vars) {
  let out = templateText;
  for (const name of SERVICE_TEMPLATE_VARS) {
    out = out.split('${' + name + '}').join(vars[name] ?? '');
  }
  const leftover = out.match(/\$\{[A-Z_][A-Z0-9_]*\}/g);
  if (leftover) throw new Error(`unrendered template variable(s): ${[...new Set(leftover)].join(', ')}`);
  return out;
}

function renderServiceFile(meshDir, relTemplate, vars) {
  const templatePath = path.join(meshDir, 'services', relTemplate);
  const text = fs.readFileSync(templatePath, 'utf8');
  return renderServiceTemplate(text, vars);
}

const LAUNCHD_SERVICES = ['ai.openclaw.mesh-agent.plist', 'ai.openclaw.mesh-deploy-listener.plist'];
const SYSTEMD_SERVICES = ['openclaw-mesh-agent.service', 'openclaw-mesh-deploy-listener.service'];

function installLaunchdService(meshDir, vars) {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const rendered = LAUNCHD_SERVICES.map((name) => ({
    dest: path.join(plistDir, name),
    text: renderServiceFile(meshDir, path.join('launchd', name), vars),
  }));
  // Legacy second listener written by older node-init runs.
  const legacy = path.join(plistDir, 'ai.openclaw.deploy-listener.plist');

  if (DRY_RUN) {
    for (const r of rendered) warn(`[DRY RUN] Would render ${path.basename(r.dest)} -> ${r.dest}`);
    if (fs.existsSync(legacy)) warn(`[DRY RUN] Would retire legacy ${legacy}`);
    return;
  }

  fs.mkdirSync(plistDir, { recursive: true });
  if (fs.existsSync(legacy)) {
    try { execSync(`launchctl unload "${legacy}" 2>/dev/null || true`, { stdio: 'pipe' }); } catch { /* not loaded */ }
    fs.unlinkSync(legacy);
    ok(`Retired legacy deploy listener: ${legacy}`);
  }
  for (const r of rendered) {
    fs.writeFileSync(r.dest, r.text);
    ok(`Service rendered: ${r.dest}`);
  }
  try {
    for (const r of rendered) {
      execSync(`launchctl unload "${r.dest}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`launchctl load "${r.dest}"`, { stdio: 'pipe' });
      ok(`Loaded ${path.basename(r.dest)}`);
    }
  } catch (e) {
    warn(`Service load warning: ${e.message}`);
  }
}

function installSystemdService(meshDir, vars) {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const rendered = SYSTEMD_SERVICES.map((name) => ({
    dest: path.join(serviceDir, name),
    unit: name.replace(/\.service$/, ''),
    text: renderServiceFile(meshDir, path.join('systemd', name), vars),
  }));
  const legacy = path.join(serviceDir, 'openclaw-deploy-listener.service');

  if (DRY_RUN) {
    for (const r of rendered) warn(`[DRY RUN] Would render ${path.basename(r.dest)} -> ${r.dest}`);
    if (fs.existsSync(legacy)) warn(`[DRY RUN] Would retire legacy ${legacy}`);
    return;
  }

  fs.mkdirSync(serviceDir, { recursive: true });
  if (fs.existsSync(legacy)) {
    try { execSync('systemctl --user disable --now openclaw-deploy-listener', { stdio: 'pipe' }); } catch { /* not enabled */ }
    fs.unlinkSync(legacy);
    ok(`Retired legacy deploy listener: ${legacy}`);
  }
  for (const r of rendered) {
    fs.writeFileSync(r.dest, r.text);
    ok(`Service rendered: ${r.dest}`);
  }

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    for (const r of rendered) {
      execSync(`systemctl --user enable ${r.unit}`, { stdio: 'pipe' });
      execSync(`systemctl --user restart ${r.unit}`, { stdio: 'pipe' });
      ok(`${r.unit} enabled and started`);
    }
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
    if (/authorization|permissions/i.test(String(e.message))) {
      warn('The bus refused this node\'s credentials. In nkey mode the LEAD must trust this node first:');
      warn('  openclaw-trust-peer <node-id> <pubkey> --role worker --sync-nats   (printed above)');
    }
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

// ── Tracer Instrumentation ───────────────────────────
discoverNats = tracer.wrapAsync('discoverNats', discoverNats, { tier: 2, category: 'lifecycle' });
setupDirectories = tracer.wrap('setupDirectories', setupDirectories, { tier: 2, category: 'lifecycle' });
installMeshCode = tracer.wrap('installMeshCode', installMeshCode, { tier: 2, category: 'lifecycle' });
installService = tracer.wrap('installService', installService, { tier: 2, category: 'lifecycle' });
verifyServiceRunning = tracer.wrap('verifyServiceRunning', verifyServiceRunning, { tier: 2, category: 'lifecycle' });
verifyNatsHealth = tracer.wrapAsync('verifyNatsHealth', verifyNatsHealth, { tier: 2, category: 'lifecycle' });
installMissing = tracer.wrap('installMissing', installMissing, { tier: 2, category: 'lifecycle' });
provisionSSHKey = tracer.wrap('provisionSSHKey', provisionSSHKey, { tier: 2, category: 'lifecycle' });
configureNats = tracer.wrap('configureNats', configureNats, { tier: 2, category: 'lifecycle' });

// ── Main ──────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   OpenClaw Mesh — Join Network       ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}\n`);

  if (DRY_RUN) warn('DRY RUN MODE — no changes will be made\n');

  // ── Step 1: Detect OS ──
  step(1, 'Detecting environment...');
  const osInfo = detectOS();
  const nodeId = require('../lib/node-id').resolveNodeId();
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

  // ── Step 3: Join token, then NATS discovery ──
  step(3, 'Reading join token...');
  const join = parseJoinToken();
  log('Discovering NATS server...');
  const natsUrl = await discoverNats(join.nats);

  const config = {
    nats: natsUrl,
    provider: args.includes('--provider') ? PROVIDER_OVERRIDE : (join.provider || PROVIDER_OVERRIDE),
    repo: REPO,
  };

  // ── Step 4: Create directory structure ──
  step(4, 'Setting up directories...');
  setupDirectories();

  // ── Step 4a: Identity + trust root (lead key, registry, bus auth mode) ──
  step('4a', 'Provisioning identity and trust...');
  provisionTrust(join, nodeId);

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

if (require.main === module) main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});

module.exports = { renderServiceTemplate, serviceTemplateVars, SERVICE_TEMPLATE_VARS, parseJoinToken, updateEnvFile, provisionTrust };
