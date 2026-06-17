#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildProbes } from '../lib/node-acceptance-probes.mjs';
import { runAcceptance, resolveNodeConfig, VERDICT } from '../lib/node-acceptance.mjs';

// A fully-mocked runtime context — no live system is touched.
function baseCtx(over = {}) {
  const config = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc-test-home', OPENCLAW_NODE_ID: 'testnode' });
  const teardown = [];
  const ctx = {
    config, runId: 'testrun', options: { mutate: true, deep: true }, teardown, path,
    fsp: {
      stat: async () => ({ size: 100, mode: 0o100600 }),
      access: async () => {},
      readFile: async (p) => {
        if (p === config.injectToken) return 'TESTTOKEN';
        if (p === config.transcriptSources) return JSON.stringify(['/tmp/acc-src']);
        return '';
      },
      writeFile: async () => {},
      unlink: async () => {},
    },
    httpGet: async () => ({ status: 200, json: {} }),
    httpPost: async () => ({ status: 200, json: {} }),
    queryDb: () => 0,
    writeDb: () => {},
    embed: async () => new Float32Array(1024).fill(0.1),
    runExtraction: async () => ({ entities: [{ name: 'x' }], decisions: [], themes: [] }),
    natsConnect: async () => mockNc(),
    importSession: async () => ({ sessionId: 'acc-probe-testrun', messageCount: 4, imported: true }),
    publishTrigger: async () => {},
  };
  return Object.assign(ctx, over);
}

function mockNc() {
  const queue = [];
  let wake = null;
  return {
    subscribe() {
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (queue.length) yield queue.shift();
            else await new Promise((r) => { wake = r; });
          }
        },
      };
    },
    publish(_subject, data) { queue.push({ data }); if (wake) { wake(); wake = null; } },
    async flush() {},
    async close() {},
    async jetstreamManager() {
      return { streams: { info: async () => ({ config: { subjects: ['local.>'] }, state: { messages: 5 } }) } };
    },
  };
}

const probeById = (ctx, id) => buildProbes(ctx).find((p) => p.id === id);

describe('node-acceptance probes — L0 presence', () => {
  it('L0-DB PASS when all DBs present + non-empty', async () => {
    const r = await probeById(baseCtx(), 'L0-DB').run();
    assert.equal(r.status, VERDICT.PASS);
  });
  it('L0-DB FAIL when a DB is missing', async () => {
    const ctx = baseCtx({ fsp: { ...baseCtx().fsp, stat: async (p) => { if (p.endsWith('graph-cache.db')) throw new Error('ENOENT'); return { size: 10, mode: 0o100600 }; } } });
    const r = await probeById(ctx, 'L0-DB').run();
    assert.equal(r.status, VERDICT.FAIL);
  });
  it('L0-TOKEN PASS when token present', async () => {
    const r = await probeById(baseCtx(), 'L0-TOKEN').run();
    assert.equal(r.status, VERDICT.PASS);
  });
});

