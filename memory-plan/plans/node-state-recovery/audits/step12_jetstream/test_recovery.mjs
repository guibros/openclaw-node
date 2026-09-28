import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { api, capture, cliBackup, cliRestore, consumerState, copyCold, digest, hashTree, jsonPrivate, openBus, privateDir, run, writePrivate } from './recovery.mjs';
const { headers } = createRequire(import.meta.url)('nats');
process.umask(0o077);
const cli = process.argv[2] || '/opt/homebrew/bin/nats';
const binary = process.argv[3] || '/opt/homebrew/bin/nats-server';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-jetstream-fixture-'));
privateDir(root);
const token = randomBytes(32).toString('hex');
const routeToken = randomBytes(32).toString('hex');
const processes = [], connections = [];
const forbidden = new Set([4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ports(n) {
  const held = [];
  for (let i = 0; i < n; i++) {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    held.push(socket);
  }
  const numbers = held.map(s => s.address().port);
  assert(numbers.every(p => !forbidden.has(p)));
  await Promise.all(held.map(s => new Promise(resolve => s.close(resolve))));
  return numbers;
}

async function start(name, store, clusterPorts, selected) {
  const [client, monitor, route] = selected || await ports(3);
  privateDir(store);
  const config = path.join(root, name + '-' + client + '.conf');
  let text = `server_name: ${name}\nlisten: 127.0.0.1:${client}\nhttp: 127.0.0.1:${monitor}\nauthorization { token: "${token}" }\njetstream { store_dir: "${store}", max_memory_store: 1GB, max_file_store: 2GB }\n`;
  if (clusterPorts) text += `cluster { name: recovery-fixture, listen: 127.0.0.1:${route}, no_advertise: true, authorization { user: recovery, password: "${routeToken}" }, routes: [${clusterPorts.filter(p => p !== route).map(p => `"nats-route://recovery:${routeToken}@127.0.0.1:${p}"`).join(',')}] }\n`;
  writePrivate(config, text);
  const fd = fs.openSync(config + '.log', 'wx', 0o600);
  const proc = spawn(binary, ['--config', config], { stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
  const item = { proc, client, monitor, route, store, config }; processes.push(item);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (proc.exitCode !== null) throw new Error(`owned server exited: ${name}`);
    try { const response = await fetch(`http://127.0.0.1:${monitor}/healthz?js-enabled-only=true`); if (response.ok) return item; } catch {}
    await delay(50);
  }
  throw new Error(`owned server startup timeout: ${name}`);
}

async function stop(item) {
  if (item.proc.exitCode === null && item.proc.signalCode === null) {
    const ended = once(item.proc, 'exit'); item.proc.kill('SIGTERM');
    let deadline;
    try { await Promise.race([ended, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('owned server failed graceful stop')), 10000); })]); }
    finally { clearTimeout(deadline); }
  }
  assert.match(fs.readFileSync(item.config + '.log', 'utf8'), /Server Exiting/);
}

async function bus(item) { const nc = await openBus(`nats://127.0.0.1:${item.client}`, token); connections.push(nc); return nc; }

async function waitInfo(nc, stream) {
  for (let i = 0; i < 150; i++) {
    try { return await api(nc, `$JS.API.STREAM.INFO.${stream}`); } catch {}
    await delay(50);
  }
  throw new Error(`stream not available: ${stream}`);
}

async function waitOffline(nc, stream) {
  for (let i = 0; i < 30; i++) {
    try { await api(nc, `$JS.API.STREAM.INFO.${stream}`, {}, 1000); }
    catch (err) { if (err.api?.code === 500) return; if (err.code !== 'TIMEOUT') throw err; }
    await delay(100);
  }
  throw new Error('Expected offline assignment was not observed');
}

