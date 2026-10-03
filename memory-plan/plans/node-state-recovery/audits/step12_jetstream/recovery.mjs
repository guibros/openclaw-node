import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { connect } = createRequire(import.meta.url)('nats');

export function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && !(st.mode & 0o077));
}

export function writePrivate(file, data) {
  privateDir(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

export function jsonPrivate(file, data) {
  writePrivate(file, JSON.stringify(data, null, 2) + '\n');
}

export function localURL(server) {
  const u = new URL(server);
  assert(u.protocol === 'nats:' && u.hostname === '127.0.0.1' && u.port && !u.username && !u.password && !u.search && !u.hash && !u.pathname);
  return u.href;
}

export async function openBus(server, token) {
  return connect({ servers: localURL(server), token, reconnect: false, ignoreClusterUpdates: true, timeout: 3000, name: 'recovery-readonly-' + randomBytes(12).toString('hex') });
}

export async function api(nc, subject, data = {}, timeout = 10000) {
  const msg = await nc.request(subject, Buffer.from(JSON.stringify(data)), { timeout });
  const value = JSON.parse(Buffer.from(msg.data).toString());
  if (value.error) {
    const err = new Error(`JetStream ${value.error.code}/${value.error.err_code}: ${value.error.description}`);
    err.api = value.error;
    throw err;
  }
  return value;
}

function frame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(size); hash.update(bytes);
}

export async function digest(nc, stream, first, last) {
  const hash = createHash('sha256');
  let messages = 0, payloadBytes = 0;
  const holes = [];
  for (let seq = first; seq <= last; seq += 32) {
    const batch = await Promise.all(Array.from({ length: Math.min(32, last - seq + 1) }, async (_, i) => {
      const number = seq + i;
      try { return { number, message: (await api(nc, `$JS.API.STREAM.MSG.GET.${stream}`, { seq: number })).message }; }
      catch (err) { if (err.api?.err_code === 10037) return { number, message: null }; throw err; }
    }));
    for (const { number, message } of batch) {
      frame(hash, number);
      frame(hash, message ? 'message' : 'hole');
      if (!message) { holes.push(number); continue; }
      assert.equal(message.seq, number);
      frame(hash, message.subject); frame(hash, message.time);
      frame(hash, Buffer.from(message.hdrs || '', 'base64'));
      const bytes = Buffer.from(message.data || '', 'base64');
      frame(hash, bytes); payloadBytes += bytes.length; messages++;
    }
  }
  return { first, last, messages, payloadBytes, holes, sha256: hash.digest('hex') };
}

export function consumerState(info) {
  return {
    name: info.name, config: info.config,
    delivered: { consumer_seq: info.delivered.consumer_seq, stream_seq: info.delivered.stream_seq },
    ack_floor: { consumer_seq: info.ack_floor.consumer_seq, stream_seq: info.ack_floor.stream_seq },
    num_ack_pending: info.num_ack_pending, num_redelivered: info.num_redelivered,
    num_pending: info.num_pending
  };
}

export async function capture(nc, stream) {
  const before = await api(nc, `$JS.API.STREAM.INFO.${stream}`, { deleted_details: true });
  const jsm = await nc.jetstreamManager();
  const consumers = [];
  for await (const c of jsm.consumers.list(stream)) consumers.push(consumerState(c));
  consumers.sort((a, b) => a.name.localeCompare(b.name));
  const content = await digest(nc, stream, before.state.first_seq || 1, before.state.last_seq);
  const after = await api(nc, `$JS.API.STREAM.INFO.${stream}`, { deleted_details: true });
  for (const key of ['messages', 'first_seq', 'last_seq', 'bytes', 'num_deleted']) assert.equal(after.state[key], before.state[key], `stream changed during capture: ${key}`);
  assert.deepEqual(after.state.deleted, before.state.deleted, 'deleted sequences changed during capture');
  assert.equal(content.messages, before.state.messages);
  const deleted = before.state.deleted || [];
  assert.equal(deleted.length, before.state.num_deleted || 0);
  assert(deleted.every(seq => seq > 0 || (seq === 0 && before.state.messages === 0 && before.state.last_seq === 0)));
  assert.deepEqual(content.holes, deleted.filter(seq => seq >= content.first && seq <= content.last).sort((a, b) => a - b), 'deleted sequences differ from message-get holes');
  return { at: new Date().toISOString(), config: before.config, created: before.created, state: before.state, consumers, content };
}

export async function cliBackup(cli, server, token, stream, target) {
  assert(!fs.existsSync(target), 'backup target must be new');
  privateDir(path.dirname(target));
  const log = target + '.cli.log';
  const fd = fs.openSync(log, 'wx', 0o600);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NATS_')));
  env.NATS_TOKEN = token;
  const connectionName = 'recovery-backup-' + randomBytes(12).toString('hex');
  const argv = ['--no-context', '--server', localURL(server), '--connection-name', connectionName, '--timeout=30s', 'stream', 'backup', '--check', '--consumers', '--no-progress', stream, target];
  try { await run(cli, argv, { env, stdio: ['ignore', fd, fd] }); } finally { fs.closeSync(fd); }
  secureTree(target); durableTree(target);
  const metadata = JSON.parse(fs.readFileSync(path.join(target, 'backup.json')));
  metadata.harnessConnectionName = connectionName;
  assert(fs.statSync(path.join(target, 'stream.tar.s2')).size > 0);
  return metadata;
}

export async function cliRestore(cli, server, token, target, replicas) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NATS_')));
  env.NATS_TOKEN = token;
  const log = target + '.restore-' + randomBytes(6).toString('hex') + '.log';
  const fd = fs.openSync(log, 'wx', 0o600);
  const args = ['--no-context', '--server', localURL(server), '--connection-name', 'recovery-restore-' + randomBytes(12).toString('hex'), '--timeout=30s', 'stream', 'restore', '--no-progress'];
  if (replicas !== undefined) { assert(Number.isInteger(replicas) && replicas > 0); args.push('--replicas=' + replicas); }
  args.push(target);
  try { await run(cli, args, { env, stdio: ['ignore', fd, fd] }); } finally { fs.closeSync(fd); }
}

