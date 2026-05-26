/**
 * node-identity.mjs — Per-node ed25519 identity keypair management and event signing
 *
 * Each openclaw node has an ed25519 keypair stored at `<identityDir>/identity.key`.
 * Events published to the federation layer are signed; incoming events are verified
 * with STRICT rejection of bad/missing signatures by default.
 *
 * Threat model addressed:
 *   - Forgery: events without valid signatures are dropped (STRICT mode).
 *   - Impersonation: signer_pubkey must match the registered pubkey for the
 *     event's claimed node_id (via the identity registry).
 *   - Replay: events with timestamps outside the freshness window are dropped;
 *     a bounded seen-event-id LRU rejects exact-duplicate replays.
 *
 * Usage:
 *   import { getOrCreateIdentity, signEvent, verifyEvent, createIdentityRegistry,
 *            createSeenEventCache } from '../lib/node-identity.mjs';
 *   const identity = getOrCreateIdentity('~/.openclaw');
 *   const signed = signEvent(event, identity.privateKey);
 *   const valid = verifyEvent(signed, { registry, seenIds, requireSigned: true });
 *
 * Backward compatibility:
 *   `verifyEvent(event)` (no opts) still returns true on missing signature for
 *   legacy callers and tests, BUT new code paths pass `requireSigned: true` to
 *   enforce STRICT. The env var `OPENCLAW_REQUIRE_SIGNED=1` (default) makes
 *   STRICT the default for federation callers.
 *
 * @module lib/node-identity
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default identity directory (resolves ~ to homedir). */
export const DEFAULT_IDENTITY_DIR = path.join(os.homedir(), '.openclaw');

/** Identity key filename. */
export const IDENTITY_KEY_FILE = 'identity.key';

/** Identity public key filename (derived, written alongside private key). */
export const IDENTITY_PUBKEY_FILE = 'identity.pub';

/** Identity registry filename (nodeId→pubkey trust map). */
export const IDENTITY_REGISTRY_FILE = 'identity-registry.json';

/** Maximum event timestamp age (24 hours). Older signed events are rejected. */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/** Maximum event timestamp future drift (5 minutes). Catches clock skew + abuse. */
export const MAX_EVENT_FUTURE_MS = 5 * 60 * 1000;

/** Default seen-event LRU capacity. */
export const DEFAULT_SEEN_CACHE_SIZE = 10_000;

/** Whether to require signatures by default (controlled by env). */
export const REQUIRE_SIGNED_DEFAULT =
  (process.env.OPENCLAW_REQUIRE_SIGNED ?? '1') !== '0';

// ─── Keypair Management ─────────────────────────────────────────────────────

/**
 * Get or create an ed25519 identity keypair for this node.
 *
 * Atomic creation: uses `fs.openSync(..., 'wx')` (exclusive create) so two
 * concurrent processes won't race to clobber each other's keys. Falls back
 * to read-existing if EEXIST.
 *
 * @param {string} [identityDir] — directory containing identity files (default: ~/.openclaw)
 * @returns {{ privateKey: crypto.KeyObject, publicKey: crypto.KeyObject, publicKeyBase64: string }}
 */
export function getOrCreateIdentity(identityDir) {
  const dir = identityDir || DEFAULT_IDENTITY_DIR;
  const keyPath = path.join(dir, IDENTITY_KEY_FILE);
  const pubPath = path.join(dir, IDENTITY_PUBKEY_FILE);

  // Try to read existing key first (fast path)
  if (fs.existsSync(keyPath)) {
    return loadIdentityFromDisk(keyPath);
  }

  // Generate new keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(dir, { recursive: true });

  // Atomic create: exclusive flag fails if file already exists.
  // If we race a concurrent process, the loser reads what the winner wrote.
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  try {
    const fd = fs.openSync(keyPath, 'wx', 0o600);
    try {
      fs.writeSync(fd, privatePem);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another process won the race; load their key instead.
      return loadIdentityFromDisk(keyPath);
    }
    throw err;
  }

  // Write public key (non-secret, OK to overwrite)
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(pubPath, publicPem, { mode: 0o644 });

  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64');

  return { privateKey, publicKey, publicKeyBase64 };
}

