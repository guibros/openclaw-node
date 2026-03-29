/**
 * Tests for lib/mesh-harness.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  loadHarnessRules,
  rulesByEnforcement,
  postExecutionScan,
  scanOutputForBlocks,
  formatHarnessForPrompt,
  runMeshHarness,
} = require('../lib/mesh-harness');

// ── loadHarnessRules ─────────────────────────────

describe('loadHarnessRules', () => {
  it('loads mesh-scoped rules from shipped config', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(rules.length > 0, 'Expected at least one mesh rule');
    for (const r of rules) {
      assert.ok(r.scope.includes('mesh'), `Rule ${r.id} should have mesh scope`);
    }
  });

  it('loads local-scoped rules', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    assert.ok(rules.length > 0, 'Expected at least one local rule');
    for (const r of rules) {
      assert.ok(r.scope.includes('local'), `Rule ${r.id} should have local scope`);
    }
  });

  it('local includes session-boot-context, mesh does not', () => {
    const local = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(local.some(r => r.id === 'session-boot-context'), 'Local should have session-boot-context');
    assert.ok(!mesh.some(r => r.id === 'session-boot-context'), 'Mesh should NOT have session-boot-context');
  });

  it('mesh includes scope-enforcement, local does not', () => {
    const local = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(mesh.some(r => r.id === 'scope-enforcement'), 'Mesh should have scope-enforcement');
    assert.ok(!local.some(r => r.id === 'scope-enforcement'), 'Local should NOT have scope-enforcement');
  });

  it('excludes inactive rules', () => {
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(!mesh.some(r => r.id === 'block-sudo-in-scripts'), 'Inactive rule should be excluded');
  });

  it('returns empty for missing file', () => {
    const rules = loadHarnessRules('/nonexistent/path.json', 'mesh');
    assert.deepStrictEqual(rules, []);
  });
});

// ── rulesByEnforcement ───────────────────────────

describe('rulesByEnforcement', () => {
  it('filters rules by enforcement type', () => {
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const scopeRules = rulesByEnforcement(mesh, 'scope_check');
    assert.ok(scopeRules.length > 0, 'Should have scope_check rules');
    assert.ok(scopeRules.every(r => r.mesh_enforcement === 'scope_check'));

    const blockRules = rulesByEnforcement(mesh, 'output_block');
    assert.ok(blockRules.length > 0, 'Should have output_block rules');
  });
});

// ── postExecutionScan ────────────────────────────

describe('postExecutionScan', () => {
  it('detects error patterns in output', () => {
    const output = 'line 1\nError: something failed\nline 3\nFAIL tests\nline 5';
    const patterns = ['error:', 'Error:', 'FAIL'];
    const result = postExecutionScan(output, patterns);
    assert.ok(result.suspicious, 'Should be suspicious');
    assert.ok(result.matches.length >= 2, 'Should match at least 2 lines');
  });

  it('not suspicious for clean output', () => {
    const output = 'Building...\nDone in 2.3s\nAll good';
    const patterns = ['error:', 'Error:', 'FAIL'];
    const result = postExecutionScan(output, patterns);
    assert.ok(!result.suspicious, 'Should not be suspicious');
    assert.strictEqual(result.matches.length, 0);
  });

  it('handles null/empty inputs', () => {
    assert.deepStrictEqual(postExecutionScan(null, []).suspicious, false);
    assert.deepStrictEqual(postExecutionScan('', ['error']).suspicious, false);
    assert.deepStrictEqual(postExecutionScan('error here', null).suspicious, false);
  });
});

// ── scanOutputForBlocks ──────────────────────────

describe('scanOutputForBlocks', () => {
  it('detects rm -rf in output', () => {
    const rules = [{
      id: 'block-rm-rf',
      pattern: 'rm\\s+-rf\\s+[^{]',
      active: true,
    }];
    const output = 'Running cleanup...\nrm -rf /tmp/old\nDone';
    const result = scanOutputForBlocks(output, rules);
    assert.ok(result.blocked, 'Should be blocked');
    assert.strictEqual(result.violations[0].ruleId, 'block-rm-rf');
  });

  it('passes clean output', () => {
    const rules = [{
      id: 'block-rm-rf',
      pattern: 'rm\\s+-rf\\s+[^{]',
      active: true,
    }];
    const result = scanOutputForBlocks('npm test\nAll passed', rules);
    assert.ok(!result.blocked, 'Should not be blocked');
  });
});

// ── formatHarnessForPrompt ───────────────────────

describe('formatHarnessForPrompt', () => {
  it('formats inject rules into prompt text', () => {
    const rules = [
      { id: 'r1', type: 'inject', content: 'RULE: do X' },
      { id: 'r2', type: 'inject', content: 'RULE: do Y' },
      { id: 'r3', type: 'enforce', content: 'mechanical only' }, // should be excluded
    ];
    const output = formatHarnessForPrompt(rules);
    assert.ok(output.includes('## Harness Rules'), 'Should have header');
    assert.ok(output.includes('RULE: do X'), 'Should include r1');
    assert.ok(output.includes('RULE: do Y'), 'Should include r2');
    assert.ok(!output.includes('mechanical only'), 'Should exclude enforce type');
  });

  it('returns empty for no inject rules', () => {
    const output = formatHarnessForPrompt([{ id: 'x', type: 'enforce', content: 'y' }]);
    assert.strictEqual(output, '');
  });
});

// ── runMeshHarness (composite) ───────────────────

describe('runMeshHarness', () => {
  it('passes with clean state', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null, // no worktree = skip scope check
      taskScope: [],
      llmOutput: 'All good\nDone',
      hasMetric: true,
      log: () => {},
    });
    assert.ok(result.pass, 'Should pass with clean output and metric');
    assert.strictEqual(result.violations.length, 0);
  });

  it('warns on metric-less completion', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null,
      taskScope: [],
      llmOutput: 'Done',
      hasMetric: false,
      log: () => {},
    });
    assert.ok(result.warnings.some(w => w.rule === 'build-before-done'),
      'Should warn about missing metric');
  });

  it('detects output block violations', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null,
      taskScope: [],
      llmOutput: 'Cleaning up...\nrm -rf /var/data\nDone',
      hasMetric: true,
      log: () => {},
    });
    assert.ok(!result.pass, 'Should fail on rm -rf');
    assert.ok(result.violations.some(v => v.rule === 'block-rm-rf'));
  });
});
