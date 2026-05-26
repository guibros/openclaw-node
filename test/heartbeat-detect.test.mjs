/**
 * heartbeat-detect.test.mjs — Unit tests for lib/heartbeat-detect.mjs
 *
 * Covers: detectHeartbeat (no sessions / inactive / active heartbeat / active main),
 * isHeartbeatActive convenience wrapper, custom activeWindowMs, daemon state
 * enrichment, transcript-registry fallback to defaults, malformed JSONL handling.
 *
 * Builds an isolated fake workspace + transcript-registry per test for hermetic
 * runs (no shared state with the real openclaw deployment).
 *
 * Run: node --test test/heartbeat-detect.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CRITICAL: heartbeat-detect.mjs captures HOME at IMPORT time. Set HOME +
// transcript-sources registry BEFORE the dynamic import so the module sees
// our test fixtures, not the user's real ~/.openclaw config.
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'heartbeat-test-'));
process.env.HOME = TMP_ROOT;
mkdirSync(join(TMP_ROOT, '.openclaw/config'), { recursive: true });
const TEST_GATEWAY_DIR = join(TMP_ROOT, 'gateway-sessions');
mkdirSync(TEST_GATEWAY_DIR, { recursive: true });
writeFileSync(
  join(TMP_ROOT, '.openclaw/config/transcript-sources.json'),
  JSON.stringify({
    sources: [
      { name: 'gateway', path: TEST_GATEWAY_DIR, format: 'openclaw-gateway' },
    ],
  })
);

const { detectHeartbeat, isHeartbeatActive } = await import('../lib/heartbeat-detect.mjs');

let WORKSPACE;
let GATEWAY_DIR;

beforeEach(() => {
  // Reset gateway dir contents between tests (keep same path so registry stays valid)
  GATEWAY_DIR = TEST_GATEWAY_DIR;
  rmSync(GATEWAY_DIR, { recursive: true, force: true });
  mkdirSync(GATEWAY_DIR, { recursive: true });
  // Fresh workspace per test
  WORKSPACE = mkdtempSync(join(tmpdir(), 'heartbeat-ws-'));
  mkdirSync(join(WORKSPACE, '.tmp'), { recursive: true });
});

afterEach(() => {
  rmSync(WORKSPACE, { recursive: true, force: true });
});

// Final cleanup: process exit removes TMP_ROOT (the HOME we set above)
process.on('exit', () => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

function writeSession(filename, lines, mtimeOverride) {
  const filePath = join(GATEWAY_DIR, filename);
  writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeOverride) {
    const t = mtimeOverride / 1000;
    utimesSync(filePath, t, t);
  }
  return filePath;
}

function writeDaemonState(state, sessionId) {
  writeFileSync(
    join(WORKSPACE, '.tmp/daemon-state.json'),
    JSON.stringify({ state, sessionId, lastActivityTime: Date.now(), pid: 1, updatedAt: Date.now() })
  );
}

describe('detectHeartbeat — no sessions', () => {
  it('returns isActive:false with null fields when gateway dir is empty', () => {
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, false);
    assert.equal(result.sessionId, null);
    assert.equal(result.detectedAt, null);
    assert.equal(result.ageSeconds, null);
    assert.equal(result.sessionType, 'unknown');
  });

  it('reports daemonActive:false when no daemon-state.json exists', () => {
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.daemonActive, false);
    assert.equal(result.daemonSessionId, null);
    assert.equal(result.daemonState, 'UNKNOWN');
  });
});

describe('detectHeartbeat — heartbeat session', () => {
  it('detects an active heartbeat by content pattern', () => {
    writeSession('hb-session.jsonl', [
      { message: 'Read HEARTBEAT.md and proceed' },
    ]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
    assert.equal(result.sessionId, 'hb-session');
    assert.equal(result.sessionType, 'heartbeat');
    // ageSeconds is from Math.floor((now - mtime)/1000); clock skew on fast
    // systems can make mtime slightly future → negative. Accept anything finite.
    assert.ok(typeof result.ageSeconds === 'number', 'ageSeconds should be a number');
  });

  it('detects "heartbeat poll" trigger phrase', () => {
    writeSession('hb-poll.jsonl', [{ message: 'starting heartbeat poll cycle' }]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
  });

  it('matches HEARTBEAT case-insensitively', () => {
    writeSession('hb-low.jsonl', [{ message: 'heartbeat check ran' }]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
  });

  it('finds heartbeat pattern in nested content object', () => {
    writeSession('hb-nested.jsonl', [
      { content: { text: 'HEARTBEAT triggered' } },
    ]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
  });
});

describe('detectHeartbeat — main (non-heartbeat) session', () => {
  it('reports sessionType:main and isActive:false for non-heartbeat recent session', () => {
    writeSession('main.jsonl', [{ message: 'regular user prompt about code' }]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, false);
    assert.equal(result.sessionId, null);
    assert.equal(result.sessionType, 'main');
  });
});

describe('detectHeartbeat — activeWindowMs', () => {
  it('treats out-of-window sessions as inactive (sessionType:unknown)', () => {
    const oldMtime = Date.now() - 2 * 60 * 60 * 1000;  // 2 hours ago
    writeSession('hb-old.jsonl', [{ message: 'Read HEARTBEAT.md' }], oldMtime);
    const result = detectHeartbeat({ workspace: WORKSPACE, activeWindowMs: 30 * 60 * 1000 });
    assert.equal(result.isActive, false);
    assert.equal(result.sessionType, 'unknown');
  });

  it('honors custom activeWindowMs', () => {
    const recent = Date.now() - 45 * 60 * 1000;  // 45 min ago
    writeSession('hb-mid.jsonl', [{ message: 'HEARTBEAT trigger' }], recent);
    // Default 30 min: should be out of window
    const def = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(def.isActive, false);
    // Custom 60 min: should be in window + active
    const ext = detectHeartbeat({ workspace: WORKSPACE, activeWindowMs: 60 * 60 * 1000 });
    assert.equal(ext.isActive, true);
  });
});

describe('detectHeartbeat — daemon state enrichment', () => {
  it('reports daemonActive:true when daemon state is ACTIVE', () => {
    writeDaemonState('ACTIVE', 'session-abc');
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.daemonActive, true);
    assert.equal(result.daemonSessionId, 'session-abc');
    assert.equal(result.daemonState, 'ACTIVE');
  });

  it('reports daemonActive:true when daemon state is IDLE', () => {
    writeDaemonState('IDLE', null);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.daemonActive, true);
    assert.equal(result.daemonState, 'IDLE');
  });

  it('reports daemonActive:false for other daemon states', () => {
    writeDaemonState('OFFLINE', null);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.daemonActive, false);
  });

  it('handles malformed daemon-state.json gracefully', () => {
    writeFileSync(join(WORKSPACE, '.tmp/daemon-state.json'), '{invalid json}');
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.daemonActive, false);
    assert.equal(result.daemonState, 'UNKNOWN');
  });
});

describe('detectHeartbeat — robustness', () => {
  it('skips malformed JSONL lines while scanning for triggers', () => {
    writeFileSync(
      join(GATEWAY_DIR, 'mixed.jsonl'),
      'not-valid-json\n' + JSON.stringify({ message: 'HEARTBEAT triggered' }) + '\n'
    );
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
  });

  it('returns empty result when gateway dir is missing entirely', () => {
    rmSync(GATEWAY_DIR, { recursive: true });
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, false);
  });

  it('picks the newest file when multiple exist', () => {
    writeSession('old.jsonl', [{ message: 'regular work' }], Date.now() - 10 * 60 * 1000);
    writeSession('new.jsonl', [{ message: 'HEARTBEAT now' }]);
    const result = detectHeartbeat({ workspace: WORKSPACE });
    assert.equal(result.isActive, true);
    assert.equal(result.sessionId, 'new');
  });
});

describe('isHeartbeatActive convenience wrapper', () => {
  it('returns true when detectHeartbeat reports isActive:true', () => {
    writeSession('hb.jsonl', [{ message: 'HEARTBEAT trigger' }]);
    assert.equal(isHeartbeatActive({ workspace: WORKSPACE }), true);
  });

  it('returns false otherwise', () => {
    writeSession('main.jsonl', [{ message: 'regular work' }]);
    assert.equal(isHeartbeatActive({ workspace: WORKSPACE }), false);
  });
});

describe('OPENCLAW_WORKSPACE env fallback', () => {
  it('uses OPENCLAW_WORKSPACE when no workspace option passed', () => {
    process.env.OPENCLAW_WORKSPACE = WORKSPACE;
    writeSession('hb.jsonl', [{ message: 'HEARTBEAT' }]);
    const result = detectHeartbeat();
    assert.equal(result.isActive, true);
    delete process.env.OPENCLAW_WORKSPACE;
  });
});
