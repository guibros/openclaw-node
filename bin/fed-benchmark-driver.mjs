#!/usr/bin/env node
/**
 * bin/fed-benchmark-driver.mjs — runs the full 2.6 benchmark unattended.
 * For each task: solo arm (wait for output) → grappe arm (wait for phase=complete
 * or terminal) → collect+blind the pair. Fires a desktop notification at the end.
 * Detached-safe: writes progress to benchmark/driver.log; resumable (skips pairs
 * already collected). Reuses a pre-existing completed grappe session if given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { connect } = require('../node_modules/nats');
const { natsConnectOpts } = require('../lib/nats-resolve');
const REPO = process.cwd();
const BIN = path.join(REPO, 'bin', 'fed-benchmark.mjs');
const LOG = path.join(REPO, 'benchmark', 'driver.log');
const NATS = 'nats://127.0.0.1:4222';

const TASKS = [
  { name: 'spec-f1f2f4', file: 'benchmark/tasks/spec-f1f2f4.md',
    reuseGrappe: 'collab-bench-spec-harden-grappe-1784085864294-1784085864330' },
  { name: 'collab-mode-gap', file: 'benchmark/tasks/collab-mode-gap.md' },
  { name: 'verify-nodeid-gap', file: 'benchmark/tasks/verify-nodeid-gap.md' },
  { name: 'deploy-doc-quickstart', file: 'benchmark/tasks/deploy-doc-quickstart.md' },
  { name: 'fed-probe-spec', file: 'benchmark/tasks/fed-probe-spec.md' },
];

function log(m) { const l = `[${new Date().toISOString().slice(11,19)}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l+'\n'); } catch {} }
function sh(args) { return new Promise((res) => execFile('node', [BIN, ...args], { cwd: REPO, env: { ...process.env, OPENCLAW_NATS: NATS } }, (e, o, r) => res({ e, o: o || "", r: r || "" }))); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function bus() { return connect({ ...natsConnectOpts(), servers: NATS, timeout: 10000 }); }
function notify(kind, title, msg) { try { execFile('node', [path.join(REPO,'bin','openclaw-notify.mjs'),'--kind',kind,'--source','grappe','--title',title,'--message',msg], {timeout:15000}, ()=>{}); } catch {} }

async function soloOut(nc, id) {
  const kv = await nc.jetstream().views.kv('MESH_TASKS');
  const e = await kv.get(id).catch(()=>null); if (!e) return null;
  let t; try { t = JSON.parse(new TextDecoder().decode(e.value)); } catch { return null; }
  const r = t.result; const o = (r&&typeof r==='object')?(r.output??r.artifact??r.text??r.summary):r;
  return { status: t.status, out: (o&&String(o).trim()&&String(o).trim()!=='null')?String(o):null };
}
async function grappeState(nc, id) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let key=null; for await (const k of await kv.keys()) if (k.includes(id)) key=k;
  if (!key) return null;
  const e = await kv.get(key); let s; try { s=JSON.parse(new TextDecoder().decode(e.value)); } catch { return null; }
  return { status: s.status, phase: s.circling?.phase, arts: Object.keys(s.circling?.artifacts||{}).length };
}

async function runSolo(nc, name, file) {
  const id = `bench-solo-${name}-${Math.floor(Date.now()/1000)}`;
  log(`solo ${name}: submitting`);
  await sh(['submit', id, 'solo', file]);
  const deadline = Date.now() + 30*60*1000;
  while (Date.now() < deadline) {
    await sleep(30000);
    const s = await soloOut(nc, id);
    if (s?.out) { log(`solo ${name}: done (${s.out.length} chars)`); return id; }
    if (s?.status === 'failed' || s?.status === 'cancelled') { log(`solo ${name}: ${s.status}`); return id; }
  }
  log(`solo ${name}: timeout`); return id;
}
async function runGrappe(nc, name, file, reuse) {
  if (reuse) { const g = await grappeState(nc, reuse); if (g && (g.phase==='complete'||g.arts>=6)) { log(`grappe ${name}: reusing ${reuse} (${g.arts} arts)`); return reuse.replace(/^collab-/,'').replace(/-\d+$/,''); } }
  const id = `bench-grappe-${name}-${Math.floor(Date.now()/1000)}`;
  log(`grappe ${name}: submitting`);
  await sh(['submit', id, 'grappe', file]);
  const deadline = Date.now() + 50*60*1000;
  while (Date.now() < deadline) {
    await sleep(45000);
    const g = await grappeState(nc, id);
    if (g && (g.phase==='complete' || g.status==='completed')) { log(`grappe ${name}: complete (${g.arts} arts)`); return id; }
    if (g && g.status==='aborted' && g.arts>=6) { log(`grappe ${name}: aborted but ${g.arts} arts — usable`); return id; }
  }
  log(`grappe ${name}: timeout`); return id;
}

async function main() {
  fs.mkdirSync(path.join(REPO,'benchmark'), { recursive: true });
  log('=== benchmark driver start ===');
  const nc = await bus();
  for (const t of TASKS) {
    const pairDir = path.join(REPO,'benchmark','pairs',t.name);
    if (fs.existsSync(path.join(pairDir,'A.md'))) { log(`${t.name}: pair exists, skip`); continue; }
    const soloId = await runSolo(nc, t.name, t.file);
    const grappeId = await runGrappe(nc, t.name, t.file, t.reuseGrappe);
    const c = await sh(['collect', t.name, soloId, grappeId]);
    log(`${t.name}: collect → ${c.e ? 'ERR '+(c.r||c.e.message).slice(0,80) : 'ok'}`);
  }
  await nc.close();
  const done = fs.existsSync(path.join(REPO,'benchmark','pairs')) ? fs.readdirSync(path.join(REPO,'benchmark','pairs')).filter(n=>fs.existsSync(path.join(REPO,'benchmark','pairs',n,'A.md'))).length : 0;
  log(`=== driver done: ${done}/5 pairs ready ===`);
  notify(done>=5?'success':'warn', `Benchmark: ${done}/5 pairs ready`, 'Blind A/B files in benchmark/pairs/. Score each, then tally.');
}
main().catch(e => { log('FATAL: '+e.message); notify('error','Benchmark driver failed', e.message); process.exit(1); });
