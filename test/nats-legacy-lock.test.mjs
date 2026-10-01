import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('legacy writer reexec reacquires a stale token and refuses an active handoff', () => {
  const fixture = fs.mkdtempSync(path.join(ROOT, '.nats-legacy-lock-test-'));
  try {
    fs.mkdirSync(path.join(fixture, 'bin'));
    fs.mkdirSync(path.join(fixture, 'lib'));
    const lock = path.join(fixture, 'writer.lock');
    const marker = path.join(fixture, 'handoff.json');
    const helper = path.join(fixture, 'bin', 'nats-legacy-lock.py');
    const library = path.join(fixture, 'lib', 'nats-legacy-lock.mjs');
    const effect = path.join(fixture, 'effect');
    fs.writeFileSync(lock, '');
    fs.chmodSync(lock, 0o644);
    fs.writeFileSync(helper, fs.readFileSync(path.join(ROOT, 'bin', 'nats-legacy-lock.py'), 'utf8')
      .replace("pathlib.Path('/private/var/db/openclaw-nats-writer.lock')", `pathlib.Path(${JSON.stringify(lock)})`)
      .replace("pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')", `pathlib.Path(${JSON.stringify(marker)})`)
      .replace('expected_uid=0, expected_gid=0', `expected_uid=${process.getuid()}, expected_gid=${process.getgid()}`));
    fs.writeFileSync(library, fs.readFileSync(path.join(ROOT, 'lib', 'nats-legacy-lock.mjs'), 'utf8')
      .replace("'/private/var/db/openclaw-nats-writer.lock'", JSON.stringify(lock)));
    const script = path.join(fixture, 'child.mjs');
    fs.writeFileSync(script, `
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { reexecUnderLegacyNatsLock } = await import(${JSON.stringify(`file://${library}`)});
      reexecUnderLegacyNatsLock();
      const fs = await import('node:fs');
      fs.writeFileSync(${JSON.stringify(effect)}, 'ran');
    `);
    const env = { ...process.env, OPENCLAW_NATS_LEGACY_LOCK_HELD: '3:1:1', PYTHONDONTWRITEBYTECODE: '1' };
    const first = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.readFileSync(effect, 'utf8'), 'ran');
    fs.rmSync(effect);
    const invalid = spawnSync(process.execPath, [script], {
      env: { ...env, OPENCLAW_NATS_LEGACY_REEXEC_ATTEMPT: '1' }, encoding: 'utf8',
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /verification failed after re-exec/);
    assert.equal(fs.existsSync(effect), false);
    fs.writeFileSync(marker, '{}');
    const second = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /handoff active/);
    assert.equal(fs.existsSync(effect), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
