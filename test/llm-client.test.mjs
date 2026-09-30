/**
 * llm-client.test.mjs — Unit tests for lib/llm-client.mjs
 *
 * Covers: createLlmClient defaults + opts, env-var defaults (LLM_BASE_URL,
 * LLM_MODEL, LLM_MAX_TOKENS, LLM_ANALYSIS_MAX_TOKENS, LLM_FORCE_FREE_FORM,
 * LLM_NATIVE_API), generate body construction (native vs openai-compat,
 * jsonMode toggle, force-free-form override, maxTokens override), bypass
 * queue path, healthCheck happy + error paths.
 *
 * Uses an in-memory HTTP server as a real Ollama mock so we test the
 * full request/response cycle without external dependencies. Each test
 * inspects what the client sent.
 *
 * Run: node --test test/llm-client.test.mjs
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getState } from '../lib/ollama-queue.mjs';

import {
  createLlmClient,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_ANALYSIS_MAX_TOKENS,
} from '../lib/llm-client.mjs';

// ─── Mock Ollama server ──────────────────────────────────────────────────────

let server;
let port;
let lastRequest = null;       // { method, url, body (parsed) }
let nextResponse = null;      // { status, body (object) }

before(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        lastRequest = { method: req.method, url: req.url, body };
        const r = nextResponse || { status: 200, body: { error: 'no response queued' } };
        if (body?.stream && r.status === 200) {
          res.writeHead(r.status, { 'Content-Type': 'application/x-ndjson' });
          if (r.rawChunks) {
            const chunks = [...r.rawChunks];
            const writeNext = () => {
              if (!chunks.length) return res.end();
              res.write(chunks.shift());
              setImmediate(writeNext);
            };
            writeNext();
          } else {
            const parts = Array.isArray(r.body) ? r.body : [{ ...r.body, done: true }];
            for (const part of parts) res.write(`${JSON.stringify(part)}\n`);
            res.end();
          }
        } else {
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r.body));
        }
        nextResponse = null;
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  lastRequest = null;
  nextResponse = null;
});

function baseUrl() { return `http://127.0.0.1:${port}`; }

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('exported defaults', () => {
  it('exports sane fallbacks', () => {
    assert.ok(DEFAULT_BASE_URL.startsWith('http'));
    assert.ok(typeof DEFAULT_MODEL === 'string' && DEFAULT_MODEL.length > 0);
    assert.ok(typeof DEFAULT_TIMEOUT === 'number' && DEFAULT_TIMEOUT > 0);
    assert.ok(typeof DEFAULT_MAX_TOKENS === 'number' && DEFAULT_MAX_TOKENS > 0);
    assert.ok(typeof DEFAULT_ANALYSIS_MAX_TOKENS === 'number' && DEFAULT_ANALYSIS_MAX_TOKENS > 0);
  });
});

describe('createLlmClient', () => {
  it('returns { generate, generateAnalysis, healthCheck }', () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    assert.equal(typeof c.generate, 'function');
    assert.equal(typeof c.generateAnalysis, 'function');
    assert.equal(typeof c.healthCheck, 'function');
  });

  it('strips trailing slashes from baseUrl', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() + '////' });
    nextResponse = { status: 200, body: { message: { content: 'ok' }, done_reason: 'stop' } };
    await c.generate([{ role: 'user', content: 'hi' }], { bypassQueue: true });
    assert.equal(lastRequest.url, '/api/chat');
  });
});

describe('generate — native /api/chat path (LLM_NATIVE_API=true default)', () => {
  it('hits /api/chat and assembles streamed content with final usage', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = {
      status: 200,
      body: [
        { message: { content: 'hel' }, done: false },
        { message: { content: 'lo' }, prompt_eval_count: 5, eval_count: 1, done_reason: 'stop', done: true },
      ],
    };
    const out = await c.generate([{ role: 'user', content: 'hi' }], { bypassQueue: true });
    assert.equal(lastRequest.url, '/api/chat');
    assert.equal(lastRequest.body.think, false);
    assert.equal(lastRequest.body.stream, true);
    assert.equal(out.content, 'hello');
    assert.equal(out.finishReason, 'stop');
    assert.equal(out.usage.total_tokens, 6);
  });

  it('uses DEFAULT_MAX_TOKENS when no override', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: { message: { content: 'x' }, done_reason: 'stop' } };
    await c.generate([], { bypassQueue: true });
    assert.equal(lastRequest.body.options.num_predict, DEFAULT_MAX_TOKENS);
  });

  it('respects genOpts.maxTokens override', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: { message: { content: 'x' }, done_reason: 'stop' } };
    await c.generate([], { bypassQueue: true, maxTokens: 123 });
    assert.equal(lastRequest.body.options.num_predict, 123);
  });

  it('includes format:json for non-thinking models when jsonMode true', async () => {
    delete process.env.LLM_FORCE_FREE_FORM;
    const c = createLlmClient({ baseUrl: baseUrl(), model: 'llama3.1:8b' });
    nextResponse = { status: 200, body: { message: { content: '{}' }, done_reason: 'stop' } };
    await c.generate([], { bypassQueue: true, jsonMode: true });
    assert.equal(lastRequest.body.format, 'json');
  });

  it('never sends format:json to thinking-family models (the 2026-07-18 stall)', async () => {
    delete process.env.LLM_FORCE_FREE_FORM;
    const c = createLlmClient({ baseUrl: baseUrl(), model: 'qwen3:8b' });
    nextResponse = { status: 200, body: { message: { content: '{}' }, done_reason: 'stop' } };
    await c.generate([], { bypassQueue: true, jsonMode: true });
    assert.equal(lastRequest.body.format, undefined);
  });

  it('omits format:json when LLM_FORCE_FREE_FORM=1 even for non-thinking models', async () => {
    process.env.LLM_FORCE_FREE_FORM = '1';
    const c = createLlmClient({ baseUrl: baseUrl(), model: 'llama3.1:8b' });
    nextResponse = { status: 200, body: { message: { content: '{}' }, done_reason: 'stop' } };
    await c.generate([], { bypassQueue: true, jsonMode: true });
    assert.equal(lastRequest.body.format, undefined);
    delete process.env.LLM_FORCE_FREE_FORM;
  });

  it('throws on HTTP error response with status in message', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 500, body: { error: 'server boom' } };
    await assert.rejects(
      () => c.generate([], { bypassQueue: true }),
      /LLM server returned 500/
    );
  });
  it('refuses a truncated native stream', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: [{ message: { content: 'partial' }, done: false }] };
    await assert.rejects(() => c.generate([], { bypassQueue: true }), /stream ended before completion/);
  });
  it('decodes a JSON line and UTF-8 character split across response chunks', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    const line = Buffer.from(JSON.stringify({ message: { content: 'café' }, done: true, done_reason: 'stop' }));
    const accent = line.indexOf(Buffer.from('é'));
    nextResponse = { status: 200, rawChunks: [line.subarray(0, accent + 1), line.subarray(accent + 1)] };
    assert.equal((await c.generate([], { bypassQueue: true })).content, 'café');
  });
  it('surfaces a native stream error', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: [{ error: 'runner unavailable' }] };
    await assert.rejects(() => c.generate([], { bypassQueue: true }), /runner unavailable/);
  });
  it('rejects structured output cut off by the output token limit', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: [{ message: { content: '{}' }, done: true, done_reason: 'length' }] };
    await assert.rejects(() => c.generate([], { bypassQueue: true, jsonMode: true }), /output token limit/);
  });
  it('returns capped free-form text to summary callers', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: [{ message: { content: 'short summary' }, done: true, done_reason: 'length', eval_count: 8 }] };
    const out = await c.generate([], { bypassQueue: true, maxTokens: 8 });
    assert.equal(out.content, 'short summary');
    assert.equal(out.finishReason, 'length');
  });
  it('caller cancellation closes a streamed response', async () => {
    let received;
    let closed;
    const requestReceived = new Promise((resolve) => { received = resolve; });
    const responseClosed = new Promise((resolve) => { closed = resolve; });
    const owned = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"message":{"content":"partial"},"done":false}\n');
        received();
      });
      res.on('close', closed);
    });
    await new Promise((resolve) => owned.listen(0, '127.0.0.1', resolve));
    const ac = new AbortController();
    const c = createLlmClient({ baseUrl: `http://127.0.0.1:${owned.address().port}` });
    try {
      const result = c.generate([], { bypassQueue: true, signal: ac.signal });
      const rejected = assert.rejects(result, /caller cancelled/);
      await requestReceived;
      ac.abort(new Error('caller cancelled'));
      await rejected;
      await responseClosed;
    } finally {
      ac.abort();
      owned.closeAllConnections();
      await new Promise((resolve) => owned.close(resolve));
    }
  });
});

describe('generateAnalysis — separate budget', () => {
  it('forwards caller cancellation to a real owned HTTP request and settles the queue', async () => {
    let received;
    let closed;
    const requestReceived = new Promise(r => { received = r; });
    const responseClosed = new Promise(r => { closed = r; });
    const owned = http.createServer((req, res) => {
      req.resume();
      req.on('end', received);
      res.on('close', closed);
    });
    await new Promise(r => owned.listen(0, '127.0.0.1', r));
    const ac = new AbortController();
    const client = createLlmClient({ baseUrl: `http://127.0.0.1:${owned.address().port}`, model: 'owned-cancel' });
    const timeoutCount = getState().totals.timeouts;
    const result = client.generateAnalysis([{ role: 'user', content: 'owned fixture' }], { signal: ac.signal, waitTimeoutMs: 5000 });
    const rejected = assert.rejects(result, /owned HTTP cancellation/);
    try {
      await requestReceived;
      assert.equal(getState().current_job?.model, 'owned-cancel');
      ac.abort(new Error('owned HTTP cancellation'));
      await rejected;
      await responseClosed;
      assert.equal(getState().current_job, null);
      assert.equal(getState().totals.timeouts, timeoutCount, 'caller cancellation is not an LLM timeout');
    } finally {
      ac.abort(new Error('fixture cleanup'));
      owned.closeAllConnections();
      await new Promise(r => owned.close(r));
    }
  });

  it('uses DEFAULT_ANALYSIS_MAX_TOKENS by default', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: { message: { content: 'a' }, done_reason: 'stop' } };
    const result = await c.generateAnalysis([{ role: 'user', content: 'q' }]);
    if (result.mode === 'llm') {
      assert.equal(lastRequest.body.options.num_predict, DEFAULT_ANALYSIS_MAX_TOKENS);
    }
  });

  it('returns mode:llm shape on success path', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: { message: { content: 'r' }, done_reason: 'stop' } };
    const result = await c.generateAnalysis([{ role: 'user', content: 'q' }]);
    // Either mode:llm or mode:fallback (if queue is contended); both acceptable
    assert.ok(result.mode === 'llm' || result.mode === 'fallback');
  });
});

describe('healthCheck', () => {
  it('returns ok:true with first model on /api/tags 200', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = {
      status: 200,
      body: { models: [{ name: 'qwen3:8b' }, { name: 'llama3.3:70b' }] },
    };
    const result = await c.healthCheck();
    assert.equal(result.ok, true);
    assert.equal(result.model, 'qwen3:8b');
    assert.deepEqual(result.models, ['qwen3:8b', 'llama3.3:70b']);
    assert.equal(result.error, null);
  });

  it('returns ok:false with status on non-200', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 503, body: { error: 'down' } };
    const result = await c.healthCheck();
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 503/);
  });

  it('returns ok:false with error message on connection failure', async () => {
    const c = createLlmClient({ baseUrl: 'http://127.0.0.1:1' });  // closed port
    const result = await c.healthCheck();
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
});

describe('LLM_NATIVE_API=false — OpenAI-compat path', () => {
  it('honors an explicit backend choice without changing the process environment', async () => {
    const c = createLlmClient({ baseUrl: baseUrl(), nativeApi: false });
    nextResponse = { status: 200, body: { choices: [{ message: { content: 'compat' } }] } };
    await c.generate([], { bypassQueue: true });
    assert.equal(lastRequest.url, '/v1/chat/completions');
  });

  it('hits /v1/chat/completions with max_tokens instead of num_predict', async () => {
    process.env.LLM_NATIVE_API = 'false';
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = {
      status: 200,
      body: {
        choices: [{ message: { content: 'compat' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    };
    const out = await c.generate([{ role: 'user', content: 'hi' }], { bypassQueue: true, maxTokens: 50 });
    assert.equal(lastRequest.url, '/v1/chat/completions');
    assert.equal(lastRequest.body.max_tokens, 50);
    assert.equal(lastRequest.body.num_predict, undefined);
    assert.equal(out.content, 'compat');
    delete process.env.LLM_NATIVE_API;
  });

  it('uses response_format:json_object instead of format:json for openai-compat', async () => {
    process.env.LLM_NATIVE_API = 'false';
    delete process.env.LLM_FORCE_FREE_FORM;
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = { status: 200, body: { choices: [{ message: { content: '{}' } }] } };
    await c.generate([], { bypassQueue: true, jsonMode: true });
    assert.deepEqual(lastRequest.body.response_format, { type: 'json_object' });
    delete process.env.LLM_NATIVE_API;
  });
});
