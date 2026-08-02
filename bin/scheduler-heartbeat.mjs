#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3000/api/scheduler/tick';
const DEFAULT_TOKEN_PATH = path.join(os.homedir(), '.openclaw', 'config', 'mc-session-token');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const HEARTBEAT_TIMEOUT_MS = 30_000;

export function validateHeartbeatEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'http:' || !LOOPBACK_HOSTS.has(endpoint.hostname) || endpoint.pathname !== '/api/scheduler/tick') {
    throw new Error('heartbeat endpoint must be loopback HTTP /api/scheduler/tick');
  }
  if (endpoint.username || endpoint.password) throw new Error('heartbeat endpoint must not contain credentials');
  return endpoint.toString();
}

export async function runSchedulerHeartbeat(options = {}) {
  const tokenPath = options.tokenPath || DEFAULT_TOKEN_PATH;
  const endpoint = validateHeartbeatEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const read = options.readFile || readFile;
  const request = options.fetch || fetch;
  const token = (await read(tokenPath, 'utf8')).trim();
  if (!token) throw new Error(`Mission Control session token is empty: ${tokenPath}`);

  const response = await request(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || HEARTBEAT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Mission Control scheduler tick returned HTTP ${response.status}`);

  const text = await response.text();
  let tick = null;
  try { tick = text ? JSON.parse(text) : null; } catch { tick = text.slice(0, 500); }
  return { ok: true, http_status: response.status, tick };
}

async function main() {
  try {
    const result = await runSchedulerHeartbeat({
      endpoint: process.env.OPENCLAW_MC_TICK_URL || DEFAULT_ENDPOINT,
      tokenPath: process.env.OPENCLAW_MC_TOKEN_FILE || DEFAULT_TOKEN_PATH,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (err) {
    process.stderr.write(`[scheduler-heartbeat] ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
