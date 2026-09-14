import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Both scripts derive their repo root from their own location, so each suite
// builds a disposable fake repo and copies the script under test into it.
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-protocol-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function bash(script, { input } = {}) {
  return spawnSync('bash', [script], { input: input ?? '', encoding: 'utf8' });
}

describe('validate-push hook — force push is refused, not warned (review Phase 3)', () => {
  const hook = path.join(REPO, '.claude', 'hooks', 'validate-push.sh');
  const run = (command) => bash(hook, { input: JSON.stringify({ tool_input: { command } }) }).status;
  it('refuses --force wherever it sits in the command', () => {
    assert.equal(run('git push --force origin feature'), 2);
    assert.equal(run('git push origin main --force'), 2);
    assert.equal(run('git push origin feature --force-with-lease'), 2);
  });
  it('refuses the short flag and a + refspec', () => {
    assert.equal(run('git push -f origin feature'), 2);
    assert.equal(run('git push origin +main'), 2);
  });
  it('allows an ordinary push and ignores non-push commands', () => {
    assert.equal(run('git push -u origin feature'), 0);
    assert.equal(run('npm test'), 0);
  });
});

describe('plan-lint — [D] deferred state and drift checks', () => {
  let root, lint;
  const CANON_DOCS = ['MASTER_PLAN.md', 'PROTOCOL.md', 'FRAMEWORK_CANONICAL.md', 'COWORK_MODEL.md', 'BLOCK_TEMPLATE.md'];

  function silo(id, { inventory }) {
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
    fs.mkdirSync(path.join(plan, 'audits'), { recursive: true });
    for (const d of CANON_DOCS) fs.copyFileSync(path.join(root, 'memory-plan', 'canonical', d), path.join(plan, d));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.1\n');
    fs.writeFileSync(path.join(plan, 'OUT_OF_SCOPE.md'), '# OOS\n');
    fs.writeFileSync(path.join(plan, 'DECISIONS.md'), '## D1 — exists (2026-07-04)\n');
    fs.writeFileSync(path.join(plan, 'COMPONENT_REGISTRY.md'), '## Family 1: x\n| **Status** | ok |\n');
    fs.writeFileSync(path.join(plan, 'ROADMAP.md'), '# roadmap\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    const shim = path.join(root, 'workspace-bin', `${id}-tick.sh`);
    fs.writeFileSync(shim, '#!/bin/bash\ntrue\n');
    fs.chmodSync(shim, 0o755);
    fs.writeFileSync(path.join(plan, 'automation.json'),
      JSON.stringify({ plist_label: `ai.openclaw.${id}-tick`, tick_command: shim }));
    return plan;
  }

  before(() => {
    root = path.join(tmp, 'lintrepo');
    fs.mkdirSync(path.join(root, 'workspace-bin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'memory-plan', 'canonical'), { recursive: true });
    for (const d of CANON_DOCS) fs.writeFileSync(path.join(root, 'memory-plan', 'canonical', d), `# ${d}\n`);
    lint = path.join(root, 'workspace-bin', 'plan-lint.sh');
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-lint.sh'), lint);
    fs.chmodSync(lint, 0o755);
  });

  const ROW = (step, st, desc) => `| 1 | ${step} | v${step} | [${st}] | ${desc} |`;
  const CONTRACT = (step) =>
    `> **${step} — Goal:** g.\n> **Needs:** n.\n> **Feeds:** f.\n> **Verify:** code: v.\n`;

  it('[D] rows do not FAIL contract-less; open rows do', () => {
    const inv = `# INV\n\n${ROW('1.1', 'x', 'done')}\n${ROW('1.2', 'D', 'deferred')}\n\n${CONTRACT('1.1')}`;
    silo('tdefer', { inventory: inv });
    const r = spawnSync('bash', [lint, 'tdefer'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CONFORMANT/);

    const inv2 = `# INV\n\n${ROW('1.1', ' ', 'open no contract')}\n`;
    silo('topen', { inventory: inv2 });
    const r2 = spawnSync('bash', [lint, 'topen'], { encoding: 'utf8' });
    assert.equal(r2.status, 1);
    assert.match(r2.stdout, /open row\(s\) without the §11 contract/);
  });

  it('whitespace-variant rows still parse (unified row contract)', () => {
    const inv = `# INV\n\n|  1  |  1.1  |  v1.1  |  [x]  |  spaced row  |\n\n${CONTRACT('1.1')}`;
    silo('tspace', { inventory: inv });
    const r = spawnSync('bash', [lint, 'tspace'], { encoding: 'utf8' });
    assert.match(r.stdout, /1 row\(s\) in the load-bearing format/);
  });

});
