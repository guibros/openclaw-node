import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerClient } from '../lib/workplan-viewer-client.mjs';

const ORIGIN = 'http://127.0.0.1:7892';
const KEY = 'workplan-viewer-session';
const TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ saved, fetchImpl = async () => Response.json({}), onUnauthorized } = {}) {
  const values = new Map(saved === undefined ? [] : [[KEY, saved]]);
  const writes = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
  return {
    values, writes,
    client: createViewerClient({ storage, fetchImpl, origin: ORIGIN, onUnauthorized }),
  };
}

function savedSession(expiresAt = Date.now() + 60000) {
  return JSON.stringify({ token: TOKEN, expiresAt });
}

function eventBody(chunks = []) {
  let controller;
  let cancelled = false;
  const body = new ReadableStream({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  });
  for (const chunk of chunks) controller.enqueue(chunk);
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }),
    push: value => controller.enqueue(new TextEncoder().encode(value)),
    end: () => controller.close(),
    fail: () => controller.error(new Error('Disconnected')),
    cancelled: () => cancelled,
  };
}

test('module imports without DOM globals and restores only unexpired sessions', () => {
  assert.equal(fixture().client.hasSession(), false);
  assert.equal(fixture({ saved: savedSession() }).client.hasSession(), true);
  for (const saved of ['broken JSON', '{}', savedSession(Date.now() - 1), JSON.stringify({
    token: 'master-token', expiresAt: Date.now() + 60000,
  })]) {
    const { client, values } = fixture({ saved });
    assert.equal(client.hasSession(), false);
    assert.equal(values.size, 0);
  }
});

test('login exchanges the master token and persists only the validated session', async () => {
  const expiresAt = Date.now() + 60000;
  const calls = [];
  const { client, writes } = fixture({ fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ token: TOKEN, expiresAt, ignored: 'not persisted' });
  } });
  await client.login('private-master');
  assert.equal(client.hasSession(), true);
  assert.deepEqual(writes, [[KEY, JSON.stringify({ token: TOKEN, expiresAt })]]);
  const [url, options] = calls[0];
  assert.equal(url, `${ORIGIN}/api/session`);
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { token: 'private-master' });
  assert.equal(options.headers.get('Authorization'), null);
  assert.equal(options.headers.get('Content-Type'), 'application/json');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.mode, 'same-origin');
  assert.equal(JSON.stringify(writes).includes('private-master'), false);
});

test('failed, malformed, expired, and master-echo login responses store no credential', async () => {
  for (const response of [
    new Response('', { status: 401 }),
    Response.json({ token: 'wrong', expiresAt: Date.now() + 60000 }),
    Response.json({ token: TOKEN, expiresAt: Date.now() - 1 }),
    Response.json({ token: TOKEN, expiresAt: String(Date.now() + 60000) }),
    Response.json({ token: OTHER_TOKEN, expiresAt: Date.now() + 60000 }),
    new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const { client, writes, values } = fixture({ fetchImpl: async () => response });
    await assert.rejects(client.login(OTHER_TOKEN));
    assert.equal(client.hasSession(), false);
    assert.equal(values.size, 0);
    assert.equal(writes.length, 0);
  }
});

test('requests pin authentication and fetch protections while preserving mutations', async () => {
  let call;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async (...args) => {
    call = args;
    return Response.json({ saved: true });
  } });
  const response = await client.request('/api/plans/example/block?dry=1', {
    method: 'POST', body: '{"reason":"operator"}',
    headers: { Authorization: 'Bearer wrong', Cookie: 'private=value', 'Content-Type': 'application/json' },
    credentials: 'include', redirect: 'follow', mode: 'cors', cache: 'default',
  });
  assert.deepEqual(await response.json(), { saved: true });
  assert.equal(call[0], `${ORIGIN}/api/plans/example/block?dry=1`);
  const options = call[1];
  assert.equal(options.method, 'POST');
  assert.equal(options.body, '{"reason":"operator"}');
  assert.equal(options.headers.get('Authorization'), `Bearer ${TOKEN}`);
  assert.equal(options.headers.get('Cookie'), null);
  assert.equal(options.headers.get('Content-Type'), 'application/json');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.mode, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
});

test('absolute, foreign, credentialed, ambiguous and fragment paths never reach fetch', async () => {
  let calls = 0;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async () => { calls++; } });
  for (const path of [
    'https://foreign.example/api/plans', `${ORIGIN}/api/plans`, '//foreign.example/api',
    '//user:secret@127.0.0.1:7892/api', '/\\foreign.example/api', '/api\\plans',
    ' /api/plans', '/api\n/plans', '/api/plans#private', 'api/plans',
  ]) {
    await assert.rejects(client.request(path), /same-origin/);
    assert.throws(() => client.stream(path), /same-origin/);
  }
  assert.equal(calls, 0);
});

