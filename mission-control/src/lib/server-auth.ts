import { randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const TOKEN_PATH = path.join(os.homedir(), ".openclaw", "config", "mc-session-token");

let cachedToken: string | null = null;
let bootstrapHintLogged = false;

/** Where the operator finds the token. Never the token itself — logs may be readable. */
export const BOOTSTRAP_HINT =
  `Mission Control is locked to this machine. First visit: open ` +
  `http://127.0.0.1:3000/?token=$(cat ${TOKEN_PATH}) — the cookie is set and the token is stripped from the URL.`;

export function loadOrCreateSessionToken(): string {
  if (cachedToken) return cachedToken;
  if (!bootstrapHintLogged) {
    bootstrapHintLogged = true;
    console.log(`[mc-auth] ${BOOTSTRAP_HINT}`);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    const tmp = `${TOKEN_PATH}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, randomBytes(32).toString("hex"), { mode: 0o600 });
    fs.renameSync(tmp, TOKEN_PATH);
  }
  // Re-read instead of trusting our own write: if a sibling process raced us,
  // the last rename wins and both sides converge on the on-disk value
  // (same pattern as lib/memory-inject-server.mjs getOrCreateToken).
  cachedToken = fs.readFileSync(TOKEN_PATH, "utf8").trim();
  return cachedToken;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export type AuthDecision =
  | { action: "allow" }
  | { action: "allow-set-cookie" }
  | { action: "deny"; status: 401 | 403; reason: string };

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

/**
 * An Origin must name THIS server exactly — scheme, host and port. Any other
 * localhost port is a different application (the workplan viewer on :7892, the
 * memory inject server, the gateway UI) and a page there could otherwise drive
 * this API with the browser's cookie (review C-5).
 */
function originMatchesHost(origin: string, host: string): boolean {
  return origin === `http://${host}` || origin === `https://${host}`;
}

/**
 * The authorization decision for one request. Posture (review C-4):
 *
 *   - Every /api route, EVERY method including GET, requires the session token
 *     (cookie or Bearer). Reachability of the loopback port is not authority:
 *     another local user, an ssh -L, or a Host-rewriting proxy could read every
 *     API before.
 *   - A page load without the cookie is DENIED, not bootstrapped. The token is
 *     never handed out; the operator bootstraps ONCE with ?token=<contents of
 *     ~/.openclaw/config/mc-session-token> (0600, same machine), which sets the
 *     cookie and is stripped from the URL.
 *   - When an Origin header is present it must match the Host exactly.
 */
export function decide(
  input: {
    method: string;
    pathname: string;
    host: string | null;
    origin: string | null;
    cookieToken: string | null;
    bearerToken: string | null;
    queryToken?: string | null;
  },
  sessionToken: string,
): AuthDecision {
  if (!input.host || !LOOPBACK_HOST.test(input.host)) {
    return { action: "deny", status: 403, reason: "host" };
  }

  if (input.origin !== null && input.origin !== undefined && !originMatchesHost(input.origin, input.host)) {
    return { action: "deny", status: 403, reason: "origin" };
  }

  const cookieOk = input.cookieToken != null && timingSafeEqualStr(input.cookieToken, sessionToken);
  const bearerOk = input.bearerToken != null && timingSafeEqualStr(input.bearerToken, sessionToken);

  if (input.pathname.startsWith("/api")) {
    return cookieOk || bearerOk ? { action: "allow" } : { action: "deny", status: 401, reason: "token" };
  }

  if (cookieOk) return { action: "allow" };

  const queryOk = input.queryToken != null && timingSafeEqualStr(input.queryToken, sessionToken);
  if (queryOk) return { action: "allow-set-cookie" };

  return { action: "deny", status: 401, reason: "token" };
}
