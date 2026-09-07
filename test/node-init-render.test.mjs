/**
 * node-init-render.test.mjs — REMEDIATION_PLAN P4-8 (second half).
 *
 * openclaw-node-init.js used to write its own inline plist/unit text and a
 * second deploy listener. It now renders the repo's services/* templates —
 * the same files install.sh renders — so every node runs one definition.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { renderServiceTemplate, serviceTemplateVars, SERVICE_TEMPLATE_VARS } = require('../bin/openclaw-node-init.js');

const vars = serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: { nats: 'nats://10.0.0.5:4222', provider: 'deepseek' } });

describe('node-init renders the shared service templates', () => {
  const templates = [
    'launchd/ai.openclaw.mesh-agent.plist', 'launchd/ai.openclaw.mesh-deploy-listener.plist',
    'systemd/openclaw-mesh-agent.service', 'systemd/openclaw-mesh-deploy-listener.service',
  ];
  for (const t of templates) {
    it(`${t}: every placeholder is rendered and the node values land`, () => {
      const out = renderServiceTemplate(readFileSync(join(ROOT, 'services', t), 'utf8'), vars);
      assert.doesNotMatch(out, /\$\{[A-Z_]+\}/, 'no placeholder survives');
      assert.ok(out.includes('nats://10.0.0.5:4222'), 'NATS URL from discovery');
      assert.ok(out.includes('worker-7'), 'node id');
      assert.ok(out.includes('/opt/openclaw/bin/'), 'repo dir');
    });
  }

  it('an unknown placeholder fails loudly instead of shipping ${GARBAGE} into a unit', () => {
    assert.throws(() => renderServiceTemplate('ExecStart=${NODE_BIN} ${NOT_A_VAR}/x', vars), /unrendered template variable/);
  });

  it('the renderer knows every variable the templates use (drift lock)', () => {
    const used = new Set();
    for (const dir of ['launchd', 'systemd']) {
      for (const f of readdirSync(join(ROOT, 'services', dir))) {
        if (!/mesh-agent|mesh-deploy-listener/.test(f)) continue;
        for (const m of readFileSync(join(ROOT, 'services', dir, f), 'utf8').matchAll(/\$\{([A-Z_]+)\}/g)) used.add(m[1]);
      }
    }
    for (const v of used) assert.ok(SERVICE_TEMPLATE_VARS.includes(v), `template variable ${v} is not rendered by node-init`);
  });

  it('never writes the legacy second listener name', () => {
    const src = readFileSync(join(ROOT, 'bin', 'openclaw-node-init.js'), 'utf8');
    assert.ok(!/writeFileSync\([^)]*deploy-listener/.test(src.replace(/mesh-deploy-listener/g, '')), 'inline deploy-listener writer is gone');
    assert.ok(src.includes('ai.openclaw.deploy-listener.plist') && src.includes('Retired legacy'), 'legacy listener is retired, not left running');
  });
});

// Phase 7 (P7-1): the join token is the bootstrap channel. node-init must turn
// it into durable trust state — lead key in both allowlists (merged, never
// overwriting operator keys), lead in the identity registry, bus auth mode —
// and the service units must render with the merged allowlist.
describe('node-init join-token trust provisioning', () => {
  const { parseJoinToken, updateEnvFile, provisionTrust } = require('../bin/openclaw-node-init.js');
  const { encodeJoinToken } = require('../lib/join-token.js');
  const LEAD_KEY = 'LEADKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  function withHome(fn) {
    const home = mkdtempSync(join(tmpdir(), 'openclaw-init-'));
    const saved = { HOME: process.env.HOME, MESH_JOIN_TOKEN: process.env.MESH_JOIN_TOKEN, OPENCLAW_IDENTITY_DIR: process.env.OPENCLAW_IDENTITY_DIR, D: process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS, O: process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS, A: process.env.OPENCLAW_NATS_AUTH };
    process.env.HOME = home;
    process.env.OPENCLAW_IDENTITY_DIR = join(home, '.openclaw');
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS; delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS; delete process.env.OPENCLAW_NATS_AUTH;
    mkdirSync(join(home, '.openclaw'), { recursive: true });
    try { return fn(home); } finally {
      process.env.HOME = saved.HOME; process.env.OPENCLAW_IDENTITY_DIR = saved.OPENCLAW_IDENTITY_DIR;
      if (saved.MESH_JOIN_TOKEN === undefined) delete process.env.MESH_JOIN_TOKEN; else process.env.MESH_JOIN_TOKEN = saved.MESH_JOIN_TOKEN;
      for (const [k, v] of [['OPENCLAW_DEPLOY_TRUSTED_KEYS', saved.D], ['OPENCLAW_OPERATOR_TRUSTED_KEYS', saved.O], ['OPENCLAW_NATS_AUTH', saved.A]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('parseJoinToken reads the v4 facts and refuses an expired token', () => {
    withHome(() => {
      process.env.MESH_JOIN_TOKEN = encodeJoinToken({ v: 4, nats: 'nats://10.0.0.5:4222', provider: 'ollama', lead_node_id: 'lead-1', lead_identity_pubkey: LEAD_KEY, nats_auth: 'nkey', expires: Date.now() + 60_000 }, 's').token;
      assert.deepEqual(parseJoinToken(), { nats: 'nats://10.0.0.5:4222', provider: 'ollama', leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' });
      process.env.MESH_JOIN_TOKEN = encodeJoinToken({ v: 3, nats: 'nats://10.0.0.5:4222', expires: Date.now() + 60_000 }, 's').token;
      assert.equal(parseJoinToken().leadPubkey, undefined, 'v3 token: no pubkey, no crash');
    });
  });

  it('updateEnvFile sets keys in place and merges allowlists without duplicates', () => {
    withHome((home) => {
      const envPath = join(home, '.openclaw', 'openclaw.env');
      writeFileSync(envPath, 'OPENCLAW_NATS=nats://a:4222\nOPENCLAW_DEPLOY_TRUSTED_KEYS="opKey"\n');
      updateEnvFile({ OPENCLAW_NATS_AUTH: 'nkey' }, { OPENCLAW_DEPLOY_TRUSTED_KEYS: ['opKey', 'k2'], OPENCLAW_OPERATOR_TRUSTED_KEYS: ['k2'] });
      const env = readFileSync(envPath, 'utf8');
      assert.match(env, /^OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey,k2$/m);
      assert.match(env, /^OPENCLAW_OPERATOR_TRUSTED_KEYS=k2$/m);
      assert.match(env, /^OPENCLAW_NATS_AUTH=nkey$/m);
      assert.match(env, /^OPENCLAW_NATS=nats:\/\/a:4222$/m, 'untouched keys survive');
    });
  });

  it('provisionTrust creates the identity, trusts the lead, and the units render with the merged allowlist', () => {
    withHome((home) => {
      writeFileSync(join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey\n');
      const self = provisionTrust({ leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' }, 'worker-7');
      assert.equal(self.publicKeyBase64.length, 44);
      const env = readFileSync(join(home, '.openclaw', 'openclaw.env'), 'utf8');
      assert.match(env, new RegExp(`^OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey,${self.publicKeyBase64.replace(/[+/=]/g, '\\$&')},${LEAD_KEY.replace(/[+/=]/g, '\\$&')}$`, 'm'));
      assert.match(env, /^OPENCLAW_NATS_AUTH=nkey$/m);
      const registry = JSON.parse(readFileSync(join(home, '.openclaw', 'identity-registry.json'), 'utf8'));
      assert.equal(registry['lead-1'].pubkey, LEAD_KEY);
      assert.equal(registry['lead-1'].addedBy, 'join-token');
      // The listener unit is rendered from process.env — the merged list must be there.
      const v = serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: { nats: 'nats://a:4222' } });
      assert.equal(v.OPENCLAW_DEPLOY_TRUSTED_KEYS, `opKey,${self.publicKeyBase64},${LEAD_KEY}`);
      const unit = renderServiceTemplate(readFileSync(join(ROOT, 'services/systemd/openclaw-mesh-deploy-listener.service'), 'utf8'), v);
      assert.ok(unit.includes(LEAD_KEY), 'deploy listener unit carries the lead key');
      // Idempotent: a second run adds nothing.
      provisionTrust({ leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' }, 'worker-7');
      assert.equal(readFileSync(join(home, '.openclaw', 'openclaw.env'), 'utf8'), env);
    });
  });

  it('openclaw-trust-peer honours OPENCLAW_IDENTITY_DIR and stores --role', () => {
    withHome((home) => {
      const dir = join(home, 'ids');
      const env = { ...process.env, OPENCLAW_IDENTITY_DIR: dir };
      const pub = spawnSync(process.execPath, [join(ROOT, 'bin/openclaw-trust-peer.mjs'), '--my-pubkey'], { encoding: 'utf8', env });
      assert.equal(pub.status, 0, pub.stderr);
      assert.equal(pub.stdout.trim().length, 44);
      assert.ok(readFileSync(join(dir, 'identity.pub'), 'utf8').includes('BEGIN PUBLIC KEY'), 'identity created under the requested dir');
      const add = spawnSync(process.execPath, [join(ROOT, 'bin/openclaw-trust-peer.mjs'), 'w9', LEAD_KEY, '--role', 'lead'], { encoding: 'utf8', env });
      assert.equal(add.status, 0, add.stderr);
      const registry = JSON.parse(readFileSync(join(dir, 'identity-registry.json'), 'utf8'));
      assert.equal(registry.w9.role, 'lead');
    });
  });
});