test('redirect responses are rejected for login and private requests', async () => {
  for (const response of [
    new Response('', { status: 302, headers: { Location: 'https://foreign.example/' } }),
    { redirected: true, status: 200, ok: true },
    { redirected: false, status: 200, ok: true, url: 'https://foreign.example/api/plans' },
  ]) {
    const { client, writes } = fixture({ saved: savedSession(), fetchImpl: async () => response });
    await assert.rejects(client.request('/api/plans'), /redirects/);
    await assert.rejects(client.login('master'), /redirects/);
    assert.equal(writes.length, 0);
  }
});

test('a rejected mutation is never replayed and invalidation notifies only once', async () => {
  let calls = 0;
  let notifications = 0;
  const { client, values } = fixture({ saved: savedSession(), onUnauthorized: () => notifications++,
    fetchImpl: async () => { calls++; return new Response('', { status: 401 }); },
  });
  await assert.rejects(client.request('/api/plans/example/automation/run-once', { method: 'POST' }), {
    status: 401, code: 'VIEWER_UNAUTHORIZED',
  });
  await assert.rejects(client.request('/api/plans'), { status: 401 });
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
  assert.equal(values.size, 0);
});

test('transport and server failures do not replay request mutations', async () => {
  for (const result of [new Error('Connection lost'), new Response('', { status: 503 })]) {
    let calls = 0;
    const { client } = fixture({ saved: savedSession(), fetchImpl: async () => {
      calls++;
      if (result instanceof Error) throw result;
      return result;
    } });
    if (result instanceof Error) await assert.rejects(client.request('/api/control', { method: 'POST' }));
    else assert.equal((await client.request('/api/control', { method: 'POST' })).status, 503);
    assert.equal(calls, 1);
  }
});

test('SSE parses split UTF-8, CRLF, comments, multiline and default event data', async () => {
  const bytes = new TextEncoder().encode('\uFEFF: heartbeat\r\nevent: reset\r\ndata: café 😀\r\ndata: second line\r\n\r\n'
    + 'event: ignored\n\nevent:\ndata: default\n\ndata:\n\n'
    + 'event: activity\rid: ignored\rretry: 1\rdata:{"ok":true}\r\r');
  const source = eventBody(Array.from(bytes, byte => new Uint8Array([byte])));
  let options;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async (_url, value) => {
    options = value;
    return source.response;
  } });
  const stream = client.stream('/api/global/activity-stream');
  const events = [];
  for (const type of ['reset', 'message', 'activity', 'ignored']) {
    stream.addEventListener(type, event => events.push([event.type, event.data]));
  }
  await flush();
  assert.ok(stream instanceof EventTarget);
  assert.deepEqual(events, [
    ['reset', 'café 😀\nsecond line'], ['message', 'default'], ['message', ''], ['activity', '{"ok":true}'],
  ]);
  assert.equal(options.headers.get('Authorization'), `Bearer ${TOKEN}`);
  assert.equal(options.headers.get('Accept'), 'text/event-stream');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  client.stop();
  await flush();
  assert.equal(source.cancelled(), true);
  assert.equal(options.signal.aborted, true);
  assert.equal(client.hasSession(), true);
});

test('SSE drops an incomplete frame and reconnects after EOF with fresh full events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = eventBody();
  first.push('event: append\ndata: old incomplete');
  first.end();
  const second = eventBody();
  second.push('event: switch\ndata: new source\n\nevent: append\ndata: full contents\n\n');
  let calls = 0;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async () => {
    calls++;
    return calls === 1 ? first.response : second.response;
  } });
  t.after(() => client.stop());
  const stream = client.stream('/api/global/stream');
  const events = [];
  for (const type of ['switch', 'append']) stream.addEventListener(type, event => events.push(event.data));
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(events, []);
  t.mock.timers.tick(499);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(events, ['new source', 'full contents']);
});

test('SSE retries transport and 5xx failures with an exponential delay bounded at 10 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async () => {
    calls++;
    if (calls % 2) throw new Error('Offline');
    return new Response('', { status: 503 });
  } });
  t.after(() => client.stop());
  const stream = client.stream('/api/global/stream');
  let errors = 0;
  stream.addEventListener('error', () => errors++);
  await flush();
  assert.equal(calls, 1);
  for (const delay of [500, 1000, 2000, 4000, 8000, 10000, 10000]) {
    const previous = calls;
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(calls, previous);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(calls, previous + 1);
  }
  assert.equal(errors, calls);
  stream.close();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 8);
});

test('SSE does not reconnect on 4xx, redirects, or an unexpected content type', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const response of [new Response('', { status: 403 }), new Response('', { status: 302 }),
    new Response('login shell', { headers: { 'Content-Type': 'text/html' } })]) {
    let calls = 0;
    const { client } = fixture({ saved: savedSession(), fetchImpl: async () => { calls++; return response; } });
    client.stream('/api/global/stream');
    await flush();
    t.mock.timers.tick(30000);
    await flush();
    assert.equal(calls, 1);
    client.stop();
  }
});

