/**
 * role-loader.js — Load, validate, and format role profiles for mesh tasks.
 *
 * Role profiles define:
 *   - responsibilities: what the agent SHOULD do (prompt injection)
 *   - must_not: what the agent must NOT do (prompt + post-validation)
 *   - framework: structured thinking scaffold (prompt injection)
 *   - required_outputs: post-completion structural validation
 *   - forbidden_patterns: post-completion negative validation
 *   - scope_paths: default scope if task doesn't specify one
 *   - escalation: failure routing map
 *
 * Roles live in config/roles/*.yaml (shipped) and ~/.openclaw/roles/ (user).
 * Uses js-yaml for parsing (already a dependency via plan-templates).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createTracer } = require('./tracer');
const tracer = createTracer('role-loader');

// ── Role Loading ─────────────────────────────────────

/**
 * Load a single role profile from a YAML file.
 */
function loadRole(rolePath) {
  const content = fs.readFileSync(rolePath, 'utf-8');
  const role = yaml.load(content);
  if (!role.id) role.id = path.basename(rolePath, '.yaml');
  return role;
}

/**
 * Find and load a role by ID, searching user dir first then shipped config.
 * @param {string} roleId — e.g. "solidity-dev"
 * @param {string[]} searchDirs — directories to search (first match wins)
 * @returns {object|null} — role profile or null if not found
 */
function findRole(roleId, searchDirs) {
  for (const dir of searchDirs) {
    for (const ext of ['.yaml', '.yml']) {
      const candidate = path.join(dir, `${roleId}${ext}`);
      if (fs.existsSync(candidate)) {
        try {
          const role = loadRole(candidate);
          tracer.log('info', `Found role ${roleId} at ${candidate}`);
          return role;
        } catch (err) {
          tracer.log('error', `Failed to load ${candidate}: ${err.message}`);
        }
      }
    }
  }
  tracer.log('info', `Role not found: ${roleId}`);
  return null;
}

/**
 * List all available roles across search directories.
 * @returns {Array<{id, name, description, file}>}
 */
function listRoles(searchDirs) {
  const seen = new Set();
  const roles = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      try {
        const role = loadRole(path.join(dir, file));
        if (!seen.has(role.id)) {
          seen.add(role.id);
          roles.push({
            id: role.id,
            name: role.name || role.id,
            description: role.description || '',
            file,
          });
        }
      } catch (err) { tracer.log('warn', `skipping malformed role ${file}: ${err.message}`); }
    }
  }

  return roles;
}

// ── Role Validation ──────────────────────────────────

/**
 * Validate a role profile for structural correctness.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRole(role) {
  const errors = [];
  if (!role.id) errors.push('Missing role id');
  if (role.responsibilities && !Array.isArray(role.responsibilities)) {
    errors.push('responsibilities must be an array');
  }
  if (role.must_not && !Array.isArray(role.must_not)) {
    errors.push('must_not must be an array');
  }
  if (role.required_outputs && !Array.isArray(role.required_outputs)) {
    errors.push('required_outputs must be an array');
  }
  if (role.forbidden_patterns && !Array.isArray(role.forbidden_patterns)) {
    errors.push('forbidden_patterns must be an array');
  }
  if (role.escalation && typeof role.escalation !== 'object') {
    errors.push('escalation must be an object');
  }
  tracer.log('info', `validateRole: ${errors.length === 0 ? 'PASS' : errors.length + ' issues'}`);
  return { valid: errors.length === 0, errors };
}

// ── Prompt Formatting ────────────────────────────────

/**
 * Format a role profile into markdown for prompt injection.
 * Injected between Scope and Instructions in the agent prompt.
 * LLM-agnostic: standard markdown that any LLM can consume.
 */
function formatRoleForPrompt(role) {
  if (!role) return '';
  const parts = [];

  parts.push(`## Role: ${role.name || role.id}`);
  parts.push('');

  if (role.responsibilities && role.responsibilities.length > 0) {
    parts.push('### Responsibilities');
    for (const r of role.responsibilities) {
      parts.push(`- ${r}`);
    }
    parts.push('');
  }

  if (role.must_not && role.must_not.length > 0) {
    parts.push('### Boundaries (Must NOT Do)');
    for (const m of role.must_not) {
      parts.push(`- ❌ ${m}`);
    }
    parts.push('');
  }

  if (role.framework) {
    parts.push(`### Framework: ${role.framework.name}`);
    parts.push(role.framework.prompt);
    parts.push('');
  }

  return parts.join('\n');
}

// ── Post-Completion Validation ───────────────────────

