/**
 * nats-resolve.js — Shared NATS URL + auth resolver for the OpenClaw mesh.
 *
 * Every CJS script in ~/openclaw/bin/ that connects to NATS should
 * require() this module instead of hardcoding URLs.
 *
 * Resolution order (4-step chain, same for URL and token):
 *   1. $OPENCLAW_NATS / $OPENCLAW_NATS_TOKEN env vars
 *   2. ~/.openclaw/openclaw.env file (OPENCLAW_NATS=, OPENCLAW_NATS_TOKEN=)
 *   3. ~/openclaw/.mesh-config file (same keys)
 *   4. Localhost fallback / no auth
 *
 * Usage:
 *   const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
 *   const nc = await connect(natsConnectOpts());
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Fallback IP — last resort if env var, env file, and mesh-config are all missing.
// localhost fallback — each node should have NATS URL configured via env or config file
const NATS_FALLBACK = 'nats://127.0.0.1:4222';

/**
 * Resolve the NATS server URL using a 4-step chain.
 * Called once at module load time — the result is cached as NATS_URL.
 */
function resolveNatsUrl() {
  // 1. Environment variable (highest priority — set by service definitions)
  if (process.env.OPENCLAW_NATS) return process.env.OPENCLAW_NATS;

  // 2. Read from ~/.openclaw/openclaw.env (user-editable config file)
  try {
    const envFile = path.join(os.homedir(), '.openclaw', 'openclaw.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // File unreadable — fall through silently
  }

  // 3. Read from ~/openclaw/.mesh-config (set by mesh installer or deploy scripts)
  try {
    const meshConfig = path.join(os.homedir(), 'openclaw', '.mesh-config');
    if (fs.existsSync(meshConfig)) {
      const content = fs.readFileSync(meshConfig, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // File unreadable — fall through silently
  }

  // 4. Localhost fallback
  return NATS_FALLBACK;
}

/**
 * Resolve the NATS auth token using the same 4-step chain.
 * Returns null if no token is configured (auth disabled — backward compatible).
 */
function resolveNatsToken() {
  // 1. Environment variable
  if (process.env.OPENCLAW_NATS_TOKEN) return process.env.OPENCLAW_NATS_TOKEN;

  // 2. ~/.openclaw/openclaw.env
  try {
    const envFile = path.join(os.homedir(), '.openclaw', 'openclaw.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NATS_TOKEN\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}

  // 3. ~/openclaw/.mesh-config
  try {
    const meshConfig = path.join(os.homedir(), 'openclaw', '.mesh-config');
    if (fs.existsSync(meshConfig)) {
      const content = fs.readFileSync(meshConfig, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NATS_TOKEN\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}

  return null;
}

// Resolve once at require() time — all consumers get the same value
const NATS_URL = resolveNatsUrl();
const NATS_TOKEN = resolveNatsToken();

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

module.exports = { NATS_URL, NATS_TOKEN, resolveNatsUrl, resolveNatsToken, natsConnectOpts };
