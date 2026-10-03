/**
 * Protocol 4.5 — completion integrity at the flush boundary.
 *
 * runFlush() sets `degraded: true` on every LLM extraction failure, but only ONE of
 * the five flush trigger paths ever read it. On the other four a degraded flush still
 * emitted a clean memory.synthesized event and the daemon logged success — which is how
 * a latched inference backend stalled extraction for 27 days while the daemon graded
 * green. These tests pin both halves of the fix: the verdict logic, and the structural
 * guarantee that no call site can emit around the gate again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const privateRoot = mkdtempSync(path.join(os.tmpdir(), 'memory-daemon-flush-'));
process.env.HOME = privateRoot;
process.env.OPENCLAW_WORKSPACE = privateRoot;
process.env.OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART = '1';
process.on('exit', () => rmSync(privateRoot, { recursive: true, force: true }));

const DAEMON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'workspace-bin', 'memory-daemon.mjs'
);
const { handleFlushResult } = await import(DAEMON);
const src = readFileSync(DAEMON, 'utf8');

// ── verdict logic ───────────────────────────────────────────────────────────

test('degraded result emits exactly one error and suppresses clean events', () => {
  const v = handleFlushResult(
    { flushed: true, facts: 3, added: 1, mode: 'regex', degraded: true, extraction_error: 'empty completion' },
    { trigger: 'interval', sessionId: 'sess-a', synthesisLabel: 'interval' }
  );
  assert.equal(v.degraded, true);
  assert.equal(v.emitted, 'error', 'degraded must emit the error path, never the clean path');
  assert.equal(v.skipped, false);
});

test('degraded result carries session context from ctx, not from the result', () => {
  // The regex fallback in pre-compression-flush.mjs returns no `extraction` object
  // and no session_id — a two-argument (result, trigger) signature could not have
  // attributed the error to a session.
  const degraded = { flushed: true, facts: 0, added: 0, mode: 'regex', degraded: true, extraction_error: 'boom' };
  assert.equal(degraded.extraction, undefined, 'fixture must mirror the real degraded shape');

  const v = handleFlushResult(degraded, { trigger: 'session-end', sessionId: 'sess-from-ctx' });
  assert.equal(v.sessionId, 'sess-from-ctx');
});

test('degraded result diverted to the fallback file still reports degraded', () => {
  const v = handleFlushResult(
    { degraded: true, mode: 'regex-diverted', fallback_path: '/w/MEMORY.regex-fallback.md', extraction_error: 'x' },
    { trigger: 'nats', sessionId: 's' }
  );
  assert.equal(v.degraded, true);
  assert.equal(v.emitted, 'error');
});

test('skippedByCheck is not a completion — no events, no verdict', () => {
  const v = handleFlushResult({ skippedByCheck: true, check: { pctUsed: 12 } }, { trigger: 'idle', sessionId: 's' });
  assert.equal(v.skipped, true);
  assert.equal(v.emitted, null, 'a threshold skip must not emit success or error');
  assert.equal(v.degraded, false);
});

test('clean result emits the success path and prefers the result session id', () => {
  const v = handleFlushResult(
    { extraction: { session_id: 'from-result' }, synthesis: { session_id: 'from-result', artifacts_written: [] } },
    { trigger: 'interval', sessionId: 'from-ctx' }
  );
  assert.equal(v.emitted, 'ok');
  assert.equal(v.degraded, false);
  assert.equal(v.sessionId, 'from-result');
});

test('a missing result is treated as degraded, never as success', () => {
  const v = handleFlushResult(null, { trigger: 'interval', sessionId: 's' });
  assert.equal(v.degraded, true);
  assert.equal(v.emitted, 'error');
});

// ── structural guarantee ────────────────────────────────────────────────────

test('all five flush call sites route through handleFlushResult', () => {
  const flushCalls = src.match(/serializeFlush\(\(\) => runFlushInWorker\(/g) || [];
  assert.equal(flushCalls.length, 5, 'expected exactly five runFlush trigger paths');

  // one definition + five call sites
  const handlerRefs = src.match(/handleFlushResult\(/g) || [];
  assert.equal(handlerRefs.length, 6, 'every flush call site must call the gate');
});

test('no flush call site emits extract/synthesize/degrade around the gate', () => {
  // Emission belongs to handleFlushResult alone. Anything outside its body (and the
  // three function definitions) is a path that can report success on a failed flush.
  const start = src.indexOf('function handleFlushResult');
  assert.ok(start > 0, 'handleFlushResult must exist');
  const end = src.indexOf('\nfunction initMemoryBudget', start);
  assert.ok(end > start, 'could not bound handleFlushResult');

  const outside = src.slice(0, start) + src.slice(end);
  for (const fn of ['emitExtractEvent', 'emitSynthesizeEvent', 'emitDegradeEvent']) {
    const calls = (outside.match(new RegExp(`${fn}\\(`, 'g')) || []).length;
    const defs = (outside.match(new RegExp(`function ${fn}\\(`, 'g')) || []).length;
    assert.equal(calls, defs, `${fn} is called outside handleFlushResult — emission must go through the gate`);
  }
});

test('the daemon still autostarts by default', () => {
  // The test guard must be fail-open: a deployed launchd/systemd unit sets no env var
  // and must keep booting exactly as before.
  assert.match(src, /OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART !== '1'/);
  assert.match(src, /if \(process\.env\.OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART !== '1'\) \{\s*\n\s*main\(\)/);
});
