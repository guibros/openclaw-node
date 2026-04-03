/**
 * rule-loader.js — Load, match, and format path-scoped coding rules.
 *
 * Rules live in .openclaw/rules/ as markdown files with YAML frontmatter.
 * This module is pure Node.js with zero external dependencies — importable
 * by mesh-agent, install scripts, and any LLM adapter.
 *
 * Rule format:
 *   ---
 *   id: security
 *   tier: universal          # universal | framework | project
 *   paths: ["**\/*"]         # glob patterns for file matching
 *   detect: null             # framework auto-activation signals
 *   priority: 100            # higher wins on conflict
 *   tags: ["security"]
 *   ---
 *   # Rule body in markdown
 */

const fs = require('fs');
const path = require('path');
const { createTracer } = require('./tracer');
const tracer = createTracer('rule-loader');

// ── Tier Precedence (higher = wins) ────────────────
const TIER_WEIGHT = {
  universal: 0,
  framework: 10,
  project: 20,
};

// ── Max chars for rule injection into prompts ──────
const MAX_RULES_CHARS = 4000;

// ── Frontmatter Parser (zero-dep) ──────────────────

/**
 * Parse YAML frontmatter from a markdown file.
 * Handles: strings, arrays (inline [...] and block - items), numbers, booleans, null.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, body: content };

  const yaml = match[1];
  const body = content.slice(match[0].length).trim();
  const data = {};

  const lines = yaml.split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Block array item: "  - value"
    if (trimmed.startsWith('- ') && currentKey && currentArray) {
      currentArray.push(parseValue(trimmed.slice(2).trim()));
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
    if (!kvMatch) continue;

    // Save previous array if pending
    if (currentKey && currentArray) {
      data[currentKey] = currentArray;
      currentArray = null;
    }

    const [, key, rawVal] = kvMatch;
    currentKey = key;

    if (rawVal === '' || rawVal === undefined) {
      // Could be start of block array
      currentArray = [];
      continue;
    }

    // Inline array: ["a", "b"]
    if (rawVal.startsWith('[')) {
      try {
        data[key] = JSON.parse(rawVal);
      } catch (err) {
        console.warn(`[rule-loader] inline array JSON.parse failed for key "${key}": ${err.message}`);
        data[key] = rawVal.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      }
      currentArray = null;
      continue;
    }

    data[key] = parseValue(rawVal);
    currentArray = null;
  }

  // Flush last pending array
  if (currentKey && currentArray) {
    data[currentKey] = currentArray;
  }

  return { data, body };
}

function parseValue(val) {
  if (val === 'null' || val === '~') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  return val.replace(/^["']|["']$/g, '');
}

// ── Glob Matching (zero-dep) ───────────────────────

/**
 * Match a file path against a glob pattern.
 * Supports: *, **, ?, {a,b}
 */
function globMatch(pattern, filepath) {
  // Normalize separators
  const p = pattern.replace(/\\/g, '/');
  const f = filepath.replace(/\\/g, '/');

  // Convert glob to regex
  let regex = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // ** matches any number of path segments
        if (p[i + 2] === '/') {
          regex += '(?:.+/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regex += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if (ch === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) { regex += '\\{'; i++; continue; }
      const alts = p.slice(i + 1, end).split(',').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      regex += `(?:${alts.join('|')})`;
      i = end + 1;
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp(`^${regex}$`).test(f);
}

// ── Core API ───────────────────────────────────────

/**
 * Load all rule files from a directory.
 * Returns array of { id, tier, paths, detect, priority, tags, body, file }.
 */
function loadAllRules(rulesDir) {
  if (!fs.existsSync(rulesDir)) {
    console.log(`[rule-loader] Rules dir not found: ${rulesDir}`);
    return [];
  }

  const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  const rules = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
      const { data, body } = parseFrontmatter(content);

      rules.push({
        id: data.id || path.basename(file, '.md'),
        tier: data.tier || 'universal',
        paths: Array.isArray(data.paths) ? data.paths : ['**/*'],
        detect: data.detect || null,
        priority: parseInt(data.priority) || 50,
        tags: Array.isArray(data.tags) ? data.tags : [],
        body: body,
        file: file,
      });
    } catch (err) {
      // Skip malformed rule files silently
      console.error(`[rule-loader] Skipped ${file}: ${err.message}`);
    }
  }

  console.log(`[rule-loader] Loaded ${rules.length} rules from ${rulesDir}`);
  return rules;
}

/**
 * Match rules against a set of scope paths.
 * Returns rules sorted by: tier precedence (project > framework > universal),
 * then priority (higher first).
 */
function matchRules(rules, scopePaths) {
  if (!scopePaths || scopePaths.length === 0) return [];

  const matched = rules.filter(rule => {
    return rule.paths.some(pattern =>
      scopePaths.some(scopePath => globMatch(pattern, scopePath))
    );
  });

  // Sort: tier weight desc, then priority desc
  matched.sort((a, b) => {
    const tierDiff = (TIER_WEIGHT[b.tier] || 0) - (TIER_WEIGHT[a.tier] || 0);
    if (tierDiff !== 0) return tierDiff;
    return (b.priority || 0) - (a.priority || 0);
  });

  console.log(`[rule-loader] matchRules: ${matched.length}/${rules.length} matched for scope`);
  return matched;
}

