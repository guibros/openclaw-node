/**
 * circling-adaptive-convergence.test.mjs — Unit + integration tests for paper §14.1.
 *
 * Verifies that advanceCirclingStep skips remaining sub-rounds when all active
 * nodes vote 'converged' on step 2 (the integration step) before max_subrounds
 * is exhausted.
 *
 * Suite 1 (unit): in-memory mock KV — no NATS needed.
 * Suite 2 (integration): real NATS with JetStream — requires nats-server on PATH.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync, spawn as spawnProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { CollabStore, COLLAB_MODE, createSession } = require('../lib/mesh-collab');

// Minimal in-memory KV mock — replicates the revision-CAS contract CollabStore expects.
function makeMockKV() {
  const store = new Map(); // key → { value: Uint8Array, revision: number }
  let seq = 0;
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      seq++;
      store.set(key, { value, revision: seq });
      return seq;
    },
    async update(key, value, revision) {
      const entry = store.get(key);
      if (!entry) throw Object.assign(new Error('key not found'), { code: '10071' });
      if (entry.revision !== revision) {
        throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
      }
      seq++;
      store.set(key, { value, revision: seq });
      return seq;
    },
  };
}

// Build a circling session with the circling state machine pre-positioned at
// circling/step2 of the given subround, with given reflections for step 2.
async function buildSessionAtStep2(store, { maxSubrounds, subround, reflections }) {
  const spec = {
    mode: COLLAB_MODE.CIRCLING_STRATEGY,
    min_nodes: 3,
    max_subrounds: maxSubrounds,
    automation_tier: 1, // tier 1 — no gates
  };
  const session = createSession('task-test', spec);
  session.status = 'active';

  // Wire up 3 nodes with roles
  session.nodes = [
    { node_id: 'worker', role: 'worker', status: 'active' },
    { node_id: 'reviewerA', role: 'reviewerA', status: 'active' },
    { node_id: 'reviewerB', role: 'reviewerB', status: 'active' },
  ];

  // Set circling state to the desired subround, step 2
  session.circling.worker_node_id = 'worker';
  session.circling.reviewerA_node_id = 'reviewerA';
  session.circling.reviewerB_node_id = 'reviewerB';
  session.circling.phase = 'circling';
  session.circling.current_subround = subround;
  session.circling.current_step = 2;

  // Add a round containing the provided step-2 reflections
  session.rounds = [{
    round_number: subround,
    started_at: new Date().toISOString(),
    completed_at: null,
    shared_intel: '',
    reflections,
  }];

  await store.put(session);
  return session.session_id;
}

describe('advanceCirclingStep — adaptive convergence (paper §14.1)', () => {
  it('unanimous converge in SR1 with max_subrounds=3 → early finalization (skips SR2/SR3)', async () => {
    const kv = makeMockKV();
    const collab = new CollabStore(kv);

    const allConvergedReflections = [
      { node_id: 'worker',    vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerA', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerB', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
    ];

    const sessionId = await buildSessionAtStep2(collab, {
      maxSubrounds: 3,
      subround: 1,
      reflections: allConvergedReflections,
    });

    const result = await collab.advanceCirclingStep(sessionId);

    assert.equal(result.phase, 'finalization', 'should advance to finalization, not next subround');
    assert.equal(result.step, 0, 'finalization starts at step 0');
    assert.equal(result.needsGate, false, 'tier 1 — no gate');
  });

  it('one node votes continue in SR1 with max_subrounds=3 → advances to SR2', async () => {
    const kv = makeMockKV();
    const collab = new CollabStore(kv);

    const partialConvergeReflections = [
      { node_id: 'worker',    vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerA', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerB', vote: 'continue',  circling_step: 2, artifacts: [], confidence: 0.5, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
    ];

    const sessionId = await buildSessionAtStep2(collab, {
      maxSubrounds: 3,
      subround: 1,
      reflections: partialConvergeReflections,
    });

    const result = await collab.advanceCirclingStep(sessionId);

    assert.equal(result.phase, 'circling', 'should stay in circling phase');
    assert.equal(result.subround, 2, 'should advance to subround 2');
    assert.equal(result.step, 1, 'next subround starts at step 1');
  });

  it('unanimous converge in final subround → finalization (normal end-of-subrounds path)', async () => {
    const kv = makeMockKV();
    const collab = new CollabStore(kv);

    const allConvergedReflections = [
      { node_id: 'worker',    vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerA', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerB', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
    ];

    // SR3 is the last subround — normal path, not the early exit
    const sessionId = await buildSessionAtStep2(collab, {
      maxSubrounds: 3,
      subround: 3,
      reflections: allConvergedReflections,
    });

    const result = await collab.advanceCirclingStep(sessionId);

    assert.equal(result.phase, 'finalization', 'should finalize at last subround');
    assert.equal(result.step, 0);
  });

  it('continue votes in final subround → finalization (burn path)', async () => {
    const kv = makeMockKV();
    const collab = new CollabStore(kv);

    const continueReflections = [
      { node_id: 'worker',    vote: 'continue', circling_step: 2, artifacts: [], confidence: 0.4, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerA', vote: 'continue', circling_step: 2, artifacts: [], confidence: 0.4, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      { node_id: 'reviewerB', vote: 'continue', circling_step: 2, artifacts: [], confidence: 0.4, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
    ];

    const sessionId = await buildSessionAtStep2(collab, {
      maxSubrounds: 3,
      subround: 3,
      reflections: continueReflections,
    });

    const result = await collab.advanceCirclingStep(sessionId);

    assert.equal(result.phase, 'finalization', 'burn path: finalize after exhausting subrounds');
  });

  it('automation_tier >= 2 sets needsGate on early finalization', async () => {
    const kv = makeMockKV();
    const collab = new CollabStore(kv);

    const spec = {
      mode: COLLAB_MODE.CIRCLING_STRATEGY,
      min_nodes: 3,
      max_subrounds: 3,
      automation_tier: 2,
    };
    const session = createSession('task-gate', spec);
    session.status = 'active';
    session.nodes = [
      { node_id: 'worker',    role: 'worker',    status: 'active' },
      { node_id: 'reviewerA', role: 'reviewerA', status: 'active' },
      { node_id: 'reviewerB', role: 'reviewerB', status: 'active' },
    ];
    session.circling.worker_node_id = 'worker';
    session.circling.reviewerA_node_id = 'reviewerA';
    session.circling.reviewerB_node_id = 'reviewerB';
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 2;
    session.rounds = [{
      round_number: 1,
      started_at: new Date().toISOString(),
      completed_at: null,
      shared_intel: '',
      reflections: [
        { node_id: 'worker',    vote: 'converged', circling_step: 2, artifacts: [], confidence: 1, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
        { node_id: 'reviewerA', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
        { node_id: 'reviewerB', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1, summary: '', learnings: '', parse_failed: false, submitted_at: '' },
      ],
    }];

    await collab.put(session);
    const result = await collab.advanceCirclingStep(session.session_id);

    assert.equal(result.phase, 'finalization');
    assert.equal(result.needsGate, true, 'tier 2 should set needsGate on early finalization');
  });
});

// ── Suite 2: integration via real NATS + JetStream ────────────────────────────
// Gated on nats-server binary. Provides the "runtime:" evidence for step 2.2:
// a scripted session that converges unanimously in SR1 with max_subrounds=3
// advances to finalization after SR1, skipping SR2 and SR3.

let NATS_BIN = null;
try { NATS_BIN = execSync('which nats-server', { encoding: 'utf8' }).trim(); } catch { /* skip */ }
const NATS_SKIP = NATS_BIN ? undefined : 'nats-server not found on PATH';

