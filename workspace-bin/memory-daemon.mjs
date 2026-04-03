#!/usr/bin/env node
/**
 * memory-daemon.mjs — OpenClaw platform-level memory lifecycle daemon (v3)
 *
 * Long-running Node.js process that detects activity from ANY frontend
 * by polling JSONL transcript mtimes. No touchfiles. No hooks required.
 *
 * Session lifecycle: ENDED → BOOT → ACTIVE → IDLE → ENDED
 *
 * Phases:
 *   0. Session-start bootstrap (once per new session)
 *      - Freezes MEMORY.md snapshot (memory-budget)
 *      - Imports sessions into SQLite archive (session-store)
 *   1. Status sync (every tick when active, ~5ms)
 *   2. Throttled background work (recap 10min, maintenance 30min,
 *      obsidian-sync 30min, trust-health 30min, session-import 10min)
 *
 * v3 additions (Hermes-inspired):
 *   - Pre-compression memory flush (durable fact extraction before context loss)
 *   - MEMORY.md character budget with frozen session snapshots
 *   - SQLite session archive with FTS5 for episodic recall
 *
 * Install: bin/install-daemon (detects OS, sets up launchd/systemd/pm2)
 * Manual:  node bin/memory-daemon.mjs [--test] [--verbose]
 */

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('memory-daemon');

// --- Hermes-inspired modules ---
import { shouldFlush, runFlush } from '../lib/pre-compression-flush.mjs';
import { createBudget } from '../lib/memory-budget.mjs';
import { createSessionTraceEmitter } from './session-trace-emitter.mjs';

const traceEmitter = createSessionTraceEmitter(tracer);

// Session store loaded lazily (requires better-sqlite3)
let _sessionStore = null;
async function getSessionStore() {
  if (_sessionStore) return _sessionStore;
  try {
    const { SessionStore } = await import('../lib/session-store.mjs');
    _sessionStore = new SessionStore();
    console.log('[memory-daemon] Session store initialized');
    return _sessionStore;
  } catch (err) {
    log(`session-store unavailable: ${err.message}`);
    return null;
  }
}

// HyperAgent store loaded lazily (requires better-sqlite3)
let _haStore = null;
async function getHyperAgentStore() {
  if (_haStore) return _haStore;
  try {
    const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
    _haStore = createHyperAgentStore();
    console.log('[memory-daemon] HyperAgent store initialized');
    return _haStore;
  } catch (err) {
    log(`hyperagent-store unavailable: ${err.message}`);
    return null;
  }
}

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, '.openclaw/config/daemon.json');
const TRANSCRIPT_REGISTRY = path.join(HOME, '.openclaw/config/transcript-sources.json');

function loadConfig() {
  const defaults = {
    nodeId: 'daedalus',
    workspace: WORKSPACE,
    timezone: 'America/Montreal',
    intervals: {
      pollMs: 30000,
      activityWindowMs: 900000,   // 15 min
      activeThresholdMs: 300000,  // 5 min
      idleThresholdMs: 900000,    // 15 min
      sessionRecapMs: 600000,     // 10 min
      maintenanceMs: 1800000,     // 30 min
      obsidianSyncMs: 1800000,    // 30 min
    },
    contextWindowTokens: 200000,     // active model's context window (override per LLM)
    memoryCharBudget: 2200,           // MEMORY.md character cap
    clawvaultBin: 'bin/clawvault-local',
    obsidianVault: 'projects/arcane-vault',
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const merged = {
        ...defaults,
        ...loaded,
        intervals: { ...defaults.intervals, ...loaded.intervals },
      };
      console.log(`[memory-daemon] Config loaded from ${CONFIG_PATH}`);
      return merged;
    } catch (err) { console.warn(`[memory-daemon] config parse failed: ${err.message}`); }
  }
  console.log('[memory-daemon] Using default config');
  return defaults;
}

function resolvePath(p) {
  if (p.startsWith('~')) return path.join(HOME, p.slice(1));
  return p;
}

// ============================================================
// LOGGING
// ============================================================

const STATE_DIR = path.join(WORKSPACE, '.tmp');
const LOG_FILE = path.join(STATE_DIR, 'memory-daemon.log');
const VERBOSE = process.argv.includes('--verbose');
const TEST_MODE = process.argv.includes('--test');

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, 'active-sessions'), { recursive: true });
}

function timestamp() {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* Intentional: ignore log write failures to avoid recursion */ }
  if (VERBOSE) console.log(line);
}

// ============================================================
// TRANSCRIPT SOURCE REGISTRY
// ============================================================

