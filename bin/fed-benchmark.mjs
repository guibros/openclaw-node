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
// Sealed sidecar (operator hold 2026-08-05): the scorer directory holds ONLY
// A.md/B.md (+ the scorer's own score.json). key.json and the arm-labeled
// meta (ids, costs, char counts — the old meta leaked the mapping through
// byte counts) live here, outside the scorer's path, until scoring locks.
const SEALED_ROOT = path.join(BENCH_DIR, 'sealed-d14');
const NATS_URL = process.env.OPENCLAW_NATS || 'nats://127.0.0.1:4222';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const strip = (s) =>
  String(s)
    .replace(/\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/(^|\n)Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.?/g, '$1')
    .trim();

// Blind-safety (operator hold 2026-08-05): CONTENT-PRESERVING — strip only
// literal identity markers, never domain vocabulary. The old sanitizer
// replaced worker/reviewer/circling/finalization wholesale, destroying the
// semantics of tasks whose SUBJECT is those roles and phases (Task 5).
// Residual stylistic tells are accepted and judged through the rubric.
export const deIdentify = (s) =>
  strip(s)
    .replace(/collab-[a-z0-9.-]+/gi, '<session>')
    .replace(/\bbench-w\d+\b/gi, '<node>')
    .replace(/\bd14[a-z0-9]*p\d+-[a-z-]+-(?:solo|grappe)\b/gi, '<task-id>')
    .replace(/\/[^\s`'"]*worktrees[^\s`'"]*/g, '<workdir>');

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

function artText(v) {
  return String(typeof v === 'string' ? v : v?.content ?? '').trim();
}

function grappeFinalArtifact(session) {
  const arts = session?.circling?.artifacts || {};
  // D14: the deliverable is the FINALIZATION PAIR — workArtifact +
  // completionDiff at step0 of the highest sub-round. Either member absent
  // or degenerate FAILS collection; a revision-step artifact is never a
  // substitute (smoke #2: preamble stub; smoke #4: missing completionDiff
  // silently shadowed by the sr1_step2 revision — both operator-caught).
  const srs = Object.keys(arts)
    .map((k) => k.match(/^sr(\d+)_/)).filter(Boolean).map((m) => +m[1]);
  if (!srs.length) return null;
  const sr = Math.max(...srs);
  const key = `sr${sr}_step0_worker_workArtifact`;
  const diffKey = `sr${sr}_step0_worker_completionDiff`;
  const content = artText(arts[key]);
  const diff = artText(arts[diffKey]);
  if (!content) throw new Error(`finalization workArtifact ${key} missing/empty — session did not finalize; pair NOT collectable`);
  if (content.length < 400) throw new Error(`finalization workArtifact ${key} degenerate (${content.length} chars, preamble-only); pair NOT collectable`);
  if (!diff) throw new Error(`finalization completionDiff ${diffKey} missing — incomplete finalization pair; pair NOT collectable`);
  return { key, content };
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

async function collect(name, soloId, grappeId, { repackage = false } = {}) {
  const nc = await bus();
  const soloTask = await getTask(nc, soloId);
  const soloOut = soloOutput(soloTask);
  if (!soloOut) throw new Error(`solo task ${soloId}: no result yet (status ${soloTask?.status})`);

  const session = await findSession(nc, grappeId);
  // A phase can read "complete" while the session status is still active
  // behind an unresolved vote/gate (smoke #4: blocked reviewer, and
  // timestamps unset — the null grappe_wall_ms). Only a terminal session is
  // collectable.
  if (!session || !['completed', 'converged'].includes(session.status)) {
    throw new Error(`grappe session ${grappeId}: status '${session?.status ?? 'missing'}' — not terminal (unresolved gate or incomplete run); pair NOT collectable`);
  }
  const grappeArt = grappeFinalArtifact(session);
  if (!grappeArt) throw new Error(`grappe task ${grappeId}: no final workArtifact (phase ${session?.circling?.phase})`);

  const dir = path.join(PAIRS_ROOT, name);
  const sealedDir = path.join(SEALED_ROOT, name);
  if (repackage) {
    // Operator hold 2026-08-05: rebuild the scorer package from the immutable
    // raw KV artifacts — fresh coin flip, content-preserving blinding, leaky
    // in-dir key/meta removed (they persist in git history; a FRESH scorer
    // sees only the new package).
    for (const f of ['A.md', 'B.md', 'key.json', 'meta.json', 'score.json']) {
      try { fs.rmSync(path.join(dir, f)); } catch { /* absent */ }
    }
    fs.mkdirSync(dir, { recursive: true });
  } else {
    // No reuse, no overwrite (D14): a pair name is written exactly once.
    if (fs.existsSync(dir)) throw new Error(`pair '${name}' already exists at ${dir} — D14 forbids overwrite/reuse; pick a new name (or use repackage)`);
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(sealedDir, { recursive: true });

  const flip = crypto.randomInt(2) === 0;
  const A = flip ? { arm: 'solo', text: String(soloOut) } : { arm: 'grappe', text: String(grappeArt.content) };
  const B = flip ? { arm: 'grappe', text: String(grappeArt.content) } : { arm: 'solo', text: String(soloOut) };

  const Ablind = deIdentify(A.text) + '\n';
  const Bblind = deIdentify(B.text) + '\n';
  fs.writeFileSync(path.join(dir, 'A.md'), Ablind);
  fs.writeFileSync(path.join(dir, 'B.md'), Bblind);
  fs.writeFileSync(path.join(sealedDir, 'key.json'), JSON.stringify({ A: A.arm, B: B.arm }, null, 2));
  fs.writeFileSync(path.join(sealedDir, 'hashes.json'), JSON.stringify({
    raw_solo_sha256: sha256(String(soloOut)),
    raw_grappe_sha256: sha256(String(grappeArt.content)),
    A_sha256: sha256(Ablind),
    B_sha256: sha256(Bblind),
    repackaged: repackage,
  }, null, 2));
  fs.writeFileSync(path.join(sealedDir, 'meta.json'), JSON.stringify({
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
  console.log(`pair '${name}' scorer package → ${dir}/{A.md,B.md}${repackage ? ' (REPACKAGED from raw KV, fresh flip)' : ''}`);
  console.log(`sealed (key+meta+hashes, OUTSIDE scorer dir) → ${sealedDir}/`);
  console.log(`score it: write ${dir}/score.json with the FULL rubric:`);
  console.log('  {"winner":"A"|"B"|"tie","notes":"...","scores":{"A":{"correctness":1-5,"completeness":1-5,"evidence":1-5,"actionability":1-5,"defect_discovery":1-5},"B":{...}}}');
  console.log('the scorer must never read the sealed dir; unseal only after every delivered pair is scored.');
  await nc.close();
}

function tally() {
  const pairsDir = PAIRS_ROOT;
  const names = fs.existsSync(pairsDir) ? fs.readdirSync(pairsDir) : [];
  let grappeWins = 0, soloWins = 0, ties = 0, scored = 0, invalid = 0, pending = 0;
  let soloMs = 0, grappeMs = 0, soloUsd = 0, grappeUsd = 0;
  for (const name of names) {
    const dir = path.join(pairsDir, name);
    // Costs come from whichever record the pair produced: delivered pairs
    // carry meta.json in the SEALED sidecar (in-dir meta leaked the arm
    // mapping through char counts — operator hold 2026-08-05); forfeits
    // carry forfeit.json in-dir; INFRA_INVALID pairs carry
    // infra_invalid.json and are excluded from the scoring denominator.
    for (const f of [path.join(SEALED_ROOT, name, 'meta.json'), path.join(dir, 'meta.json'), path.join(dir, 'forfeit.json'), path.join(dir, 'infra_invalid.json')]) {
      try {
        const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
        const c = rec.cost ?? rec.costs ?? {};
        soloMs += c.solo_wall_ms || 0;
        grappeMs += c.grappe_wall_ms || 0;
        soloUsd += (c.solo_usage?.cost_usd ?? c.solo_usage?.estimatedCostUsd) || 0;
        grappeUsd += c.grappe_usage?.cost_usd || 0;
        break;
      } catch { /* try next record type */ }
    }
    if (fs.existsSync(path.join(dir, 'infra_invalid.json'))) {
      invalid++;
      const rec = JSON.parse(fs.readFileSync(path.join(dir, 'infra_invalid.json'), 'utf8'));
      console.log(`${name}: INFRA_INVALID — ${rec.reason} (excluded from scoring)`);
      continue;
    }
    const delivered = fs.existsSync(path.join(dir, 'A.md'));
    const scoreFile = path.join(dir, 'score.json');
    if (!fs.existsSync(scoreFile)) {
      if (delivered) { pending++; console.log(`${name}: PENDING — delivered pair awaiting blind rubric scoring`); }
      else console.log(`${name}: UNSCORED`);
      continue;
    }
    const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
    // Preregistered rubric (operator hold 2026-08-05): a delivered pair's
    // score must carry all five dimensions per arm — winner+notes alone
    // repeats the July weakness. Forfeit pairs are mechanical and exempt.
    if (delivered) {
      const DIMS = ['correctness', 'completeness', 'evidence', 'actionability', 'defect_discovery'];
      const okDims = ['A', 'B'].every((arm) => DIMS.every((d) => Number.isFinite(score?.scores?.[arm]?.[d])));
      if (!okDims) { pending++; console.log(`${name}: SCORE REJECTED — missing rubric dimensions (${DIMS.join('/')} per arm); still PENDING`); continue; }
    }
    let key;
    try { key = JSON.parse(fs.readFileSync(path.join(SEALED_ROOT, name, 'key.json'), 'utf8')); }
    catch { key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8')); }
    scored++;
    const winnerArm = score.winner === 'tie' ? 'tie' : key[score.winner];
    if (winnerArm === 'grappe') grappeWins++;
    else if (winnerArm === 'solo') soloWins++;
    else ties++;
    console.log(`${name}: ${score.winner} → ${winnerArm}${score.notes ? ' — ' + score.notes : ''}`);
  }
  console.log(`\nRESULT: grappe ${grappeWins} · solo ${soloWins} · tie ${ties} (${scored} scored${pending ? ` · ${pending} PENDING` : ''}${invalid ? ` · ${invalid} INFRA_INVALID excluded` : ''})`);
  console.log(`COST: solo Σ ${(soloMs / 60000).toFixed(1)}m wall / $${soloUsd.toFixed(2)} · grappe Σ ${(grappeMs / 60000).toFixed(1)}m wall / $${grappeUsd.toFixed(2)} (from agents' session-JSONL extraction; $0.00 = producer predates capture)`);
  const totalValid = scored + pending;
  const need = Math.max(4, Math.ceil((totalValid || 5) * 0.8));
  if (pending > 0) {
    // Operator hold 2026-08-05: no verdict while delivered pairs are unscored.
    console.log(`STATUS: PENDING — ${pending} delivered pair(s) unscored; no verdict until every valid pair is scored.`);
    if (grappeWins + pending < need) console.log(`NOTE: passing is already arithmetically impossible (grappe max ${grappeWins + pending} < ${need} needed of ${totalValid}).`);
  } else {
    console.log(grappeWins >= need
      ? `VERDICT: PREMISE PASSES (grappe ≥ ${need})`
      : `VERDICT: below the clear-majority bar (needs ≥ ${need} of ${totalValid || 5}; ties count against) — D3 plan-BLOCK if final`);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('fed-benchmark.mjs');
if (isMain) {
  const [, , cmd, ...args] = process.argv;
  const run = {
    submit: () => submit(args[0], args[1], args[2]),
    status: () => status(args[0]),
    collect: () => collect(args[0], args[1], args[2]),
    repackage: () => collect(args[0], args[1], args[2], { repackage: true }),
    tally: () => Promise.resolve(tally()),
  }[cmd];
  if (!run) { console.error('usage: fed-benchmark.mjs submit|status|collect|repackage|tally ...'); process.exit(2); }
  run().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
