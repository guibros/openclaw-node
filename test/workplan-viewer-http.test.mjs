import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/workplan-viewer.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-http-'));
  const plan = path.join(root, 'plans/fixture');
  const tokenFile = path.join(root, 'token');
  const master = 'a'.repeat(64);
  fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(tokenFile, master, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'bin/launchctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
  fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '# Fixture\n');
  fs.writeFileSync(path.join(plan, 'tick-logs/sample.log'), 'FIXTURE_LOG\n');
  fs.writeFileSync(path.join(root, 'private.log'), 'PRIVATE_OUTSIDE_LOG_ROOT');
  fs.symlinkSync(path.join(root, 'private.log'), path.join(plan, 'tick-logs/escape.log'));
  fs.symlinkSync('sample.log', path.join(plan, 'tick-logs/current.log'));
  fs.writeFileSync(path.join(root, 'tick.sh'), '#!/bin/sh\nprintf complete > "' + path.join(root, 'ran') + '"\n', { mode: 0o700 });
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [script], { cwd: root,
    env: { ...process.env, HOME: root, WORKPLAN_ROOTS: path.join(root, 'plans'),
      WORKPLAN_VIEWER_TOKEN_FILE: tokenFile, WORKPLAN_VIEWER_PORT: String(port),
      MEMORY_PLAN_NOTIFY: 'off', PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(deadline);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  function request(route, { method = 'GET', token, headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const allHeaders = Array.isArray(headers) ? headers : {
        ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) }),
      };
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: allHeaders, timeout: 5000 }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('fixture request timeout')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { await request('/'); ready = true; break; } catch { await sleep(30); }
  }
  assert.ok(ready, output);
  return { root, plan, port, origin, tokenFile, master, request, child, output: () => output };
}

test('all private routes reject anonymous access before effects; the shell exposes no data', async t => {
  const f = await fixture(t);
  const routes = [
    ['GET', '/api/plans'], ['GET', '/api/global/stream'], ['GET', '/api/global/activity-stream'],
    ...['state', 'logs', 'docs', 'registry', 'decisions', 'blocked', 'inventory', 'automation', 'stream', 'activity-stream', 'doc?path=VERSION', 'audits/0'].map(x => ['GET', '/api/plans/fixture/' + x]),
    ...['block', 'unblock', 'automation/load', 'automation/unload', 'automation/kickstart', 'automation/run-once'].map(x => ['POST', '/api/plans/fixture/' + x]),
    ['PUT', '/api/plans/fixture/automation/config'], ['POST', '/api/notify-config?enabled=1'],
    ['POST', '/api/notify-test'], ['GET', '/api/notify-test'], ['DELETE', '/api/session'],
    ['POST', '/x/../api/plans/fixture/block'], ['POST', '/%2e/api/plans/fixture/block'],
  ];
  for (const [method, route] of routes) {
    assert.equal((await f.request(route, { method, body: { content: 'UNAUTHORIZED' } })).status, 401, route);
  }
  assert.equal(fs.existsSync(path.join(f.plan, 'BLOCKED.md')), false);
  assert.equal(fs.existsSync(path.join(f.plan, 'automation.json')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'ran')), false);
  const shell = await f.request('/');
  assert.equal(shell.status, 200);
  assert.match(shell.text, /Sign in to your workplans/);
  assert.ok(!shell.text.includes(f.master) && !shell.text.includes(f.root));
  assert.equal(shell.headers['cache-control'], 'no-store');
  assert.match(shell.headers['content-security-policy'], /script-src 'self'/);
  assert.match(shell.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(shell.headers['access-control-allow-origin'], undefined);
  assert.equal((await f.request('/viewer-client.js')).status, 200);
  assert.equal((await f.request('/viewer-session.mjs')).status, 200);
});

