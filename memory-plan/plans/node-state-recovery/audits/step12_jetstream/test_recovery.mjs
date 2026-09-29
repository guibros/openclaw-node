import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { api, capture, cliBackup, cliRestore, consumerState, copyCold, digest, hashTree, jsonPrivate, openBus, privateDir, run, writePrivate } from './recovery.mjs';
const { headers } = createRequire(import.meta.url)('nats');
process.umask(0o077);
const cli = process.argv[2] || '/opt/homebrew/bin/nats';
const binary = process.argv[3] || '/opt/homebrew/bin/nats-server';
const root = fs.mkdtempSync(path.join(process.env.RECOVERY_EVIDENCE_DIR || os.tmpdir(), 'openclaw-jetstream-fixture-'));
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
  const item = { proc, name, client, monitor, route, store, config }; processes.push(item);
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
    try { await Promise.race([ended, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error(`owned server failed graceful stop: ${path.basename(item.config)}`)), 10000); })]); }
    finally { clearTimeout(deadline); }
  }
  assert.equal(item.proc.exitCode, 0, 'owned server did not exit normally');
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

function placementState(observations, names) {
  const expected = [...names].sort();
  const ids = new Set(observations.map(row => row.js.server_id));
  const leaders = new Set(observations.map(row => row.js.meta_cluster?.leader));
  const leader = observations.find(row => row.name === row.js.meta_cluster?.leader)?.js.meta_cluster;
  const checks = {
    cohort: observations.length === names.length
      && JSON.stringify(observations.map(row => row.name).sort()) === JSON.stringify(expected),
    identities: ids.size === names.length && observations.every(({ name, js, routes, varz }) =>
      varz.server_name === name && varz.server_id === js.server_id && routes.server_id === js.server_id),
    leaderAgreement: leaders.size === 1 && typeof [...leaders][0] === 'string',
    membership: Array.isArray(leader?.replicas)
      && JSON.stringify([leader.leader, ...leader.replicas.map(peer => peer.name)].sort()) === JSON.stringify(expected),
    currentPeers: Array.isArray(leader?.replicas) && leader.replicas.length === names.length - 1
      && leader.replicas.every(peer => peer.current && !peer.offline),
    clusterSizes: observations.every(row => row.js.meta_cluster?.cluster_size === names.length),
    routePeers: observations.every(row => new Set(row.routes.routes.map(peer => peer.remote_id)).size === names.length - 1),
    confinedRoutes: observations.every(row => row.routes.routes.every(peer =>
      peer.ip === '127.0.0.1' && peer.remote_id !== row.js.server_id && ids.has(peer.remote_id)))
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

function placementCounterexamples(observations, names) {
  assert(placementState(observations, names).ready);
  const variants = {
    cohort: rows => { const row = rows.find(row => row.name !== row.js.meta_cluster.leader); row.name = row.varz.server_name = 'member-foreign'; },
    identities: rows => { rows[0].varz.server_id = 'foreign-server-id'; },
    membership: rows => { rows.find(row => row.name === row.js.meta_cluster.leader).js.meta_cluster.replicas[0].name = 'member-foreign'; },
    currentPeers: rows => { rows.find(row => row.name === row.js.meta_cluster.leader).js.meta_cluster.replicas[0].current = false; },
    routePeers: rows => { const id = rows[0].routes.routes[0].remote_id; rows[0].routes.routes = rows[0].routes.routes.filter(peer => peer.remote_id !== id); },
    leaderAgreement: rows => { rows.find(row => row.name !== row.js.meta_cluster.leader).js.meta_cluster.leader = 'disagreeing-leader'; },
    clusterSizes: rows => { for (const row of rows) row.js.meta_cluster.cluster_size = 2; },
    confinedRoutes: rows => { rows[0].routes.routes[0].ip = '198.51.100.2'; }
  };
  const results = {};
  for (const [predicate, mutate] of Object.entries(variants)) {
    const rows = structuredClone(observations);
    mutate(rows);
    const state = placementState(rows, names);
    assert.equal(state.ready, false);
    assert.deepEqual(Object.keys(state.checks).filter(key => !state.checks[key]), [predicate]);
    results[predicate] = state;
  }
  return results;
}

async function waitCluster(items, names, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  let observations;
  while (Date.now() < end) {
    const read = async (item, endpoint) => {
      const response = await fetch(`http://127.0.0.1:${item.monitor}/${endpoint}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2000, end - Date.now())))
      });
      assert(response.ok);
      return response.json();
    };
    try {
      observations = await Promise.all(items.map(async item => ({
        name: item.name, js: await read(item, 'jsz'), routes: await read(item, 'routez'), varz: await read(item, 'varz')
      })));
    } catch (error) {
      if (error.name === 'TimeoutError' && Date.now() >= end) break;
      throw error;
    }
    if (placementState(observations, names).ready) return observations;
    await delay(Math.min(50, Math.max(0, end - Date.now())));
  }
  throw new Error('owned placement cluster not ready');
}

const provenance = [cli, binary].map(file => ({ path: fs.realpathSync(file), version: execFileSync(file, ['--version'], { encoding: 'utf8' }).trim(), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
const results = {};
const emptySource = path.join(root, 'empty-directory-source'); privateDir(path.join(emptySource, 'nested-empty'));
const emptyCopy = path.join(root, 'empty-directory-copy'); copyCold(emptySource, emptyCopy);
assert(hashTree(emptyCopy).some(entry => entry.path === 'nested-empty' && entry.type === 'directory'));
fs.rmdirSync(path.join(emptyCopy, 'nested-empty'));
assert.notDeepEqual(hashTree(emptyCopy), hashTree(emptySource));
results.emptyDirectories = true;
let passed = false;
let phase = 'snapshot-history';
const originalRecord = { seq: 1, subject: 'history.x', time: '2026-09-28T00:00:00.123456789Z', hdrs: Buffer.from('NATS/1.0\r\nX-Key: a\r\n\r\n').toString('base64'), data: Buffer.from([0, 255, 1]).toString('base64') };
const fakeBus = record => ({ request: async () => ({ data: Buffer.from(JSON.stringify({ message: record })) }) });
const baseDigest = await digest(fakeBus(originalRecord), 'fixture', 1, 1);
for (const [key, value] of Object.entries({ subject: 'history.y', time: '2026-09-28T00:00:00.123456788Z', hdrs: Buffer.from('NATS/1.0\r\nX-Key: b\r\n\r\n').toString('base64'), data: Buffer.from([0, 255, 2]).toString('base64') })) {
  assert.notEqual((await digest(fakeBus({ ...originalRecord, [key]: value }), 'fixture', 1, 1)).sha256, baseDigest.sha256, `digest ignores ${key}`);
}
const holeBus = { request: async () => ({ data: Buffer.from(JSON.stringify({ error: { code: 404, err_code: 10037, description: 'no message found' } })) }) };
assert.notEqual((await digest(holeBus, 'fixture', 1, 1)).sha256, baseDigest.sha256);
const mismatchedDeletes = {
  request: async (subject, data) => ({ data: Buffer.from(JSON.stringify(subject.includes('.INFO.')
    ? { config: {}, state: { messages: 1, first_seq: 1, last_seq: 2, bytes: 3, num_deleted: 1, deleted: [1] } }
    : JSON.parse(Buffer.from(data)).seq === 1 ? { message: originalRecord } : { error: { code: 404, err_code: 10037 } })) }),
  jetstreamManager: async () => ({ consumers: { list: async function* () {} } })
};
await assert.rejects(capture(mismatchedDeletes, 'fixture'), /deleted sequences differ/);
results.digestSensitivity = { subject: true, nanosecondTimestamp: true, rawHeaders: true, binaryPayload: true, deletedHole: true };
results.deletedListMismatchRejected = true;
try {
  const source = await start('snapshot-source', path.join(root, 'source'));
  const nc = await bus(source), js = nc.jetstream(), jsm = await nc.jetstreamManager();
  await jsm.streams.add({ name: 'HISTORY', subjects: ['history.>'], storage: 'file', num_replicas: 1, compression: 's2', allow_msg_ttl: true, subject_delete_marker_ttl: 2000000000, allow_direct: true, max_msgs_per_subject: 5, discard: 'new', duplicate_window: 7000000000, metadata: { fixture: 'nondefault' } });
  for (let i = 1; i <= 12; i++) {
    const h = headers(); h.append('X-Fixture', 'first'); h.append('X-Fixture', 'second');
    await js.publish('history.' + (i % 3), Buffer.from([0, 255, i, 13, 10]), { headers: h });
  }
  await jsm.streams.deleteMessage('HISTORY', 3); await jsm.streams.deleteMessage('HISTORY', 8);
  await jsm.consumers.add('HISTORY', { durable_name: 'drained', ack_policy: 'explicit', deliver_policy: 'all', backoff: [1000000000, 2000000000], max_ack_pending: 7, max_deliver: 4, ack_wait: 5000000000, filter_subject: 'history.>', metadata: { fixture: 'consumer-nondefault' } });
  const consumer = await js.consumers.get('HISTORY', 'drained');
  for (let i = 0; i < 4; i++) { const m = await consumer.next({ expires: 1000 }); assert(m); assert(await m.ackAck()); }
  await jsm.consumers.add('HISTORY', { durable_name: 'pending', ack_policy: 'explicit', deliver_policy: 'all', ack_wait: 1000000000 });
  const pending = await js.consumers.get('HISTORY', 'pending');
  assert(await pending.next({ expires: 1000 }));
  const original = await capture(nc, 'HISTORY');
  const backup = path.join(root, 'snapshot-HISTORY');
  const metadata = await cliBackup(cli, `nats://127.0.0.1:${source.client}`, token, 'HISTORY', backup);
  for (const key of ['compression', 'allow_msg_ttl', 'subject_delete_marker_ttl', 'allow_direct', 'max_msgs_per_subject', 'discard', 'duplicate_window']) assert.deepEqual(metadata.config[key], original.config[key], `non-default config lost: ${key}`);
  assert.equal(metadata.config.metadata.fixture, 'nondefault');
  jsonPrivate(path.join(root, 'backup-metadata.json'), metadata);
  const restoredServer = await start('snapshot-restored', path.join(root, 'restored'));
  const restoredNC = await bus(restoredServer);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, backup);
  const restored = await capture(restoredNC, 'HISTORY');
  assert.deepEqual(restored.content, original.content);
  assert.deepEqual(restored.config, original.config);
  for (const key of ['messages', 'bytes', 'first_seq', 'last_seq', 'num_deleted', 'deleted']) assert.deepEqual(restored.state[key], original.state[key]);
  assert.deepEqual(restored.consumers, original.consumers);
  assert.deepEqual(restored.content.holes, [3, 8]);
  await delay(1100);
  const replay = await (await restoredNC.jetstream().consumers.get('HISTORY', 'pending')).next({ expires: 2000 });
  assert.equal(replay.info.streamSequence, 1); assert(replay.info.redelivered); assert(await replay.ackAck());
  results.snapshot = { messages: restored.content.messages, holes: restored.content.holes, sha256: restored.content.sha256, exactHeadersAndTimestamps: true, consumerPositions: true, pendingRedelivery: true };
  results.nondefaultConfig = { archiveValuesRetained: true, streamConfigExact: true, consumerConfigExact: true };

  const kv = await js.views.kv('FIXTURE', { history: 3, ttl: 60000, storage: 'file' });
  for (let i = 0; i < 5; i++) await kv.put('revisions', Buffer.from('revision-' + i));
  await kv.put('deleted', Buffer.from('old')); await kv.delete('deleted');
  await kv.put('purged', Buffer.from('old')); await kv.purge('purged');
  const kvOriginal = await capture(nc, 'KV_FIXTURE');
  const kvBackup = path.join(root, 'snapshot-KV');
  await cliBackup(cli, `nats://127.0.0.1:${source.client}`, token, 'KV_FIXTURE', kvBackup);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, kvBackup);
  const kvRestored = await capture(restoredNC, 'KV_FIXTURE');
  assert.deepEqual(kvRestored.content, kvOriginal.content);
  assert.deepEqual(kvRestored.config, kvOriginal.config);
  const restoredKV = await restoredNC.jetstream().views.kv('FIXTURE', { bindOnly: true });
  assert.equal((await restoredKV.get('revisions')).string(), 'revision-4');
  assert.equal((await restoredKV.get('deleted')).operation, 'DEL');
  assert.equal((await restoredKV.get('purged')).operation, 'PURGE');
  results.keyValue = { revisions: true, deleteMarker: true, purgeMarker: true, originalTTL: true, exactContent: true };

  await jsm.streams.add({ name: 'HEALTH', subjects: ['health'], storage: 'file', max_age: 1500000000 });
  await js.publish('health', Buffer.from('fixture-health'));
  const healthBackup = path.join(root, 'snapshot-HEALTH');
  await cliBackup(cli, `nats://127.0.0.1:${source.client}`, token, 'HEALTH', healthBackup);
  await delay(1600);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, healthBackup);
  for (let i = 0; i < 30; i++) {
    const info = await api(restoredNC, '$JS.API.STREAM.INFO.HEALTH');
    if (info.state.messages === 0) break;
    await delay(100);
  }
  const health = await capture(restoredNC, 'HEALTH');
  assert.equal(health.state.messages, 0); assert.equal(health.state.last_seq, 1);
  results.expiry = { messages: 0, last: 1, policy: 'original TTL applies on restore; no revived liveness' };
  for (let i = 0; i < 30; i++) {
    if ((await api(nc, '$JS.API.STREAM.INFO.HEALTH')).state.messages === 0) break;
    await delay(100);
  }
  assert.equal((await api(nc, '$JS.API.STREAM.INFO.HEALTH')).state.messages, 0);

  const driverTarget = path.join(root, 'driver-snapshots');
  await run(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'take_snapshots.mjs'), `nats://127.0.0.1:${source.client}`, driverTarget, cli], { env: { ...process.env, NATS_TOKEN: token }, stdio: 'ignore' });
  const driverManifest = JSON.parse(fs.readFileSync(path.join(driverTarget, 'manifest.json')));
  assert.equal(driverManifest.streams.find(s => s.stream === 'HISTORY').snapshot.state.messages, 10);
  assert.equal(driverManifest.streams.find(s => s.stream === 'HEALTH').snapshot.state.messages, 0);
  results.deployedSnapshotDriver = true;
  await nc.close(); await stop(source);
  const cold = path.join(root, 'master-standalone'); const coldHashes = copyCold(source.store, cold);
  const working = path.join(root, 'working-standalone'); copyCold(cold, working);
  const clone = await start('snapshot-source', working), cloneNC = await bus(clone);
  const coldRestored = await capture(cloneNC, 'HISTORY');
  assert.deepEqual(coldRestored.content, original.content);
  assert.deepEqual(coldRestored.consumers, original.consumers);
  assert.deepEqual(hashTree(cold), coldHashes);
  results.coldStandalone = { immutableMaster: true, contentMatches: true };

  const selected = await ports(9), triples = [selected.slice(0, 3), selected.slice(3, 6), selected.slice(6, 9)];
  const routes = triples.map(p => p[2]);
  const members = [];
  phase = 'cluster-placement-readiness';
  const memberNames = ['member-1', 'member-2', 'member-3'];
  for (let i = 0; i < 2; i++) members.push(await start(memberNames[i], path.join(root, 'cluster-' + (i + 1)), routes, triples[i]));
  const partial = await waitCluster(members, memberNames.slice(0, 2));
  const missing = placementState(partial, memberNames);
  assert.equal(missing.ready, false);
  for (const predicate of ['currentPeers', 'clusterSizes', 'routePeers']) assert.equal(missing.checks[predicate], false);
  jsonPrivate(path.join(root, 'cluster-placement-incomplete.json'), { observations: partial, evaluation: missing });
  await assert.rejects(waitCluster(members, memberNames, 500), /owned placement cluster not ready/);
  results.incompletePlacementClusterRejected = true;
  members.push(await start(memberNames[2], path.join(root, 'cluster-3'), routes, triples[2]));
  const ready = await waitCluster(members, memberNames);
  jsonPrivate(path.join(root, 'cluster-placement-ready.json'), ready);
  results.placementPredicateNegatives = placementCounterexamples(ready, memberNames);
  const memberNC = await bus(members[0]);
  const manager = await memberNC.jetstreamManager();
  phase = 'cluster-offline-r1-create';
  await manager.streams.add({ name: 'OFFLINE_R1', subjects: ['offline'], storage: 'file', num_replicas: 1, placement: { cluster: 'recovery-fixture', tags: [] } });
  const located = await waitInfo(memberNC, 'OFFLINE_R1');
  const ownerName = located.cluster.leader, owner = members.find(i => fs.readFileSync(i.config, 'utf8').includes(`server_name: ${ownerName}\n`)); assert(owner);
  for (let i = 0; i < 7; i++) await memberNC.jetstream().publish('offline', Buffer.from('record-' + i));
  await manager.consumers.add('OFFLINE_R1', { durable_name: 'offline-drained', ack_policy: 'explicit', deliver_policy: 'all' });
  const offlineConsumer = await memberNC.jetstream().consumers.get('OFFLINE_R1', 'offline-drained');
  for (let i = 0; i < 3; i++) { const m = await offlineConsumer.next({ expires: 1000 }); assert(await m.ackAck()); }
  const offlineOriginal = await capture(memberNC, 'OFFLINE_R1');
  await assertRoutes(members);
  await assert.rejects(assertRoutes(members.slice(0, 2)), /route escaped fixture peers/);
  phase = 'cluster-replicated-r3-create';
  await manager.streams.add({ name: 'REPLICATED', subjects: ['replicated'], storage: 'file', num_replicas: 3 });
  phase = 'cluster-empty-r3-create';
  await manager.streams.add({ name: 'EMPTY_R3', subjects: ['empty'], storage: 'file', num_replicas: 3 });
  const emptyOriginal = await capture(memberNC, 'EMPTY_R3');
  const emptyBackup = path.join(root, 'snapshot-EMPTY-R3');
  await cliBackup(cli, `nats://127.0.0.1:${members[0].client}`, token, 'EMPTY_R3', emptyBackup);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, emptyBackup, 1);
  const emptyRestored = await capture(restoredNC, 'EMPTY_R3');
  assert.deepEqual(emptyRestored.content, emptyOriginal.content);
  assert.deepEqual(emptyRestored.state, emptyOriginal.state);
  results.emptyStream = true;
  for (let i = 0; i < 3; i++) await memberNC.jetstream().publish('replicated', Buffer.from('R3-' + i));
  const replicated = await capture(memberNC, 'REPLICATED');
  const replicatedBackup = path.join(root, 'snapshot-REPLICATED');
  const replicatedMeta = await cliBackup(cli, `nats://127.0.0.1:${members[0].client}`, token, 'REPLICATED', replicatedBackup);
  assert.equal(replicatedMeta.config.num_replicas, 3);
  await cliRestore(cli, `nats://127.0.0.1:${restoredServer.client}`, token, replicatedBackup, 1);
  const r1restored = await capture(restoredNC, 'REPLICATED');
  assert.deepEqual(r1restored.content, replicated.content);
  assert.equal(r1restored.config.num_replicas, 1);
  assert.deepEqual({ ...r1restored.config, num_replicas: 3 }, replicated.config);
  results.replicaOverride = { source: 3, isolatedRestore: 1, contentMatches: true, unexpectedPeerDetected: true };
  await memberNC.close(); await stop(owner);
  const survivors = members.filter(m => m !== owner);
  const survivorNC = await bus(survivors[0]);
  await waitOffline(survivorNC, 'OFFLINE_R1');
  const offlineTarget = path.join(root, 'driver-offline');
  await run(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'take_snapshots.mjs'), `nats://127.0.0.1:${survivors[0].client}`, offlineTarget, cli, 'OFFLINE_R1'], { env: { ...process.env, NATS_TOKEN: token }, stdio: 'ignore' });
  const offlineManifest = JSON.parse(fs.readFileSync(path.join(offlineTarget, 'manifest.json')));
  assert.equal(offlineManifest.streams.find(s => s.stream === 'OFFLINE_R1').offline, true);
  assert.equal(offlineManifest.streams.find(s => s.stream === 'REPLICATED').snapshot.state.messages, 3);
  results.offlineSnapshotDriver = true;
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
  const clusterRestored = await capture(isolatedNC, 'OFFLINE_R1');
  assert.deepEqual(clusterRestored.content, offlineOriginal.content);
  assert.deepEqual(clusterRestored.consumers, offlineOriginal.consumers);
  await delay(1100);
  assert.deepEqual((await capture(isolatedNC, 'OFFLINE_R1')).consumers, offlineOriginal.consumers);
  await assertRoutes(cloned);
  for (let i = 0; i < 3; i++) assert.deepEqual(hashTree(masters[i]), hashes[i]);
  results.offlineR1 = { messages: 7, remappedThreeMemberCluster: true, immutableMasters: true, routesConfined: true };
  const singleWorking = path.join(root, 'working-offline-single'); copyCold(masters[oi], singleWorking);
  const singleMember = await start('member-' + (oi + 1), singleWorking);
  const singleNC = await bus(singleMember);
  const standaloneMemberContent = await capture(singleNC, 'OFFLINE_R1');
  assert.deepEqual(standaloneMemberContent.content, offlineOriginal.content);
  assert.deepEqual(standaloneMemberContent.consumers, offlineOriginal.consumers);
  results.offlineR1.nonClusteredLoad = true;
  assert.deepEqual(hashTree(masters[oi]), hashes[oi]);
  await stop(cloned.find(m => m.store === path.join(root, 'working-member-' + oi)));
  await waitOffline(isolatedNC, 'OFFLINE_R1');
  await (await isolatedNC.jetstreamManager()).streams.delete('OFFLINE_R1');
  await assert.rejects(waitOffline(isolatedNC, 'OFFLINE_R1'), err => err.api?.code === 404);
  assert.deepEqual(hashTree(masters[oi]), hashes[oi]);
  results.deletedAssignmentRefusesRejoin = true;
  passed = true;
} catch (err) {
  jsonPrivate(path.join(root, 'FAILED.json'), { at: new Date().toISOString(), phase, error: err.message });
  console.error('Owned fixture failure phase:', phase);
  console.error('Fixture evidence retained at', root);
  throw err;
} finally {
  const failures = [];
  for (const nc of connections) {
    try { await nc.close(); }
    catch (err) { failures.push({ connection: 'owned fixture', error: err.message }); }
  }
  for (const item of processes) {
    try { await stop(item); }
    catch (err) {
      failures.push({ config: path.basename(item.config), error: err.message });
      if (item.proc.exitCode === null && item.proc.signalCode === null) {
        const ended = once(item.proc, 'exit'); item.proc.kill('SIGKILL'); await ended;
      }
    }
  }
  jsonPrivate(path.join(root, 'cleanup.json'), { allOwnedProcessesExited: processes.every(i => i.proc.exitCode !== null || i.proc.signalCode !== null), failures });
  assert.equal(failures.length, 0, 'owned cleanup failed; no clean acceptance');
}

assert(passed);
const acceptance = { pass: true, at: new Date().toISOString(), root, provenance, results, allOwnedServersStopped: true };
jsonPrivate(path.join(root, 'acceptance.json'), acceptance);
console.log(JSON.stringify(acceptance, null, 2));
