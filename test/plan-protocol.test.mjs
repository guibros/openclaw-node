import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// plan-lint derives its repo root from its own location, so its suite builds a
// disposable fake repo and copies the script under test into it.
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

  function silo(id, { inventory, audits = true }) {
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
    if (audits) fs.mkdirSync(path.join(plan, 'audits'), { recursive: true });
    for (const d of CANON_DOCS) fs.copyFileSync(path.join(root, 'memory-plan', 'canonical', d), path.join(plan, d));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.1\n');
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

  it('a silo without audits/ lints to the summary line; closed steps WARN on the missing dir', () => {
    const inv = `# INV\n\n${ROW('1.1', ' ', 'open')}\n\n${CONTRACT('1.1')}`;
    silo('tnoaudits', { inventory: inv, audits: false });
    const r = spawnSync('bash', [lint, 'tnoaudits'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[PASS\] steps +audit coverage: 0 PRE \/ 0 POST for 0 closed step\(s\)/);
    assert.match(r.stdout, /^summary: .* → CONFORMANT$/m);

    const inv2 = `# INV\n\n${ROW('1.1', 'x', 'done')}\n\n${CONTRACT('1.1')}`;
    silo('tnoaudits-closed', { inventory: inv2, audits: false });
    const r2 = spawnSync('bash', [lint, 'tnoaudits-closed'], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /\[WARN\] steps +audit coverage: no audits\/ dir for 1 closed step\(s\)/);
    assert.match(r2.stdout, /^summary: .* → CONFORMANT$/m);
  });

});

describe('plan-tick conformance gate — fails closed when plan-lint never reaches its verdict', () => {
  const ID = 'tgate';
  let root, plan, env, claudeLog;

  function lintStub(body) {
    const p = path.join(root, 'workspace-bin', 'plan-lint.sh');
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  }
  const tick = (...args) =>
    spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), ID, ...args], { encoding: 'utf8', env });
  const blocked = () => fs.existsSync(path.join(plan, 'BLOCKED.md'));
  const block = () => fs.readFileSync(path.join(plan, 'BLOCKED.md'), 'utf8');
  const claudeRan = () => fs.existsSync(claudeLog);

  before(() => {
    root = path.join(tmp, 'tickrepo');
    plan = path.join(root, 'memory-plan', 'plans', ID);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);

    const bin = path.join(tmp, 'tickbin');
    fs.mkdirSync(bin);
    claudeLog = path.join(tmp, 'claude-invocations');
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ncat >/dev/null\necho "$*" >> '${claudeLog}'\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    const home = path.join(tmp, 'tickhome');
    fs.mkdirSync(home);
    // Not process.env: the close gate runs this suite inside a real tick, whose
    // WORKPLAN_AUTOPAUSE=1 + WORKPLAN_PLIST_LABEL would let a blocked test tick
    // launchctl-disable the live chain; DRY_RUN or WORKPLAN_LINT_GATE=0 would skip the gate.
    env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp };
  });

  beforeEach(() => {
    fs.rmSync(path.join(plan, 'BLOCKED.md'), { force: true });
    fs.rmSync(claudeLog, { force: true });
  });

  it('a lint that exits 1 before its summary line blocks the tick; claude never runs', () => {
    lintStub([
      'echo "plan-lint: tgate"',
      'echo "  [PASS] master-plan  DECISIONS.md has entries"',
      'echo "  [PASS] steps        INVENTORY.md: 1 row(s) in the load-bearing format"',
      'exit 1',
    ].join('\n'));
    const r = tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(claudeRan(), false, 'claude was invoked on a silo plan-lint never finished grading');
    assert.match(r.stdout, /skip: plan-lint did not finish \(exit 1, no verdict\)/);
    const b = block();
    assert.match(b, /^\*\*Trigger\*\*: plan-lint did not finish \(exit 1, no verdict\)/m);
    assert.match(b, /\[PASS\] steps +INVENTORY\.md: 1 row\(s\)/, 'the raw partial output rides in the block');
    assert.match(b, /^\*\*External action:\*\* .*stops before its `summary:` line/m);
    assert.doesNotMatch(b, /NONCONFORMANT|FAIL/, 'the block claims FAILs the lint never reported');
  });

  it('an exit code outside 0/1 blocks even after a summary line', () => {
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\nexit 2');
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 2, no verdict\)/m);
  });

  it('a CONFORMANT summary opens the gate only as the last line of an exit-0 run', () => {
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\nexit 1');
    tick();
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 1, no verdict\)/m);

    fs.rmSync(path.join(plan, 'BLOCKED.md'));
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\necho "plan-lint: output after the verdict"');
    tick();
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 0, no verdict\)/m);
    assert.equal(claudeRan(), false);
  });

  it('a plan-lint that cannot run blocks the tick too', () => {
    fs.rmSync(path.join(root, 'workspace-bin', 'plan-lint.sh'));
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 127, no verdict\)/m);
  });

  it('a NONCONFORMANT verdict still blocks as FAILs', () => {
    lintStub('echo "  [FAIL] history      tick-logs/ missing"\necho "summary: 0 PASS · 0 WARN · 1 FAIL → NONCONFORMANT"\nexit 1');
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint NONCONFORMANT — the tick refused to drive a silo with FAILs$/m);
  });

  it('a CONFORMANT summary lets the tick through to claude', () => {
    lintStub('echo "  [PASS] block        no BLOCKED.md — chain runnable"\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"');
    const r = tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(blocked(), false, blocked() ? block() : '');
    assert.equal(claudeRan(), true, r.stdout + r.stderr);
  });

  it('--preflight names an unfinished lint instead of logging an empty line', () => {
    lintStub('exit 1');
    const r = tick('--preflight');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[tgate\] conformance: tgate plan-lint did not finish \(exit 1, no verdict\)$/m);
    assert.doesNotMatch(r.stdout, /\[tgate\] $/m);

    lintStub('echo "conformance: tgate 9P/0W/0F → CONFORMANT"');
    assert.match(tick('--preflight').stdout, /\[tgate\] conformance: tgate 9P\/0W\/0F → CONFORMANT$/m);
  });
});
