#!/usr/bin/env node

/**
 * mesh-join-token.js — Generate a join token for new mesh nodes.
 *
 * Run this on the lead node. It produces a base64-encoded token containing
 * everything a new node needs to join the mesh:
 *   - NATS URL
 *   - Mesh node role (worker by default)
 *   - Default LLM provider
 *   - Token expiry
 *   - The lead's node id + identity pubkey (raw base64 ed25519) and the NATS
 *     auth mode of the lead's bus (v4, Phase 7) — the worker seeds its trust
 *     allowlists and identity registry from them
 *   - HMAC signature (shared-secret integrity check)
 *
 * Usage:
 *   node bin/mesh-join-token.js                        # generate with defaults
 *   node bin/mesh-join-token.js --role worker           # explicit role
 *   node bin/mesh-join-token.js --provider deepseek     # set default LLM
 *   node bin/mesh-join-token.js --expires 24h           # custom expiry (default: 48h)
 *   node bin/mesh-join-token.js --one-liner             # output curl | sh one-liner
 *
 * The token is NOT encrypted — it's signed for integrity. Don't embed secrets
 * (API keys). Those go in ~/.openclaw/openclaw.env on the target node.
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('mesh-join-token');

const { NATS_URL, resolveNatsAuthMode, resolveEnvKey } = require('../lib/nats-resolve');
const { encodeJoinToken, CURRENT_VERSION } = require('../lib/join-token');
const { resolveNodeId } = require('../lib/node-id');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const ROLE = getArg('--role', 'worker');
// Default = the lead's own provider (env chain), not a hardcoded vendor.
const PROVIDER = getArg('--provider', resolveEnvKey('MESH_LLM_PROVIDER') || 'claude');
const EXPIRES = getArg('--expires', '48h');
const REPO = getArg('--repo', 'https://github.com/moltyguibros-design/openclaw-node.git');
const ONE_LINER = args.includes('--one-liner');
const NO_SSH = args.includes('--no-ssh');

// Read lead node's SSH public key (auto-discover from ~/.ssh/)
function getLeadSSHPubkey() {
  if (NO_SSH) return null;
  const sshDir = path.join(os.homedir(), '.ssh');
  const candidates = ['id_ed25519_openclaw.pub', 'id_ed25519.pub', 'id_rsa.pub', 'id_ecdsa.pub'];
  for (const f of candidates) {
    const p = path.join(sshDir, f);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').trim();
    }
  }
  return null;
}

// ── Token secret ──────────────────────────────────────
// Stored at ~/.openclaw/.mesh-secret. Created on first use.

const SECRET_PATH = path.join(os.homedir(), '.openclaw', '.mesh-secret');

const getOrCreateSecret = tracer.wrap('getOrCreateSecret', function getOrCreateSecret() {
  try {
    if (fs.existsSync(SECRET_PATH)) {
      return fs.readFileSync(SECRET_PATH, 'utf8').trim();
    }
  } catch (err) { console.warn(`[mesh-join-token] read mesh secret: ${err.message}`); }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}, { tier: 2, category: 'lifecycle' });

// Lead identity (Phase 7): the raw base64 pubkey workers must trust for signed
// deploys and operator actions. require(esm) — node-identity is an ES module.
function getLeadIdentityPubkey() {
  const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
  return getOrCreateIdentity(process.env.OPENCLAW_IDENTITY_DIR).publicKeyBase64;
}

// ── Expiry parsing ────────────────────────────────────

function parseExpiry(str) {
  const match = str.match(/^(\d+)(h|d|m)$/);
  if (!match) throw new Error(`Invalid expiry format: "${str}". Use: 24h, 7d, 30m`);
  const val = parseInt(match[1]);
  const unit = match[2];
  const ms = unit === 'h' ? val * 3600000
           : unit === 'd' ? val * 86400000
           : val * 60000;
  return Date.now() + ms;
}

// ── Generate token ────────────────────────────────────

const generateToken = tracer.wrap('generateToken', function generateToken() {
  const secret = getOrCreateSecret();
  const expiresAt = parseExpiry(EXPIRES);

  const sshPubkey = getLeadSSHPubkey();

  const payload = {
    v: CURRENT_VERSION,             // token version (v4: lead identity + nats_auth)
    nats: NATS_URL,                 // NATS server URL
    role: ROLE,                     // node role
    provider: PROVIDER,             // default LLM provider
    repo: REPO,                     // mesh code repo URL
    lead: os.hostname(),            // lead node hostname (for reference)
    lead_node_id: resolveNodeId(),  // lead's mesh node id (registry key on the worker)
    lead_identity_pubkey: getLeadIdentityPubkey(), // raw base64 ed25519 — PUBLIC
    nats_auth: resolveNatsAuthMode(), // token | nkey | nkey-strict (what the bus expects)
    issued: Date.now(),             // issued timestamp
    expires: expiresAt,             // expiry timestamp
    ...(sshPubkey && { ssh_pubkey: sshPubkey }), // lead node's SSH public key
  };

  // HMAC-SHA256 signature for integrity, base64url encoding — lib/join-token.js
  return encodeJoinToken(payload, secret);
}, { tier: 2, category: 'lifecycle' });

// ── Main ──────────────────────────────────────────────

const { token, payload } = generateToken();

if (ONE_LINER) {
  console.log(`curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/mesh-install.sh | MESH_JOIN_TOKEN=${token} sh`);
} else {
  console.log('\n--- Mesh Join Token ---');
  console.log(`Role:     ${payload.role}`);
  console.log(`NATS:     ${payload.nats}`);
  console.log(`Provider: ${payload.provider}`);
  console.log(`Repo:     ${payload.repo}`);
  console.log(`Expires:  ${new Date(payload.expires).toISOString()}`);
  console.log(`Lead:     ${payload.lead} (${payload.lead_node_id})`);
  console.log(`Lead key: ${payload.lead_identity_pubkey}`);
  console.log(`NATS auth: ${payload.nats_auth}`);
  console.log('');
  console.log('Token:');
  console.log(token);
  console.log('');
  console.log('--- Quick Install (paste on target machine) ---');
  console.log(`MESH_JOIN_TOKEN=${token} bash <(curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/mesh-install.sh)`);
  console.log('');
  console.log('--- Or manual install ---');
  console.log(`git clone https://github.com/moltyguibros-design/openclaw-node.git && cd openclaw-node && MESH_JOIN_TOKEN=${token} node bin/openclaw-node-init.js`);
}
