import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  viewerTokenPath,
  readViewerToken,
  viewerAuthHeaders,
  checkViewerRequest,
  createViewerAuth,
} from '../lib/workplan-viewer-auth.mjs';

const MASTER = 'a'.repeat(64);
const REPLACEMENT = 'b'.repeat(64);
const PORT = 7892;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workplan-viewer-auth-'));
  const file = path.join(dir, 'private', 'viewer-token');
  const instances = [];
  t.after(() => {
    for (const auth of instances) auth.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    write(value = MASTER + '\n', mode = 0o600) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, value, { mode });
      fs.chmodSync(file, mode);
    },
    create(options = {}) {
      const auth = createViewerAuth({ ...options, file });
      instances.push(auth);
      return auth;
    },
  };
}

function request({ host = `localhost:${PORT}`, url = '/api/plans', headers = {}, rawHeaders } = {}) {
  const merged = { host, ...headers };
  return {
    url,
    headers: merged,
    rawHeaders: rawHeaders ?? Object.entries(merged).flatMap(([name, value]) => [name, value]),
  };
}

function watch(auth, token) {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.endCount = 0;
  res.end = () => {
    res.endCount++;
    res.emit('finish');
  };
  auth.watch(req, res, token);
  return { req, res };
}

async function waitForFinish(res) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 3000);
  try { await once(res, 'finish', { signal: controller.signal }); }
  finally { clearTimeout(deadline); }
}

test('default HTTP port accepts both authority forms with canonical origins', () => {
  for (const host of ['localhost', 'localhost:80', '127.0.0.1', '127.0.0.1:80']) {
    const origin = new URL(`http://${host}`).origin;
    assert.equal(checkViewerRequest(request({ host, headers: { origin } }), 80).status, 200);
    assert.equal(checkViewerRequest(request({ host, headers: { origin: 'http://foreign.invalid' } }), 80).status, 403);
  }
  assert.equal(checkViewerRequest(request({ host: 'localhost:81' }), 80).status, 403);
});

test('generates a private token once and preserves it across auth restarts', (t) => {
  const f = fixture(t);
  const auth = f.create();
  const token = readViewerToken(f.file);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700);
  assert.equal(auth.authorize(`Bearer ${token}`), token);
  const session = auth.issue(token);
  auth.close();

  const restarted = f.create();
  assert.equal(readViewerToken(f.file), token);
  assert.equal(restarted.authorize(`Bearer ${token}`), token);
  assert.equal(restarted.authorize(`Bearer ${session.token}`), null);
});

for (const [name, value] of [
  ['empty', ''],
  ['whitespace-only', '\n \t'],
  ['short', 'a'.repeat(63)],
  ['long', 'a'.repeat(65)],
  ['non-hexadecimal', 'z'.repeat(64)],
  ['uppercase', 'A'.repeat(64)],
  ['oversized', MASTER + '\n'.repeat(65)],
]) {
  test(`rejects an existing ${name} token without overwriting it`, (t) => {
    const f = fixture(t);
    f.write(value);
    assert.throws(() => readViewerToken(f.file));
    assert.throws(() => f.create());
    assert.equal(fs.readFileSync(f.file, 'utf8'), value);
  });
}

for (const mode of [0o640, 0o604, 0o620, 0o601]) {
  test(`rejects a token with insecure mode ${mode.toString(8)}`, (t) => {
    const f = fixture(t);
    f.write(MASTER, mode);
    assert.throws(() => readViewerToken(f.file), /owner-private regular file/);
    assert.throws(() => f.create(), /owner-private regular file/);
    assert.equal(fs.statSync(f.file).mode & 0o777, mode);
  });
}

test('rejects symlinks and directories as token files', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.file), { mode: 0o700 });
  const target = path.join(f.dir, 'target');
  fs.writeFileSync(target, MASTER, { mode: 0o600 });
  fs.symlinkSync(target, f.file);
  assert.throws(() => readViewerToken(f.file));
  assert.throws(() => f.create());
  assert.equal(fs.readFileSync(target, 'utf8'), MASTER);
  fs.unlinkSync(f.file);
  fs.mkdirSync(f.file, { mode: 0o700 });
  assert.throws(() => readViewerToken(f.file), /owner-private regular file/);
  assert.throws(() => f.create(), /owner-private regular file/);
});

test('machine headers use the configured private file and fail closed on invalid or missing files', (t) => {
  const f = fixture(t);
  const previous = process.env.WORKPLAN_VIEWER_TOKEN_FILE;
  t.after(() => {
    if (previous === undefined) delete process.env.WORKPLAN_VIEWER_TOKEN_FILE;
    else process.env.WORKPLAN_VIEWER_TOKEN_FILE = previous;
  });
  process.env.WORKPLAN_VIEWER_TOKEN_FILE = f.file;
  assert.equal(viewerTokenPath(), f.file);
  assert.deepEqual(viewerAuthHeaders(), {});
  assert.equal(fs.existsSync(f.file), false);
  f.write();
  assert.deepEqual(viewerAuthHeaders(), { Authorization: `Bearer ${MASTER}` });
  f.write('invalid');
  assert.deepEqual(viewerAuthHeaders(), {});
  f.write(MASTER, 0o644);
  assert.deepEqual(viewerAuthHeaders(), {});
});

