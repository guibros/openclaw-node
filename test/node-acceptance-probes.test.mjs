#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProbes, parseIsolatedEmbedResult, syntheticTranscript } from '../lib/node-acceptance-probes.mjs';
import { runAcceptance, resolveNodeConfig, VERDICT } from '../lib/node-acceptance.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { parseJsonlFile } from '../lib/transcript-parser.mjs';
import { MIN_SESSION_BYTES } from '../lib/transcript-discovery.mjs';

// A fully-mocked runtime context — no live system is touched.
function baseCtx(over = {}) {
  const config = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc-test-home/.openclaw', OPENCLAW_NODE_ID: 'testnode' });
  config.isolatedMemoryAcceptance = true;
  config.injectPort = 17893;
  config.natsUrl = 'nats://127.0.0.1:14222';
  config.natsToken = 'FIXTURETOKEN';
  config.natsMonitorUrl = 'http://127.0.0.1:18222';
  config.workspaceEnv = config.workspace;
  config.modelCacheEnv = path.join(config.home, 'model-cache');
  const teardown = [];
  const ctx = {
    config, runId: 'testrun', options: { mutate: true, deep: true }, teardown, path,
    fsp: {
      stat: async (p) => {
        if (p.endsWith('mc-session-token') || p.endsWith('.obsidian-api-key')) throw new Error('ENOENT');
        return { size: 100, mode: 0o100600, dev: 1, ino: [...p].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0) | 0, 0) };
      },
      access: async () => {},
      realpath: async (p) => p,
      readFile: async (p) => {
        if (p === config.injectToken) return 'TESTTOKEN';
        if (p === config.transcriptSources) return JSON.stringify(['/tmp/acc-test-home/.openclaw/transcripts']);
        if (p === config.fixtureMarker) return JSON.stringify({ type: 'node-readiness-memory-fixture-v1', natsServerName: 'acc-test-bus' });
        if (p === config.fixtureEnv) return `OPENCLAW_NATS=${config.natsUrl}\nOPENCLAW_NATS_TOKEN=${config.natsToken}\n`;
        if (p === config.daemonConfig) return JSON.stringify({ workspace: config.workspace });
        if (p === config.vaultSyncConfig) return JSON.stringify({ enabled: false });
        return '';
      },
      writeFile: async () => {},
      unlink: async () => {},
    },
    runtimeHome: () => '/tmp/acc-test-home',
    accountHome: () => os.homedir(),
    httpGet: async (url) => ({ status: 200, ok: true, json: url.endsWith('/varz')
      ? { server_id: 'fixture-id', server_name: 'acc-test-bus' }
      : url.endsWith('/runtime/paths') ? {
        pid: 42,
        home: '/tmp/acc-test-home',
        workspace: config.workspace,
        configuredWorkspace: config.workspace,
        script: path.join(config.workspace, 'bin', 'memory-daemon.mjs'),
        extractionDb: config.stateDb,
        knowledgeDb: config.knowledgeDb,
        extractionStoreDb: config.stateDb,
        federationExtractionDb: config.stateDb,
        federationKnowledgeDb: config.knowledgeDb,
        graphCacheDb: config.graphCacheDb,
        vault: path.join(config.home, 'obsidian-local'),
        modelCache: config.modelCacheEnv,
        transcriptRegistry: config.transcriptSources,
        natsServerId: 'fixture-id',
        singletonSocket: path.join(config.home, 'memory-daemon.sock'),
        isolatedMemory: true,
      }
        : url.endsWith('/connz') ? { server_id: 'fixture-id', connections: [{ name: 'memory-daemon' }] }
        : url.endsWith('/routez') ? { server_id: 'fixture-id', routes: [] }
          : url.endsWith('/leafz') ? { server_id: 'fixture-id', leafnodes: 0 }
            : url.endsWith('/gatewayz') ? { server_id: 'fixture-id', inbound_gateways: {}, outbound_gateways: {} } : {} }),
    httpPost: async () => ({ status: 200, json: {} }),
    queryDb: () => 0,
    writeDb: () => {},
    embed: async () => new Float32Array(1024).fill(0.1),
    runExtraction: async () => ({ entities: [{ name: 'ACCPROBETESTRUN' }], decisions: [{ decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'It is embedded and portable' }], themes: [] }),
    runGeneration: async () => ({ content: 'OK', usage: { completion_tokens: 1 } }),
    natsConnect: async () => mockNc(),
    importSession: async () => ({ sessionId: 'acc-probe-testrun', messageCount: 4, imported: true }),
    publishTrigger: async () => {},
    exec: async () => ({ code: 0, stdout: 'hyperagent help', stderr: '' }),
  };
  return Object.assign(ctx, over);
}

