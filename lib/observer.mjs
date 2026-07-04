/**
 * observer.mjs — a standalone, five-layer uptime + activity observer.
 *
 * One cheap sample every 60s records, as INDEPENDENT timelines:
 *   1. VM / system uptime          — boot time + heartbeat gaps
 *   2. openclaw-node uptime        — the always-on core services
 *   3. active interaction uptime   — a live session touching transcripts
 *   4. memory-system uptime        — the memory daemon alive + DBs reachable
 *   5. memory activity (timestamped)— structured feed of extraction/flush/
 *                                     index/consolidation events
 *
 * Design: standalone (its own timer, no heavy probes) so it only stops when the
 * VM does — that IS the layer-1 signal — and never crashes under the load that
 * makes the memory system struggle. Two append-only ledgers: the per-sample
 * timeline and the memory-activity feed. A gap between samples is the "system
 * was asleep here" inscription; a boot-time change marks it a reboot vs a
 * mere service restart.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
export const STATE_DIR = path.join(HOME, '.openclaw', 'state');
export const DEFAULT_LEDGER = path.join(STATE_DIR, 'observer.jsonl');
export const DEFAULT_ACTIVITY = path.join(STATE_DIR, 'memory-activity.jsonl');
const DEFAULT_LOGPOS = path.join(STATE_DIR, 'observer-logpos.json');
const DEFAULT_DAEMON_LOG = path.join(HOME, '.openclaw', 'workspace', '.tmp', 'memory-daemon.log');
const DEFAULT_DAEMON_STATE = path.join(HOME, '.openclaw', 'workspace', '.tmp', 'daemon-state.json');
const DEFAULT_STATE_DB = path.join(HOME, '.openclaw', 'state.db');

// A gap larger than this between samples means the observer (hence the VM, or
// at least the observer's timer) was down. 5 missed 60s samples.
export const GAP_THRESHOLD_MS = 5 * 60_000;
// Interaction is "active" only if a session touched a transcript this recently.
export const INTERACTION_WINDOW_MS = 15 * 60_000;
// Memory is "working" only if a structured extraction succeeded this recently.
export const WORKING_WINDOW_MS = 6 * 3600_000;

// The always-on core. The periodic timer jobs (scheduler-heartbeat,
// consolidation-scheduler, transcript-archive) are DOWN between fires by
// design, so they are NOT part of node-up.
export const CORE_SERVICES = [
  'ai.openclaw.nats',
  'ai.openclaw.gateway',
  'ai.openclaw.memory-daemon',
  'ai.openclaw.mission-control',
  'ai.openclaw.node-watch',
  'ai.openclaw.health-watch',
];

export function machineBootMs() {
  try {
    const sysctl = existsSync('/usr/sbin/sysctl') ? '/usr/sbin/sysctl' : 'sysctl';
    const out = execFileSync(sysctl, ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 2000 });
    const m = out.match(/sec\s*=\s*(\d+)/);
    if (m) return Number(m[1]) * 1000;
  } catch { /* linux / unavailable */ }
  try {
    const btime = readFileSync('/proc/stat', 'utf8').match(/^btime\s+(\d+)/m);
    if (btime) return Number(btime[1]) * 1000;
  } catch { /* unavailable */ }
  return null;
}

/** launchctl roster → { up:[names], down:[names] } for the core services. */
export function coreServiceRoster(opts = {}) {
  if (opts.roster) return opts.roster; // injectable for tests
  let lines = '';
  try { lines = execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000 }); }
  catch { return { up: [], down: CORE_SERVICES.slice(), unknown: true }; }
  const byName = new Map();
  for (const line of lines.split('\n')) {
    const cols = line.split('\t');
    if (cols.length >= 3) byName.set(cols[2].trim(), /^\d+$/.test(cols[0].trim()));
  }
  const up = [], down = [];
  for (const s of CORE_SERVICES) (byName.get(s) ? up : down).push(s);
  return { up, down };
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

