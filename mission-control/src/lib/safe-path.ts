/**
 * safe-path.ts — the one place Mission Control decides whether a client-supplied
 * path or id may touch the filesystem.
 *
 * Review findings this closes (C-4, C-3, C-6): the file-read routes jailed a
 * path to a root but then served secrets inside that root (openclaw.json with
 * the gateway token, .env, auth-profiles.json, session transcripts, .env.local
 * with an API key) because a basename-substring denylist missed them; two
 * routes skipped realpath so a symlink inside the workspace escaped the jail;
 * one had no size cap; and four routes joined attacker-chosen task/soul ids
 * straight into paths.
 *
 * Posture: resolve through symlinks and require the REAL path to stay inside
 * the root; then refuse anything structurally secret-shaped (a dotfile in any
 * segment, a blocked directory, a credential-bearing name or extension). Ids
 * are a fixed safe alphabet, no exceptions.
 */

import fs from "fs";
import path from "path";

/** Task / soul / event ids: safe alphabet, no path separators, no leading dot. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID.test(id) && id !== "." && id !== "..";
}

/** Extensions that only ever hold credentials or raw databases. */
const SECRET_EXTENSIONS = new Set([
  ".key", ".pem", ".p12", ".pfx",
  ".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm",
  ".env",
]);

/** Exact filenames (lowercased) that are credentials wherever they sit. */
const SECRET_NAMES = new Set([
  "openclaw.env", "openclaw.json", "auth-profiles.json",
  "identity.key", "identity.pub", "identity-registry.json",
  "mc-session-token", "memory-injection-token", ".mesh-secret",
]);

export interface SensitiveOpts {
  /** Directory names refused in any segment (e.g. session transcripts, rendered NATS confs). */
  blockedDirs?: readonly string[];
  /** Also refuse basenames containing "token" or "secret" (the memory-file route's stricter posture). */
  nameHeuristics?: boolean;
}

/**
 * True when a ROOT-RELATIVE path is secret-shaped. Structural, not a
 * substring guess: any dotfile segment, any blocked directory, a known
 * credential filename, or a credential extension.
 */
export function isSensitiveRelPath(rel: string, opts: SensitiveOpts = {}): boolean {
  const segs = rel.split(/[\\/]+/).filter(Boolean);
  if (segs.length === 0) return false;
  const blocked = new Set(opts.blockedDirs ?? ["node_modules"]);
  for (const s of segs) {
    if (s.startsWith(".")) return true;
    if (blocked.has(s)) return true;
  }
  const base = segs[segs.length - 1].toLowerCase();
  if (SECRET_NAMES.has(base) || base.startsWith("openclaw.env")) return true;
  if (SECRET_EXTENSIONS.has(path.extname(base))) return true;
  if (opts.nameHeuristics && /token|secret/.test(base)) return true;
  return false;
}

/**
 * Resolve a client-supplied path (relative to root, or absolute) to its REAL
 * location and return it only if it stays inside root after following
 * symlinks. Null means "refuse" — the caller must not distinguish why.
 */
export function resolveWithinRoot(root: string, input: string): { real: string; rel: string } | null {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) return null;
  const rootAbs = path.resolve(root);
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootAbs);
  } catch {
    return null;
  }
  const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(rootAbs, input);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  return { real, rel: path.relative(rootReal, real) };
}
