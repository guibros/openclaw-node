/**
 * heartbeat-detect.mjs — Detect if a heartbeat session is currently active
 *
 * A heartbeat session is an openclaw-gateway session triggered by the OpenClaw
 * platform's heartbeat scheduler. It is distinguishable from regular main sessions by:
 *   1. Source: appears in gateway sessions dir (~/.openclaw/agents/main/sessions/)
 *   2. Content: first user message contains "HEARTBEAT" or "Read HEARTBEAT.md"
 *   3. Size: typically small (< ~50 messages) compared to main sessions
 *   4. Recency: within the configured heartbeat window
 *
 * Used by:
 *   - /api/settings/heartbeat/status (Mission Control dashboard)
 *   - memory-daemon.mjs (to tag session type in daemon-state.json)
 *   - HEARTBEAT.md tooling (to know if a heartbeat is currently running)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createTracer } = require('./tracer');
const tracer = createTracer('heartbeat-detect');

const HOME = os.homedir();
const TRANSCRIPT_REGISTRY = path.join(HOME, '.openclaw/config/transcript-sources.json');

/**
 * @typedef {Object} HeartbeatStatus
 * @property {boolean} isActive - Whether a heartbeat session is currently active
 * @property {string|null} sessionId - The gateway session ID if active
 * @property {string|null} detectedAt - ISO timestamp of last heartbeat session mtime
 * @property {number|null} ageSeconds - How many seconds ago the session was last modified
 * @property {string} sessionType - "heartbeat" | "main" | "unknown"
 * @property {boolean} daemonActive - Whether any session is active (from daemon state)
 * @property {string|null} daemonSessionId - The daemon's current tracked session ID
 * @property {string} daemonState - The daemon's lifecycle state
 */

const HEARTBEAT_PATTERNS = [
  /HEARTBEAT/i,
  /Read HEARTBEAT\.md/i,
  /heartbeat poll/i,
  /heartbeat check/i,
  /bin\/heartbeat/i,
];

/**
 * Load transcript sources from config. Falls back to defaults if registry missing.
 * @returns {Array<{name: string, path: string, format: string, enabled?: boolean}>}
 */
function loadTranscriptSources() {
  if (fs.existsSync(TRANSCRIPT_REGISTRY)) {
    try {
      const reg = JSON.parse(fs.readFileSync(TRANSCRIPT_REGISTRY, 'utf-8'));
      return (reg.sources || [])
        .filter(s => s.enabled !== false)
        .map(s => ({
          ...s,
          path: s.path.startsWith('~') ? path.join(HOME, s.path.slice(1)) : s.path,
        }));
    } catch { /* fall through */ }
  }
  // Default fallback
  return [
    { name: 'gateway', path: path.join(HOME, '.openclaw/agents/main/sessions'), format: 'openclaw-gateway' },
  ];
}

/**
 * Check if a JSONL file contains a heartbeat trigger message in its first N lines.
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {number} [scanLines=15] - How many lines to scan
 * @returns {boolean}
 */
function isHeartbeatSession(filePath, scanLines = 15) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, scanLines);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || entry.text || entry.content || '';
        const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
        if (HEARTBEAT_PATTERNS.some(p => p.test(text))) return true;
      } catch { /* skip malformed line */ }
    }
  } catch { /* file unreadable */ }
  return false;
}

/**
 * Load the daemon state from .tmp/daemon-state.json.
 * @param {string} workspace - Path to workspace root
 * @returns {{ state: string, sessionId: string|null, lastActivityTime: number, pid: number, updatedAt: number } | null}
 */
function loadDaemonState(workspace) {
  const daemonFile = path.join(workspace, '.tmp/daemon-state.json');
  if (!fs.existsSync(daemonFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonFile, 'utf-8'));
  } catch { return null; }
}

/**
 * Detect if a heartbeat session is currently active.
 *
 * Algorithm:
 * 1. Find the most recently modified gateway JSONL session
 * 2. Check if it's within the active window (default: 30 min)
 * 3. Check if it contains a heartbeat trigger message
 * 4. Enrich result with daemon state
 *
 * @param {Object} [options]
 * @param {string} [options.workspace] - Workspace root (defaults to OPENCLAW_WORKSPACE env or ~/.openclaw/workspace)
 * @param {number} [options.activeWindowMs=1800000] - Max age in ms for a session to be considered active (default 30 min)
 * @returns {HeartbeatStatus}
 */
export const detectHeartbeat = tracer.wrap('detectHeartbeat', function detectHeartbeat(options = {}) {
  const workspace = options.workspace
    || process.env.OPENCLAW_WORKSPACE
    || path.join(HOME, '.openclaw/workspace');
  const activeWindowMs = options.activeWindowMs ?? 30 * 60 * 1000;

  const sources = loadTranscriptSources();
  const gatewaySources = sources.filter(s => s.format === 'openclaw-gateway');

  const daemonState = loadDaemonState(workspace);
  const daemonActive = daemonState?.state === 'ACTIVE' || daemonState?.state === 'IDLE';
  const daemonSessionId = daemonState?.sessionId || null;
  const daemonStateStr = daemonState?.state || 'UNKNOWN';

  let newestFile = null;
  let newestMtime = 0;
  let newestSessionId = null;

  for (const source of gatewaySources) {
    if (!fs.existsSync(source.path)) continue;
    let files;
    try {
      files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }

    for (const f of files) {
      const fullPath = path.join(source.path, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newestFile = fullPath;
          newestSessionId = path.basename(f, '.jsonl');
        }
      } catch { /* skip */ }
    }
  }

  if (!newestFile || !newestMtime) {
    return {
      isActive: false,
      sessionId: null,
      detectedAt: null,
      ageSeconds: null,
      sessionType: 'unknown',
      daemonActive,
      daemonSessionId,
      daemonState: daemonStateStr,
    };
  }

  const now = Date.now();
  const ageMs = now - newestMtime;
  const ageSeconds = Math.floor(ageMs / 1000);
  const detectedAt = new Date(newestMtime).toISOString();

  const withinWindow = ageMs <= activeWindowMs;
  const isHb = withinWindow && isHeartbeatSession(newestFile);

  return {
    isActive: isHb,
    sessionId: isHb ? newestSessionId : null,
    detectedAt: isHb ? detectedAt : null,
    ageSeconds: isHb ? ageSeconds : null,
    sessionType: withinWindow ? (isHb ? 'heartbeat' : 'main') : 'unknown',
    daemonActive,
    daemonSessionId,
    daemonState: daemonStateStr,
  };
}, { tier: 3, category: 'io' });

/**
 * Convenience: returns true if a heartbeat is currently active.
 * @param {Object} [options] - Same as detectHeartbeat options
 * @returns {boolean}
 */
export const isHeartbeatActive = tracer.wrap('isHeartbeatActive', function isHeartbeatActive(options = {}) {
  return detectHeartbeat(options).isActive;
}, { tier: 3, category: 'io' });
