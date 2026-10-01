import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const file of ['timer_hold_install_test.py', 'timer_hold_control_test.py']) {
  test(`${file} verifies the owned Mac handoff and protected controller`, () => {
    const result = spawnSync('python3', [fileURLToPath(new URL(file, import.meta.url))], {
      timeout: 120_000,
      encoding: 'utf8',
    });
    console.log(result.stderr);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}
