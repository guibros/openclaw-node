/**
 * Node-readiness 1.2 (ported from 88be4f2) — completion integrity for Mission Control maintenance mutations.
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
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

for (const authorized of [true, false]) {
  test(`real maintenance cycle ${authorized ? 'authenticates every read and mutation' : 'skips mutations after authentication rejection'}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-maintenance-http-'));
    const tokenPath = path.join(root, 'session-token');
    fs.writeFileSync(tokenPath, 'fixture-session-token\n', { mode: 0o600 });
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      const accepted = authorized && req.headers.authorization === 'Bearer fixture-session-token';
      res.writeHead(accepted ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(accepted ? {
        status: 'healthy', db: { taskCount: 2 },
        stats: { entityCount: 3, activeRelations: 4 }, ok: true,
      } : { error: 'token' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const result = await promisify(execFile)(process.execPath, [MAINT, '--force', '--verbose'], {
        env: { ...process.env, HOME: root, OPENCLAW_WORKSPACE: root,
          MC_URL: `http://127.0.0.1:${server.address().port}`,
          MC_SESSION_TOKEN_PATH: '', OPENCLAW_MC_TOKEN_FILE: tokenPath },
        timeout: 15000,
      }).catch(error => {
        assert.equal(error.code, 1);
        return error;
      });
      assert.ok(requests.every(r => r.auth === 'Bearer fixture-session-token'));
      assert.deepEqual(requests.map(r => `${r.method} ${r.url}`), authorized ? [
        'GET /api/system/health', 'POST /api/memory/sync',
        'GET /api/tasks', 'POST /api/memory/consolidate',
        'GET /api/tasks', 'POST /api/memory/graph', 'GET /api/memory/graph',
      ] : ['GET /api/system/health', 'GET /api/tasks', 'GET /api/tasks']);
      if (authorized) {
        assert.match(result.stdout, /MC_SYNC: Memory index refreshed/);
        assert.match(result.stdout, /CONSOLIDATION: Memory items consolidated/);
        assert.match(result.stdout, /GRAPH: 3 entities, 4 relations/);
      } else {
        assert.match(result.stdout, /MC_UNHEALTHY: token/);
        assert.doesNotMatch(result.stdout, /MC_SYNC:|CONSOLIDATION:|GRAPH:/);
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
