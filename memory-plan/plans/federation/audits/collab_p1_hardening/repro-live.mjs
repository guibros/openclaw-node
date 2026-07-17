#!/usr/bin/env node
// Repro for P0-2 (join-path dispatch bypass): a cooperative task with max_nodes:3
// closes recruiting synchronously on the 3rd JOIN (handleCollabJoin) — the sweep
// never sees it. Before the fix: integrator rotation never set, rounds "complete"
// on placeholders. Run BEFORE the fix and AFTER it; keep both outputs in the audit.
//   node repro-join-dispatch.mjs before|after
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('/Users/moltymac/openclaw-nodedev/node_modules/nats');
const { natsConnectOpts } = require('/Users/moltymac/openclaw-nodedev/lib/nats-resolve');
const sc = StringCodec();
const NATS = 'nats://127.0.0.1:4222';
const REPO = '/Users/moltymac/openclaw-nodedev';
const TAG = process.argv[2] || 'before';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startAgents(ids) {
  for (const n of ids) {
    const out = fs.openSync(`/tmp/repro-${TAG}-${n}.log`, 'a');
    const env = { ...process.env, OPENCLAW_NATS: NATS, MESH_LLM_PROVIDER: "shell", MESH_ALLOW_MOCK_WORKERS: "1", OPENCLAW_NODE_ID: n };
    delete env.CLAUDECODE;
    const p = spawn('node', ['bin/mesh-agent.js'], { cwd: REPO, env, detached: true, stdio: ['ignore', out, out] });
    p.unref();
  }
}
const killAgents = () => new Promise((r) => execFile('pkill', ['-9', '-f', 'bin/mesh-agent.js'], () => r()));

async function sessionFor(nc, taskId) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let key = null;
  for await (const k of await kv.keys()) if (k.includes(taskId)) key = k;
  if (!key) return null;
  try { return JSON.parse(new TextDecoder().decode((await kv.get(key)).value)); } catch { return null; }
}

const nc = await connect({ ...natsConnectOpts(), servers: NATS, timeout: 10000 });
await killAgents(); await sleep(1000);
startAgents(['alpha', 'bravo', 'charlie']);
await sleep(6000);

const taskId = `p1-hardening-${TAG}-${Date.now()}`;
// THE NATURAL CONFIG: max_nodes:3 → 3rd join closes recruiting via handleCollabJoin.
await nc.request('mesh.tasks.submit', sc.encode(JSON.stringify({
  task_id: taskId, title: `join-dispatch repro (${TAG})`, description: 'echo repro work',
  metric: 'node --version',
  collaboration: { mode: 'cooperative', rounds: 2, min_nodes: 3, max_nodes: 3, automation_tier: 1 },
})), { timeout: 15000 });
console.log('submitted', taskId, '(cooperative, min=3, max=3)');

let closedSnap = null;
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  const s = await sessionFor(nc, taskId);
  if (s && s.status !== 'recruiting') { closedSnap = s; break; }
}
if (!closedSnap) { console.log('FAIL: session never left recruiting'); await killAgents(); process.exit(1); }
console.log('\n=== AT RECRUITING CLOSE (join path — max_nodes reached) ===');
console.log('status            :', closedSnap.status);
console.log('nodes             :', closedSnap.nodes.map(n => n.node_id).join(', '));
console.log('integrator_order  :', JSON.stringify(closedSnap.cooperative?.integrator_order));
console.log('current_integrator:', JSON.stringify(closedSnap.cooperative?.current_integrator));

let final = closedSnap;
for (let i = 0; i < 50; i++) {
  await sleep(2000);
  const s = await sessionFor(nc, taskId);
  if (s) final = s;
  if (s && ['completed', 'aborted', 'converged'].includes(s.status)) break;
}
console.log('\n=== TERMINAL ===');
console.log('status            :', final.status);
console.log('integrator_order  :', JSON.stringify(final.cooperative?.integrator_order));
console.log('integrations      :', (final.cooperative?.integrations || []).length);
for (const ig of final.cooperative?.integrations || []) {
  const a = typeof ig.artifact === 'string' ? ig.artifact : JSON.stringify(ig.artifact);
  console.log(`  R${ig.round} by ${JSON.stringify(ig.integrator_node_id)}: ${String(a).slice(0, 100)}`);
}

await killAgents();
const kv = await nc.jetstream().views.kv('MESH_COLLAB');
for await (const k of await kv.keys()) if (k.includes('p1-hardening')) await kv.purge(k);
const tkv = await nc.jetstream().views.kv('MESH_TASKS');
for await (const k of await tkv.keys()) if (k.includes('p1-hardening')) await tkv.purge(k);
await nc.close();
console.log('\n(cleaned up repro sessions/tasks; agents stopped)');