function mockNc() {
  const queue = [];
  let wake = null;
  return {
    info: { server_id: 'fixture-id', server_name: 'acc-test-bus' },
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
const decisionBlock = (decision) => `[memory: recent relevant context]\nRecent decisions:\n- 2026-09-30: ${decision} (0.8)\n[end memory]`;
const roundtripQuery = (candidates, { importedCount = 4, indexedTurns = 4 } = {}) => (_dbPath, fn) => fn({
  prepare(sql) {
    if (sql.includes('FROM sessions')) return { get: () => ({ message_count: importedCount }) };
    if (sql.includes('FROM session_documents')) return { get: () => ({ turn_count: indexedTurns }) };
    if (sql.includes('FROM decisions')) return { all: () => candidates };
    if (sql.includes('FROM messages')) return { get: () => ({ n: 4 }) };
    throw new Error(`unexpected query: ${sql}`);
  },
});

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
  it('L0-HYPERAGENT PASS when workspace CLI and store import', async () => {
    const r = await probeById(baseCtx(), 'L0-HYPERAGENT').run();
    assert.equal(r.status, VERDICT.PASS);
  });
  it('L0-HYPERAGENT FAIL when the CLI import fails', async () => {
    const ctx = baseCtx({ exec: async () => ({ code: 1, stdout: '', stderr: 'ERR_MODULE_NOT_FOUND' }) });
    const r = await probeById(ctx, 'L0-HYPERAGENT').run();
    assert.equal(r.status, VERDICT.FAIL);
  });
});

