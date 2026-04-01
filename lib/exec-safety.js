/**
 * exec-safety.js — Shared command safety filtering for mesh exec.
 *
 * Used by both CLI-side (mesh.js) and server-side (NATS exec handler)
 * to block destructive or unauthorized commands before execution.
 *
 * Two layers:
 *   1. DESTRUCTIVE_PATTERNS — blocklist of known-dangerous patterns
 *   2. ALLOWED_PREFIXES — allowlist for server-side execution (opt-in)
 */

'use strict';

const { createTracer } = require('./tracer');
const tracer = createTracer('exec-safety');

// Shell metacharacter detection — blocks command chaining/injection.
// Safe pipes to common read-only utilities are allowed.
const SHELL_CHAIN_PATTERNS = /[\n\r\0;`]|\$\(|\|\||&&|<\(|>\(|<<|>>|>\s|\|(?!\s*grep\b|\s*head\b|\s*tail\b|\s*wc\b|\s*sort\b)/;

function containsShellChaining(cmd) {
  // Allow safe pipes to common read-only utilities
  return SHELL_CHAIN_PATTERNS.test(cmd);
}

// Dangerous flags that allow arbitrary code execution via node
const DANGEROUS_NODE_FLAGS = /\bnode\s+(-e\b|--eval\b|-p\b|--print\b|-r\b|--require\b|--import\b|--loader\b|--experimental-loader\b)/;

// Dangerous git flags that allow arbitrary config / code execution
const DANGEROUS_GIT_FLAGS = /\bgit\s+(-c\s|--config\s)/;

// Dangerous find flags that allow arbitrary command execution
const DANGEROUS_FIND_FLAGS = /\bfind\b.*\s(-exec\b|-execdir\b|-delete\b|-ok\b|-okdir\b)/;

// Dangerous make variable overrides (SHELL=, CC=, etc.)
const DANGEROUS_MAKE_FLAGS = /\bmake\b.*\b(SHELL|CC|CXX|LD|AR)=/;

// Dangerous python flags that allow arbitrary code execution
const DANGEROUS_PYTHON_FLAGS = /\bpython3?\s+(-c\b|-m\s+http)/;

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/,      // rm -rf, rm -fr, rm --recursive --force
  /\brm\s+(-[a-zA-Z]*)?f[a-zA-Z]*r/,       // rm -fr variants
  /\bmkfs\b/,                                // format filesystem
  /\bdd\s+.*of=/,                            // raw disk write
  /\b>\s*\/dev\/[sh]d/,                      // write to raw device
  /\bcurl\b.*\|\s*(ba)?sh/,                  // curl pipe to shell
  /\bwget\b.*\|\s*(ba)?sh/,                  // wget pipe to shell
  /\bchmod\s+(-[a-zA-Z]*\s+)?777\s+\//,     // chmod 777 on root paths
  /\b:(){ :\|:& };:/,                        // fork bomb
  /\bsudo\b/,                                // sudo escalation
  /\bsu\s+-?\s/,                             // su user switch
  /\bpasswd\b/,                              // password change
  /\buseradd\b|\buserdel\b/,                 // user management
  /\biptables\b|\bnft\b/,                    // firewall modification
  /\bsystemctl\s+(stop|disable|mask)/,       // service disruption
  /\blaunchctl\s+(unload|remove)/,           // macOS service disruption
  /\bkill\s+-9\s+1\b/,                       // kill init/launchd
  />\s*\/etc\//,                             // overwrite system config
  /\beval\b.*\$\(/,                          // eval with command substitution
];

/**
 * Allowed command prefixes for server-side NATS exec.
 * Only commands starting with one of these are permitted.
 * CLI-side uses blocklist only; server-side uses both blocklist + allowlist.
 */
const ALLOWED_EXEC_PREFIXES = [
  'git ', 'node ', 'python ', 'python3 ',
  'npm test', 'npm run test', 'npm run lint', 'npm run build', 'npm run dev',
  'npm run start', 'npm install', 'npm ci', 'npm ls', 'npm outdated',
  'npm audit', 'npm version', 'npm pack', 'npm run check',
  'npx vitest', 'npx jest', 'npx eslint', 'npx prettier', 'npx tsc',
  'cat ', 'ls ', 'head ', 'tail ', 'grep ', 'find ', 'wc ',
  'echo ', 'date ', 'uptime ', 'df ', 'free ', 'ps ',
  'bash openclaw/', 'bash ~/openclaw/', 'bash ./bin/',
  'pwd', 'which ',
  'cargo ', 'go ', 'make ', 'pytest ', 'jest ', 'vitest ',
];

/**
 * Check if a command matches any destructive pattern.
 * @param {string} command
 * @returns {{ blocked: boolean, pattern?: RegExp }}
 */
function checkDestructivePatterns(command) {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, pattern };
    }
  }
  return { blocked: false };
}

/**
 * Check if a command is allowed by the server-side allowlist.
 * @param {string} command
 * @returns {boolean}
 */
function isAllowedExecCommand(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) return false;
  return ALLOWED_EXEC_PREFIXES.some(p => trimmed.startsWith(p));
}

/**
 * Full server-side validation: blocklist + allowlist.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * @param {string} command
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateExecCommand(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return { allowed: false, reason: 'Empty command' };
  }

  if (containsShellChaining(trimmed)) {
    return { allowed: false, reason: `Command contains shell chaining operators: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_NODE_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous node flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_GIT_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous git flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_FIND_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous find flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_MAKE_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous make variable override detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_PYTHON_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous python flag detected: ${trimmed.slice(0, 80)}` };
  }

  const destructive = checkDestructivePatterns(trimmed);
  if (destructive.blocked) {
    return { allowed: false, reason: `Blocked by destructive pattern: ${destructive.pattern}` };
  }

  if (!isAllowedExecCommand(trimmed)) {
    return { allowed: false, reason: `Command not in server-side allowlist: ${trimmed.slice(0, 80)}` };
  }

  return { allowed: true };
}

module.exports = {
  DESTRUCTIVE_PATTERNS,
  ALLOWED_EXEC_PREFIXES,
  DANGEROUS_NODE_FLAGS,
  DANGEROUS_GIT_FLAGS,
  DANGEROUS_FIND_FLAGS,
  DANGEROUS_MAKE_FLAGS,
  DANGEROUS_PYTHON_FLAGS,
  checkDestructivePatterns: tracer.wrap('checkDestructivePatterns', checkDestructivePatterns, { tier: 2, category: 'compute' }),
  isAllowedExecCommand: tracer.wrap('isAllowedExecCommand', isAllowedExecCommand, { tier: 2, category: 'compute' }),
  validateExecCommand: tracer.wrap('validateExecCommand', validateExecCommand, { tier: 2, category: 'compute' }),
  containsShellChaining: tracer.wrap('containsShellChaining', containsShellChaining, { tier: 2, category: 'compute' }),
};
