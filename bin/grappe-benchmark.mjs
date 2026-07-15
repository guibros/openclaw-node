#!/usr/bin/env node
/**
 * grappe-benchmark.mjs — the 2.6 premise benchmark harness.
 *
 * Runs the SAME task two ways on the SAME model + harness and collects both
 * deliverables anonymized, so the operator can blind-score which is better:
 *   - SOLO   : one OpenClaw claims + executes the task (no reviewers).
 *   - GRAPPE : 3 OpenClaws circle it (adversarial, max_subrounds:1 so it closes
 *              cleanly — finding 13).
 * The ONLY variable is the reviewers. Everything else is held constant.
 *
 * Prereqs (all from the node's own services / NODE_SPEC §6):
 *   - launchd mesh-task-daemon + bridge running (the bus coordinator)
 *   - 3 mesh-agents running with MESH_LLM_PROVIDER=claude (the OpenClaw workers)
 *     for grappe rounds; solo needs ≥1 agent.
 *
 * Usage:
 *   node bin/grappe-benchmark.mjs run <task.json>      # submit solo + grappe, wait, collect anonymized
 *   node bin/grappe-benchmark.mjs collect <solo_id> <grappe_session>   # collect a finished pair
 *   node bin/grappe-benchmark.mjs reveal <pair-dir>    # after scoring: unseal which is which
 *
 * A task.json: { "task_id_base": "...", "title": "...", "description": "...", "metric": "..." }
 * Outputs a pair dir with candidate-A.md, candidate-B.md, and a sealed .mapping.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
const { natsConnectOpts } = require('../lib/nats-resolve.js');
const sc = StringCodec();
const NATS = process.env.OPENCLAW_NATS || 'nats://127.0.0.1:4222';

const strip = (s) => String(s ?? '').replace(/\[[0-9;?]*[A-Za-z]/g, '').replace(/\]/g, '');

async function bus() { return connect({ ...natsConnectOpts(), servers: NATS, timeout: 10000 }); }

async function submit(nc, task, collab) {
  const payload = {
    task_id: task.task_id_base + (collab ? '-grappe-' : '-solo-') + Date.now(),
    title: task.title,
    description: task.description,
    metric: task.metric || 'Quality of the deliverable',
    budget_minutes: 90,
    llm_provider: 'claude',
  };
  if (collab) payload.collaboration = { mode: 'circling_strategy', max_subrounds: 1, automation_tier: 1 };
  const resp = await nc.request('mesh.tasks.submit', sc.encode(JSON.stringify(payload)), { timeout: 15000 });
  const r = JSON.parse(sc.decode(resp.data));
  if (r.error) throw new Error('submit: ' + r.error);
  return payload.task_id;
}

async function pollTask(nc, taskId, deadlineMs) {
  const kv = await nc.jetstream().views.kv('MESH_TASKS');
  while (Date.now() < deadlineMs) {
    const e = await kv.get(taskId).catch(() => null);
    if (e) {
      const t = JSON.parse(new TextDecoder().decode(e.value));
      if (['completed', 'done', 'failed', 'cancelled'].includes(t.status)) return t;
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  return null;
}

async function pollGrappe(nc, taskId, deadlineMs) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let sessionKey = null;
  while (Date.now() < deadlineMs) {
    if (!sessionKey) {
      for await (const k of await kv.keys()) if (k.includes(taskId)) { sessionKey = k; break; }
    }
    if (sessionKey) {
      const e = await kv.get(sessionKey).catch(() => null);
      if (e) {
        let s; try { s = JSON.parse(new TextDecoder().decode(e.value)); } catch { s = null; }
        if (s && (s.status === 'completed' || s.circling?.phase === 'complete' ||
                  (s.status === 'aborted' && Object.keys(s.circling?.artifacts || {}).length))) return s;
      }
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  return null;
}

function soloDeliverable(t) {
  const r = t?.result || {};
  return strip(r.summary || (Array.isArray(r.artifacts) ? r.artifacts.join('\n\n') : '') || '(no solo deliverable captured)');
}

function grappeDeliverable(s) {
  const arts = s?.circling?.artifacts || {};
  // The worker's LAST workArtifact is the deliverable; fall back to the largest worker artifact.
  const workerKeys = Object.keys(arts).filter(k => k.includes('worker') && k.includes('workArtifact'));
  let best = '', bestLen = 0;
  for (const k of workerKeys.length ? workerKeys : Object.keys(arts)) {
    const c = strip(typeof arts[k] === 'string' ? arts[k] : (arts[k]?.content ?? ''));
    if (c.length > bestLen) { best = c; bestLen = c.length; }
  }
  return best || '(no grappe deliverable captured)';
}

async function cmdRun(taskFile) {
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const outRoot = path.join(os.homedir(), '.openclaw', 'benchmark', task.task_id_base + '-' + Date.now());
  fs.mkdirSync(outRoot, { recursive: true });
  const nc = await bus();
  console.log(`[benchmark] ${task.task_id_base}: submitting solo + grappe (same task, same model)`);
  const soloId = await submit(nc, task, false);
  const grappeId = await submit(nc, task, true);
  console.log(`  solo:   ${soloId}\n  grappe: ${grappeId}\n  waiting (grappe ~25-40m, solo ~5-15m)...`);
  const deadline = Date.now() + 90 * 60 * 1000;
  const [soloT, grappeS] = await Promise.all([pollTask(nc, soloId, deadline), pollGrappe(nc, grappeId, deadline)]);
  await nc.close();

  const solo = soloT ? soloDeliverable(soloT) : '(solo did not finish in time)';
  const grappe = grappeS ? grappeDeliverable(grappeS) : '(grappe did not finish in time)';
  // Anonymize: coin-flip A/B by content hash parity (deterministic, no Math.random)
  const grappeIsA = (grappe.length % 2) === 0;
  const A = grappeIsA ? grappe : solo, B = grappeIsA ? solo : grappe;
  fs.writeFileSync(path.join(outRoot, 'TASK.md'), `# ${task.title}\n\n${task.description}\n\n**Metric:** ${task.metric || '—'}\n`);
  fs.writeFileSync(path.join(outRoot, 'candidate-A.md'), A);
  fs.writeFileSync(path.join(outRoot, 'candidate-B.md'), B);
  fs.writeFileSync(path.join(outRoot, '.mapping.json'), JSON.stringify({ A: grappeIsA ? 'grappe' : 'solo', B: grappeIsA ? 'solo' : 'grappe', soloId, grappeId }, null, 2));
  console.log(`\n[benchmark] pair ready — BLIND. Read TASK.md, candidate-A.md, candidate-B.md; pick the better one.`);
  console.log(`  ${outRoot}`);
  console.log(`  after scoring: node bin/grappe-benchmark.mjs reveal ${outRoot}`);
}

function cmdReveal(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.mapping.json'), 'utf8'));
  console.log(`Candidate A was: ${m.A.toUpperCase()}\nCandidate B was: ${m.B.toUpperCase()}`);
}

const { positionals } = parseArgs({ allowPositionals: true });
const [cmd, ...rest] = positionals;
if (cmd === 'run') await cmdRun(rest[0]);
else if (cmd === 'reveal') cmdReveal(rest[0]);
else { console.log('usage: grappe-benchmark.mjs run <task.json> | reveal <pair-dir>'); process.exit(1); }
