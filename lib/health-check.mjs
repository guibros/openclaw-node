/**
 * lib/health-check.mjs — Per-component health checking for the OpenClaw memory infrastructure.
 *
 * Probes 6 runtime dependencies and reports per-component status.
 * All check functions are async and return { ok: boolean, detail: string, latency_ms: number }.
 *
 * Designed for dependency injection: runHealthCheck(opts) accepts override check functions
 * so callers (and tests) can substitute mocks for system-level probes.
 */

import { execFile } from 'node:child_process';
import { writeFile, unlink, access, constants } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMPONENT_NAMES = Object.freeze([
  'daemon', 'nats', 'ollama', 'embedder', 'sqlite', 'workspace_writable',
]);

export const DEFAULT_INTERVAL_SEC = 60;

export const ALERT_TARGETS_DEFAULT = 'file,nats,banner';

const DAEMON_LABEL = 'ai.openclaw.memory-daemon';
const NATS_MONITOR_URL = process.env.NATS_MONITOR_URL || 'http://localhost:8222';
const OLLAMA_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
const STATE_DB_PATH = process.env.OPENCLAW_STATE_DB
  || path.join(os.homedir(), '.openclaw', 'state.db');
const WORKSPACE_PATH = process.env.OPENCLAW_WORKSPACE
  || path.resolve(os.homedir(), '.openclaw', 'workspace');
const CHECK_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Individual component checks
// ---------------------------------------------------------------------------

function timedCheck(fn) {
  return async () => {
    const start = performance.now();
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS),
        ),
      ]);
      return { ...result, latency_ms: Math.round(performance.now() - start) };
    } catch (err) {
      return {
        ok: false,
        detail: err.message || String(err),
        latency_ms: Math.round(performance.now() - start),
      };
    }
  };
}

/** Check if the memory-daemon process is running. */
/**
 * Parse the PID out of `launchctl list <label>` output, which is a property-list
 * dict (not a table) with the PID on a `"PID" = <n>;` line — absent when the job
 * isn't running. Exported for testing (the dict-vs-table mismatch was a live bug).
 * @returns {{ ok: boolean, detail: string }}
 */
export function parseLaunchctlPid(stdout) {
  const m = String(stdout).match(/"PID"\s*=\s*(\d+)\s*;/);
  return m ? { ok: true, detail: `pid=${m[1]}` } : { ok: false, detail: 'not running (no PID)' };
}

async function checkDaemon() {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      execFile('launchctl', ['list', DAEMON_LABEL], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, detail: `launchctl: ${err.message}` });
          return;
        }
        resolve(parseLaunchctlPid(stdout));
      });
    });
  }
  // Fallback: pgrep
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', 'memory-daemon.mjs'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ ok: false, detail: 'process not found' });
      } else {
        resolve({ ok: true, detail: `pid=${stdout.trim().split('\n')[0]}` });
      }
    });
  });
}

/** Check if NATS monitoring endpoint is reachable. */
async function checkNats() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${NATS_MONITOR_URL}/healthz`, { signal: controller.signal });
    if (res.ok) {
      return { ok: true, detail: 'monitoring endpoint ok' };
    }
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Check if Ollama API is reachable and has models. */
async function checkOllama() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const models = (json.models || []).map(m => m.name || m.model);
    return { ok: true, detail: `${models.length} model(s): ${models.slice(0, 3).join(', ')}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Check if the embedding model package is importable. */
