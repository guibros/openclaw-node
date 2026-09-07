#!/usr/bin/env node
/**
 * nats-auth-render.mjs — render the nats-server `authorization` block (Phase 7).
 *
 * Every NATS template under services/nats/ carries `include "nats-auth.conf"`
 * instead of an inline token block; this script writes that file to
 * ~/.openclaw/config/nats-auth.conf so the auth policy can change (a peer
 * trusted, a peer revoked, a mode flip) without re-rendering nats.conf and its
 * cluster routes. `--reload` sends nats-server SIGHUP, which re-reads
 * authorization and drops connections that no longer pass.
 *
 * Modes (OPENCLAW_NATS_AUTH):
 *   token  → authorization { token: "<OPENCLAW_NATS_TOKEN>" }   (pre-Phase-7 behaviour)
 *   nkey   → authorization { users: [ …nkeys from identity + registry…, legacy user ] }
 *            - this node's identity nkey: allow-all when OPENCLAW_NODE_ROLE=lead,
 *              worker permissions otherwise
 *            - every identity-registry peer: allow-all when its entry carries
 *              role "lead", worker permissions otherwise
 *            - a legacy { user, password: <token> } entry so clients that still
 *              send the shared token keep working during the migration window;
 *              dropped with --no-legacy-user (or OPENCLAW_NATS_LEGACY_USER=0)
 *
 * Worker permissions (v1, the operator's "minimal safe set"): publish DENY on
 * mesh.deploy.trigger (only the lead deploys) and $JS.API.STREAM.DELETE.>
 * (nothing in the codebase deletes streams; it is the most destructive call a
 * leaked credential could make). Everything else — JetStream/KV API, inboxes,
 * mesh.*, memory.*, fed.* — stays allowed: workers legitimately purge KV keys
 * and publish mesh.tasks.merged. No subscribe denies: a worker's own deploy
 * listener subscribes to mesh.deploy.trigger.
 *
 * Usage:
 *   node bin/nats-auth-render.mjs [--out FILE] [--mode token|nkey] [--identity-dir DIR]
 *                                 [--no-legacy-user] [--reload] [--print]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createIdentityRegistry, IDENTITY_REGISTRY_FILE } from '../lib/node-identity.mjs';
import { atomicWriteFileSync } from '../lib/atomic-write.mjs';

const require = createRequire(import.meta.url);
const { identityToNkey, publicKeyBase64ToNkey, defaultIdentityDir } = require('../lib/nats-nkey.js');

export const WORKER_PUBLISH_DENY = ['mesh.deploy.trigger', '$JS.API.STREAM.DELETE.>'];
export const DEFAULT_LEGACY_USER = 'openclaw';

function quote(s) {
  return JSON.stringify(String(s));
}

/**
 * Pure renderer — everything the CLI reads from disk arrives as arguments so
 * tests can pin the exact output.
 *
 * @param {object} o
 * @param {'token'|'nkey'} o.mode
 * @param {string|null} o.token            shared token (token mode / legacy user password)
 * @param {{ nkey: string, role?: string, nodeId?: string }|null} [o.self]
 * @param {Array<{ nodeId: string, nkey: string, role?: string }>} [o.peers]
 * @param {string|false} [o.legacyUser]    false / '' / '0' omits the legacy entry
 * @returns {string}
 */
export function renderAuthorization({ mode, token, self = null, peers = [], legacyUser = DEFAULT_LEGACY_USER }) {
  if (mode === 'token') {
    return `authorization {\n  token: ${quote(token || '')}\n}\n`;
  }
  if (mode !== 'nkey') throw new Error(`unknown auth mode: ${mode}`);

  const entries = [];
  const seen = new Set();
  const push = (label, nkey, role) => {
    if (seen.has(nkey)) return;          // self may also sit in the registry
    seen.add(nkey);
    const perms = role === 'lead'
      ? ''
      : `, permissions: { publish: { deny: [${WORKER_PUBLISH_DENY.map(quote).join(', ')}] } }`;
    entries.push(`    # ${label} (${role === 'lead' ? 'lead: allow all' : 'worker'})\n    { nkey: ${quote(nkey)}${perms} }`);
  };
  if (self) push(self.nodeId ? `self ${self.nodeId}` : 'self', self.nkey, self.role === 'lead' ? 'lead' : 'worker');
  for (const p of peers) push(`peer ${p.nodeId}`, p.nkey, p.role === 'lead' ? 'lead' : 'worker');

  if (seen.size === 0) {
    throw new Error('refusing to render nkey mode with zero nkeys — every node would be locked out except the legacy user');
  }
  const legacy = legacyUser && legacyUser !== '0' && token
    ? `\n    # legacy shared-token clients (migration window; drop with --no-legacy-user)\n    { user: ${quote(legacyUser)}, password: ${quote(token)} }`
    : '';
  return `authorization {\n  users: [\n${entries.join('\n')}${legacy}\n  ]\n}\n`;
}

