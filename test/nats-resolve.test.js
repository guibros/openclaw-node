#!/usr/bin/env node

/**
 * nats-resolve.test.js — Unit tests for lib/nats-resolve.js
 *
 * Tests the 4-step resolution chain for NATS URL and token.
 *
 * Run: node --test test/nats-resolve.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// We need to test resolveNatsUrl/Token fresh each time (they cache at module load),
// so we re-require with cleared cache each test.

function freshRequire() {
  const modPath = require.resolve('../lib/nats-resolve');
  delete require.cache[modPath];
  return require('../lib/nats-resolve');
}

describe('nats-resolve', () => {
  const origEnv = {};
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-resolve-test-'));
    // Save and clear env
    origEnv.OPENCLAW_NATS = process.env.OPENCLAW_NATS;
    origEnv.OPENCLAW_NATS_TOKEN = process.env.OPENCLAW_NATS_TOKEN;
    origEnv.HOME = process.env.HOME;
    delete process.env.OPENCLAW_NATS;
    delete process.env.OPENCLAW_NATS_TOKEN;
  });

  afterEach(() => {
    // Restore env
    if (origEnv.OPENCLAW_NATS !== undefined) process.env.OPENCLAW_NATS = origEnv.OPENCLAW_NATS;
    else delete process.env.OPENCLAW_NATS;
    if (origEnv.OPENCLAW_NATS_TOKEN !== undefined) process.env.OPENCLAW_NATS_TOKEN = origEnv.OPENCLAW_NATS_TOKEN;
    else delete process.env.OPENCLAW_NATS_TOKEN;
    if (origEnv.HOME !== undefined) process.env.HOME = origEnv.HOME;
    // Clean tmp
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves URL from env var (highest priority)', () => {
    process.env.OPENCLAW_NATS = 'nats://custom:4222';
    const mod = freshRequire();
    assert.equal(mod.NATS_URL, 'nats://custom:4222');
  });

  it('resolves URL from openclaw.env file', () => {
    process.env.HOME = tmpDir;
    delete process.env.OPENCLAW_NATS;
    const envDir = path.join(tmpDir, '.openclaw');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'openclaw.env'), 'OPENCLAW_NATS=nats://from-env-file:4222\n');
    const mod = freshRequire();
    assert.equal(mod.NATS_URL, 'nats://from-env-file:4222');
  });

  it('resolves URL from .mesh-config file', () => {
    process.env.HOME = tmpDir;
    delete process.env.OPENCLAW_NATS;
    const meshDir = path.join(tmpDir, 'openclaw');
    fs.mkdirSync(meshDir, { recursive: true });
    fs.writeFileSync(path.join(meshDir, '.mesh-config'), 'OPENCLAW_NATS=nats://from-mesh:4222\n');
    const mod = freshRequire();
    assert.equal(mod.NATS_URL, 'nats://from-mesh:4222');
  });

  it('falls back to localhost when no config found', () => {
    process.env.HOME = tmpDir;
    delete process.env.OPENCLAW_NATS;
    const mod = freshRequire();
    assert.equal(mod.NATS_URL, 'nats://127.0.0.1:4222');
  });

  it('resolves token from env var', () => {
    process.env.OPENCLAW_NATS = 'nats://x:4222';
    process.env.OPENCLAW_NATS_TOKEN = 'secret-token';
    const mod = freshRequire();
    assert.equal(mod.NATS_TOKEN, 'secret-token');
  });

  it('resolves token from openclaw.env file', () => {
    process.env.HOME = tmpDir;
    process.env.OPENCLAW_NATS = 'nats://x:4222';
    delete process.env.OPENCLAW_NATS_TOKEN;
    const envDir = path.join(tmpDir, '.openclaw');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=my-token\n');
    const mod = freshRequire();
    assert.equal(mod.NATS_TOKEN, 'my-token');
  });

  it('token is null when not configured', () => {
    process.env.HOME = tmpDir;
    delete process.env.OPENCLAW_NATS_TOKEN;
    const mod = freshRequire();
    assert.equal(mod.NATS_TOKEN, null);
  });

  it('natsConnectOpts merges extra options', () => {
    process.env.OPENCLAW_NATS = 'nats://test:4222';
    const mod = freshRequire();
    const opts = mod.natsConnectOpts({ maxReconnectAttempts: 5 });
    assert.equal(opts.servers, 'nats://test:4222');
    assert.equal(opts.maxReconnectAttempts, 5);
  });

  it('natsConnectOpts includes token when present', () => {
    process.env.OPENCLAW_NATS = 'nats://test:4222';
    process.env.OPENCLAW_NATS_TOKEN = 'tok123';
    const mod = freshRequire();
    const opts = mod.natsConnectOpts();
    assert.equal(opts.token, 'tok123');
  });

  it('preserves quotes from env file values (no stripping)', () => {
    process.env.HOME = tmpDir;
    delete process.env.OPENCLAW_NATS;
    const envDir = path.join(tmpDir, '.openclaw');
    fs.mkdirSync(envDir, { recursive: true });
    // Use double-quoted value — the module preserves surrounding quotes
    fs.writeFileSync(path.join(envDir, 'openclaw.env'), 'OPENCLAW_NATS=nats://unquoted:4222\n');
    const mod = freshRequire();
    assert.equal(mod.NATS_URL, 'nats://unquoted:4222');
  });
});

// Phase 7: OPENCLAW_NATS_AUTH selects how natsConnectOpts authenticates.
describe('nats-resolve auth modes', () => {
  const KEYS = ['OPENCLAW_NATS', 'OPENCLAW_NATS_TOKEN', 'OPENCLAW_NATS_AUTH', 'OPENCLAW_NATS_LEGACY_USER', 'OPENCLAW_IDENTITY_DIR', 'HOME'];
  const saved = {};
  let home;

  function writeEnv(lines) {
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), lines.join('\n') + '\n');
  }
  function createIdentity() {
    // Same on-disk format node-identity.mjs writes (PKCS8 PEM, 0600).
    const crypto = require('crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(home, '.openclaw', 'identity.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    return publicKey;
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-auth-test-'));
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.HOME = home;
  });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('defaults to token mode and treats an unknown value as token', () => {
    writeEnv(['OPENCLAW_NATS_TOKEN=abc']);
    let mod = freshRequire();
    assert.equal(mod.NATS_AUTH_MODE, 'token');
    assert.deepEqual(mod.natsConnectOpts(), { servers: 'nats://127.0.0.1:4222', token: 'abc' });
    writeEnv(['OPENCLAW_NATS_TOKEN=abc', 'OPENCLAW_NATS_AUTH=banana']);
    mod = freshRequire();
    assert.equal(mod.NATS_AUTH_MODE, 'token');
  });

  it('nkey mode with an identity sends an nkey authenticator and no token', () => {
    writeEnv(['OPENCLAW_NATS_TOKEN=abc', 'OPENCLAW_NATS_AUTH=nkey']);
    createIdentity();
    const opts = freshRequire().natsConnectOpts({ timeout: 7 });
    assert.equal(typeof opts.authenticator, 'function');
    assert.equal(opts.token, undefined);
    assert.equal(opts.user, undefined);
    assert.equal(opts.timeout, 7);
  });

  it('nkey mode without an identity falls back to the legacy user/password entry', () => {
    writeEnv(['OPENCLAW_NATS_TOKEN=abc', 'OPENCLAW_NATS_AUTH=nkey', 'OPENCLAW_NATS_LEGACY_USER=bridge']);
    const opts = freshRequire().natsConnectOpts();
    assert.deepEqual(opts, { servers: 'nats://127.0.0.1:4222', user: 'bridge', pass: 'abc' });
  });

  it('nkey-strict without an identity refuses to build connect options', () => {
    writeEnv(['OPENCLAW_NATS_TOKEN=abc', 'OPENCLAW_NATS_AUTH=nkey-strict']);
    assert.throws(() => freshRequire().natsConnectOpts(), /nkey-strict/);
  });

  it('an explicit authenticator or token in extra wins over the resolved mode', () => {
    writeEnv(['OPENCLAW_NATS_TOKEN=abc', 'OPENCLAW_NATS_AUTH=nkey-strict']);
    const mod = freshRequire();
    const auth = () => {};
    assert.equal(mod.natsConnectOpts({ authenticator: auth }).authenticator, auth);
    assert.equal(mod.natsConnectOpts({ token: 'x' }).token, 'x');
  });

  it('OPENCLAW_IDENTITY_DIR points nkey mode at another identity', () => {
    writeEnv(['OPENCLAW_NATS_AUTH=nkey']);
    const other = path.join(home, 'elsewhere');
    fs.mkdirSync(other);
    const crypto = require('crypto');
    fs.writeFileSync(path.join(other, 'identity.key'), crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    process.env.OPENCLAW_IDENTITY_DIR = other;
    assert.equal(typeof freshRequire().natsConnectOpts().authenticator, 'function');
  });
});
