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
  'git ', 'npm ', 'node ', 'npx ', 'python ', 'python3 ',
  'cat ', 'ls ', 'head ', 'tail ', 'grep ', 'find ', 'wc ',
  'echo ', 'date ', 'uptime ', 'df ', 'free ', 'ps ',
  'bash openclaw/', 'bash ~/openclaw/', 'bash ./bin/',
  'cd ', 'pwd', 'which ', 'env ', 'printenv ',
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
  checkDestructivePatterns,
  isAllowedExecCommand,
  validateExecCommand,
};
