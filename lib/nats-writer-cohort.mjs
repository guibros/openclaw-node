import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const DEFAULT = { schema: 1, activeLabels: ['ai.openclaw.nats'] };

export async function initializeNatsWriterCohort(home, fsp = fs) {
  const config = join(home, 'config');
  const target = join(config, 'nats-writer-cohort.json');
  try {
    await fsp.lstat(target);
    return { created: false, reason: 'already-declared', path: target };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['nats.conf', 'nats-1.conf', 'nats-2.conf', 'nats-3.conf']) {
    try {
      await fsp.lstat(join(config, name));
      return { created: false, reason: 'existing-server-config', path: target };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await fsp.mkdir(config, { recursive: true });
  const temporary = join(config, `.nats-writer-cohort-${randomUUID()}`);
  const file = await fsp.open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(DEFAULT)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await fsp.link(temporary, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { created: false, reason: 'already-declared', path: target };
    }
  } finally {
    await fsp.unlink(temporary);
  }
  return { created: true, reason: 'fresh-single-node', path: target };
}
