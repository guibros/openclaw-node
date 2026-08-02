import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_TIMEOUT_MS, runSchedulerHeartbeat, validateHeartbeatEndpoint } from '../bin/scheduler-heartbeat.mjs';

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('heartbeat timeout stays bounded below its 60-second service interval', () => {
  assert.equal(HEARTBEAT_TIMEOUT_MS, 30_000);
});

test('authenticated scheduler heartbeat posts internally-read token and returns tick evidence', async () => {
  let request;
  const result = await runSchedulerHeartbeat({
    tokenPath: '/tmp/token',
    readFile: async () => 'secret-token\n',
    fetch: async (url, options) => { request = { url, options }; return response(200, { dispatched: 2 }); },
  });
  assert.equal(request.url, 'http://127.0.0.1:3000/api/scheduler/tick');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(result, { ok: true, http_status: 200, tick: { dispatched: 2 } });
});

test('empty token fails before any request', async () => {
  let called = false;
  await assert.rejects(
    runSchedulerHeartbeat({ readFile: async () => '  ', fetch: async () => { called = true; } }),
    /session token is empty/,
  );
  assert.equal(called, false);
});

test('endpoint is restricted to the exact loopback scheduler route', () => {
  assert.equal(validateHeartbeatEndpoint('http://localhost:3000/api/scheduler/tick'), 'http://localhost:3000/api/scheduler/tick');
  assert.throws(() => validateHeartbeatEndpoint('https://127.0.0.1/api/scheduler/tick'), /loopback HTTP/);
  assert.throws(() => validateHeartbeatEndpoint('http://example.com/api/scheduler/tick'), /loopback HTTP/);
  assert.throws(() => validateHeartbeatEndpoint('http://127.0.0.1:3000/api/tasks'), /loopback HTTP/);
});

test('HTTP auth failure exits through a bounded error without echoing the token', async () => {
  const err = await runSchedulerHeartbeat({
    readFile: async () => 'do-not-print-me',
    fetch: async () => response(401, { error: 'token' }),
  }).then(() => null, (error) => error);
  assert.match(err.message, /HTTP 401/);
  assert.doesNotMatch(err.message, /do-not-print-me/);
});
