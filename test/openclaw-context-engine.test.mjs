/**
 * test/openclaw-context-engine.test.mjs — the OpenClaw context-engine plugin
 * (openviking-adopt Block 4) against a fake loopback inject server that
 * speaks the memory daemon's contract (bearer token, POST /memory/inject,
 * GET /health).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryClient } from '../packages/openclaw-memory-context-engine/memory-client.js';
import {
  createMemoryContextEngine,
  compileSessionPattern,
  isBypassed,
  lastUserPrompt,
  messageText,
  ENGINE_ID,
} from '../packages/openclaw-memory-context-engine/context-engine.js';
import plugin from '../packages/openclaw-memory-context-engine/index.js';

const TOKEN = 'a'.repeat(64);
let server, port, tmp, tokenPath;
const received = [];
let nextBlock = '[memory: recent relevant context]\nActive concepts in this conversation: NATS JetStream (technology)\n[end memory]';
let failNext = null;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ctx-engine-'));
  tokenPath = join(tmp, 'token');
  writeFileSync(tokenPath, TOKEN + '\n');
  server = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' })); }
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); return res.end(JSON.stringify({ ok: true, ts: 1 })); }
    if (req.method === 'POST' && req.url === '/memory/inject') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(JSON.parse(body));
        if (failNext) { const f = failNext; failNext = null; res.writeHead(f); return res.end(JSON.stringify({ error: 'boom' })); }
        res.writeHead(200);
        res.end(JSON.stringify({ block: nextBlock, analysis: { mode: 'full' }, tokens: 40, items: {} }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); rmSync(tmp, { recursive: true, force: true }); });

const logger = () => { const lines = []; return { lines, info: (m) => lines.push(['info', m]), warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) }; };
const mkClient = (extra = {}) => createMemoryClient({ injectUrl: `http://127.0.0.1:${port}`, tokenPath, timeoutMs: 2000, ...extra });
const userMsg = (t) => ({ role: 'user', content: t });

describe('memory-client', () => {
  it('refuses a non-loopback inject URL', () => {
    assert.throws(() => createMemoryClient({ injectUrl: 'http://10.0.0.5:7893', tokenPath }), /loopback/);
  });
  it('sends the bearer token and returns the daemon block', async () => {
    const c = mkClient();
    const r = await c.inject({ prompt: 'hello nats' });
    assert.match(r.block, /\[memory:/);
    assert.deepEqual(await c.health(), { ok: true, ts: 1 });
  });
  it('fails with NO_TOKEN when the token file is missing', async () => {
    const c = mkClient({ tokenPath: join(tmp, 'nope') });
    await assert.rejects(() => c.inject({ prompt: 'x' }), (e) => e.code === 'NO_TOKEN');
  });
  it('surfaces HTTP errors with status', async () => {
    failNext = 500;
    await assert.rejects(() => mkClient().inject({ prompt: 'x' }), (e) => e.status === 500 && /boom/.test(e.message));
  });
});

describe('pure helpers', () => {
  it('session patterns: * within a segment, ** across', () => {
    assert.ok(compileSessionPattern('agent:*:cron:**').test('agent:main:cron:daily:1'));
    assert.ok(!compileSessionPattern('agent:*:cron:**').test('agent:main:sub:cron:daily'));
    assert.ok(isBypassed('agent:x:cron:y', ['nomatch', 'agent:*:cron:**']));
    assert.ok(!isBypassed('agent:x:chat', ['agent:*:cron:**']));
    assert.ok(!isBypassed(undefined, ['**']));
  });
  it('lastUserPrompt prefers the explicit prompt, else the latest non-empty user message', () => {
    assert.equal(lastUserPrompt([userMsg('a'), { role: 'assistant', content: 'b' }], undefined), 'a');
    assert.equal(lastUserPrompt([userMsg('a'), userMsg('')], 'explicit'), 'explicit');
    assert.equal(messageText({ role: 'user', content: [{ type: 'text', text: 'p1' }, { type: 'image' }, 'p2'] }), 'p1\np2');
  });
});

describe('context engine', () => {
  it('declares the OpenClaw ≥2026.8.1 transcript semantics', () => {
    const e = createMemoryContextEngine({ client: mkClient(), logger: logger() });
    assert.equal(e.info.id, ENGINE_ID);
    assert.equal(e.info.ownsCompaction, true);
    assert.equal(e.info.transcriptSemantics.currentTurnFence, 'before-current-turn-entry-v1');
    assert.equal(e.info.transcriptSemantics.turnAdvancementIdempotency, 'atomic-idempotent-v1');
  });

  it('assemble passes messages through and adds the daemon block as the system-prompt addition', async () => {
    const e = createMemoryContextEngine({ client: mkClient(), logger: logger() });
    const messages = [userMsg('what did we decide about jetstream storage?')];
    const before = received.length;
    const out = await e.assemble({ sessionId: 's1', sessionKey: 'agent:main:chat', messages, tokenBudget: 100000 });
    assert.equal(out.messages, messages);
    assert.match(out.systemPromptAddition, /^\[memory: recent relevant context\]/);
    assert.ok(out.estimatedTokens > 0);
    const sent = received[before];
    assert.equal(sent.prompt, 'what did we decide about jetstream storage?');
    assert.equal(sent.session_id, 's1');
    assert.equal(sent.frontend, 'openclaw-context-engine');
  });

  it('degrades to passthrough (one warning) when the daemon errors, times out, or the token is missing', async () => {
    const log = logger();
    const e = createMemoryContextEngine({ client: mkClient(), logger: log });
    failNext = 503;
    let out = await e.assemble({ sessionId: 's', messages: [userMsg('hello there')], tokenBudget: 1000 });
    assert.equal(out.systemPromptAddition, undefined);
    failNext = 503;
    out = await e.assemble({ sessionId: 's', messages: [userMsg('hello there')], tokenBudget: 1000 });
    assert.equal(log.lines.filter(([l]) => l === 'warn').length, 1, 'same failure warned once');

    const noToken = createMemoryContextEngine({ client: mkClient({ tokenPath: join(tmp, 'missing') }), logger: log });
    out = await noToken.assemble({ sessionId: 's', messages: [userMsg('hello there')] });
    assert.equal(out.systemPromptAddition, undefined);
    assert.match(log.lines.at(-1)[1], /token not readable/);

    const slow = createMemoryContextEngine({
      client: createMemoryClient({ injectUrl: `http://127.0.0.1:${port}`, tokenPath, timeoutMs: 300, fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) }),
      logger: log,
    });
    out = await slow.assemble({ sessionId: 's', messages: [userMsg('hello there')] });
    assert.equal(out.systemPromptAddition, undefined);
  });

  it('skips the block when it does not fit the turn budget, and truncates on a line boundary at maxInjectedChars', async () => {
    const log = logger();
    const e = createMemoryContextEngine({ client: mkClient(), logger: log });
    const out = await e.assemble({ sessionId: 's', messages: [userMsg('hello there')], tokenBudget: 5 });
    assert.equal(out.systemPromptAddition, undefined);
    assert.match(log.lines.at(-1)[1], /does not fit/);

    const saved = nextBlock;
    nextBlock = '[memory: recent relevant context]\n' + Array.from({ length: 50 }, (_, i) => `- decision number ${i} about many things`).join('\n') + '\n[end memory]';
    const small = createMemoryContextEngine({ client: mkClient(), config: { maxInjectedChars: 400 }, logger: log });
    const cut = await small.assemble({ sessionId: 's', messages: [userMsg('hello there')], tokenBudget: 100000 });
    nextBlock = saved;
    assert.ok(cut.systemPromptAddition.length <= 400 + '\n[end memory]'.length);
    assert.ok(cut.systemPromptAddition.endsWith('[end memory]'));
    assert.ok(!/\n- decision number \d+ about many th$/.test(cut.systemPromptAddition), 'no half line');
  });

  it('honours autoRecall=false, bypass patterns, and tiny prompts without calling the daemon', async () => {
    const before = received.length;
    const off = createMemoryContextEngine({ client: mkClient(), config: { autoRecall: false }, logger: logger() });
    assert.equal((await off.assemble({ sessionId: 's', messages: [userMsg('hello there')] })).systemPromptAddition, undefined);
    const by = createMemoryContextEngine({ client: mkClient(), config: { bypassSessionPatterns: ['agent:*:cron:**'] }, logger: logger() });
    assert.equal((await by.assemble({ sessionId: 's', sessionKey: 'agent:main:cron:x', messages: [userMsg('hello there')] })).systemPromptAddition, undefined);
    const e = createMemoryContextEngine({ client: mkClient(), logger: logger() });
    assert.equal((await e.assemble({ sessionId: 's', messages: [userMsg('hi')] })).systemPromptAddition, undefined);
    assert.equal(received.length, before, 'no daemon calls');
  });

  it('commitTurn is idempotent per advancementKey; ingest/afterTurn are no-ops', async () => {
    const e = createMemoryContextEngine({ client: mkClient(), logger: logger() });
    assert.deepEqual(await e.commitTurn({ advancementKey: 'k1', messages: [], sessionId: 's' }), { status: 'committed' });
    assert.deepEqual(await e.commitTurn({ advancementKey: 'k1', messages: [], sessionId: 's' }), { status: 'duplicate' });
    assert.deepEqual(await e.commitTurn({ advancementKey: 'k2', messages: [], sessionId: 's' }), { status: 'committed' });
    assert.deepEqual(await e.ingest({ sessionId: 's', message: userMsg('x') }), { ingested: true });
    assert.deepEqual(await e.ingestBatch({ sessionId: 's', messages: [userMsg('x'), userMsg('y')] }), { ingestedCount: 2 });
    assert.equal(await e.afterTurn({ sessionId: 's', sessionFile: '/x', messages: [], prePromptMessageCount: 0 }), undefined);
  });

  it('compact delegates to the host compactor and reports honestly without one', async () => {
    const calls = [];
    const withHost = createMemoryContextEngine({ client: mkClient(), logger: logger(), runtimeCompact: async (p) => { calls.push(p); return { ok: true, compacted: true, result: { tokensBefore: 10, tokensAfter: 5 } }; } });
    const r = await withHost.compact({ sessionId: 's', sessionFile: '/x', tokenBudget: 100 });
    assert.equal(r.compacted, true);
    assert.equal(calls[0].sessionId, 's');
    const without = createMemoryContextEngine({ client: mkClient(), logger: logger() });
    assert.deepEqual(await without.compact({ sessionId: 's', sessionFile: '/x' }), { ok: true, compacted: false, reason: 'no_engine_archive_host_compaction_unavailable' });
    const broken = createMemoryContextEngine({ client: mkClient(), logger: logger(), runtimeCompact: async () => { throw new Error('nope'); } });
    assert.equal((await broken.compact({ sessionId: 's', sessionFile: '/x' })).compacted, false);
  });
});

describe('plugin entry', () => {
  it('registers the context engine and the two tools against a fake host api', async () => {
    const engines = new Map();
    const tools = new Map();
    const log = logger();
    plugin.register({
      pluginConfig: { injectUrl: `http://127.0.0.1:${port}`, tokenPath, timeoutMs: 2000 },
      logger: log,
      registerContextEngine: (id, factory) => engines.set(id, factory),
      registerTool: (tool, opts) => tools.set(opts.name, tool),
      on: () => {},
      registerService: () => {},
    });
    assert.equal(plugin.kind, 'context-engine');
    assert.deepEqual([...engines.keys()], [ENGINE_ID]);
    assert.deepEqual([...tools.keys()].sort(), ['memory_recall', 'memory_status']);
    const engine = engines.get(ENGINE_ID)();
    const out = await engine.assemble({ sessionId: 's', messages: [userMsg('hello there')], tokenBudget: 100000 });
    assert.match(out.systemPromptAddition, /\[memory:/);
    // compact without the host SDK installed → honest not-compacted
    assert.equal((await engine.compact({ sessionId: 's', sessionFile: '/x' })).compacted, false);
    const recall = await tools.get('memory_recall').execute('t1', { query: 'jetstream' });
    assert.match(recall.content[0].text, /\[memory:/);
    const status = await tools.get('memory_status').execute('t2', {});
    assert.equal(JSON.parse(status.content[0].text).ok, true);
  });

  it('refuses to register with a non-loopback URL and says so', () => {
    const log = logger();
    plugin.register({ pluginConfig: { injectUrl: 'http://example.com' }, logger: log, registerContextEngine: () => assert.fail('must not register'), registerTool: () => assert.fail('must not register'), on: () => {} });
    assert.match(log.lines[0][1], /loopback/);
  });
});