test('a stream 401 cancels every stream and all pending reconnects', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = eventBody();
  let calls = 0;
  let notifications = 0;
  const { client, values } = fixture({ saved: savedSession(), onUnauthorized: () => notifications++,
    fetchImpl: async url => {
      calls++;
      if (url.endsWith('/active')) return source.response;
      if (url.endsWith('/retry')) return new Response('', { status: 503 });
      return new Response('', { status: 401 });
    },
  });
  client.stream('/api/active');
  client.stream('/api/retry');
  await flush();
  client.stream('/api/unauthorized');
  await flush();
  assert.equal(notifications, 1);
  assert.equal(values.size, 0);
  assert.equal(source.cancelled(), true);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 3);
});

test('a mutation 401 closes active streams and pending stream retries without replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = eventBody();
  let calls = 0;
  let notifications = 0;
  const { client } = fixture({ saved: savedSession(), onUnauthorized: () => notifications++,
    fetchImpl: async (url, options) => {
      calls++;
      if (options.method === 'POST') return new Response('', { status: 401 });
      if (url.endsWith('/active')) return source.response;
      return new Response('', { status: 503 });
    },
  });
  client.stream('/api/active');
  client.stream('/api/retry');
  await flush();
  await assert.rejects(client.request('/api/control', { method: 'POST' }), { status: 401 });
  await flush();
  assert.equal(source.cancelled(), true);
  assert.equal(notifications, 1);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 3);
});

test('expiry aborts an idle stream and forbids further requests or reconnects', async t => {
  const now = 1800000000000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const source = eventBody();
  let calls = 0;
  let notifications = 0;
  const { client, values } = fixture({ saved: savedSession(now + 1000), onUnauthorized: () => notifications++,
    fetchImpl: async () => { calls++; return source.response; },
  });
  client.stream('/api/global/stream');
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(source.cancelled(), true);
  assert.equal(client.hasSession(), false);
  assert.equal(values.size, 0);
  assert.equal(notifications, 1);
  await assert.rejects(client.request('/api/plans'), { status: 401 });
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
});

test('close and stop cancel active reads and pending fetches without deleting the session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = eventBody();
  let resolveFetch;
  let options;
  let calls = 0;
  const { client, values } = fixture({ saved: savedSession(), fetchImpl: (_url, init) => {
    calls++;
    options = init;
    return new Promise(resolve => { resolveFetch = resolve; });
  } });
  const stream = client.stream('/api/global/stream');
  await flush();
  client.stop();
  stream.close();
  assert.equal(options.signal.aborted, true);
  resolveFetch(source.response);
  await flush();
  assert.equal(source.cancelled(), true);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(client.hasSession(), true);
  assert.equal(values.size, 1);
});

test('closing a stream before it connects sends no request', async () => {
  let calls = 0;
  const { client } = fixture({ saved: savedSession(), fetchImpl: async () => { calls++; } });
  client.stream('/api/global/stream').close();
  await flush();
  assert.equal(calls, 0);
  assert.equal(client.hasSession(), true);
});

test('a listener closing its stream suppresses remaining events in the same chunk', async () => {
  const source = eventBody();
  source.push('data: first\n\ndata: second\n\n');
  const { client } = fixture({ saved: savedSession(), fetchImpl: async () => source.response });
  const stream = client.stream('/api/global/stream');
  const events = [];
  stream.addEventListener('message', event => { events.push(event.data); stream.close(); });
  await flush();
  assert.deepEqual(events, ['first']);
  assert.equal(source.cancelled(), true);
});

test('logout revokes the captured session and cleans up locally even when the network fails', async () => {
  const source = eventBody();
  const calls = [];
  const { client, values } = fixture({ saved: savedSession(), fetchImpl: async (url, options) => {
    calls.push([url, options]);
    if (options.method === 'DELETE') throw new Error('Offline');
    return source.response;
  } });
  client.stream('/api/global/stream');
  await flush();
  await client.logout();
  assert.equal(client.hasSession(), false);
  assert.equal(values.size, 0);
  assert.equal(source.cancelled(), true);
  assert.equal(calls[1][0], `${ORIGIN}/api/session`);
  assert.equal(calls[1][1].method, 'DELETE');
  assert.equal(calls[1][1].headers.get('Authorization'), `Bearer ${TOKEN}`);
  await client.logout();
  assert.equal(calls.length, 2);
});

test('logout prevents an outstanding sign-in from restoring the session', async () => {
  let resolveFetch;
  const { client, values } = fixture({ fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const login = client.login('private-master');
  await client.logout();
  resolveFetch(Response.json({ token: TOKEN, expiresAt: Date.now() + 60000 }));
  await assert.rejects(login, /cancelled/);
  assert.equal(client.hasSession(), false);
  assert.equal(values.size, 0);
});

test('a late 401 from an old session cannot invalidate a fresh login', async () => {
  let resolveOld;
  let notifications = 0;
  const { client } = fixture({ saved: savedSession(), onUnauthorized: () => notifications++,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') return Response.json({ token: OTHER_TOKEN, expiresAt: Date.now() + 60000 });
      return new Promise(resolve => { resolveOld = resolve; });
    },
  });
  const pending = client.request('/api/plans');
  await client.login('private-master');
  resolveOld(new Response('', { status: 401 }));
  await assert.rejects(pending, { status: 401 });
  assert.equal(client.hasSession(), true);
  assert.equal(notifications, 0);
});
