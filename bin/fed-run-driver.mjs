#!/usr/bin/env node
/**
 * bin/fed-run-driver.mjs — D14 slate-run orchestrator (step 2.6 rerun).
 *
 * Enforces RUN_RULES.md mechanically:
 *   - 60-min per-arm budget from submission
 *   - gate forfeit ONLY on two gate observations >= 90 s apart (the run-1
 *     driver counted consecutive 45 s polls — the invalidating P0)
 *   - inter-poll gaps > GAP_MS are HOST SUSPENSION: the pair is
 *     INFRA_INVALID (rerun-eligible), never a forfeit
 *   - both arms always run (rule 3 needs both outcomes)
 *   - forfeit records preserve usage + wall-clock from KV
 *   - delivered pairs collected blind via fed-benchmark; forfeits get
 *     mechanical key/score; INFRA_INVALID pairs get neither
 *
 * Usage: node bin/fed-run-driver.mjs   (env D14_RUN=r2 prefixes task ids)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── Pure, tested rule logic ─────────────────────────────────────────────

/** Gate forfeit per RUN_RULES: two gate observations >= minGapMs apart,
 *  with no intervening non-gate observation. */
export function createGateTracker(minGapMs = 90_000) {
  let firstAt = null;
  return {
    observe(isGate, nowMs) {
      if (!isGate) { firstAt = null; return false; }
      if (firstAt == null) { firstAt = nowMs; return false; }
      return (nowMs - firstAt) >= minGapMs;
    },
  };
}

/** Host-suspension detector: a gap between consecutive polls far beyond the
 *  cadence means the host (and every arm on it) was frozen. */
export function createGapDetector(maxGapMs = 5 * 60_000) {
  let lastAt = null;
  return {
    check(nowMs) {
      const gap = lastAt == null ? 0 : nowMs - lastAt;
      lastAt = nowMs;
      return gap > maxGapMs ? gap : 0;
    },
  };
}

// ── Runner ──────────────────────────────────────────────────────────────

const RUN = process.env.D14_RUN || 'r2';
const LOG = path.join(REPO, 'benchmark', `run-d14-${RUN}.log`);
const PAIRS = path.join(REPO, 'benchmark', 'pairs-d14');
const SLATE = path.join(REPO, 'memory-plan/plans/federation/audits/step26_premise-benchmark/slate');
const ARM_BUDGET_MS = 60 * 60 * 1000;
const POLL_SOLO_MS = 30_000;
const POLL_GRAPPE_MS = 45_000;

const require_ = createRequire(path.join(REPO, 'package.json'));
const { connect, StringCodec } = require_('nats');
const { natsConnectOpts } = require_(path.join(REPO, 'lib/nats-resolve.js'));
const sc = StringCodec();

