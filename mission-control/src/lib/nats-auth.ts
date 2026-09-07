/**
 * nats-auth.ts — how Mission Control authenticates to the mesh bus (Phase 7).
 *
 * Mirrors lib/nats-resolve.js + lib/nats-nkey.js from the node repo, in
 * TypeScript, because MC's build and vitest run without ../lib present (the
 * runtime-path probing in mesh-sign.ts exists precisely because that is
 * fragile) and everything needed — `nkeyAuthenticator`, `nkeys` — ships in
 * the `nats` package MC already imports.
 *
 * Modes (OPENCLAW_NATS_AUTH, env → openclaw.env chain):
 *   token        — the shared OPENCLAW_NATS_TOKEN (default; pre-Phase-7 behaviour)
 *   nkey         — the host node's identity key (~/.openclaw/identity.key) as an
 *                  NATS nkey; legacy user/password fallback without an identity
 *   nkey-strict  — nkey or refuse
 *
 * Identity → nkey: raw seed = last 32 bytes of the PKCS8 DER, encoded as a
 * user seed ("SU…") through the nkeys codec. Never logged.
 */

import { createPrivateKey } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { nkeyAuthenticator, type Authenticator } from "nats";
// The nkeys codec is not re-exported by `nats`; nkeys.js is its dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Codec } = require("nkeys.js/lib/codec.js") as { Codec: { encodeSeed(role: number, src: Uint8Array): Uint8Array } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nkeys = require("nkeys.js") as { Prefix: { User: number }; fromSeed(seed: Uint8Array): { getPublicKey(): string } };

export type NatsAuthMode = "token" | "nkey" | "nkey-strict";
const MODES: NatsAuthMode[] = ["token", "nkey", "nkey-strict"];

export function openclawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
}

/** env → ~/.openclaw/openclaw.env (same regex as the node resolver). */
export function resolveEnvKey(key: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[key]) return env[key] as string;
  try {
    const envFile = join(openclawHome(), "openclaw.env");
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf8");
      const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, "m"));
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // File unreadable — fall through
  }
  return null;
}

export function resolveNatsAuthMode(): NatsAuthMode {
  const mode = (resolveEnvKey("OPENCLAW_NATS_AUTH") || "token").trim().toLowerCase() as NatsAuthMode;
  return MODES.includes(mode) ? mode : "token";
}

/** Derive the "SU…" seed and "U…" public nkey from an ed25519 PKCS8 PEM. */
export function nkeyFromPem(pem: string): { seed: string; publicNkey: string } {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`identity key must be ed25519, got ${key.asymmetricKeyType}`);
  const seed32 = key.export({ type: "pkcs8", format: "der" }).subarray(-32);
  const seed = Buffer.from(Codec.encodeSeed(nkeys.Prefix.User, seed32)).toString("utf8");
  const publicNkey = nkeys.fromSeed(new TextEncoder().encode(seed)).getPublicKey();
  return { seed, publicNkey };
}

/** An authenticator for the host identity, or null when identity.key is absent. */
export function identityAuthenticator(identityDir: string = process.env.OPENCLAW_IDENTITY_DIR || openclawHome()): Authenticator | null {
  const keyPath = join(identityDir, "identity.key");
  if (!existsSync(keyPath)) return null;
  const { seed } = nkeyFromPem(readFileSync(keyPath, "utf8"));
  return nkeyAuthenticator(new TextEncoder().encode(seed));
}

export interface NatsAuthOptions {
  token?: string;
  user?: string;
  pass?: string;
  authenticator?: Authenticator;
}

/**
 * The auth part of connect() options for the resolved mode.
 * `token` is the already-resolved OPENCLAW_NATS_TOKEN (null when unset).
 */
export function natsAuthOptions(token: string | null, mode: NatsAuthMode = resolveNatsAuthMode()): NatsAuthOptions {
  if (mode === "token") return token ? { token } : {};
  const authenticator = identityAuthenticator();
  if (authenticator) return { authenticator };
  if (mode === "nkey-strict") {
    throw new Error("OPENCLAW_NATS_AUTH=nkey-strict but no node identity (identity.key) under OPENCLAW_HOME");
  }
  const user = resolveEnvKey("OPENCLAW_NATS_LEGACY_USER") || "openclaw";
  return token ? { user, pass: token } : {};
}