function pinnedHandles(pid, file) {
  file = fs.realpathSync(file);
  if (process.platform === 'linux') {
    const dir = `/proc/${pid}/fd`;
    return fs.readdirSync(dir).filter(fd => {
      try { return fs.readlinkSync(path.join(dir, fd)) === file; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }).length;
  }
  return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-F', 'n'], { encoding: 'utf8' })
    .split('\n').filter(line => line === `n${file}`).length;
}

function streamConnections(pid, clientPort) {
  if (process.platform === 'linux') {
    const dir = `/proc/${pid}/fd`;
    const sockets = new Set(fs.readdirSync(dir).flatMap(fd => {
      try { return [fs.readlinkSync(path.join(dir, fd)).match(/^socket:\[(\d+)\]$/)?.[1]]; }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }));
    const remote = `0100007F:${clientPort.toString(16).toUpperCase().padStart(4, '0')}`;
    return fs.readFileSync(`/proc/${pid}/net/tcp`, 'utf8').trim().split('\n').slice(1)
      .map(line => line.trim().split(/\s+/)).filter(row => row[2] === remote && sockets.has(row[9])).length;
  }
  return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-nP', '-iTCP', '-F', 'n'], { encoding: 'utf8' })
    .split('\n').filter(line => line.endsWith(`->127.0.0.1:${clientPort}`)).length;
}

async function stalledLog(t, f, token) {
  const file = path.join(f.plan, 'tick-logs/sample.log');
  fs.writeFileSync(file, 'x'.repeat(24 * 1024 * 1024) + '\n');
  const socket = net.connect({ host: '127.0.0.1', port: f.port, highWaterMark: 1024 });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  const ready = new Promise((resolve, reject) => {
    let headers = '';
    const deadline = setTimeout(() => reject(new Error('stream headers timeout')), 5000);
    socket.on('error', reject);
    socket.on('data', chunk => {
      headers += chunk.toString('utf8');
      if (!headers.includes('\r\n\r\n')) return;
      socket.pause();
      clearTimeout(deadline);
      assert.match(headers, /^HTTP\/1\.1 200 /);
      resolve();
    });
  });
  socket.write(`GET /api/plans/fixture/stream?log=sample.log HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nAuthorization: Bearer ${token}\r\n\r\n`);
  await ready;
  assert.equal(pinnedHandles(f.child.pid, file), 1);
  const clientPort = socket.localPort;
  assert.equal(streamConnections(f.child.pid, clientPort), 1);
  return { file, socket, clientPort };
}

for (const scenario of ['revoke', 'rotate-growing', 'rotate-idle']) {
  test(`a stalled log stream releases its file without crashing on ${scenario}`, async t => {
    const f = await fixture(t);
    const grant = JSON.parse((await f.request('/api/session', { method: 'POST', body: { token: f.master } })).text).token;
    const { file, clientPort } = await stalledLog(t, f, grant);
    if (scenario !== 'rotate-idle') fs.appendFileSync(file, 'APPENDED_AFTER_BACKPRESSURE\n');
    let accepted = f.master;
    if (scenario === 'revoke') {
      assert.equal((await f.request('/api/session', { method: 'DELETE', token: grant })).status, 200);
    } else {
      accepted = 'b'.repeat(64);
      fs.writeFileSync(f.tokenFile, accepted);
    }
    await sleep(1200);
    assert.equal(f.child.exitCode, null, f.output());
    assert.equal(pinnedHandles(f.child.pid, file), 0);
    assert.equal(streamConnections(f.child.pid, clientPort), 0);
    assert.equal((await f.request('/api/plans', { token: accepted })).status, 200);
    assert.equal((await f.request('/api/plans', { token: grant })).status, 401);
    if (scenario === 'rotate-idle') {
      await sleep(15000);
      assert.equal(f.child.exitCode, null, f.output());
      assert.equal((await f.request('/api/plans', { token: accepted })).status, 200);
    }
  });
}

test('shutdown cuts a stalled stream and exits cleanly', async t => {
  const f = await fixture(t);
  await stalledLog(t, f, f.master);
  const exited = once(f.child, 'exit');
  const deadline = setTimeout(() => f.child.kill('SIGKILL'), 2000);
  f.child.kill('SIGTERM');
  const [code, signal] = await exited;
  clearTimeout(deadline);
  assert.equal(code, 0, f.output());
  assert.equal(signal, null);
});

test('credentials cannot bypass authority, origin, metadata or duplicate-header rejection', async t => {
  const f = await fixture(t);
  for (const headers of [{ Host: 'foreign.invalid' }, { Host: `localhost:${f.port + 1}` },
    { Origin: 'null' }, { Origin: 'http://foreign.invalid' }, { Origin: `http://localhost:${f.port}` },
    { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await f.request('/api/plans', { token: f.master, headers })).status, 403);
  }
  for (const route of ['http://foreign.invalid/api/plans', '//foreign.invalid/api/plans', '/\\foreign.invalid/api/plans']) {
    assert.equal((await f.request(route, { token: f.master })).status, 403);
  }
  for (const duplicate of ['Host', 'Authorization', 'Origin', 'Sec-Fetch-Site']) {
    const values = { Host: `127.0.0.1:${f.port}`, Authorization: `Bearer ${f.master}`, Origin: f.origin, 'Sec-Fetch-Site': 'same-origin' };
    const headers = Object.entries(values).flat().concat([duplicate, values[duplicate]]);
    assert.equal((await f.request('/api/plans', { headers })).status, 400, duplicate);
  }
});

test('authenticated controls preserve errors and execute only the fixture command', async t => {
  const f = await fixture(t);
  const opts = { token: f.master };
  const plans = await f.request('/api/plans', opts);
  assert.equal(plans.status, 200);
  assert.equal(JSON.parse(plans.text).plans[0].id, 'fixture');
  assert.equal((await f.request('/api/plans/fixture/block', { ...opts, method: 'POST', body: { content: 'Paused' } })).status, 200);
  assert.equal((await f.request('/api/plans/fixture/block', { ...opts, method: 'POST', body: {} })).status, 409);
  assert.equal((await f.request('/api/plans/fixture/unblock', { ...opts, method: 'POST' })).status, 200);
  const config = { tick_command: path.join(f.root, 'tick.sh'), working_dir: f.root,
    plist_label: 'fixture-only', plist_path: path.join(f.root, 'fixture.plist'),
    stdout_path: path.join(f.root, 'stdout'), stderr_path: path.join(f.root, 'stderr'), interval_seconds: 1800 };
  assert.equal((await f.request('/api/plans/fixture/automation/config', { ...opts, method: 'PUT', body: config })).status, 200);
  assert.equal((await f.request('/api/plans/fixture/automation/run-once', { ...opts, method: 'POST' })).status, 200);
  for (let i = 0; i < 50 && !fs.existsSync(path.join(f.root, 'ran')); i++) await sleep(20);
  assert.equal(fs.readFileSync(path.join(f.root, 'ran'), 'utf8'), 'complete');
  for (const name of ['../../private.log', 'escape.log', '../VERSION', '/private.log']) {
    assert.equal((await f.request('/api/plans/fixture/stream?log=' + encodeURIComponent(name), opts)).status, 404);
  }
  assert.equal((await f.request('/api/notify-test', opts)).status, 404);
  assert.equal((await f.request('/api/notify-test', { ...opts, method: 'POST' })).status, 200);
  assert.ok(!f.output().includes(f.master));
});

test('session exchange, streamed logs, revocation and file rotation work through HTTP', async t => {
  const f = await fixture(t);
  const login = () => f.request('/api/session', { method: 'POST', headers: { Origin: f.origin, 'Sec-Fetch-Site': 'same-origin' }, body: { token: f.master } });
  assert.equal((await f.request('/api/session', { method: 'POST', body: { token: 'wrong' } })).status, 401);
  const signedIn = await login();
  assert.equal(signedIn.status, 200);
  const { token, expiresAt } = JSON.parse(signedIn.text);
  assert.notEqual(token, f.master);
  assert.ok(expiresAt > Date.now());
  assert.equal((await f.request('/api/plans', { token })).status, 200);
  const response = await fetch(f.origin + '/api/plans/fixture/stream?log=current.log', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('FIXTURE_LOG')) { const next = await reader.read(); assert.equal(next.done, false); text += Buffer.from(next.value).toString(); }
  assert.equal((await f.request('/api/session', { method: 'DELETE', token })).status, 200);
  await assert.rejects(reader.read(), /terminated/);
  assert.equal((await f.request('/api/plans', { token })).status, 401);
  const again = JSON.parse((await login()).text).token;
  fs.writeFileSync(f.tokenFile, 'b'.repeat(64));
  assert.equal((await f.request('/api/plans', { token: again })).status, 401);
  assert.equal((await f.request('/api/plans', { token: f.master })).status, 401);
  assert.equal((await f.request('/api/plans', { token: 'b'.repeat(64) })).status, 200);
  assert.ok(!f.output().includes(token));
});

test('a pinned stream keeps its original file when the selected name is replaced', async t => {
  const f = await fixture(t);
  const selected = path.join(f.plan, 'tick-logs/sample.log');
  const retained = path.join(f.plan, 'tick-logs/retained.log');
  const response = await fetch(f.origin + '/api/plans/fixture/stream?log=sample.log', {
    headers: { Authorization: `Bearer ${f.master}` }, signal: AbortSignal.timeout(5000),
  });
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('FIXTURE_LOG')) text += Buffer.from((await reader.read()).value).toString();
  fs.renameSync(selected, retained);
  fs.symlinkSync(path.join(f.root, 'private.log'), selected);
  fs.appendFileSync(retained, 'ORIGINAL_FILE_APPEND\n');
  while (!text.includes('ORIGINAL_FILE_APPEND')) text += Buffer.from((await reader.read()).value).toString();
  assert.ok(!text.includes('PRIVATE_OUTSIDE_LOG_ROOT'));
  await reader.cancel();
  assert.equal((await f.request('/api/plans/fixture/stream?log=sample.log', { token: f.master })).status, 404);
});
