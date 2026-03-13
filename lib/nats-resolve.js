/**
 * nats-resolve.js — Shared NATS URL resolver for the OpenClaw mesh.
 *
 * Every CJS script in ~/openclaw/bin/ that connects to NATS should
 * require() this module instead of hardcoding URLs.
 *
 * Resolution order:
 *   1. $OPENCLAW_NATS env var (set by launchd/systemd service definitions)
 *   2. ~/.openclaw/openclaw.env file (user-editable, persists across sessions)
 *   3. Hardcoded IP fallback (not hostname — MagicDNS is unreliable)
 *
 * Usage:
 *   const { NATS_URL } = require('../lib/nats-resolve');
 *   const nc = await connect({ servers: NATS_URL, timeout: 5000 });
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Fallback IP — last resort if env var and env file are both missing.
// This is the Ubuntu worker's Tailscale IP where NATS server runs.
const NATS_FALLBACK = 'nats://100.91.131.61:4222';

/**
 * Resolve the NATS server URL using a 3-step chain.
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

  // 3. Hardcoded IP fallback (not MagicDNS hostname — DNS resolution is flaky)
  return NATS_FALLBACK;
}

// Resolve once at require() time — all consumers get the same value
const NATS_URL = resolveNatsUrl();

module.exports = { NATS_URL, resolveNatsUrl };
