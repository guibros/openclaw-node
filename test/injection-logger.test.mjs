/**
 * injection-logger.test.mjs — Unit tests for lib/injection-logger.mjs
 *
 * Covers: logInjection (append + ensure dir + rotate), channelStats math,
 * promptExcerpt truncation, getLogPath, INJECTION_LOG_DISABLED env opt-out.
 *
 * Run: node --test test/injection-logger.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Configure log path BEFORE importing the module (env var is read at import time)
const TMP = mkdtempSync(join(tmpdir(), 'injection-logger-test-'));
const LOG_PATH = join(TMP, 'subdir', 'memory-injections.jsonl');
process.env.INJECTION_LOG_PATH = LOG_PATH;
process.env.INJECTION_LOG_ROTATE_BYTES = '1024';  // small for rotation tests
delete process.env.INJECTION_LOG_DISABLED;

const { logInjection, channelStats, promptExcerpt, getLogPath } = await import('../lib/injection-logger.mjs');

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('getLogPath', () => {
  it('returns the configured path', () => {
    assert.equal(getLogPath(), LOG_PATH);
  });
});

describe('channelStats', () => {
  it('returns {candidates, kept} object', () => {
    assert.deepEqual(channelStats(5, 2), { candidates: 5, kept: 2 });
  });

  it('defaults missing values to 0', () => {
    assert.deepEqual(channelStats(), { candidates: 0, kept: 0 });
    assert.deepEqual(channelStats(7), { candidates: 7, kept: 0 });
    assert.deepEqual(channelStats(null, null), { candidates: 0, kept: 0 });
  });
});

describe('promptExcerpt', () => {
  it('returns empty string for null/undefined/empty', () => {
    assert.equal(promptExcerpt(null), '');
    assert.equal(promptExcerpt(undefined), '');
    assert.equal(promptExcerpt(''), '');
  });

  it('flattens whitespace into single spaces', () => {
    assert.equal(promptExcerpt('  hello\n\nworld\t!  '), 'hello world !');
  });

  it('truncates at default 200 chars and appends ellipsis', () => {
    const long = 'a'.repeat(500);
    const result = promptExcerpt(long);
    assert.equal(result.length, 201); // 200 + ellipsis (1 char)
    assert.ok(result.endsWith('…'));
  });

  it('honors custom max', () => {
    const long = 'a'.repeat(100);
    const result = promptExcerpt(long, 10);
    assert.equal(result.length, 11);
    assert.ok(result.endsWith('…'));
  });

  it('does not truncate short prompts', () => {
    assert.equal(promptExcerpt('short'), 'short');
  });

  it('stringifies non-string input', () => {
    assert.equal(promptExcerpt(42), '42');
  });
});

describe('logInjection', () => {
  it('creates the log directory if missing', async () => {
    await logInjection({ session_id: 'a' });
    assert.ok(existsSync(LOG_PATH), 'log file should exist');
  });

  it('appends one JSON line per call', async () => {
    // Reset by truncating
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'x', frontend: 'test' });
    await logInjection({ session_id: 'y', frontend: 'test' });
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('enriches each record with a ts timestamp', async () => {
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'z' });
    const line = readFileSync(LOG_PATH, 'utf-8').trim();
    const parsed = JSON.parse(line);
    assert.ok(parsed.ts);
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(parsed.session_id, 'z');
  });

  it('does not throw when payload is unusual', async () => {
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'a', items: { concepts: ['x'] } });
    await logInjection({});
    // Should still have 2 lines
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('rotates the file when it exceeds ROTATE_AT_BYTES', async () => {
    writeFileSync(LOG_PATH, '');
    // Fill past the 1024-byte cap configured at top of file
    const big = { session_id: 'big', payload: 'x'.repeat(200) };
    for (let i = 0; i < 10; i++) await logInjection(big);
    // First few calls write directly, then a rotation should occur
    const files = readdirSync(join(LOG_PATH, '..'));
    const rotated = files.filter(f => f.match(/memory-injections\.\d{4}-/));
    assert.ok(rotated.length >= 1, 'should have created at least one rotated file');
  });
});

describe('INJECTION_LOG_DISABLED env opt-out', () => {
  it('short-circuits when DISABLED=1 (verified via fresh import)', async () => {
    // Use a fresh module via cache-busting query param
    process.env.INJECTION_LOG_DISABLED = '1';
    const ALT_PATH = join(TMP, 'disabled-test.jsonl');
    process.env.INJECTION_LOG_PATH = ALT_PATH;
    const mod = await import('../lib/injection-logger.mjs?disabled-test');
    await mod.logInjection({ session_id: 'should-not-log' });
    assert.equal(existsSync(ALT_PATH), false);
    // Restore
    delete process.env.INJECTION_LOG_DISABLED;
  });
});