export function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const oldMask = process.umask(0o077);
    let proc;
    try { proc = spawn(binary, args, options); } finally { process.umask(oldMask); }
    const timer = setTimeout(() => proc.kill('SIGTERM'), 300000);
    proc.once('error', err => { clearTimeout(timer); reject(err); });
    proc.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${path.basename(binary)} failed: ${code}/${signal}`)); });
  });
}

export function secureTree(dir) {
  const st = fs.lstatSync(dir); assert(!st.isSymbolicLink());
  if (st.isDirectory()) {
    fs.chmodSync(dir, 0o700);
    for (const name of fs.readdirSync(dir)) secureTree(path.join(dir, name));
  } else { assert(st.isFile()); fs.chmodSync(dir, 0o600); }
}

export function hashTree(dir) {
  const st = fs.lstatSync(dir); assert(st.isDirectory() && !st.isSymbolicLink());
  const entries = [];
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), st = fs.lstatSync(file);
      assert(!st.isSymbolicLink());
      if (st.isDirectory()) { entries.push({ path: path.relative(dir, file), type: 'directory' }); walk(file); }
      else { assert(st.isFile()); entries.push({ path: path.relative(dir, file), type: 'file', size: st.size, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }); }
    }
  };
  walk(dir);
  return entries;
}

function sourceIdentity(dir) {
  const entries = [];
  const walk = current => {
    const st = fs.lstatSync(current, { bigint: true });
    assert(!st.isSymbolicLink() && (st.isDirectory() || st.isFile()));
    entries.push({
      path: path.relative(dir, current) || '.',
      type: st.isDirectory() ? 'directory' : 'file',
      device: st.dev.toString(), inode: st.ino.toString(),
      links: st.nlink.toString(), mode: st.mode.toString(),
      uid: st.uid.toString(), gid: st.gid.toString(),
      size: st.size.toString(), mtimeNs: st.mtimeNs.toString(),
      ctimeNs: st.ctimeNs.toString(),
    });
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name));
    }
  };
  walk(dir);
  return entries;
}

export function copyCold(source, target) {
  assert(!fs.existsSync(target));
  privateDir(path.dirname(target));
  const sourceBefore = sourceIdentity(source);
  const before = hashTree(source);
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
  secureTree(target);
  durableTree(target);
  assert.deepEqual(sourceIdentity(source), sourceBefore, 'source identity changed during cold copy');
  assert.deepEqual(hashTree(source), before, 'source changed during cold copy');
  assert.deepEqual(hashTree(target), before, 'copy content differs');
  const parent = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  return before;
}

export function durableTree(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name), st = fs.lstatSync(file);
    assert(!st.isSymbolicLink());
    if (st.isDirectory()) durableTree(file);
    else { assert(st.isFile()); const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  }
  const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
