#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const release = process.argv[2];
const nodeBinary = process.argv[3] || '/opt/homebrew/Cellar/node@22/22.22.0/bin/node';
assert.ok(release && fs.existsSync(path.join(release, 'consolidation-graph.json')), 'stage a release first');
const require = createRequire(path.join(release, 'package.json'));
const { connect } = require('nats');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-graph-probe-'));
fs.chmodSync(scratch, 0o700);
const home = path.join(scratch, 'home');
const workspace = path.join(scratch, 'workspace');
const vault = path.join(scratch, 'vault');
const obs = path.join(scratch, 'observability.db');
const ledger = path.join(scratch, 'notification-ledger.jsonl');
const notifierLog = path.join(scratch, 'notifier-executed.log');
const notifier = path.join(scratch, 'terminal-notifier');
const nodeId = `step38-${randomBytes(4).toString('hex')}`;
const token = randomBytes(24).toString('hex');
const children = [];
let llmHits = 0;
let llm;

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); }
async function freePort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function child(command, args, opts = {}) {
  const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  children.push(proc);
  return proc;
}
async function finished(proc, ms = 30000) {
  let out = '';
  let err = '';
  proc.stdout.on('data', chunk => { out += chunk; });
  proc.stderr.on('data', chunk => { err += chunk; });
  return await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`timed out: ${proc.spawnargs[0]}`)); }, ms);
    proc.once('error', error => { clearTimeout(deadline); reject(error); });
    proc.once('exit', (code, signal) => { clearTimeout(deadline); resolve({ code, signal, out, err }); });
  });
}
async function readyNats(url) {
  for (let i = 0; i < 100; i++) {
    try { const nc = await connect({ servers: url, token, timeout: 200 }); await nc.close(); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  throw new Error('owned NATS did not start');
}

async function main() {
  for (const dir of [home, workspace, vault, path.join(home, '.openclaw/workspace/.tmp')]) mkdir(dir);
  fs.writeFileSync(notifier, '#!/bin/sh\nprintf "called\\n" >> "$PROBE_NOTIFIER_LOG"\n', { mode: 0o700 });
  const natsPort = await freePort();
  const natsUrl = `nats://127.0.0.1:${natsPort}`;
  const nats = child('/opt/homebrew/bin/nats-server', ['-a', '127.0.0.1', '-p', String(natsPort), '-js', '-sd', path.join(scratch, 'jetstream'), '--auth', token], { cwd: scratch });
  await readyNats(natsUrl);
  llm = http.createServer((req, res) => {
    llmHits++;
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: 'A private graph fixture summarized by the owned model.' }, done_reason: 'stop', prompt_eval_count: 5, eval_count: 9 }));
  });
  await listen(llm);
  const llmUrl = `http://127.0.0.1:${llm.address().port}`;
  const env = {
    HOME: home,
    PATH: `${path.dirname(nodeBinary)}:/opt/homebrew/bin:/usr/bin:/bin`,
    TZ: 'America/Montreal',
    OPENCLAW_WORKSPACE: workspace,
    OPENCLAW_NATS: natsUrl,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
    OPENCLAW_NODE_ID: nodeId,
    LLM_BASE_URL: llmUrl,
    OBSIDIAN_VAULT_PATH: vault,
    OPENCLAW_OBS_DB: obs,
    OPENCLAW_NOTIFY_HOME: home,
    OPENCLAW_NOTIFY_LEDGER: ledger,
    OPENCLAW_NOTIFIER_APP: notifier,
    OPENCLAW_MC_URL: llmUrl,
    PROBE_NOTIFIER_LOG: notifierLog,
  };
  fs.writeFileSync(path.join(home, '.openclaw/openclaw.env'), `OPENCLAW_NATS=${natsUrl}\nOPENCLAW_NATS_TOKEN=${token}\nOPENCLAW_NATS_AUTH=token\n`, { mode: 0o600 });
  const snapshot = path.join(home, '.openclaw/workspace/.tmp/ollama-queue-state.json');
  const idle = { ts: Date.now(), current_job: null, queue_depth: 0, external_jobs: [], history: { extraction: { count: 0, avg_ms: 0 } }, recent_fallbacks: [] };
  fs.writeFileSync(snapshot, JSON.stringify(idle), { mode: 0o600 });
  const dbPath = path.join(home, '.openclaw/state.db');
  const setup = `import { createExtractionStore } from ${JSON.stringify('file://' + path.join(release, 'lib/extraction-store.mjs'))};
    const store=createExtractionStore({dbPath:${JSON.stringify(dbPath)}}); const db=store.db;
    const old=new Date(Date.now()-30*86400000).toISOString();
    db.prepare('INSERT INTO entities (name,type,canonical_name,first_seen,last_seen,mention_count,salience,source_type) VALUES (?,?,?,?,?,?,?,?)').run('private-graph-fixture','concept','private-graph-fixture',old,old,12,0.8,'local');
    const id=db.prepare('SELECT id FROM entities WHERE name=?').get('private-graph-fixture').id;
    for(let i=0;i<6;i++) db.prepare('INSERT INTO mentions (entity_id,session_id,salience,created_at,source_type) VALUES (?,?,?,?,?)').run(id,'session-'+i,0.8,old,'local');
    store.close();`;
  const seeded = await finished(child(nodeBinary, ['--input-type=module', '-e', setup], { cwd: '/', env }));
  assert.equal(seeded.code, 0, seeded.err);
  const runEntry = async selectedRelease => await finished(child(nodeBinary, [path.join(selectedRelease || release, 'bin/consolidation-scheduler.mjs')], { cwd: '/', env }), 30000);
  const succeeded = await runEntry();
  assert.equal(succeeded.code, 0, succeeded.err);
  assert.match(succeeded.out, /NATS connected .* events will be emitted/);
  assert.match(succeeded.out, /Consolidation complete/);
  assert.ok(llmHits > 0, 'no call reached the owned LLM');
  const note = path.join(vault, 'concepts/private-graph-fixture.md');
  assert.match(fs.readFileSync(note, 'utf8'), /owned model/);
  const nc = await connect({ servers: natsUrl, token });
  const jsm = await nc.jetstreamManager();
  const stream = `local-events-${nodeId}`;
  const info = await jsm.streams.info(stream);
  assert.ok(info.state.messages >= 2, `expected decay and promotion publications, got ${info.state.messages}`);
  const positive = { exit: succeeded.code, natsConnected: true, cycle: true, llmRequests: llmHits, note: path.relative(scratch, note), events: info.state.messages };
  const afterSuccess = fs.statSync(dbPath).mtimeMs;
  fs.writeFileSync(snapshot, JSON.stringify({ ...idle, ts: Date.now() - 180000 }));
  const stale = await runEntry();
  assert.equal(stale.code, 0);
  assert.match(stale.out, /Skipped: daemon queue snapshot missing or stale/);
  assert.equal(fs.statSync(dbPath).mtimeMs, afterSuccess, 'stale control changed DB');
  fs.writeFileSync(snapshot, JSON.stringify({ ...idle, ts: Date.now(), current_job: { type: 'analysis', elapsed_ms: 100 } }));
  const busy = await runEntry();
  assert.match(busy.out, /Skipped: active analysis job/);
  assert.equal(fs.statSync(dbPath).mtimeMs, afterSuccess, 'busy control changed DB');
  fs.writeFileSync(snapshot, JSON.stringify({ ...idle, ts: Date.now() }));
  const broken = path.join(scratch, 'broken-release');
  fs.cpSync(release, broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'packages/event-schemas/dist/index.js'), 'throw new Error("deliberately broken schema dist");\n');
  const degraded = await runEntry(broken);
  assert.equal(degraded.code, 0, 'source scheduler no longer exhibits its swallowed-schema failure');
  assert.match(degraded.out, /Consolidation complete/);
  assert.match(degraded.err, /NATS unavailable .*deliberately broken schema dist/);
  assert.doesNotMatch(degraded.out, /NATS connected/);
  assert.equal((await jsm.streams.info(stream)).state.messages, info.state.messages, 'degraded run emitted unexpected events');
  await nc.close();
  fs.writeFileSync(dbPath, 'not a database');
  const failed = await runEntry();
  assert.equal(failed.code, 1, `failure control exited ${failed.code}: ${failed.out} ${failed.err}`);
  assert.match(failed.err, /Consolidation failed/);
  const ledgerRows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(ledgerRows.some(row => row.source === 'consolidation' && row.kind === 'error'), 'missing failure notification');
  assert.match(fs.readFileSync(notifierLog, 'utf8'), /called/);
  return { release, nodeBinary, positive, stale: 'skipped without DB change', busy: 'skipped without DB change', brokenSchema: 'entry exited 0 without NATS; acceptance rejected', failure: { exit: failed.code, ledgerRows: ledgerRows.length, notifierFinished: true } };
}

try {
  const result = await main();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  const running = children.filter(proc => proc.exitCode === null && proc.signalCode === null);
  for (const proc of running) proc.kill('SIGTERM');
  await Promise.all(running.map(proc => new Promise(resolve => proc.once('exit', resolve))));
  if (llm) await new Promise(resolve => llm.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
