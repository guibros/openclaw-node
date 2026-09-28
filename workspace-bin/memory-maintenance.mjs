#!/usr/bin/env node
/**
 * memory-maintenance.mjs — Automated memory system maintenance (Node.js port)
 *
 * Runs 13 systematic checks with auto-remediation.
 * Replaces the macOS-only bash script with cross-platform Node.js.
 *
 * Usage:
 *   node bin/memory-maintenance.mjs [--force] [--dry-run] [--verbose]
 *
 * Exit codes: 0 = clean, 1 = warnings, 2 = critical failure
 */

import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import os from 'os';
import { mcAuthHeaders } from '../lib/mc-session-token.mjs';

const execFileAsync = promisify(execFile);
const MC_TOKEN_PATH = process.env.MC_SESSION_TOKEN_PATH
  || path.join(os.homedir(), '.openclaw', 'config', 'mc-session-token');
const MC_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * POST one Mission Control mutation, authenticated, and prove it succeeded (protocol 4.5).
 *
 * All three maintenance mutations (sync, consolidate, graph) sent no Authorization
 * header and resolved on `res.on('end')` without ever reading `statusCode`. Against
 * the middleware auth gate every one returned 401 `{"error":"token"}` — which was
 * logged verbatim and then reported as `MC_SYNC: Memory index refreshed`. The
 * rejected body was printed one line above the success claim.
 *
 * A mutation counts as performed only when it authenticates, returns 2xx, and returns
 * a body that parses and does not carry an `error` field.
 *
 * @returns {Promise<{status: number, body: object|string}>} — throws on any failure
 */
