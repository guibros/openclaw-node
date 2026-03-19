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

const { NATS_URL } = require('../lib/nats-resolve');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const ROLE = getArg('--role', 'worker');
const PROVIDER = getArg('--provider', 'claude');
const EXPIRES = getArg('--expires', '48h');
const REPO = getArg('--repo', 'https://github.com/moltyguibros-design/openclaw-node.git');
const ONE_LINER = args.includes('--one-liner');

// ── Token secret ──────────────────────────────────────
// Stored at ~/.openclaw/.mesh-secret. Created on first use.

const SECRET_PATH = path.join(os.homedir(), '.openclaw', '.mesh-secret');

function getOrCreateSecret() {
  try {
    if (fs.existsSync(SECRET_PATH)) {
      return fs.readFileSync(SECRET_PATH, 'utf8').trim();
    }
  } catch { /* fall through */ }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
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

function generateToken() {
  const secret = getOrCreateSecret();
  const expiresAt = parseExpiry(EXPIRES);

  const payload = {
    v: 2,                           // token version (v2: added repo field)
    nats: NATS_URL,                 // NATS server URL
    role: ROLE,                     // node role
    provider: PROVIDER,             // default LLM provider
    repo: REPO,                     // mesh code repo URL
    lead: os.hostname(),            // lead node hostname (for reference)
    issued: Date.now(),             // issued timestamp
    expires: expiresAt,             // expiry timestamp
  };

  // HMAC-SHA256 signature for integrity
  const payloadStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

  // Encode as base64url (no padding, url-safe)
  const token = Buffer.from(JSON.stringify({ p: payload, s: hmac }))
    .toString('base64url');

  return { token, payload, hmac };
}

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
  console.log(`Lead:     ${payload.lead}`);
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
