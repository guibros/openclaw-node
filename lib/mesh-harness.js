/**
 * mesh-harness.js — Mechanical enforcement layer for mesh tasks.
 *
 * Two harnesses exist:
 *   LOCAL  — prompt injection only (companion-bridge consumes these)
 *   MESH   — mechanical enforcement at pre/post execution stages
 *
 * This module implements the mesh side. Each rule has a mesh_enforcement type:
 *   - "scope_check"      → post-execution: revert files outside task.scope
 *   - "post_scan"        → post-execution: scan LLM stdout for error patterns
 *   - "post_validate"    → post-commit: run validation command
 *   - "pre_commit_scan"  → pre-commit: scan staged diff for patterns
 *   - "output_block"     → post-execution: scan output for blocked patterns
 *   - "metric_required"  → post-execution: flag metric-less completions
 *   - "pre_check"        → pre-execution: verify service health
 *
 * All enforcement is LLM-agnostic — it operates on filesystem state and
 * process output, not on prompt compliance.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { globMatch } = require('./rule-loader');
const { validateExecCommand } = require('./exec-safety');

// ── Rule Loading ─────────────────────────────────────

/**
 * Load harness rules filtered by scope.
 * @param {string} rulesPath — path to harness-rules.json
 * @param {string} scope — "local" or "mesh"
 * @returns {object[]} — active rules for this scope
 */
function loadHarnessRules(rulesPath, scope) {
  if (!fs.existsSync(rulesPath)) return [];
  try {
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    return rules.filter(r =>
      r.active !== false &&
      Array.isArray(r.scope) &&
      r.scope.includes(scope)
    );
  } catch (err) {
    console.error(`[mesh-harness] Failed to load ${rulesPath}: ${err.message}`);
    return [];
  }
}

/**
 * Get rules by mesh_enforcement type.
 */
function rulesByEnforcement(rules, type) {
  return rules.filter(r => r.mesh_enforcement === type);
}

// ── Enforcement: Scope Check ─────────────────────────

/**
 * Revert any files changed outside task.scope in a worktree.
 * Returns { violations: string[], reverted: string[] }.
 */
function enforceScopeCheck(worktreePath, taskScope) {
  if (!worktreePath || !taskScope || taskScope.length === 0) {
    return { violations: [], reverted: [] };
  }

  const violations = [];
  const reverted = [];

  try {
    const changed = execSync('git diff --name-only HEAD', {
      cwd: worktreePath, timeout: 10000, encoding: 'utf-8',
    }).trim();

    // Also check untracked files
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: worktreePath, timeout: 10000, encoding: 'utf-8',
    }).trim();

    const allFiles = [...new Set([
      ...(changed ? changed.split('\n') : []),
      ...(untracked ? untracked.split('\n') : []),
    ])].filter(Boolean);

    for (const file of allFiles) {
      const inScope = taskScope.some(pattern => globMatch(pattern, file));
      if (!inScope) {
        violations.push(file);
        try {
          // Revert tracked files
          execSync(`git checkout HEAD -- "${file}"`, {
            cwd: worktreePath, timeout: 5000, stdio: 'pipe',
          });
          reverted.push(file);
        } catch {
          // Untracked file — remove it
          try {
            fs.unlinkSync(path.join(worktreePath, file));
            reverted.push(file);
          } catch { /* best effort */ }
        }
      }
    }
  } catch (err) {
    console.error(`[mesh-harness] Scope check error: ${err.message}`);
  }

  return { violations, reverted };
}

// ── Enforcement: Post-Execution Scan ─────────────────

/**
 * Scan LLM output for error patterns that suggest silent failure.
 * Returns { suspicious: boolean, matches: string[] }.
 */
function postExecutionScan(llmOutput, scanPatterns) {
  if (!llmOutput || !scanPatterns || scanPatterns.length === 0) {
    return { suspicious: false, matches: [] };
  }

  const matches = [];
  const lines = llmOutput.split('\n');

  for (const line of lines) {
    for (const pattern of scanPatterns) {
      if (line.includes(pattern)) {
        matches.push(line.trim().slice(0, 200));
        break; // one match per line is enough
      }
    }
  }

  // Heuristic: if >20% of output lines contain error patterns, it's suspicious
  // Also flag if any FAIL/PANIC/Traceback appears (high-confidence error signals)
  const highConfidence = ['FAIL', 'PANIC', 'Traceback', 'FATAL'];
  const hasHighConfidence = matches.some(m =>
    highConfidence.some(hc => m.includes(hc))
  );

  return {
    suspicious: hasHighConfidence || matches.length > 3,
    matches: matches.slice(0, 10), // cap at 10 matches
  };
}

// ── Enforcement: Output Block ────────────────────────

/**
 * Scan LLM output for blocked patterns (destructive commands, etc.).
 * Returns { blocked: boolean, violations: { ruleId, match }[] }.
 */