/** Take one multi-layer sample. All reads cheap; paths injectable for tests. */
export function sampleLayers(opts = {}) {
  const now = opts.now ?? Date.now();
  const daemonStatePath = opts.daemonStatePath ?? DEFAULT_DAEMON_STATE;
  const stateDbPath = opts.stateDbPath ?? DEFAULT_STATE_DB;

  // Layer 3 + 4: interaction state + memory-daemon liveness (one file)
  let dstate = null;
  try { if (existsSync(daemonStatePath)) dstate = JSON.parse(readFileSync(daemonStatePath, 'utf8')); }
  catch { /* best-effort */ }
  const lastActivity = dstate?.lastActivityTime ?? null;
  const idleMs = lastActivity ? now - lastActivity : null;
  const interactionState = dstate?.state ?? '?';
  const interacting = interactionState === 'ACTIVE'
    && idleMs != null && idleMs < INTERACTION_WINDOW_MS;

  const daemonUp = opts.daemonUp ?? pidAlive(dstate?.pid);

  // Layer 4 detail: last successful structured extraction (the frozen-brain pulse)
  const lastExtraction = opts.lastExtraction ?? readLastExtraction(stateDbPath);
  const extractionAgeH = lastExtraction
    ? Math.round((now - Date.parse(lastExtraction)) / 3600_000 * 10) / 10 : null;

  // Layer 2: core services
  const roster = coreServiceRoster(opts);

  return {
    ts: new Date(now).toISOString(),
    vm_boot: opts.boot ?? machineBootMs(),
    node: { core_up: roster.up.length, core_total: CORE_SERVICES.length, down: roster.down },
    interaction: {
      state: interactionState,
      session: dstate?.sessionId ? String(dstate.sessionId).slice(0, 8) : null,
      idle_s: idleMs != null ? Math.round(idleMs / 1000) : null,
      active: interacting,
    },
    memory: {
      daemon: daemonUp,
      last_extraction: lastExtraction,
      extraction_age_h: extractionAgeH,
      working: extractionAgeH != null && (extractionAgeH * 3600_000) < WORKING_WINDOW_MS,
    },
  };
}

function readLastExtraction(stateDbPath) {
  if (!existsSync(stateDbPath)) return null;
  try {
    const out = execFileSync('sqlite3', ['-readonly', stateDbPath, 'SELECT MAX(created_at) FROM mentions;'],
      { encoding: 'utf8', timeout: 3000 }).trim();
    return out || null;
  } catch { return null; }
}

/** Append a sample; inscribe a gap record first if the previous is stale. */
export async function appendSample(sample, opts = {}) {
  const ledgerPath = opts.ledgerPath ?? DEFAULT_LEDGER;
  const now = Date.parse(sample.ts);
  const prev = await lastSample(ledgerPath);
  const lines = [];
  if (prev) {
    const gapMs = now - Date.parse(prev.ts);
    if (gapMs > GAP_THRESHOLD_MS) {
      const rebooted = prev.vm_boot != null && sample.vm_boot != null && prev.vm_boot !== sample.vm_boot;
      lines.push(JSON.stringify({
        event: 'gap', ts: sample.ts, from: prev.ts, to: sample.ts,
        minutes: Math.round(gapMs / 60_000),
        reason: rebooted ? 'reboot' : 'vm-or-observer-down',
      }));
    }
  }
  lines.push(JSON.stringify({ event: 'sample', ...sample }));
  ensureDir(ledgerPath);
  await appendFile(ledgerPath, lines.join('\n') + '\n', 'utf8');
  return { gapInscribed: lines.length > 1 };
}

async function lastSample(ledgerPath) {
  try {
    const text = await readFile(ledgerPath, 'utf8');
    const samples = text.trimEnd().split('\n').filter(Boolean)
      .map(safeParse).filter((r) => r && r.event === 'sample');
    return samples.length ? samples[samples.length - 1] : null;
  } catch { return null; }
}

// ── Layer 5: memory activity feed ────────────────────────────────────────────

