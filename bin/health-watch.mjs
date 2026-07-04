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
const NOTIFY_CLI = path.resolve(
  path.dirname(new URL(import.meta.url).pathname), 'openclaw-notify.mjs',
);
const MC_DIAGNOSTICS_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/diagnostics`;

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
  const kind = status === 'healthy' ? 'success' : status === 'degraded' ? 'warn' : 'error';
  const message = status === 'healthy'
    ? 'All components healthy'
    : `Health: ${status}`;
  try {
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [
        NOTIFY_CLI, '--source', 'health-watch', '--kind', kind,
        '--title', `Health watch — ${status}`, '--message', message,
        '--url', MC_DIAGNOSTICS_URL,
      ], { timeout: 10_000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch {
    // Notifier unavailable — skip
  }
}

// ---------------------------------------------------------------------------
// Queue health + auto-restart
// ---------------------------------------------------------------------------

let _queueModule = null;
async function getQueueModule() {
  if (_queueModule) return _queueModule;
  try {
    _queueModule = await import('../lib/ollama-queue.mjs');
    return _queueModule;
  } catch {
    return null;
  }
}

/**
 * Read the DAEMON's queue state from its exported snapshot (R12, repair 3.3).
 * health-watch is a separate process — importing the queue module here only
 * ever showed our own empty singleton, so stuck-detection could never fire.
 * Returns null when the snapshot is missing or stale (>2 min): a dead
 * exporter must read as "unknown", never as "idle".
 */
export async function getQueueHealth(snapshotPath) {
  const mod = await getQueueModule();
  if (!mod) return null;
  return mod.readStateSnapshot(snapshotPath);
}

// R12: restart rate-limiting is local to the restarter — the daemon's
// in-process counters can't be reset from here, and they clear themselves
// on its next successful run anyway.
const RESTART_WINDOW_MS = 15 * 60 * 1000;
const RESTART_MAX = 3;
let _localRestarts = [];

/**
 * Detect a stuck daemon-side Ollama (>=3 consecutive extraction timeouts in
 * the daemon's snapshot) and recover by unloading the model. Unload uses the
 * keep_alive:0 API — the 3.1 audit measured `ollama stop` NOT evicting while
 * the API call did. Returns true if a restart was attempted.
 */
export async function maybeAutoRestartOllama(snapshotPath) {
  const mod = await getQueueModule();
  if (!mod) return false;
  const snapshot = mod.readStateSnapshot(snapshotPath);
  if (!snapshot || !mod.snapshotLooksStuck(snapshot)) return false;

  _localRestarts = _localRestarts.filter(ts => Date.now() - ts < RESTART_WINDOW_MS);
  if (_localRestarts.length >= RESTART_MAX) {
    console.warn(`[health-watch] Ollama stuck but restart rate-limited (${_localRestarts.length} restarts in last 15min) — abstaining`);
    return false;
  }

  const model = snapshot.current_job?.model || process.env.LLM_MODEL || 'qwen3:8b';
  console.warn(`[health-watch] daemon's Ollama appears stuck (consecutive_timeouts=${JSON.stringify(snapshot.consecutive_timeouts)}). Unloading ${model} via keep_alive:0.`);

  try {
    const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`unload returned ${res.status}`);
    _localRestarts.push(Date.now());
    return true;
  } catch (err) {
    console.error(`[health-watch] ollama unload failed: ${err.message}`);
    return false;
  }
}

/**
 * Format the queue-state section appended to the health report.
 */
