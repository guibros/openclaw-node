'use strict';
/**
 * nats-nkey.test.js — the node identity key IS the NATS nkey (lib/nats-nkey.js).
 *
 * Pins the derivation with a fixed test vector (a PEM checked in here → the
 * exact "SU…" seed and "U…" public strings), proves both crypto stacks agree
 * (nkeys signs, node:crypto verifies, and back), and that registry pubkeys
 * (raw base64) map to the same public nkey.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nkeys = require('nkeys.js');

const {
  identityToNkey, nkeyFromPrivateKey, publicKeyBase64ToNkey, nkeyAuthenticatorFor,
} = require('../lib/nats-nkey.js');

// Fixed vector: an ed25519 PKCS8 PEM whose raw seed is 32 bytes of 0x01..0x20.
const SEED32 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const VECTOR_PEM = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED32]),
  format: 'der', type: 'pkcs8',
}).export({ type: 'pkcs8', format: 'pem' });
const VECTOR_SEED = Buffer.from(require('nkeys.js/lib/codec.js').Codec.encodeSeed(nkeys.Prefix.User, SEED32)).toString();

test('fixed vector: seed and public nkey are stable and correctly prefixed', () => {
  const r = nkeyFromPrivateKey(VECTOR_PEM);
  assert.equal(r.seed, VECTOR_SEED);
  assert.match(r.seed, /^SU[A-Z2-7]{56}$/);
  assert.match(r.publicNkey, /^U[A-Z2-7]{55}$/);
  // The nkeys library derives the same public key from that seed.
  assert.equal(nkeys.fromSeed(new TextEncoder().encode(r.seed)).getPublicKey(), r.publicNkey);
  // And publicKeyBase64 is byte-identical to node-identity's form (SPKI DER tail).
  const spki = crypto.createPublicKey(VECTOR_PEM).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  assert.equal(r.publicKeyBase64, spki);
  assert.equal(publicKeyBase64ToNkey(spki), r.publicNkey);
});

test('signatures cross-verify between nkeys and node:crypto', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const r = nkeyFromPrivateKey(privateKey);
  const kp = nkeys.fromSeed(new TextEncoder().encode(r.seed));
  const nonce = crypto.randomBytes(24);
  const sig = Buffer.from(kp.sign(nonce));
  assert.equal(crypto.verify(null, nonce, publicKey, sig), true, 'nkey signature verifies with the identity pubkey');
  const nodeSig = crypto.sign(null, nonce, privateKey);
  assert.equal(nkeys.fromPublic(r.publicNkey).verify(nonce, nodeSig), true, 'node:crypto signature verifies with the public nkey');
  const other = nkeyFromPrivateKey(crypto.generateKeyPairSync('ed25519').privateKey);
  assert.equal(nkeys.fromPublic(other.publicNkey).verify(nonce, nodeSig), false, 'a different identity does not verify');
});

test('identityToNkey reads identity.key from a dir and returns null without one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkey-'));
  assert.equal(identityToNkey(dir), null);
  assert.equal(nkeyAuthenticatorFor(dir), null);
  fs.writeFileSync(path.join(dir, 'identity.key'), VECTOR_PEM);
  assert.equal(identityToNkey(dir).seed, VECTOR_SEED);
  assert.equal(typeof nkeyAuthenticatorFor(dir), 'function');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('non-ed25519 keys and malformed registry pubkeys are refused', () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => nkeyFromPrivateKey(rsa), /ed25519/);
  assert.throws(() => publicKeyBase64ToNkey('c2hvcnQ='), /32-byte/);
});