// Each pattern lifts a memory event out of the daemon log into a structured
// record. Order matters only for readability; every line is tested once.
const ACTIVITY_PATTERNS = [
  { re: /Phase 2: interval synthesis \[(llm|regex)\]: (\d+) facts found(?:, (\d+) added)?/, kind: 'synthesis', map: (m) => ({ mode: m[1], facts: +m[2], added: m[3] ? +m[3] : undefined }) },
  { re: /(?:flush|pre-compression flush) \[(llm|regex)\]: (\d+) facts found/, kind: 'flush', map: (m) => ({ mode: m[1], facts: +m[2] }) },
  { re: /Phase 2: knowledge-index: (\d+) sessions indexed \((\d+) chunks\)/, kind: 'knowledge-index', map: (m) => ({ sessions: +m[1], chunks: +m[2] }) },
  { re: /Phase 2: graph-cache refreshed: (\d+) nodes(?:, (\d+) edges)?/, kind: 'graph-cache', map: (m) => ({ nodes: +m[1], edges: m[2] ? +m[2] : undefined }) },
  { re: /(?:Phase 2: )?(?:vault surfaces|session note|decision note|theme note)s?[^\n]*/, kind: 'vault-notes', map: () => ({}) },
  { re: /Phase 2: obsidian-sync done/, kind: 'obsidian-sync', map: () => ({}) },
  { re: /Decayed: (\d+) entities, (\d+) decisions/, kind: 'consolidation-decay', map: (m) => ({ entities: +m[1], decisions: +m[2] }) },
  { re: /Promotion(?: candidates)?: (\d+) entities/, kind: 'promotion', map: (m) => ({ entities: +m[1] }) },
  { re: /extraction_failure_rate — (\d+)\/(\d+) extractions failed/, kind: 'extraction-failure', map: (m) => ({ failed: +m[1], of: +m[2] }) },
];