describe('node-acceptance probes — LLM backing', () => {
  it('LLM-L2-MODEL PASS when configured model in tags', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 200, json: { models: [{ name: 'qwen3:8b' }] } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-MODEL').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-MODEL FAIL when configured model absent', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 200, json: { models: [{ name: 'llama3' }] } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-MODEL').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-GEN PASS on non-empty completion with eval_count', async () => {
    const ctx = baseCtx({ httpPost: async () => ({ status: 200, json: { response: 'OK', eval_count: 7 } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-GEN').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-GEN FAIL on empty/degenerate completion', async () => {
    const ctx = baseCtx({ httpPost: async () => ({ status: 200, json: { response: '', eval_count: 0 } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-GEN').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EMBED PASS at dim 1024 with norm>0', async () => {
    assert.equal((await probeById(baseCtx(), 'LLM-L2-EMBED').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-EMBED FAIL on wrong dimension', async () => {
    const ctx = baseCtx({ embed: async () => new Float32Array(512).fill(0.1) });
    assert.equal((await probeById(ctx, 'LLM-L2-EMBED').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EMBED BLOCK when model not cached', async () => {
    const ctx = baseCtx({ embed: async () => { throw new Error('model not cached — download first'); } });
    assert.equal((await probeById(ctx, 'LLM-L2-EMBED').run()).status, VERDICT.BLOCK);
  });
  it('LLM-L2-EXTRACT PASS on schema-valid extraction', async () => {
    assert.equal((await probeById(baseCtx(), 'LLM-L2-EXTRACT').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-EXTRACT FAIL on invalid extraction', async () => {
    const ctx = baseCtx({ runExtraction: async () => { throw new Error('schema validation failed'); } });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.FAIL);
  });
});

describe('node-acceptance probes — network', () => {
  it('NET-L2-JSZ PASS on JetStream stats', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 200, json: { streams: 1, memory: 0 } }) });
    assert.equal((await probeById(ctx, 'NET-L2-JSZ').run()).status, VERDICT.PASS);
  });
  it('NET-L2-JSZ FAIL on non-200', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 503, json: null }) });
    assert.equal((await probeById(ctx, 'NET-L2-JSZ').run()).status, VERDICT.FAIL);
  });
  it('NET-L2-STREAM PASS when per-node stream exists', async () => {
    assert.equal((await probeById(baseCtx(), 'NET-L2-STREAM').run()).status, VERDICT.PASS);
  });
  it('NET-L2-STREAM FAIL when stream missing', async () => {
    const nc = mockNc(); nc.jetstreamManager = async () => ({ streams: { info: async () => { throw new Error('stream not found'); } } });
    const ctx = baseCtx({ natsConnect: async () => nc });
    assert.equal((await probeById(ctx, 'NET-L2-STREAM').run()).status, VERDICT.FAIL);
  });
  it('NET-L2-PUBSUB PASS on round-trip echo', async () => {
    assert.equal((await probeById(baseCtx(), 'NET-L2-PUBSUB').run()).status, VERDICT.PASS);
  });
});

describe('node-acceptance probes — memory + gold round-trip', () => {
  it('MEM-L2-INGEST PASS when messages land + registers teardown', async () => {
    const ctx = baseCtx({ queryDb: () => 4 });
    const r = await probeById(ctx, 'MEM-L2-INGEST').run();
    assert.equal(r.status, VERDICT.PASS);
    assert.ok(ctx.teardown.length >= 1, 'should register cleanup');
  });
  it('MEM-L2-INGEST FAIL when ingest does not land', async () => {
    const ctx = baseCtx({ queryDb: () => 0 });
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.FAIL);
  });
  it('MEM-L2-INJECT PASS on well-formed 200', async () => {
    const ctx = baseCtx({ httpPost: async () => ({ status: 200, json: { block: 'mem', items: { concepts: 1, decisions: 2, snippets: 3 }, tokens: 40, elapsed_ms: 9 } }) });
    assert.equal((await probeById(ctx, 'MEM-L2-INJECT').run()).status, VERDICT.PASS);
  });
  it('MEM-L2-INJECT FAIL on 401', async () => {
    const ctx = baseCtx({ httpPost: async () => ({ status: 401, json: { error: 'unauthorized' } }) });
    assert.equal((await probeById(ctx, 'MEM-L2-INJECT').run()).status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP PASS when nonce ingested→extracted→retrieved', async () => {
    const ctx = baseCtx({
      queryDb: () => 3, // mentions landed
      httpPost: async () => ({ status: 200, json: { block: 'codename ACCPROBETESTRUN uses SQLite' } }),
    });
    const r = await probeById(ctx, 'MEM-L4-ROUNDTRIP').run();
    assert.equal(r.status, VERDICT.PASS);
  });
  it('MEM-L4-ROUNDTRIP BLOCK when no transcript source dir', async () => {
    const ctx = baseCtx({ fsp: { ...baseCtx().fsp, readFile: async () => '[]' } });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
  });
  it('MEM-L4-ROUNDTRIP FAIL when extraction never lands', async () => {
    const ctx = baseCtx({ queryDb: () => 0, httpPost: async () => ({ status: 200, json: { block: '' } }) });
    ctx.config.roundtripPollMs = 50; // don't wait the full budget in tests
    const r = await probeById(ctx, 'MEM-L4-ROUNDTRIP').run();
    assert.equal(r.status, VERDICT.FAIL);
  });
});

describe('node-acceptance orchestration', () => {
  it('drains teardown even on probe failure', async () => {
    let cleaned = 0;
    const ctx = baseCtx();
    const probes = [{
      id: 'X', layer: 'L2', axis: 'memory', required: true,
      run: async () => { ctx.teardown.push(async () => { cleaned++; }); throw new Error('boom'); },
    }];
    await runAcceptance({ profile: 'single-node', healthCheckFn: async () => ({}), ctx, probes });
    assert.equal(cleaned, 1, 'teardown must run');
  });
  it('--no-mutate turns mutating probes into SKIP', async () => {
    const allHealthy = { daemon: { ok: true, detail: '' }, nats: { ok: true, detail: '' }, ollama: { ok: true, detail: '' }, embedder: { ok: true, detail: '' }, sqlite: { ok: true, detail: '' }, workspace_writable: { ok: true, detail: '' } };
    const probes = [{ id: 'M', layer: 'L2', axis: 'memory', required: true, mutate: true, run: async () => ({ status: VERDICT.PASS, detail: 'ran' }) }];
    const rep = await runAcceptance({ profile: 'single-node', healthCheckFn: async () => allHealthy, ctx: baseCtx(), probes, mutate: false });
    const m = rep.results.find((x) => x.id === 'M');
    assert.equal(m.status, VERDICT.SKIP);
  });
});
