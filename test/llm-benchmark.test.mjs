import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLlmClient, DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT } from '../lib/llm-client.mjs';

// --- Mock HTTP server for unit tests ---

function createMockServer() {
  let lastRequest = null;

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;

    lastRequest = { method: req.method, url: req.url, body };

    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'test-model', object: 'model', owned_by: 'local' }],
      }));
      return;
    }

    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      const content = body?.response_format?.type === 'json_object'
        ? '{"entities": [], "themes": []}'
        : 'Hello from mock LLM';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-completion-1',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return {
    server,
    getLastRequest: () => lastRequest,
    listen: () => new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// --- Tests ---

describe('llm-client module exports', () => {
  it('createLlmClient returns object with generate and healthCheck methods', () => {
    const client = createLlmClient({ baseUrl: 'http://localhost:9999' });
    assert.equal(typeof client.generate, 'function');
    assert.equal(typeof client.healthCheck, 'function');
  });
});

describe('llm-client with mock server', () => {
  let mock, baseUrl, client, prevNativeFlag;

  // Force OpenAI-compat mode for this suite — the mock implements /v1/chat/completions
  // and /v1/models (OpenAI shape). The client's default switched to Ollama native
  // /api/chat after we added the queue + Qwen3 thinking-mode bypass. Set the env
  // var to keep this test exercising the OpenAI-compat path the mock provides.
  before(() => { prevNativeFlag = process.env.LLM_NATIVE_API; process.env.LLM_NATIVE_API = 'false'; });
  after(()  => { if (prevNativeFlag === undefined) delete process.env.LLM_NATIVE_API; else process.env.LLM_NATIVE_API = prevNativeFlag; });

  before(async () => {
    mock = createMockServer();
    baseUrl = await mock.listen();
    client = createLlmClient({ baseUrl, model: 'test-model' });
  });

  after(async () => {
    await mock.close();
  });

  it('generate sends correct request format', async () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = await client.generate(messages);

    const req = mock.getLastRequest();
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.body.model, 'test-model');
    assert.deepEqual(req.body.messages, messages);
    assert.equal(typeof req.body.max_tokens, 'number');
    assert.equal(typeof req.body.temperature, 'number');

    assert.equal(result.content, 'Hello from mock LLM');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('healthCheck parses model list response', async () => {
    const health = await client.healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.model, 'test-model');
    assert.deepEqual(health.models, ['test-model']);
    assert.equal(health.error, null);
  });

  it('JSON mode sets response_format in request body', async () => {
    const messages = [{ role: 'user', content: 'Extract entities as JSON' }];
    const result = await client.generate(messages, { jsonMode: true });

    const req = mock.getLastRequest();
    assert.deepEqual(req.body.response_format, { type: 'json_object' });

    // Mock returns JSON content when jsonMode is detected
    const parsed = JSON.parse(result.content);
    assert.ok(Array.isArray(parsed.entities));
    assert.ok(Array.isArray(parsed.themes));
  });
});
