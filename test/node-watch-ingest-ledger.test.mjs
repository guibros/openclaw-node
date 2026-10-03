import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeIngestLag } from '../lib/node-watch-ingest-ledger.mjs';

test('ingest lag survives restarts, ignores copied timestamps, and resets only on archive progress', async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-watch-lag-'));
  try {
    const file = join(home, 'forked.jsonl');
    const entry = (archivedCount, extra = {}) => ({ file, identity: '1:2:100:0:0',
      archivedCount, pending: true, inconsistent: false, ...extra });
    const observe = (value, now) => observeIngestLag(home, [value], [file], now);
    const start = 1_700_000_000_000;
    assert.deepEqual(observe(entry(0), start), { overdue: [], regressed: [] });
    assert.deepEqual(observe(entry(0), start + 3600_000), { overdue: [], regressed: [] });
    assert.deepEqual(observe(entry(0), start + 2 * 3600_000 + 1), { overdue: [file], regressed: [] });
    assert.deepEqual(observe(entry(1), start + 2 * 3600_000 + 1), { overdue: [], regressed: [] });
    assert.deepEqual(observe(entry(1), start + 4 * 3600_000 + 2), { overdue: [file], regressed: [] });
    assert.deepEqual(observe(entry(0), start + 4 * 3600_000 + 2), { overdue: [], regressed: [file] });
    assert.deepEqual(observe(entry(0, { identity: '1:3:100:0:0' }), start + 4 * 3600_000 + 2),
      { overdue: [], regressed: [] });
    assert.deepEqual(observeIngestLag(home, [], [file], start + 7 * 3600_000),
      { overdue: [], regressed: [] });
    assert.deepEqual(observe(entry(0, { identity: '1:3:100:0:0' }), start + 7 * 3600_000),
      { overdue: [file], regressed: [] });
    assert.deepEqual(observe(entry(0, { pending: false }), start + 7 * 3600_000),
      { overdue: [], regressed: [] });
    assert.deepEqual(observe(entry(0), start + 7 * 3600_000), { overdue: [], regressed: [] });
    assert.deepEqual(observeIngestLag(home, [], [], start + 7 * 3600_000), { overdue: [], regressed: [] });
    const ledger = join(home, '.node-watch-ingest.sqlite');
    assert.equal((await stat(ledger)).mode & 0o077, 0);
    assert.ok((await readFile(ledger)).length > 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an unreadable ingest ledger refuses a verdict instead of erasing elapsed stall time', async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-watch-lag-corrupt-'));
  try {
    await writeFile(join(home, '.node-watch-ingest.sqlite'), 'not a SQLite database');
    assert.throws(() => observeIngestLag(home, [], [], Date.now()));
  } finally { await rm(home, { recursive: true, force: true }); }
});
