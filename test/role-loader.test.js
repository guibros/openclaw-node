/**
 * Tests for lib/role-loader.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadRole,
  findRole,
  listRoles,
  validateRole,
  formatRoleForPrompt,
  validateRequiredOutputs,
  checkForbiddenPatterns,
} = require('../lib/role-loader');

const SHIPPED_ROLES = path.join(__dirname, '..', 'config', 'roles');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ── loadRole ─────────────────────────────────────

console.log('\n▸ loadRole');

test('loads solidity-dev role', () => {
  const role = loadRole(path.join(SHIPPED_ROLES, 'solidity-dev.yaml'));
  assert.strictEqual(role.id, 'solidity-dev');
  assert.ok(role.responsibilities.length >= 5, 'Should have 5+ responsibilities');
  assert.ok(role.must_not.length >= 3, 'Should have 3+ must_not items');
  assert.ok(role.framework, 'Should have framework');
  assert.ok(role.required_outputs, 'Should have required_outputs');
  assert.ok(role.forbidden_patterns, 'Should have forbidden_patterns');
  assert.ok(role.escalation, 'Should have escalation');
});

test('loads all shipped roles', () => {
  const files = fs.readdirSync(SHIPPED_ROLES).filter(f => f.endsWith('.yaml'));
  assert.ok(files.length >= 3, 'Should have at least 3 shipped roles');
  for (const file of files) {
    const role = loadRole(path.join(SHIPPED_ROLES, file));
    assert.ok(role.id, `${file} should have an id`);
  }
});

// ── findRole ─────────────────────────────────────

console.log('\n▸ findRole');

test('finds shipped role by id', () => {
  const role = findRole('solidity-dev', [SHIPPED_ROLES]);
  assert.ok(role, 'Should find solidity-dev');
  assert.strictEqual(role.id, 'solidity-dev');
});

test('returns null for unknown role', () => {
  const role = findRole('nonexistent-role', [SHIPPED_ROLES]);
  assert.strictEqual(role, null);
});

// ── listRoles ────────────────────────────────────

console.log('\n▸ listRoles');

test('lists all shipped roles', () => {
  const roles = listRoles([SHIPPED_ROLES]);
  assert.ok(roles.length >= 3);
  assert.ok(roles.some(r => r.id === 'solidity-dev'));
  assert.ok(roles.some(r => r.id === 'tech-architect'));
  assert.ok(roles.some(r => r.id === 'qa-engineer'));
});

test('returns empty for missing directory', () => {
  assert.deepStrictEqual(listRoles(['/nonexistent']), []);
});

// ── validateRole ─────────────────────────────────

console.log('\n▸ validateRole');

test('validates shipped roles', () => {
  const files = fs.readdirSync(SHIPPED_ROLES).filter(f => f.endsWith('.yaml'));
  for (const file of files) {
    const role = loadRole(path.join(SHIPPED_ROLES, file));
    const result = validateRole(role);
    assert.ok(result.valid, `${file} should validate: ${result.errors.join(', ')}`);
  }
});

test('detects missing id', () => {
  const result = validateRole({});
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('id')));
});

// ── formatRoleForPrompt ──────────────────────────

console.log('\n▸ formatRoleForPrompt');

test('formats role into prompt sections', () => {
  const role = loadRole(path.join(SHIPPED_ROLES, 'solidity-dev.yaml'));
  const output = formatRoleForPrompt(role);
  assert.ok(output.includes('## Role:'), 'Should have role header');
  assert.ok(output.includes('### Responsibilities'), 'Should have responsibilities');
  assert.ok(output.includes('### Boundaries'), 'Should have boundaries');
  assert.ok(output.includes('### Framework:'), 'Should have framework');
  assert.ok(output.includes('Checks-Effects-Interactions'), 'Should include framework name');
});

test('returns empty for null role', () => {
  assert.strictEqual(formatRoleForPrompt(null), '');
});

// ── validateRequiredOutputs ──────────────────────

console.log('\n▸ validateRequiredOutputs');

test('passes when files match required patterns', () => {
  const role = { required_outputs: [{ type: 'file_match', pattern: 'test/**', description: 'tests needed' }] };
  const result = validateRequiredOutputs(role, ['test/Token.test.js', 'contracts/Token.sol'], null);
  assert.ok(result.passed);
});

test('fails when no files match', () => {
  const role = { required_outputs: [{ type: 'file_match', pattern: 'test/**', description: 'tests needed' }] };
  const result = validateRequiredOutputs(role, ['contracts/Token.sol'], null);
  assert.ok(!result.passed);
  assert.ok(result.failures[0].description.includes('tests needed'));
});

test('passes for null role', () => {
  assert.ok(validateRequiredOutputs(null, ['a.js'], null).passed);
});

// ── checkForbiddenPatterns ───────────────────────

console.log('\n▸ checkForbiddenPatterns');

test('detects forbidden pattern in output', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-test-'));
  fs.mkdirSync(path.join(tmpDir, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'contracts', 'Token.sol'), 'address owner = 0x1234567890abcdef1234567890abcdef12345678;');

  const role = {
    forbidden_patterns: [{
      pattern: '0x[a-fA-F0-9]{40}',
      in: 'contracts/**/*.sol',
      description: 'No hardcoded addresses',
    }],
  };

  const result = checkForbiddenPatterns(role, ['contracts/Token.sol'], tmpDir);
  assert.ok(!result.passed, 'Should detect hardcoded address');
  assert.ok(result.violations[0].description.includes('hardcoded'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('passes when no forbidden patterns match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-test-'));
  fs.mkdirSync(path.join(tmpDir, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'contracts', 'Token.sol'), 'contract Token { }');

  const role = {
    forbidden_patterns: [{
      pattern: '0x[a-fA-F0-9]{40}',
      in: 'contracts/**/*.sol',
      description: 'No hardcoded addresses',
    }],
  };

  const result = checkForbiddenPatterns(role, ['contracts/Token.sol'], tmpDir);
  assert.ok(result.passed);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Summary ──────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
