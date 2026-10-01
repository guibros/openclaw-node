#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITE_ROOT, HANDOFF_MARKER, parseDiskutilInfo, evaluateProtectedSite } from '../lib/nats-protected-site-audit.mjs';

const run = promisify(execFile);

async function identity(path) {
  try {
    const value = await fs.lstat(path);
    return { isDirectory: value.isDirectory(), uid: value.uid, gid: value.gid, mode: value.mode, device: value.dev };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function account() {
  try {
    const [uid, gid] = await Promise.all([
      run('/usr/bin/id', ['-u', '_openclaw_nats']),
      run('/usr/bin/id', ['-g', '_openclaw_nats']),
    ]);
    return { uid: Number(uid.stdout.trim()), gid: Number(gid.stdout.trim()) };
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
}

async function volume() {
  const df = await run('/bin/df', ['-P', '/private/var/db']);
  const device = df.stdout.trim().split('\n')[1]?.trim().split(/\s+/)[0];
  if (!device?.startsWith('/dev/')) throw new Error('volume device unavailable');
  const info = await run('/usr/sbin/diskutil', ['info', device]);
  return parseDiskutilInfo(info.stdout);
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('protected site audit requires macOS');
  const [serviceAccount, privateRoot, varRoot, dbRoot, root, marker, filesystem] = await Promise.all([
    account(), identity('/private'), identity('/private/var'), identity('/private/var/db'),
    identity(SITE_ROOT), identity(HANDOFF_MARKER), volume(),
  ]);
  const report = evaluateProtectedSite({ account: serviceAccount, operatorUid: process.getuid(),
    ancestors: [privateRoot, varRoot, dbRoot], root,
    marker: marker ? 'present' : 'absent', volume: filesystem });
  process.stdout.write(`${JSON.stringify({ observedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  if (!report.readyForStaging) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`protected site unobservable: ${error.message}\n`);
  process.exitCode = 2;
});
