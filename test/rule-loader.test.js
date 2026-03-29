/**
 * Tests for lib/rule-loader.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadAllRules,
  matchRules,
  formatRulesForPrompt,
  detectFrameworks,
  activateFrameworkRules,
  globMatch,
  parseFrontmatter,
  MAX_RULES_CHARS,
} = require('../lib/rule-loader');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-loader-test-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeRule(filename, content) {
  fs.writeFileSync(path.join(tmpDir, filename), content);
}

// ── Frontmatter Parser ────────────────────────────

describe('parseFrontmatter', () => {
  it('parses basic frontmatter', () => {
    const { data, body } = parseFrontmatter(`---
id: test-rule
tier: universal
paths: ["**/*"]
priority: 100
---
# Body content`);

    assert.strictEqual(data.id, 'test-rule');
    assert.strictEqual(data.tier, 'universal');
    assert.deepStrictEqual(data.paths, ['**/*']);
    assert.strictEqual(data.priority, 100);
    assert.ok(body.includes('# Body content'));
  });

  it('parses null and boolean values', () => {
    const { data } = parseFrontmatter(`---
detect: null
active: true
disabled: false
---
body`);

    assert.strictEqual(data.detect, null);
    assert.strictEqual(data.active, true);
    assert.strictEqual(data.disabled, false);
  });

  it('parses block arrays', () => {
    const { data } = parseFrontmatter(`---
paths:
  - "contracts/**"
  - "**/*.sol"
---
body`);

    assert.deepStrictEqual(data.paths, ['contracts/**', '**/*.sol']);
  });

  it('returns empty data for no frontmatter', () => {
    const { data, body } = parseFrontmatter('# Just a markdown file');
    assert.deepStrictEqual(data, {});
    assert.ok(body.includes('# Just a markdown file'));
  });
});

// ── Glob Matching ─────────────────────────────────

describe('globMatch', () => {
  it('matches simple wildcard', () => {
    assert.ok(globMatch('*.js', 'index.js'));
    assert.ok(!globMatch('*.js', 'src/index.js'));
  });

  it('matches double star', () => {
    assert.ok(globMatch('**/*.js', 'src/index.js'));
    assert.ok(globMatch('**/*.js', 'a/b/c/index.js'));
    assert.ok(globMatch('**/*.js', 'index.js'));
  });

  it('matches path prefix with double star', () => {
    assert.ok(globMatch('contracts/**', 'contracts/Token.sol'));
    assert.ok(globMatch('contracts/**', 'contracts/a/b/Token.sol'));
    assert.ok(!globMatch('contracts/**', 'src/contracts/Token.sol'));
  });

  it('matches brace alternatives', () => {
    assert.ok(globMatch('**/*.{ts,tsx}', 'src/App.tsx'));
    assert.ok(globMatch('**/*.{ts,tsx}', 'src/App.ts'));
    assert.ok(!globMatch('**/*.{ts,tsx}', 'src/App.js'));
  });

  it('matches question mark', () => {
    assert.ok(globMatch('?.js', 'a.js'));
    assert.ok(!globMatch('?.js', 'ab.js'));
  });
});

// ── loadAllRules ──────────────────────────────────

describe('loadAllRules', () => {
  it('loads rules from directory', () => {
    setup();
    writeRule('security.md', `---
id: security
tier: universal
paths: ["**/*"]
priority: 100
---
# Security
- No secrets`);

    writeRule('solidity.md', `---
id: solidity
tier: framework
paths: ["contracts/**"]
priority: 80
detect: ["hardhat.config.js"]
---
# Solidity
- Reentrancy guards`);

    const rules = loadAllRules(tmpDir);
    assert.strictEqual(rules.length, 2);

    const sec = rules.find(r => r.id === 'security');
    assert.strictEqual(sec.tier, 'universal');
    assert.strictEqual(sec.priority, 100);
    assert.deepStrictEqual(sec.paths, ['**/*']);

    const sol = rules.find(r => r.id === 'solidity');
    assert.strictEqual(sol.tier, 'framework');
    assert.deepStrictEqual(sol.detect, ['hardhat.config.js']);

    teardown();
  });

  it('returns empty array for missing directory', () => {
    const rules = loadAllRules('/nonexistent/path');
    assert.deepStrictEqual(rules, []);
  });

  it('skips non-md files', () => {
    setup();
    writeRule('security.md', `---\nid: security\ntier: universal\npaths: ["**/*"]\n---\n# Sec`);
    writeRule('readme.txt', 'not a rule');
    const rules = loadAllRules(tmpDir);
    assert.strictEqual(rules.length, 1);
    teardown();
  });
});

// ── matchRules ────────────────────────────────────