/** Registry entries → renderer peers (pubkeys that are not raw ed25519 are skipped, loudly). */
export function peersFromRegistry(registry, warn = () => {}) {
  const peers = [];
  for (const [nodeId, record] of registry.entries()) {
    try {
      peers.push({ nodeId, nkey: publicKeyBase64ToNkey(record.pubkey), role: record.role || 'worker' });
    } catch (err) {
      warn(`skipping registry entry ${nodeId}: ${err.message}`);
    }
  }
  return peers.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

/**
 * Best-effort nats-server reload: `nats-server --signal reload` when the
 * binary is on PATH, else SIGHUP every nats-server process we can see. Never
 * throws — a failed reload is reported and the operator restarts by hand.
 */
export function reloadNatsServer(log = console.error) {
  const bin = spawnSync('sh', ['-c', 'command -v nats-server'], { encoding: 'utf8' }).stdout.trim();
  if (bin) {
    const r = spawnSync(bin, ['--signal', 'reload'], { encoding: 'utf8' });
    if (r.status === 0) return 'reloaded via nats-server --signal reload';
    log(`nats-server --signal reload failed: ${(r.stderr || r.stdout).trim()}`);
  }
  let pids = '';
  try { pids = execFileSync('pgrep', ['-x', 'nats-server'], { encoding: 'utf8' }).trim(); } catch { /* none running */ }
  if (!pids) return 'no running nats-server found — restart it to apply';
  let ok = 0;
  for (const pid of pids.split(/\s+/)) {
    try { process.kill(Number(pid), 'SIGHUP'); ok += 1; } catch (err) { log(`SIGHUP ${pid}: ${err.message}`); }
  }
  return `SIGHUP sent to ${ok} nats-server process(es)`;
}

/**
 * Gather inputs from the node's state and write the auth file.
 * Used by the CLI and by `openclaw-trust-peer --sync-nats`.
 */
export async function syncNatsAuth({
  identityDir = defaultIdentityDir(),
  out = path.join(os.homedir(), '.openclaw', 'config', 'nats-auth.conf'),
  mode,
  legacyUser,
  reload = false,
  print = false,
  log = (m) => process.stderr.write(`[nats-auth] ${m}\n`),
} = {}) {
  const resolve = require('../lib/nats-resolve.js');
  const effectiveMode = (mode || resolve.NATS_AUTH_MODE) === 'token' ? 'token' : 'nkey';
  const token = resolve.NATS_TOKEN;
  const legacy = legacyUser !== undefined ? legacyUser : (resolve.resolveEnvKey('OPENCLAW_NATS_LEGACY_USER') || DEFAULT_LEGACY_USER);

  let self = null;
  let peers = [];
  if (effectiveMode === 'nkey') {
    const pair = identityToNkey(identityDir);
    if (pair) {
      self = {
        nodeId: resolve.resolveEnvKey('OPENCLAW_NODE_ID') || require('../lib/node-id.js').resolveNodeId(),
        nkey: pair.publicNkey,
        role: (resolve.resolveEnvKey('OPENCLAW_NODE_ROLE') || 'worker') === 'lead' ? 'lead' : 'worker',
      };
    } else {
      log(`no identity.key under ${identityDir} — this node itself gets no nkey entry`);
    }
    const registry = createIdentityRegistry({ path: path.join(identityDir, IDENTITY_REGISTRY_FILE), mode: 'strict' });
    peers = peersFromRegistry(registry, log);
  }

  const text = renderAuthorization({ mode: effectiveMode, token, self, peers, legacyUser: legacy });
  if (print) process.stdout.write(text);
  atomicWriteFileSync(out, text, { mode: 0o600, mkdirp: true });

  const users = effectiveMode === 'nkey'
    ? [self && `${self.nodeId}:${self.role}`, ...peers.map((p) => `${p.nodeId}:${p.role}`)].filter(Boolean)
    : [];
  let reloadResult = 'not reloaded';
  if (reload) reloadResult = reloadNatsServer(log);
  const summary = effectiveMode === 'token'
    ? `token mode → ${out} (${reloadResult})`
    : `nkey mode → ${out}: ${users.length} nkey user(s) [${users.join(', ')}]${legacy && legacy !== '0' && token ? ` + legacy user ${legacy}` : ''} (${reloadResult})`;
  return { out, mode: effectiveMode, users, summary, text };
}

function getArg(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('usage: nats-auth-render.mjs [--out FILE] [--mode token|nkey] [--identity-dir DIR] [--no-legacy-user] [--reload] [--print]\n');
    return;
  }
  const result = await syncNatsAuth({
    out: getArg(argv, '--out'),
    mode: getArg(argv, '--mode'),
    identityDir: getArg(argv, '--identity-dir'),
    legacyUser: argv.includes('--no-legacy-user') ? false : undefined,
    reload: argv.includes('--reload'),
    print: argv.includes('--print'),
  });
  process.stderr.write(`[nats-auth] ${result.summary}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`[nats-auth] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