/**
 * Format matched rules into a markdown block for prompt injection.
 * Respects MAX_RULES_CHARS to avoid bloating prompts.
 */
function formatRulesForPrompt(matchedRules) {
  if (!matchedRules || matchedRules.length === 0) return '';

  const parts = ['## Coding Standards', ''];
  let totalChars = parts[0].length;

  for (const rule of matchedRules) {
    const header = `### ${rule.id} (${rule.tier})`;
    const section = `${header}\n${rule.body}`;

    if (totalChars + section.length > MAX_RULES_CHARS) {
      parts.push(`\n_[${matchedRules.length - parts.length + 2} more rules truncated — scope narrower to see all]_`);
      break;
    }

    parts.push(section);
    parts.push('');
    totalChars += section.length;
  }

  return parts.join('\n');
}

/**
 * Detect frameworks present in a project directory.
 * Returns array of framework identifiers (e.g., ['solidity', 'typescript']).
 */
function detectFrameworks(projectDir) {
  const detected = [];

  // Check package.json dependencies
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      // Framework detection heuristics
      if (allDeps.hardhat || allDeps['@nomicfoundation/hardhat-toolbox']) detected.push('solidity');
      if (allDeps.react || allDeps['react-dom']) detected.push('react');
      if (allDeps.next) detected.push('nextjs');
      if (allDeps.vue) detected.push('vue');
      if (allDeps.express || allDeps.fastify || allDeps.koa) detected.push('node-server');
    } catch (err) { console.warn(`[rule-loader] package.json parse failed: ${err.message}`); }
  }

  // Check config files
  const configChecks = [
    ['tsconfig.json', 'typescript'],
    ['foundry.toml', 'solidity'],
    ['hardhat.config.js', 'solidity'],
    ['hardhat.config.ts', 'solidity'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'golang'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['Gemfile', 'ruby'],
  ];

  for (const [file, framework] of configChecks) {
    if (fs.existsSync(path.join(projectDir, file)) && !detected.includes(framework)) {
      detected.push(framework);
    }
  }

  // Check directories
  const dirChecks = [
    ['ProjectSettings', 'unity'],           // Unity project
    ['Assets', 'unity'],                     // Unity assets
    ['.godot', 'godot'],                     // Godot
    ['ios', 'ios'],                          // iOS project
    ['android', 'android'],                  // Android project
  ];

  for (const [dir, framework] of dirChecks) {
    if (fs.existsSync(path.join(projectDir, dir)) && !detected.includes(framework)) {
      detected.push(framework);
    }
  }

  console.log(`[rule-loader] Detected frameworks: ${detected.join(', ') || 'none'}`);
  return detected;
}

// Map config file patterns to the framework IDs that detectFrameworks() returns
const DETECT_SIGNAL_TO_FRAMEWORK = {
  'hardhat.config.js': 'solidity',
  'hardhat.config.ts': 'solidity',
  'foundry.toml': 'solidity',
  'tsconfig.json': 'typescript',
  'Cargo.toml': 'rust',
  'go.mod': 'golang',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'Gemfile': 'ruby',
  'ProjectSettings/ProjectVersion.txt': 'unity',
};

/**
 * Filter framework-tier rules to only those matching detected frameworks.
 * Rules with detect: null are always included.
 * Rules with detect: ["hardhat.config.js", "foundry.toml"] are included if
 * any detect signal resolves to a detected framework ID.
 */
function activateFrameworkRules(rules, detectedFrameworks) {
  return rules.filter(rule => {
    if (rule.tier !== 'framework') return true; // non-framework rules pass through
    if (!rule.detect) return true;              // no detect = always active

    const signals = Array.isArray(rule.detect) ? rule.detect : [rule.detect];
    return signals.some(signal => {
      // Direct framework ID match (e.g., detect: ["solidity"])
      if (detectedFrameworks.includes(signal)) return true;
      // Config file → framework ID resolution (e.g., "hardhat.config.js" → "solidity")
      const resolvedFw = DETECT_SIGNAL_TO_FRAMEWORK[signal];
      if (resolvedFw && detectedFrameworks.includes(resolvedFw)) return true;
      return false;
    });
  });
}

module.exports = {
  loadAllRules: tracer.wrap('loadAllRules', loadAllRules, { tier: 2 }),
  matchRules: tracer.wrap('matchRules', matchRules, { tier: 2 }),
  formatRulesForPrompt: tracer.wrap('formatRulesForPrompt', formatRulesForPrompt, { tier: 2 }),
  detectFrameworks: tracer.wrap('detectFrameworks', detectFrameworks, { tier: 2 }),
  activateFrameworkRules: tracer.wrap('activateFrameworkRules', activateFrameworkRules, { tier: 2 }),
  globMatch,
  parseFrontmatter,
  TIER_WEIGHT,
  MAX_RULES_CHARS,
};
