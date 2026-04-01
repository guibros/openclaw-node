#!/usr/bin/env node
/**
 * lane-watchdog.js — Gateway Lane Deadlock Recovery
 *
 * Monitors gateway logs for stuck lanes (agent timeout → lane deadlock).
 * When a lane is blocked beyond threshold, sends SIGUSR1 to trigger
 * resetAllLanes() inside the gateway process.
 *
 * Created: 2026-03-08 22:10 America/Montreal
 *
 * Pattern: same as gateway health-monitor (stale Discord socket → restart).
 * Difference: this catches lane-level deadlocks the health-monitor misses.
 *
 * Signals:
 *   - "embedded run timeout" in logs → agent timed out
 *   - "lane wait exceeded" with waitedMs > threshold → lane is stuck
 *   - Both together within window → deadlock confirmed, send SIGUSR1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('lane-watchdog');

// --- Configuration ---
const GATEWAY_LOG = process.env.GATEWAY_LOG
  || path.join(process.env.HOME, '.openclaw/logs/gateway.log');
const GATEWAY_ERR_LOG = process.env.GATEWAY_ERR_LOG
  || path.join(process.env.HOME, '.openclaw/logs/gateway.err.log');

const LANE_STUCK_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min before intervention
const POLL_INTERVAL_MS = 15_000;                   // check every 15s
const COOLDOWN_MS = 60_000;                        // 1 min cooldown after SIGUSR1
const INCIDENT_LOG = path.join(process.env.HOME, 'openclaw/shared/lane-watchdog.log');

// --- State ---
let lastInterventionAt = 0;
let logWatcher = null;
let errWatcher = null;

// Incident log dedup: suppress identical messages within 60s
let lastIncidentMsg = '';
let lastIncidentAt = 0;
let suppressedCount = 0;

// Track detected events
const events = {
  agentTimeout: null,    // timestamp of last "embedded run timeout"
  laneWaitExceeded: null // { timestamp, waitedMs, lane }
};

// --- Helpers ---
function log(msg) {
  const now = Date.now();
  // Dedup: suppress identical messages within 60s
  if (msg === lastIncidentMsg && (now - lastIncidentAt) < 60_000) {
    suppressedCount++;
    return;
  }
  // If we suppressed duplicates, emit a summary before the new message
  if (suppressedCount > 0) {
    const summaryLine = `${new Date().toISOString()} [lane-watchdog] (suppressed ${suppressedCount} duplicate message(s))`;
    console.log(summaryLine);
    try { fs.appendFileSync(INCIDENT_LOG, summaryLine + '\n'); } catch { /* best effort */ }
  }
  lastIncidentMsg = msg;
  lastIncidentAt = now;
  suppressedCount = 0;

  const ts = new Date().toISOString();
  const line = `${ts} [lane-watchdog] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(INCIDENT_LOG, line + '\n');
  } catch { /* best effort */ }
}

function getGatewayPid() {
  try {
    // Gateway runs as "openclaw-gateway" process (renamed by the framework)
    const out = execSync(
      'pgrep -x openclaw-gateway',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const pids = out.split('\n').filter(Boolean);
    return pids.length > 0 ? parseInt(pids[0], 10) : null;
  } catch {
    return null;
  }
}

function sendSigusr1(pid, reason) {
  const now = Date.now();
  if (now - lastInterventionAt < COOLDOWN_MS) {
    log(`SKIP: cooldown active (${Math.round((COOLDOWN_MS - (now - lastInterventionAt)) / 1000)}s remaining)`);
    return false;
  }

  log(`INTERVENTION: sending SIGUSR1 to gateway pid=${pid} reason="${reason}"`);
  try {
    process.kill(pid, 'SIGUSR1');
    lastInterventionAt = now;
    log(`SIGUSR1 sent successfully. Gateway will resetAllLanes().`);
    // Clear tracked events after intervention
    events.agentTimeout = null;
    events.laneWaitExceeded = null;
    return true;
  } catch (err) {
    log(`ERROR: failed to send SIGUSR1: ${err.message}`);
    return false;
  }
}

// --- Log Line Parsing ---
function parseLine(line) {
  // Match: embedded run timeout
  // Example: 2026-03-08T21:31:23.589-05:00 [agent/embedded] embedded run timeout: runId=...
  if (line.includes('embedded run timeout')) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();
    events.agentTimeout = ts;
    log(`DETECTED: agent timeout at ${new Date(ts).toISOString()}`);
    checkForDeadlock();
    return;
  }

  // Match: lane wait exceeded
  // Example: [diagnostic] lane wait exceeded: lane=session:agent:main:main waitedMs=551882 queueAhead=0
  const laneMatch = line.match(/lane wait exceeded:.*?lane=(\S+)\s+waitedMs=(\d+)/);
  if (laneMatch) {
    const lane = laneMatch[1];
    const waitedMs = parseInt(laneMatch[2], 10);
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();

    events.laneWaitExceeded = { timestamp: ts, waitedMs, lane };
    log(`DETECTED: lane "${lane}" waited ${Math.round(waitedMs / 1000)}s`);

    if (waitedMs >= LANE_STUCK_THRESHOLD_MS) {
      checkForDeadlock();
    }
    return;
  }

  // Match: LLM request timed out (failover error)
  if (line.includes('LLM request timed out') && line.includes('lane=')) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();
    events.agentTimeout = ts;
    log(`DETECTED: LLM timeout at ${new Date(ts).toISOString()}`);
    checkForDeadlock();
    return;
  }
}

function checkForDeadlock() {
  // Case 1: Lane wait exceeded threshold on its own
  if (events.laneWaitExceeded && events.laneWaitExceeded.waitedMs >= LANE_STUCK_THRESHOLD_MS) {
    const pid = getGatewayPid();
    if (pid) {
      sendSigusr1(pid, `lane "${events.laneWaitExceeded.lane}" blocked for ${Math.round(events.laneWaitExceeded.waitedMs / 1000)}s`);
    } else {
      log('WARNING: gateway PID not found, cannot send signal');
    }
    return;
  }

  // Case 2: Agent timeout + lane wait within 2-minute window
  if (events.agentTimeout && events.laneWaitExceeded) {
    const timeDiff = Math.abs(events.agentTimeout - events.laneWaitExceeded.timestamp);
    if (timeDiff < 2 * 60 * 1000) {
      const pid = getGatewayPid();
      if (pid) {
        sendSigusr1(pid, `agent timeout + lane wait detected within ${Math.round(timeDiff / 1000)}s`);
      } else {
        log('WARNING: gateway PID not found, cannot send signal');
      }
    }
  }
}

// --- Log Tailing ---
function tailLog(filePath, label) {
  let fileSize = 0;
  try {
    const stat = fs.statSync(filePath);
    fileSize = stat.size; // Start from current end
  } catch {
    log(`WARNING: log file not found: ${filePath}`);
    return null;
  }

  log(`Tailing ${label}: ${filePath} (from byte ${fileSize})`);

  const watcher = fs.watch(filePath, { persistent: true }, () => {
    try {
      // Read from current fileSize to EOF — avoid TOCTOU race by not
      // pre-checking stat.size. createReadStream with just `start` reads
      // to the end of the file atomically, then we update fileSize from
      // the bytes actually read.
      const stream = fs.createReadStream(filePath, {
        start: fileSize,
        encoding: 'utf8'
      });
      let buffer = '';
      let bytesRead = 0;
      stream.on('data', chunk => { buffer += chunk; bytesRead += Buffer.byteLength(chunk, 'utf8'); });
      stream.on('end', () => {
        if (bytesRead === 0) return; // no new data
        const lines = buffer.split('\n').filter(Boolean);
        for (const line of lines) {
          parseLine(line);
        }
        fileSize += bytesRead;
      });
      stream.on('error', (err) => {
        if (err.code === 'ENOENT') {
          // File was deleted/rotated — reset position
          fileSize = 0;
        } else {
          log(`ERROR: reading ${label}: ${err.message}`);
        }
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        fileSize = 0;
      } else {
        log(`ERROR: reading ${label}: ${err.message}`);
      }
    }
  });

  return watcher;
}

// --- Tracer Instrumentation ---
tailLog = tracer.wrap('tailLog', tailLog, { tier: 2, category: 'lifecycle' });
checkForDeadlock = tracer.wrap('checkForDeadlock', checkForDeadlock, { tier: 2, category: 'lifecycle' });
sendSigusr1 = tracer.wrap('sendSigusr1', sendSigusr1, { tier: 2, category: 'lifecycle' });

// --- Main ---
function main() {
  log('Starting lane watchdog');
  log(`Config: threshold=${LANE_STUCK_THRESHOLD_MS / 1000}s, poll=${POLL_INTERVAL_MS / 1000}s, cooldown=${COOLDOWN_MS / 1000}s`);

  const pid = getGatewayPid();
  if (pid) {
    log(`Gateway PID: ${pid}`);
  } else {
    log('WARNING: gateway not running — will retry on detection');
  }

  logWatcher = tailLog(GATEWAY_LOG, 'gateway.log');
  errWatcher = tailLog(GATEWAY_ERR_LOG, 'gateway.err.log');

  // Graceful shutdown
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      log(`Received ${sig}, shutting down`);
      if (logWatcher) logWatcher.close();
      if (errWatcher) errWatcher.close();
      process.exit(0);
    });
  }

  log('Lane watchdog active');
}

main();
