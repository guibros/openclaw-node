#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptance, computeGate, VERDICT } from '../lib/node-acceptance.mjs';

const allHealthy = {
  daemon: { ok: true, detail: 'pid=1', latency_ms: 1 },
  nats: { ok: true, detail: 'monitoring endpoint ok', latency_ms: 1 },
  ollama: { ok: true, detail: '1 model', latency_ms: 1 },
  embedder: { ok: true, detail: 'transformers available', latency_ms: 1 },
  sqlite: { ok: true, detail: 'state.db readable', latency_ms: 1 },
  workspace_writable: { ok: true, detail: 'writable', latency_ms: 1 },
};

describe('node-acceptance gate', () => {
  it('reports INCOMPLETE on single-node when L0/L2/L4 have no checks, even if every L1 PASSes', async () => {
    const r = await runAcceptance({ profile: 'single-node', probes: [], healthCheckFn: async () => allHealthy });
    assert.equal(r.gate.state, 'INCOMPLETE');
    assert.equal(r.gate.exitCode, 2);
    assert.deepEqual(r.gate.missingLayers, ['L0', 'L2', 'L4']);
    assert.notEqual(r.gate.state, 'ACCEPTED'); // never a false ACCEPTED
  });

  it('REJECTS when a required L1 check fails (axis-scoped so completeness does not mask it)', async () => {
    const downNats = { ...allHealthy, nats: { ok: false, detail: 'down', latency_ms: 1 } };
    const r = await runAcceptance({ profile: 'single-node', axis: 'network', probes: [], healthCheckFn: async () => downNats });
    assert.equal(r.gate.state, 'REJECTED');
    assert.equal(r.gate.exitCode, 1);
  });

  it('ACCEPTS a single fully-covered axis when all its required checks PASS', async () => {
    const r = await runAcceptance({ profile: 'single-node', axis: 'llm', probes: [], healthCheckFn: async () => allHealthy });
    assert.equal(r.gate.state, 'ACCEPTED');
    assert.equal(r.gate.exitCode, 0);
  });

  it('treats BLOCK as non-acceptance (unobservable is never PASS)', () => {
    const g = computeGate(
      [{ id: 'x', layer: 'L2', axis: 'memory', required: true, status: VERDICT.BLOCK }],
      'single-node', { axisFilter: 'memory' },
    );
    assert.equal(g.hasBlock, true);
    assert.equal(g.state, 'REJECTED');
  });

  it('emits an informational L3 N/A row on single-node', async () => {
    const r = await runAcceptance({ profile: 'single-node', probes: [], healthCheckFn: async () => allHealthy });
    const l3 = r.results.find(x => x.layer === 'L3');
    assert.ok(l3, 'expected an L3 row');
    assert.equal(l3.status, VERDICT.NA);
  });

  it('throws on an unknown --axis instead of ACCEPTing an empty result set', async () => {
    await assert.rejects(
      runAcceptance({ profile: 'single-node', axis: 'TYPO_AXIS', probes: [], healthCheckFn: async () => allHealthy }),
      /unknown axis 'TYPO_AXIS'/,
    );
  });

  it('an axis whose only rows are N/A is INCOMPLETE, never ACCEPTED', async () => {
    const r = await runAcceptance({ profile: 'single-node', axis: 'internode', probes: [], healthCheckFn: async () => allHealthy });
    assert.equal(r.gate.state, 'INCOMPLETE');
    assert.equal(r.gate.exitCode, 2);
  });
});
