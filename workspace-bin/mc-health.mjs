#!/usr/bin/env node
/**
 * mc-health — Mission Control health check + explicit managed restart
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
 *   3 = restart failed, suppressed, or did not restore health
 */

import http from 'http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mcAuthHeaders } from '../lib/mc-session-token.mjs';

const runFile = promisify(execFile);
const MC_URL = process.env.MC_URL || 'http://localhost:3000';
const args = process.argv.slice(2);
const doRestart = args.includes('--restart');
const jsonOutput = args.includes('--json');

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    // MC requires its session token on every /api method now; read the 0600 file.
    const req = http.get(url, { timeout: timeoutMs, headers: mcAuthHeaders() }, (res) => {
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
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
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
  const statePath = path.join(os.homedir(), '.openclaw', 'run', 'mc-health-restart');
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(statePath) && Date.now() - fs.statSync(statePath).mtimeMs < 15 * 60 * 1000) {
    console.error('[mc-health] Managed restart suppressed during 15-minute cooldown');
    return false;
  }
  fs.writeFileSync(statePath, new Date().toISOString(), { mode: 0o600 });
  console.error('[mc-health] Restarting the managed Mission Control service...');
  try {
    if (process.platform === 'darwin') {
      await runFile('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ai.openclaw.mission-control`], { timeout: 15000 });
    } else if (process.platform === 'linux') {
      await runFile('systemctl', ['--user', 'restart', 'openclaw-mission-control.service'], { timeout: 15000 });
    } else {
      throw new Error(`unsupported service platform: ${process.platform}`);
    }
  } catch (err) {
    console.error(`[mc-health] Managed restart failed: ${err.message}`);
    return false;
  }

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

  if (!mcAuthHeaders().Authorization) {
    console.error('[mc-health] AUTH MISCONFIGURED: session token missing; no restart');
    process.exitCode = 1;
    return;
  }

  try {
    let { status, body } = await httpGet(`${MC_URL}/api/system/health`);
    for (let attempt = 1; doRestart && status >= 500 && attempt < 3; attempt++) {
      await sleep(1000);
      ({ status, body } = await httpGet(`${MC_URL}/api/system/health`));
    }

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

    if (doRestart && status >= 500) {
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

    if (doRestart && ['ECONNREFUSED', 'ETIMEDOUT'].includes(err.code)) {
      const success = await restartMC();
      process.exitCode = success ? 2 : 3;
      return;
    }
    process.exitCode = 1;
    return;
  }
}

main();
