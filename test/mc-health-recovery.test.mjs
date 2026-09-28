import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runFile = promisify(execFile);
const cli = fileURLToPath(new URL('../workspace-bin/mc-health.mjs', import.meta.url));
const supported = ['darwin', 'linux'].includes(process.platform);

async function fixture(t, { healthy = false, restartFails = false, authStatus, missingToken = false, transient = false, cooldown = false, refused = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-health-test-'));
  const calls = path.join(root, 'calls.json');
  const token = 'isolated-mc-test-token';
  const tokenFile = path.join(root, 'token');
  if (!missingToken) fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  if (cooldown) {
    const state = path.join(root, '.openclaw', 'run');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'mc-health-restart'), 'recent');
  }
  const service = process.platform === 'darwin' ? 'launchctl' : 'systemctl';
  const fake = `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(process.env.MC_TEST_CALLS, JSON.stringify(process.argv.slice(2)));\nprocess.exit(${restartFails ? 1 : 0});\n`;
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, service), fake, { mode: 0o755 });
  for (const forbidden of ['npm', 'lsof', 'kill']) {
    fs.writeFileSync(path.join(root, forbidden), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(process.env.MC_TEST_FORBIDDEN, 'called');\nprocess.exit(99);\n`, { mode: 0o755 });
  }
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    assert.equal(req.url, '/api/system/health');
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    const ready = healthy || (transient && requests > 1) || (!restartFails && fs.existsSync(calls));
    res.writeHead(authStatus || (ready ? 200 : 503), { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: ready ? 'healthy' : 'unhealthy', db: { taskCount: 7 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let listener;
  if (refused) {
    await new Promise(resolve => server.close(resolve));
    listener = setInterval(() => {
      if (fs.existsSync(calls)) {
        clearInterval(listener);
        server.listen(port, '127.0.0.1');
      }
    }, 10);
  }
  t.after(async () => {
    clearInterval(listener);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const env = { ...process.env, HOME: root, OPENCLAW_MC_TOKEN_FILE: tokenFile,
    MC_URL: `http://localhost:${port}`, PATH: `${root}${path.delimiter}${process.env.PATH}`,
    MC_TEST_CALLS: calls, MC_TEST_FORBIDDEN: path.join(root, 'forbidden') };
  let result;
  try {
    result = { ...(await runFile(process.execPath, [cli, '--restart', '--json'], { env, timeout: 12000 })), code: 0 };
  } catch (error) {
    result = error;
  }
  assert.equal(fs.existsSync(env.MC_TEST_FORBIDDEN), false, 'must not fall back to unmanaged process commands');
  return { result, calls: fs.existsSync(calls) ? JSON.parse(fs.readFileSync(calls, 'utf8')) : null, requests };
}

test('unhealthy MC restarts through its service manager and verifies authenticated recovery', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t);
  assert.equal(result.code, 2, result.stderr);
  assert.deepEqual(calls, process.platform === 'darwin'
    ? ['kickstart', '-k', `gui/${process.getuid()}/ai.openclaw.mission-control`]
    : ['--user', 'restart', 'openclaw-mission-control.service']);
  assert.ok(requests >= 2);
  assert.match(result.stderr, /restarted and healthy/);
});

test('failed managed restart reports failure without spawning another server', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { restartFails: true });
  assert.equal(result.code, 3, result.stderr);
  assert.ok(calls);
  assert.equal(requests, 3);
  assert.match(result.stderr, /Managed restart failed/);
});

test('healthy MC is left running', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { healthy: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(calls, null);
  assert.equal(requests, 1);
  assert.equal(JSON.parse(result.stdout).status, 'healthy');
});

for (const status of [401, 403]) {
  test(`HTTP ${status} does not restart a running service`, { skip: !supported }, async t => {
    const { result, calls, requests } = await fixture(t, { authStatus: status });
    assert.equal(result.code, 1, result.stderr);
    assert.equal(calls, null);
    assert.equal(requests, 1);
  });
}

test('missing credentials cannot initiate a restart', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { missingToken: true });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(calls, null);
  assert.equal(requests, 0);
});

test('transient server failure recovers without a restart', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { transient: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(calls, null);
  assert.equal(requests, 2);
});

test('persistent failure during cooldown does not restart again', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { cooldown: true });
  assert.equal(result.code, 3, result.stderr);
  assert.equal(calls, null);
  assert.equal(requests, 3);
  assert.match(result.stderr, /cooldown/);
});

test('connection refused starts exactly the managed service and verifies recovery', { skip: !supported }, async t => {
  const { result, calls, requests } = await fixture(t, { refused: true });
  assert.equal(result.code, 2, result.stderr);
  assert.ok(calls);
  assert.equal(requests, 1);
});