/**
 * Validate task output against role's required_outputs.
 * @param {object} role — role profile
 * @param {string[]} outputFiles — files created/modified by the task
 * @param {string} worktreePath — path to task worktree
 * @returns {{ passed: boolean, failures: Array<{type, description, detail}> }}
 */
function validateRequiredOutputs(role, outputFiles, worktreePath) {
  if (!role || !role.required_outputs) return { passed: true, failures: [] };

  const failures = [];

  for (const req of role.required_outputs) {
    if (req.type === 'file_match') {
      // Check if any output file matches the pattern
      const { globMatch } = require('./rule-loader');
      const matched = outputFiles.some(f => globMatch(req.pattern, f));
      if (!matched) {
        failures.push({
          type: 'file_match',
          description: req.description,
          detail: `No output file matches pattern: ${req.pattern}`,
        });
      }
    } else if (req.type === 'content_check') {
      // Check if files matching pattern contain required content
      const { globMatch } = require('./rule-loader');
      const matchingFiles = outputFiles.filter(f => globMatch(req.pattern, f));
      if (matchingFiles.length > 0 && worktreePath) {
        let found = false;
        for (const file of matchingFiles) {
          try {
            const content = fs.readFileSync(path.join(worktreePath, file), 'utf-8');
            if (content.includes(req.check)) {
              found = true;
              break;
            }
          } catch (err) { tracer.log('warn', `content check read failed for ${file}: ${err.message}`); }
        }
        if (!found) {
          failures.push({
            type: 'content_check',
            description: req.description,
            detail: `Required content "${req.check}" not found in ${req.pattern} files`,
          });
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Check output against role's forbidden_patterns.
 * @param {object} role — role profile
 * @param {string[]} outputFiles — files created/modified
 * @param {string} worktreePath — path to task worktree
 * @returns {{ passed: boolean, violations: Array<{pattern, in, description, file, match}> }}
 */
function checkForbiddenPatterns(role, outputFiles, worktreePath) {
  if (!role || !role.forbidden_patterns) return { passed: true, violations: [] };

  const { globMatch } = require('./rule-loader');
  const violations = [];

  for (const fp of role.forbidden_patterns) {
    const regex = new RegExp(fp.pattern, 'gm');
    const scopeFiles = fp.in
      ? outputFiles.filter(f => globMatch(fp.in, f))
      : outputFiles;

    for (const file of scopeFiles) {
      if (!worktreePath) continue;
      try {
        const content = fs.readFileSync(path.join(worktreePath, file), 'utf-8');
        const matches = content.match(regex);
        if (matches) {
          violations.push({
            pattern: fp.pattern,
            in: fp.in,
            description: fp.description,
            file,
            match: matches[0].slice(0, 100),
          });
        }
      } catch (err) { tracer.log('warn', `forbidden pattern check failed for ${file}: ${err.message}`); }
    }
  }

  return { passed: violations.length === 0, violations };
}

/**
 * Find the best-matching role for a set of task scope paths.
 * Matches scope paths against each role's scope_paths field.
 * Returns the role with the most scope path matches, or null.
 */
function findRoleByScope(scopePaths, searchDirs) {
  if (!scopePaths || scopePaths.length === 0) return null;

  const { globMatch } = require('./rule-loader');
  const allRoles = listRoles(searchDirs);
  let bestRole = null;
  let bestScore = 0;

  for (const roleSummary of allRoles) {
    const role = findRole(roleSummary.id, searchDirs);
    if (!role || !role.scope_paths) continue;

    // Score: how many of the task's scope paths match this role's scope_paths?
    let score = 0;
    for (const taskPath of scopePaths) {
      for (const rolePattern of role.scope_paths) {
        if (globMatch(rolePattern, taskPath)) {
          score++;
          break; // one match per task path is enough
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestRole;
}

module.exports = {
  loadRole: tracer.wrap('loadRole', loadRole, { tier: 2 }),
  findRole: tracer.wrap('findRole', findRole, { tier: 2 }),
  findRoleByScope: tracer.wrap('findRoleByScope', findRoleByScope, { tier: 2, category: 'compute' }),
  listRoles: tracer.wrap('listRoles', listRoles, { tier: 2 }),
  validateRole: tracer.wrap('validateRole', validateRole, { tier: 2 }),
  formatRoleForPrompt: tracer.wrap('formatRoleForPrompt', formatRoleForPrompt, { tier: 2 }),
  validateRequiredOutputs: tracer.wrap('validateRequiredOutputs', validateRequiredOutputs, { tier: 2, category: 'compute' }),
  checkForbiddenPatterns: tracer.wrap('checkForbiddenPatterns', checkForbiddenPatterns, { tier: 2 }),
};