describe('node-acceptance probes — LLM backing', () => {
  it('isolated embed output requires a clean child exit and valid vector', () => {
    assert.deepEqual(Array.from(parseIsolatedEmbedResult({ stdout: '{"ok":true,"vector":[0.5,0.25]}' })), [0.5, 0.25]);
    assert.throws(
      () => parseIsolatedEmbedResult({ error: Object.assign(new Error('aborted'), { signal: 'SIGABRT' }), stdout: '{"ok":true,"vector":[1]}' }),
      /SIGABRT/,
    );
    assert.throws(
      () => parseIsolatedEmbedResult({ error: Object.assign(new Error('exit 2'), { code: 2 }), stdout: '{"ok":false,"error":"model not cached"}' }),
      /model not cached/,
    );
  });
  it('LLM-L2-MODEL PASS when configured model in tags', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 200, json: { models: [{ name: 'qwen3:8b' }] } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-MODEL').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-MODEL FAIL when configured model absent', async () => {
    const ctx = baseCtx({ httpGet: async () => ({ status: 200, json: { models: [{ name: 'llama3' }] } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-MODEL').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-GEN PASS through the production generation client', async () => {
    const ctx = baseCtx({ runGeneration: async (messages) => {
      assert.equal(messages[0].role, 'user');
      return { content: 'OK', usage: { completion_tokens: 7 } };
    } });
    assert.equal((await probeById(ctx, 'LLM-L2-GEN').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-GEN FAIL on empty/degenerate completion', async () => {
    const ctx = baseCtx({ runGeneration: async () => ({ content: '', usage: { completion_tokens: 0 } }) });
    assert.equal((await probeById(ctx, 'LLM-L2-GEN').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-GEN accepts an unreported token count from OpenAI-compatible backends', async () => {
    const ctx = baseCtx({ runGeneration: async () => ({ content: 'OK', usage: null }) });
    ctx.config.llmNativeApi = false;
    assert.equal((await probeById(ctx, 'LLM-L2-GEN').run()).status, VERDICT.PASS);
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
  it('LLM-L2-EXTRACT PASS when the SQLite decision is tied to the probe project', async () => {
    assert.equal((await probeById(baseCtx(), 'LLM-L2-EXTRACT').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-EXTRACT accepts an explicit rejection of Postgres', async () => {
    const ctx = baseCtx({ runExtraction: async () => ({
      decisions: [{ decision: 'Use SQLite for ACCPROBETESTRUN; do not use Postgres', rationale: 'no separate server' }],
    }) });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.PASS);
  });
  it('LLM-L2-EXTRACT FAIL on empty but schema-valid extraction', async () => {
    const ctx = baseCtx({ runExtraction: async () => ({ entities: [], decisions: [], themes: [] }) });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EXTRACT FAIL when it chooses the distractor database', async () => {
    const ctx = baseCtx({ runExtraction: async () => ({
      entities: [{ name: 'ACCPROBETESTRUN' }],
      decisions: [{ decision: 'Use Postgres', rationale: 'It is reliable' }],
      themes: [],
    }) });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EXTRACT FAIL when the decision is unrelated to the probe project', async () => {
    const ctx = baseCtx({ runExtraction: async () => ({
      entities: [{ name: 'ACCPROBETESTRUN' }],
      decisions: [{ decision: 'Use SQLite', rationale: 'It is embedded' }],
      themes: [],
    }) });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EXTRACT FAIL on invalid extraction', async () => {
    const ctx = baseCtx({ runExtraction: async () => { throw new Error('schema validation failed'); } });
    assert.equal((await probeById(ctx, 'LLM-L2-EXTRACT').run()).status, VERDICT.FAIL);
  });
  it('LLM-L2-EXTRACT uses the production extraction budget by default', () => {
    assert.equal(probeById(baseCtx(), 'LLM-L2-EXTRACT').timeoutMs, 630000);
    const ctx = baseCtx();
    ctx.config.extractBudgetMs = 180000;
    assert.equal(probeById(ctx, 'LLM-L2-EXTRACT').timeoutMs, 210000);
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
  it('synthetic transcript clears discovery size while parsing only the conversation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-transcript-'));
    const file = path.join(dir, 'acc-probe-test-run.jsonl');
    try {
      const transcript = syntheticTranscript('ACCPROBETESTRUN', 'acc-probe-test-run');
      assert.ok(Buffer.byteLength(transcript) >= MIN_SESSION_BYTES);
      assert.ok(transcript.split('\n').filter(Boolean).every((line) => JSON.parse(line).sessionId === 'acc-probe-test-run'));
      fs.writeFileSync(file, transcript);
      const messages = await parseJsonlFile(file, { format: 'claude-code' });
      assert.equal(messages.length, 4);
      assert.match(messages.at(-1).content, /ACCPROBETESTRUN uses SQLite/);
      assert.ok(messages.every((message) => !message.content.includes('/fixture/workspace')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('MEM-L2-INGEST blocks live state writes without an isolated fixture', async () => {
    const ctx = baseCtx();
    ctx.config.isolatedMemoryAcceptance = false;
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('MEM-L4-ROUNDTRIP blocks live mutation without an isolated fixture', async () => {
    const ctx = baseCtx();
    ctx.config.isolatedMemoryAcceptance = false;
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('mutating probes refuse a flag-only fixture whose state points into production', async () => {
    const ctx = baseCtx();
    ctx.fsp.realpath = async (p) => p === ctx.config.stateDb ? path.join(os.homedir(), '.openclaw', 'state.db') : p;
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.BLOCK);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('mutating probes refuse a separate OPENCLAW_HOME when daemon HOME still points to production', async () => {
    const ctx = baseCtx({ runtimeHome: () => os.homedir() });
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.BLOCK);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('mutating probes refuse a daemon whose workspace would be the source checkout', async () => {
    const ctx = baseCtx();
    ctx.config.workspaceEnv = null;
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.BLOCK);
    ctx.config.workspaceEnv = ctx.config.workspace;
    const read = ctx.fsp.readFile;
    ctx.fsp.readFile = async (p) => p === ctx.config.daemonConfig
      ? JSON.stringify({ workspace: '/Users/live/openclaw/workspace' }) : read(p);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('mutating probes refuse a fixture daemon configured for another bus', async () => {
    const ctx = baseCtx();
    const read = ctx.fsp.readFile;
    ctx.fsp.readFile = async (p) => p === ctx.config.fixtureEnv
      ? 'OPENCLAW_NATS=nats://127.0.0.1:4222\nOPENCLAW_NATS_TOKEN=FIXTURETOKEN\n'
      : read(p);
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('gold round-trip refuses a bus whose identity differs from the fixture marker', async () => {
    const ctx = baseCtx({ natsConnect: async () => ({ ...mockNc(), info: { server_name: 'live-bus', server_id: 'live-id' } }) });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('gold round-trip refuses a leaf-connected fixture bus', async () => {
    const ctx = baseCtx();
    const get = ctx.httpGet;
    ctx.httpGet = async (url) => url.endsWith('/leafz')
      ? { status: 200, ok: true, json: { server_id: 'fixture-id', leafnodes: 1 } } : get(url);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
  });
  it('gold round-trip refuses a second fixture daemon and non-fixture DB path', async () => {
    const ctx = baseCtx();
    const get = ctx.httpGet;
    ctx.httpGet = async (url, opts) => {
      const response = await get(url, opts);
      return url.endsWith('/connz')
        ? { ...response, json: { ...response.json, connections: [{ name: 'memory-daemon' }, { name: 'memory-daemon' }] } }
        : response;
    };
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    ctx.httpGet = async (url, opts) => {
      const response = await get(url, opts);
      return url.endsWith('/runtime/paths')
        ? { ...response, json: { ...response.json, federationExtractionDb: path.join(os.homedir(), '.openclaw', 'state.db') } }
        : response;
    };
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
  });
  it('gold round-trip can inspect a fixture on a fresh account with no live install', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]),
      httpPost: async () => ({ status: 200, json: { block: decisionBlock('Use SQLite for ACCPROBETESTRUN'), items: { decisions: 1 } } }) });
    const realpath = ctx.fsp.realpath;
    ctx.fsp.realpath = async (p) => p === path.join(ctx.accountHome(), '.openclaw')
      ? Promise.reject(new Error('ENOENT')) : realpath(p);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.PASS);
  });
  it('gold round-trip refuses enabled Obsidian sync or a Mission Control token', async () => {
    const ctx = baseCtx();
    const read = ctx.fsp.readFile;
    ctx.fsp.readFile = async (p) => p === ctx.config.vaultSyncConfig
      ? JSON.stringify({ enabled: true }) : read(p);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    ctx.fsp.readFile = read;
    const stat = ctx.fsp.stat;
    ctx.fsp.stat = async (p) => p.endsWith('mc-session-token') ? { size: 64 } : stat(p);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
  });
  it('gold round-trip refuses a daemon that writes its MEMORY.md into live workspace', async () => {
    const ctx = baseCtx();
    const get = ctx.httpGet;
    ctx.httpGet = async (url, opts) => {
      const response = await get(url, opts);
      return url.endsWith('/runtime/paths')
        ? { ...response, json: { ...response.json, workspace: path.join(os.homedir(), '.openclaw', 'workspace') } }
        : response;
    };
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('gold round-trip refuses transcript sources also watched by the live daemon', async () => {
    const ctx = baseCtx();
    const read = ctx.fsp.readFile;
    ctx.fsp.readFile = async (p) => p === path.join(os.homedir(), '.openclaw', 'config', 'transcript-sources.json')
      ? JSON.stringify({ sources: [{ path: '/tmp/acc-test-home/.openclaw/transcripts' }] })
      : read(p);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
    assert.equal(ctx.teardown.length, 0);
  });
  it('gold round-trip skips disabled transcript sources', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]),
      httpPost: async () => ({ status: 200, json: { block: decisionBlock('Use SQLite for ACCPROBETESTRUN'), items: { decisions: 1 } } }) });
    const read = ctx.fsp.readFile;
    const written = [];
    ctx.fsp.readFile = async (p) => p === ctx.config.transcriptSources
      ? JSON.stringify({ sources: [
        { path: '/tmp/acc-test-home/.openclaw/disabled', enabled: false },
        { path: '/tmp/acc-test-home/.openclaw/transcripts', enabled: true },
      ] }) : read(p);
    ctx.fsp.writeFile = async (p) => { written.push(p); };
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.PASS);
    assert.ok(written.some((p) => p.includes('/transcripts/')));
    assert.ok(written.every((p) => !p.includes('/disabled/')));
  });
  it('MEM-L2-INGEST PASS when messages land + registers teardown', async () => {
    const ctx = baseCtx({ queryDb: () => 4 });
    const r = await probeById(ctx, 'MEM-L2-INGEST').run();
    assert.equal(r.status, VERDICT.PASS);
    assert.ok(ctx.teardown.length >= 1, 'should register cleanup');
  });
  it('direct ingest and daemon round-trip use distinct sessions and nonce content', async () => {
    const written = [];
    const ctx = baseCtx({
      fsp: { ...baseCtx().fsp, writeFile: async (file, data) => { written.push({ file, first: JSON.parse(data.split('\n')[0]) }); } },
      importSession: async (_file, options) => ({ sessionId: options.sessionId, messageCount: 4, imported: true }),
      queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded and portable' }]),
      httpPost: async () => ({ status: 200, json: { block: decisionBlock('Use SQLite for ACCPROBETESTRUN'), items: { decisions: 1 } } }),
    });
    assert.equal((await probeById(ctx, 'MEM-L2-INGEST').run()).status, VERDICT.PASS);
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.PASS);
    assert.deepEqual(written.map(({ first }) => first.sessionId), ['acc-ingest-testrun', 'acc-probe-testrun']);
    assert.ok(written[0].first.message.content.includes('ACCINGESTTESTRUN'));
    assert.ok(written[1].first.message.content.includes('ACCPROBETESTRUN'));
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
  it('MEM-L4-ROUNDTRIP PASS when the nonce decision is persisted and retrieved', async () => {
    const ctx = baseCtx({
      queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded and portable' }]),
      httpPost: async () => ({ status: 200, json: { block: decisionBlock('Use SQLite for ACCPROBETESTRUN'), items: { decisions: 1 } } }),
    });
    const r = await probeById(ctx, 'MEM-L4-ROUNDTRIP').run();
    assert.equal(r.status, VERDICT.PASS);
  });
  it('MEM-L4-ROUNDTRIP uses the same rationale rule as LLM-L2-EXTRACT', async () => {
    const ctx = baseCtx({
      queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'no separate server' }]),
      httpPost: async () => ({ status: 200, json: { block: decisionBlock('Use SQLite for ACCPROBETESTRUN'), items: { decisions: 1 } } }),
    });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.PASS);
  });
  it('MEM-L4-ROUNDTRIP BLOCK when no transcript source dir', async () => {
    const ctx = baseCtx({ fsp: { ...baseCtx().fsp, readFile: async () => '[]' } });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.BLOCK);
  });
  it('MEM-L4-ROUNDTRIP FAIL when extraction never lands', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([]), httpPost: async () => ({ status: 200, json: { block: '' } }) });
    ctx.config.roundtripPollMs = 50; // don't wait the full budget in tests
    const r = await probeById(ctx, 'MEM-L4-ROUNDTRIP').run();
    assert.equal(r.status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP refuses a decision without the daemon import and index', async () => {
    const decision = [{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }];
    for (const progress of [{ importedCount: 0 }, { indexedTurns: 0 }]) {
      let queriedInject = false;
      const ctx = baseCtx({
        queryDb: roundtripQuery(decision, progress),
        httpPost: async () => { queriedInject = true; return { status: 200, json: {} }; },
      });
      ctx.config.roundtripPollMs = 10;
      assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
      assert.equal(queriedInject, false);
    }
  });
  it('MEM-L4-ROUNDTRIP FAIL when only an entity lands without a decision', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([]), httpPost: async () => ({ status: 200, json: { block: 'ACCPROBETESTRUN uses SQLite' } }) });
    ctx.config.roundtripPollMs = 10;
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP FAIL when the decision is stored but injection omits SQLite', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]), httpPost: async () => ({ status: 200, json: { block: 'ACCPROBETESTRUN codename', items: { decisions: 1 } } }) });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP FAIL when a snippet answers but the decision channel is empty', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]), httpPost: async () => ({ status: 200, json: { block: 'Use SQLite for ACCPROBETESTRUN', items: { decisions: 0, snippets: 1 } } }) });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP FAIL when a snippet repeats the stored decision but another decision fills the count', async () => {
    const ctx = baseCtx({
      queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]),
      httpPost: async () => ({ status: 200, json: { block: `[memory: recent relevant context]\nRecent decisions:\n- 2026-09-30: Use Postgres for another project (0.8)\nRelated sessions:\n[acc-probe-testrun]: Use SQLite for ACCPROBETESTRUN\n[end memory]`, items: { decisions: 1, snippets: 1 } } }),
    });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
  });
  it('MEM-L4-ROUNDTRIP FAIL when the decision channel returns a different real SQLite decision', async () => {
    const ctx = baseCtx({ queryDb: roundtripQuery([{ id: 7, decision: 'Use SQLite for ACCPROBETESTRUN', rationale: 'embedded' }]), httpPost: async () => ({ status: 200, json: { block: 'Use SQLite for another project', items: { decisions: 1 } } }) });
    assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.FAIL);
  });
  it('teardown restores a real decision superseded by the synthetic extraction', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-cleanup-'));
    const store = createExtractionStore({ dbPath: path.join(dir, 'state.db') });
    const nonce = 'ACCPROBETESTRUN';
    const sessionId = 'acc-probe-testrun';
    const empty = { themes: [], actions: [], friction_signals: [], relationships: [] };
    try {
      store.db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY); CREATE TABLE messages (session_id TEXT)');
      store.storeExtractionResult('real', { ...empty, entities: [{ name: 'Real Project', type: 'project', salience: 0.5 }], decisions: [{ decision: 'Use Postgres for Real Project', rationale: 'old', confidence: 0.5 }] });
      const oldId = store.db.prepare('SELECT id FROM decisions WHERE session_id = ?').get('real').id;
      const realEntityId = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('Real Project').id;
      store.storeExtractionResult(sessionId, { ...empty,
        entities: [
          { name: nonce, type: 'project', salience: 0.5, ref: realEntityId },
          { name: `Other ${nonce}`, type: 'project', salience: 0.5, aliases: ['other project'] },
        ],
        decisions: [{ decision: `Use SQLite for ${nonce}`, rationale: 'embedded and portable', confidence: 0.5, supersedes: oldId }],
        relationships: [{ source: nonce, target: 'SQLite', type: 'uses' }],
      });
      const syntheticId = store.db.prepare('SELECT id FROM decisions WHERE session_id = ?').get(sessionId).id;
      assert.equal(store.db.prepare('SELECT superseded_by FROM decisions WHERE id = ?').get(oldId).superseded_by, syntheticId);
      const ctx = baseCtx({
        queryDb: (_db, fn) => fn({
          prepare(sql) {
            if (sql.includes('FROM sessions')) return { get: () => ({ message_count: 4 }) };
            if (sql.includes('FROM session_documents')) return { get: () => ({ turn_count: 4 }) };
            return store.db.prepare(sql);
          },
        }),
        writeDb: (_db, fn) => fn(store.db),
        httpPost: async () => ({ status: 200, json: { block: decisionBlock(`Use SQLite for ${nonce}`), items: { decisions: 1 } } }),
      });
      assert.equal((await probeById(ctx, 'MEM-L4-ROUNDTRIP').run()).status, VERDICT.PASS);
      await ctx.teardown[1]();
      assert.equal(store.db.prepare('SELECT superseded_by FROM decisions WHERE id = ?').get(oldId).superseded_by, null);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM decisions WHERE session_id = ?').get(sessionId).n, 0);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM entity_aliases WHERE alias = ?').get(nonce).n, 0);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM entity_aliases WHERE alias = ?').get('other project').n, 0);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM concept_edges WHERE session_id = ?').get(sessionId).n, 0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
  it('rejects acceptance when synthetic cleanup fails', async () => {
    const ctx = baseCtx();
    const probes = [{ id: 'M', layer: 'L4', axis: 'memory', required: true, run: async () => {
      ctx.teardown.push(() => { throw new Error('database locked'); });
      return { status: VERDICT.PASS, detail: 'extracted' };
    } }];
    const report = await runAcceptance({ profile: 'single-node', healthCheckFn: async () => ({}), ctx, probes, axis: 'memory' });
    assert.equal(report.results.find((r) => r.id === 'MEM-L4-CLEANUP').status, VERDICT.FAIL);
    assert.equal(report.gate.state, 'REJECTED');
  });
  it('--no-mutate turns mutating probes into SKIP', async () => {
    const allHealthy = { daemon: { ok: true, detail: '' }, nats: { ok: true, detail: '' }, ollama: { ok: true, detail: '' }, embedder: { ok: true, detail: '' }, sqlite: { ok: true, detail: '' }, workspace_writable: { ok: true, detail: '' } };
    const probes = [{ id: 'M', layer: 'L2', axis: 'memory', required: true, mutate: true, run: async () => ({ status: VERDICT.PASS, detail: 'ran' }) }];
    const rep = await runAcceptance({ profile: 'single-node', healthCheckFn: async () => allHealthy, ctx: baseCtx(), probes, mutate: false });
    const m = rep.results.find((x) => x.id === 'M');
    assert.equal(m.status, VERDICT.SKIP);
  });
});

