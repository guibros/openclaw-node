#!/usr/bin/env node
/**
 * daily-log-writer.mjs — Hourly auto-append to daily memory log.
 *
 * Runs from memory-daemon Phase 2 (clock-aligned, hourly).
 * Reads existing agnostic signals — session-recap, active-tasks, git diff —
 * and appends a timestamped block to memory/YYYY-MM-DD.md.
 *
 * Zero AI calls. Zero frontend dependencies. Pure file I/O.
 *
 * Signals (layered — uses whatever is available):
 *   1. last-session-recap.md  → conversation summary (any frontend)
 *   2. active-tasks.md        → task state changes
 *   3. git diff --stat        → file modifications
 *
 * Trigger: called by daemon when currentHour > lastWriteHour AND session active.
 * Dedup: state file tracks last recap hash + last task hash to avoid duplicate entries.
 *
 * Usage:
 *   node bin/daily-log-writer.mjs [--force] [--verbose] [--dry-run]
 */

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('daily-log-writer');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(new URL('.', import.meta.url).pathname);
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const RECAP_FILE = path.join(MEMORY_DIR, 'last-session-recap.md');
const ACTIVE_TASKS = path.join(MEMORY_DIR, 'active-tasks.md');
const COMPANION = path.join(WORKSPACE, '.companion-state.md');
const STATE_FILE = path.join(WORKSPACE, '.tmp/daily-log-state.json');
const TZ = 'America/Montreal';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const VERBOSE = args.includes('--verbose');
const DRY_RUN = args.includes('--dry-run');

function log(msg) { if (VERBOSE) console.log(`[daily-log] ${msg}`); }

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function currentHour() {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10);
}

function timestamp() {
  return new Date().toLocaleString('en-CA', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function hash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function readOr(p, fallback = '') {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return fallback; }
}

// --- State management ---

function loadState() {
  try { return JSON.parse(readOr(STATE_FILE, '{}')); } catch { return {}; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Session active check ---

function isSessionActive() {
  if (!fs.existsSync(COMPANION)) return false;
  const stat = fs.statSync(COMPANION);
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs < 300000; // updated within last 5 minutes
}

// --- Signal: session recap (conversation) ---

function getRecapDelta(state) {
  const content = readOr(RECAP_FILE);
  if (!content) return null;

  const contentHash = hash(content);
  if (contentHash === state.lastRecapHash) return null; // no change

  // Extract conversation lines (skip headers, separators)
  const lines = content.split('\n')
    .filter(l => l.startsWith('- **'))
    .map(l => l.replace(/^-\s*\*\*(Gui|Daedalus)\*\*:\s*/, '$1: ').trim())
    .map(l => {
      // Strip gateway metadata noise
      l = l.replace(/Sender \(untrusted metadata\):\s*```json\s*\{[^}]*\}\s*```\s*/g, '');
      l = l.replace(/\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/g, '');
      // Strip leading "- " if recap already included bullet
      l = l.replace(/^- /, '');
      return l.trim();
    })
    .filter(l => l.length > 5);

  return { lines, contentHash };
}

// --- Signal: task state changes ---

function getTaskDelta(state) {
  const content = readOr(ACTIVE_TASKS);
  if (!content) return null;

  const contentHash = hash(content);
  if (contentHash === state.lastTaskHash) return null;

  // Extract running/waiting-user/blocked tasks
  const tasks = [];
  const blocks = content.split(/(?=^- task_id:)/m);
  for (const block of blocks) {
    const statusMatch = block.match(/status:\s*(running|waiting-user|blocked|done)/);
    const titleMatch = block.match(/title:\s*"?(.+?)"?\s*$/m);
    if (statusMatch && titleMatch) {
      tasks.push({ title: titleMatch[1], status: statusMatch[1] });
    }
  }

  return { tasks, contentHash };
}

// --- Signal: git diff ---

function getGitDelta() {
  try {
    const diff = execSync('git diff --stat HEAD 2>/dev/null || true', {
      cwd: WORKSPACE, encoding: 'utf-8', timeout: 5000,
    }).trim();
    if (!diff) return null;

    // Extract just the file list
    const files = diff.split('\n')
      .filter(l => l.includes('|'))
      .map(l => l.split('|')[0].trim())
      .filter(Boolean);

    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

// --- Main ---

function run() {
  const state = loadState();
  const hour = currentHour();

  // Clock-aligned: only write once per hour
  if (!FORCE && state.lastWriteHour === hour && state.lastWriteDate === today()) {
    log('Already wrote this hour — skipping');
    return;
  }

  // Session must be active
  if (!FORCE && !isSessionActive()) {
    log('No active session — skipping');
    return;
  }

  // Gather signals
  const recap = getRecapDelta(state);
  const tasks = getTaskDelta(state);
  const gitFiles = getGitDelta();

  // If nothing changed across all signals, skip
  if (!recap && !tasks && !gitFiles) {
    log('No changes detected — skipping');
    // Still update the hour so we don't re-check this hour
    state.lastWriteHour = hour;
    state.lastWriteDate = today();
    saveState(state);
    return;
  }

  // Build the log entry
  const lines = [`## Auto-log — ${timestamp()} EST`];

  if (recap && recap.lines.length > 0) {
    lines.push('### Conversation');
    // Take last 8 lines to keep it concise
    const recent = recap.lines.slice(-8);
    for (const l of recent) {
      lines.push(`- ${l}`);
    }
  }

  if (tasks && tasks.tasks.length > 0) {
    const running = tasks.tasks.filter(t => t.status === 'running');
    const done = tasks.tasks.filter(t => t.status === 'done');
    const blocked = tasks.tasks.filter(t => t.status === 'blocked');
    const waiting = tasks.tasks.filter(t => t.status === 'waiting-user');

    lines.push('### Task State');
    if (running.length) lines.push(`- Running: ${running.map(t => t.title).join(', ')}`);
    if (waiting.length) lines.push(`- Review: ${waiting.slice(0, 5).map(t => t.title).join(', ')}${waiting.length > 5 ? ` (+${waiting.length - 5} more)` : ''}`);
    if (blocked.length) lines.push(`- Blocked: ${blocked.map(t => t.title).join(', ')}`);
    if (done.length) lines.push(`- Done: ${done.length} tasks`);
  }

  if (gitFiles && gitFiles.length > 0) {
    lines.push('### Files Modified');
    for (const f of gitFiles.slice(0, 10)) {
      lines.push(`- ${f}`);
    }
    if (gitFiles.length > 10) lines.push(`- ... +${gitFiles.length - 10} more`);
  }

  lines.push('');
  const entry = lines.join('\n');

  // Write to daily log
  const todayStr = today();
  const dailyFile = path.join(MEMORY_DIR, `${todayStr}.md`);

  if (DRY_RUN) {
    console.log(`DRY RUN — would append to ${dailyFile}:\n${entry}`);
  } else {
    // Create daily file if needed
    if (!fs.existsSync(dailyFile)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
      fs.writeFileSync(dailyFile, `# ${todayStr} — Daily Log\n\n`);
    }
    fs.appendFileSync(dailyFile, entry + '\n');
    log(`Appended to ${dailyFile}`);
  }

  // Update state
  state.lastWriteHour = hour;
  state.lastWriteDate = todayStr;
  if (recap) state.lastRecapHash = recap.contentHash;
  if (tasks) state.lastTaskHash = tasks.contentHash;
  saveState(state);

  if (VERBOSE || DRY_RUN) console.log('Done.');
}

run();
