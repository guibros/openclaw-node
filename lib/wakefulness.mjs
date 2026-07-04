/**
 * wakefulness.mjs — an append-only ledger of the memory system's on/off/idle
 * timeline, so "was the bot awake, asleep, or awake-but-not-working?" is a
 * glanceable fact instead of an hour of `last reboot` + log-grep archaeology.
 *
 * Motivation (2026-07-04): the structured brain froze on Jun 16 and it took
 * cross-referencing reboot history against daemon log line-counts against
 * extraction-failure alerts to learn WHY — because three causes stacked
 * (real machine downtime, a dead transcript-registry path leaving the daemon
 * idle-blind, and genuine LLM extraction failures). None of the existing
 * surfaces record a TIMELINE: node-watch overwrites its snapshot every tick,
 * health-watch writes only on status change. This ledger is the missing tab.
 *
 * The heartbeat SOURCE is node-watch's existing 60s loop (no new daemon —
 * MASTER_PLAN forbids parallel monitors). Each tick appends one record; a gap
 * in the record timestamps IS the "asleep" signal (a down system can't
 * self-report). Every record also carries daemon-state + extraction freshness,
 * so an awake system that is merely idle (or failing) is distinguishable from
 * one that is actually forming memories.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_LEDGER = path.join(os.homedir(), '.openclaw', 'state', 'wakefulness.jsonl');

// A gap larger than this between heartbeats means the system was down (or the
// heartbeat source was). 5 minutes = 5 missed 60s ticks — well past jitter.
export const GAP_THRESHOLD_MS = 5 * 60_000;

// Awake but "not working": no successful extraction within this window.
export const STALE_EXTRACTION_MS = 6 * 3600_000;

/** Machine boot time (epoch ms) — a change between records means a reboot,
 *  distinguishing "machine was off" from "only the daemon restarted". */
export function machineBootMs() {
  try {
    // darwin: `{ sec = 1783146635, usec = ... }`
    const out = execSync('sysctl -n kern.boottime', { encoding: 'utf8', timeout: 2000 });
    const m = out.match(/sec\s*=\s*(\d+)/);
    if (m) return Number(m[1]) * 1000;
  } catch { /* linux / unavailable */ }
  try {
    const btime = readFileSync('/proc/stat', 'utf8').match(/^btime\s+(\d+)/m);
    if (btime) return Number(btime[1]) * 1000;
  } catch { /* unavailable */ }
  return null;
}

/**
 * Build one heartbeat sample from a node-watch report plus cheap local reads.
 * Pure w.r.t. its inputs — the file paths are injectable for tests.
 */
export function deriveWakeSample(report, opts = {}) {
  const now = opts.now ?? Date.now();
  const daemonStatePath = opts.daemonStatePath
    ?? path.join(os.homedir(), '.openclaw', 'workspace', '.tmp', 'daemon-state.json');
  const stateDbPath = opts.stateDbPath ?? path.join(os.homedir(), '.openclaw', 'state.db');

  let daemonState = '?';
  try {
    if (existsSync(daemonStatePath)) {
      daemonState = JSON.parse(readFileSync(daemonStatePath, 'utf8')).state || '?';
    }
  } catch { /* best-effort */ }

  // Daemon aliveness: prefer the node-watch report's probe, else check the
  // recorded pid directly. The direct check keeps the heartbeat meaningful
  // even when it fires WITHOUT a full report (the robust pre-sweep path) — a
  // heartbeat that only works after node-watch's crash-prone deep sweep would
  // report false-OFF under exactly the load that crashes the sweep.
  const daemonResult = report?.results?.find((r) => r.id === 'mem.daemon');
  let daemonUp = opts.daemonUp ?? (daemonResult ? daemonResult.status === 'WORKING' : null);
  if (daemonUp === null && daemonState !== '?') {
    try {
      const pid = JSON.parse(readFileSync(daemonStatePath, 'utf8')).pid;
      if (pid) { process.kill(pid, 0); daemonUp = true; }
    } catch (e) { daemonUp = e && e.code === 'EPERM' ? true : false; }
  }

  let lastExtraction = opts.lastExtraction ?? null;
  if (lastExtraction === null && opts.readExtraction !== false) {
    lastExtraction = readLastExtraction(stateDbPath);
  }
  const extractionAgeH = lastExtraction
    ? Math.round((now - Date.parse(lastExtraction)) / 3600_000 * 10) / 10
    : null;

  return {
    ts: new Date(now).toISOString(),
    boot: opts.boot ?? machineBootMs(),
    health: report?.health ?? null,
    daemon: daemonUp === null ? '?' : (daemonUp ? 'up' : 'down'),
    daemon_state: daemonState,
    last_extraction: lastExtraction,
    extraction_age_h: extractionAgeH,
    working: extractionAgeH != null && (extractionAgeH * 3600_000) < STALE_EXTRACTION_MS,
  };
}

