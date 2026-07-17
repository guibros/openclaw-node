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
import { Worker } from 'worker_threads';
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
import { shouldFlush, USE_LLM_EXTRACTION } from '../lib/pre-compression-flush.mjs';
import { createBudget } from '../lib/memory-budget.mjs';
import { createSessionTraceEmitter } from './session-trace-emitter.mjs';
import { createLocalEventLog, buildMemoryEvent } from '../lib/local-event-log.mjs';
import { createLlmClient, DEFAULT_MODEL } from '../lib/llm-client.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { createExtractionTrigger } from '../lib/extraction-trigger.mjs';
import { ensureSharedStream, inspectSharedStream, verifySharedStreamConfig } from '../lib/shared-event-stream.mjs';
import { NATS_RECONNECT_OPTS } from '../lib/federation-resilience.mjs';
import { createConcurrencyGuard } from '../lib/concurrency-guard.mjs';
import { exportStateSnapshot } from '../lib/ollama-queue.mjs';
import { createMemoryWatcher, runStoreHealthProbes, appendWatcherRecord } from '../lib/memory-watcher.mjs';
import { initDatabase as initKnowledgeDb, indexSessionTurns } from '../lib/mcp-knowledge/core.mjs';
import { createGraphCache } from '../bin/obsidian-graph-cache.mjs';

const traceEmitter = createSessionTraceEmitter(tracer);

// LLM client + extraction store (initialized lazily when USE_LLM_EXTRACTION is true)
let _llmClient = null;
let _extractionStore = null;
function getLlmClient() {
  if (!USE_LLM_EXTRACTION) return null;
  if (!_llmClient) {
    _llmClient = createLlmClient();
    log(`LLM client initialized (USE_LLM_EXTRACTION=true)`);
  }
  return _llmClient;
}
function getExtractionStore() {
  if (!USE_LLM_EXTRACTION) return null;
  if (!_extractionStore) {
    try {
      _extractionStore = createExtractionStore();
      log(`Extraction store initialized`);
    } catch (err) {
      log(`extraction-store unavailable: ${err.message}`);
      return null;
    }
  }
  return _extractionStore;
}

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

// Knowledge DB loaded lazily (requires sqlite-vec native dep from mcp-knowledge)
let _knowledgeDb = null;
function getKnowledgeDb() {
  if (_knowledgeDb) return _knowledgeDb;
  try {
    const dbPath = path.join(HOME, '.openclaw/workspace/.knowledge.db');
    _knowledgeDb = initKnowledgeDb(dbPath);
    log('Knowledge DB initialized');
    return _knowledgeDb;
  } catch (err) {
    log(`knowledge-db unavailable: ${err.message}`);
    return null;
  }
}

// Graph cache loaded lazily (for spreading-activation channel 5 freshness)
let _graphCache = null;
function getGraphCache() {
  if (_graphCache) return _graphCache;
  try {
    _graphCache = createGraphCache({ extractionStore: getExtractionStore() }); // P2: merge LLM typed edges
    log('Graph cache initialized');
    return _graphCache;
  } catch (err) {
    log(`graph-cache unavailable: ${err.message}`);
    return null;
  }
}

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();
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
      synthesisMs: 1800000,       // 30 min — interval synthesis during active sessions (D2)
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

const _missingSourceWarned = new Set();

