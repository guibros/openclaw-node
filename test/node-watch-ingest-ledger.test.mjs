import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeIngestLag } from '../lib/node-watch-ingest-ledger.mjs';

test('ingest lag survives restarts, ignores copied timestamps, and resets only on archive progress', async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-watch-lag-'));
  try {
    const file = join(home, 'forked.jsonl');
    const entry = (archivedCount, extra = {}) => ({ file, identity: '1:2:100:0:0',
      archivedCount, pending: true, inconsistent: false, ...extra });
    const observe = (value, now) => observeIngestLag(home, [value], [file], () => now);
    const start = 1_700_000_000_000;
    assert.deepEqual(observe(entry(0), start), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 3600_000), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 2 * 3600_000 + 1), { overdue: [file], lower: [] });
    assert.deepEqual(observe(entry(1), start + 2 * 3600_000 + 1), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 2 * 3600_000 + 1), { overdue: [], lower: [file] });
    assert.deepEqual(observe(entry(1, { identity: '1:3:100:0:0' }), start + 4 * 3600_000 + 2),
      { overdue: [file], lower: [] });
    assert.deepEqual(observeIngestLag(home, [], [file], () => start + 5 * 3600_000),
      { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 5 * 3600_000), { overdue: [file], lower: [file] });
    assert.deepEqual(observe(entry(0, { pending: false }), start + 7 * 3600_000),
      { overdue: [file], lower: [file] });
    assert.deepEqual(observe(entry(1, { pending: false }), start + 7 * 3600_000),
      { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 10 * 3600_000), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 9 * 3600_000), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 11 * 3600_000), { overdue: [], lower: [] });
    assert.deepEqual(observe(entry(0), start + 11 * 3600_000 + 1), { overdue: [file], lower: [] });
    assert.deepEqual(observeIngestLag(home, [], [], () => start + 11 * 3600_000 + 1), { overdue: [], lower: [] });
    const ledger = join(home, '.node-watch-ingest.sqlite');
    assert.equal((await stat(ledger)).mode & 0o077, 0);
    assert.ok((await readFile(ledger)).length > 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an unreadable ingest ledger refuses a verdict instead of erasing elapsed stall time', async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-watch-lag-corrupt-'));
  try {
    await writeFile(join(home, '.node-watch-ingest.sqlite'), 'not a SQLite database');
    assert.throws(() => observeIngestLag(home, [], [], Date.now));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('ingest ledger refuses links to another file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-watch-lag-link-'));
  try {
    const target = join(home, 'other');
    const ledger = join(home, '.node-watch-ingest.sqlite');
    await writeFile(target, 'untouched');
    await symlink(target, ledger);
    assert.throws(() => observeIngestLag(home, [], []));
    await rm(ledger);
    await link(target, ledger);
    assert.throws(() => observeIngestLag(home, [], []), /private regular file/);
    assert.equal(await readFile(target, 'utf8'), 'untouched');
  } finally { await rm(home, { recursive: true, force: true }); }
});