function readLastExtraction(stateDbPath) {
  if (!existsSync(stateDbPath)) return null;
  try {
    // Read-only, one row — cheaper to shell to sqlite3 than load a driver here
    // (this runs inside the watch tick; keep it dependency-light).
    const out = execSync(
      `sqlite3 -readonly "${stateDbPath}" "SELECT MAX(created_at) FROM mentions;"`,
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    return out || null;
  } catch { return null; }
}

/**
 * Append a heartbeat. If the previous record is older than GAP_THRESHOLD_MS
 * (or the ledger is empty), first inscribe a `gap` record marking the downtime
 * — the explicit "the system was asleep here" flag.
 */
export async function appendWakeRecord(sample, opts = {}) {
  const ledgerPath = opts.ledgerPath ?? DEFAULT_LEDGER;
  const now = Date.parse(sample.ts);

  const prev = await lastRecord(ledgerPath);
  const lines = [];
  if (prev) {
    const prevTs = Date.parse(prev.ts);
    const gapMs = now - prevTs;
    if (gapMs > GAP_THRESHOLD_MS) {
      const bootChanged = prev.boot != null && sample.boot != null && prev.boot !== sample.boot;
      lines.push(JSON.stringify({
        ts: sample.ts,
        event: 'gap',
        from: prev.ts,
        to: sample.ts,
        minutes: Math.round(gapMs / 60_000),
        reason: bootChanged ? 'reboot' : 'daemon-or-monitor-down',
      }));
    }
  }
  lines.push(JSON.stringify({ event: 'heartbeat', ...sample }));

  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, lines.join('\n') + '\n', 'utf8');
  return { gapInscribed: lines.length > 1 };
}

async function lastRecord(ledgerPath) {
  try {
    const text = await readFile(ledgerPath, 'utf8');
    const heartbeats = text.trimEnd().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.event === 'heartbeat');
    return heartbeats.length ? heartbeats[heartbeats.length - 1] : null;
  } catch { return null; }
}

/**
 * Reconstruct the on/off/idle timeline from the ledger.
 * Returns intervals + rollup stats. `since`/`now` injectable for tests.
 */
export function readTimeline(text, opts = {}) {
  const now = opts.now ?? Date.now();
  const sinceMs = opts.since ? (typeof opts.since === 'number' ? opts.since : Date.parse(opts.since)) : 0;

  const records = String(text).trimEnd().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((r) => Date.parse(r.ts) >= sinceMs)
    // robust to any out-of-order lines (concurrent writers, clock skew)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const heartbeats = records.filter((r) => r.event === 'heartbeat');
  const gaps = records.filter((r) => r.event === 'gap');

  if (heartbeats.length === 0) {
    return { intervals: [], awakeMs: 0, offMs: 0, uptimePct: null,
             longestGapMin: 0, reboots: 0, current: null, heartbeats: 0 };
  }

  // Awake intervals: contiguous heartbeat runs, split by gap records.
  const intervals = [];
  let runStart = heartbeats[0].ts;
  let prev = heartbeats[0];
  const gapAfter = new Set(gaps.map((g) => g.from)); // a gap follows heartbeat at g.from

  let workingMs = 0, idleMs = 0;
  const accrue = (from, to, working) => {
    const ms = Math.max(0, Date.parse(to) - Date.parse(from));
    if (working) workingMs += ms; else idleMs += ms;
  };

  for (let i = 1; i < heartbeats.length; i++) {
    const hb = heartbeats[i];
    accrue(prev.ts, hb.ts, prev.working);
    if (gapAfter.has(prev.ts)) {
      intervals.push({ kind: 'awake', from: runStart, to: prev.ts });
      const g = gaps.find((x) => x.from === prev.ts);
      intervals.push({ kind: 'off', from: g.from, to: g.to, minutes: g.minutes, reason: g.reason });
      runStart = hb.ts;
    }
    prev = hb;
  }
  intervals.push({ kind: 'awake', from: runStart, to: prev.ts });

  const awakeMs = workingMs + idleMs;
  const offMs = gaps.reduce((s, g) => s + g.minutes * 60_000, 0);
  const longestGapMin = gaps.reduce((m, g) => Math.max(m, g.minutes), 0);
  const reboots = gaps.filter((g) => g.reason === 'reboot').length;

  const last = heartbeats[heartbeats.length - 1];
  const staleMs = now - Date.parse(last.ts);
  const current = staleMs > GAP_THRESHOLD_MS
    ? { state: 'OFF', since: last.ts, forMin: Math.round(staleMs / 60_000) }
    : { state: last.working ? 'AWAKE-WORKING' : 'AWAKE-IDLE',
        daemon: last.daemon, daemon_state: last.daemon_state,
        health: last.health, extraction_age_h: last.extraction_age_h };

  return {
    intervals,
    heartbeats: heartbeats.length,
    awakeMs, offMs,
    workingMs, idleMs,
    uptimePct: awakeMs + offMs > 0 ? Math.round(1000 * awakeMs / (awakeMs + offMs)) / 10 : null,
    workingPctOfAwake: awakeMs > 0 ? Math.round(1000 * workingMs / awakeMs) / 10 : null,
    longestGapMin, reboots, current,
  };
}
