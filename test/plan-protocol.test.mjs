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

describe('scope-check hook — per-batch closable files blocks', () => {
  let root, hook;
  before(() => {
    root = path.join(tmp, 'hookrepo');
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'memory-plan', 'plans', 't1'), { recursive: true });
    hook = path.join(root, '.claude', 'hooks', 'scope-check.sh');
    fs.copyFileSync(path.join(REPO, '.claude', 'hooks', 'scope-check.sh'), hook);
    fs.chmodSync(hook, 0o755);
    fs.writeFileSync(path.join(root, 'memory-plan', 'plans', 't1', 'SCOPE.md'), `# SCOPE — t1

**Status:** active
**Set at:** 2026-07-04
**Expires:** no-expiry

\`\`\`files open-batch
lib/open-file.mjs
docs/open-*.md
docs/deep/**/nested-*.md
lib/link-out.mjs
\`\`\`

\`\`\`files shipped-batch closed
lib/shipped-file.mjs
\`\`\`

\`\`\`files
lib/bare-block-file.mjs
\`\`\`
`);
    // A listed repo path that is a symlink to a file OUTSIDE the repo (review I4).
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'outside', 'target.mjs'), '');
    fs.symlinkSync(path.join(tmp, 'outside', 'target.mjs'), path.join(root, 'lib', 'link-out.mjs'));
  });

  const probe = (file) =>
    bash(hook, { input: JSON.stringify({ tool_input: { file_path: path.join(root, file) } }) }).status;
  // path.join normalizes `..` away before the hook sees it; traversal cases must
  // hand the hook the raw string, exactly as a tool call would.
  const probeRaw = (file) =>
    bash(hook, { input: JSON.stringify({ tool_input: { file_path: `${root}/${file}` } }) }).status;

  it('allows files in an open labeled block', () => {
    assert.equal(probe('lib/open-file.mjs'), 0);
  });
  it('allows globs in an open block', () => {
    assert.equal(probe('docs/open-anything.md'), 0);
  });
  it('blocks files whose batch fence is marked closed', () => {
    assert.equal(probe('lib/shipped-file.mjs'), 2);
  });
  it('still honors bare unlabeled blocks (backward compatible)', () => {
    assert.equal(probe('lib/bare-block-file.mjs'), 0);
  });
  it('blocks never-scoped files', () => {
    assert.equal(probe('lib/never-scoped.mjs'), 2);
  });
  it('always allows the plan SCOPE.md itself', () => {
    assert.equal(probe('memory-plan/plans/t1/SCOPE.md'), 0);
  });

  // ── hardening (review I4: the only enforced gate in the repo was bypassable) ──
  it("refuses a '..' segment even when it would resolve to a listed file", () => {
    assert.equal(probeRaw('lib/../lib/open-file.mjs'), 2);
    assert.equal(probeRaw('docs/../CLAUDE.md'), 2);
  });
  it("a single '*' never crosses a '/' (docs/open-*.md does not unlock docs/sub/…)", () => {
    assert.equal(probe('docs/sub/open-anything.md'), 2);
  });
  it("'**' spans segments", () => {
    assert.equal(probe('docs/deep/a/b/nested-x.md'), 0);
    assert.equal(probe('docs/deep/other-x.md'), 2);
  });
  it('blocks a listed path that is a symlink escaping the repo', () => {
    assert.equal(probe('lib/link-out.mjs'), 2);
  });
  it('fails CLOSED on empty stdin and on pathless input', () => {
    assert.equal(bash(hook, { input: '' }).status, 2);
    assert.equal(bash(hook, { input: JSON.stringify({ tool_input: {} }) }).status, 2);
  });
  it('does not govern paths outside the repo (a scratchpad is not scope drift)', () => {
    const outside = path.join(tmp, 'outside', 'scratch.md');
    assert.equal(bash(hook, { input: JSON.stringify({ tool_input: { file_path: outside } }) }).status, 0);
  });
});

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

  function silo(id, { inventory, scope }) {
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
    fs.mkdirSync(path.join(plan, 'audits'), { recursive: true });
    for (const d of CANON_DOCS) fs.copyFileSync(path.join(root, 'memory-plan', 'canonical', d), path.join(plan, d));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'SCOPE.md'), scope);
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
    silo('tdefer', { inventory: inv, scope: '# S\n\n**Status:** idle\n\n```files\n```\n' });
    const r = spawnSync('bash', [lint, 'tdefer'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CONFORMANT/);

    const inv2 = `# INV\n\n${ROW('1.1', ' ', 'open no contract')}\n`;
    silo('topen', { inventory: inv2, scope: '# S\n\n**Status:** idle\n\n```files\n```\n' });
    const r2 = spawnSync('bash', [lint, 'topen'], { encoding: 'utf8' });
    assert.equal(r2.status, 1);
    assert.match(r2.stdout, /open row\(s\) without the §11 contract/);
  });

  it('whitespace-variant rows still parse (unified row contract)', () => {
    const inv = `# INV\n\n|  1  |  1.1  |  v1.1  |  [x]  |  spaced row  |\n\n${CONTRACT('1.1')}`;
    silo('tspace', { inventory: inv, scope: '# S\n\n**Status:** idle\n\n```files\n```\n' });
    const r = spawnSync('bash', [lint, 'tspace'], { encoding: 'utf8' });
    assert.match(r.stdout, /1 row\(s\) in the load-bearing format/);
  });

  it('scope hygiene: bloated open allow-list FAILs; closed blocks do not count', () => {
    const many = Array.from({ length: 90 }, (_, i) => `lib/f${i}.mjs`).join('\n');
    const scope = `# S\n\n**Status:** active\n**Set at:** 2026-07-04\n**Expires:** no-expiry\n\n\`\`\`files big\n${many}\n\`\`\`\n`;
    const inv = `# INV\n\n${ROW('1.1', 'x', 'done')}\n\n${CONTRACT('1.1')}`;
    silo('tbloat', { inventory: inv, scope });
    const r = spawnSync('bash', [lint, 'tbloat'], { encoding: 'utf8' });
    assert.match(r.stdout, /scope hygiene: 90 open allow-list entries \(>80\)/);

    const scope2 = `# S\n\n**Status:** active\n**Set at:** 2026-07-04\n**Expires:** no-expiry\n\n\`\`\`files big closed\n${many}\n\`\`\`\n\n\`\`\`files tiny\nlib/one.mjs\n\`\`\`\n`;
    silo('tpruned', { inventory: inv, scope: scope2 });
    const r2 = spawnSync('bash', [lint, 'tpruned'], { encoding: 'utf8' });
    assert.match(r2.stdout, /scope hygiene: 1 open allow-list entries/);
  });
});