export async function postAuthenticatedMutation(url, { timeoutMs = 5000, readToken, fetchImpl } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !MC_LOOPBACK_HOSTS.has(endpoint.hostname)) {
    throw new Error(`maintenance mutation must target loopback HTTP: ${url}`);
  }
  if (endpoint.username || endpoint.password) throw new Error('maintenance endpoint must not contain credentials');

  const read = readToken || ((p) => fs.promises.readFile(p, 'utf8'));
  const token = (await read(MC_TOKEN_PATH)).trim();
  if (!token) throw new Error(`Mission Control session token is empty: ${MC_TOKEN_PATH}`);

  const request = fetchImpl || fetch;
  const res = await request(endpoint.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${endpoint.pathname}: ${text.slice(0, 200)}`);
  }

  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`non-JSON success body from ${endpoint.pathname}: ${text.slice(0, 200)}`); }

  // A 200 carrying an error field is a rejection wearing a success status.
  if (body && typeof body === 'object' && body.error) {
    throw new Error(`${endpoint.pathname} returned HTTP ${res.status} with error: ${String(body.error).slice(0, 200)}`);
  }
  return { status: res.status, body };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const STATE_FILE = path.join(WORKSPACE, '.tmp/last-maintenance');
const RESULTS_FILE = path.join(WORKSPACE, '.tmp/maintenance-results');
const LOG_FILE = path.join(WORKSPACE, '.tmp/memory-maintenance.log');
const PREDICTIONS = path.join(MEMORY_DIR, 'predictions.md');
const ACTIVE_TASKS = path.join(MEMORY_DIR, 'active-tasks.md');
const MEMORY_MD = path.join(WORKSPACE, 'MEMORY.md');
const ERRORS_MD = path.join(WORKSPACE, '.learnings/ERRORS.md');
const COMPANION = path.join(WORKSPACE, '.companion-state.md');
const CLAWVAULT = path.join(WORKSPACE, 'bin/clawvault-local');

const MAINTENANCE_INTERVAL = 1800000; // 30 min in ms

// Parse args
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function timestamp() {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  if (VERBOSE) console.log(line);
}

const results = [];
function report(msg) { results.push(msg); }

function readFileOr(p, fallback = '') {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return fallback; }
}

function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / 86400000);
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montreal' });
}

function parseDate(str) {
  // Handle YYYY-MM-DD, ISO, or "America/Montreal" suffix
  const cleaned = str.trim().replace(/\s*America\/Montreal\s*$/, '').trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
// MAINTENANCE CHECKS
// ============================================================

let warnings = 0;
let actions = 0;

// 2. Prediction closure (>7 days, empty outcome)
function checkPredictions() {
  log('Checking predictions for closure...');
  if (!fs.existsSync(PREDICTIONS)) return;

  let content = readFileOr(PREDICTIONS);
  const predRegex = /^### (\d{4}-\d{2}-\d{2})/gm;
  const now = new Date();
  let expiredCount = 0;
  let match;

  while ((match = predRegex.exec(content)) !== null) {
    const predDate = new Date(match[1] + 'T00:00:00');
    if (isNaN(predDate.getTime())) continue;
    if (daysBetween(predDate, now) > 7) expiredCount++;
  }

  if (expiredCount > 0 && !DRY_RUN) {
    content = content
      .replace(/^\*\*Outcome:\*\*$/gm, '**Outcome:** [expired — no signal observed within review window]')
      .replace(/^\*\*Delta:\*\*$/gm, '**Delta:** [not measured — prediction expired]')
      .replace(/^\*\*Lesson:\*\*$/gm, '**Lesson:** [auto-expired by memory-maintenance; no observable outcome within 7-day window]')
      .replace(/\*\*Last calibration review:\*\*.*/g, `**Last calibration review:** ${today()}`);
    fs.writeFileSync(PREDICTIONS, content);
    log(`Expired ${expiredCount} predictions`);
    actions++;
    report(`PREDICTIONS: ${expiredCount} expired (>7 days, no outcome)`);
  } else if (expiredCount > 0) {
    log(`DRY RUN: Would expire ${expiredCount} predictions`);
  }
}

// 3. Stale task detection (running >24h)
function checkStaleTasks() {
  log('Checking for stale running tasks...');
  if (!fs.existsSync(ACTIVE_TASKS)) return;

  const content = readFileOr(ACTIVE_TASKS);
  const now = new Date();
  const stale = [];

  // Simple parser: find tasks with status: running and check updated_at
  const taskBlocks = content.split(/(?=^- task_id:)/m);
  for (const block of taskBlocks) {
    if (!block.includes('status: running')) continue;
    const titleMatch = block.match(/title:\s*"?(.+?)"?\s*$/m);
    const updatedMatch = block.match(/updated_at:\s*(.+)/);
    if (!titleMatch) continue;

    if (updatedMatch) {
      const updated = parseDate(updatedMatch[1]);
      if (updated && daysBetween(updated, now) > 1) {
        stale.push(titleMatch[1]);
      }
    }
  }

  if (stale.length > 0) {
    report(`STALE_TASKS: ${stale.length} tasks running >24h: ${stale.join(', ')}`);
    warnings++;
  }
}

// 4. MEMORY.md freshness
function checkMemoryFreshness() {
  log('Checking MEMORY.md freshness...');
  if (!fs.existsSync(MEMORY_MD)) return;

  const stat = fs.statSync(MEMORY_MD);
  const age = daysBetween(stat.mtime, new Date());
  if (age > 7) {
    report(`MEMORY_STALE: MEMORY.md is ${age} days old — needs refresh`);
    warnings++;
  }
}

// 5. Companion state freshness
function checkCompanionFreshness() {
  log('Checking companion-state freshness...');
  if (!fs.existsSync(COMPANION)) return;

  const stat = fs.statSync(COMPANION);
  const ageHours = Math.floor((Date.now() - stat.mtimeMs) / 3600000);
  if (ageHours > 2) {
    report(`COMPANION_STALE: .companion-state.md is ${ageHours} hours old`);
    // Don't increment warnings — daemon handles this
  }
}

// 6. ClawVault checkpoint
async function checkClawVault() {
  if (!fs.existsSync(CLAWVAULT)) return;
  log('Running ClawVault checkpoint...');

  if (DRY_RUN) { log('DRY RUN: Would run clawvault checkpoint'); return; }

  const taskContent = readFileOr(ACTIVE_TASKS);
  let workingOn = 'maintenance cycle';
  const runningMatch = taskContent.match(/title:\s*"?(.+?)"?\s*$/m);
  if (runningMatch) workingOn = runningMatch[1];

  try {
    const proc = spawn(CLAWVAULT, ['checkpoint', '--working-on', workingOn, '--focus', 'memory-maintenance'], {
      cwd: WORKSPACE,
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();
    // Kill after 10s
    setTimeout(() => { try { proc.kill(); } catch {} }, 10000);
    log('ClawVault checkpoint dispatched (background, 10s timeout)');
    actions++;
  } catch (e) {
    log(`ClawVault checkpoint failed: ${e.message}`);
  }
}

// 7. Mission Control sync
async function checkMissionControl() {
  log('Checking Mission Control health...');

  // Use health endpoint for real diagnostics
  const healthResult = await new Promise(resolve => {
    const req = http.get('http://localhost:3000/api/system/health', { timeout: 5000, headers: mcAuthHeaders({ tokenPath: MC_TOKEN_PATH }) }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

  if (!healthResult) {
    log('Mission Control unreachable — skipping');
    report('MC_DOWN: Mission Control unreachable (timeout or connection refused)');
    warnings++;

    return;
  }

  if (healthResult.status !== 200 || healthResult.body?.status === 'unhealthy') {
    const err = healthResult.body?.error || 'unknown';
    log(`Mission Control UNHEALTHY: ${err}`);
    report(`MC_UNHEALTHY: ${err}`);
    warnings++;

    return;
  }

  const db = healthResult.body?.db || {};
  log(`MC healthy: tasks=${db.taskCount} obs=${db.obsEventCount} db=${db.dbSizeMB}MB wal=${db.walSizeMB}MB`);

  if (DRY_RUN) { log('DRY RUN: Would sync Mission Control'); return; }

  try {
    const r = await postAuthenticatedMutation('http://127.0.0.1:3000/api/memory/sync', { timeoutMs: 5000 });
    log(`MC memory sync: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    actions++;
    report('MC_SYNC: Memory index refreshed');
  } catch (e) {
    log(`MC sync failed: ${e.message}`);
  }
}