function loadTranscriptSources() {
  if (fs.existsSync(TRANSCRIPT_REGISTRY)) {
    try {
      const reg = JSON.parse(fs.readFileSync(TRANSCRIPT_REGISTRY, 'utf-8'));
      return (reg.sources || [])
        .filter(s => s.enabled !== false)
        .map(s => ({ ...s, path: resolvePath(s.path) }));
    } catch (err) { console.warn(`[memory-daemon] transcript registry parse failed: ${err.message}`); }
  }

  // Legacy fallback: derive Claude Code paths from workspace
  const workspaceAbs = fs.realpathSync(WORKSPACE);
  const slug = workspaceAbs.replace(/[/.]/g, '-');
  return [
    { name: 'claude-code', path: path.join(HOME, '.claude/projects', slug), format: 'claude-code' },
    { name: 'claude-home', path: path.join(HOME, '.claude/projects', '-' + path.basename(HOME)), format: 'claude-code' },
    { name: 'gateway', path: path.join(HOME, '.openclaw/agents/main/sessions'), format: 'openclaw-gateway' },
  ];
}

// ============================================================
// ACTIVITY DETECTION
// Polls JSONL mtimes from registered transcript sources.
// No touchfiles. No hooks. The JSONL write IS the heartbeat.
// ============================================================

function _detectActivity(sources, activityWindowMs) {
  const now = Date.now();
  const cutoff = now - activityWindowMs;
  let active = false;
  let newestSession = null;
  let newestMtime = 0;
  let newestSource = null;
  let newestFormat = null;

  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;

    let files;
    try {
      files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
    } catch (err) { console.warn(`[memory-daemon] session readdir failed for ${source.path}: ${err.message}`); continue; }

    for (const f of files) {
      const full = path.join(source.path, f);
      try {
        const stat = fs.statSync(full);
        const mtime = stat.mtimeMs;
        if (mtime > cutoff) active = true;
        if (mtime > newestMtime) {
          newestMtime = mtime;
          newestSession = path.basename(f, '.jsonl');
          newestSource = source.name;
          newestFormat = source.format || null;
        }
      } catch (err) { console.warn(`[memory-daemon] session file stat failed for ${full}: ${err.message}`); continue; }
    }
  }

  const result = { active, newestSession, newestMtime, newestSource, newestFormat };
  if (process.env.OPENCLAW_LOG_LEVEL === 'debug') {
    const ageMs = newestMtime ? Math.round(Date.now() - newestMtime) : -1;
    console.log(`[memory-daemon] Activity: source=${newestSource || 'none'} age=${ageMs}ms`);
  }
  return result;
}
const detectActivity = tracer.wrap('detectActivity', _detectActivity, { tier: 1 });

// ============================================================
// SESSION STATE MACHINE
// ENDED → BOOT → ACTIVE → IDLE → ENDED
// ============================================================

const STATES = { ENDED: 'ENDED', BOOT: 'BOOT', ACTIVE: 'ACTIVE', IDLE: 'IDLE' };

class SessionStateMachine {
  #state = STATES.ENDED;
  #sessionId = null;
  #lastActivityTime = 0;
  #bootStartTime = 0;
  #config;

