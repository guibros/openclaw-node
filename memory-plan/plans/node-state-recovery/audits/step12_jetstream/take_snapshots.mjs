import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api, cliBackup, consumerState, hashTree, jsonPrivate, openBus, privateDir } from './recovery.mjs';
const [server, target, cli, offlineList = ''] = process.argv.slice(2);
assert(server && target && cli && process.env.NATS_TOKEN, 'usage: NATS_TOKEN=<local secret> node take_snapshots.mjs <loopback-server> <new-private-dir> <nats-cli> [known-offline-streams]');
assert(path.isAbsolute(target) && !fs.existsSync(target));
process.umask(0o077); privateDir(target);
const expectedOffline = new Set(offlineList.split(',').filter(Boolean));
const nc = await openBus(server, process.env.NATS_TOKEN);
async function names() {
  const list = [];
  for (let offset = 0;;) {
    const page = await api(nc, '$JS.API.STREAM.NAMES', { offset });
    list.push(...page.streams); offset += page.streams.length;
    if (offset >= page.total) break;
    assert(page.streams.length > 0);
  }
  return list.sort();
}
async function consumers(stream) {
  const jsm = await nc.jetstreamManager(), result = [];
  for await (const c of jsm.consumers.list(stream)) result.push(consumerState(c));
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
const manifest = { startedAt: new Date().toISOString(), server, streams: [] };
try {
  const originalNames = await names();
  for (const stream of originalNames) {
    assert(/^[A-Za-z0-9_-]+$/.test(stream));
    const startedAt = new Date().toISOString();
    let before;
    try { before = await api(nc, `$JS.API.STREAM.INFO.${stream}`, { deleted_details: true }); }
    catch (err) {
      if (expectedOffline.has(stream) && err.api?.code === 500 && err.api.description === 'stream is offline') {
        manifest.streams.push({ stream, startedAt, offline: true, error: err.api }); continue;
      }
      throw err;
    }
    assert(!expectedOffline.has(stream), 'previously offline stream unexpectedly returned; re-inventory before proceeding');
    const consumersBefore = await consumers(stream);
    const snapshot = await cliBackup(cli, server, process.env.NATS_TOKEN, stream, path.join(target, stream));
    const after = await api(nc, `$JS.API.STREAM.INFO.${stream}`, { deleted_details: true });
    manifest.streams.push({ stream, startedAt, finishedAt: new Date().toISOString(), before, snapshot, after, consumersBefore, consumersAfter: await consumers(stream) });
  }
  assert.deepEqual(await names(), originalNames, 'stream inventory changed during backup');
  for (const stream of expectedOffline) assert(originalNames.includes(stream), 'expected offline assignment is absent');
  manifest.finishedAt = new Date().toISOString();
  manifest.files = hashTree(target);
  jsonPrivate(path.join(target, 'manifest.json'), manifest);
  console.log(JSON.stringify({ target, streams: manifest.streams.map(s => ({ stream: s.stream, offline: !!s.offline, snapshotMessages: s.snapshot?.state.messages, snapshotLast: s.snapshot?.state.last_seq })) }));
} catch (err) {
  jsonPrivate(path.join(target, 'FAILED.json'), { at: new Date().toISOString(), error: err.message, partial: manifest });
  throw err;
} finally { await nc.close(); }
