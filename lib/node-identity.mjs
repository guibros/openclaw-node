/**
 * node-identity.mjs — Per-node ed25519 identity keypair management and event signing
 *
 * Each openclaw node has an ed25519 keypair stored at `<identityDir>/identity.key`.
 * Events published to the federation layer are signed; incoming events are verified
 * with STRICT rejection of bad signatures.
 *
 * Usage:
 *   import { getOrCreateIdentity, signEvent, verifyEvent } from '../lib/node-identity.mjs';
 *   const identity = getOrCreateIdentity('~/.openclaw');
 *   const signed = signEvent(event, identity.privateKey);
 *   const valid = verifyEvent(signed);
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

// ─── Keypair Management ─────────────────────────────────────────────────────

/**
 * Get or create an ed25519 identity keypair for this node.
 *
 * If `identity.key` exists in the given directory, loads it.
 * Otherwise, generates a new ed25519 keypair and writes both
 * `identity.key` (private, mode 0o600) and `identity.pub` (public).
 *
 * @param {string} [identityDir] — directory containing identity files (default: ~/.openclaw)
 * @returns {{ privateKey: crypto.KeyObject, publicKey: crypto.KeyObject, publicKeyBase64: string }}
 */
export function getOrCreateIdentity(identityDir) {
  const dir = identityDir || DEFAULT_IDENTITY_DIR;
  const keyPath = path.join(dir, IDENTITY_KEY_FILE);
  const pubPath = path.join(dir, IDENTITY_PUBKEY_FILE);

  if (fs.existsSync(keyPath)) {
    // Load existing keypair
    const privatePem = fs.readFileSync(keyPath, 'utf8');
    const privateKey = crypto.createPrivateKey(privatePem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyBase64 = publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32) // ed25519 raw public key is last 32 bytes of SPKI DER
      .toString('base64');

    return { privateKey, publicKey, publicKeyBase64 };
  }

  // Generate new ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Write private key with restricted permissions
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });

  // Write public key for convenience
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(pubPath, publicPem, { mode: 0o644 });

  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64');

  return { privateKey, publicKey, publicKeyBase64 };
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
 * @param {string} _key
 * @param {*} value
 * @returns {*}
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
 * Verify the ed25519 signature on an event.
 *
 * If the event has no `signature` or `signer_pubkey` field, returns `true`
 * (backward compatibility — unsigned events are allowed during migration).
 *
 * If the event HAS a `signature` field, verification is STRICT:
 * invalid signature → returns `false`.
 *
 * @param {object} event — event object with optional `signature` + `signer_pubkey`
 * @returns {boolean} — true if valid or unsigned; false if signature present but invalid
 */
export function verifyEvent(event) {
  if (!event.signature || !event.signer_pubkey) {
    // No signature present — backward compatible, allow
    return true;
  }

  try {
    // Reconstruct the public key from the base64-encoded raw 32-byte key
    const rawPubKey = Buffer.from(event.signer_pubkey, 'base64');
    if (rawPubKey.length !== 32) return false;

    // Build SPKI DER wrapper for ed25519 (fixed 12-byte prefix + 32-byte key)
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([spkiPrefix, rawPubKey]);
    const publicKey = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });

    const canonical = canonicalizeEvent(event);
    const signature = Buffer.from(event.signature, 'base64');

    return crypto.verify(null, Buffer.from(canonical), publicKey, signature);
  } catch {
    // Any crypto error → reject
    return false;
  }
}