test('only the master credential issues unique sessions, while both grant types authorize', (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create({ now: () => 10_000, sessionTtlMs: 5_000 });
  const first = auth.issue(MASTER);
  const second = auth.issue(MASTER);
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.equal(first.expiresAt, 15_000);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.token, MASTER);
  assert.equal(auth.authorize(`Bearer ${MASTER}`), MASTER);
  assert.equal(auth.authorize(`Bearer ${first.token}`), first.token);
  assert.equal(auth.authorize(`bearer ${second.token}`), second.token);
  assert.equal(auth.issue(first.token), null);
  assert.equal(auth.issue(REPLACEMENT), null);
  assert.equal(auth.authorize(`Bearer ${REPLACEMENT}`), null);
});

test('malformed and Unicode credentials fail closed without comparison exceptions', (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create();
  for (const credential of [undefined, null, '', 'é'.repeat(64), '💥'.repeat(32), 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.equal(auth.issue(credential), null);
    assert.equal(auth.authorize(`Bearer ${credential}`), null);
  }
  for (const header of [undefined, '', MASTER, `Basic ${MASTER}`, `Bearer  ${MASTER}`, `Bearer ${MASTER} `, `Bearer ${MASTER}, Bearer ${MASTER}`]) {
    assert.equal(auth.authorize(header), null);
  }
});

test('sessions expire at their deadline and revocation leaves other grants intact', (t) => {
  const f = fixture(t);
  f.write();
  let now = 1_000;
  const auth = f.create({ now: () => now, sessionTtlMs: 100 });
  const expired = auth.issue(MASTER);
  now = 1_099;
  assert.equal(auth.authorize(`Bearer ${expired.token}`), expired.token);
  now = 1_100;
  assert.equal(auth.authorize(`Bearer ${expired.token}`), null);
  const revoked = auth.issue(MASTER);
  const retained = auth.issue(MASTER);
  const revokedStream = watch(auth, revoked.token);
  const retainedStream = watch(auth, retained.token);
  auth.revoke(revoked.token);
  assert.equal(auth.authorize(`Bearer ${revoked.token}`), null);
  assert.equal(revokedStream.res.endCount, 1);
  assert.equal(retainedStream.res.endCount, 0);
  assert.equal(auth.authorize(`Bearer ${retained.token}`), retained.token);
  assert.equal(auth.authorize(`Bearer ${MASTER}`), MASTER);
});

test('session capacity revokes the oldest issued grant', (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create();
  const first = auth.issue(MASTER);
  let latest;
  for (let i = 0; i < 128; i++) latest = auth.issue(MASTER);
  assert.equal(auth.authorize(`Bearer ${first.token}`), null);
  assert.equal(auth.authorize(`Bearer ${latest.token}`), latest.token);
});

test('token rotation revokes old grants and closes active streams without another request', async (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create();
  const session = auth.issue(MASTER);
  const masterStream = watch(auth, MASTER);
  const sessionStream = watch(auth, session.token);
  const finished = Promise.all([
    waitForFinish(masterStream.res),
    waitForFinish(sessionStream.res),
  ]);
  const replacement = path.join(f.dir, 'replacement');
  fs.writeFileSync(replacement, REPLACEMENT + '\n', { mode: 0o600 });
  fs.renameSync(replacement, f.file);
  await finished;
  assert.equal(masterStream.res.endCount, 1);
  assert.equal(sessionStream.res.endCount, 1);
  assert.equal(auth.authorize(`Bearer ${MASTER}`), null);
  assert.equal(auth.authorize(`Bearer ${session.token}`), null);
  assert.equal(auth.issue(MASTER), null);
  assert.equal(auth.authorize(`Bearer ${REPLACEMENT}`), REPLACEMENT);
  assert.ok(auth.issue(REPLACEMENT));
});

test('expired session streams close while a master stream remains open', async (t) => {
  const f = fixture(t);
  f.write();
  let now = 1_000;
  const auth = f.create({ now: () => now, sessionTtlMs: 100 });
  const session = auth.issue(MASTER);
  const masterStream = watch(auth, MASTER);
  const sessionStream = watch(auth, session.token);
  const finished = waitForFinish(sessionStream.res);
  now = session.expiresAt;
  await finished;
  assert.equal(sessionStream.res.endCount, 1);
  assert.equal(masterStream.res.endCount, 0);
  assert.equal(auth.authorize(`Bearer ${session.token}`), null);
});

for (const [name, damage] of [
  ['deleted', file => fs.unlinkSync(file)],
  ['invalid', file => fs.writeFileSync(file, '')],
  ['insecure', file => fs.chmodSync(file, 0o644)],
]) {
  test(`${name} token files revoke grants and streams, and repair does not revive sessions`, (t) => {
    const f = fixture(t);
    f.write();
    const auth = f.create();
    const session = auth.issue(MASTER);
    const stream = watch(auth, session.token);
    damage(f.file);
    assert.equal(auth.authorize(`Bearer ${MASTER}`), null);
    assert.equal(auth.authorize(`Bearer ${session.token}`), null);
    assert.equal(auth.issue(MASTER), null);
    assert.equal(stream.res.endCount, 1);
    f.write();
    assert.equal(auth.authorize(`Bearer ${MASTER}`), MASTER);
    assert.equal(auth.authorize(`Bearer ${session.token}`), null);
  });
}

test('disconnected streams are forgotten and close ends remaining streams once', (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create();
  const session = auth.issue(MASTER);
  const disconnected = watch(auth, session.token);
  const active = watch(auth, MASTER);
  disconnected.res.emit('close');
  auth.revoke(session.token);
  assert.equal(disconnected.res.endCount, 0);
  auth.close();
  auth.close();
  assert.equal(active.res.endCount, 1);
  assert.equal(disconnected.res.endCount, 0);
  assert.equal(auth.authorize(`Bearer ${session.token}`), null);
});

test('request completion does not stop tracking a still-open response stream', (t) => {
  const f = fixture(t);
  f.write();
  const auth = f.create();
  const session = auth.issue(MASTER);
  const stream = watch(auth, session.token);
  stream.req.emit('close');
  auth.revoke(session.token);
  assert.equal(stream.res.endCount, 1);
});

test('allows exact loopback hosts, matching origins and same-origin browser metadata', () => {
  for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`]) {
    for (const site of [undefined, 'same-origin', 'none']) {
      const headers = { origin: `http://${host}` };
      if (site !== undefined) headers['sec-fetch-site'] = site;
      const result = checkViewerRequest(request({ host, headers }), PORT);
      assert.equal(result.status, 200);
      assert.equal(result.url.origin, `http://${host}`);
    }
    assert.equal(checkViewerRequest(request({ host }), PORT).status, 200);
  }
});

