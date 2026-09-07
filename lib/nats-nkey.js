/**
 * nats-nkey.js — this node's identity key as a NATS nkey (Phase 7).
 *
 * NATS nkeys are ed25519 keypairs with a base32 text encoding: a seed string
 * "SU…" (user seed) and a public key "U…". The node identity at
 * ~/.openclaw/identity.key is ALSO an ed25519 key (PKCS8 PEM), so the same key
 * material serves both: raw seed = last 32 bytes of the PKCS8 DER, raw public
 * key = last 32 bytes of the SPKI DER (the exact bytes node-identity.mjs
 * exposes as publicKeyBase64). Signatures produced through nkeys verify with
 * node:crypto against the identity public key, and vice versa — proven in
 * test/nats-nkey.test.js.
 *
 * Trade-off (federation DECISIONS D17): one secret per node. Whoever holds
 * identity.key holds the bus credential and the signing key. The API takes an
 * identity dir, so moving to a separate `nats-nkey.seed` later is a local swap.
 *
 * This module never logs, prints, or throws the seed.
 *
 * CJS on purpose: lib/nats-resolve.js is CJS and is required by every daemon at
 * load time; nkeys.js is a dependency of `nats` (hoisted). Its top-level
 * encode/decode are base64 helpers — the nkey codec lives in lib/codec.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nkeys = require('nkeys.js');
const { Codec } = require('nkeys.js/lib/codec.js');

const IDENTITY_KEY_FILE = 'identity.key';

function defaultIdentityDir() {
  return process.env.OPENCLAW_IDENTITY_DIR || path.join(os.homedir(), '.openclaw');
}

/** Raw 32-byte ed25519 public key → "U…" nkey public string. */
function rawPublicToNkey(raw32) {
  return Buffer.from(Codec.encode(nkeys.Prefix.User, raw32)).toString('utf8');
}

/** Raw base64 pubkey (identity registry / publicKeyBase64 form) → "U…". */
function publicKeyBase64ToNkey(b64) {
  const raw = Buffer.from(String(b64), 'base64');
  if (raw.length !== 32) throw new Error(`expected a 32-byte raw ed25519 pubkey, got ${raw.length} bytes`);
  return rawPublicToNkey(raw);
}

/**
 * Derive the nkey pair from an identity PEM (or a KeyObject).
 * @returns {{ seed: string, publicNkey: string, publicKeyBase64: string }}
 */
function nkeyFromPrivateKey(pemOrKey) {
  const privateKey = typeof pemOrKey === 'string' || Buffer.isBuffer(pemOrKey)
    ? crypto.createPrivateKey(pemOrKey)
    : pemOrKey;
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`identity key must be ed25519, got ${privateKey.asymmetricKeyType}`);
  }
  const seed32 = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  const pub32 = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  const seed = Buffer.from(Codec.encodeSeed(nkeys.Prefix.User, seed32)).toString('utf8');
  const publicNkey = rawPublicToNkey(pub32);
  // Cross-check: the nkeys library must agree on the public key it derives.
  const check = nkeys.fromSeed(new TextEncoder().encode(seed)).getPublicKey();
  if (check !== publicNkey) throw new Error('nkey derivation mismatch between node:crypto and nkeys');
  return { seed, publicNkey, publicKeyBase64: pub32.toString('base64') };
}

/**
 * Read the node identity and derive its nkey. Returns null when no identity
 * exists in the dir (the caller decides whether that is fatal).
 */
function identityToNkey(identityDir = defaultIdentityDir()) {
  const keyPath = path.join(identityDir, IDENTITY_KEY_FILE);
  if (!fs.existsSync(keyPath)) return null;
  return nkeyFromPrivateKey(fs.readFileSync(keyPath, 'utf8'));
}

/**
 * A `nats` authenticator for this node, or null without an identity. The seed
 * bytes stay inside the closure the nats client uses to sign the server nonce.
 */
function nkeyAuthenticatorFor(identityDir = defaultIdentityDir()) {
  const pair = identityToNkey(identityDir);
  if (!pair) return null;
  const { nkeyAuthenticator } = require('nats');
  return nkeyAuthenticator(new TextEncoder().encode(pair.seed));
}

module.exports = {
  defaultIdentityDir,
  identityToNkey,
  nkeyFromPrivateKey,
  publicKeyBase64ToNkey,
  rawPublicToNkey,
  nkeyAuthenticatorFor,
};
