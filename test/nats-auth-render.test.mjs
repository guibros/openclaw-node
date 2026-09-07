/**
 * nats-auth-render.test.mjs — the server-side auth block (bin/nats-auth-render.mjs).
 *
 * token mode must be byte-equivalent to the block the templates used to inline;
 * nkey mode lists this node + every registry peer with the v1 worker deny set,
 * lead entries allow all, the legacy password user is present unless dropped,
 * and a render that would lock every node out is refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderAuthorization, syncNatsAuth, WORKER_PUBLISH_DENY, peersFromRegistry } from '../bin/nats-auth-render.mjs';
import { getOrCreateIdentity, createIdentityRegistry } from '../lib/node-identity.mjs';

const require = createRequire(import.meta.url);
const { identityToNkey, publicKeyBase64ToNkey } = require('../lib/nats-nkey.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEAD = 'UDGYMDZZXUB7NCYYJGDZYZMVD7PUZ3VU44ATD6YIX2D5GAKNJKKSAQ7R';
const WORKER = 'UBZJ7OCYDR6BKVIAV4P2Z5SEVDISO2V2JKQ7CS3DI4FYIDMEJCYGM4WB';

describe('renderAuthorization', () => {
  it('token mode reproduces the pre-Phase-7 block exactly', () => {
    assert.equal(renderAuthorization({ mode: 'token', token: 'abc' }), 'authorization {\n  token: "abc"\n}\n');
    assert.equal(renderAuthorization({ mode: 'token', token: null }), 'authorization {\n  token: ""\n}\n');
  });

  it('nkey mode: lead allows all, workers carry the deny set, legacy user last', () => {
    const out = renderAuthorization({
      mode: 'nkey', token: 'tok',
      self: { nodeId: 'lead-a', nkey: LEAD, role: 'lead' },
      peers: [{ nodeId: 'w1', nkey: WORKER, role: 'worker' }],
    });
    assert.ok(out.startsWith('authorization {\n  users: [\n'));
    assert.ok(out.includes(`{ nkey: "${LEAD}" }`), 'lead entry has no permissions block');
    assert.ok(out.includes(`{ nkey: "${WORKER}", permissions: { publish: { deny: ["mesh.deploy.trigger", "$JS.API.STREAM.DELETE.>"] } } }`));
    assert.ok(out.includes('{ user: "openclaw", password: "tok" }'));
    assert.deepEqual(WORKER_PUBLISH_DENY, ['mesh.deploy.trigger', '$JS.API.STREAM.DELETE.>']);
    // Worker perms deny only publishes: no subscribe block (the deploy listener subscribes).
    assert.doesNotMatch(out, /subscribe/);
  });

  it('nkey mode: a worker self, a lead peer, the legacy user dropped, duplicates collapsed', () => {
    const out = renderAuthorization({
      mode: 'nkey', token: 'tok', legacyUser: false,
      self: { nodeId: 'w1', nkey: WORKER, role: 'worker' },
      peers: [{ nodeId: 'lead-a', nkey: LEAD, role: 'lead' }, { nodeId: 'w1-again', nkey: WORKER, role: 'lead' }],
    });
    assert.equal(out.match(/nkey: "/g).length, 2, 'the same nkey is listed once, first role wins');
    assert.ok(out.includes(`{ nkey: "${WORKER}", permissions`));
    assert.ok(out.includes(`{ nkey: "${LEAD}" }`));
    assert.doesNotMatch(out, /password/);
    assert.doesNotMatch(renderAuthorization({ mode: 'nkey', token: 'tok', legacyUser: '0', self: { nkey: LEAD, role: 'lead' } }), /password/);
  });

  it('refuses nkey mode with zero nkeys and unknown modes', () => {
    assert.throws(() => renderAuthorization({ mode: 'nkey', token: 'tok' }), /zero nkeys/);
    assert.throws(() => renderAuthorization({ mode: 'creds', token: 'tok' }), /unknown auth mode/);
  });
});

describe('syncNatsAuth', () => {
  function tmpHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-auth-sync-'));
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    return home;
  }
  const KEYS = ['HOME', 'OPENCLAW_NATS_TOKEN', 'OPENCLAW_NATS_AUTH', 'OPENCLAW_NODE_ROLE', 'OPENCLAW_NODE_ID', 'OPENCLAW_IDENTITY_DIR', 'OPENCLAW_NATS_LEGACY_USER'];

  it('renders from the identity + registry through the CLI, mode 600, no secret on argv', () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=tok-xyz\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NODE_ID=lead-a\n');
    const self = getOrCreateIdentity(dir);
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const registry = createIdentityRegistry({ path: path.join(dir, 'identity-registry.json'), mode: 'strict' });
    registry.trust('w1', peer.publicKeyBase64, 'operator');
    registry.trust('bad', 'not-a-key', 'operator');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
    const out = path.join(dir, 'config', 'nats-auth.conf');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/nats-auth-render.mjs'), '--out', out], { encoding: 'utf8', env: { ...env, HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /tok-xyz/, 'the token never appears in output/logs');
    assert.match(r.stderr, /skipping registry entry bad/);
    assert.match(r.stderr, /2 nkey user\(s\) \[lead-a:lead, w1:worker\] \+ legacy user openclaw/);
    const text = fs.readFileSync(out, 'utf8');
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.ok(text.includes(`{ nkey: "${identityToNkey(dir).publicNkey}" }`), 'self is the lead: allow all');
    assert.ok(text.includes(`{ nkey: "${publicKeyBase64ToNkey(peer.publicKeyBase64)}", permissions`));
    assert.ok(text.includes('password: "tok-xyz"'));
    // --no-legacy-user drops the password entry; --mode token overrides the file.
    const r2 = spawnSync(process.execPath, [path.join(ROOT, 'bin/nats-auth-render.mjs'), '--out', out, '--no-legacy-user'], { encoding: 'utf8', env: { ...env, HOME: home } });
    assert.equal(r2.status, 0, r2.stderr);
    assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /password/);
    const r3 = spawnSync(process.execPath, [path.join(ROOT, 'bin/nats-auth-render.mjs'), '--out', out, '--mode', 'token'], { encoding: 'utf8', env: { ...env, HOME: home } });
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(fs.readFileSync(out, 'utf8'), 'authorization {\n  token: "tok-xyz"\n}\n');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('peersFromRegistry maps raw base64 pubkeys to public nkeys with their role', () => {
    const home = tmpHome();
    const a = getOrCreateIdentity(path.join(home, 'a'));
    const registry = createIdentityRegistry({ path: path.join(home, 'r.json'), mode: 'strict' });
    registry.trust('zeta', a.publicKeyBase64, 'operator', { role: 'lead' });
    const peers = peersFromRegistry(registry);
    assert.deepEqual(peers, [{ nodeId: 'zeta', nkey: publicKeyBase64ToNkey(a.publicKeyBase64), role: 'lead' }]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('openclaw-trust-peer --sync-nats re-renders the file after trusting a peer', async () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=t\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NODE_ID=lead-a\n');
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/openclaw-trust-peer.mjs'), 'w2', peer.publicKeyBase64, '--sync-nats'], { encoding: 'utf8', env: { ...env, HOME: home, OPENCLAW_IDENTITY_DIR: dir } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /trusted: w2 \(worker\)/);
    assert.match(r.stdout, /nats-auth: nkey mode/);
    const text = fs.readFileSync(path.join(dir, 'config', 'nats-auth.conf'), 'utf8');
    assert.ok(text.includes(publicKeyBase64ToNkey(peer.publicKeyBase64)));
    // The reload is best-effort: with no nats-server around it reports, never fails.
    assert.match(r.stdout, /no running nats-server found|SIGHUP sent|reloaded/);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