async function assertRoutes(items) {
  const allowed = new Set(await Promise.all(items.map(async i => (await (await fetch(`http://127.0.0.1:${i.monitor}/varz`)).json()).server_id))); 
  for (const item of items) {
    const routes = await (await fetch(`http://127.0.0.1:${item.monitor}/routez`)).json();
    assert(routes.routes.every(r => r.ip === '127.0.0.1' && allowed.has(r.remote_id)), 'route escaped fixture peers');
    assert.equal((await (await fetch(`http://127.0.0.1:${item.monitor}/leafz`)).json()).leafnodes, 0);
    const gateways = await (await fetch(`http://127.0.0.1:${item.monitor}/gatewayz`)).json();
    assert.equal(Object.keys(gateways.outbound_gateways || {}).length, 0);
    assert.equal(Object.keys(gateways.inbound_gateways || {}).length, 0);
  }
}

const results = {};
let passed = false;
const originalRecord = { seq: 1, subject: 'history.x', time: '2026-09-28T00:00:00.123456789Z', hdrs: Buffer.from('NATS/1.0\r\nX-Key: a\r\n\r\n').toString('base64'), data: Buffer.from([0, 255, 1]).toString('base64') };
const fakeBus = record => ({ request: async () => ({ data: Buffer.from(JSON.stringify({ message: record })) }) });
const baseDigest = await digest(fakeBus(originalRecord), 'fixture', 1, 1);
for (const [key, value] of Object.entries({ subject: 'history.y', time: '2026-09-28T00:00:00.123456788Z', hdrs: Buffer.from('NATS/1.0\r\nX-Key: b\r\n\r\n').toString('base64'), data: Buffer.from([0, 255, 2]).toString('base64') })) {
  assert.notEqual((await digest(fakeBus({ ...originalRecord, [key]: value }), 'fixture', 1, 1)).sha256, baseDigest.sha256, `digest ignores ${key}`);
}
results.digestSensitivity = { subject: true, nanosecondTimestamp: true, rawHeaders: true, binaryPayload: true };
try {
  const source = await start('snapshot-source', path.join(root, 'source'));
  const nc = await bus(source), js = nc.jetstream(), jsm = await nc.jetstreamManager();
  await jsm.streams.add({ name: 'HISTORY', subjects: ['history.>'], storage: 'file', num_replicas: 1 });
  for (let i = 1; i <= 12; i++) {
    const h = headers(); h.append('X-Fixture', 'first'); h.append('X-Fixture', 'second');
    await js.publish('history.' + (i % 3), Buffer.from([0, 255, i, 13, 10]), { headers: h });
  }
  await jsm.streams.deleteMessage('HISTORY', 3); await jsm.streams.deleteMessage('HISTORY', 8);
  await jsm.consumers.add('HISTORY', { durable_name: 'drained', ack_policy: 'explicit', deliver_policy: 'all' });
  const consumer = await js.consumers.get('HISTORY', 'drained');
  for (let i = 0; i < 4; i++) { const m = await consumer.next({ expires: 1000 }); assert(m); assert(await m.ackAck()); }
  await jsm.consumers.add('HISTORY', { durable_name: 'pending', ack_policy: 'explicit', deliver_policy: 'all', ack_wait: 1000000000 });
  const pending = await js.consumers.get('HISTORY', 'pending');
  assert(await pending.next({ expires: 1000 }));
  const original = await capture(nc, 'HISTORY');
  const backup = path.join(root, 'snapshot-HISTORY');
  const metadata = await cliBackup(cli, `nats://127.0.0.1:${source.client}`, token, 'HISTORY', backup);
  jsonPrivate(path.join(root, 'backup-metadata.json'), metadata);
  const restoredServer = await start('snapshot-restored', path.join(root, 'restored'));
  const restoredNC = await bus(restoredServer);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, backup);
  const restored = await capture(restoredNC, 'HISTORY');
  assert.deepEqual(restored.content, original.content);
  assert.deepEqual(restored.config, original.config);
  assert.deepEqual(restored.consumers, original.consumers);
  assert.deepEqual(restored.content.holes, [3, 8]);
  await delay(1100);
  const replay = await (await restoredNC.jetstream().consumers.get('HISTORY', 'pending')).next({ expires: 2000 });
  assert.equal(replay.info.streamSequence, 1); assert(replay.info.redelivered); assert(await replay.ackAck());
  results.snapshot = { messages: restored.content.messages, holes: restored.content.holes, sha256: restored.content.sha256, exactHeadersAndTimestamps: true, consumerPositions: true, pendingRedelivery: true };

  await jsm.streams.add({ name: 'HEALTH', subjects: ['health'], storage: 'file', max_age: 1500000000 });
  await js.publish('health', Buffer.from('fixture-health'));
  const healthBackup = path.join(root, 'snapshot-HEALTH');
  await cliBackup(cli, `nats://127.0.0.1:${source.client}`, token, 'HEALTH', healthBackup);
  await delay(1600);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, healthBackup);
  const health = await capture(restoredNC, 'HEALTH');
  assert.equal(health.state.messages, 0); assert.equal(health.state.last_seq, 1);
  results.expiry = { messages: 0, last: 1, policy: 'original TTL applies on restore; no revived liveness' };

  const driverTarget = path.join(root, 'driver-snapshots');
  await run(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'take_snapshots.mjs'), `nats://127.0.0.1:${source.client}`, driverTarget, cli], { env: { ...process.env, NATS_TOKEN: token }, stdio: 'ignore' });
  const driverManifest = JSON.parse(fs.readFileSync(path.join(driverTarget, 'manifest.json')));
  assert.equal(driverManifest.streams.find(s => s.stream === 'HISTORY').snapshot.state.messages, 10);
  assert.equal(driverManifest.streams.find(s => s.stream === 'HEALTH').snapshot.state.messages, 0);
  results.deployedSnapshotDriver = true;
  await nc.close(); await stop(source);
  const cold = path.join(root, 'master-standalone'); const coldHashes = copyCold(source.store, cold);
  const working = path.join(root, 'working-standalone'); copyCold(cold, working);
  const clone = await start('snapshot-source', working), cloneNC = await bus(clone);
  assert.deepEqual((await capture(cloneNC, 'HISTORY')).content, original.content);
  assert.deepEqual(hashTree(cold), coldHashes);
  results.coldStandalone = { immutableMaster: true, contentMatches: true };

  const selected = await ports(9), triples = [selected.slice(0, 3), selected.slice(3, 6), selected.slice(6, 9)];
  const routes = triples.map(p => p[2]);
  const members = [];
  for (let i = 0; i < 3; i++) members.push(await start('member-' + (i + 1), path.join(root, 'cluster-' + (i + 1)), routes, triples[i]));
  const memberNC = await bus(members[0]);
  for (let i = 0; i < 100; i++) {
    const state = await (await fetch(`http://127.0.0.1:${members[0].monitor}/jsz`)).json();
    if (['member-1', 'member-2', 'member-3'].includes(state.meta_cluster?.leader)) break;
    await delay(100);
  }
  const manager = await memberNC.jetstreamManager();
  await manager.streams.add({ name: 'OFFLINE_R1', subjects: ['offline'], storage: 'file', num_replicas: 1, placement: { cluster: 'recovery-fixture', tags: [] } });
  const located = await waitInfo(memberNC, 'OFFLINE_R1');
  const ownerName = located.cluster.leader, owner = members.find(i => fs.readFileSync(i.config, 'utf8').includes(`server_name: ${ownerName}\n`)); assert(owner);
  for (let i = 0; i < 7; i++) await memberNC.jetstream().publish('offline', Buffer.from('record-' + i));
  const offlineOriginal = await capture(memberNC, 'OFFLINE_R1');
  await assertRoutes(members);
  await assert.rejects(assertRoutes(members.slice(0, 2)), /route escaped fixture peers/);
  await manager.streams.add({ name: 'REPLICATED', subjects: ['replicated'], storage: 'file', num_replicas: 3 });
  for (let i = 0; i < 3; i++) await memberNC.jetstream().publish('replicated', Buffer.from('R3-' + i));
  const replicated = await capture(memberNC, 'REPLICATED');
  const replicatedBackup = path.join(root, 'snapshot-REPLICATED');
  const replicatedMeta = await cliBackup(cli, `nats://127.0.0.1:${members[0].client}`, token, 'REPLICATED', replicatedBackup);
  assert.equal(replicatedMeta.config.num_replicas, 3);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, replicatedBackup, 1);
  const r1restored = await capture(restoredNC, 'REPLICATED');
  assert.deepEqual(r1restored.content, replicated.content);
  assert.equal(r1restored.config.num_replicas, 1);
  results.replicaOverride = { source: 3, isolatedRestore: 1, contentMatches: true, unexpectedPeerDetected: true };
  await memberNC.close(); await stop(owner);
  const survivors = members.filter(m => m !== owner);
  const survivorNC = await bus(survivors[0]);
  await waitOffline(survivorNC, 'OFFLINE_R1');
  await survivorNC.close();
  for (const m of survivors) await stop(m);
  const masters = members.map((m, i) => path.join(root, 'master-member-' + i));
  const hashes = members.map((m, i) => copyCold(m.store, masters[i]));
  const clonePorts = await ports(9), cloneTriples = [clonePorts.slice(0, 3), clonePorts.slice(3, 6), clonePorts.slice(6, 9)];
  const cloned = [];
  for (let i = 0; i < 3; i++) copyCold(masters[i], path.join(root, 'working-member-' + i));
  for (let i = 0; i < 3; i++) {
    if (members[i] === owner) continue;
    cloned.push(await start('member-' + (i + 1), path.join(root, 'working-member-' + i), cloneTriples.map(p => p[2]), cloneTriples[i]));
  }
  const isolatedNC = await bus(cloned[0]);
  await waitOffline(isolatedNC, 'OFFLINE_R1');
  const names = await api(isolatedNC, '$JS.API.STREAM.NAMES');
  assert(names.streams.includes('OFFLINE_R1'), 'offline assignment was deleted');
  const oi = members.indexOf(owner);
  cloned.push(await start('member-' + (oi + 1), path.join(root, 'working-member-' + oi), cloneTriples.map(p => p[2]), cloneTriples[oi]));
  await waitInfo(isolatedNC, 'OFFLINE_R1');
  assert.deepEqual((await capture(isolatedNC, 'OFFLINE_R1')).content, offlineOriginal.content);
  await assertRoutes(cloned);
  for (let i = 0; i < 3; i++) assert.deepEqual(hashTree(masters[i]), hashes[i]);
  results.offlineR1 = { messages: 7, remappedThreeMemberCluster: true, immutableMasters: true, routesConfined: true };
  const singleWorking = path.join(root, 'working-offline-single'); copyCold(masters[oi], singleWorking);
  const singleMember = await start('member-' + (oi + 1), singleWorking);
  const singleNC = await bus(singleMember);
  const standaloneMemberContent = await capture(singleNC, 'OFFLINE_R1');
  assert.deepEqual(standaloneMemberContent.content, offlineOriginal.content);
  results.offlineR1.nonClusteredLoad = true;
  assert.deepEqual(hashTree(masters[oi]), hashes[oi]);
  jsonPrivate(path.join(root, 'acceptance.json'), results);
  passed = true;
} catch (err) {
  console.error('Fixture evidence retained at', root);
  throw err;
} finally {
  for (const nc of connections) await nc.close();
  for (const item of processes) if (item.proc.exitCode === null && item.proc.signalCode === null) await stop(item);
}

assert(passed);
console.log(JSON.stringify({ pass: true, root, results, allOwnedServersStopped: true }, null, 2));