const log = (m) => { const l = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG, l); process.stdout.write(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fb = (...args) => execFileSync('node', [path.join(REPO, 'bin/fed-benchmark.mjs'), ...args], { cwd: REPO, encoding: 'utf8', timeout: 120000 });

async function kvOp(fn) {
  const nc = await connect({ ...natsConnectOpts(), timeout: 10000 });
  try { return await fn(nc); } finally { await nc.close(); }
}
const getTask = (id) => kvOp(async (nc) => {
  const kv = await nc.jetstream().views.kv('MESH_TASKS');
  const e = await kv.get(id).catch(() => null);
  return e ? JSON.parse(new TextDecoder().decode(e.value)) : null;
});
const getSession = (taskId) => kvOp(async (nc) => {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let found = null;
  for await (const k of await kv.keys()) if (k.includes(taskId)) found = k;
  if (!found) return null;
  const e = await kv.get(found);
  const s = JSON.parse(new TextDecoder().decode(e.value));
  s.__kvKey = found;
  return s;
});
const abortSession = (kvKey, reason) => kvOp(async (nc) => {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  const e = await kv.get(kvKey);
  const s = JSON.parse(new TextDecoder().decode(e.value));
  s.status = 'aborted'; s.abort_reason = reason;
  await kv.put(kvKey, sc.encode(JSON.stringify(s)));
});

function armCosts(task, session) {
  const c = {};
  if (task) {
    c.solo_usage = task.result?.cost ?? null;
    c.solo_wall_ms = (Date.parse(task.completed_at ?? '') - Date.parse(task.started_at ?? task.created_at ?? '')) || null;
    c.solo_status = task.status;
  }
  if (session) {
    c.grappe_usage = session.circling?.usage_total ?? null;
    c.grappe_wall_ms = (Date.parse(session.completed_at ?? new Date().toISOString()) - Date.parse(session.created_at ?? '')) || null;
    c.grappe_status = session.status; c.grappe_phase = session.circling?.phase;
  }
  return c;
}

function writeForfeit(name, outcome, reason, costs) {
  const dir = path.join(PAIRS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'forfeit.json'), JSON.stringify({ name, outcome, reason, costs, run: RUN, recordedAt: new Date().toISOString() }, null, 2));
  const key = { A: 'solo', B: 'grappe' };
  let score;
  if (outcome === 'grappe_forfeit') score = { winner: 'A', notes: `forfeit: ${reason}` };
  else if (outcome === 'solo_forfeit') score = { winner: 'B', notes: `forfeit: ${reason}` };
  else score = { winner: 'tie', notes: `both arms forfeited - counts against grappe per RUN_RULES: ${reason}` };
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2));
  fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(score, null, 2));
  log(`${name}: FORFEIT RECORDED (${outcome}) — ${reason}`);
}

function writeInfraInvalid(name, gapMs, phase, costs) {
  const dir = path.join(PAIRS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'infra_invalid.json'), JSON.stringify({
    name, run: RUN, gap_ms: gapMs, during: phase, costs,
    reason: `host suspension detected: ${Math.round(gapMs / 60000)}-minute inter-poll gap — pair INFRA_INVALID per RUN_RULES clause 5 (rerun-eligible, not a forfeit)`,
    recordedAt: new Date().toISOString(),
  }, null, 2));
  log(`${name}: INFRA_INVALID (${Math.round(gapMs / 60000)}m suspension during ${phase}) — no score recorded`);
}

async function runSolo(id, file, gap) {
  fb('submit', id, 'solo', file);
  log(`${id}: submitted`);
  const t0 = Date.now();
  while (Date.now() - t0 < ARM_BUDGET_MS) {
    await sleep(POLL_SOLO_MS);
    const gapMs = gap.check(Date.now());
    if (gapMs) return { infra: gapMs };
    const t = await getTask(id).catch(() => null);
    if (!t) continue;
    if (t.status === 'completed') { log(`${id}: completed (${Math.round((Date.now() - t0) / 1000)}s)`); return { ok: true }; }
    if (['failed', 'cancelled'].includes(t.status)) { log(`${id}: ${t.status}`); return { ok: false, reason: `solo task ${t.status}` }; }
  }
  return { ok: false, reason: 'solo 60-min budget exceeded' };
}

