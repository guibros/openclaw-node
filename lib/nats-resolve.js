/**
 * nats-resolve.js — Shared NATS URL + auth resolver for the OpenClaw mesh.
 *
 * Every CJS script in ~/openclaw/bin/ that connects to NATS should
 * require() this module instead of hardcoding URLs.
 *
 * Resolution order (4-step chain, same for URL, token and auth mode):
 *   1. $OPENCLAW_NATS / $OPENCLAW_NATS_TOKEN / $OPENCLAW_NATS_AUTH env vars
 *   2. ~/.openclaw/openclaw.env file (same keys)
 *   3. ~/openclaw/.mesh-config file (same keys)
 *   4. Localhost fallback / no auth / token mode
 *
 * Usage:
 *   const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
 *   const nc = await connect(natsConnectOpts());
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTracer } = require('./tracer');
const tracer = createTracer('nats-resolve');

// Fallback IP — last resort if env var, env file, and mesh-config are all missing.
// localhost fallback — each node should have NATS URL configured via env or config file
const NATS_FALLBACK = 'nats://127.0.0.1:4222';

/**
 * Read one KEY=value from an env-style file. Returns null when the file or the
 * key is missing or unreadable — every caller treats that as "fall through".
 */
function readEnvFileKey(file, key) {
  try {
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, 'm'));
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    // File unreadable — fall through silently
  }
  return null;
}

/**
 * Resolve one configuration key through the shared 3-step chain:
 *   1. process.env[key]
 *   2. ~/.openclaw/openclaw.env
 *   3. ~/openclaw/.mesh-config
 * Returns null when nothing set it (the caller applies its own default).
 */
function resolveEnvKey(key) {
  if (process.env[key]) return process.env[key];
  return readEnvFileKey(path.join(os.homedir(), '.openclaw', 'openclaw.env'), key)
    ?? readEnvFileKey(path.join(os.homedir(), 'openclaw', '.mesh-config'), key);
}

/** NATS server URL — chain, then the localhost fallback. */
function resolveNatsUrl() {
  return resolveEnvKey('OPENCLAW_NATS') || NATS_FALLBACK;
}

/** Shared bus token — null means no token configured (legacy open bus). */
function resolveNatsToken() {
  return resolveEnvKey('OPENCLAW_NATS_TOKEN');
}

const NATS_AUTH_MODES = ['token', 'nkey', 'nkey-strict'];

/**
 * How clients authenticate to the bus (Phase 7):
 *   token        — the shared OPENCLAW_NATS_TOKEN (default; pre-Phase-7 behaviour)
 *   nkey         — this node's identity key as an NATS nkey; falls back to the
 *                  legacy user/password entry when no identity exists
 *   nkey-strict  — nkey or refuse to connect
 * An unknown value is treated as `token` so a typo can never lock a node out.
 */
function resolveNatsAuthMode() {
  const mode = (resolveEnvKey('OPENCLAW_NATS_AUTH') || 'token').trim().toLowerCase();
  return NATS_AUTH_MODES.includes(mode) ? mode : 'token';
}

// Resolve once at require() time — all consumers get the same value
const NATS_URL = resolveNatsUrl();
const NATS_TOKEN = resolveNatsToken();
const NATS_AUTH_MODE = resolveNatsAuthMode();

/**
 * Build NATS connect() options with auth if configured.
 * Drop-in replacement for { servers: NATS_URL, timeout: 5000 }.
 * Extra opts are merged in (name, timeout, reconnect, etc.).
 */
function natsConnectOpts(extra = {}) {
  const opts = { servers: NATS_URL, ...extra };
  if (NATS_TOKEN) opts.token = NATS_TOKEN;
  return opts;
}

module.exports = {
  NATS_URL,
  NATS_TOKEN,
  NATS_AUTH_MODE,
  NATS_AUTH_MODES,
  resolveEnvKey,
  resolveNatsAuthMode,
  resolveNatsUrl: tracer.wrap('resolveNatsUrl', resolveNatsUrl, { tier: 3, category: 'io' }),
  resolveNatsToken: tracer.wrap('resolveNatsToken', resolveNatsToken, { tier: 3, category: 'io' }),
  natsConnectOpts: tracer.wrap('natsConnectOpts', natsConnectOpts, { tier: 3, category: 'io' }),
};