function _detectActivity(sources, activityWindowMs) {
  const now = Date.now();
  const cutoff = now - activityWindowMs;
  let active = false;
  let newestSession = null;
  let newestMtime = 0;
  let newestSource = null;
  let newestFormat = null;

  for (const source of sources) {
    if (!fs.existsSync(source.path)) {
      // An enabled source whose dir doesn't exist is a config failure, not a
      // quiet day. Silently skipping these is how a mis-rendered registry
      // (2026-07-14: paths missing Claude Code's leading dash) ran ingest dark
      // for 39h with zero log evidence. Warn once per path, loudly.
      if (!_missingSourceWarned.has(source.path)) {
        _missingSourceWarned.add(source.path);
        log(`[ingest] WARNING: enabled transcript source '${source.name}' points at a nonexistent dir: ${source.path} — no sessions from it will EVER ingest until this is fixed`);
      }
      continue;
    }

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
let localEventLog = null;
let extractionTrigger = null;

// Serialize runFlush across all trigger paths (D3 port, deep review 2026-07-03).
// A flush takes 1–15 min; the NATS extract handler used to fire un-awaited and
// could overlap interval/session-end flushes — double LLM work + racing
// MEMORY.md/vault writes. Every completed pass re-arms the idle timer, which
// deliberately does not self-re-arm (R40).
let flushChain = Promise.resolve();
let natsFlushQueued = false;
function serializeFlush(fn) {
  const run = () => Promise.resolve().then(fn).finally(() => extractionTrigger?.resetIdleTimer?.());
  const next = flushChain.then(run, run);
  flushChain = next.catch(() => {});
  return next;
}

// Run the flush OFF this thread. The flush's transcript parse + prompt assembly
// is synchronous string work over a multi-MB JSONL; on the main event loop it
// starved the :7893 inject server for the whole window (thread-sample evidence:
// audits/memory_ingest_remediation). The worker builds its own LLM client +
// extraction store (not structured-cloneable) and returns the plain result.
const FLUSH_WORKER = path.join(__dirname, 'flush-worker.mjs');
const FLUSH_WORKER_TIMEOUT_MS = 30 * 60_000;
function runMemoryWorker(data, timeoutMs = FLUSH_WORKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const w = new Worker(FLUSH_WORKER, { workerData: data });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      w.terminate();
      reject(new Error(`memory worker (${data.kind || 'flush'}) timed out after ${timeoutMs / 60_000}min`));
    }, timeoutMs);
    timer.unref();
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    w.once('message', (m) => settle(m.ok ? resolve : reject, m.ok ? m.result : new Error(m.error)));
    w.once('error', (e) => settle(reject, e));
    w.once('exit', (code) => { if (code !== 0) settle(reject, new Error(`memory worker (${data.kind || 'flush'}) exited with code ${code}`)); });
  });
}
function runFlushInWorker(jsonlPath, memoryMdPath, opts = {}) {
  return runMemoryWorker({ kind: 'flush', jsonlPath, memoryMdPath, ...opts });
}
function runImportInWorker(jsonlPath, { source, format } = {}) {
  return runMemoryWorker({ kind: 'import', jsonlPath, source, format }, 10 * 60_000);
}

function emitIngestEvent(sessionId, source, messageCount) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.ingested', sessionId, 'memory', {
    session_id: sessionId,
    source: source || 'unknown',
    messages_added: messageCount,
    total_messages: messageCount,
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.ingested emit failed: ${err.message}`)
  );
}

function emitExtractEvent(sessionId, extraction) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.extracted', sessionId, 'memory', {
    session_id: sessionId,
    entities_count: extraction.entities_count,
    themes_count: extraction.themes_count,
    mentions_count: extraction.mentions_count,
    decisions_count: extraction.decisions_count,
    // The actual content extracted (capped samples), not just counts.
    entity_names: extraction.entity_names,
    theme_labels: extraction.theme_labels,
    decision_texts: extraction.decision_texts,
    model: DEFAULT_MODEL,
    duration_ms: extraction.duration_ms,
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.extracted emit failed: ${err.message}`)
  );
}

// P0: extraction degradation must be LOUD, not silent. When the LLM path fails and the
// regex fallback runs (diverting away from the structured MEMORY.md), emit memory.error
// so the watcher/observer sees the degradation instead of it hiding in a stderr line.
function emitDegradeEvent(sessionId, result) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.error', sessionId, 'memory', {
    session_id: sessionId,
    kind: 'extraction-degraded',
    detail: `LLM extraction failed; regex fallback used${result.fallback_path ? ` (diverted to ${result.fallback_path}; structured MEMORY.md protected)` : ''}`,
    extraction_error: result.extraction_error || null,
    mode: result.mode,
    model: DEFAULT_MODEL,
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.error emit failed: ${err.message}`)
  );
}

function emitSynthesizeEvent(sessionId, trigger, synthesis) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.synthesized', sessionId, 'memory', {
    session_id: sessionId,
    trigger,
    artifacts_written: synthesis.artifacts_written,
    duration_ms: synthesis.duration_ms,
    ...(synthesis.vault_integrity ? { vault_integrity: synthesis.vault_integrity } : {}),
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.synthesized emit failed: ${err.message}`)
  );
}

