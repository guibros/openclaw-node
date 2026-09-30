import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('owned restore-only command resolves an interrupted hold and refuses unsafe state', {
  skip: process.platform !== 'darwin',
}, () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('../memory-plan/plans/node-state-recovery/audits/step12_jetstream/test_restore_only.py', import.meta.url))], {
    timeout: 180_000,
    encoding: 'utf8',
  });
  console.log(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