// 9. Timestamp validation
function checkTimestamps() {
  log('Spot-checking timestamp consistency...');
  if (!fs.existsSync(ACTIVE_TASKS)) return;

  const content = readFileOr(ACTIVE_TASKS);
  const updatedLines = content.split('\n').filter(l => l.includes('updated_at:'));
  const nonIso = updatedLines.filter(l => !l.includes('T') && !l.includes('America/Montreal'));

  if (nonIso.length > 0) {
    report(`TIMESTAMP_WARN: ${nonIso.length} tasks have non-standard timestamp format`);
    warnings++;
  }
}

// 10. ERRORS.md staleness
function checkErrors() {
  log('Checking ERRORS.md...');
  if (!fs.existsSync(ERRORS_MD)) return;

  const content = readFileOr(ERRORS_MD);
  const pendingCount = (content.match(/Status: pending/gi) || []).length;
  if (pendingCount === 0) return;

  const stat = fs.statSync(ERRORS_MD);
  const age = daysBetween(stat.mtime, new Date());
  if (age > 14) {
    report(`ERRORS_STALE: ${pendingCount} errors pending for ${age}+ days in ERRORS.md`);
    warnings++;
  }
}

// 11. Memory consolidation (merge near-duplicate active facts)
async function checkConsolidation() {
  log('Checking for duplicate/overlapping memory items...');

  // Call MC API for consolidation — the logic lives in the TS codebase
  const isUp = await new Promise(resolve => {
    const req = http.get('http://localhost:3000/api/tasks', { timeout: 3000, headers: mcAuthHeaders({ tokenPath: MC_TOKEN_PATH }) }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (!isUp) { log('MC not running — skipping consolidation'); return; }
  if (DRY_RUN) { log('DRY RUN: Would run consolidation'); return; }

  try {
    const r = await postAuthenticatedMutation('http://127.0.0.1:3000/api/memory/consolidate', { timeoutMs: 10000 });
    log(`Consolidation: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    actions++;
    report('CONSOLIDATION: Memory items consolidated');
  } catch (e) {
    log(`Consolidation failed: ${e.message}`);
  }
}

// 12. Knowledge graph health (seed entities if empty, log stats)
async function checkGraphHealth() {
  log('Checking knowledge graph health...');

  const isUp = await new Promise(resolve => {
    const req = http.get('http://localhost:3000/api/tasks', { timeout: 3000, headers: mcAuthHeaders({ tokenPath: MC_TOKEN_PATH }) }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (!isUp) { log('MC not running — skipping graph health'); return; }

  try {
    // Seed known entities if graph is empty
    if (!DRY_RUN) {
      const r = await postAuthenticatedMutation('http://127.0.0.1:3000/api/memory/graph', { timeoutMs: 5000 });
      log(`Graph seed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }

    // Get stats
    const statsData = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3000/api/memory/graph', { timeout: 5000 }, res => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (statsData && statsData.stats) {
      const s = statsData.stats;
      log(`Graph: ${s.entityCount} entities, ${s.activeRelations} active relations`);
      report(`GRAPH: ${s.entityCount} entities, ${s.activeRelations} relations`);
    }
  } catch (e) {
    log(`Graph health check failed: ${e.message}`);
  }
}

// 13. Cross-soul lesson propagation health
function checkSharedLessons() {
  log('Checking shared lessons propagation...');

  const vaultPath = path.join(WORKSPACE, 'projects/arcane-vault/00-meta/shared-lessons.md');
  if (!fs.existsSync(vaultPath)) {
    log('shared-lessons.md not found — will be created on next obsidian-sync');
    report('SHARED_LESSONS: not yet generated (pending first obsidian-sync)');
    return;
  }

  const stat = fs.statSync(vaultPath);
  const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  const content = fs.readFileSync(vaultPath, 'utf-8');
  const lessonCount = (content.match(/^- \[/gm) || []).length;

  if (ageHours > 24) {
    report(`SHARED_LESSONS: stale (${Math.round(ageHours)}h old, ${lessonCount} lessons)`);
    warnings++;
  } else {
    report(`SHARED_LESSONS: ${lessonCount} lessons, updated ${Math.round(ageHours)}h ago`);
  }
}

// ============================================================
// MAIN
// ============================================================

export async function runMaintenance(opts = {}) {
  const force = opts.force ?? FORCE;
  const dryRun = opts.dryRun ?? DRY_RUN;

  fs.mkdirSync(path.join(WORKSPACE, '.tmp'), { recursive: true });

  // Throttle check
  if (!force) {
    if (fs.existsSync(STATE_FILE)) {
      const last = parseInt(readFileOr(STATE_FILE, '0'), 10);
      if (Date.now() - last < MAINTENANCE_INTERVAL) {
        return { actions: 0, warnings: 0, results: ['Throttled — too soon since last run'] };
      }
    }
  }

  log('=== Memory maintenance started ===');
  fs.writeFileSync(STATE_FILE, String(Date.now()));
  fs.writeFileSync(RESULTS_FILE, '');

  warnings = 0;
  actions = 0;
  results.length = 0;

  checkPredictions();
  checkStaleTasks();
  checkMemoryFreshness();
  checkCompanionFreshness();
  await checkClawVault();
  await checkMissionControl();
  checkTimestamps();
  checkErrors();
  await checkConsolidation();
  await checkGraphHealth();
  checkSharedLessons();

  // Write results
  fs.writeFileSync(RESULTS_FILE, results.join('\n') + '\n');

  log(`=== Maintenance complete: ${actions} actions, ${warnings} warnings ===`);
  return { actions, warnings, results: [...results] };
}

// CLI entry point
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
if (isMain) {
  runMaintenance({ force: FORCE, dryRun: DRY_RUN })
    .then(r => {
      if (VERBOSE || DRY_RUN) {
        console.log(`\nDone: ${r.actions} actions, ${r.warnings} warnings`);
        if (r.results.length) console.log(r.results.join('\n'));
      }
      process.exit(r.warnings > 0 ? 1 : 0);
    })
    .catch(e => {
      console.error(`Fatal: ${e.message}`);
      process.exit(2);
    });
}
