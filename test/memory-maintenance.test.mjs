/**
 * Protocol 4.5 — completion integrity for Mission Control maintenance mutations.
 *
 * All three mutations (sync, consolidate, graph) posted with no Authorization header
 * and resolved on `res.on('end')` without reading statusCode. Against the middleware
 * auth gate each returned 401 {"error":"token"} — logged verbatim, then reported as
 * "MC_SYNC: Memory index refreshed". The rejection was printed one line above the
 * success claim. A mutation now counts only when it authenticates AND proves success.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MAINT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'workspace-bin', 'memory-maintenance.mjs'
);
const { postAuthenticatedMutation } = await import(MAINT);

const URL_SYNC = 'http://127.0.0.1:3000/api/memory/sync';
const readToken = async () => 'test-token-value\n';
const res = (status, body, { json = true } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (json ? JSON.stringify(body) : String(body)),
});

test('rejects the 401 that was previously reported as success', async () => {
  const fetchImpl = async () => res(401, { error: 'token' });
  await assert.rejects(
    () => postAuthenticatedMutation(URL_SYNC, { readToken, fetchImpl }),
    /HTTP 401.*token/s
  );
});

test('rejects a 200 whose body carries an error field', async () => {
  // A rejection wearing a success status is still a rejection.
  const fetchImpl = async () => res(200, { error: 'not authorized' });
  await assert.rejects(
    () => postAuthenticatedMutation(URL_SYNC, { readToken, fetchImpl }),
    /returned HTTP 200 with error: not authorized/
  );
});

test('rejects a 200 with a non-JSON body', async () => {
  const fetchImpl = async () => res(200, '<html>login</html>', { json: false });
  await assert.rejects(
    () => postAuthenticatedMutation(URL_SYNC, { readToken, fetchImpl }),
    /non-JSON success body/
  );
});

test('accepts a genuine 2xx JSON success', async () => {
  const fetchImpl = async () => res(200, { ok: true, indexed: 42 });
  const r = await postAuthenticatedMutation(URL_SYNC, { readToken, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.body.indexed, 42);
});

test('sends a bearer Authorization header built from the trimmed token', async () => {
  let seen = null;
  const fetchImpl = async (_url, opts) => { seen = opts; return res(200, { ok: true }); };
  await postAuthenticatedMutation(URL_SYNC, { readToken, fetchImpl });
  assert.equal(seen.headers.Authorization, 'Bearer test-token-value');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.redirect, 'error', 'must not follow a redirect that could leak the token');
});

test('refuses an empty token rather than posting unauthenticated', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return res(200, { ok: true }); };
  await assert.rejects(
    () => postAuthenticatedMutation(URL_SYNC, { readToken: async () => '   \n', fetchImpl }),
    /session token is empty/
  );
  assert.equal(called, false, 'must not reach the network with an empty token');
});

test('refuses a non-loopback target', async () => {
  const fetchImpl = async () => res(200, { ok: true });
  await assert.rejects(
    () => postAuthenticatedMutation('http://evil.example.com/api/memory/sync', { readToken, fetchImpl }),
    /must target loopback HTTP/
  );
});

test('refuses an endpoint carrying embedded credentials', async () => {
  const fetchImpl = async () => res(200, { ok: true });
  await assert.rejects(
    () => postAuthenticatedMutation('http://u:p@127.0.0.1:3000/api/memory/sync', { readToken, fetchImpl }),
    /must not contain credentials/
  );
});

