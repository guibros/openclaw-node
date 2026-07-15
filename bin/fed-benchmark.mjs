#!/usr/bin/env node
/**
 * bin/fed-benchmark.mjs — step 2.6 premise-benchmark harness.
 *
 * Runs the same task through two arms and packages the outputs for BLIND
 * operator scoring (audits/step26_premise-benchmark/AUDIT_PRE.md §1):
 *   solo   — one harness-loaded OpenClaw worker, no collaboration
 *   grappe — circling_strategy, max_subrounds:1, 3 workers
 *
 * Usage:
 *   node bin/fed-benchmark.mjs submit <task-id> <arm> <task-file.md>
 *       arm = solo | grappe. Task file: first line = title, rest = description.
 *   node bin/fed-benchmark.mjs status <task-id>
 *   node bin/fed-benchmark.mjs collect <name> <solo-task-id> <grappe-task-id>
 *       Pulls both final artifacts, blinds to A/B (coin flip), writes
 *       benchmark/pairs/<name>/{A.md,B.md,key.json,meta.json}.
 *   node bin/fed-benchmark.mjs tally
 *       Reads benchmark/pairs/<name>/score.json ({winner:"A"|"B"|"tie", notes})
 *       + key.json, prints unblinded per-task verdicts + overall result.
 *
 * Requires the mesh stack up (launchd daemon + 3 claude agents for grappe,
 * ≥1 agent for solo). OPENCLAW_NATS resolves loopback-first here.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('../node_modules/nats');
const { natsConnectOpts } = require('../lib/nats-resolve');

const sc = StringCodec();
const BENCH_DIR = path.join(process.cwd(), 'benchmark');
const NATS_URL = process.env.OPENCLAW_NATS || 'nats://127.0.0.1:4222';

const strip = (s) =>
  String(s)
    .replace(/\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/(^|\n)Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.?/g, '$1')
    .trim();

// Blind-safety: remove markers that reveal which arm produced the text.
const deIdentify = (s) =>
  strip(s)
    .replace(/collab-[a-z0-9.-]+/gi, '<session>')
    .replace(/\b(worker|reviewer[AB]?|integrator)\b/gi, '<role>')
    .replace(/\b(sub-?round|circling|finalization|barrier)\b/gi, '<phase>')
    .replace(/\bvote:\s*\S+/gi, '');

async function bus() {
  return connect({ ...natsConnectOpts(), servers: NATS_URL, timeout: 10000 });
}

async function submit(taskId, arm, file) {
  const raw = fs.readFileSync(file, 'utf8').trim().split('\n');
  const title = raw[0].trim();
  const description = raw.slice(1).join('\n').trim();
  const payload = {
    task_id: taskId,
    title,
    description,
    budget_minutes: 60,
    metric: 'Benchmark 2.6 rubric: correctness, completeness, evidence, actionability, discovery',
    llm_provider: 'claude',
  };
  if (arm === 'grappe') {
    payload.collaboration = { mode: 'circling_strategy', max_subrounds: 1, automation_tier: 1 };
  } else if (arm !== 'solo') {
    throw new Error(`arm must be solo|grappe, got ${arm}`);
  }
  const nc = await bus();
  const resp = await nc.request('mesh.tasks.submit', sc.encode(JSON.stringify(payload)), { timeout: 15000 });
  const result = JSON.parse(sc.decode(resp.data));
  if (result.error) throw new Error(result.error);
  console.log(`submitted ${arm} task ${taskId} (${title})`);
  await nc.close();
}

async function getTask(nc, taskId) {
  const resp = await nc.request('mesh.tasks.get', sc.encode(JSON.stringify({ task_id: taskId })), { timeout: 10000 });
  return JSON.parse(sc.decode(resp.data));
}

async function findSession(nc, taskId) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let found = null;
  for await (const k of await kv.keys()) if (k.includes(taskId)) found = k;
  if (!found) return null;
  const e = await kv.get(found);
  try { return JSON.parse(new TextDecoder().decode(e.value)); } catch { return null; }
}

function grappeFinalArtifact(session) {
  const arts = session?.circling?.artifacts || {};
  // Highest sub-round workArtifact is the deliverable; integrator analyses excluded.
  const keys = Object.keys(arts).filter((k) => k.includes('worker_workArtifact')).sort();
  const key = keys[keys.length - 1];
  if (!key) return null;
  const a = arts[key];
  return { key, content: typeof a === 'string' ? a : a.content ?? '' };
}

async function status(taskId) {
  const nc = await bus();
  const t = await getTask(nc, taskId).catch(() => null);
  console.log('task:', t?.task?.status ?? t?.status ?? 'unknown');
  const s = await findSession(nc, taskId);
  if (s) {
    console.log('session:', s.status, '· phase:', s.circling?.phase, '· arts:', Object.keys(s.circling?.artifacts || {}).length);
  }
  await nc.close();
}

async function collect(name, soloId, grappeId) {
  const nc = await bus();
  const solo = await getTask(nc, soloId);
  const soloTask = solo?.task ?? solo;
  const soloOut = soloTask?.result?.output ?? soloTask?.result ?? soloTask?.output;
  if (!soloOut) throw new Error(`solo task ${soloId}: no result yet (status ${soloTask?.status})`);

  const session = await findSession(nc, grappeId);
  const grappeArt = grappeFinalArtifact(session);
  if (!grappeArt) throw new Error(`grappe task ${grappeId}: no final workArtifact (phase ${session?.circling?.phase})`);

  const dir = path.join(BENCH_DIR, 'pairs', name);
  fs.mkdirSync(dir, { recursive: true });

  const flip = crypto.randomInt(2) === 0;
  const A = flip ? { arm: 'solo', text: String(soloOut) } : { arm: 'grappe', text: String(grappeArt.content) };
  const B = flip ? { arm: 'grappe', text: String(grappeArt.content) } : { arm: 'solo', text: String(soloOut) };

  fs.writeFileSync(path.join(dir, 'A.md'), deIdentify(A.text) + '\n');
  fs.writeFileSync(path.join(dir, 'B.md'), deIdentify(B.text) + '\n');
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({ A: A.arm, B: B.arm }, null, 2));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    name, soloId, grappeId,
    grappeArtifactKey: grappeArt.key,
    soloChars: A.arm === 'solo' ? A.text.length : B.text.length,
    grappeChars: A.arm === 'grappe' ? A.text.length : B.text.length,
    collectedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`pair '${name}' written → ${dir}/{A.md,B.md}`);
  console.log(`score it: write ${dir}/score.json  {"winner":"A"|"B"|"tie","scores":{...},"notes":"..."}`);
  console.log('do NOT open key.json until all pairs are scored.');
  await nc.close();
}

function tally() {
  const pairsDir = path.join(BENCH_DIR, 'pairs');
  const names = fs.existsSync(pairsDir) ? fs.readdirSync(pairsDir) : [];
  let grappeWins = 0, soloWins = 0, ties = 0, scored = 0;
  for (const name of names) {
    const dir = path.join(pairsDir, name);
    const scoreFile = path.join(dir, 'score.json');
    if (!fs.existsSync(scoreFile)) { console.log(`${name}: UNSCORED`); continue; }
    const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
    scored++;
    const winnerArm = score.winner === 'tie' ? 'tie' : key[score.winner];
    if (winnerArm === 'grappe') grappeWins++;
    else if (winnerArm === 'solo') soloWins++;
    else ties++;
    console.log(`${name}: ${score.winner} → ${winnerArm}${score.notes ? ' — ' + score.notes : ''}`);
  }
  console.log(`\nRESULT: grappe ${grappeWins} · solo ${soloWins} · tie ${ties} (${scored} scored)`);
  const need = Math.max(4, Math.ceil((scored || 5) * 0.8));
  console.log(grappeWins >= need
    ? `VERDICT: PREMISE PASSES (grappe ≥ ${need})`
    : `VERDICT: below the clear-majority bar (needs ≥ ${need} of ${scored || 5}; ties count against) — D3 plan-BLOCK if final`);
}

const [, , cmd, ...args] = process.argv;
const run = { submit: () => submit(args[0], args[1], args[2]), status: () => status(args[0]), collect: () => collect(args[0], args[1], args[2]), tally: () => Promise.resolve(tally()) }[cmd];
if (!run) { console.error('usage: fed-benchmark.mjs submit|status|collect|tally ...'); process.exit(2); }
run().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