// `[2026-07-04, 12:48:18]` (Montreal local, as the daemon writes it) → ISO-ish.
function parseDaemonTs(stamp) {
  const m = stamp.match(/\[(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})\]/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Parse memory-activity records out of raw daemon-log text. Pure. */
export function extractActivity(logText) {
  const out = [];
  for (const line of String(logText).split('\n')) {
    const tsStr = parseDaemonTs(line);
    if (!tsStr) continue;
    for (const p of ACTIVITY_PATTERNS) {
      const m = line.match(p.re);
      if (m) { out.push({ ts: tsStr, kind: p.kind, ...p.map(m) }); break; }
    }
  }
  return out;
}

/**
 * Scan NEW daemon-log lines since the last recorded byte offset, structure the
 * memory events, append them to the activity feed. Tracks offset so each event
 * is recorded once; resets on log rotation (file shorter than the offset).
 */
export async function scanMemoryActivity(opts = {}) {
  const logPath = opts.daemonLogPath ?? DEFAULT_DAEMON_LOG;
  const activityPath = opts.activityPath ?? DEFAULT_ACTIVITY;
  const posPath = opts.logPosPath ?? DEFAULT_LOGPOS;
  if (!existsSync(logPath)) return { appended: 0 };

  let pos = 0;
  try { pos = JSON.parse(readFileSync(posPath, 'utf8')).pos ?? 0; } catch { /* first run */ }
  const size = statSync(logPath).size;
  if (size < pos) pos = 0; // rotated/truncated
  if (size === pos) return { appended: 0 };

  const text = await readFile(logPath, 'utf8');
  const fresh = text.slice(pos);
  const events = extractActivity(fresh);
  if (events.length) {
    ensureDir(activityPath);
    await appendFile(activityPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  ensureDir(posPath);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(posPath, JSON.stringify({ pos: size }), 'utf8');
  return { appended: events.length, events };
}

// ── Readers ──────────────────────────────────────────────────────────────────

/** Reconstruct all five layers' rollups from the sample ledger. */
export function readTimeline(text, opts = {}) {
  const now = opts.now ?? Date.now();
  const sinceMs = opts.since ? (typeof opts.since === 'number' ? opts.since : Date.parse(opts.since)) : 0;
  const records = String(text).trimEnd().split('\n').filter(Boolean)
    .map(safeParse).filter(Boolean)
    .filter((r) => Date.parse(r.ts) >= sinceMs)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const samples = records.filter((r) => r.event === 'sample');
  const gaps = records.filter((r) => r.event === 'gap');
  if (!samples.length) return { samples: 0, empty: true };

  // Between consecutive in-window samples, credit each layer's "up" time when
  // that sample reported the layer up (a sample stands for the interval to the
  // next). Gaps count as VM-down for every layer.
  const acc = { vmUp: 0, nodeUp: 0, interactUp: 0, memoryUp: 0, memoryWorking: 0, span: 0 };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dt = Date.parse(b.ts) - Date.parse(a.ts);
    if (dt <= 0 || dt > GAP_THRESHOLD_MS) continue; // gap handled separately
    acc.span += dt;
    acc.vmUp += dt;
    if (a.node?.core_up === a.node?.core_total) acc.nodeUp += dt;
    if (a.interaction?.active) acc.interactUp += dt;
    if (a.memory?.daemon) acc.memoryUp += dt;
    if (a.memory?.working) acc.memoryWorking += dt;
  }
  const offMs = gaps.reduce((s, g) => s + g.minutes * 60_000, 0);
  const wallMs = acc.span + offMs;
  const pct = (n) => wallMs > 0 ? Math.round(1000 * n / wallMs) / 10 : null;

  const last = samples[samples.length - 1];
  const stale = now - Date.parse(last.ts) > GAP_THRESHOLD_MS;

  return {
    samples: samples.length,
    windowFrom: samples[0].ts,
    windowTo: last.ts,
    off: { ms: offMs, reboots: gaps.filter((g) => g.reason === 'reboot').length, longestMin: gaps.reduce((m, g) => Math.max(m, g.minutes), 0), events: gaps },
    layers: {
      vm:          { uptimePct: pct(acc.vmUp),          current: stale ? 'OFF' : 'UP', bootMs: last.vm_boot },
      node:        { uptimePct: pct(acc.nodeUp),        current: stale ? 'OFF' : `${last.node.core_up}/${last.node.core_total} core`, down: last.node.down },
      interaction: { uptimePct: pct(acc.interactUp),    current: stale ? 'OFF' : (last.interaction.active ? `ACTIVE (${last.interaction.session})` : last.interaction.state), idle_s: last.interaction.idle_s },
      memory:      { uptimePct: pct(acc.memoryUp),      workingPct: pct(acc.memoryWorking), current: stale ? 'OFF' : (last.memory.daemon ? (last.memory.working ? 'WORKING' : 'IDLE (not extracting)') : 'DOWN'), extraction_age_h: last.memory.extraction_age_h },
    },
    lastSampleTs: last.ts,
    lastSampleStale: stale,
  };
}

/** Parse + summarize the memory-activity feed. */
export function readActivity(text, opts = {}) {
  const sinceMs = opts.since ? (typeof opts.since === 'number' ? opts.since : Date.parse(opts.since)) : 0;
  const events = String(text).trimEnd().split('\n').filter(Boolean)
    .map(safeParse).filter(Boolean)
    .filter((e) => Date.parse(e.ts) >= sinceMs)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const byKind = {};
  let lastLlm = null, lastAny = null;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    lastAny = e.ts;
    if ((e.kind === 'synthesis' || e.kind === 'flush') && e.mode === 'llm') lastLlm = e.ts;
  }
  return { events, count: events.length, byKind, lastLlmExtraction: lastLlm, lastActivity: lastAny };
}

function safeParse(l) { try { return JSON.parse(l); } catch { return null; } }
function ensureDir(file) { try { mkdirSync(path.dirname(file), { recursive: true }); } catch { /* exists */ } }