export function formatQueueSection(qs) {
  if (!qs) return '';
  const lines = ['', '## Queue State', ''];
  if (qs.current_job) {
    const ela = (qs.current_job.elapsed_ms / 1000).toFixed(1);
    const eta = qs.current_job.eta_ms ? `, ETA ~${Math.round(qs.current_job.eta_ms / 60000)}min` : '';
    lines.push(`- **In flight:** ${qs.current_job.type} (${ela}s elapsed${eta}, model=${qs.current_job.model || 'unknown'})`);
  } else {
    lines.push('- **In flight:** none (queue idle)');
  }
  lines.push(`- **Queue depth:** ${qs.queue_depth} pending`);
  lines.push(`- **History (rolling 10):** extraction avg=${qs.history.extraction.avg_ms}ms (n=${qs.history.extraction.count}); analysis avg=${qs.history.analysis.avg_ms}ms (n=${qs.history.analysis.count})`);
  lines.push(`- **Consecutive timeouts:** extraction=${qs.consecutive_timeouts.extraction}, analysis=${qs.consecutive_timeouts.analysis}`);
  lines.push(`- **Totals:** runs=${qs.totals.runs}, timeouts=${qs.totals.timeouts}, retries=${qs.totals.retries}, fallbacks=${qs.totals.fallbacks}, slow-alarms=${qs.totals.slowAlarms}`);
  if (qs.recent_slow_alarms.length > 0) {
    const a = qs.recent_slow_alarms[qs.recent_slow_alarms.length - 1];
    lines.push(`- **Last slow alarm:** ${a.type} ran ${a.ratio.toFixed(1)}× avg (${a.ms}ms vs ${a.avg_ms}ms baseline)`);
  }
  if (qs.recent_fallbacks.length > 0) {
    const f = qs.recent_fallbacks[qs.recent_fallbacks.length - 1];
    lines.push(`- **Last fallback:** ${f.reason} at ${new Date(f.ts).toISOString()}`);
  }
  if (qs.recent_restarts.length > 0) {
    const r = qs.recent_restarts[qs.recent_restarts.length - 1];
    lines.push(`- **Last auto-restart:** ${r.reason} at ${new Date(r.ts).toISOString()}`);
  }
  return lines.join('\n');
}

/**
 * Derive a queue-level status for the watcher's overall alerting.
 *   stuck      — auto-restart was attempted; warn loudly
 *   degraded   — recent fallbacks or slow alarms
 *   healthy    — no recent issues
 */
export function deriveQueueStatus(qs) {
  if (!qs) return 'healthy';
  if (qs.consecutive_timeouts.extraction >= 3 || qs.consecutive_timeouts.analysis >= 3) return 'stuck';
  const recentFallback = qs.recent_fallbacks.find(f => Date.now() - f.ts < 5 * 60 * 1000);
  const recentSlow = qs.recent_slow_alarms.find(a => Date.now() - a.ts < 5 * 60 * 1000);
  if (recentFallback || recentSlow) return 'degraded';
  return 'healthy';
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
    const componentStatus = deriveStatus(result);

    // Augment with queue health
    const queueState = await getQueueHealth();
    const queueStatus = deriveQueueStatus(queueState);

    // Stuck queue → attempt auto-restart of Ollama (best-effort)
    if (queueStatus === 'stuck') {
      await maybeAutoRestartOllama();
    }

    // Compose overall status: stuck queue > unhealthy component > degraded queue > healthy
    let status;
    if (queueStatus === 'stuck') status = 'stuck';
    else if (componentStatus !== 'healthy') status = componentStatus;
    else if (queueStatus === 'degraded') status = 'degraded';
    else status = 'healthy';

    const now = Date.now();
    const statusChanged = status !== previousStatus;
    const repeatDue = status !== 'healthy'
      && (now - lastAlertTime) >= REPEAT_ALERT_SEC * 1000;

    // The file is a HEARTBEAT, not a change-log: node-watch's ops.diagnostics
    // reads its mtime for freshness, so it must be written every tick — a
    // healthy-once-then-silent file is indistinguishable from a dead monitor.
    if (targets.includes('file')) {
      await alertFile(formatHealthReport(result) + formatQueueSection(queueState));
    }

    if (statusChanged || repeatDue) {
      const alertPromises = [];
      if (targets.includes('nats')) alertPromises.push(alertNats(status, result));
      if (targets.includes('banner') && (statusChanged || repeatDue)) {
        alertPromises.push(alertBanner(status));
      }
      await Promise.allSettled(alertPromises);
      lastAlertTime = now;
    }

    previousStatus = status;
    if (onTick) onTick(status, result, queueState);
  }

  function start(startOpts = {}) {
    if (running) return;
    running = true;
    // Run first check immediately
    tick().catch(err => console.error(`[health-watch] tick error: ${err.message}`));
    timer = setInterval(() => {
      tick().catch(err => console.error(`[health-watch] tick error: ${err.message}`));
    }, intervalSec * 1000);
    // When embedded in another long-lived process, unref so the watcher's timer
    // doesn't keep the host alive. When run standalone as a service (keepAlive),
    // the timer MUST hold the event loop open — otherwise the process exits after
    // the first tick and launchd KeepAlive restart-loops it.
    if (!startOpts.keepAlive && timer.unref) timer.unref();
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

  watcher.start({ keepAlive: true }); // standalone service — keep the process alive between ticks

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
