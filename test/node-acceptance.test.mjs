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

  // --skip-axis (install --skip-llm): the LLM axis is deliberately absent, so
  // its rows must be N/A-but-covered, its dependants skipped, and the gate
  // must still be able to ACCEPT the layers that ARE provisioned.
  const noLlm = { ...allHealthy, ollama: { ok: false, detail: 'no model', latency_ms: 1 }, embedder: { ok: false, detail: 'absent', latency_ms: 1 } };
  const pass = (id, layer, axis, extra = {}) => ({ id, layer, axis, required: true, ...extra, run: async () => ({ status: VERDICT.PASS, detail: 'ok' }) });
  const skipProbes = () => [
    pass('P-L0', 'L0', 'storage'),
    pass('P-L2', 'L2', 'memory'),
    pass('P-L4', 'L4', 'memory'),
    pass('P-L4-NEEDS-LLM', 'L4', 'memory', { needs: ['llm'] }),
    { id: 'LLM-L4', layer: 'L4', axis: 'llm', required: true, run: async () => { throw new Error('must not run'); } },
  ];

  it('--skip-axis turns a not-provisioned axis into covered N/A rows instead of FAIL', async () => {
    const r = await runAcceptance({ profile: 'single-node', probes: skipProbes(), skipAxes: ['llm'], healthCheckFn: async () => noLlm });
    assert.equal(r.gate.state, 'ACCEPTED');
    assert.deepEqual(r.gate.missingLayers, []);
    const skipped = r.results.filter(x => x.skipped);
    assert.deepEqual(skipped.map(x => x.id).sort(), ['LLM-L1-1', 'LLM-L1-3', 'LLM-L4', 'P-L4-NEEDS-LLM']);
    assert.ok(skipped.every(x => x.status === VERDICT.NA));
    assert.deepEqual(r.meta.skipAxes, ['llm']);
  });

  it('without --skip-axis the same node is REJECTED (skipping is explicit, never implied)', async () => {
    const probes = skipProbes().filter(p => p.id !== 'LLM-L4');
    const r = await runAcceptance({ profile: 'single-node', probes, healthCheckFn: async () => noLlm });
    assert.equal(r.gate.state, 'REJECTED');
    assert.equal(r.results.filter(x => x.skipped).length, 0);
  });

  it('an axis whose only rows are N/A is INCOMPLETE, never ACCEPTED', async () => {
    const r = await runAcceptance({ profile: 'single-node', axis: 'internode', probes: [], healthCheckFn: async () => allHealthy });
    assert.equal(r.gate.state, 'INCOMPLETE');
    assert.equal(r.gate.exitCode, 2);
  });
});