function emitErrorEvent(boundary, err, sessionId) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.error', sessionId || 'unknown', 'memory', {
    boundary,
    error_code: String(err.code || err.constructor?.name || 'UNKNOWN').slice(0, 100),
    error_message: (err.message || String(err)).slice(0, 500),
    ...(sessionId ? { session_id: sessionId } : {}),
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(emitErr =>
    log(`[event] memory.error emit failed: ${emitErr.message}`)
  );
}

function initMemoryBudget(config) {
  if (memoryBudget) return memoryBudget;
  memoryBudget = createBudget(config.workspace || WORKSPACE, {
    charBudget: config.memoryCharBudget || 2200,
    eventLog: localEventLog,
    nodeId: NODE_ID,
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
        const result = await store.importDirectory(source.path, {
          source: source.name, format: source.format,
          onImported: (r) => emitIngestEvent(r.sessionId, source.name, r.messageCount),
        });
        totalImported += result.imported;
      }
      if (totalImported > 0) log(`  session-store: imported ${totalImported} sessions`);
    }
  } catch (e) { log(`  session-store import failed: ${e.message}`); emitErrorEvent('ingest', e); }

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
          if (stat.size < MIN_SESSION_BYTES) continue; // skip header-only noise (repair 4.6)
          all.push({ path: full, mtime: stat.mtimeMs });
        } catch (err) { console.warn(`[memory-daemon] prev jsonl stat failed for ${full}: ${err.message}`); continue; }
      }
    } catch (err) { console.warn(`[memory-daemon] prev jsonl readdir failed for ${source.path}: ${err.message}`); continue; }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  return all.length > 1 ? all[1].path : null; // second most recent = previous
}

// R-floor fix (repair 4.6): below this a session file is header-only noise.
// The old floor was a bare 50KB literal, which silently excluded every
// short-but-real conversation from the interval/NATS flush paths and from
// ended-session targeting; the 1.4 extraction dedup makes re-considering
// small sessions cheap.
const MIN_SESSION_BYTES = 1024;

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
          if (stat.size < MIN_SESSION_BYTES) continue;
          all.push({ path: full, mtime: stat.mtimeMs });
        } catch (err) { console.warn(`[memory-daemon] current jsonl stat failed for ${full}: ${err.message}`); continue; }
      }
    } catch (err) { console.warn(`[memory-daemon] current jsonl readdir failed for ${source.path}: ${err.message}`); continue; }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  return all.length > 0 ? all[0].path : null; // most recent = current
}

function findJsonlBySessionId(sources, sessionId) {
  if (!sessionId) return null;
  const target = `${sessionId}.jsonl`;
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    const full = path.join(source.path, target);
    try {
      const stat = fs.statSync(full);
      if (stat.size >= MIN_SESSION_BYTES) return full;
    } catch { /* file doesn't exist in this source */ }
  }
  return null;
}

// ============================================================
// PHASE 1: STATUS SYNC
// Updates .daemon-state-${NODE_ID}.md from active-tasks.md (~5ms)
// ============================================================

function runPhase1StatusSync(config) {
  const activeTasks = path.join(WORKSPACE, 'memory/active-tasks.md');
  const companion = path.join(WORKSPACE, `.daemon-state-${NODE_ID}.md`);

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
    lastSessionImport: 0, lastHyperagentReflect: 0, lastSynthesis: 0,
    lastKnowledgeIndex: 0, lastGraphCacheRefresh: 0,
  };
}

function saveThrottleState(state) {
  fs.writeFileSync(THROTTLE_STATE_FILE, JSON.stringify(state, null, 2));
}