/** Internal helper: load an existing keypair from disk. */
function loadIdentityFromDisk(keyPath) {
  const privatePem = fs.readFileSync(keyPath, 'utf8');
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64');
  return { privateKey, publicKey, publicKeyBase64 };
}

// ─── Identity Registry ──────────────────────────────────────────────────────
//
// The registry binds nodeId → trusted pubkey. Without this, a peer can sign
// with their own key and set node_id: "alice-node" — verifyEvent would happily
// accept it because the signature math is valid. The registry is the trust
// anchor.
//
// Registry shape: { [nodeId]: { pubkey: base64, addedAt: ISO, addedBy?: string } }
//
// Trust on first use (TOFU): if a node_id is unseen, the FIRST signed event's
// signer_pubkey is recorded. Subsequent events from that node_id must match.
// In production, operators can pre-seed the registry to avoid TOFU.

/**
 * Create an identity registry, optionally persisted to disk.
 *
 * @param {object} [opts]
 * @param {string} [opts.path] — file path to persist registry (default: ~/.openclaw/identity-registry.json)
 * @param {Object<string, string>} [opts.seed] — pre-seed { nodeId: pubkeyBase64 }
 * @param {'tofu' | 'strict'} [opts.mode='tofu'] — TOFU records on first sight; strict rejects unknown
 * @returns {{ trust(nodeId, pubkey), verify(nodeId, pubkey), get(nodeId), entries(), save(), mode }}
 */
export function createIdentityRegistry(opts = {}) {
  const registryPath = opts.path || path.join(DEFAULT_IDENTITY_DIR, IDENTITY_REGISTRY_FILE);
  const mode = opts.mode || 'tofu';
  const entries = new Map();

  // Load existing registry from disk
  if (fs.existsSync(registryPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      for (const [nodeId, record] of Object.entries(raw)) {
        if (record && typeof record.pubkey === 'string') {
          entries.set(nodeId, record);
        }
      }
    } catch {
      // Corrupt registry — start fresh
    }
  }

  // Apply seed
  if (opts.seed) {
    for (const [nodeId, pubkey] of Object.entries(opts.seed)) {
      if (!entries.has(nodeId)) {
        entries.set(nodeId, { pubkey, addedAt: new Date().toISOString(), addedBy: 'seed' });
      }
    }
  }

  function save() {
    const obj = Object.fromEntries(entries);
    try {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, JSON.stringify(obj, null, 2), { mode: 0o600 });
    } catch {
      // Best-effort — registry is recoverable from TOFU on next run
    }
  }

  /**
   * Record a nodeId↔pubkey binding. First-write-wins.
   * Returns true if newly trusted, false if already known.
   */
  function trust(nodeId, pubkey, addedBy = 'tofu') {
    if (entries.has(nodeId)) return false;
    entries.set(nodeId, { pubkey, addedAt: new Date().toISOString(), addedBy });
    save();
    return true;
  }

  /**
   * Verify that a given nodeId matches a given pubkey.
   * In TOFU mode: records unknown nodeIds on first sight; in strict mode: rejects.
   * @returns {{ ok: boolean, reason?: string }}
   */
  function verify(nodeId, pubkey) {
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
      return { ok: false, reason: 'empty-node-id' };
    }
    if (typeof pubkey !== 'string' || pubkey.length === 0) {
      return { ok: false, reason: 'empty-pubkey' };
    }
    const record = entries.get(nodeId);
    if (!record) {
      if (mode === 'strict') return { ok: false, reason: 'unknown-node-id' };
      trust(nodeId, pubkey, 'tofu');
      return { ok: true };
    }
    if (record.pubkey !== pubkey) {
      return { ok: false, reason: 'pubkey-mismatch' };
    }
    return { ok: true };
  }

  function get(nodeId) { return entries.get(nodeId) || null; }

  return {
    trust,
    verify,
    get,
    entries: () => Object.fromEntries(entries),
    save,
    mode,
  };
}

