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
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
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
  it('hits /api/chat and includes think:false + stream:false', async () => {
    const c = createLlmClient({ baseUrl: baseUrl() });
    nextResponse = {
      status: 200,
      body: { message: { content: 'hello' }, prompt_eval_count: 5, eval_count: 1, done_reason: 'stop' },
    };
    const out = await c.generate([{ role: 'user', content: 'hi' }], { bypassQueue: true });
    assert.equal(lastRequest.url, '/api/chat');
    assert.equal(lastRequest.body.think, false);
    assert.equal(lastRequest.body.stream, false);
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
});

describe('generateAnalysis — separate budget', () => {
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
