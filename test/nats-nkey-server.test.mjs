/**
 * nats-nkey-server.test.mjs — Phase 7 against a REAL nats-server.
 *
 * The rendered users block (bin/nats-auth-render.mjs) must let a lead in with
 * its identity nkey, refuse an unknown nkey, accept then (after re-render +
 * SIGHUP) refuse the legacy user, deny a worker's mesh.deploy.trigger publish
 * while its KV put/get/purge keep working, and natsConnectOpts must connect
 * end to end from a HOME that only carries identity.key + openclaw.env.
 *
 * Gated on the binary with the canonical skip marker
 * 'nats-server not found on PATH' (censused by mesh-skip-census).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connect, nkeys, nkeyAuthenticator } from 'nats';
import { natsServerBin, freePort, startNatsServer, writeServerConfig } from './helpers/nats-server.mjs';
import { renderAuthorization } from '../bin/nats-auth-render.mjs';
import { getOrCreateIdentity } from '../lib/node-identity.mjs';

const require = createRequire(import.meta.url);
const { identityToNkey, nkeyAuthenticatorFor } = require('../lib/nats-nkey.js');

const SKIP = natsServerBin() ? false : 'nats-server not found on PATH';

describe('nkey auth on a real nats-server', { skip: SKIP }, () => {
  let dir, port, server, authPath, lead, worker;
  const TOKEN = 'legacy-shared-token';

  function render({ legacyUser = 'openclaw' } = {}) {
    const text = renderAuthorization({
      mode: 'nkey', token: TOKEN, legacyUser,
      self: { nodeId: 'lead-a', nkey: lead.publicNkey, role: 'lead' },
      peers: [{ nodeId: 'w1', nkey: worker.publicNkey, role: 'worker' }],
    });
    fs.writeFileSync(authPath, text);
  }
  const url = () => `nats://127.0.0.1:${port}`;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkey-server-'));
    getOrCreateIdentity(path.join(dir, 'lead'));
    getOrCreateIdentity(path.join(dir, 'worker'));
    lead = identityToNkey(path.join(dir, 'lead'));
    worker = identityToNkey(path.join(dir, 'worker'));
    port = await freePort();
    authPath = path.join(dir, 'nats-auth.conf');
    render();
    server = await startNatsServer(writeServerConfig(dir, port));
  });
  after(async () => {
    if (server) await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lead connects with its identity nkey on an auth-required bus and may publish deploy triggers', async () => {
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'lead')), timeout: 3000 });
    assert.equal(nc.info.auth_required, true);
    const errors = [];
    (async () => { for await (const s of nc.status()) if (s.type === 'error') errors.push(String(s.data)); })();
    nc.publish('mesh.deploy.trigger', Buffer.from('{}'));
    await nc.flush();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(errors, []);
    await nc.close();
  });

  it('an nkey that is not in the users list is refused', async () => {
    const stranger = nkeys.createUser();
    await assert.rejects(
      connect({ servers: url(), authenticator: nkeyAuthenticator(stranger.getSeed()), timeout: 3000, maxReconnectAttempts: 0 }),
      /Authorization Violation/i,
    );
  });

  it('the worker cannot publish mesh.deploy.trigger but KV put/get/purge and mesh.tasks.* work', async () => {
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'worker')), timeout: 3000 });
    const errors = [];
    (async () => { for await (const s of nc.status()) if (s.type === 'error') errors.push(String(s.data)); })();
    nc.publish('mesh.deploy.trigger', Buffer.from('{}'));
    await nc.flush();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(errors.length, 1, `expected one permissions violation, got ${JSON.stringify(errors)}`);
    assert.match(errors[0], /PERMISSIONS_VIOLATION/);
    errors.length = 0;
    nc.publish('mesh.tasks.heartbeat', Buffer.from('{}'));
    nc.publish('mesh.tasks.merged', Buffer.from('{}'));
    const kv = await nc.jetstream().views.kv('NKEY_PROBE');
    await kv.put('k', 'v');
    assert.equal((await kv.get('k')).string(), 'v');
    await kv.purge('k');
    await nc.flush();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(errors, [], 'the deny set must not touch KV or mesh.tasks');
    await nc.close();
  });

  it('the legacy user works until the render drops it and the server reloads', async () => {
    const legacy = await connect({ servers: url(), user: 'openclaw', pass: TOKEN, timeout: 3000 });
    assert.equal(legacy.info.auth_required, true);
    await legacy.close();
    render({ legacyUser: false });
    server.reload();
    await new Promise((r) => setTimeout(r, 500));
    await assert.rejects(
      connect({ servers: url(), user: 'openclaw', pass: TOKEN, timeout: 3000, maxReconnectAttempts: 0 }),
      /Authorization Violation/i,
    );
    // The nkey users survived the reload.
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'lead')), timeout: 3000 });
    await nc.close();
  });

  it('natsConnectOpts connects end to end from a HOME with identity.key + openclaw.env', async () => {
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'lead', 'identity.key'), path.join(home, '.openclaw', 'identity.key'));
    fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), `OPENCLAW_NATS=${url()}\nOPENCLAW_NATS_TOKEN=${TOKEN}\nOPENCLAW_NATS_AUTH=nkey\n`);
    const saved = { HOME: process.env.HOME, ID: process.env.OPENCLAW_IDENTITY_DIR, N: process.env.OPENCLAW_NATS, T: process.env.OPENCLAW_NATS_TOKEN, A: process.env.OPENCLAW_NATS_AUTH };
    process.env.HOME = home;
    delete process.env.OPENCLAW_IDENTITY_DIR; delete process.env.OPENCLAW_NATS; delete process.env.OPENCLAW_NATS_TOKEN; delete process.env.OPENCLAW_NATS_AUTH;
    try {
      const modPath = require.resolve('../lib/nats-resolve.js');
      delete require.cache[modPath];
      const { natsConnectOpts, NATS_AUTH_MODE } = require('../lib/nats-resolve.js');
      assert.equal(NATS_AUTH_MODE, 'nkey');
      const opts = natsConnectOpts({ timeout: 3000 });
      assert.equal(opts.token, undefined);
      const nc = await connect(opts);
      assert.equal(nc.info.auth_required, true);
      await nc.close();
    } finally {
      process.env.HOME = saved.HOME;
      for (const [k, v] of [['OPENCLAW_IDENTITY_DIR', saved.ID], ['OPENCLAW_NATS', saved.N], ['OPENCLAW_NATS_TOKEN', saved.T], ['OPENCLAW_NATS_AUTH', saved.A]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      delete require.cache[require.resolve('../lib/nats-resolve.js')];
    }
  });
});
