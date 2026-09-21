/**
 * pipeline-runtime.test.mjs — step 2.7's `runtime:` verify on a REAL bus.
 *
 * Spawns nats-server (JetStream) and bin/mesh-task-daemon.js as real processes, then plays
 * three grappe members over NATS exactly the way mesh-agent does (subscribe to the round
 * subject, join, answer with a delimited artifact via mesh.collab.reflect). The worker drafts,
 * reviewer A reviews, reviewer B says NOTHING — never submits, never leaves, is never marked
 * dead. INVENTORY 2.7's contract: the session still reaches status: completed with a
 * collectable artifact inside the pass budget, and the degraded ledger names reviewer B.
 * This is the direct regression for the 3-of-5 run-2 failure (D15).
 *
 * What this is and is not: the daemon's real handlers over real JetStream KV on a real bus —
 * the same class of evidence steps 2.1–2.3 closed on. It is not the deployed fleet.
 *
 * Gated on the binary with the canonical skip marker 'nats-server not found on PATH'.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, StringCodec } from 'nats';
import { natsServerBin, freePort, startNatsServer } from './helpers/nats-server.mjs';
import { grappeFinalArtifact } from '../bin/fed-benchmark.mjs';

const SKIP = natsServerBin() ? false : 'nats-server not found on PATH';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sc = StringCodec();
const PASS_BUDGET_MS = 3000;

const DRAFT = 'DRAFT: A design note for the pipeline runtime probe. '.repeat(12);
const REVIEW_A = 'REVIEW A: section two needs a threat model; cite the file.';
const FINAL = 'FINAL: the design note, revised after review A. Review B was unavailable. '.repeat(10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs, why) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await pred();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(typeof why === 'function' ? why() : why);
}

describe('pipeline mode on a real nats-server + real mesh-task-daemon (2.7 runtime verify)', { skip: SKIP }, () => {
  let dir, port, server, daemon, nc;
  let daemonLog = '';

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-rt-'));
    port = await freePort();
    fs.mkdirSync(path.join(dir, 'js'));
    const conf = path.join(dir, 'nats.conf');
    fs.writeFileSync(conf, `listen: 127.0.0.1:${port}\njetstream { store_dir: ${JSON.stringify(path.join(dir, 'js'))} }\n`);
    server = await startNatsServer(conf);

    // The real daemon on the scratch bus. HOME is the temp dir so no operator env file or
    // identity leaks in; token mode with no token is an open loopback bus.
    daemon = spawn(process.execPath, [path.join(REPO, 'bin', 'mesh-task-daemon.js')], {
      env: {
        ...process.env, HOME: dir,
        OPENCLAW_NATS: `nats://127.0.0.1:${port}`, OPENCLAW_NATS_AUTH: 'token', OPENCLAW_NATS_TOKEN: '',
        OPENCLAW_NODE_ID: 'rt-lead', MESH_TASK_TTL_DAYS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemon.stdout.on('data', (d) => { daemonLog += d; });
    daemon.stderr.on('data', (d) => { daemonLog += d; });
    await waitFor(() => daemonLog.includes('Task daemon ready'), 20_000, () => `daemon did not become ready:\n${daemonLog}`);
    nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 3000 });
  });

  after(async () => {
    try { await nc?.close(); } catch { /* already closed */ }
    if (daemon && daemon.exitCode === null) {
      const exited = new Promise((r) => daemon.once('exit', r));
      daemon.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      if (daemon.exitCode === null) daemon.kill('SIGKILL');
    }
    if (server) await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function rpc(subject, payload) {
    const r = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: 5000 });
    const body = JSON.parse(sc.decode(r.data));
    if (!body.ok) throw new Error(`${subject}: ${body.error}`);
    return body.data;
  }
  async function kvGet(bucket, key) {
    const kv = await nc.jetstream().views.kv(bucket);
    const e = await kv.get(key).catch(() => null);
    return e ? JSON.parse(sc.decode(e.value)) : null;
  }

  it('one silenced reviewer: the session still completes inside the pass budget, and the ledger names them', async () => {
    const taskId = `rt-pipe-${Date.now()}`;
    const members = ['rt-w', 'rt-ra', 'rt-rb'];

    const collabEvents = [];
    const evSub = nc.subscribe('mesh.events.collab.>');
    (async () => { for await (const m of evSub) collabEvents.push(JSON.parse(sc.decode(m.data)).event); })();

    // What fed-benchmark `submit … grappe` sends (pipeline is now the default grappe arm).
    const task = await rpc('mesh.tasks.submit', {
      task_id: taskId, title: 'Pipeline runtime probe',
      description: 'Draft a short design note. Keep it self-contained.',
      budget_minutes: 5,
      collaboration: { mode: 'pipeline', passes: 3, pass_budget_ms: PASS_BUDGET_MS },
    });
    const sessionId = task.collab_session_id;
    assert.ok(sessionId, 'the daemon auto-created the session and wrote it back on the task');

    // Members subscribe BEFORE joining, as mesh-agent does, then join; the third join closes
    // recruiting and dispatches pass 1.
    const inbox = new Map(members.map((id) => [id, []]));
    for (const id of members) {
      const sub = nc.subscribe(`mesh.collab.${sessionId}.node.${id}.round`);
      (async () => { for await (const m of sub) inbox.get(id).push(JSON.parse(sc.decode(m.data))); })();
    }
    for (const id of members) await rpc('mesh.collab.join', { session_id: sessionId, node_id: id });
    const t0 = Date.now();
    const msgFor = (id, pass, timeout = 8000) =>
      waitFor(() => inbox.get(id).find((m) => m.pipeline_pass === pass), timeout, () => `${id} never received pass ${pass}\n${daemonLog.slice(-2000)}`);
    const reflect = (node, pass, type, content) => rpc('mesh.collab.reflect', {
      session_id: sessionId, node_id: node, round: pass, summary: `${node} pass ${pass}`, confidence: 0.9,
      parse_failed: false, pipeline_pass: pass, artifacts: [], circling_artifacts: [{ type, content }],
    });

    // Pass 1 — only the worker hears it.
    const p1 = await msgFor('rt-w', 1);
    assert.equal(p1.mode, 'pipeline');
    assert.equal(p1.pipeline_role, 'worker');
    assert.equal(p1.pipeline_artifact_type, 'workArtifact');
    assert.equal(inbox.get('rt-ra').length + inbox.get('rt-rb').length, 0, 'reviewers are idle during the draft');
    await reflect('rt-w', 1, 'workArtifact', DRAFT);

    // Pass 2 — both reviewers hear it; A answers; B is SILENT.
    const p2a = await msgFor('rt-ra', 2);
    await msgFor('rt-rb', 2);
    assert.ok(p2a.directed_input.includes(DRAFT.slice(0, 40)), 'reviewers see the draft');
    const t2 = Date.now();
    await reflect('rt-ra', 2, 'reviewArtifact', REVIEW_A);

    // Pass 3 must open by DEADLINE — B's cooperation is not a precondition.
    const p3 = await msgFor('rt-w', 3, PASS_BUDGET_MS + 5000);
    const openedAfter = Date.now() - t2;
    assert.ok(openedAfter >= PASS_BUDGET_MS - 250, `pass 3 opened ${openedAfter}ms after pass 2 — should be the deadline, not early`);
    assert.ok(p3.directed_input.includes(REVIEW_A.slice(0, 30)), 'the reviser sees review A');
    assert.match(p3.directed_input, /\[REVIEW UNAVAILABLE — timeout\]/, 'and sees the hole where B should be');
    await reflect('rt-w', 3, 'finalArtifact', FINAL);

    const session = await waitFor(async () => {
      const s = await kvGet('MESH_COLLAB', sessionId);
      return s && ['completed', 'aborted'].includes(s.status) ? s : null;
    }, 10_000, () => `session never went terminal\n${daemonLog.slice(-2000)}`);
    const elapsed = Date.now() - t0;

    // The contract.
    assert.equal(session.status, 'completed');
    assert.equal(session.pipeline.outcome, 'completed_degraded');
    assert.deepEqual(session.pipeline.degraded.map((d) => [d.pass, d.node_id, d.reason]), [[2, 'rt-rb', 'timeout']]);
    assert.equal(session.nodes.find((n) => n.node_id === 'rt-rb').status, 'active', 'the silent reviewer was never marked dead');
    assert.equal(session.result.pipeline_final_type, 'finalArtifact');
    assert.ok(session.result.pipeline_final_artifact.length >= 400);
    assert.ok(elapsed < 3 * PASS_BUDGET_MS + 6000, `completed in ${elapsed}ms — inside the pass budget`);

    // The collector accepts it as a contract-compliant (degraded) delivery.
    const art = grappeFinalArtifact(session);
    assert.equal(art.key, 'pipeline_finalArtifact');
    assert.equal(art.degraded, true);
    assert.equal(art.degraded_ledger.length, 1);

    // The parent task completed with the same result.
    const parent = await waitFor(async () => {
      const t = await kvGet('MESH_TASKS', taskId);
      return t && t.status === 'completed' ? t : null;
    }, 5000, 'parent task did not complete');
    assert.equal(parent.result.pipeline_final_type, 'finalArtifact');

    // No agreement machinery fired, on the bus or in the daemon.
    await sleep(300);
    assert.ok(collabEvents.includes('pipeline_pass_started'));
    assert.ok(collabEvents.includes('completed'));
    assert.ok(!collabEvents.includes('converged'), 'no converged event');
    assert.ok(!collabEvents.includes('circling_gate'), 'no gate event');
    assert.match(daemonLog, /PIPELINE PASS 2 CLOSED WITHOUT rt-rb \(timeout\)/);
    assert.match(daemonLog, /PIPELINE COMPLETED .* shipping finalArtifact \(degraded: 1 ledger entries\)/);
    assert.doesNotMatch(daemonLog, /CIRCLING GATE|COLLAB CONVERGED/);
    evSub.unsubscribe();
  });
});
