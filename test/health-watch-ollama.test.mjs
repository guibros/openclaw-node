import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeAutoRestartOllama } from '../bin/health-watch.mjs';

function stuckSnapshot(dir, llmBaseUrl) {
  const path = join(dir, 'queue.json');
  writeFileSync(path, JSON.stringify({
    ts: Date.now(),
    llm_base_url: llmBaseUrl,
    consecutive_timeouts: { extraction: 3, analysis: 0 },
    current_job: { model: 'qwen3:8b' },
  }));
  return path;
}

it('does not evict a model on a shared remote Ollama', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-watch-remote-'));
  const previousUrl = process.env.LLM_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    process.env.LLM_BASE_URL = 'http://192.168.64.1:11434';
    globalThis.fetch = () => { requests++; return Promise.resolve({ ok: true }); };
    assert.equal(await maybeAutoRestartOllama(stuckSnapshot(dir, process.env.LLM_BASE_URL)), false);
    assert.equal(requests, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousUrl;
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

it('keeps local Ollama recovery available', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-watch-local-'));
  const previousUrl = process.env.LLM_BASE_URL;
  const previousFetch = globalThis.fetch;
  let request;
  try {
    process.env.LLM_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true };
    };
    assert.equal(await maybeAutoRestartOllama(stuckSnapshot(dir, process.env.LLM_BASE_URL)), true);
    assert.equal(request.url, 'http://127.0.0.1:11434/api/generate');
    assert.deepEqual(JSON.parse(request.options.body), { model: 'qwen3:8b', keep_alive: 0 });
  } finally {
    if (previousUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousUrl;
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

it('uses the local Ollama default when no endpoint is configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-watch-default-'));
  const previousUrl = process.env.LLM_BASE_URL;
  const previousFetch = globalThis.fetch;
  let request;
  try {
    delete process.env.LLM_BASE_URL;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true };
    };
    assert.equal(await maybeAutoRestartOllama(stuckSnapshot(dir, 'http://localhost:11434')), true);
    assert.equal(request.url, 'http://localhost:11434/api/generate');
    assert.deepEqual(JSON.parse(request.options.body), { model: 'qwen3:8b', keep_alive: 0 });
  } finally {
    if (previousUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousUrl;
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

it('does not evict local Ollama for a stuck remote daemon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-watch-mismatch-'));
  const previousUrl = process.env.LLM_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    delete process.env.LLM_BASE_URL;
    globalThis.fetch = () => { requests++; return Promise.resolve({ ok: true }); };
    assert.equal(await maybeAutoRestartOllama(stuckSnapshot(dir, 'http://192.168.64.1:11434')), false);
    assert.equal(await maybeAutoRestartOllama(stuckSnapshot(dir)), false);
    assert.equal(requests, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousUrl;
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
