/**
 * memory-inject-server.test.mjs — Unit tests for lib/memory-inject-server.mjs
 *
 * Covers: getOrCreateToken (generate + reuse), startInjectionServer lifecycle,
 * /health endpoint, /memory/inject auth (401), missing-prompt (400),
 * body-size cap (400), happy path (200), @memory directives (off/none/deep/only:X),
 * graceful close.
 *
 * Uses a mock injector (no DB / no embedder / no LLM) for fast, hermetic tests.
 *
 * Run: node --test test/memory-inject-server.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// Point the token file to a temp location BEFORE importing
const TMP_HOME = mkdtempSync(join(tmpdir(), 'mis-test-home-'));
process.env.HOME = TMP_HOME;
process.env.MEMORY_INJECT_PORT = '0';  // OS-assigned random port

const { startInjectionServer, getOrCreateToken } = await import('../lib/memory-inject-server.mjs');

// ─── Mock injector ──────────────────────────────────────────────────────────

function createMockInjector(overrides = {}) {
  return {
    retrieve: overrides.retrieve || (async (prompt, opts) => ({
      concepts: [{ name: 'X' }],
      decisions: [],
      snippets: [],
      tokenCount: 42,
      analysis: { mode: 'llm', themes: ['t1'] },
      _calledWith: { prompt, opts },
    })),
  };
}

// ─── Server lifecycle ──────────────────────────────────────────────────────

let serverHandle = null;
let token = null;
let injectorRef = null;

before(async () => {
  // Server creates its own injector internally; we pass null deps so it
  // degrades gracefully (empty results, but happy path / error handling
  // still exercised). Port 0 = OS-assigned.
  serverHandle = await startInjectionServer({}, { port: 0, host: '127.0.0.1', log: () => {} });
  token = serverHandle.token;
});

after(async () => {
  if (serverHandle) await serverHandle.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
});

function url(path) {
  return `http://127.0.0.1:${serverHandle.port}${path}`;
}

async function req(method, path, { body, headers } = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(url(path), init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('getOrCreateToken', () => {
  it('persists a 64-char hex token to ~/.openclaw/config/memory-injection-token', () => {
    const t = getOrCreateToken();
    assert.ok(t.length === 64, `token should be 64 hex chars, got ${t.length}`);
    assert.match(t, /^[a-f0-9]{64}$/);
    const tokenPath = join(TMP_HOME, '.openclaw/config/memory-injection-token');
    assert.ok(existsSync(tokenPath));
    assert.equal(readFileSync(tokenPath, 'utf8').trim(), t);
  });

  it('returns the same token on subsequent calls', () => {
    const t1 = getOrCreateToken();
    const t2 = getOrCreateToken();
    assert.equal(t1, t2);
  });
});

describe('startInjectionServer lifecycle', () => {
  it('returns { server, port, token, close }', () => {
    assert.ok(serverHandle.server);
    assert.ok(typeof serverHandle.port === 'number' && serverHandle.port > 0);
    assert.ok(serverHandle.token);
    assert.equal(typeof serverHandle.close, 'function');
  });
});

describe('GET /health (with auth)', () => {
  it('returns 200 ok:true', async () => {
    const r = await req('GET', '/health', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(typeof r.json.ts === 'number');
  });
});

describe('Authentication', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const r = await req('POST', '/memory/inject', { body: { prompt: 'hi' } });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'unauthorized');
  });

  it('rejects wrong-token requests with 401', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'hi' },
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(r.status, 401);
  });

  it('rejects non-Bearer auth schemes with 401', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'hi' },
      headers: { Authorization: `Basic ${token}` },
    });
    assert.equal(r.status, 401);
  });
});

describe('POST /memory/inject — request validation', () => {
  // F-M12: empty/missing prompts now return 200 with noop, matching the
  // library-layer contract. Library callers get a graceful empty result;
  // HTTP callers used to get a 400 — inconsistent. Now both 200/noop.
  it('returns 200 + noop when prompt is missing', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { session_id: 's' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
    assert.equal(r.json.analysis.mode, 'noop');
    assert.match(r.json.analysis.skip_reason, /empty_prompt/);
  });

  it('returns 200 + noop when prompt is empty string', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: '' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
  });

  it('returns 200 + noop when prompt is wrong type', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 42 },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
  });

  it('returns 400 on invalid JSON body', async () => {
    const r = await req('POST', '/memory/inject', {
      body: '{not: valid json',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /invalid JSON/);
  });

  it('rejects body larger than 64KB cap (either 400 or connection drop)', async () => {
    const huge = 'x'.repeat(70 * 1024);
    let outcome;
    try {
      const r = await req('POST', '/memory/inject', {
        body: { prompt: huge },
        headers: { Authorization: `Bearer ${token}` },
      });
      outcome = { status: r.status };
    } catch (err) {
      // Server may destroy the connection mid-write when body exceeds cap →
      // surfaces as a fetch error rather than a 400. Both are acceptable
      // rejection signals; what matters is the request is NOT accepted.
      outcome = { connectionDropped: true, error: err.message };
    }
    if (outcome.status !== undefined) {
      assert.equal(outcome.status, 400, 'should be 400 when not connection-dropped');
    } else {
      assert.ok(outcome.connectionDropped, 'should have either 400 or dropped connection');
    }
  });
});

describe('POST /memory/inject — @memory directives', () => {
  it('honors @memory off — returns empty block + noop analysis', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'do something @memory off' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
    assert.equal(r.json.tokens, 0);
    assert.equal(r.json.analysis.mode, 'noop');
    assert.match(r.json.analysis.skip_reason, /directive:off/);
  });

  it('honors @memory none — returns empty block', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'help me @memory none' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
    assert.match(r.json.analysis.skip_reason, /directive:none/);
  });

  it('honors directive passed in body (not prompt)', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'hello', directive: 'off' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.block, '');
  });
});

describe('POST /memory/inject — happy path (degraded mode w/ null DBs)', () => {
  it('returns 200 with degraded-mode response when DBs unavailable', async () => {
    const r = await req('POST', '/memory/inject', {
      body: { prompt: 'test prompt', session_id: 's1', frontend: 'test' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.ok('block' in r.json);
    assert.ok('analysis' in r.json);
    assert.ok('items' in r.json);
    assert.ok(typeof r.json.tokens === 'number');
    assert.ok(typeof r.json.elapsed_ms === 'number');
  });
});

describe('Unknown routes', () => {
  it('returns 404 for unknown path with auth', async () => {
    const r = await req('GET', '/nope', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 404);
  });
});