function scanOutputForBlocks(llmOutput, blockRules) {
  if (!llmOutput) return { blocked: false, violations: [] };

  const violations = [];

  for (const rule of blockRules) {
    if (!rule.pattern) continue;
    try {
      const regex = new RegExp(rule.pattern, 'gm');
      const matches = llmOutput.match(regex);
      if (matches) {
        violations.push({
          ruleId: rule.id,
          pattern: rule.pattern,
          matches: matches.slice(0, 5),
        });
      }
    } catch { /* skip invalid regex */ }
  }

  return {
    blocked: violations.length > 0,
    violations,
  };
}

// ── Enforcement: Pre-Commit Scan ─────────────────────

/**
 * Scan staged diff for secrets before committing.
 * Returns { blocked: boolean, findings: string[] }.
 */
function preCommitSecretScan(worktreePath) {
  if (!worktreePath) return { blocked: false, findings: [] };

  const findings = [];

  try {
    // Check if gitleaks is available
    try {
      const result = execSync('gitleaks detect --staged --no-banner 2>&1', {
        cwd: worktreePath, timeout: 30000, encoding: 'utf-8',
      });
      if (/leaks?\s+found|secret|token/i.test(result)) {
        findings.push(`gitleaks: ${result.trim().slice(0, 200)}`);
      }
    } catch (glErr) {
      // gitleaks not available or found leaks (exit code 1)
      if (glErr.stdout && /leaks?\s+found/i.test(glErr.stdout)) {
        findings.push(`gitleaks: ${glErr.stdout.trim().slice(0, 200)}`);
      }
    }

    // Fallback: regex scan on staged diff
    if (findings.length === 0) {
      const diff = execSync('git diff --cached -U0 2>/dev/null', {
        cwd: worktreePath, timeout: 10000, encoding: 'utf-8',
      });
      const secretPatterns = [
        /^\+.*sk-[a-zA-Z0-9]{20,}/m,
        /^\+.*AKIA[A-Z0-9]{16}/m,
        /^\+.*password\s*=\s*["'][^"']+["']/im,
        /^\+.*api_key\s*=\s*["'][^"']+["']/im,
        /^\+.*secret\s*=\s*["'][^"']+["']/im,
      ];
      for (const pat of secretPatterns) {
        const match = diff.match(pat);
        if (match) {
          findings.push(`regex: ${match[0].trim().slice(0, 100)}`);
        }
      }
    }
  } catch (err) {
    console.error(`[mesh-harness] Pre-commit scan error: ${err.message}`);
  }

  return {
    blocked: findings.length > 0,
    findings,
  };
}

// ── Enforcement: Post-Commit Validation ──────────────

/**
 * Run a validation command after commit (e.g., conventional commit check).
 * Returns { passed: boolean, output: string }.
 */
function postCommitValidate(worktreePath, command) {
  if (!worktreePath || !command) return { passed: true, output: '' };

  const validation = validateExecCommand(command);
  if (!validation.allowed) {
    return { passed: false, output: `Validation command blocked: ${validation.reason}` };
  }

  try {
    const output = execSync(command, {
      cwd: worktreePath, timeout: 10000, encoding: 'utf-8', stdio: 'pipe',
    });
    return { passed: true, output: output.trim() };
  } catch (err) {
    return {
      passed: false,
      output: (err.stdout || err.stderr || err.message || '').trim().slice(0, 500),
    };
  }
}

// ── Composite: Run All Mesh Enforcement ──────────────

/**
 * Run the full mesh harness enforcement suite for a completed task.
 * Called after LLM exits, before commitAndMergeWorktree.
 *
 * @param {object} opts
 * @param {object[]} opts.rules — loaded mesh harness rules
 * @param {string} opts.worktreePath — task worktree
 * @param {string[]} opts.taskScope — task.scope glob patterns
 * @param {string} opts.llmOutput — LLM stdout
 * @param {boolean} opts.hasMetric — whether task has a metric
 * @param {function} opts.log — logging function
 * @returns {object} — { pass, violations, warnings }
 */