// ─── P5-4: the inject probe is not green on empty ────────────────────────────
describe('P5-4: MEM-L2-INJECT fails on an empty answer instead of passing', () => {
  const answer = (items) => async () => ({ status: 200, json: { block: '', items, tokens: 0, elapsed_ms: 1 } });

  it('PASSes when retrieval returns items', async () => {
    const ctx = baseCtx({ httpPost: answer({ concepts: 2, decisions: 0, snippets: 1 }) });
    const r = await probeById(ctx, 'MEM-L2-INJECT').run();
    assert.equal(r.status, VERDICT.PASS);
  });

  it('FAILs when the store holds entities but retrieval returns nothing (retrieval dead)', async () => {
    const ctx = baseCtx({ httpPost: answer({ concepts: 0, decisions: 0, snippets: 0 }), queryDb: () => 42 });
    const r = await probeById(ctx, 'MEM-L2-INJECT').run();
    assert.equal(r.status, VERDICT.FAIL);
    assert.match(r.detail, /42 entities/);
  });

  it('SKIPs (never PASSes) when the store is genuinely empty', async () => {
    const ctx = baseCtx({ httpPost: answer({ concepts: 0, decisions: 0, snippets: 0 }), queryDb: () => 0 });
    const r = await probeById(ctx, 'MEM-L2-INJECT').run();
    assert.equal(r.status, VERDICT.SKIP);
    assert.notEqual(r.status, VERDICT.PASS);
  });
});