describe('matchRules', () => {
  it('matches rules by scope paths', () => {
    const rules = [
      { id: 'security', tier: 'universal', paths: ['**/*'], priority: 100, body: 'sec' },
      { id: 'solidity', tier: 'framework', paths: ['contracts/**'], priority: 80, body: 'sol' },
      { id: 'typescript', tier: 'framework', paths: ['**/*.ts'], priority: 70, body: 'ts' },
    ];

    const matched = matchRules(rules, ['contracts/Token.sol']);
    assert.strictEqual(matched.length, 2); // security + solidity
    assert.ok(matched.some(r => r.id === 'security'));
    assert.ok(matched.some(r => r.id === 'solidity'));
  });

  it('returns empty for no scope paths', () => {
    const rules = [{ id: 'x', tier: 'universal', paths: ['**/*'], priority: 50 }];
    assert.deepStrictEqual(matchRules(rules, []), []);
    assert.deepStrictEqual(matchRules(rules, null), []);
  });

  it('sorts by tier precedence then priority', () => {
    const rules = [
      { id: 'universal-low', tier: 'universal', paths: ['**/*'], priority: 10, body: '' },
      { id: 'project-high', tier: 'project', paths: ['**/*'], priority: 90, body: '' },
      { id: 'framework-mid', tier: 'framework', paths: ['**/*'], priority: 50, body: '' },
      { id: 'universal-high', tier: 'universal', paths: ['**/*'], priority: 90, body: '' },
    ];

    const matched = matchRules(rules, ['src/index.js']);
    assert.strictEqual(matched[0].id, 'project-high');     // project tier first
    assert.strictEqual(matched[1].id, 'framework-mid');     // framework tier second
    // universals sorted by priority
    assert.strictEqual(matched[2].id, 'universal-high');
    assert.strictEqual(matched[3].id, 'universal-low');
  });
});

// ── formatRulesForPrompt ──────────────────────────

describe('formatRulesForPrompt', () => {
  it('formats rules into markdown', () => {
    const rules = [
      { id: 'security', tier: 'universal', body: '- No secrets\n- Validate input' },
      { id: 'solidity', tier: 'framework', body: '- Reentrancy guards' },
    ];

    const output = formatRulesForPrompt(rules);
    assert.ok(output.includes('## Coding Standards'));
    assert.ok(output.includes('### security (universal)'));
    assert.ok(output.includes('### solidity (framework)'));
    assert.ok(output.includes('- No secrets'));
  });

  it('returns empty string for no rules', () => {
    assert.strictEqual(formatRulesForPrompt([]), '');
    assert.strictEqual(formatRulesForPrompt(null), '');
  });

  it('truncates at MAX_RULES_CHARS', () => {
    const longBody = 'x'.repeat(MAX_RULES_CHARS);
    const rules = [
      { id: 'long', tier: 'universal', body: longBody },
      { id: 'short', tier: 'universal', body: 'hello' },
    ];

    const output = formatRulesForPrompt(rules);
    assert.ok(output.includes('truncated'));
    assert.ok(!output.includes('### short'));
  });
});

// ── detectFrameworks ──────────────────────────────

describe('detectFrameworks', () => {
  it('detects from package.json deps', () => {
    setup();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { hardhat: '^2.0.0' },
      devDependencies: { react: '^18.0.0' },
    }));

    const detected = detectFrameworks(tmpDir);
    assert.ok(detected.includes('solidity'));
    assert.ok(detected.includes('react'));
    teardown();
  });

  it('detects from config files', () => {
    setup();
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'foundry.toml'), '');

    const detected = detectFrameworks(tmpDir);
    assert.ok(detected.includes('typescript'));
    assert.ok(detected.includes('solidity'));
    teardown();
  });

  it('detects from directories', () => {
    setup();
    fs.mkdirSync(path.join(tmpDir, 'ProjectSettings'));

    const detected = detectFrameworks(tmpDir);
    assert.ok(detected.includes('unity'));
    teardown();
  });

  it('returns empty for empty directory', () => {
    setup();
    const detected = detectFrameworks(tmpDir);
    assert.deepStrictEqual(detected, []);
    teardown();
  });
});

// ── activateFrameworkRules ────────────────────────

describe('activateFrameworkRules', () => {
  it('filters framework rules by detected frameworks', () => {
    const rules = [
      { id: 'security', tier: 'universal', detect: null },
      { id: 'solidity', tier: 'framework', detect: ['hardhat.config.js'] },
      { id: 'unity', tier: 'framework', detect: ['ProjectSettings/ProjectVersion.txt'] },
    ];

    const active = activateFrameworkRules(rules, ['solidity', 'typescript']);
    assert.strictEqual(active.length, 2); // security + solidity (not unity)
    assert.ok(active.some(r => r.id === 'security'));
    assert.ok(active.some(r => r.id === 'solidity'));
  });

  it('passes through non-framework rules', () => {
    const rules = [
      { id: 'project-custom', tier: 'project', detect: null },
    ];
    const active = activateFrameworkRules(rules, []);
    assert.strictEqual(active.length, 1);
  });
});
