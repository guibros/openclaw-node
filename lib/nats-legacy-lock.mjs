import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LEGACY_NATS_WRITER_LOCK = '/private/var/db/openclaw-nats-writer.lock';
const HELPER = fileURLToPath(new URL('../bin/nats-legacy-lock.py', import.meta.url));

function lockExists() {
  if (process.platform !== 'darwin') return false;
  try {
    fs.lstatSync(LEGACY_NATS_WRITER_LOCK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function inheritedLockIsValid() {
  const match = /^(\d+):(\d+):(\d+)$/.exec(process.env.OPENCLAW_NATS_LEGACY_LOCK_HELD || '');
  if (!match || Number(match[1]) < 3) return false;
  try {
    const fd = fs.fstatSync(Number(match[1]), { bigint: true });
    const named = fs.lstatSync(LEGACY_NATS_WRITER_LOCK, { bigint: true });
    if (fd.dev !== BigInt(match[2]) || fd.ino !== BigInt(match[3])
      || named.dev !== fd.dev || named.ino !== fd.ino) return false;
    const result = spawnSync('/usr/bin/python3', [HELPER, '--verify'], {
      stdio: ['ignore', 'ignore', 'pipe', Number(match[1])],
      env: { ...process.env, OPENCLAW_NATS_LEGACY_LOCK_HELD: `3:${match[2]}:${match[3]}` },
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export function assertLegacyNatsLockHeld() {
  if (lockExists() && !inheritedLockIsValid()) {
    throw new Error('root-owned NATS writer lock exists; direct legacy mutation refused');
  }
}

export function reexecUnderLegacyNatsLock() {
  if (!lockExists()) return;
  if (inheritedLockIsValid()) return;
  const env = { ...process.env };
  delete env.OPENCLAW_NATS_LEGACY_LOCK_HELD;
  const result = spawnSync('/usr/bin/python3', [HELPER, '--', process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
