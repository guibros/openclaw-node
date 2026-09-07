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
import { readFileSync, readdirSync } from 'node:fs';
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
