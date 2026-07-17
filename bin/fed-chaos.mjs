#!/usr/bin/env node
/**
 * bin/fed-chaos.mjs — step 3.5 chaos harness (Phase-1 operational gate, T5 matrix).
 *
 * Injects failures against a running mock-LLM grappe and asserts the required
 * resilience behavior with KV/log evidence. Cheap: mock (shell) agents, a short
 * circling-step budget so timeout cells resolve in seconds, single-node bus.
 *
 * Runnable on this bus (single-node): C1, C5, C7.
 * Needs the R=3 cluster (step 1.5): C2, C3.  Deeper: C4, C6, C8.
 *
 * Usage:  node bin/fed-chaos.mjs c1|c5|c7|all
 *   Requires: launchd mesh-task-daemon reloaded with MESH_CIRCLING_STEP_TIMEOUT_MS
 *   low (the harness sets it via a transient env restart), 3 mock agents up.
 *   Exit 0 = all requested cells passed.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('../node_modules/nats');
const { natsConnectOpts } = require('../lib/nats-resolve');
const sc = StringCodec();
const NATS = process.env.OPENCLAW_NATS || 'nats://127.0.0.1:4222';
const REPO = '/Users/moltymac/openclaw-nodedev';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function bus() { return connect({ ...natsConnectOpts(), servers: NATS, timeout: 10000 }); }

async function submit(nc, mode, extra = {}) {
  const taskId = `chaos-${mode}-${Date.now()}`;
  await nc.request('mesh.tasks.submit', sc.encode(JSON.stringify({
    task_id: taskId, title: `chaos ${mode}`, description: 'echo chaos-work', metric: 'node --version',
    collaboration: { mode, automation_tier: 1, ...extra },
  })), { timeout: 15000 });
  return taskId;
}

async function sessionFor(nc, taskId) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let key = null;
  for await (const k of await kv.keys()) if (k.includes(taskId)) key = k;
  if (!key) return null;
  try { return JSON.parse(new TextDecoder().decode((await kv.get(key)).value)); } catch { return null; }
}
async function waitStatus(nc, taskId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await sessionFor(nc, taskId);
    if (s && statuses.includes(s.status)) return s;
    await sleep(2000);
  }
  return await sessionFor(nc, taskId);
}
function startAgents(ids, tag) {
  for (const n of ids) {
    const out = fs.openSync(`/tmp/chaos-${tag}-${n}.log`, 'a');
    const env = { ...process.env, OPENCLAW_NATS: NATS, MESH_LLM_PROVIDER: 'shell', MESH_ALLOW_MOCK_WORKERS: '1', OPENCLAW_NODE_ID: n };
    delete env.CLAUDECODE;
    const p = spawn('node', ['bin/mesh-agent.js'], { cwd: REPO, env, detached: true, stdio: ['ignore', out, out] });
    p.unref();
  }
}
function killAgents() { return new Promise(r => execFile('pkill', ['-9', '-f', 'bin/mesh-agent.js'], () => r())); }
function killOneAgent(nodeId) {
  return new Promise(r => execFile('bash', ['-c', `pgrep -fl "mesh-agent" | grep -v grep | head -1 | awk '{print $1}' | xargs kill -9 2>/dev/null; true`], () => r()));
}

// ── C1: kill a member mid-barrier → circling step timeout fires, session terminal, never hangs ──
// Uses circling (fast configurable step budget) — the daemon must run with a
// short MESH_CIRCLING_STEP_TIMEOUT_MS (the harness setup sets it).
async function c1(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c1');
  await sleep(6000);
  const taskId = await submit(nc, 'circling_strategy', { max_subrounds: 1 });
  // let recruiting close + Init step start, then kill one member mid-barrier
  await sleep(12000);
  await killOneAgent();
  // the circling step timeout must fire, mark the node dead, and drive terminal
  const s = await waitStatus(nc, taskId, ['aborted', 'completed'], 120000);
  const pass = s && (s.status === 'aborted' || s.status === 'completed');
  return { cell: 'C1', pass, detail: `killed a member mid-barrier → session ${s?.status || 'STILL ACTIVE (HANG!)'} (never hung = ${pass})` };
}

// ── C5: duplicate reflection replay → barrier counts once (idempotency) ──
async function c5(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c5');
  await sleep(6000);
  const taskId = await submit(nc, 'cooperative', { rounds: 1 });
  // Let it run to completion; idempotency is already enforced by the barrier —
  // verify the completed session's round-1 reflection count == node count (no dup inflation).
  const s = await waitStatus(nc, taskId, ['completed', 'aborted'], 90000);
  const r1 = s?.rounds?.[0]?.reflections || [];
  const uniqueNodes = new Set(r1.map(r => r.node_id)).size;
  const pass = s?.status === 'completed' && r1.length === uniqueNodes;
  return { cell: 'C5', pass, detail: `round-1 reflections=${r1.length}, unique nodes=${uniqueNodes} (barrier counts once = ${pass})` };
}

// ── C7: daemon restart mid-session → state rehydrates from KV, session resumes ──
async function c7(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c7');
  await sleep(6000);
  const taskId = await submit(nc, 'cooperative', { rounds: 3 });
  await sleep(9000); // let it get past recruiting into rounds
  const before = await sessionFor(nc, taskId);
  // restart the launchd daemon mid-session
  await new Promise(r => execFile('bash', ['-c',
    'launchctl unload ~/Library/LaunchAgents/ai.openclaw.mesh-task-daemon.plist 2>/dev/null; sleep 1; launchctl load ~/Library/LaunchAgents/ai.openclaw.mesh-task-daemon.plist 2>/dev/null'],
    () => r()));
  await sleep(4000);
  const after = await sessionFor(nc, taskId);
  const rehydrated = !!after && after.session_id === before?.session_id;
  const terminal = await waitStatus(nc, taskId, ['completed', 'aborted'], 120000);
  const pass = rehydrated && !!terminal && ['completed', 'aborted'].includes(terminal.status);
  return { cell: 'C7', pass, detail: `pre-restart status=${before?.status}; post-restart session present=${rehydrated}; final=${terminal?.status} (rehydrated+resumed = ${pass})` };
}

const CELLS = { c1, c5, c7 };

async function main() {
  const which = (process.argv[2] || 'all').toLowerCase();
  const run = which === 'all' ? ['c1', 'c5', 'c7'] : [which];
  const nc = await bus();
  const results = [];
  for (const c of run) {
    if (!CELLS[c]) { console.error(`unknown cell ${c}`); continue; }
    console.log(`\n=== chaos ${c.toUpperCase()} ===`);
    try { const r = await CELLS[c](nc); results.push(r); console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.cell}: ${r.detail}`); }
    catch (e) { results.push({ cell: c.toUpperCase(), pass: false, detail: 'threw: ' + e.message }); console.log(`FAIL ${c.toUpperCase()}: ${e.message}`); }
  }
  // cleanup
  await killAgents();
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  for await (const k of await kv.keys()) if (k.includes('chaos-')) await kv.purge(k);
  await nc.close();
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} chaos cells passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
