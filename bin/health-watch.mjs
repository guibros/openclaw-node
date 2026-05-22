#!/usr/bin/env node

/**
 * bin/health-watch.mjs — Long-running health watcher daemon for OpenClaw memory infrastructure.
 *
 * Runs runHealthCheck() at a configurable interval (default 60s) and routes alerts to
 * three destinations: file (.daemon-health.md), NATS (mesh.health.alerts), and macOS
 * banner (via memory-plan-notify.sh). Alerts fire on state transitions only (not every poll),
 * with a repeat alert every 5 minutes while unhealthy.
 *
 * Env vars:
 *   HEALTH_WATCH_INTERVAL_SEC — poll interval in seconds (default: 60)
 *   HEALTH_ALERT_TARGETS — CSV of: file, nats, banner (default: file,nats,banner)
 *   OPENCLAW_WORKSPACE — workspace root (default: ~/.openclaw/workspace)
 *   NATS_URL — NATS server URL for alert publishing (default: nats://localhost:4222)
 */

import {
  runHealthCheck,
  deriveStatus,
  formatHealthReport,
  parseAlertTargets,
  DEFAULT_INTERVAL_SEC,
} from '../lib/health-check.mjs';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_PATH = process.env.OPENCLAW_WORKSPACE
  || path.resolve(os.homedir(), '.openclaw', 'workspace');
const HEALTH_FILE = path.join(WORKSPACE_PATH, '.daemon-health.md');
const NATS_ALERT_SUBJECT = 'mesh.health.alerts';
const REPEAT_ALERT_SEC = 300; // re-alert every 5 min while unhealthy
const NOTIFY_SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..', 'workspace-bin', 'memory-plan-notify.sh',
);

// ---------------------------------------------------------------------------
// Alert destinations
// ---------------------------------------------------------------------------

async function alertFile(report) {
  try {
    await writeFile(HEALTH_FILE, report, 'utf8');
  } catch (err) {
    console.error(`[health-watch] file alert failed: ${err.message}`);
  }
}

async function alertNats(status, result) {
  try {
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    const { connect, StringCodec } = await import('nats');
    const nc = await connect({ servers: natsUrl, timeout: 5000, name: 'health-watch' });
    const sc = StringCodec();
    const payload = JSON.stringify({
      status,
      node_id: process.env.OPENCLAW_NODE_ID || os.hostname(),
      timestamp: new Date().toISOString(),
      components: result,
    });
    nc.publish(NATS_ALERT_SUBJECT, sc.encode(payload));
    await nc.flush();
    await nc.close();
  } catch (err) {
    // NATS unavailable — silently skip
  }
}

async function alertBanner(status) {
  if (process.platform !== 'darwin') return;
  const kind = status === 'healthy' ? 'closed' : 'blocked';
  const message = status === 'healthy'
    ? 'All components healthy'
    : `Health: ${status}`;
  try {
    await new Promise((resolve, reject) => {
      execFile(NOTIFY_SCRIPT, [kind, 'health-watch', message], { timeout: 5000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch {
    // Notification script unavailable — skip
  }
}

// ---------------------------------------------------------------------------
// Health watcher factory
// ---------------------------------------------------------------------------

/**
 * Create a health watcher that polls runHealthCheck at a regular interval.
 *
 * @param {Object} [opts]
 * @param {number} [opts.intervalSec] — poll interval in seconds
 * @param {string[]} [opts.targets] — alert destinations
 * @param {Function} [opts.healthCheckFn] — override for testing
 * @param {Function} [opts.onTick] — callback after each poll: (status, result) => void
 * @returns {{ start: Function, stop: Function }}
 */
export function createHealthWatch(opts = {}) {
  const envInterval = parseFloat(process.env.HEALTH_WATCH_INTERVAL_SEC);
  const intervalSec = opts.intervalSec
    ?? (envInterval > 0 ? envInterval : DEFAULT_INTERVAL_SEC);
  const targets = opts.targets || parseAlertTargets(process.env.HEALTH_ALERT_TARGETS);
  const checkFn = opts.healthCheckFn || runHealthCheck;
  const onTick = opts.onTick || null;

  let timer = null;
  let previousStatus = null;
  let lastAlertTime = 0;
  let running = false;

  async function tick() {
    const result = await checkFn(opts.checkOpts || {});
    const status = deriveStatus(result);
    const now = Date.now();

    const statusChanged = status !== previousStatus;
    const repeatDue = status !== 'healthy'
      && (now - lastAlertTime) >= REPEAT_ALERT_SEC * 1000;

    if (statusChanged || repeatDue) {
      const report = formatHealthReport(result);

      const alertPromises = [];
      if (targets.includes('file')) alertPromises.push(alertFile(report));
      if (targets.includes('nats')) alertPromises.push(alertNats(status, result));
      if (targets.includes('banner') && (statusChanged || repeatDue)) {
        alertPromises.push(alertBanner(status));
      }
      await Promise.allSettled(alertPromises);
      lastAlertTime = now;
    }

    previousStatus = status;
    if (onTick) onTick(status, result);
  }

  function start() {
    if (running) return;
    running = true;
    // Run first check immediately
    tick().catch(err => console.error(`[health-watch] tick error: ${err.message}`));
    timer = setInterval(() => {
      tick().catch(err => console.error(`[health-watch] tick error: ${err.message}`));
    }, intervalSec * 1000);
    // Allow process to exit if this is the only timer
    if (timer.unref) timer.unref();
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[health-watch] starting (interval=${
    parseFloat(process.env.HEALTH_WATCH_INTERVAL_SEC) || DEFAULT_INTERVAL_SEC
  }s)`);

  const watcher = createHealthWatch({
    onTick(status, result) {
      const failing = Object.entries(result)
        .filter(([, v]) => !v.ok)
        .map(([k]) => k);
      if (failing.length > 0) {
        console.log(`[health-watch] ${status}: failing=[${failing.join(',')}]`);
      } else {
        console.log(`[health-watch] ${status}`);
      }
    },
  });

  watcher.start();

  const shutdown = () => {
    console.log('[health-watch] shutting down');
    watcher.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Run CLI if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/health-watch.mjs')
  || process.argv[1].endsWith('\\health-watch.mjs')
);
if (isMain) {
  main().catch(err => {
    console.error(`[health-watch] fatal: ${err.message}`);
    process.exit(1);
  });
}