test('rejects foreign, missing, noncanonical and wrong-port hosts', () => {
  for (const host of ['', 'localhost', 'localhost:7893', 'localhost:07892', 'localhost.:7892', 'localhost.evil:7892', '127.0.0.2:7892', '127.1:7892', '[::1]:7892', 'evil.example:7892', 'localhost:7892@evil.example', 'localhost:7892,evil.example', ' localhost:7892']) {
    assert.equal(checkViewerRequest(request({ host }), PORT).status, 403, host);
  }
});

test('origin must exactly match the request host, HTTP scheme and configured port', () => {
  for (const origin of ['', 'null', 'http://evil.example', 'https://localhost:7892', 'http://localhost', 'http://localhost:7893', 'http://127.0.0.1:7892', 'http://localhost:7892/', 'http://localhost:7892.evil.example']) {
    assert.equal(checkViewerRequest(request({ headers: { origin } }), PORT).status, 403, origin);
  }
});

test('rejects cross-site, same-site and malformed browser Fetch Metadata', () => {
  for (const site of ['cross-site', 'same-site', '', 'Same-Origin', 'same-origin, cross-site']) {
    assert.equal(checkViewerRequest(request({ headers: { 'sec-fetch-site': site } }), PORT).status, 403, site);
  }
});

for (const [name, value] of [
  ['Host', `localhost:${PORT}`],
  ['Authorization', `Bearer ${MASTER}`],
  ['Origin', `http://localhost:${PORT}`],
  ['Sec-Fetch-Site', 'same-origin'],
]) {
  test(`rejects duplicate ${name} headers even when identical and differently cased`, () => {
    const req = request();
    req.rawHeaders = name === 'Host' ? [] : ['Host', `localhost:${PORT}`];
    req.rawHeaders.push(name, value, name.toLowerCase(), value);
    assert.equal(checkViewerRequest(req, PORT).status, 400);
  });
}

test('normalizes safe dot segments and backslashes before routing', () => {
  for (const url of ['/public/../api/plans?x=1', '/public/%2e%2e/api/plans?x=1', '/./api/plans?x=1', '/public\\..\\api/plans?x=1', '/\\localhost:7892/api/plans?x=1']) {
    const result = checkViewerRequest(request({ url }), PORT);
    assert.equal(result.status, 200);
    assert.equal(result.url.pathname, '/api/plans');
    assert.equal(result.url.search, '?x=1');
  }
});

test('rejects absolute, scheme-relative and foreign backslash authority request targets', () => {
  for (const url of ['http://localhost:7892/api/plans', 'http://evil.example/api/plans', '//localhost:7892/api/plans', '//evil.example/api/plans', '/\\evil.example/api/plans', '\\evil.example/api/plans', 'api/plans', '*', '']) {
    assert.equal(checkViewerRequest(request({ url }), PORT).status, 403, url);
  }
});
