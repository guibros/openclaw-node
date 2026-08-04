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
// D14 rerun (2026-08-03): fresh pairs live under pairs-d14/, and July's
// tracked benchmark/pairs/ + benchmark/handrun/ are history — collect never
// writes there and tally never reads them, so old artifacts cannot be
// silently substituted for fresh runs.
const PAIRS_ROOT = path.join(BENCH_DIR, 'pairs-d14');
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
    // Trivially-passing metric: benchmark quality is judged by BLIND operator
    // scoring, not a test gate. The solo path runs `metric` as a shell
    // verification and discards the attempt on non-zero — a rubric string there
    // fails the security filter and retries forever (2.6 harness bug, 2026-07-15).
    // `node --version` matches the allowed-prefix filter and exits 0, so the
    // worker produces its artifact in one shot.
    metric: 'node --version',
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
  const kv = await nc.jetstream().views.kv('MESH_TASKS');
  const e = await kv.get(taskId).catch(() => null);
  if (!e) return null;
  try { return JSON.parse(new TextDecoder().decode(e.value)); } catch { return null; }
}

function soloOutput(task) {
  if (!task) return null;
  const r = task.result;
  const out = (r && typeof r === 'object') ? (r.output ?? r.artifact ?? r.text ?? r.summary) : r;
  return out && String(out).trim() && String(out).trim() !== 'null' ? String(out) : null;
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
  // D14: the deliverable is the FINAL integrated workArtifact — highest
  // sub-round, then highest step. The old largest-artifact heuristic silently
  // substituted an earlier draft whenever the final round emitted a preamble
  // stub (observed: 89-char sr1_step2 final in smoke #2). A degenerate final
  // is a substrate defect the benchmark must surface, not paper over — the
  // agent-side guard (parse_error + directed retry) exists to prevent it.
  const cand = Object.keys(arts)
    .map((k) => { const m = k.match(/^sr(\d+)_step(\d+)_worker_workArtifact$/); return m ? { key: k, sr: +m[1], step: +m[2] } : null; })
    .filter(Boolean)
    // Finalization stores its workArtifact at step0 of the last sub-round,
    // alongside a completionDiff sibling (smoke #3 observed). Prefer that
    // signature; fall back to highest sr/step.
    .map((c) => ({ ...c, isFinal: `sr${c.sr}_step${c.step}_worker_completionDiff` in arts }))
    .sort((a, b) => b.sr - a.sr || (b.isFinal - a.isFinal) || b.step - a.step);
  if (!cand.length) return null;
  const top = cand[0];
  const raw = arts[top.key];
  const content = String(typeof raw === 'string' ? raw : raw?.content ?? '').trim();
  if (content.length < 400) {
    throw new Error(`grappe final artifact ${top.key} is degenerate (${content.length} chars, preamble-only). Substrate defect — the final integration round did not produce the artifact; pair NOT collectable.`);
  }
  return { key: top.key, content };
}

async function status(taskId) {
  const nc = await bus();
  const t = await getTask(nc, taskId).catch(() => null);
  console.log('task:', t?.status ?? 'unknown', '· has-output:', !!soloOutput(t));
  const s = await findSession(nc, taskId);
  if (s) {
    console.log('session:', s.status, '· phase:', s.circling?.phase, '· arts:', Object.keys(s.circling?.artifacts || {}).length);
  }
  await nc.close();
}

function wallMs(startIso, endIso) {
  const s = Date.parse(startIso), e = Date.parse(endIso);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? e - s : null;
}

async function collect(name, soloId, grappeId) {
  const nc = await bus();
  const soloTask = await getTask(nc, soloId);
  const soloOut = soloOutput(soloTask);
  if (!soloOut) throw new Error(`solo task ${soloId}: no result yet (status ${soloTask?.status})`);

  const session = await findSession(nc, grappeId);
  const grappeArt = grappeFinalArtifact(session);
  if (!grappeArt) throw new Error(`grappe task ${grappeId}: no final workArtifact (phase ${session?.circling?.phase})`);

  const dir = path.join(PAIRS_ROOT, name);
  // No reuse, no overwrite (D14): a pair name is written exactly once.
  if (fs.existsSync(dir)) throw new Error(`pair '${name}' already exists at ${dir} — D14 forbids overwrite/reuse; pick a new name`);
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
    // Cost record (D14: quality gain is weighed against cost). Wall-clock is
    // mechanical from KV/session timestamps; tokens/cost come from the
    // agents' own session-JSONL extraction — result.cost on the solo task,
    // circling.usage_total accumulated per reflection on the grappe session.
    // null = the producing run predates capture (never fabricated).
    cost: {
      solo_wall_ms: wallMs(soloTask?.started_at ?? soloTask?.created_at, soloTask?.completed_at),
      grappe_wall_ms: wallMs(session?.created_at, session?.updated_at ?? session?.completed_at),
      solo_attempts: Array.isArray(soloTask?.attempts) ? soloTask.attempts.length : null,
      grappe_artifact_count: Object.keys(session?.circling?.artifacts || {}).length,
      solo_usage: soloTask?.result?.cost ? {
        input_tokens: soloTask.result.cost.inputTokens ?? null,
        output_tokens: soloTask.result.cost.outputTokens ?? null,
        cost_usd: soloTask.result.cost.estimatedCostUsd ?? null,
      } : null,
      grappe_usage: session?.circling?.usage_total ?? null,
    },
    collectedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`pair '${name}' written → ${dir}/{A.md,B.md}`);
  console.log(`score it: write ${dir}/score.json  {"winner":"A"|"B"|"tie","scores":{...},"notes":"..."}`);
  console.log('do NOT open key.json until all pairs are scored.');
  await nc.close();
}

function tally() {
  const pairsDir = PAIRS_ROOT;
  const names = fs.existsSync(pairsDir) ? fs.readdirSync(pairsDir) : [];
  let grappeWins = 0, soloWins = 0, ties = 0, scored = 0;
  let soloMs = 0, grappeMs = 0, soloUsd = 0, grappeUsd = 0;
  for (const name of names) {
    const dir = path.join(pairsDir, name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      soloMs += meta.cost?.solo_wall_ms || 0;
      grappeMs += meta.cost?.grappe_wall_ms || 0;
      soloUsd += meta.cost?.solo_usage?.cost_usd || 0;
      grappeUsd += meta.cost?.grappe_usage?.cost_usd || 0;
    } catch { /* unscored/partial pair */ }
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
  console.log(`COST: solo Σ ${(soloMs / 60000).toFixed(1)}m wall / $${soloUsd.toFixed(2)} · grappe Σ ${(grappeMs / 60000).toFixed(1)}m wall / $${grappeUsd.toFixed(2)} (from agents' session-JSONL extraction; $0.00 = producer predates capture)`);
  const need = Math.max(4, Math.ceil((scored || 5) * 0.8));
  console.log(grappeWins >= need
    ? `VERDICT: PREMISE PASSES (grappe ≥ ${need})`
    : `VERDICT: below the clear-majority bar (needs ≥ ${need} of ${scored || 5}; ties count against) — D3 plan-BLOCK if final`);
}

const [, , cmd, ...args] = process.argv;
const run = { submit: () => submit(args[0], args[1], args[2]), status: () => status(args[0]), collect: () => collect(args[0], args[1], args[2]), tally: () => Promise.resolve(tally()) }[cmd];
if (!run) { console.error('usage: fed-benchmark.mjs submit|status|collect|tally ...'); process.exit(2); }
run().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
