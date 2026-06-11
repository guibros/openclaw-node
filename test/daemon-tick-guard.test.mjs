import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConcurrencyGuard } from '../lib/concurrency-guard.mjs';

const daemonSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin', 'memory-daemon.mjs'),
  'utf-8'
);

test('overlapping guarded tick fires skip, runs the body once', async () => {
  let running = 0;
  let maxConcurrent = 0;
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });

  const tick = async () => {
    calls++;
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    await gate;
    running--;
  };

  const guardedTick = createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000 });

  const first = guardedTick();
  const second = await guardedTick();

  assert.deepEqual(second, { skipped: true, reason: 'in_flight' });
  assert.equal(calls, 1);
  assert.equal(maxConcurrent, 1);

  release();
  await first;

  const third = await guardedTick();
  assert.notDeepEqual(third, { skipped: true, reason: 'in_flight' });
  assert.equal(calls, 2);
  assert.equal(maxConcurrent, 1);
});

test('daemon imports the shared concurrency guard', () => {
  assert.match(daemonSrc, /import \{ createConcurrencyGuard \} from '\.\.\/lib\/concurrency-guard\.mjs';/);
});

test('daemon wraps tick in the guard with a deadlock force-clear', () => {
  assert.match(daemonSrc, /const guardedTick = createConcurrencyGuard\(tick, \{ maxAgeMs: 30 \* 60_000, log \}\)/);
});

test('no call site invokes tick() bare — both go through guardedTick, tracked for fencing', () => {
  assert.doesNotMatch(daemonSrc, /await tick\(\)/);
  const tracked = daemonSrc.match(/inFlightTick = guardedTick\(\)/g) || [];
  assert.equal(tracked.length, 2, 'both call sites must assign inFlightTick so shutdown can fence');
});

test('shutdown fences the in-flight tick before closing handles and owns the exit (R15, repair 4.1)', () => {
  assert.match(daemonSrc, /if \(tickInterval\) clearInterval\(tickInterval\);/);
  const shutdownBody = daemonSrc.match(/const shutdown = async \(signal\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(shutdownBody, /inFlightTick/, 'shutdown must await the in-flight tick');
  assert.match(shutdownBody, /process\.exit\(0\)/, 'shutdown must own the exit');
  const fenceIdx = shutdownBody.indexOf('inFlightTick');
  const closeIdx = shutdownBody.indexOf('_knowledgeDb');
  assert.ok(fenceIdx < closeIdx, 'fence must precede handle closes');
  // The interval must NOT exit the process anymore.
  const intervalBody = daemonSrc.match(/tickInterval = setInterval\([\s\S]*?\}, config\.intervals\.pollMs\);/)[0];
  assert.doesNotMatch(intervalBody, /process\.exit/);
});

test('the interval logs the skip observable', () => {
  assert.match(daemonSrc, /tick skipped \(in-flight\)/);
});

test('synthesis trigger labels are truthful per call site (R10, repair 2.11)', () => {
  const labels = [...daemonSrc.matchAll(/emitSynthesizeEvent\([^,]+, '([a-z_]+)'/g)].map((m) => m[1]);
  labels.sort();
  // Phase-2 interval, IDLE→ENDED end, ACTIVE→IDLE pre-compression (its own
  // label), ACTIVE→ENDED end, NATS-triggered manual.
  assert.deepEqual(labels, ['idle', 'interval', 'manual', 'session_end', 'session_end']);
});

test('synthesized events carry session_id (R10, repair 2.10)', () => {
  assert.match(daemonSrc, /buildMemoryEvent\('memory\.synthesized', sessionId, 'memory', \{\n    session_id: sessionId,/);
});
