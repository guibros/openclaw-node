#!/usr/bin/env node
/**
 * mc-health — Mission Control health check + auto-restart
 *
 * Probes GET /api/system/health. If unhealthy or unreachable:
 *   1. Logs the failure
 *   2. Optionally restarts MC (--restart flag)
 *   3. Verifies MC came back up (polls for 30s)
 *
 * Usage:
 *   node bin/mc-health.mjs              # check only, exit 0/1
 *   node bin/mc-health.mjs --restart    # check + restart if unhealthy
 *   node bin/mc-health.mjs --json       # output JSON diagnostics
 *
 * Exit codes:
 *   0 = healthy
 *   1 = unhealthy or unreachable
 *   2 = restarted and verified healthy
 *   3 = restarted but failed to come back up
 */

import http from 'http';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const MC_DIR = path.join(WORKSPACE, 'projects', 'mission-control');
const MC_URL = process.env.MC_URL || 'http://localhost:3000';
const args = process.argv.slice(2);
const doRestart = args.includes('--restart');
const jsonOutput = args.includes('--json');

/** Extract port from MC_URL for lsof kill */
function getMCPort() {
  try {
    return new URL(MC_URL).port || '3000';
  } catch {
    return '3000';
  }
}

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Poll health endpoint until healthy or timeout */
async function waitForHealthy(maxWaitMs = 30000) {
  const start = Date.now();
  const interval = 2000;
  while (Date.now() - start < maxWaitMs) {
    await sleep(interval);
    try {
      const { status, body } = await httpGet(`${MC_URL}/api/system/health`, 3000);
      if (status === 200 && body?.status !== 'unhealthy') {
        return { ok: true, body };
      }
    } catch { /* still starting */ }
  }
  return { ok: false };
}

async function restartMC() {
  const port = getMCPort();
  console.error('[mc-health] Stopping MC...');

  // Kill existing process on the port
  try {
    execSync(`lsof -ti:${port} | xargs kill 2>/dev/null || true`, { timeout: 5000 });
  } catch { /* ignore */ }

  // Wait for port to free up
  await sleep(2000);

  // Kill harder if still alive
  try {
    const pids = execSync(`lsof -ti:${port} 2>/dev/null`, { timeout: 3000 }).toString().trim();
    if (pids) {
      execSync(`echo "${pids}" | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
      await sleep(1000);
    }
  } catch { /* port is free */ }

  // Clear stale lock
  try {
    execSync(`rm -f "${MC_DIR}/.next/dev/lock"`, { timeout: 3000 });
  } catch { /* ignore */ }

  console.error('[mc-health] Starting MC...');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: MC_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  child.unref();
  console.error(`[mc-health] MC process spawned (PID ${child.pid})`);

  // Verify it actually came back
  console.error('[mc-health] Waiting for MC to become healthy...');
  const result = await waitForHealthy(30000);

  if (result.ok) {
    const db = result.body?.db || {};
    console.error(`[mc-health] MC restarted and healthy: tasks=${db.taskCount} wal=${db.walSizeMB}MB`);
    return true;
  } else {
    console.error('[mc-health] MC failed to become healthy after 30s');
    return false;
  }
}

async function main() {
  const ts = new Date().toISOString();

  try {
    const { status, body } = await httpGet(`${MC_URL}/api/system/health`);

    if (status === 200 && body?.status !== 'unhealthy') {
      if (jsonOutput) {
        console.log(JSON.stringify({ ts, ...body }));
      } else {
        const db = body.db || {};
        console.log(`[mc-health] ${body.status} | tasks=${db.taskCount} obs=${db.obsEventCount} db=${db.dbSizeMB}MB wal=${db.walSizeMB}MB uptime=${body.uptime_s}s`);
      }
      process.exitCode = 0;
      return;
    }

    // Unhealthy
    const errMsg = body?.error || `HTTP ${status}`;
    console.error(`[mc-health] UNHEALTHY: ${errMsg}`);

    if (jsonOutput) {
      console.log(JSON.stringify({ ts, status: 'unhealthy', error: errMsg }));
    }

    if (doRestart) {
      const success = await restartMC();
      process.exitCode = success ? 2 : 3;
      return;
    }
    process.exitCode = 1;
    return;

  } catch (err) {
    // Unreachable
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[mc-health] UNREACHABLE: ${errMsg}`);

    if (jsonOutput) {
      console.log(JSON.stringify({ ts, status: 'unreachable', error: errMsg }));
    }

    if (doRestart) {
      const success = await restartMC();
      process.exitCode = success ? 2 : 3;
      return;
    }
    process.exitCode = 1;
    return;
  }
}

main();
