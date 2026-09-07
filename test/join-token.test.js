'use strict';
/**
 * join-token.test.js — the shared join-token codec (lib/join-token.js) and the
 * v4 payload the lead emits: lead identity pubkey + bus auth mode reach the
 * worker, no secret ever does.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  encodeJoinToken, decodeJoinToken, isJoinTokenExpired, verifyJoinTokenHmac, CURRENT_VERSION,
} = require('../lib/join-token');

test('encode/decode round-trips and the HMAC verifies only with the issuing secret', () => {
  const payload = { v: CURRENT_VERSION, nats: 'nats://10.0.0.1:4222', role: 'worker', expires: Date.now() + 60_000 };
  const { token, hmac } = encodeJoinToken(payload, 'secret-a');
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
  const decoded = decodeJoinToken(token);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.hmac, hmac);
  assert.equal(verifyJoinTokenHmac(token, 'secret-a'), true);
  assert.equal(verifyJoinTokenHmac(token, 'secret-b'), false);
});

test('expiry: v1 tokens never expire, later versions do', () => {
  assert.equal(isJoinTokenExpired({ v: 1, nats: 'x' }), false);
  assert.equal(isJoinTokenExpired({ v: 3, expires: Date.now() - 1 }), true);
  assert.equal(isJoinTokenExpired({ v: 3, expires: Date.now() + 1000 }), false);
});

test('malformed tokens throw instead of yielding an empty payload', () => {
  assert.throws(() => decodeJoinToken('not-a-token'), /base64url JSON/);
  assert.throws(() => decodeJoinToken(Buffer.from('{"s":"x"}').toString('base64url')), /no payload/);
});

test('a v3 token decodes with no lead pubkey (older leads still work)', () => {
  const { token } = encodeJoinToken({ v: 3, nats: 'nats://a:4222', expires: Date.now() + 1000 }, 's');
  const { payload } = decodeJoinToken(token);
  assert.equal(payload.lead_identity_pubkey, undefined);
  assert.equal(payload.nats_auth, undefined);
});

test('bin/mesh-join-token.js emits a v4 payload carrying the lead pubkey and auth mode, and no secret', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-jt-'));
  fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
  fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_NATS=nats://10.9.9.9:4222\nOPENCLAW_NATS_TOKEN=shared-secret-token\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ID=lead-x\n');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/mesh-join-token.js'), '--no-ssh'], {
    encoding: 'utf8', env: { ...process.env, HOME: home, OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'), OPENCLAW_NODE_ID: 'lead-x' },
  });
  assert.equal(r.status, 0, r.stderr);
  const token = r.stdout.split('\n').find((l) => /^[A-Za-z0-9_-]{40,}$/.test(l.trim()));
  assert.ok(token, `no token line in:\n${r.stdout}`);
  const { payload } = decodeJoinToken(token);
  assert.equal(payload.v, CURRENT_VERSION);
  assert.equal(payload.nats, 'nats://10.9.9.9:4222');
  assert.equal(payload.lead_node_id, 'lead-x');
  assert.equal(payload.nats_auth, 'nkey');
  const pub = fs.readFileSync(path.join(home, '.openclaw', 'identity.pub'), 'utf8');
  assert.ok(pub.includes('BEGIN PUBLIC KEY'));
  assert.equal(payload.lead_identity_pubkey.length, 44, 'raw base64 ed25519 pubkey, not PEM');
  assert.doesNotMatch(JSON.stringify(payload), /shared-secret-token/, 'the bus token never rides in the join token');
  const secret = fs.readFileSync(path.join(home, '.openclaw', '.mesh-secret'), 'utf8').trim();
  assert.equal(verifyJoinTokenHmac(token, secret), true);
  fs.rmSync(home, { recursive: true, force: true });
});
