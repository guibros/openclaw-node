import { randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const TOKEN_PATH = path.join(os.homedir(), ".openclaw", "config", "mc-session-token");

let cachedToken: string | null = null;

export function loadOrCreateSessionToken(): string {
  if (cachedToken) return cachedToken;
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
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

export function decide(
  input: {
    method: string;
    pathname: string;
    host: string | null;
    origin: string | null;
    cookieToken: string | null;
    bearerToken: string | null;
  },
  sessionToken: string,
): AuthDecision {
  if (!input.host || !LOOPBACK_HOST.test(input.host)) {
    return { action: "deny", status: 403, reason: "host" };
  }

  if (!input.pathname.startsWith("/api")) {
    return input.cookieToken === sessionToken
      ? { action: "allow" }
      : { action: "allow-set-cookie" };
  }

  if (input.method === "GET" || input.method === "HEAD" || input.method === "OPTIONS") {
    return { action: "allow" };
  }

  if (input.origin !== null && !LOOPBACK_ORIGIN.test(input.origin)) {
    return { action: "deny", status: 403, reason: "origin" };
  }
  if (input.cookieToken !== null && timingSafeEqualStr(input.cookieToken, sessionToken)) {
    return { action: "allow" };
  }
  if (input.bearerToken !== null && timingSafeEqualStr(input.bearerToken, sessionToken)) {
    return { action: "allow" };
  }
  return { action: "deny", status: 401, reason: "token" };
}
