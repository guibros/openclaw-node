/**
 * nats-resolve.js — Shared NATS URL resolver for the OpenClaw mesh.
 *
 * Every CJS script in ~/openclaw/bin/ that connects to NATS should
 * require() this module instead of hardcoding URLs.
 *
 * Resolution order (4-step chain):
 *   1. $OPENCLAW_NATS env var (set by launchd/systemd service definitions)
 *   2. ~/.openclaw/openclaw.env file (user-editable, persists across sessions)
 *   3. ~/openclaw/.mesh-config file (OPENCLAW_NATS= line, set by mesh installer)
 *   4. Localhost fallback (127.0.0.1:4222)
 *
 * Usage:
 *   const { NATS_URL } = require('../lib/nats-resolve');
 *   const nc = await connect({ servers: NATS_URL, timeout: 5000 });
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
      if (match && match[1].trim()) return match[1].trim();
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
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch {
    // File unreadable — fall through silently
  }

  // 4. Localhost fallback
  return NATS_FALLBACK;
}

// Resolve once at require() time — all consumers get the same value
const NATS_URL = resolveNatsUrl();

module.exports = { NATS_URL, resolveNatsUrl };