  constructor(config) {
    this.#config = config;
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get lastActivityTime() { return this.#lastActivityTime; }

  tick(activity) {
    const now = Date.now();
    const transitions = [];

    if (activity.active) {
      this.#lastActivityTime = now;
    }

    const timeSinceActivity = now - this.#lastActivityTime;
    const isNewSession = activity.newestSession
      && activity.newestSession !== this.#sessionId
      && activity.active;

    switch (this.#state) {
      case STATES.ENDED:
        if (activity.active) {
          this.#sessionId = activity.newestSession;
          this.#state = STATES.BOOT;
          this.#bootStartTime = now;
          transitions.push({ from: STATES.ENDED, to: STATES.BOOT, sessionId: this.#sessionId });
        }
        break;

      case STATES.BOOT:
        // Boot is transient — completeBoot() transitions to ACTIVE
        // Safety: force to ACTIVE if boot takes >60s
        if (now - this.#bootStartTime > 60000) {
          this.#state = STATES.ACTIVE;
          transitions.push({ from: STATES.BOOT, to: STATES.ACTIVE, sessionId: this.#sessionId });
        }
        break;

      case STATES.ACTIVE:
        if (isNewSession) {
          // New session while active — end current, boot new
          transitions.push({ from: STATES.ACTIVE, to: STATES.ENDED, sessionId: this.#sessionId });
          this.#sessionId = activity.newestSession;
          this.#state = STATES.BOOT;
          this.#bootStartTime = now;
          transitions.push({ from: STATES.ENDED, to: STATES.BOOT, sessionId: this.#sessionId });
        } else if (timeSinceActivity > this.#config.intervals.activeThresholdMs) {
          this.#state = STATES.IDLE;
          transitions.push({ from: STATES.ACTIVE, to: STATES.IDLE, sessionId: this.#sessionId });
        }
        break;

      case STATES.IDLE:
        if (isNewSession) {
          transitions.push({ from: STATES.IDLE, to: STATES.ENDED, sessionId: this.#sessionId });
          this.#sessionId = activity.newestSession;
          this.#state = STATES.BOOT;
          this.#bootStartTime = now;
          transitions.push({ from: STATES.ENDED, to: STATES.BOOT, sessionId: this.#sessionId });
        } else if (activity.active && timeSinceActivity < this.#config.intervals.activeThresholdMs) {
          this.#state = STATES.ACTIVE;
          transitions.push({ from: STATES.IDLE, to: STATES.ACTIVE, sessionId: this.#sessionId });
        } else if (timeSinceActivity > this.#config.intervals.idleThresholdMs) {
          this.#state = STATES.ENDED;
          transitions.push({ from: STATES.IDLE, to: STATES.ENDED, sessionId: this.#sessionId });
          this.#sessionId = null;
        }
        break;
    }

    return transitions;
  }

  completeBoot() {
    if (this.#state === STATES.BOOT) {
      this.#state = STATES.ACTIVE;
      return { from: STATES.BOOT, to: STATES.ACTIVE, sessionId: this.#sessionId };
    }
    return null;
  }

  // Restore state from daemon-state.json after crash/restart
  restore(saved) {
    if (saved && saved.state && STATES[saved.state]) {
      this.#state = saved.state;
      this.#sessionId = saved.sessionId || null;
      this.#lastActivityTime = saved.lastActivityTime || 0;
    }
  }
}

// ============================================================
// MEMORY BUDGET (Hermes-inspired frozen snapshot)
// ============================================================

let memoryBudget = null;

function initMemoryBudget(config) {
  if (memoryBudget) return memoryBudget;
  memoryBudget = createBudget(config.workspace || WORKSPACE, {
    charBudget: config.memoryCharBudget || 2200,
  });

  memoryBudget.on('add', ({ entry, pctUsed, charsRemaining }) => {
    log(`  [memory] +added (${pctUsed}% used, ${charsRemaining} chars free)`);
  });
  memoryBudget.on('warning', ({ pctUsed, message }) => {
    log(`  [memory] WARNING: ${message}`);
  });
  memoryBudget.on('trim', ({ removed }) => {
    log(`  [memory] trimmed: ${removed.slice(0, 60)}...`);
  });

  return memoryBudget;
}

// ============================================================
// PHASE 0: SESSION-START BOOTSTRAP
// ============================================================

async function runPhase0Bootstrap(sessionId, config) {
  log(`Phase 0: Bootstrap for session ${sessionId?.slice(0, 8) || 'unknown'}`);

  const recap = path.join(WORKSPACE, 'bin/session-recap');
  const clawvault = path.join(WORKSPACE, config.clawvaultBin);
  const compileBoot = path.join(WORKSPACE, 'bin/compile-boot');
  const maintenance = path.join(WORKSPACE, 'bin/memory-maintenance.mjs');
  const subagentAudit = path.join(WORKSPACE, 'bin/subagent-audit.mjs');
  const memoryDir = path.join(WORKSPACE, 'memory');

  // 1. Session recap of previous session
  if (fs.existsSync(recap)) {
    try {
      await runSubprocess('node', [recap, '--previous'], 30000);
      log('  session-recap --previous done');
    } catch (e) { log(`  session-recap --previous failed: ${e.message}`); }
  }

  // 2. ClawVault wake
  if (fs.existsSync(clawvault)) {
    try {
      await runSubprocess(clawvault, ['wake'], 15000);
      log('  clawvault wake done');
    } catch (e) { log(`  clawvault wake failed: ${e.message}`); }
  }

  // 3. Ensure today's daily file exists
  const today = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
  const todayFile = path.join(memoryDir, `${today}.md`);
  if (!fs.existsSync(todayFile)) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(todayFile, `# ${today} — Daily Log\n\n`);
    log(`  created daily file: ${today}.md`);
  }

  // 4. Run maintenance (force)
  if (fs.existsSync(maintenance)) {
    try {
      await runSubprocess('node', [maintenance, '--force'], 60000);
      log('  memory-maintenance --force done');
    } catch (e) { log(`  memory-maintenance failed: ${e.message}`); }
  }

  // 5. Compile boot artifacts
  if (fs.existsSync(compileBoot)) {
    try {
      // Use /usr/bin/python3 explicitly — Homebrew python lacks pyyaml
      const py = fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
      await runSubprocess(py, [compileBoot, '--all'], 30000);
      log('  compile-boot done');
    } catch (e) { log(`  compile-boot failed: ${e.message}`); }
  }

  // 6. Sub-agent audit of previous session
  if (fs.existsSync(subagentAudit)) {
    try {
      // Find the previous session's JSONL
      const sources = loadTranscriptSources();
      const prevJsonl = findPreviousJsonl(sources);
      if (prevJsonl) {
        await runSubprocess('node', [subagentAudit, prevJsonl], 30000);
        log(`  subagent-audit done on ${path.basename(prevJsonl).slice(0, 8)}`);
      }
    } catch (e) { log(`  subagent-audit failed: ${e.message}`); }
  }

  // 7. ClawVault observe — compress recent sessions into observational memory
  if (fs.existsSync(clawvault)) {
    try {
      await runSubprocess(clawvault, ['observe', '--cron'], 60000);
      log('  clawvault observe done');
    } catch (e) { log(`  clawvault observe failed: ${e.message}`); }
  }

  // 8. ClawVault doctor — vault health check + auto-fix
  if (fs.existsSync(clawvault)) {
    try {
      await runSubprocess(clawvault, ['doctor', '--fix'], 30000);
      log('  clawvault doctor done');
    } catch (e) { log(`  clawvault doctor failed: ${e.message}`); }
  }

  // 9. Freeze MEMORY.md snapshot for deterministic prompt content
  try {
    const budget = initMemoryBudget(config);
    budget.startSession();
    const stats = budget.getStats();
    log(`  memory-budget frozen ${stats.meterDisplay}`);
  } catch (e) { log(`  memory-budget freeze failed: ${e.message}`); }

  // 10. Import recent sessions into SQLite archive
  try {
    const store = await getSessionStore();
    if (store) {
      const sources = loadTranscriptSources();
      let totalImported = 0;
      for (const source of sources) {
        if (!fs.existsSync(source.path)) continue;
        const result = await store.importDirectory(source.path, { source: source.name, format: source.format });
        totalImported += result.imported;
      }
      if (totalImported > 0) log(`  session-store: imported ${totalImported} sessions`);
    }
  } catch (e) { log(`  session-store import failed: ${e.message}`); }

  log('Phase 0: Bootstrap complete');
}

function findPreviousJsonl(sources) {
  const all = [];
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    try {
      const files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const full = path.join(source.path, f);
        try {
          const stat = fs.statSync(full);
          if (stat.size < 50 * 1024) continue; // skip tiny
          all.push({ path: full, mtime: stat.mtimeMs });
        } catch (err) { console.warn(`[memory-daemon] prev jsonl stat failed for ${full}: ${err.message}`); continue; }
      }
    } catch (err) { console.warn(`[memory-daemon] prev jsonl readdir failed for ${source.path}: ${err.message}`); continue; }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  return all.length > 1 ? all[1].path : null; // second most recent = previous
}

function findCurrentJsonl(sources) {
  const all = [];
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    try {
      const files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const full = path.join(source.path, f);
        try {
          const stat = fs.statSync(full);
          if (stat.size < 50 * 1024) continue;
          all.push({ path: full, mtime: stat.mtimeMs });
        } catch (err) { console.warn(`[memory-daemon] current jsonl stat failed for ${full}: ${err.message}`); continue; }
      }
    } catch (err) { console.warn(`[memory-daemon] current jsonl readdir failed for ${source.path}: ${err.message}`); continue; }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  return all.length > 0 ? all[0].path : null; // most recent = current
}

// ============================================================
// PHASE 1: STATUS SYNC
// Updates .companion-state.md from active-tasks.md (~5ms)
// ============================================================

function runPhase1StatusSync(config) {
  const activeTasks = path.join(WORKSPACE, 'memory/active-tasks.md');
  const companion = path.join(WORKSPACE, '.companion-state.md');

  let runningTasks = 'Standing by';
  let runningCount = 0;
  let doneCount = 0;

  if (fs.existsSync(activeTasks)) {
    try {
      const content = fs.readFileSync(activeTasks, 'utf-8');
      const lines = content.split('\n');

      // Extract running task titles
      const running = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('status: running')) {
          // Look backwards for the title
          for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            const titleMatch = lines[j].match(/title:\s*"?(.+?)"?\s*$/);
            if (titleMatch) {
              running.push(titleMatch[1]);
              break;
            }
          }
        }
      }

      runningCount = (content.match(/status: running/g) || []).length;
      doneCount = (content.match(/status: done/g) || []).length;

      if (running.length > 0) {
        runningTasks = running.slice(0, 3).join('\n');
      }
    } catch (err) { console.warn(`[memory-daemon] active-tasks read failed: ${err.message}`); }
  }

  const now = new Date().toLocaleString('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(', ', 'T').replace(/\//g, '-');

  // Preserve started_at from existing companion state
  let startedAt = now;
  if (fs.existsSync(companion)) {
    try {
      const existing = fs.readFileSync(companion, 'utf-8');
      const match = existing.match(/started_at:\s*(.+)/);
      if (match) startedAt = match[1].trim();
    } catch (err) { console.warn(`[memory-daemon] companion-state read failed: ${err.message}`); }
  }

  const output = `## Session Status
status: active
started_at: ${startedAt}
last_flush: ${now}

## Active Task
${runningTasks}

## Current State
${runningCount} running, ${doneCount} done

## Crash Recovery
If this file says \`status: active\` but the session is dead:
1. The session crashed before flush
2. Read memory/active-tasks.md for last known work state
3. Resume from the active task listed above
`;

  let previousContent = '';
  try { previousContent = fs.readFileSync(companion, 'utf-8'); } catch {}
  fs.writeFileSync(companion, output);
  if (output !== previousContent) {
    console.log('[memory-daemon] Companion state updated');
  }
}

// ============================================================
// PHASE 2: THROTTLED BACKGROUND WORK
// ============================================================

const THROTTLE_STATE_FILE = path.join(STATE_DIR, 'daemon-throttle.json');

function loadThrottleState() {
  if (fs.existsSync(THROTTLE_STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(THROTTLE_STATE_FILE, 'utf-8'));
    } catch (err) { console.warn(`[memory-daemon] throttle state parse failed: ${err.message}`); }
  }
  return {
    lastRecap: 0, lastMaintenance: 0, lastObsidianSync: 0, lastTrustHealth: 0,
    lastClawvaultReflect: 0, lastClawvaultArchive: 0, lastClawvaultObserve: 0,
    lastSessionImport: 0, lastHyperagentReflect: 0,
  };
}

function saveThrottleState(state) {
  fs.writeFileSync(THROTTLE_STATE_FILE, JSON.stringify(state, null, 2));
}

async function runPhase2ThrottledWork(config) {
  const now = Date.now();
  const throttle = loadThrottleState();

  // Stage 1: Parallel — recap, maintenance, trust-health, ClawVault observe/reflect/archive
  // These produce data. They run before Obsidian sync so fresh data gets pushed.
  const stage1 = [];

  // Session recap (every 10min)
  if (now - throttle.lastRecap >= config.intervals.sessionRecapMs) {
    throttle.lastRecap = now;
    const recap = path.join(WORKSPACE, 'bin/session-recap');
    if (fs.existsSync(recap)) {
      stage1.push(
        runSubprocess('node', [recap], 30000)
          .then(() => log('  Phase 2: session-recap done'))
          .catch(e => log(`  Phase 2: session-recap failed: ${e.message}`))
      );
    }
  }

  // Memory maintenance (every 30min)
  if (now - throttle.lastMaintenance >= config.intervals.maintenanceMs) {
    throttle.lastMaintenance = now;
    const maint = path.join(WORKSPACE, 'bin/memory-maintenance.mjs');
    if (fs.existsSync(maint)) {
      stage1.push(
        runSubprocess('node', [maint], 60000)
          .then(() => log('  Phase 2: memory-maintenance done'))
          .catch(e => log(`  Phase 2: memory-maintenance failed: ${e.message}`))
      );
    }
  }

  // Trust registry health check (every 30min)
  if (now - throttle.lastTrustHealth >= config.intervals.maintenanceMs) {
    throttle.lastTrustHealth = now;
    const audit = path.join(WORKSPACE, 'bin/subagent-audit.mjs');
    if (fs.existsSync(audit)) {
      stage1.push(
        runSubprocess('node', [audit, '--health-check'], 15000)
          .then(() => log('  Phase 2: trust-health done'))
          .catch(e => log(`  Phase 2: trust-health failed: ${e.message}`))
      );
    }
  }

  // Session archive import — incremental (every 10min, aligned with recap)
  if (now - throttle.lastSessionImport >= config.intervals.sessionRecapMs) {
    throttle.lastSessionImport = now;
    stage1.push(
      (async () => {
        try {
          const store = await getSessionStore();
          if (!store) return;
          const sources = loadTranscriptSources();
          let totalImported = 0;
          for (const source of sources) {
            if (!fs.existsSync(source.path)) continue;
            const result = await store.importDirectory(source.path, { source: source.name, format: source.format });
            totalImported += result.imported;
          }
          if (totalImported > 0) log(`  Phase 2: session-store imported ${totalImported} sessions`);
        } catch (e) { log(`  Phase 2: session-import failed: ${e.message}`); }
      })()
    );
  }

  // HyperAgent: reflection check + shadow window expiry (every 30min)
  if (now - throttle.lastHyperagentReflect >= (config.intervals.hyperagentReflectMs || 1800000)) {
    throttle.lastHyperagentReflect = now;
    stage1.push(
      (async () => {
        try {
          const ha = await getHyperAgentStore();
          if (!ha) return;
          const unreflected = ha.getUnreflectedCount(); // sync — better-sqlite3
          if (unreflected >= 5) {
            await runSubprocess('node', [
              path.join(HOME, '.openclaw/bin/hyperagent.mjs'), 'reflect'
            ], 30000);
            log(`  Phase 2: hyperagent reflect (${unreflected} entries)`);
          }
          ha.checkShadowWindows(); // sync
        } catch (e) { log(`  Phase 2: hyperagent failed: ${e.message}`); }
      })()
    );
  }

  const clawvault = path.join(WORKSPACE, config.clawvaultBin);
  if (fs.existsSync(clawvault)) {
    // ClawVault observe — incremental session compression (every 10min)
    if (now - throttle.lastClawvaultObserve >= config.intervals.sessionRecapMs) {
      throttle.lastClawvaultObserve = now;
      stage1.push(
        runSubprocess(clawvault, ['observe', '--cron'], 60000)
          .then(() => log('  Phase 2: clawvault observe done'))
          .catch(e => log(`  Phase 2: clawvault observe failed: ${e.message}`))
      );
    }

    // ClawVault reflect — promote stable observations to reflections (every 30min)
    if (now - throttle.lastClawvaultReflect >= config.intervals.maintenanceMs) {
      throttle.lastClawvaultReflect = now;
      stage1.push(
        runSubprocess(clawvault, ['reflect'], 60000)
          .then(() => log('  Phase 2: clawvault reflect done'))
          .catch(e => log(`  Phase 2: clawvault reflect failed: ${e.message}`))
      );
    }

    // ClawVault archive — move old observations to ledger (every 30min)
    if (now - throttle.lastClawvaultArchive >= config.intervals.maintenanceMs) {
      throttle.lastClawvaultArchive = now;
      stage1.push(
        runSubprocess(clawvault, ['archive'], 30000)
          .then(() => log('  Phase 2: clawvault archive done'))
          .catch(e => log(`  Phase 2: clawvault archive failed: ${e.message}`))
      );
    }
  }

  // Daily log writer — clock-aligned hourly (runs after recap so recap is fresh)
  const dailyLogWriter = path.join(WORKSPACE, 'bin/daily-log-writer.mjs');
  if (fs.existsSync(dailyLogWriter)) {
    const currentHour = new Date().getHours();
    if (currentHour !== throttle.lastDailyLogHour) {
      throttle.lastDailyLogHour = currentHour;
      stage1.push(
        runSubprocess('node', [dailyLogWriter], 15000)
          .then(() => log('  Phase 2: daily-log-writer done'))
          .catch(e => log(`  Phase 2: daily-log-writer failed: ${e.message}`))
      );
    }
  }

  if (stage1.length > 0) {
    await Promise.allSettled(stage1);
  }

  // Stage 2: Obsidian sync — runs AFTER stage 1 so fresh ClawVault data,
  // trust-registry updates, and recaps are all picked up and pushed to vault.
  if (now - throttle.lastObsidianSync >= config.intervals.obsidianSyncMs) {
    throttle.lastObsidianSync = now;
    const obsSync = path.join(WORKSPACE, 'bin/obsidian-sync.mjs');
    if (fs.existsSync(obsSync)) {
      await runSubprocess('node', [obsSync], 60000)
        .then(() => log('  Phase 2: obsidian-sync done'))
        .catch(e => log(`  Phase 2: obsidian-sync failed: ${e.message}`));
    }
  }

  // Always persist throttle timestamps (Obsidian sync updates outside stage1)
  saveThrottleState(throttle);
}

// ============================================================
// TRANSITION HANDLERS
// Actions triggered by state machine transitions
// ============================================================

async function handleTransitions(transitions, config) {
  for (const t of transitions) {
    log(`State: ${t.from} → ${t.to} (session: ${t.sessionId?.slice(0, 8) || '?'})`);

    // ACTIVE → ENDED: Quick cleanup before session switch
    if (t.from === STATES.ACTIVE && t.to === STATES.ENDED) {
      log('Session switched while active — running quick cleanup');
      const recap = path.join(WORKSPACE, 'bin/session-recap');
      const clawvault = path.join(WORKSPACE, config.clawvaultBin);
      const tasks = [];
      if (fs.existsSync(recap)) {
        tasks.push(runSubprocess('node', [recap], 15000).catch(() => {}));
      }
      if (fs.existsSync(clawvault)) {
        tasks.push(runSubprocess(clawvault, ['observe', '--cron'], 30000).catch(() => {}));
      }
      if (tasks.length > 0) await Promise.allSettled(tasks);
    }

    // ENDED → BOOT: Full bootstrap
    if (t.from === STATES.ENDED && t.to === STATES.BOOT) {
      await runPhase0Bootstrap(t.sessionId, config);
      return STATES.ACTIVE; // signal to complete boot
    }

    // ACTIVE → IDLE: Observe + recap + checkpoint + pre-compression flush
    if (t.from === STATES.ACTIVE && t.to === STATES.IDLE) {
      log('Entering idle — running observe + recap + checkpoint + flush');
      const recap = path.join(WORKSPACE, 'bin/session-recap');
      const clawvault = path.join(WORKSPACE, config.clawvaultBin);

      // Pre-compression flush: extract durable facts before context may be lost
      const sources = loadTranscriptSources();
      const currentJsonl = findCurrentJsonl(sources);
      if (currentJsonl) {
        try {
          const flushCheck = await shouldFlush(currentJsonl, {
            contextWindowTokens: config.contextWindowTokens || 200000,
          });
          if (flushCheck.shouldFlush) {
            log(`  pre-compression flush triggered (${flushCheck.pctUsed}% of ${flushCheck.threshold} token threshold)`);
            const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
            const budget = initMemoryBudget(config);
            const result = await runFlush(currentJsonl, memoryMd, {
              charBudget: budget.charBudget,
            });
            log(`  flush: ${result.facts} facts found, ${result.added} added, ${result.merged} merged, ${result.skipped} skipped`);
          }
        } catch (e) { log(`  pre-compression flush failed: ${e.message}`); }
      }

      const tasks = [];
      if (fs.existsSync(recap)) {
        tasks.push(runSubprocess('node', [recap], 30000).catch(() => {}));
      }
      if (fs.existsSync(clawvault)) {
        tasks.push(runSubprocess(clawvault, ['observe', '--cron'], 60000).catch(() => {}));
        tasks.push(runSubprocess(clawvault, ['checkpoint', '--working-on', 'idle'], 15000).catch(() => {}));
      }
      await Promise.allSettled(tasks);
    }

    // IDLE → ENDED: Full cleanup pipeline
    if (t.from === STATES.IDLE && t.to === STATES.ENDED) {
      traceEmitter.reset();
      log('Session ended — running full cleanup pipeline');
      const clawvault = path.join(WORKSPACE, config.clawvaultBin);
      const obsSync = path.join(WORKSPACE, 'bin/obsidian-sync.mjs');
      const subagentAudit = path.join(WORKSPACE, 'bin/subagent-audit.mjs');

      // 0. Pre-compression flush (final chance to capture facts)
      const sources = loadTranscriptSources();
      const currentJsonl = findCurrentJsonl(sources);
      if (currentJsonl) {
        try {
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await runFlush(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
          });
          if (result.added > 0 || result.merged > 0) {
            log(`  end-of-session flush: ${result.added} added, ${result.merged} merged`);
          }
        } catch (e) { log(`  end-of-session flush failed: ${e.message}`); }
      }

      // 0b. Archive current session to SQLite
      if (currentJsonl) {
        try {
          const store = await getSessionStore();
          if (store) {
            // Detect which transcript source this JSONL came from
            const activity = detectActivity(loadTranscriptSources(), config.intervals.activityWindowMs);
            const result = await store.importSession(currentJsonl, {
              source: activity.newestSource || 'unknown',
              format: activity.newestFormat,
            });
            if (result.imported) {
              log(`  session-store: archived ${result.sessionId.slice(0, 8)} (${result.messageCount} msgs)`);
            }
          }
        } catch (e) { log(`  session-store archive failed: ${e.message}`); }
      }

      // 0c. Release frozen MEMORY.md snapshot
      if (memoryBudget) {
        memoryBudget.endSession();
        log('  memory-budget: snapshot released');
      }

      // 1. ClawVault: final observe + reflect + archive → persist all learnings
      if (fs.existsSync(clawvault)) {
        await runSubprocess(clawvault, ['observe', '--cron'], 60000).catch(() => {});
        await runSubprocess(clawvault, ['reflect'], 60000).catch(() => {});
        await runSubprocess(clawvault, ['archive'], 30000).catch(() => {});
        log('  clawvault observe+reflect+archive done');
      }

      // 2. Sub-agent audit — extract trust data from this session
      if (fs.existsSync(subagentAudit)) {
        const sources = loadTranscriptSources();
        const currentJsonl = findCurrentJsonl(sources);
        if (currentJsonl) {
          await runSubprocess('node', [subagentAudit, currentJsonl], 30000).catch(() => {});
          log('  subagent-audit (end-of-session) done');
        }
      }

      // 3. Final Obsidian sync — push all changes including new ClawVault data
      if (fs.existsSync(obsSync)) {
        await runSubprocess('node', [obsSync], 60000).catch(() => {});
        log('  final obsidian-sync done');
      }

      // 4. ClawVault sleep — handoff + clean exit
      if (fs.existsSync(clawvault)) {
        await runSubprocess(clawvault, ['sleep', 'session ended'], 15000).catch(() => {});
        log('  clawvault sleep done');
      }
    }
  }
  return null;
}

// ============================================================
// SUBPROCESS RUNNER
// ============================================================

function runSubprocess(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        OPENCLAW_WORKSPACE: WORKSPACE,
        TZ: 'America/Montreal',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`exit ${code}: ${stderr.trim().slice(0, 200)}`));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================================================
// DAEMON STATE PERSISTENCE
// ============================================================

const DAEMON_STATE_FILE = path.join(STATE_DIR, 'daemon-state.json');

function saveDaemonState(sm, throttle) {
  const state = {
    state: sm.state,
    sessionId: sm.sessionId,
    lastActivityTime: sm.lastActivityTime,
    pid: process.pid,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) { console.warn(`[memory-daemon] daemon state write failed: ${err.message}`); }
}

function loadDaemonState() {
  if (fs.existsSync(DAEMON_STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf-8'));
      // Check if previous daemon process is still alive
      if (state.pid) {
        try {
          process.kill(state.pid, 0); // check if alive
          // PID exists — but might be reused by a different process
          const staleSec = (Date.now() - (state.updatedAt || 0)) / 1000;
          if (staleSec > 300) {
            // >5 min since last update — PID was likely reused
            log('Stale PID detected (>5 min since last update) — resetting state');
            state.state = STATES.ENDED;
          }
        } catch (err) { console.warn(`[memory-daemon] PID check failed (process not alive): ${err.message}`); state.state = STATES.ENDED; }
      }
      return state;
    } catch (err) { console.warn(`[memory-daemon] daemon state parse failed: ${err.message}`); }
  }
  return null;
}

// ── Tracer wrapping ──────────────────────────────────
runPhase0Bootstrap = tracer.wrapAsync('runPhase0Bootstrap', runPhase0Bootstrap, { tier: 1, category: 'lifecycle' });
runPhase1StatusSync = tracer.wrap('runPhase1StatusSync', runPhase1StatusSync, { tier: 1, category: 'lifecycle' });
runPhase2ThrottledWork = tracer.wrapAsync('runPhase2ThrottledWork', runPhase2ThrottledWork, { tier: 1, category: 'lifecycle' });
handleTransitions = tracer.wrapAsync('handleTransitions', handleTransitions, { tier: 1, category: 'state_transition' });
runSubprocess = tracer.wrap('runSubprocess', runSubprocess, { tier: 2 });

// ============================================================
// MAIN LOOP
// ============================================================

async function main() {
  ensureDirs();
  const config = loadConfig();
  const sources = loadTranscriptSources();

  log(`Daemon starting (pid: ${process.pid}, workspace: ${WORKSPACE})`);
  log(`Transcript sources: ${sources.map(s => s.name).join(', ')}`);

  const sm = new SessionStateMachine(config);

  // Restore state from previous run (crash recovery)
  const savedState = loadDaemonState();
  if (savedState) {
    sm.restore(savedState);
    log(`Restored state: ${sm.state} (session: ${sm.sessionId?.slice(0, 8) || 'none'})`);
  }

  // Graceful shutdown
  let running = true;
  const shutdown = (signal) => {
    log(`Received ${signal} — shutting down`);
    running = false;
    saveDaemonState(sm);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Main tick loop
  async function tick() {
    if (!running) return;

    try {
      // 1. Detect activity
      const activity = detectActivity(sources, config.intervals.activityWindowMs);

      // 2. State machine tick
      const transitions = sm.tick(activity);

      // 3. Handle transitions
      if (transitions.length > 0) {
        const bootResult = await handleTransitions(transitions, config);
        if (bootResult === STATES.ACTIVE) {
          sm.completeBoot();
        }
      }

      // 4. Phase 1: Status sync (when ACTIVE or IDLE)
      if (sm.state === STATES.ACTIVE || sm.state === STATES.IDLE) {
        runPhase1StatusSync(config);
      }

      // 4.5. Phase 1.5: Session trace emission (real-time JSONL → observability feed)
      // Scan ALL transcript sources for recently-modified JSONL files.
      // Multiple agents may be active simultaneously (Claude Code + gateway + etc.)
      if (sm.state === STATES.ACTIVE) {
        const recentCutoff = Date.now() - (config.intervals?.activityWindowMs || 900000);
        for (const source of sources) {
          if (!fs.existsSync(source.path)) continue;
          try {
            const files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
            for (const f of files) {
              const full = path.join(source.path, f);
              try {
                const fstat = fs.statSync(full);
                if (fstat.mtimeMs > recentCutoff) {
                  traceEmitter.processNewEntries(full);
                }
              } catch { /* skip unreadable files */ }
            }
          } catch { /* skip unreadable dirs */ }
        }
      }

      // 5. Phase 2: Throttled work (when ACTIVE or IDLE)
      if (sm.state === STATES.ACTIVE || sm.state === STATES.IDLE) {
        await runPhase2ThrottledWork(config);
      }

      // 6. Persist state
      saveDaemonState(sm);

    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
  }

  // Run first tick immediately
  await tick();

  // Schedule recurring ticks
  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      log('Daemon stopped');
      process.exit(0);
    }
    await tick();
  }, config.intervals.pollMs);

  // setInterval handle above prevents Node from exiting
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
