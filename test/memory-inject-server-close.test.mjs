/**
 * memory-inject-server-close.test.mjs — close() leaves nothing writing under HOME.
 *
 * Every /memory/inject request hands its injection-log line to a fire-and-forget
 * write (a mkdir of ~/.openclaw/workspace/logs, then an append). close() has to
 * wait for it and release the handles the server opened itself; otherwise a
 * caller that removes the home dir next races a write re-creating a directory
 * under it (the ENOTEMPTY that failed memory-inject-server.test.mjs's teardown on
 * CI). Kept in its own file with the injection log switched on, so its own temp
 * HOME and teardown are the thing under test.
 *
 * Run: node --test test/memory-inject-server-close.test.mjs
 */

import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'mis-close-home-'));
process.env.HOME = TMP_HOME;
delete process.env.INJECTION_LOG_DISABLED;
delete process.env.INJECTION_LOG_PATH;

const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');

after(() => {
  // No retries: once close() has resolved, nothing may still be writing here.
  rmSync(TMP_HOME, { recursive: true, force: true });
});

it('resolves only after the last request\'s injection-log line has landed', async () => {
  // llmClient: null skips the LLM analysis (seconds of waiting on a model that is
  // not there); the request still runs retrieval and its fire-and-forget log write.
  const server = await startInjectionServer({ llmClient: null }, { port: 0, host: '127.0.0.1', log: () => {} });
  const marker = `close ordering ${process.pid}-${Date.now()}`;
  // No keep-alive agent: the socket ends with the response, so close() is not held
  // open by an idle connection and returns as soon as its own work is done.
  const status = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt: marker, session_id: 's-close', frontend: 'test' });
    const req = http.request({
      host: '127.0.0.1', port: server.port, path: '/memory/inject', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${server.token}` },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(status, 200);
  await server.close();
  const logPath = join(TMP_HOME, '.openclaw/workspace/logs/memory-injections.jsonl');
  assert.ok(existsSync(logPath) && readFileSync(logPath, 'utf8').includes(marker),
    'the request\'s log line is on disk once close() resolves');
});