async function runGrappe(id, file, gap) {
  fb('submit', id, 'grappe', file);
  log(`${id}: submitted`);
  const t0 = Date.now();
  const gate = createGateTracker(90_000);
  while (Date.now() - t0 < ARM_BUDGET_MS) {
    await sleep(POLL_GRAPPE_MS);
    const now = Date.now();
    const gapMs = gap.check(now);
    if (gapMs) { const s = await getSession(id).catch(() => null); return { infra: gapMs, kvKey: s?.__kvKey }; }
    const s = await getSession(id).catch(() => null);
    if (!s) continue;
    const phase = s.circling?.phase;
    if (['completed', 'converged'].includes(s.status)) { log(`${id}: session ${s.status} (${Math.round((now - t0) / 1000)}s)`); return { ok: true }; }
    if (s.status === 'aborted') { log(`${id}: session aborted`); return { ok: false, reason: 'session aborted', kvKey: s.__kvKey }; }
    const isGate = s.status === 'active' && phase === 'complete';
    if (isGate) log(`${id}: gate-state observed (phase complete, status active)`);
    else log(`${id}: ${s.status}/${phase} arts=${Object.keys(s.circling?.artifacts || {}).length}`);
    if (gate.observe(isGate, now)) {
      return { ok: false, reason: 'unresolved human gate (gate observations >=90s apart) - immediate forfeit per RUN_RULES clause 2', kvKey: s.__kvKey };
    }
  }
  const s = await getSession(id).catch(() => null);
  return { ok: false, reason: 'grappe 60-min budget exceeded', kvKey: s?.__kvKey };
}

const SLATE_PAIRS = [
  { n: 1, slug: 'nodeid', file: '1-verify-nodeid-gap.md' },
  { n: 2, slug: 'deploydoc', file: '2-deploy-doc-drift.md' },
  { n: 3, slug: 'natsresolve', file: '3-nats-resolve-audit.md' },
  { n: 4, slug: 'watcher', file: '4-watcher-contract-audit.md' },
  { n: 5, slug: 'killproto', file: '5-grappe-kill-protocol.md' },
];

async function main() {
  log(`=== D14 SLATE RUN ${RUN} START — RUN_RULES.md governs; gate >=90s; gap >5m = INFRA_INVALID ===`);
  for (const p of SLATE_PAIRS) {
    const name = `pair${p.n}-${p.slug}`;
    const soloId = `d14${RUN}p${p.n}-${p.slug}-solo`;
    const grappeId = `d14${RUN}p${p.n}-${p.slug}-grappe`;
    const file = path.join(SLATE, p.file);
    log(`=== ${name}: START (task ${p.file}) ===`);
    const gap = createGapDetector(5 * 60_000);
    gap.check(Date.now());

    const solo = await runSolo(soloId, file, gap);
    const grappe = solo.infra ? { infra: solo.infra } : await runGrappe(grappeId, file, gap);

    const [task, session] = [await getTask(soloId).catch(() => null), await getSession(grappeId).catch(() => null)];
    const costs = armCosts(task, session);

    if (grappe.kvKey && !grappe.ok) {
      await abortSession(grappe.kvKey, `D14 ${RUN} ${name}: ${grappe.infra ? 'INFRA_INVALID host suspension' : grappe.reason}`).catch((e) => log(`${name}: session abort failed: ${e.message}`));
    }

    if (solo.infra || grappe.infra) {
      writeInfraInvalid(name, solo.infra || grappe.infra, solo.infra ? 'solo arm' : 'grappe arm', costs);
    } else if (solo.ok && grappe.ok) {
      try {
        fb('collect', name, soloId, grappeId);
        log(`${name}: COLLECTED — blind pair ready for operator scoring`);
      } catch (e) {
        const msg = (e.stderr || e.message || '').toString().slice(0, 300);
        writeForfeit(name, 'grappe_forfeit', `contract failure at collect: ${msg}`, costs);
      }
    } else if (solo.ok && !grappe.ok) {
      writeForfeit(name, 'grappe_forfeit', grappe.reason, costs);
    } else if (!solo.ok && grappe.ok) {
      writeForfeit(name, 'solo_forfeit', solo.reason, costs);
    } else {
      writeForfeit(name, 'both_forfeit', `solo: ${solo.reason}; grappe: ${grappe.reason}`, costs);
    }
    log(`=== ${name}: DONE ===`);
  }
  log(`=== D14 SLATE RUN ${RUN} COMPLETE — operator: blind-score delivered pairs, then tally. ===`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('fed-run-driver.mjs');
if (isMain) main().catch((e) => { log(`DRIVER FATAL: ${e.message}`); process.exit(1); });