// Virgin-Mac run of 2026-09-07: the daemon died at startup because the
// event-schemas dist was never built, and the gate reported five downstream
// symptoms (no DBs, no token, no stream) without naming the cause. L0-DEPLOY
// now checks the dist itself so the first FAIL row says what to fix.
describe('L0-DEPLOY event-schemas dist', () => {
  it('passes with the dist present and names the dist when it is missing', async () => {
    const ctx = baseCtx();
    assert.match(ctx.config.eventSchemasDist, /packages\/event-schemas\/dist\/index\.js$/);
    assert.equal((await probeById(ctx, 'L0-DEPLOY').run()).status, VERDICT.PASS);
    const broken = baseCtx();
    broken.fsp = { ...broken.fsp, access: async (p) => { if (p === ctx.config.eventSchemasDist) throw new Error('ENOENT'); } };
    const r = await probeById(broken, 'L0-DEPLOY').run();
    assert.equal(r.status, VERDICT.FAIL);
    assert.match(r.detail, /event-schemas dist/);
  });
});

// Virgin-Mac run 2: every daemon row PASSed and the gate still REJECTED on
// MEM-L2-INJECT — the inject path embeds the prompt with the 2 GB model that
// --skip-llm deliberately does not download. The probe must declare the LLM
// need so a model-less install is INCOMPLETE (unproven), not REJECTED.
describe('MEM-L2-INJECT axis', () => {
  it('declares needs llm, like MEM-L4-ROUNDTRIP', () => {
    const inject = probeById(baseCtx(), 'MEM-L2-INJECT');
    const roundtrip = probeById(baseCtx(), 'MEM-L4-ROUNDTRIP');
    assert.deepEqual(inject.needs, ['llm']);
    assert.deepEqual(roundtrip.needs, ['llm']);
    assert.equal(inject.axis, 'memory', 'still a memory-axis probe when the model is present');
  });
});