// ─── Seen-Event Cache (replay protection) ───────────────────────────────────

/**
 * Create a bounded LRU of seen event IDs for replay protection.
 *
 * Operators wire this into the verify path; if an event's `event_id` is in
 * the cache, it's a replay → reject. Cache size caps memory; oldest entries
 * evict as new ones arrive.
 *
 * @param {number} [maxSize=10000]
 * @returns {{ has(id): boolean, add(id), size(): number, clear() }}
 */
export function createSeenEventCache(maxSize = DEFAULT_SEEN_CACHE_SIZE) {
  // Use a Map for insertion-order iteration (true LRU)
  const seen = new Map();

  return {
    has(id) {
      if (!seen.has(id)) return false;
      // Touch: move to end (refresh LRU position)
      const v = seen.get(id);
      seen.delete(id);
      seen.set(id, v);
      return true;
    },
    add(id) {
      if (seen.has(id)) {
        seen.delete(id); // refresh position
      } else if (seen.size >= maxSize) {
        // Evict oldest (first insertion-order entry)
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.set(id, true);
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}

// ─── Canonical Serialization ────────────────────────────────────────────────

/**
 * Produce a canonical JSON representation of an event for signing.
 * Keys are sorted deterministically. The `signature` and `signer_pubkey`
 * fields are excluded from the canonical form to avoid circular dependency.
 *
 * @param {object} event — event object
 * @returns {string} — canonical JSON string
 */
export function canonicalizeEvent(event) {
  const filtered = {};
  const keys = Object.keys(event).sort();
  for (const key of keys) {
    if (key === 'signature' || key === 'signer_pubkey') continue;
    filtered[key] = event[key];
  }
  return JSON.stringify(filtered, sortReplacer);
}

/**
 * JSON.stringify replacer that sorts object keys recursively.
 */
function sortReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  }
  return value;
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * Sign an event with the node's ed25519 private key.
 *
 * Returns a new event object with `signature` (base64) and `signer_pubkey`
 * (base64 raw 32-byte public key) fields added.
 *
 * @param {object} event — event object (must not already have signature)
 * @param {crypto.KeyObject} privateKey — ed25519 private key
 * @returns {object} — event with `signature` + `signer_pubkey` added
 */
export function signEvent(event, privateKey) {
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64');

  const canonical = canonicalizeEvent(event);
  const signature = crypto.sign(null, Buffer.from(canonical), privateKey);

  return {
    ...event,
    signature: signature.toString('base64'),
    signer_pubkey: publicKeyBase64,
  };
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Freshness check: is the event's timestamp within the acceptable window?
 *
 * @param {object} event — must have `timestamp` (ISO 8601 string or epoch ms number)
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs] — past tolerance (default 24h)
 * @param {number} [opts.maxFutureMs] — future drift tolerance (default 5min)
 * @param {number} [opts.now] — override "now" for testing
 * @returns {{ ok: boolean, reason?: string, ageMs?: number }}
 */
export function checkEventFreshness(event, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? MAX_EVENT_AGE_MS;
  const maxFutureMs = opts.maxFutureMs ?? MAX_EVENT_FUTURE_MS;
  const now = opts.now ?? Date.now();

  if (event.timestamp === undefined || event.timestamp === null) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  const tsMs = typeof event.timestamp === 'number'
    ? event.timestamp
    : Date.parse(event.timestamp);
  if (Number.isNaN(tsMs)) {
    return { ok: false, reason: 'invalid-timestamp' };
  }
  const ageMs = now - tsMs;
  if (ageMs > maxAgeMs) {
    return { ok: false, reason: 'too-old', ageMs };
  }
  if (ageMs < -maxFutureMs) {
    return { ok: false, reason: 'too-far-future', ageMs };
  }
  return { ok: true, ageMs };
}

/**
 * Verify the ed25519 signature on an event.
 *
 * Two call shapes:
 *
 *   verifyEvent(event)              → legacy/test path; missing sig → true
 *   verifyEvent(event, opts)        → STRICT path with full checks
 *
 * STRICT mode opts:
 *   - requireSigned: boolean (default = OPENCLAW_REQUIRE_SIGNED env, default '1' = true)
 *   - registry: identity registry (binds nodeId → pubkey)
 *   - seenIds: seen-event cache (replay protection)
 *   - expectedNodeId: string (validates event.node_id matches)
 *   - checkFreshness: boolean (default true) — apply timestamp window
 *   - freshnessOpts: { maxAgeMs, maxFutureMs, now }
 *
 * @param {object} event — event with signature + signer_pubkey
 * @param {object} [opts] — strict verification options
 * @returns {boolean | { ok: boolean, reason: string }} — boolean in legacy mode; {ok, reason} in strict mode
 */
export function verifyEvent(event, opts) {
  // Legacy path: no opts → return boolean.
  // NOTE: this remains for backward compat with tests, but production callers
  // (broadcast offerer/acceptor/emitter) MUST pass opts to engage strict checks.
  const isStrict = opts !== undefined;

  // ── 1. Signature presence
  const hasSignature = !!(event.signature && event.signer_pubkey);
  if (!hasSignature) {
    const requireSigned = isStrict
      ? (opts.requireSigned ?? REQUIRE_SIGNED_DEFAULT)
      : false;
    if (requireSigned) {
      return isStrict ? { ok: false, reason: 'missing-signature' } : false;
    }
    // Legacy / not-required: pass
    return isStrict ? { ok: true, reason: 'unsigned-allowed' } : true;
  }

  // ── 2. Cryptographic signature verification
  let cryptoValid = false;
  try {
    const rawPubKey = Buffer.from(event.signer_pubkey, 'base64');
    if (rawPubKey.length !== 32) {
      return isStrict ? { ok: false, reason: 'bad-pubkey-length' } : false;
    }
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([spkiPrefix, rawPubKey]);
    const publicKey = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });
    const canonical = canonicalizeEvent(event);
    const signature = Buffer.from(event.signature, 'base64');
    cryptoValid = crypto.verify(null, Buffer.from(canonical), publicKey, signature);
  } catch {
    return isStrict ? { ok: false, reason: 'crypto-error' } : false;
  }

  if (!cryptoValid) {
    return isStrict ? { ok: false, reason: 'invalid-signature' } : false;
  }

  // Legacy callers stop here — they get a boolean.
  if (!isStrict) return true;

  // ── 3. STRICT-mode additional checks

  // 3a. NodeId binding via registry
  if (opts.registry) {
    const nodeId = opts.expectedNodeId ?? event.node_id;
    if (!nodeId) return { ok: false, reason: 'missing-node-id' };
    const reg = opts.registry.verify(nodeId, event.signer_pubkey);
    if (!reg.ok) return { ok: false, reason: `registry:${reg.reason}` };
  }

  // 3b. Expected nodeId match (caller asserting "this should be from node X")
  if (opts.expectedNodeId && event.node_id !== opts.expectedNodeId) {
    return { ok: false, reason: 'node-id-mismatch' };
  }

  // 3c. Timestamp freshness
  if (opts.checkFreshness !== false) {
    const fresh = checkEventFreshness(event, opts.freshnessOpts);
    if (!fresh.ok) return { ok: false, reason: `freshness:${fresh.reason}` };
  }

  // 3d. Replay protection
  if (opts.seenIds && event.event_id) {
    if (opts.seenIds.has(event.event_id)) {
      return { ok: false, reason: 'replay' };
    }
    // Record only after successful verify (don't trip the cache on rejected events).
    opts.seenIds.add(event.event_id);
  }

  return { ok: true };
}
