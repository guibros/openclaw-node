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

test('no call site invokes tick() bare — both go through guardedTick', () => {
  assert.doesNotMatch(daemonSrc, /await tick\(\)/);
  const guardedCalls = daemonSrc.match(/await guardedTick\(\)/g) || [];
  assert.equal(guardedCalls.length, 2);
});

test('the interval logs the skip observable', () => {
  assert.match(daemonSrc, /tick skipped \(in-flight\)/);
});
