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
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import http from 'http';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('memory-maintenance');

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const ARCHIVE_DIR = path.join(MEMORY_DIR, 'archive');
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

// 1. Daily file archival (>30 days → monthly summary)
function checkArchival() {
  log('Checking daily files for archival...');
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const now = new Date();
  const candidates = [];

  let files;
  try { files = fs.readdirSync(MEMORY_DIR); } catch { return; }

  for (const f of files) {
    const match = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!match) continue;
    const fileDate = new Date(match[1] + 'T00:00:00');
    if (isNaN(fileDate.getTime())) continue;
    const age = daysBetween(fileDate, now);
    if (age > 30) {
      candidates.push({ file: f, path: path.join(MEMORY_DIR, f), date: match[1], month: match[1].slice(0, 7), age });
      log(`Archive candidate: ${match[1]} (${age} days old)`);
    }
  }

  if (candidates.length === 0) return;

  // Group by month
  const months = {};
  for (const c of candidates) {
    (months[c.month] = months[c.month] || []).push(c);
  }

  for (const [month, files] of Object.entries(months)) {
    const summaryFile = path.join(ARCHIVE_DIR, `${month}-summary.md`);

    if (!DRY_RUN) {
      let content = '\n# Monthly Summary: ' + month + '\n';
      content += `Archived: ${timestamp()}\n\n`;

      for (const f of files) {
        const dailyContent = readFileOr(f.path);
        const firstLines = dailyContent.split('\n').slice(0, 50).join('\n');
        content += `## ${f.date}\n${firstLines}\n\n---\n\n`;
      }

      fs.appendFileSync(summaryFile, content);

      for (const f of files) {
        fs.renameSync(f.path, path.join(ARCHIVE_DIR, f.file));
        log(`Archived: ${f.file}`);
        actions++;
      }
    } else {
      log(`DRY RUN: Would archive ${files.length} files for ${month}`);
    }
  }

  report(`ARCHIVAL: ${candidates.length} daily files archived to memory/archive/`);
}

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
  log('Checking Mission Control for memory sync...');

  const isUp = await new Promise(resolve => {
    const req = http.get('http://localhost:3000/api/tasks', { timeout: 3000 }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (!isUp) { log('Mission Control not running — skipping'); return; }
  if (DRY_RUN) { log('DRY RUN: Would sync Mission Control'); return; }

  try {
    await new Promise((resolve, reject) => {
      const req = http.request('http://localhost:3000/api/memory/sync', { method: 'POST', timeout: 5000 }, res => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => { log(`MC memory sync: ${data.slice(0, 200)}`); resolve(); });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    actions++;
    report('MC_SYNC: Memory index refreshed');
  } catch (e) {
    log(`MC sync failed: ${e.message}`);
  }
}

// 8. Daily file creation
function checkDailyFile() {
  log('Checking daily file coverage...');
  const todayStr = today();
  const todayFile = path.join(MEMORY_DIR, `${todayStr}.md`);

  if (!fs.existsSync(todayFile)) {
    if (!DRY_RUN) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
      fs.writeFileSync(todayFile, `# ${todayStr} — Daily Log\n\n`);
      log(`Created today's daily file: ${todayStr}.md`);
      actions++;
    }
    report(`DAILY_CREATED: ${todayStr}.md created (was missing)`);
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
    const req = http.get('http://localhost:3000/api/tasks', { timeout: 3000 }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (!isUp) { log('MC not running — skipping consolidation'); return; }
  if (DRY_RUN) { log('DRY RUN: Would run consolidation'); return; }

  try {
    await new Promise((resolve, reject) => {
      const req = http.request('http://localhost:3000/api/memory/consolidate', { method: 'POST', timeout: 10000 }, res => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => {
          log(`Consolidation: ${data.slice(0, 200)}`);
          resolve();
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
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
    const req = http.get('http://localhost:3000/api/tasks', { timeout: 3000 }, res => {
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
      await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:3000/api/memory/graph', { method: 'POST', timeout: 5000 }, res => {
          let data = '';
          res.on('data', d => { data += d; });
          res.on('end', () => {
            log(`Graph seed: ${data.slice(0, 200)}`);
            resolve();
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
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

// ── Tracer wrapping ──────────────────────────────────
checkArchival = tracer.wrap('checkArchival', checkArchival, { tier: 2, category: 'compute' });
checkPredictions = tracer.wrap('checkPredictions', checkPredictions, { tier: 2, category: 'compute' });
checkStaleTasks = tracer.wrap('checkStaleTasks', checkStaleTasks, { tier: 2, category: 'compute' });

export async function runMaintenance(opts = {}) {
  const force = opts.force ?? FORCE;
  const dryRun = opts.dryRun ?? DRY_RUN;

  fs.mkdirSync(path.join(WORKSPACE, '.tmp'), { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

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

  checkArchival();
  checkPredictions();
  checkStaleTasks();
  checkMemoryFreshness();
  checkCompanionFreshness();
  await checkClawVault();
  await checkMissionControl();
  checkDailyFile();
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
