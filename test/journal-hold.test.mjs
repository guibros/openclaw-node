import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// macOS journal writes end in F_FULLFSYNC, so under a loaded local run these suites take
// minutes there; Linux finishes them in seconds.
const timeout = process.platform === 'darwin' ? 600_000 : 60_000;

test('sole preservation journal restores interrupted execution holds without certifying lost history', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('../memory-plan/plans/node-state-recovery/audits/step12_jetstream/test_journal_hold.py', import.meta.url))], {
    timeout,
    encoding: 'utf8',
  });
  console.log(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('preservation journal keeps timer commissioning scope separate from full-node lineage', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('../memory-plan/plans/node-state-recovery/audits/step12_jetstream/test_preservation_journal.py', import.meta.url))], {
    timeout,
    encoding: 'utf8',
  });
  console.log(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
