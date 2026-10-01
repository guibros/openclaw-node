import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeNatsWriterCohort } from '../lib/nats-writer-cohort.mjs';

async function fixture(run) {
  const home = await fs.mkdtemp(join(tmpdir(), 'nats-cohort-'));
  try {
    await run(home, join(home, 'config', 'nats-writer-cohort.json'));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

describe('NATS cohort declaration', () => {
  it('atomically initializes a fresh single-node install with private mode', async () => fixture(async (home, target) => {
    const result = await initializeNatsWriterCohort(home);
    assert.equal(result.created, true);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')),
      { schema: 1, activeLabels: ['ai.openclaw.nats'] });
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readdir(join(home, 'config')), ['nats-writer-cohort.json']);
  }));

  it('does not infer singleton mode over an existing cluster or replace a declaration', async () => fixture(async (home, target) => {
    await fs.mkdir(join(home, 'config'));
    await fs.writeFile(join(home, 'config', 'nats-2.conf'), 'existing');
    assert.equal((await initializeNatsWriterCohort(home)).reason, 'existing-server-config');
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    const declaration = '{"schema":1,"activeLabels":["ai.openclaw.nats-1","ai.openclaw.nats-2","ai.openclaw.nats-3"]}\n';
    await fs.writeFile(target, declaration, { mode: 0o600 });
    assert.equal((await initializeNatsWriterCohort(home)).reason, 'already-declared');
    assert.equal(await fs.readFile(target, 'utf8'), declaration);
  }));
});
