/**
 * mc-session-token.mjs — read Mission Control's session token for local callers.
 *
 * Mission Control now requires its session token on EVERY /api method,
 * including GET (review C-4: any process that could open a loopback socket
 * could read every API, and a page load handed the token to anyone). The
 * daemons and watchdogs on the same host that legitimately call it — node-watch,
 * mc-health, memory-maintenance, scheduler-heartbeat — read the same 0600 file
 * MC wrote, exactly as scheduler-heartbeat already did. One helper, not four
 * copies.
 *
 * Never put the token on a command line (ps exposes argv); send it as a header.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MC_TOKEN_PATH = path.join(os.homedir(), '.openclaw', 'config', 'mc-session-token');

/** The token, or null when the file is absent/empty (MC not yet started). */
export function readMcSessionToken(opts = {}) {
  const tokenPath = opts.tokenPath || process.env.OPENCLAW_MC_TOKEN_FILE || DEFAULT_MC_TOKEN_PATH;
  try {
    const t = fs.readFileSync(tokenPath, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Headers to attach to a request to Mission Control ({} when no token is available). */
export function mcAuthHeaders(opts = {}) {
  const t = readMcSessionToken(opts);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
