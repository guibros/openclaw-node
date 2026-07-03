import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateIdentity } from '../lib/node-identity.mjs';
import {
  signDeployTrigger,
  verifyDeployTrigger,
  verifyDeployMarker,
  trustedDeployKeys,
  requireSignedDeploy,
} from '../lib/deploy-trigger-auth.mjs';

/** A representative deploy trigger payload (matches bin/mesh.js / fleet-deploy.js). */
function trigger() {
  return {
    sha: 'abc1234',
    branch: 'main',
    nodes: ['all'],
    initiator: 'lead-node',
    timestamp: new Date().toISOString(),
  };
}

describe('deploy-trigger-auth', () => {
  let dir, id;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-auth-'));
    id = getOrCreateIdentity(dir);
    delete process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY;
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY;
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS;
  });

  it('sign → verify roundtrip passes for a trusted key (strict)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    assert.ok(signed.signature, 'trigger is signed');
    assert.equal(signed.signer_pubkey, id.publicKeyBase64);
    const res = verifyDeployTrigger(signed, {
      requireSigned: true,
      trustedKeys: [id.publicKeyBase64],
    });
    assert.deepEqual(res, { ok: true, reason: 'verified' });
  });

  it('strict mode REJECTS an unsigned trigger', () => {
    const res = verifyDeployTrigger(trigger(), { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-signature');
  });

  it('strict mode REJECTS a valid signature from an UNtrusted key', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: ['someOtherKeyBase64=='] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'untrusted-signer');
  });

  it('strict mode FAILS CLOSED when no trust allowlist is configured', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no-trusted-deploy-keys-configured');
  });

  it('strict mode REJECTS a tampered payload (sha swapped after signing)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const tampered = { ...signed, sha: 'deadbeef' }; // attacker changes the deploy target
    const res = verifyDeployTrigger(tampered, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-signature');
  });

  it('strict mode REJECTS a stale trigger (replay window)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.match(res.reason, /too-old/);
  });

  it('non-strict (default) allows an unsigned trigger — backward compatible', () => {
    let warned = false;
    const res = verifyDeployTrigger(trigger(), { requireSigned: false, log: () => { warned = true; } });
    assert.deepEqual(res, { ok: true, reason: 'unsigned-allowed' });
    assert.ok(warned, 'unsigned acceptance is logged, not silent');
  });

  it('non-strict passes a signed trigger through without requiring trust', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: false });
    assert.deepEqual(res, { ok: true, reason: 'signed-not-required' });
  });

  it('strict mode REJECTS a replayed trigger (same event_id verified twice)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    assert.ok(signed.event_id, 'signing stamps an event_id');
    const opts = { requireSigned: true, trustedKeys: [id.publicKeyBase64] };
    assert.equal(verifyDeployTrigger(signed, opts).ok, true);
    const replayed = verifyDeployTrigger(signed, opts);
    assert.equal(replayed.ok, false);
    assert.equal(replayed.reason, 'replay');
  });

  it('strict mode REJECTS a trigger older than the deploy freshness window (15min default)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 20 * 60_000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.match(res.reason, /too-old/);
  });

  it('marker: a trusted-signed marker verifies with NO freshness bound (days old)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployMarker(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.deepEqual(res, { ok: true, reason: 'verified' });
    // and again — markers are re-read on every startup, no replay cache
    assert.equal(verifyDeployMarker(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] }).ok, true);
  });

  it('marker: strict mode REJECTS an unsigned legacy marker ({sha, branch})', () => {
    const res = verifyDeployMarker({ sha: 'abc1234', branch: 'main' }, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-signature');
  });

  it('marker: strict mode REJECTS a tampered marker (sha swapped after signing)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployMarker({ ...signed, sha: 'deadbeef' }, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-signature');
  });

  it('marker: non-strict allows an unsigned legacy marker with a warning', () => {
    let warned = false;
    const res = verifyDeployMarker({ sha: 'abc1234', branch: 'main' }, { requireSigned: false, log: () => { warned = true; } });
    assert.equal(res.ok, true);
    assert.ok(warned);
  });

  it('env toggles: requireSignedDeploy() + trustedDeployKeys()', () => {
    assert.equal(requireSignedDeploy(), false);
    process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY = '1';
    assert.equal(requireSignedDeploy(), true);
    process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS = 'keyA==, keyB==';
    assert.deepEqual(trustedDeployKeys(), ['keyA==', 'keyB==']);
  });
});