async function checkEmbedder() {
  try {
    await import('@huggingface/transformers');
    return { ok: true, detail: 'transformers package available' };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/** Check if state.db is openable and queryable. */
async function checkSqlite() {
  try {
    const { openStore } = await import('./sqlite-store.mjs');
    const db = openStore(STATE_DB_PATH, { readonly: true });
    try {
      const row = db.prepare('SELECT 1 AS ok').get();
      if (row && row.ok === 1) {
        return { ok: true, detail: `state.db readable (${STATE_DB_PATH})` };
      }
      return { ok: false, detail: 'SELECT 1 returned unexpected result' };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/** Check if workspace directory is writable. */
async function checkWorkspaceWritable() {
  const probe = path.join(WORKSPACE_PATH, `.health-probe-${Date.now()}.tmp`);
  try {
    await access(WORKSPACE_PATH, constants.W_OK);
    await writeFile(probe, 'health-check-probe', 'utf8');
    await unlink(probe);
    return { ok: true, detail: `writable (${WORKSPACE_PATH})` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// Core health check runner
// ---------------------------------------------------------------------------

/**
 * Run all 6 component health checks and return per-component results.
 *
 * @param {Object} [opts] - Override individual check functions for testing
 * @param {Function} [opts.checkDaemon]
 * @param {Function} [opts.checkNats]
 * @param {Function} [opts.checkOllama]
 * @param {Function} [opts.checkEmbedder]
 * @param {Function} [opts.checkSqlite]
 * @param {Function} [opts.checkWorkspaceWritable]
 * @returns {Promise<Object>} Per-component results: { daemon, nats, ollama, embedder, sqlite, workspace_writable }
 */
export async function runHealthCheck(opts = {}) {
  const checkers = {
    daemon: timedCheck(opts.checkDaemon || checkDaemon),
    nats: timedCheck(opts.checkNats || checkNats),
    ollama: timedCheck(opts.checkOllama || checkOllama),
    embedder: timedCheck(opts.checkEmbedder || checkEmbedder),
    sqlite: timedCheck(opts.checkSqlite || checkSqlite),
    workspace_writable: timedCheck(opts.checkWorkspaceWritable || checkWorkspaceWritable),
  };

  const result = {};
  const entries = Object.entries(checkers);
  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));

  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i];
    const settled = results[i];
    if (settled.status === 'fulfilled') {
      result[name] = settled.value;
    } else {
      result[name] = { ok: false, detail: settled.reason?.message || 'unknown error', latency_ms: 0 };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

/**
 * Derive aggregate health status from per-component results.
 *
 * @param {Object} result - Output from runHealthCheck
 * @returns {'healthy'|'degraded'|'unhealthy'}
 */
export function deriveStatus(result) {
  const components = Object.values(result);
  const okCount = components.filter(c => c.ok).length;
  if (okCount === components.length) return 'healthy';
  if (okCount === 0) return 'unhealthy';
  return 'degraded';
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

/**
 * Format a health check result as a markdown report for `.daemon-health.md`.
 *
 * @param {Object} result - Output from runHealthCheck
 * @returns {string} Markdown report
 */
export function formatHealthReport(result) {
  const status = deriveStatus(result);
  const now = new Date().toISOString();
  const lines = [
    `# Daemon Health Report`,
    ``,
    `**Status:** ${status}`,
    `**Checked:** ${now}`,
    ``,
    `| Component | Status | Detail | Latency |`,
    `|-----------|--------|--------|---------|`,
  ];

  for (const name of COMPONENT_NAMES) {
    const c = result[name];
    if (!c) continue;
    const icon = c.ok ? 'OK' : 'FAIL';
    lines.push(`| ${name} | ${icon} | ${c.detail} | ${c.latency_ms}ms |`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Alert target parsing
// ---------------------------------------------------------------------------

/**
 * Parse the HEALTH_ALERT_TARGETS env var (comma-separated).
 * Valid targets: 'file', 'nats', 'banner'.
 *
 * @param {string} [envValue] - Raw env var value
 * @returns {string[]} Validated list of alert targets
 */
export function parseAlertTargets(envValue) {
  const raw = (envValue ?? ALERT_TARGETS_DEFAULT).trim();
  if (!raw) return ['file', 'nats', 'banner'];
  const valid = new Set(['file', 'nats', 'banner']);
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(s => valid.has(s));
}