async function runPhase2ThrottledWork(config, sessionState) {
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

  // Live session import (every 10min while a session is running) — state.db
  // ingest used to happen only at boot + session end, so a marathon session
  // lagged hours behind its own transcript (and the mem.ingest freshness probe
  // rightly flagged it). importSession is offset-incremental, so this is cheap.
  if (now - (throttle.lastLiveImport || 0) >= config.intervals.sessionRecapMs) {
    throttle.lastLiveImport = now;
    stage1.push((async () => {
      const currentJsonl = findCurrentJsonl(loadTranscriptSources());
      if (!currentJsonl) return;
      const activity = detectActivity(loadTranscriptSources(), config.intervals.activityWindowMs);
      // importSession fully re-parses the JSONL and bulk-replaces rows — on the
      // main thread that starved the inject server (same class as the flush);
      // it runs in the memory worker instead.
      const result = await runImportInWorker(currentJsonl, {
        source: activity.newestSource || 'unknown',
        format: activity.newestFormat,
      });
      if (result.imported) {
        log(`  Phase 2: live session import — ${result.sessionId.slice(0, 8)} (${result.messageCount} msgs)`);
        emitIngestEvent(result.sessionId, activity.newestSource || 'unknown', result.messageCount);
      }
    })().catch(e => log(`  Phase 2: live session import failed: ${e.message}`)));
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
            const result = await store.importDirectory(source.path, {
              source: source.name, format: source.format,
              onImported: (r) => emitIngestEvent(r.sessionId, source.name, r.messageCount),
            });
            totalImported += result.imported;
          }
          if (totalImported > 0) log(`  Phase 2: session-store imported ${totalImported} sessions`);
        } catch (e) { log(`  Phase 2: session-import failed: ${e.message}`); emitErrorEvent('ingest', e); }
      })()
    );
  }

  // Knowledge DB incremental indexing (every 10min, aligned with session-import)
  if (now - (throttle.lastKnowledgeIndex || 0) >= config.intervals.sessionRecapMs) {
    throttle.lastKnowledgeIndex = now;
    stage1.push(
      (async () => {
        try {
          const knowledgeDb = getKnowledgeDb();
          if (!knowledgeDb) return;
          const { openStore } = await import('../lib/sqlite-store.mjs');
          const stateDbPath = path.join(HOME, '.openclaw/state.db');
          if (!fs.existsSync(stateDbPath)) return;
          // R22 (repair 5.6): no integrity scan on the 10-min indexing path.
          const stateDb = openStore(stateDbPath, { readonly: true, integrityCheck: false });
          try {
            const allSessions = stateDb.prepare(
              'SELECT id, source FROM sessions ORDER BY start_time ASC'
            ).all();
            let indexed = 0, chunks = 0;
            const BATCH_LIMIT = 5;
            for (const session of allSessions) {
              if (indexed >= BATCH_LIMIT) break;
              // R18 fix (repair 5.1): existence is not freshness. A session
              // indexed mid-flight froze at first sighting forever — FTS and
              // vector search served truncated prefixes of every grown
              // session. Cheap growth pre-filter via turn_count (= message
              // count at index time); indexSessionTurns hash-verifies and
              // delete+reinserts when content actually changed.
              const existing = knowledgeDb.prepare(
                'SELECT content_hash, turn_count FROM session_documents WHERE session_id = ?'
              ).get(session.id);
              const liveCount = stateDb.prepare(
                'SELECT COUNT(*) AS n FROM messages WHERE session_id = ?'
              ).get(session.id).n;
              if (existing && existing.turn_count === liveCount) continue;
              const messages = stateDb.prepare(
                'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC'
              ).all(session.id);
              if (messages.length === 0) continue;
              const turns = messages.map(m => ({ role: m.role, content: m.content }));
              const result = await indexSessionTurns(knowledgeDb, session.id, `session-store://${session.id}`, turns);
              if (result.indexed) {
                indexed++;
                chunks += result.chunks;
              }
            }
            if (indexed > 0) log(`  Phase 2: knowledge-index: ${indexed} sessions indexed (${chunks} chunks)`);
          } finally {
            stateDb.close();
          }
        } catch (e) { log(`  Phase 2: knowledge-index failed: ${e.message}`); emitErrorEvent('knowledge_index', e); }
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

  // 30-min interval synthesis during active sessions (D2, step 4.5)
  if (sessionState === STATES.ACTIVE && now - throttle.lastSynthesis >= config.intervals.synthesisMs) {
    throttle.lastSynthesis = now;
    stage1.push(
      (async () => {
        try {
          const sources = loadTranscriptSources();
          const currentJsonl = findCurrentJsonl(sources);
          if (!currentJsonl) return;
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
          }));
          log(`  Phase 2: interval synthesis [${result.mode || 'regex'}]: ${result.facts} facts found, ${result.added} added`);
          if (result.degraded) {
            log(`  Phase 2: ⚠ EXTRACTION DEGRADED — LLM failed, regex fallback used${result.fallback_path ? ` (diverted to ${result.fallback_path}; structured MEMORY.md protected)` : ''}: ${result.extraction_error || ''}`);
            emitDegradeEvent(result.extraction?.session_id || path.basename(currentJsonl, '.jsonl'), result);
          }
          if (result.extraction) {
            emitExtractEvent(result.extraction.session_id, result.extraction);
          }
          if (result.synthesis) {
            emitSynthesizeEvent(result.synthesis.session_id, 'interval', result.synthesis);
          }
          if (memoryBudget && (result.added > 0 || result.merged > 0)) {
            memoryBudget.reload();
          }
        } catch (e) { log(`  Phase 2: interval synthesis failed: ${e.message}`); emitErrorEvent('extract', e); }
      })()
    );
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

  // Stage 3: Graph-cache refresh — runs AFTER obsidian sync so vault notes
  // written during synthesis (stage 1) and sync (stage 2) are reflected.
  // Aligned with synthesis cadence (30 min, D2).
  if (now - (throttle.lastGraphCacheRefresh || 0) >= config.intervals.maintenanceMs) {
    throttle.lastGraphCacheRefresh = now;
    try {
      const gc = getGraphCache();
      if (gc) {
        const result = await gc.refreshCache();
        if (result) log(`  Phase 2: graph-cache refreshed: ${result.nodeCount} nodes, ${result.edgeCount} edges`);
      }
    } catch (e) { log(`  Phase 2: graph-cache refresh failed: ${e.message}`); emitErrorEvent('graph_cache_refresh', e); }
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

    // ACTIVE → ENDED: Session-end synthesis + quick cleanup before session switch
    if (t.from === STATES.ACTIVE && t.to === STATES.ENDED) {
      log('Session switched while active — running session-end synthesis + cleanup');

      // Session-end synthesis: extract + synthesize the ending session (4.4)
      const sources = loadTranscriptSources();
      const endingJsonl = findJsonlBySessionId(sources, t.sessionId) || findCurrentJsonl(sources);
      if (endingJsonl) {
        try {
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(endingJsonl, memoryMd, {
            charBudget: budget.charBudget,
          }));
          if (result.extraction) {
            emitExtractEvent(result.extraction.session_id, result.extraction);
          }
          if (result.synthesis) {
            emitSynthesizeEvent(result.synthesis.session_id, 'session_end', result.synthesis);
            log(`  session-end synthesis [${result.mode}]: ${result.synthesis.artifacts_written.length} artifacts, ${result.synthesis.duration_ms}ms`);
          }
        } catch (e) { log(`  session-end synthesis failed: ${e.message}`); emitErrorEvent('extract', e, t.sessionId); }
      }

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
          // shouldFlush parses the whole transcript — it runs IN the worker
          // (checkShouldFlush) so the event loop never touches the JSONL.
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
            checkShouldFlush: true,
            contextWindowTokens: config.contextWindowTokens || 200000,
          }));
          if (!result.skippedByCheck) {
            log(`  pre-compression flush triggered (${result.check?.pctUsed}% of ${result.check?.threshold} token threshold)`);
            log(`  flush [${result.mode || 'regex'}]: ${result.facts} facts found, ${result.added} added, ${result.merged} merged, ${result.skipped} skipped`);
            if (result.extraction) {
              emitExtractEvent(result.extraction.session_id, result.extraction);
            }
            if (result.synthesis) {
              // R10 (repair 2.11): this is the ACTIVE→IDLE pre-compression
              // flush — its own label, not 'interval'.
              emitSynthesizeEvent(result.synthesis.session_id, 'idle', result.synthesis);
            }
            if (memoryBudget && (result.added > 0 || result.merged > 0)) {
              memoryBudget.reload();
              log('  memory-budget: snapshot reloaded after flush');
            }
          }
        } catch (e) { log(`  pre-compression flush failed: ${e.message}`); emitErrorEvent('extract', e, path.basename(currentJsonl, '.jsonl')); }
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

      // 0. Pre-compression flush (final chance to capture facts).
      // R17 fix (repair 4.4): flush the ENDED session's own transcript —
      // when the end is caused by a new session appearing, the newest JSONL
      // is the new session's, not the one being closed.
      const sources = loadTranscriptSources();
      const currentJsonl = findJsonlBySessionId(sources, t.sessionId) || findCurrentJsonl(sources);
      if (currentJsonl) {
        try {
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
          }));
          if (result.extraction) {
            emitExtractEvent(result.extraction.session_id, result.extraction);
          }
          if (result.synthesis) {
            emitSynthesizeEvent(result.synthesis.session_id, 'session_end', result.synthesis);
            log(`  session-end synthesis [${result.mode}]: ${result.synthesis.artifacts_written.length} artifacts, ${result.synthesis.duration_ms}ms`);
          }
          if (result.added > 0 || result.merged > 0) {
            log(`  end-of-session flush [${result.mode || 'regex'}]: ${result.added} added, ${result.merged} merged`);
            if (memoryBudget) {
              memoryBudget.reload();
              log('  memory-budget: snapshot reloaded after end-of-session flush');
            }
          }
        } catch (e) { log(`  end-of-session flush failed: ${e.message}`); emitErrorEvent('extract', e, path.basename(currentJsonl, '.jsonl')); }
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
              emitIngestEvent(result.sessionId, activity.newestSource || 'unknown', result.messageCount);
            }
          }
        } catch (e) { log(`  session-store archive failed: ${e.message}`); emitErrorEvent('ingest', e); }
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
      // (R17, repair 4.4: same ended-session targeting as the flush above)
      if (fs.existsSync(subagentAudit)) {
        const sources = loadTranscriptSources();
        const currentJsonl = findJsonlBySessionId(sources, t.sessionId) || findCurrentJsonl(sources);
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

  // Optional NATS subscription for external compaction signals
  let natsConn = null;
  let memoryWatcher = null;
  let healthProbeTimer = null;

  // Store-health probes — periodic snapshots of DB row counts, WAL sizes,
  // drift. R16 fix (repair 4.2): they probe SQLite, not NATS — they used to
  // live inside the NATS try block and silently died whenever the broker
  // was down at boot, exactly when disk-level visibility matters most.
  const HEALTH_PROBE_INTERVAL = 5 * 60 * 1000;
  const watcherOutputPath = path.join(os.homedir(), '.openclaw', 'watcher.jsonl');
  const runProbe = async () => {
    try {
      const probe = await runStoreHealthProbes();
      appendWatcherRecord(watcherOutputPath, probe);
      log(`[watcher] health probe: ${Object.entries(probe.stores).filter(([,v]) => v).length} stores checked`);
    } catch (err) {
      log(`[watcher] health probe failed: ${err.message}`);
    }
  };
  runProbe();
  healthProbeTimer = setInterval(runProbe, HEALTH_PROBE_INTERVAL);

  // R16 fix (repair 4.3): NATS init is retryable. A broker down at boot used
  // to permanently disable the event spine (event log, watcher, extraction
  // trigger) until a manual restart; now the daemon retries every 60s.
  let natsRetryTimer = null;
  async function initNatsSubsystems() {
  try {
    const { connect: natsConnect } = require('nats');
    const { natsConnectOpts } = require('../lib/nats-resolve');
    natsConn = await natsConnect(natsConnectOpts({ name: 'memory-daemon', timeout: 5000, ...NATS_RECONNECT_OPTS }));

    // Monitor NATS connection status events (reconnect, disconnect, etc.)
    (async () => {
      for await (const s of natsConn.status()) {
        if (s.type === 'reconnect') {
          log(`[nats] reconnected to ${s.data || 'server'}`);
        } else if (s.type === 'disconnect') {
          log(`[nats] disconnected — will auto-reconnect`);
        } else if (s.type === 'error') {
          log(`[nats] connection error: ${s.data}`);
        }
      }
    })().catch(() => {}); // status iterator ends on close

    const sub = natsConn.subscribe('mesh.memory.compaction_completed');
    (async () => {
      for await (const msg of sub) {
        if (memoryBudget) {
          memoryBudget.reload();
          log('[nats] memory-budget reloaded via mesh.memory.compaction_completed');
        }
      }
    })().catch(() => {}); // subscription ends on drain/close
    log(`NATS connected (reconnect: infinite, wait: ${NATS_RECONNECT_OPTS.reconnectTimeWait}ms) — subscribed to mesh.memory.compaction_completed`);

    // Initialize local event log for dual-write shadow mode
    try {
      localEventLog = await createLocalEventLog(natsConn, NODE_ID);
      log(`Local event log initialized (stream: ${localEventLog.streamName})`);
    } catch (evtErr) {
      log(`Local event log unavailable (${evtErr.message}) — continuing without event log`);
    }

    // Initialize memory watcher (subscribes to event stream, persists per-op JSONL)
    if (localEventLog) {
      try {
        memoryWatcher = await createMemoryWatcher(natsConn, NODE_ID, {
          log: (m) => log(`[watcher] ${m}`),
        });
      } catch (watchErr) {
        log(`Memory watcher unavailable (${watchErr.message}) — continuing without watcher`);
      }
    }

    // Ensure shared federation stream (OPENCLAW_SHARED, R=3)
    try {
      await ensureSharedStream(natsConn);
      const streamInfo = await inspectSharedStream(natsConn);
      const verification = verifySharedStreamConfig(streamInfo);
      if (!verification.valid) {
        log(`FATAL: Shared stream config mismatch: ${verification.reasons.join('; ')}`);
        process.exit(1);
      }
      log(`Shared stream OPENCLAW_SHARED verified (R=${streamInfo.config.num_replicas}, storage=${streamInfo.config.storage})`);
    } catch (streamErr) {
      log(`Shared stream unavailable (${streamErr.message}) — continuing without federation stream`);
    }

    // Initialize agnostic extraction trigger (mesh.memory.extract_request)
    try {
      extractionTrigger = createExtractionTrigger(natsConn, NODE_ID, {
        onExtract: async (payload) => {
          log(`[nats] extraction requested by ${payload.triggered_by || 'unknown'}`);
          if (sm.state !== STATES.ACTIVE && sm.state !== STATES.IDLE) {
            log(`[nats] skipping extraction — session state is ${sm.state}`);
            return;
          }
          if (natsFlushQueued) {
            log('[nats] flush already queued — coalescing request');
            return;
          }
          const currentJsonl = findCurrentJsonl(loadTranscriptSources());
          if (!currentJsonl) return;
          natsFlushQueued = true;
          try {
            // shouldFlush parses the whole transcript — it runs IN the worker
            // (checkShouldFlush) so the event loop never touches the JSONL.
            const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
            const budget = initMemoryBudget(config);
            const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
              charBudget: budget.charBudget,
              checkShouldFlush: true,
              contextWindowTokens: config.contextWindowTokens || 200000,
            }));
            if (!result.skippedByCheck) {
              log(`  nats-triggered flush [${result.mode || 'regex'}]: ${result.facts} facts, ${result.added} added, ${result.merged} merged`);
              if (result.extraction) {
                emitExtractEvent(result.extraction.session_id, result.extraction);
              }
              if (result.synthesis) {
                emitSynthesizeEvent(result.synthesis.session_id, 'manual', result.synthesis);
              }
              if (memoryBudget && (result.added > 0 || result.merged > 0)) {
                memoryBudget.reload();
                log('  memory-budget: snapshot reloaded after nats-triggered flush');
              }
            }
          } catch (e) { log(`  nats-triggered flush failed: ${e.message}`); emitErrorEvent('extract', e, path.basename(currentJsonl, '.jsonl')); }
          finally { natsFlushQueued = false; }
        },
      });
      await extractionTrigger.start();
      log(`Extraction trigger initialized (idle threshold: ${process.env.EXTRACTION_IDLE_THRESHOLD_SEC || 2700}s)`);
    } catch (trigErr) {
      log(`Extraction trigger unavailable (${trigErr.message}) — continuing without trigger`);
    }
    return true;
  } catch (e) {
    log(`NATS unavailable (${e.message}) — retrying every 60s until the broker is reachable`);
    return false;
  }
  }
  if (!(await initNatsSubsystems())) {
    natsRetryTimer = setInterval(async () => {
      if (!running) return;
      if (await initNatsSubsystems()) {
        clearInterval(natsRetryTimer);
        natsRetryTimer = null;
        log('NATS subsystems initialized on retry');
      }
    }, 60_000);
  }

  // ── Memory injection HTTP endpoint (Block 7 amendment B+D) ──────────
  // Loopback-only HTTP server at :7893 that companion-bridge calls per
  // prompt to fetch the [memory: ...] block. Shares the daemon's loaded
  // BGE-M3 model + SQLite handles + ollama-queue state, so BGE-M3 stays
  // warm across thousands of prompts (solves amendment D for free).
  // Opt out by setting MEMORY_INJECT_DISABLED=1.
  let injectionServer = null;
  if (process.env.MEMORY_INJECT_DISABLED !== '1') {
    try {
      const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');
      injectionServer = await startInjectionServer(
        { knowledgeDb: getKnowledgeDb(), graphCache: getGraphCache(), llmClient: getLlmClient(), extractionDb: getExtractionStore()?.db, eventLog: localEventLog, nodeId: NODE_ID },
        { log: (m) => log(`[inject-server] ${m}`) },
      );
    } catch (injErr) {
      log(`Memory inject server unavailable (${injErr.message}) — companion-bridge injection will be silent`);
    }
  }

  // Graceful shutdown
  let running = true;
  let tickInterval = null;
  let inFlightTick = null;
  const shutdown = async (signal) => {
    log(`Received ${signal} — shutting down`);
    running = false;
    // R15 fix (repair 4.1): fence in-flight work BEFORE closing handles, and
    // own the exit instead of deferring it to the next interval fire — which
    // routinely outlived launchd's patience (every restart exited -9/-6 with
    // a native mutex abort in .err).
    if (tickInterval) clearInterval(tickInterval);
    if (natsRetryTimer) clearInterval(natsRetryTimer);
    if (inFlightTick) {
      const drained = await Promise.race([
        inFlightTick.then(() => true).catch(() => true),
        new Promise((r) => setTimeout(r, 8000, false)),
      ]);
      log(drained ? 'in-flight tick drained' : 'tick still in flight after 8s grace — closing anyway');
    }
    if (extractionTrigger) {
      extractionTrigger.stop();
    }
    saveDaemonState(sm);
    if (healthProbeTimer) clearInterval(healthProbeTimer);
    if (memoryWatcher) {
      try { await memoryWatcher.stop(); } catch (_) {}
    }
    if (injectionServer) {
      try { await injectionServer.close(); } catch (_) {}
    }
    if (_graphCache) {
      try { _graphCache.close(); } catch (_) {}
    }
    if (_knowledgeDb) {
      try { _knowledgeDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      try { _knowledgeDb.close(); } catch (_) {}
    }
    if (_extractionStore) {
      try { _extractionStore.close(); } catch (_) {}
    }
    if (_sessionStore) {
      try { _sessionStore.close(); } catch (_) {}
    }
    if (_haStore) {
      try { _haStore.close(); } catch (_) {}
    }
    if (natsConn) {
      try { await natsConn.drain(); } catch (_) {}
    }
    log('Daemon stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Main tick loop
  async function tick() {
    if (!running) return;

    try {
      // 1. Detect activity. Sources are re-read from the registry every tick —
      // every other consumer already does; a startup-frozen copy made registry
      // edits invisible until restart (a stale entry hid a whole project's
      // sessions from extraction for a day, 2026-07-03).
      const activity = detectActivity(loadTranscriptSources(), config.intervals.activityWindowMs);

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

      // 4.1. Reset extraction trigger idle timer on activity
      if (extractionTrigger && activity.active) {
        extractionTrigger.resetIdleTimer();
      }

      // 4.5. Phase 1.5: Session trace emission (real-time JSONL → observability feed)
      // Scan ALL transcript sources for recently-modified JSONL files.
      // Multiple agents may be active simultaneously (Claude Code + gateway + etc.)
      if (sm.state === STATES.ACTIVE) {
        const recentCutoff = Date.now() - (config.intervals?.activityWindowMs || 900000);
        for (const source of loadTranscriptSources()) {
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
        await runPhase2ThrottledWork(config, sm.state);
      }

      // 6. Persist state
      saveDaemonState(sm);

      // 6.5. Export the LLM queue snapshot for health-watch (R12, repair 3.3):
      // queue state is in-process memory; without this file a separate
      // process can only ever see its own empty queue.
      try { exportStateSnapshot(); } catch (snapErr) { log(`queue snapshot export failed: ${snapErr.message}`); }

    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
  }

  // R3 fix: ticks routinely outlive pollMs (LLM extraction, Phase 0 bootstrap);
  // unguarded overlap re-runs the same throttled work off stale on-disk state.
  const guardedTick = createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000, log });

  // Run first tick immediately
  inFlightTick = guardedTick();
  await inFlightTick;
  inFlightTick = null;

  // Schedule recurring ticks. Shutdown owns the exit (R15, repair 4.1).
  tickInterval = setInterval(async () => {
    if (!running) return;
    inFlightTick = guardedTick();
    const result = await inFlightTick;
    inFlightTick = null;
    if (result?.skipped) log('tick skipped (in-flight)');
  }, config.intervals.pollMs);

  // setInterval handle above prevents Node from exiting
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
