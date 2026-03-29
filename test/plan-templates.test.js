/**
 * Tests for lib/plan-templates.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadTemplate,
  listTemplates,
  validateTemplate,
  instantiateTemplate,
  substituteVars,
} = require('../lib/plan-templates');

let tmpDir;
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

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-templates-test-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── substituteVars ────────────────────────────────

console.log('\n▸ substituteVars');

test('substitutes {{context}} in strings', () => {
  assert.strictEqual(substituteVars('Design: {{context}}', 'user auth'), 'Design: user auth');
});

test('substitutes {{vars.key}} in strings', () => {
  assert.strictEqual(
    substituteVars('Deploy to {{vars.env}}', 'app', { env: 'production' }),
    'Deploy to production'
  );
});

test('substitutes recursively in objects', () => {
  const result = substituteVars({
    title: 'Fix: {{context}}',
    scope: ['{{vars.dir}}/'],
  }, 'login bug', { dir: 'src/auth' });

  assert.strictEqual(result.title, 'Fix: login bug');
  assert.deepStrictEqual(result.scope, ['src/auth/']);
});

test('leaves non-string values unchanged', () => {
  assert.strictEqual(substituteVars(42, 'ctx'), 42);
  assert.strictEqual(substituteVars(true, 'ctx'), true);
  assert.strictEqual(substituteVars(null, 'ctx'), null);
});

// ── loadTemplate ──────────────────────────────────

console.log('\n▸ loadTemplate');

test('loads template from shipped config', () => {
  const templatePath = path.join(__dirname, '..', 'config', 'plan-templates', 'team-feature.yaml');
  const template = loadTemplate(templatePath);

  assert.strictEqual(template.id, 'team-feature');
  assert.ok(template.phases.length > 0);
  assert.ok(template.phases[0].subtasks.length > 0);
});

test('loads all three shipped templates', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  for (const name of ['team-feature', 'team-bugfix', 'team-deploy']) {
    const t = loadTemplate(path.join(dir, `${name}.yaml`));
    assert.strictEqual(t.id, name);
  }
});

// ── listTemplates ─────────────────────────────────

console.log('\n▸ listTemplates');

test('lists templates from directory', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  const templates = listTemplates(dir);

  assert.ok(templates.length >= 3);
  assert.ok(templates.some(t => t.id === 'team-feature'));
  assert.ok(templates.some(t => t.id === 'team-bugfix'));
  assert.ok(templates.some(t => t.id === 'team-deploy'));
});

test('returns empty for missing directory', () => {
  assert.deepStrictEqual(listTemplates('/nonexistent'), []);
});

// ── validateTemplate ──────────────────────────────

console.log('\n▸ validateTemplate');

test('validates shipped templates', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  for (const name of ['team-feature', 'team-bugfix', 'team-deploy']) {
    const t = loadTemplate(path.join(dir, `${name}.yaml`));
    const result = validateTemplate(t);
    assert.ok(result.valid, `${name}: ${result.errors.join(', ')}`);
  }
});

test('detects missing template id', () => {
  const result = validateTemplate({ phases: [{ subtasks: [{ id: 'a' }] }] });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Missing template id')));
});

test('detects duplicate subtask ids', () => {
  const result = validateTemplate({
    id: 'test',
    phases: [
      { subtasks: [{ id: 'a' }, { id: 'a' }] },
    ],
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Duplicate')));
});

test('detects unknown dependency', () => {
  const result = validateTemplate({
    id: 'test',
    phases: [
      { subtasks: [{ id: 'a', depends_on: ['nonexistent'] }] },
    ],
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('unknown subtask')));
});

test('detects circular dependency', () => {
  const result = validateTemplate({
    id: 'test',
    phases: [
      { subtasks: [
        { id: 'a', depends_on: ['b'] },
        { id: 'b', depends_on: ['a'] },
      ]},
    ],
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Circular')));
});

test('detects invalid delegation mode', () => {
  const result = validateTemplate({
    id: 'test',
    phases: [
      { subtasks: [{ id: 'a', delegation: { mode: 'invalid_mode' } }] },
    ],
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('invalid delegation mode')));
});

// ── instantiateTemplate ───────────────────────────

console.log('\n▸ instantiateTemplate');

test('instantiates team-feature with context', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
  const plan = instantiateTemplate(template, 'Add user authentication', {
    parent_task_id: 'T-001',
  });

  assert.ok(plan.plan_id);
  assert.strictEqual(plan.parent_task_id, 'T-001');
  assert.ok(plan.title.includes('user authentication'));
  assert.ok(plan.subtasks.length === 5); // design, architecture, implement, test, review
  assert.strictEqual(plan.failure_policy, 'abort_on_critical_fail');
  assert.strictEqual(plan.status, 'draft');

  // Check dependency wiring
  const arch = plan.subtasks.find(s => s.subtask_id === 'architecture');
  assert.ok(arch.depends_on.includes('design'));

  // Check wave computation
  const design = plan.subtasks.find(s => s.subtask_id === 'design');
  assert.strictEqual(design.wave, 0);
  assert.strictEqual(arch.wave, 1);
});

test('instantiates with variable substitution', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  const template = loadTemplate(path.join(dir, 'team-bugfix.yaml'));
  const plan = instantiateTemplate(template, 'Login redirect loop');

  assert.ok(plan.title.includes('Login redirect loop'));
  assert.ok(plan.subtasks[0].title.includes('Login redirect loop'));
});

test('auto-routes subtasks with mode: auto', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
  const plan = instantiateTemplate(template, 'test feature');

  const impl = plan.subtasks.find(s => s.subtask_id === 'implement');
  assert.ok(impl.delegation.mode !== 'auto', 'auto should be resolved by autoRoutePlan');
});

test('marks critical subtasks', () => {
  const dir = path.join(__dirname, '..', 'config', 'plan-templates');
  const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
  const plan = instantiateTemplate(template, 'test');

  const design = plan.subtasks.find(s => s.subtask_id === 'design');
  const impl = plan.subtasks.find(s => s.subtask_id === 'implement');
  assert.strictEqual(design.critical, true);
  assert.strictEqual(impl.critical, false);
});

// ── Summary ───────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