function runMeshHarness(opts) {
  const { rules, worktreePath, taskScope, llmOutput, hasMetric, log, role } = opts;
  const violations = [];
  const warnings = [];

  // 1. Scope enforcement
  const scopeRules = rulesByEnforcement(rules, 'scope_check');
  if (scopeRules.length > 0 && taskScope && taskScope.length > 0) {
    const result = enforceScopeCheck(worktreePath, taskScope);
    if (result.violations.length > 0) {
      const msg = `SCOPE VIOLATION: ${result.violations.length} file(s) outside scope reverted: ${result.reverted.join(', ')}`;
      violations.push({ rule: 'scope-enforcement', message: msg, files: result.violations });
      log(`[HARNESS] ${msg}`);
    }
  }

  // 1.5. Forbidden pattern check (from role profile, runs on worktree files)
  if (role && role.forbidden_patterns && worktreePath) {
    const { checkForbiddenPatterns } = require('./role-loader');
    // Get list of changed files in worktree (post-scope-revert)
    try {
      const { execSync } = require('child_process');
      const changed = execSync('git diff --name-only HEAD', {
        cwd: worktreePath, timeout: 10000, encoding: 'utf-8',
      }).trim();
      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: worktreePath, timeout: 10000, encoding: 'utf-8',
      }).trim();
      const outputFiles = [...new Set([
        ...(changed ? changed.split('\n') : []),
        ...(untracked ? untracked.split('\n') : []),
      ])].filter(Boolean);

      if (outputFiles.length > 0) {
        const fpResult = checkForbiddenPatterns(role, outputFiles, worktreePath);
        if (!fpResult.passed) {
          for (const v of fpResult.violations) {
            const msg = `FORBIDDEN PATTERN: "${v.description}" in ${v.file} (matched: ${v.match})`;
            violations.push({ rule: `forbidden:${v.pattern}`, message: msg, file: v.file });
            log(`[HARNESS] ${msg}`);
          }
        }
      }
    } catch (err) {
      log(`[HARNESS] Forbidden pattern check error: ${err.message}`);
    }
  }

  // 2. Output block scan
  const blockRules = rulesByEnforcement(rules, 'output_block');
  if (blockRules.length > 0) {
    const result = scanOutputForBlocks(llmOutput, blockRules);
    if (result.blocked) {
      for (const v of result.violations) {
        const msg = `OUTPUT BLOCK: rule "${v.ruleId}" matched pattern /${v.pattern}/ (${v.matches.length} occurrence(s))`;
        violations.push({ rule: v.ruleId, message: msg });
        log(`[HARNESS] ${msg}`);
      }
    }
  }

  // 3. Post-execution error scan (for metric-less tasks only)
  const scanRules = rulesByEnforcement(rules, 'post_scan');
  if (scanRules.length > 0 && !hasMetric) {
    for (const rule of scanRules) {
      const result = postExecutionScan(llmOutput, rule.mesh_scan_patterns);
      if (result.suspicious) {
        const msg = `SUSPICIOUS OUTPUT: ${result.matches.length} error-like patterns found in output (no metric to verify)`;
        warnings.push({ rule: rule.id, message: msg, matches: result.matches });
        log(`[HARNESS] ${msg}`);
      }
    }
  }

  // 4. Metric-required flag
  const metricRules = rulesByEnforcement(rules, 'metric_required');
  if (metricRules.length > 0 && !hasMetric) {
    warnings.push({
      rule: 'build-before-done',
      message: 'Task completed without metric — no mechanical verification of success',
    });
  }

  // 5. Pre-commit secret scan
  const secretRules = rulesByEnforcement(rules, 'pre_commit_scan');
  if (secretRules.length > 0 && worktreePath) {
    const result = preCommitSecretScan(worktreePath);
    if (result.blocked) {
      const msg = `SECRET DETECTED: ${result.findings.join('; ')}`;
      violations.push({ rule: 'no-hardcoded-secrets', message: msg, findings: result.findings });
      log(`[HARNESS] ${msg}`);
    }
  }

  const pass = violations.length === 0;

  return { pass, violations, warnings };
}

/**
 * Run post-commit validation checks.
 * Called after commitAndMergeWorktree, before reporting completion.
 *
 * @param {object[]} rules — loaded mesh harness rules
 * @param {string} worktreePath
 * @param {function} log
 * @returns {object[]} — array of { rule, passed, output } for each validation
 */
function runPostCommitValidation(rules, worktreePath, log) {
  const results = [];
  const validateRules = rulesByEnforcement(rules, 'post_validate');

  for (const rule of validateRules) {
    if (!rule.mesh_validate_command) continue;
    const result = postCommitValidate(worktreePath, rule.mesh_validate_command);
    results.push({
      rule: rule.id,
      passed: result.passed,
      output: result.output,
    });
    if (!result.passed) {
      log(`[HARNESS] POST-COMMIT FAIL: ${rule.id} — ${result.output}`);
    }
  }

  return results;
}

/**
 * Get inject-type rules for prompt injection (soft enforcement layer).
 * These are injected into the LLM prompt in addition to mechanical enforcement.
 * LLM-agnostic: returns markdown text that any LLM can consume.
 */
function formatHarnessForPrompt(rules) {
  const injectRules = rules.filter(r => r.type === 'inject' && r.content);
  if (injectRules.length === 0) return '';

  const parts = ['## Harness Rules', ''];
  for (const rule of injectRules) {
    parts.push(rule.content);
  }
  return parts.join('\n');
}

module.exports = {
  loadHarnessRules,
  rulesByEnforcement,
  enforceScopeCheck,
  postExecutionScan,
  scanOutputForBlocks,
  preCommitSecretScan,
  postCommitValidate,
  runMeshHarness,
  runPostCommitValidation,
  formatHarnessForPrompt,
};
