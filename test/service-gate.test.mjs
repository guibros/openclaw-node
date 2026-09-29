import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('service gate keeps scheduled application work paused until verified recovery', () => {
  execFileSync('python3', [fileURLToPath(new URL('./service_gate_test.py', import.meta.url)), '-v'], {
    timeout: 30_000,
    stdio: 'pipe',
  });
});