function startNatsServer({ port, storeDir }) {
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(NATS_BIN, ['-p', String(port), '-a', '127.0.0.1', '-js', '-sd', storeDir], { stdio: 'pipe' });
    let ready = false;
    proc.stderr.on('data', (chunk) => {
      if (!ready && chunk.toString().includes('Server is ready')) {
        ready = true; resolve({ proc, port });
      }
    });
    proc.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('nats-server start timeout')); }, 5000);
  });
}

describe('advanceCirclingStep — adaptive convergence integration (real NATS KV)', { skip: NATS_SKIP }, () => {
  let storeDir, nats, nc, kv, collab;
  const PORT = 14879;

  before(async () => {
    const { connect, StringCodec } = await import('nats');
    storeDir = await mkdtemp(join(tmpdir(), 'circling-adapt-nats-'));
    nats = await startNatsServer({ port: PORT, storeDir });
    nc = await connect({ servers: `nats://127.0.0.1:${PORT}` });
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({ name: 'KV_MESH_COLLAB', subjects: ['$KV.MESH_COLLAB.>'] });
    kv = await js.views.kv('MESH_COLLAB');
    collab = new CollabStore(kv);
  });

  after(async () => {
    await nc?.close();
    nats?.proc?.kill();
    await rm(storeDir, { recursive: true, force: true });
  });

  it('mock session with max_subrounds=3: unanimous SR1 converge → finalizes after SR1 (skips SR2/SR3)', async () => {
    const spec = {
      mode: COLLAB_MODE.CIRCLING_STRATEGY,
      min_nodes: 3,
      max_subrounds: 3,
      automation_tier: 1,
    };
    const session = createSession('step22-rt-001', spec);
    session.status = 'active';
    session.nodes = [
      { node_id: 'worker',    role: 'worker',    status: 'active' },
      { node_id: 'reviewerA', role: 'reviewerA', status: 'active' },
      { node_id: 'reviewerB', role: 'reviewerB', status: 'active' },
    ];
    session.circling.worker_node_id = 'worker';
    session.circling.reviewerA_node_id = 'reviewerA';
    session.circling.reviewerB_node_id = 'reviewerB';
    session.circling.phase = 'circling';
    session.circling.current_subround = 1;
    session.circling.current_step = 2;
    session.rounds = [{
      round_number: 1,
      started_at: new Date().toISOString(),
      completed_at: null,
      shared_intel: '',
      reflections: [
        { node_id: 'worker',    vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: 'mock output', learnings: '', parse_failed: false, submitted_at: '' },
        { node_id: 'reviewerA', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: 'mock output', learnings: '', parse_failed: false, submitted_at: '' },
        { node_id: 'reviewerB', vote: 'converged', circling_step: 2, artifacts: [], confidence: 1.0, summary: 'mock output', learnings: '', parse_failed: false, submitted_at: '' },
      ],
    }];

    // Store session in real NATS KV
    await collab.put(session);

    // Advance the state machine — this hits the live KV
    const result = await collab.advanceCirclingStep(session.session_id);

    // Verify early exit: SR1 converged → finalization (not SR2)
    assert.equal(result.phase, 'finalization', 'early finalization: SR1 unanimous converge');
    assert.equal(result.step, 0);
    assert.equal(result.subround, 1, 'subround stays at 1 — did NOT advance to SR2');

    // Confirm the KV actually persisted the finalization state
    const stored = await collab.get(session.session_id);
    assert.equal(stored.circling.phase, 'finalization', 'KV reflects finalization state');
    assert.equal(stored.circling.current_subround, 1, 'KV: still SR1 — early exit worked');
    assert.equal(stored.circling.max_subrounds, 3, 'KV: max_subrounds=3 unchanged');

    // Log the evidence line for the audit
    console.log([
      `[step22-runtime] session=${session.session_id}`,
      `max_subrounds=${stored.circling.max_subrounds}`,
      `finalized_after_sr=${stored.circling.current_subround}`,
      `phase=${stored.circling.phase}`,
      `skipped_subrounds=${stored.circling.max_subrounds - stored.circling.current_subround}`,
    ].join(' '));
  });
});
