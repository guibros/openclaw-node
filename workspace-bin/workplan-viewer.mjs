#!/usr/bin/env node
// workplan-viewer.mjs — local dashboard for stepped-workplan implementations.
//
// Generic: auto-discovers any directory that follows the workplan framework
// structure (has INVENTORY.md + VERSION). Lists every detected plan in a left
// sidebar; per-plan tabs show the live tick transcript, the step inventory
// with linked audit docs, the framework/reference documents, and tick-log
// history.
//
// Independent from mission-control (which runs on :3000).
//
// Discovery roots (in priority order):
//   1. $WORKPLAN_ROOTS — colon-separated list of dirs to scan
//   2. The current working directory (process.cwd())
// Within each root, every immediate subdirectory that contains BOTH
// INVENTORY.md and VERSION is registered as a plan.
//
// Usage:
//   ./workspace-bin/workplan-viewer.mjs                       # bind :7892
//   WORKPLAN_VIEWER_PORT=9000 ./workspace-bin/workplan-viewer.mjs
//   WORKPLAN_ROOTS=/path/a:/path/b ./workspace-bin/workplan-viewer.mjs
//
// Stop with Ctrl-C. Safe to run detached:
//   nohup ./workspace-bin/workplan-viewer.mjs </dev/null \
//         >>/tmp/workplan-viewer.log 2>&1 & disown

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { createViewerAuth, checkViewerRequest, viewerTokenPath } from '../lib/workplan-viewer-auth.mjs';

// Promise wrapper around execFile with a timeout.
function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || ''), rc: err?.code ?? 0 });
    });
  });
}

const PORT = Number(process.env.WORKPLAN_VIEWER_PORT || 7892);
const viewerAuth = createViewerAuth();
const clientScript = fs.readFileSync(new URL('./workplan-viewer-client.js', import.meta.url));
const sessionScript = fs.readFileSync(new URL('../lib/workplan-viewer-client.mjs', import.meta.url));
const ROOTS = (process.env.WORKPLAN_ROOTS
  ? process.env.WORKPLAN_ROOTS.split(':')
  : [path.join(process.cwd(), 'memory-plan', 'plans')])
  .map(p => path.resolve(p))
  .filter(p => fs.existsSync(p));

// ── Plan discovery ────────────────────────────────────────────────────────────
// A "plan" is any immediate subdirectory containing both INVENTORY.md and
// VERSION. Refreshed every minute so new plans are picked up live.

function discoverPlans() {
  const seen = new Map();
  for (const root of ROOTS) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.')) continue;
      if (ent.name === 'node_modules') continue;
      const dir = path.join(root, ent.name);
      if (!fs.existsSync(path.join(dir, 'INVENTORY.md'))) continue;
      if (!fs.existsSync(path.join(dir, 'VERSION'))) continue;
      if (!seen.has(ent.name)) {
        seen.set(ent.name, { id: ent.name, root, dir });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

let PLANS = discoverPlans();
setInterval(() => { PLANS = discoverPlans(); }, 60_000);

function findPlan(id) {
  return PLANS.find(p => p.id === id) || null;
}

// ── State-transition notifications (server-side banner + sound) ────────────────
// Fires the shared memory-plan-notify.sh on plan transitions, so the operator
// hears/sees them whether or not a browser tab is open:
//   forward (step closed / version advanced) → 'closed' → Glass chime
//   plan became BLOCKED                       → 'blocked' → Sosumi alert
// Disable with MEMORY_PLAN_NOTIFY=off.
const HERE = path.dirname(new URL(import.meta.url).pathname);
const NOTIFY_CLI = path.join(HERE, '..', 'bin', 'openclaw-notify.mjs');
const NOTIFY_CLI_OK = fs.existsSync(NOTIFY_CLI);
const NOTIFY_CONFIG_FILE = path.join(os.homedir(), '.openclaw', 'config', 'workplan-viewer.json');

// Runtime on/off switch (toggled from the header button, persisted across restarts).
// Boot value: the persisted file if present, else the MEMORY_PLAN_NOTIFY env default.
function loadNotifyEnabled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(NOTIFY_CONFIG_FILE, 'utf8'));
    if (typeof cfg.notify === 'boolean') return cfg.notify;
  } catch { /* no file / bad json → fall through to env default */ }
  return (process.env.MEMORY_PLAN_NOTIFY ?? 'on') !== 'off';
}
let notifyEnabled = loadNotifyEnabled();

function saveNotifyEnabled(v) {
  notifyEnabled = !!v;
  try {
    fs.mkdirSync(path.dirname(NOTIFY_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(NOTIFY_CONFIG_FILE, JSON.stringify({ notify: notifyEnabled }, null, 2) + '\n');
  } catch { /* best-effort persist */ }
  return notifyEnabled;
}

function fireNotify(kind, version, message, planId) {
  // kind: 'closed' (forward) | 'blocked'. Every event is ledgered by the CLI and
  // the popup click-links back to this viewer, deep-linked to the plan.
  if (!notifyEnabled || !NOTIFY_CLI_OK) return;
  const blocked = kind === 'blocked';
  const args = [
    NOTIFY_CLI,
    '--source', 'workplan',
    '--kind', blocked ? 'block' : 'success',
    '--title', blocked ? 'Workplan — BLOCKED' : 'Workplan — step forward',
    '--subtitle', String(version || ''),
    '--message', String(message || ''),
    '--url', `http://127.0.0.1:${PORT}/${planId ? '?plan=' + encodeURIComponent(planId) : ''}`,
  ];
  try {
    execFile(process.execPath, args, { timeout: 10_000 }, () => {});
  } catch { /* best-effort; never block the viewer */ }
}

// Find the inventory row for a version (ignoring any -pre/-mid suffix).
function stepRowForVersion(plan, version) {
  const base = String(version || '').replace(/-(pre|mid)$/, '');
  try { return (inventoryRows(plan) || []).find(r => r.version === base) || null; }
  catch { return null; }
}
function clip(s, n = 90) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Message for a forward transition: name the step + its description.
function forwardMessage(plan, version, prevVersion) {
  const row = stepRowForVersion(plan, version);
  const suffix = (/-(pre|mid)$/.exec(version) || [])[1];
  if (row) {
    return suffix
      ? `step ${row.step} (${suffix}) — ${clip(row.desc)}`
      : `step ${row.step} closed — ${clip(row.desc)}`;
  }
  return `${prevVersion} → ${version}`;
}
// Message for a block: name the step it's stuck on (the current/next step).
function blockMessage(summary) {
  const cs = summary.current_step;
  return cs ? `blocked at step ${cs.step} — ${clip(cs.desc)}` : 'plan BLOCKED — see BLOCKED.md';
}

// Track last-seen {version, blocked, closed} per plan; fire only on transitions.
// First sight of a plan seeds silently (no notification storm on viewer start).
const notifyState = new Map();
function pollNotifications() {
  for (const plan of PLANS) {
    let s;
    try { s = planSummary(plan); } catch { continue; }
    const cur = { version: s.version, blocked: !!s.blocked, closed: s.closed_steps };
    const prev = notifyState.get(plan.id);
    notifyState.set(plan.id, cur);
    if (!prev) continue; // seed silently
    if (cur.blocked && !prev.blocked) {
      const msg = blockMessage(s);
      fireNotify('blocked', cur.version, `${plan.id}: ${msg}`, plan.id);
      console.log(`[notify] ${plan.id} BLOCKED at ${cur.version} — ${msg}`);
    } else if (cur.closed > prev.closed || cur.version !== prev.version) {
      const msg = forwardMessage(plan, cur.version, prev.version);
      fireNotify('closed', cur.version, `${plan.id}: ${msg}`, plan.id);
      console.log(`[notify] ${plan.id} forward ${prev.version}→${cur.version} — ${msg}`);
    }
  }
}
setInterval(pollNotifications, 12_000);

// ── Plan-state probes ─────────────────────────────────────────────────────────

const planTickLogDir = (p) => path.join(p.dir, 'tick-logs');
const planAuditsDir  = (p) => path.join(p.dir, 'audits');

function readVersion(plan) {
  try { return fs.readFileSync(path.join(plan.dir, 'VERSION'), 'utf8').trim(); }
  catch { return '<missing>'; }
}

const isBlocked = (p) => fs.existsSync(path.join(p.dir, 'BLOCKED.md'));
const isLocked  = (p) => fs.existsSync(path.join(p.dir, '.tick.lock'));
// Newest-content signal for the plan: max mtime across its top-level *.md +
// VERSION, plus the tick-logs/audits dir mtimes (file add/remove). The client
// re-renders the active panel only when this changes — live updates, no flicker.
const planDocsMtime = (p) => {
  let max = 0;
  const bump = (full) => { try { const m = fs.statSync(full).mtimeMs; if (m > max) max = m; } catch { /* gone */ } };
  try { for (const f of fs.readdirSync(p.dir)) if (f.endsWith('.md') || f === 'VERSION') bump(path.join(p.dir, f)); } catch { /* dir gone */ }
  bump(planTickLogDir(p));
  bump(planAuditsDir(p));
  return max;
};

// Is the repo working tree dirty? (uncommitted work — the state the tick's
// auto-pause keys on). Surfaced so a silent half-done step is visible.
// `git -C <plan.dir>` makes it cwd-independent; absolute-path fallback covers a
// minimal launchd PATH where bare `git` isn't resolvable.
const treeDirty = (p) => {
  for (const bin of ['git', '/usr/bin/git']) {
    try {
      const r = spawnSync(bin, ['-C', p.dir, 'status', '--porcelain'], { encoding: 'utf8' });
      if (r.status === 0) return r.stdout.trim().length > 0;
    } catch { /* try next */ }
  }
  return false;
};

// If BLOCKED.md names an **External action:** (a human must do something), return
// it — so the viewer can show "needs you" rather than a generic block.
const blockExternalAction = (p) => {
  try {
    const m = fs.readFileSync(path.join(p.dir, 'BLOCKED.md'), 'utf8')
      .match(/\*\*External action:\*\*\s*(.+)/i);
    return m ? m[1].trim() : null;
  } catch { return null; }
};

function inventoryRows(plan) {
  let raw;
  try { raw = fs.readFileSync(path.join(plan.dir, 'INVENTORY.md'), 'utf8'); }
  catch { return []; }
  const rows = [];
  // Status vocabulary: [ ] open · [A] in progress · [x] closed · [D] deferred.
  // Same contract as plan-tick/plan-lint: the first four columns are strict,
  // anything after is descriptive (repair's historical rows carry a sixth
  // "mode" column — the description is always the LAST cell).
  const re = /^\|\s*(\d+)\s*\|\s*(\d+\.\d+)\s*\|\s*(v\d+\.\d+)\s*\|\s*\[([xAD ])\]\s*\|(.+)\|\s*$/;
  for (const line of raw.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const cells = m[5].split('|').map(s => s.trim()).filter(Boolean);
    if (!cells.length) continue;
    rows.push({
      block: Number(m[1]),
      step: m[2],
      version: m[3],
      state: m[4],
      desc: cells[cells.length - 1],
    });
  }
  return rows;
}

// Names that are .log files but are NOT per-tick claude transcripts.
// They must NEVER be returned as the "live" log to stream — they contain
// supervisor-level noise (launchd's own stdout/stderr) or are convenience
// symlinks/aliases that we list separately.
const NON_TICK_LOG_PATTERNS = [
  /^launchd\./i,        // launchd.stdout.log, launchd.stderr.log
  /^current\.log$/,     // symlink alias — handled specially
];

function isPerTickLog(filename) {
  return filename.endsWith('.log') &&
         !NON_TICK_LOG_PATTERNS.some(re => re.test(filename));
}

function tickLogs(plan, limit = 100) {
  const dir = planTickLogDir(plan);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(isPerTickLog)
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    });
}

// Interactive step closures: one entry per audits/*/AUDIT_POST.md (a step that
// reached done), so the History tab reflects work done by hand — not only
// autonomous tick runs. Dir names are stepNN_slug (NN = block+step digits).
function auditClosures(plan, limit = 100) {
  const dir = planAuditsDir(plan);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir)) {
    let stat;
    try { stat = fs.statSync(path.join(dir, d, 'AUDIT_POST.md')); } catch { continue; } // PRE-only / not closed
    const m = d.match(/^step(\d)(\d+)_(.+)$/);
    const label = m ? `${m[1]}.${m[2]} ${m[3].replace(/_/g, ' ')}` : d;
    out.push({ kind: 'step', name: label, mtime: stat.mtimeMs, size: stat.size });
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

function latestLog(plan) {
  // Prefer the wrapper-maintained `current.log` symlink — it always points
  // at the running tick's log and atomically updates when a new tick starts.
  const dir = planTickLogDir(plan);
  const current = path.join(dir, 'current.log');
  if (fs.existsSync(current)) return current;
  // Fallback: highest-mtime real tick log (NOT lexicographic — handles
  // edge cases where filenames don't sort chronologically).
  const logs = tickLogs(plan, 1);
  return logs.length ? path.join(dir, logs[0].name) : null;
}

// Plans are FULLY SILOED. Every doc the viewer renders — MASTER_PLAN,
// DECISIONS, COMPONENT_REGISTRY, MEMORY_REDESIGN, INVENTORY, VERSION,
// WORKFLOW, audits, tick-logs, automation, and the Live/Progress/History streams —
// resolves ONLY from the plan's own dir. The viewer never reaches outside <root>/<id>/.
// Canonical docs (the cross-plan north star) are authored in memory-plan/canonical/
// and copied into each plan by workspace-bin/sync-canonical.sh, so each silo carries
// its own working copy and is portable on its own.

function planDocuments(plan) {
  const out = [];
  for (const f of fs.readdirSync(plan.dir).filter(f => f.endsWith('.md')).sort()) {
    const stat = fs.statSync(path.join(plan.dir, f));
    out.push({ name: f, size: stat.size, mtime: stat.mtimeMs, scope: 'plan' });
  }
  return out;
}

// ── Master-plan structured parsers (post-2026-05-27 docs) ──────────────────────
// Read COMPONENT_REGISTRY.md / DECISIONS.md. Each
// returns {present:false} when its doc is absent, so legacy plans (INVENTORY.md +
// VERSION only) don't break.

// Read a doc for a plan — STRICTLY from the plan's own dir. A plan never borrows
// another plan's docs, nor reaches outside its silo.
function readPlanFile(plan, name) {
  try { return fs.readFileSync(path.join(plan.dir, name), 'utf8'); }
  catch { return null; }
}

function parseRegistry(plan) {
  const raw = readPlanFile(plan, 'COMPONENT_REGISTRY.md');
  if (raw == null) return { present: false };
  const families = [];
  let curFamily = null;
  let curComp = null;
  for (const line of raw.split('\n')) {
    const fam = line.match(/^##\s+(Family\s+\d+:.+)$/);
    if (fam) {
      curFamily = { family: fam[1].trim(), components: [] };
      families.push(curFamily);
      curComp = null;
      continue;
    }
    const comp = line.match(/^###\s+(.+)$/);
    if (comp && curFamily) {
      curComp = { title: comp[1].trim(), status: null };
      curFamily.components.push(curComp);
      continue;
    }
    const st = line.match(/^\|\s*\*\*Status\*\*\s*\|\s*(.+?)\s*\|/);
    if (st && curFamily) {
      if (curComp && !curComp.status) {
        curComp.status = st[1].trim();
      } else if (!curComp) {
        // Family-level status table with no ### component (e.g. Family 8).
        curComp = { title: '(overall)', status: st[1].trim() };
        curFamily.components.push(curComp);
      }
    }
  }
  return { present: true, families };
}

function parseDecisions(plan) {
  const raw = readPlanFile(plan, 'DECISIONS.md');
  if (raw == null) return { present: false };
  const entries = [];
  for (const part of raw.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? '' : part.slice(nl + 1)).replace(/\n*---\s*$/, '').trim();
    if (title) entries.push({ title, body });
  }
  return { present: true, entries };
}

function planAudits(plan) {
  const dir = planAuditsDir(plan);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isDirectory()) continue;
    out[name] = {
      dirName: name,
      pre: fs.existsSync(path.join(full, 'AUDIT_PRE.md')),
      post: fs.existsSync(path.join(full, 'AUDIT_POST.md')),
    };
  }
  return out;
}

function planSummary(plan) {
  const rows = inventoryRows(plan);
  const closed = rows.filter(r => r.state === 'x').length;
  const active = rows.filter(r => r.state === 'A').length;
  const deferred = rows.filter(r => r.state === 'D').length;
  return {
    id: plan.id,
    dir: plan.dir,
    root: plan.root,
    version: readVersion(plan),
    blocked: isBlocked(plan),
    locked: isLocked(plan),
    closed_steps: closed,
    in_flight_steps: active,
    deferred_steps: deferred,
    // Deferred rows are deliberately out of the race: a plan whose remaining
    // rows are all [D] is complete, not stuck at closed < total forever.
    total_steps: rows.length - deferred,
    current_step: (rows.find(r => r.state === 'A') || rows.find(r => r.state === ' ') || null),
    latest_log: latestLog(plan)?.split('/').pop() || null,
    docs_mtime: planDocsMtime(plan),
    tree_dirty: treeDirty(plan),
    external_action: blockExternalAction(plan),
  };
}

// ── Automation (launchd) ──────────────────────────────────────────────────────
// Per-plan automation is described by an `automation.json` file at the plan
// root. If missing, defaults are derived from the plan id and the repo layout.
// Schema:
// {
//   "plist_label":      "com.openclaw.memory-plan-tick",
//   "plist_path":       "~/Library/LaunchAgents/<label>.plist",
//   "tick_command":     "/path/to/workspace-bin/<id>-tick.sh",
//   "working_dir":      "/path/to/repo",
//   "interval_seconds": 1800,
//   "stdout_path":      "...",
//   "stderr_path":      "...",
//   "env": { "PATH": "...", "HOME": "..." }
// }

const LAUNCH_AGENTS = path.join(os.homedir(), 'Library/LaunchAgents');

function deriveAutomationDefaults(plan) {
  const repo = plan.root;
  const id = plan.id;
  const label = `ai.openclaw.${id}-tick`;
  const cmd = path.join(repo, 'workspace-bin', `${id}-tick.sh`);
  return {
    plist_label: label,
    plist_path: path.join(LAUNCH_AGENTS, `${label}.plist`),
    tick_command: cmd,
    working_dir: repo,
    // Scheduling mode:
    //   'interval' — launchd StartInterval (every N seconds)
    //   'chain'    — launchd KeepAlive (restart on exit; throttle_seconds is
    //                the minimum gap launchd will enforce between restarts)
    mode: 'interval',
    interval_seconds: 1800,
    throttle_seconds: 30,
    stdout_path: path.join(plan.dir, 'tick-logs', 'launchd.stdout.log'),
    stderr_path: path.join(plan.dir, 'tick-logs', 'launchd.stderr.log'),
    env: {
      PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
      HOME: os.homedir(),
    },
  };
}

function readAutomationConfig(plan) {
  const file = path.join(plan.dir, 'automation.json');
  const defaults = deriveAutomationDefaults(plan);
  if (!fs.existsSync(file)) return { ...defaults, _persisted: false };
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaults, ...stored, _persisted: true };
  } catch (e) {
    return { ...defaults, _error: 'invalid automation.json: ' + e.message, _persisted: false };
  }
}

function writeAutomationConfig(plan, cfg) {
  const file = path.join(plan.dir, 'automation.json');
  const out = {
    plist_label: cfg.plist_label,
    plist_path: cfg.plist_path,
    tick_command: cfg.tick_command,
    working_dir: cfg.working_dir,
    mode: cfg.mode === 'chain' ? 'chain' : 'interval',
    interval_seconds: Number(cfg.interval_seconds),
    throttle_seconds: Number(cfg.throttle_seconds) || 30,
    stdout_path: cfg.stdout_path,
    stderr_path: cfg.stderr_path,
    env: cfg.env || {},
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

function plistEscape(s) {
  // For values placed inside <string>…</string>, escape XML.
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generatePlistXml(cfg) {
  // Inject auto-pause env vars so the wrapper can unload this job on fast-exit
  // paths (BLOCKED.md, dirty tree on clean VERSION, plan complete). Otherwise
  // chain mode polls the wall forever and interval mode wastes a slot per tick.
  const env = {
    ...(cfg.env || {}),
    WORKPLAN_AUTOPAUSE: '1',
    WORKPLAN_PLIST_LABEL: cfg.plist_label,
  };
  const envEntries = Object.entries(env)
    .map(([k, v]) => `    <key>${plistEscape(k)}</key>\n    <string>${plistEscape(v)}</string>`)
    .join('\n');

  // Scheduling block depends on mode.
  let scheduling;
  if (cfg.mode === 'chain') {
    // KeepAlive=true → launchd restarts the program whenever it exits.
    // ThrottleInterval is the minimum gap between launches (launchd default 10s).
    // RunAtLoad=true so the first tick fires immediately after `launchctl bootstrap`,
    //   instead of waiting for an arbitrary first kickstart.
    scheduling =
      `  <key>KeepAlive</key>\n` +
      `  <true/>\n` +
      `  <key>ThrottleInterval</key>\n` +
      `  <integer>${Math.max(10, Number(cfg.throttle_seconds) || 30)}</integer>\n` +
      `  <key>RunAtLoad</key>\n` +
      `  <true/>`;
  } else {
    // Interval mode: launchd fires the program every StartInterval seconds.
    scheduling =
      `  <key>StartInterval</key>\n` +
      `  <integer>${Number(cfg.interval_seconds)}</integer>\n` +
      `  <key>RunAtLoad</key>\n` +
      `  <false/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistEscape(cfg.plist_label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${plistEscape(cfg.tick_command)}</string>
  </array>
${scheduling}
  <key>StandardOutPath</key>
  <string>${plistEscape(cfg.stdout_path)}</string>
  <key>StandardErrorPath</key>
  <string>${plistEscape(cfg.stderr_path)}</string>
  <key>WorkingDirectory</key>
  <string>${plistEscape(cfg.working_dir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
</dict>
</plist>
`;
}

async function launchdStatus(label) {
  // Returns { loaded, pid, last_exit_status, interval_seconds (from plist),
  //           plist_exists }.
  const result = await exec('launchctl', ['list', label]);
  // `launchctl list <label>` writes a plist-formatted dict to stdout when
  // the agent is loaded; exit code is non-zero when not loaded.
  const loaded = result.rc === 0;
  let pid = null;
  let lastExit = null;
  if (loaded) {
    const pidMatch = result.stdout.match(/"PID"\s*=\s*(\d+);/);
    if (pidMatch) pid = Number(pidMatch[1]);
    const exitMatch = result.stdout.match(/"LastExitStatus"\s*=\s*(\d+);/);
    if (exitMatch) lastExit = Number(exitMatch[1]);
  }
  return { loaded, pid, last_exit_status: lastExit };
}

// One launchctl call returns the loaded set for ALL labels — cheaper than
// invoking `launchctl list <label>` per plan.
async function getAllLoadedLabels() {
  const r = await exec('launchctl', ['list']);
  if (r.err && r.rc !== 0) return new Set();
  const labels = new Set();
  for (const line of r.stdout.split('\n')) {
    // Format: PID<TAB>Status<TAB>Label
    const parts = line.split('\t');
    if (parts.length >= 3 && parts[2]) labels.add(parts[2].trim());
  }
  return labels;
}

function readIntervalFromPlist(plistPath) {
  if (!fs.existsSync(plistPath)) return null;
  try {
    const raw = fs.readFileSync(plistPath, 'utf8');
    const m = raw.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function readPlistMode(plistPath) {
  if (!fs.existsSync(plistPath)) return null;
  try {
    const raw = fs.readFileSync(plistPath, 'utf8');
    if (raw.match(/<key>KeepAlive<\/key>\s*<true\/>/)) return 'chain';
    if (raw.match(/<key>StartInterval<\/key>/)) return 'interval';
    return null;
  } catch { return null; }
}

function readThrottleFromPlist(plistPath) {
  if (!fs.existsSync(plistPath)) return null;
  try {
    const raw = fs.readFileSync(plistPath, 'utf8');
    const m = raw.match(/<key>ThrottleInterval<\/key>\s*<integer>(\d+)<\/integer>/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

async function getAutomationState(plan) {
  const cfg = readAutomationConfig(plan);
  const plistExists = fs.existsSync(cfg.plist_path);
  const plistInterval = plistExists ? readIntervalFromPlist(cfg.plist_path) : null;
  const plistMode = plistExists ? readPlistMode(cfg.plist_path) : null;
  const plistThrottle = plistExists ? readThrottleFromPlist(cfg.plist_path) : null;
  const status = await launchdStatus(cfg.plist_label);
  const logs = tickLogs(plan, 1);
  const lastTickMtime = logs.length ? logs[0].mtime : null;
  const lastTickName = logs.length ? logs[0].name : null;
  return {
    config: cfg,
    plist_exists: plistExists,
    plist_interval_seconds: plistInterval,
    plist_mode: plistMode,
    plist_throttle_seconds: plistThrottle,
    launchd: status,
    last_tick_mtime: lastTickMtime,
    last_tick_name: lastTickName,
    tick_command_exists: fs.existsSync(cfg.tick_command),
  };
}

async function launchctlBoot(uid, plistPath, label) {
  // The wrapper's auto-pause calls `launchctl disable <target>` which sets a
  // persistent flag. Bootstrap will succeed but the job won't fire until we
  // re-enable. Always enable before bootstrap so Resume / Start actually run.
  if (label) {
    await exec('launchctl', ['enable', `gui/${uid}/${label}`]);
  }
  let r = await exec('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  if (r.err && r.stderr.match(/already loaded|already bootstrapped/i)) return { ok: true, msg: 'already loaded' };
  if (r.err) {
    // Older macOS: try load -w.
    const r2 = await exec('launchctl', ['load', '-w', plistPath]);
    if (r2.err) return { ok: false, error: (r2.stderr || r.stderr || r.err.message || 'load failed').trim() };
    return { ok: true, msg: 'loaded (legacy load)' };
  }
  return { ok: true };
}

async function launchctlBootout(uid, label, plistPath) {
  let r = await exec('launchctl', ['bootout', `gui/${uid}/${label}`]);
  if (r.err && r.stderr.match(/No such process/i)) return { ok: true, msg: 'not loaded' };
  if (r.err) {
    const r2 = await exec('launchctl', ['unload', '-w', plistPath]);
    if (r2.err) return { ok: false, error: (r2.stderr || r.stderr || r.err.message || 'unload failed').trim() };
    return { ok: true, msg: 'unloaded (legacy unload)' };
  }
  return { ok: true };
}

async function launchctlKickstart(uid, label) {
  const r = await exec('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`]);
  if (r.err) return { ok: false, error: (r.stderr || r.err.message || 'kickstart failed').trim() };
  return { ok: true };
}

// Path traversal guard.
function safeJoin(planDir, rel) {
  const resolved = path.resolve(planDir, rel);
  const base = path.resolve(planDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

// ── HTML page ─────────────────────────────────────────────────────────────────

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>workplan viewer</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d1117; --bg-2: #161b22; --bg-3: #1c2128;
    --border: #30363d; --border-soft: #21262d;
    --text: #e6edf3; --text-2: #c9d1d9; --dim: #8b949e; --dim-2: #6e7681;
    --accent: #58a6ff;
    --green: #56d364; --yellow: #e3b341; --red: #f85149;
    --magenta: #d2a8ff; --cyan: #79c0ff;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 1fr clamp(170px, 34vh, 460px);
    grid-template-areas:
      "sidebar main"
      "dock dock";
    height: 100vh;
  }
  aside { grid-area: sidebar; }
  main { grid-area: main; }
  #activity-dock { grid-area: dock; }
  /* Sidebar */
  aside { background: var(--bg-2); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
  aside .brand { padding: 14px 16px; font-weight: 600; border-bottom: 1px solid var(--border); color: var(--accent); display: flex; align-items: center; justify-content: space-between; }
  aside .brand .v { color: var(--dim); font-weight: 400; font-size: 11px; }
  aside h2 { margin: 14px 16px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim-2); font-weight: 500; }
  aside .plan-list { list-style: none; padding: 0; margin: 0; }
  aside .plan-list li { padding: 10px 16px; cursor: pointer; border-left: 3px solid transparent; }
  aside .plan-list li:hover { background: var(--bg-3); }
  aside .plan-list li.active { background: var(--bg-3); border-left-color: var(--accent); }
  aside .plan-list .name { font-weight: 500; display: flex; align-items: center; gap: 8px; }
  aside .plan-list .meta { font-size: 11px; color: var(--dim); margin-top: 2px; display: flex; gap: 8px; align-items: center; }
  aside .plan-list .pill { display: inline-block; padding: 1px 6px; border-radius: 9px; font-size: 10px; font-weight: 500; background: var(--bg); }
  aside .plan-list .pill.run { background: rgba(86, 211, 100, 0.15); color: var(--green); }
  aside .plan-list .pill.idle { background: var(--bg); color: var(--dim); }
  aside .plan-list .pill.blocked { background: rgba(248, 81, 73, 0.15); color: var(--red); }
  aside .plan-list .pill.auto { background: rgba(86, 211, 100, 0.15); color: var(--green); }
  /* Status dot: green=auto running · yellow=manual tick running · red=blocked · gray=idle */
  @keyframes status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .status-dot {
    display: inline-block; width: 9px; height: 9px; border-radius: 50%;
    flex-shrink: 0; background: var(--dim-2);
  }
  .status-dot.active { background: var(--green); box-shadow: 0 0 8px rgba(86, 211, 100, 0.7); animation: status-pulse 2.2s ease-in-out infinite; }
  .status-dot.running { background: var(--yellow); box-shadow: 0 0 6px rgba(227, 179, 65, 0.5); animation: status-pulse 1.4s ease-in-out infinite; }
  .status-dot.blocked { background: var(--red); box-shadow: 0 0 6px rgba(248, 81, 73, 0.5); }
  .status-dot.idle { background: var(--dim-2); }
  .status-dot.lg { width: 12px; height: 12px; }
  aside .footer { margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--border); color: var(--dim-2); font-size: 11px; }
  /* Main */
  main { display: grid; grid-template-rows: auto auto 1fr; overflow: hidden; }
  .header-bar { padding: 12px 20px; background: var(--bg-2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .header-bar .title { font-weight: 600; font-size: 14px; }
  .header-bar .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .header-bar .key { color: var(--dim); }
  .header-bar .val { color: var(--text-2); font-weight: 500; }
  .header-bar .ok .val { color: var(--green); }
  .header-bar .warn .val { color: var(--yellow); }
  .header-bar .bad .val { color: var(--red); }
  .header-bar .spacer { flex: 1; }
  .header-bar .step { color: var(--dim); font-family: 'SF Mono', 'Menlo', monospace; font-size: 11px; }
  .header-bar button.pause-btn {
    background: var(--bg-3); color: var(--text-2); border: 1px solid var(--border);
    padding: 6px 14px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 500;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .header-bar button.pause-btn:hover { background: var(--bg); border-color: var(--accent); color: var(--accent); }
  .header-bar button.pause-btn.paused { background: rgba(86, 211, 100, 0.15); border-color: var(--green); color: var(--green); }
  .header-bar button.pause-btn.paused:hover { background: rgba(86, 211, 100, 0.25); }
  /* Block pane */
  #pane-block { grid-template-rows: 1fr; }
  .block-view { overflow-y: scroll; padding: 24px 28px; max-width: 900px; }
  .block-view.is-blocked { background: rgba(248, 81, 73, 0.04); }
  .block-view h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 10px; }
  .block-view .status-pill {
    display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
  }
  .block-view .status-pill.blocked { background: rgba(248, 81, 73, 0.2); color: var(--red); }
  .block-view .status-pill.clear { background: rgba(86, 211, 100, 0.2); color: var(--green); }
  .block-view p.lede { color: var(--dim); margin: 0 0 24px; font-size: 13px; }
  .block-view .actions { margin: 16px 0 24px; display: flex; gap: 10px; align-items: center; }
  .block-view button.primary {
    background: var(--accent); color: var(--bg); border: none; padding: 8px 16px;
    border-radius: 5px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
  }
  .block-view button.primary:hover { background: #79b8ff; }
  .block-view button.danger {
    background: rgba(248, 81, 73, 0.15); color: var(--red); border: 1px solid var(--red);
    padding: 8px 16px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 500;
  }
  .block-view button.danger:hover { background: rgba(248, 81, 73, 0.25); }
  .block-view .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .block-view label { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .block-view input[type=text], .block-view textarea {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    padding: 8px 10px; border-radius: 4px; font: inherit; font-size: 13px;
  }
  .block-view textarea { font-family: 'SF Mono', monospace; font-size: 12px; min-height: 90px; resize: vertical; }
  .block-view .doc-render {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 16px 20px; margin-top: 16px;
    white-space: pre-wrap; word-break: break-word;
    font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.6; color: var(--text-2);
  }
  .block-view .note {
    background: rgba(227, 179, 65, 0.1); border-left: 3px solid var(--yellow);
    padding: 10px 14px; margin: 16px 0; font-size: 12px; color: var(--text-2);
  }
  .block-view .meta-row { color: var(--dim); font-size: 12px; margin-top: 4px; font-family: 'SF Mono', monospace; }
  .block-view .toast { background: rgba(86, 211, 100, 0.15); border-left: 3px solid var(--green); padding: 8px 12px; margin: 10px 0; font-size: 12px; color: var(--green); }
  .block-view .toast.err { background: rgba(248, 81, 73, 0.15); border-left-color: var(--red); color: var(--red); }
  /* Tabs */
  .tabs { display: flex; background: var(--bg-2); border-bottom: 1px solid var(--border); padding: 0 20px; align-items: center; }
  .tabs button { background: none; border: none; color: var(--dim); padding: 10px 16px; cursor: pointer; font-family: inherit; font-size: 13px; border-bottom: 2px solid transparent; }
  .tabs button:hover { color: var(--text-2); }
  .tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tabs .spacer { flex: 1; }
  .tabs .controls { padding: 6px 0; display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--dim); }
  .tabs .controls label { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .tabs .controls select { background: var(--bg); color: var(--text); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; font-family: inherit; font-size: 11px; }
  /* View modes: per-plan vs global Activity */
  /* Activity dock — full-width horizontal panel under the plans window */
  #activity-dock { position: relative; display: flex; flex-direction: column; background: var(--bg-2); border-top: 1px solid var(--border); overflow: hidden; }
  #activity-dock .dock-resize { height: 6px; flex-shrink: 0; cursor: row-resize; background: var(--border); }
  #activity-dock .dock-resize:hover, #activity-dock .dock-resize.dragging { background: var(--accent); }
  #activity-dock .dock-bar { display: flex; align-items: center; gap: 4px; padding: 0 20px; background: var(--bg-2); border-bottom: 1px solid var(--border); }
  #activity-dock .dock-title { font-weight: 600; color: var(--accent); margin-right: 14px; font-size: 12px; }
  #activity-dock .dock-title .dock-sub { color: var(--dim); font-weight: 400; font-size: 11px; margin-left: 4px; }
  #activity-dock .gtab-btn { background: none; border: none; color: var(--dim); padding: 9px 16px; cursor: pointer; font-family: inherit; font-size: 13px; border-bottom: 2px solid transparent; }
  #activity-dock .gtab-btn:hover { color: var(--text-2); }
  #activity-dock .gtab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  #activity-dock .spacer { flex: 1; }
  #activity-dock .controls { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--dim); }
  #activity-dock .controls label { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  #activity-dock .controls .pause-btn { padding: 3px 10px; font-size: 11px; }
  .dock-pane { flex: 1; min-height: 0; display: none; }
  .dock-pane.active { display: block; }
  .plan-view { padding: 20px; overflow-y: auto; height: 100%; }
  .plan-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
  .plan-card h2 { font-size: 14px; margin: 0 0 10px; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .reg-family { font-size: 12px; font-weight: bold; color: var(--accent); margin: 12px 0 6px; }
  .reg-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .reg-name { color: var(--text-2); }
  .dec summary { cursor: pointer; font-size: 12px; color: var(--text); padding: 6px 0; }
  .dec-body { white-space: pre-wrap; font-size: 12px; color: var(--text-2); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 10px; overflow-x: auto; }
  /* Panes */
  .pane { overflow: hidden; display: none; }
  .pane.active { display: grid; }
  #log { height: 100%; box-sizing: border-box; overflow-y: scroll; padding: 12px 20px; white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 12px; line-height: 1.55; }
  #log .empty { color: var(--dim); font-style: italic; }
  /* ANSI */
  .a-dim { color: var(--dim); } .a-bold { font-weight: 700; }
  .a-red { color: var(--red); } .a-green { color: var(--green); }
  .a-yellow { color: var(--yellow); } .a-blue { color: var(--accent); }
  .a-magenta { color: var(--magenta); } .a-cyan { color: var(--cyan); }
  /* Steps */
  #pane-steps { grid-template-columns: 420px 1fr; }
  .step-list { overflow-y: scroll; border-right: 1px solid var(--border); background: var(--bg); }
  .step-list .block-hdr { padding: 8px 16px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim-2); background: var(--bg-2); border-bottom: 1px solid var(--border-soft); border-top: 1px solid var(--border-soft); font-weight: 500; }
  .step-list .step { padding: 8px 16px; cursor: pointer; border-left: 3px solid transparent; border-bottom: 1px solid var(--border-soft); display: flex; align-items: flex-start; gap: 8px; }
  .step-list .step:hover { background: var(--bg-2); }
  .step-list .step.active { background: var(--bg-3); border-left-color: var(--accent); }
  .step-list .step .marker { width: 18px; height: 18px; flex-shrink: 0; border-radius: 3px; text-align: center; line-height: 18px; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .step-list .step .marker.x { background: rgba(86, 211, 100, 0.2); color: var(--green); }
  .step-list .step .marker.A { background: rgba(227, 179, 65, 0.2); color: var(--yellow); }
  .step-list .step .marker.empty { background: var(--bg-3); color: var(--dim-2); }
  .step-list .step .info { flex: 1; min-width: 0; }
  .step-list .step .id-row { display: flex; gap: 8px; align-items: baseline; font-size: 11px; color: var(--dim); }
  .step-list .step .id { font-family: 'SF Mono', monospace; color: var(--accent); }
  .step-list .step .ver { font-family: 'SF Mono', monospace; color: var(--dim); }
  .step-list .step .desc { color: var(--text-2); margin-top: 2px; font-size: 12px; line-height: 1.4; }
  .step-detail { overflow-y: scroll; padding: 0; }
  .step-detail .empty { padding: 30px; color: var(--dim); font-style: italic; text-align: center; }
  .step-detail .doc-section { border-bottom: 1px solid var(--border); }
  .step-detail .doc-section h3 { margin: 0; padding: 12px 20px; background: var(--bg-2); font-size: 12px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; }
  .step-detail .doc-section h3 .meta { color: var(--dim); font-size: 11px; font-weight: 400; text-transform: none; letter-spacing: 0; font-family: 'SF Mono', monospace; }
  .step-detail .doc-body { padding: 16px 20px; white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.6; color: var(--text-2); }
  .step-detail .doc-body.missing { color: var(--dim); font-style: italic; }
  /* Documents */
  #pane-docs { grid-template-columns: 280px 1fr; }
  .doc-list { overflow-y: scroll; border-right: 1px solid var(--border); background: var(--bg); }
  .doc-list .doc-item { padding: 10px 16px; cursor: pointer; border-left: 3px solid transparent; border-bottom: 1px solid var(--border-soft); }
  .doc-list .doc-item:hover { background: var(--bg-2); }
  .doc-list .doc-item.active { background: var(--bg-3); border-left-color: var(--accent); }
  .doc-list .doc-item .name { font-weight: 500; color: var(--text-2); }
  .doc-list .doc-item .meta { font-size: 11px; color: var(--dim); margin-top: 2px; }
  .doc-view { overflow-y: scroll; padding: 20px 24px; white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.6; color: var(--text-2); }
  .doc-view .empty { color: var(--dim); font-style: italic; }
  /* History */
  #pane-history { grid-template-rows: 1fr; }
  .history-list { overflow-y: scroll; padding: 0; }
  .history-list .h-item { padding: 10px 20px; cursor: pointer; border-bottom: 1px solid var(--border-soft); display: flex; gap: 16px; align-items: center; }
  .history-list .h-item:hover { background: var(--bg-2); }
  .history-list .h-item .name { font-family: 'SF Mono', monospace; color: var(--accent); }
  .history-list .h-item .size { color: var(--dim); font-size: 11px; }
  .history-list .h-item .time { color: var(--dim); font-size: 11px; }
  .history-list .h-item.step { cursor: default; }
  .history-list .h-item.step .name { color: #3fb950; }
  .history-list .empty { padding: 30px; color: var(--dim); font-style: italic; text-align: center; }
  /* Automation pane */
  #pane-auto { grid-template-rows: 1fr; }
  .auto-view { overflow-y: scroll; padding: 24px 28px; max-width: 900px; }
  .auto-view h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 10px; }
  .auto-view .section { margin: 24px 0; padding: 20px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; }
  .auto-view .section h3 { margin: 0 0 14px; font-size: 12px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; }
  .auto-view .kv-grid { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; font-size: 12px; }
  .auto-view .kv-grid .k { color: var(--dim); }
  .auto-view .kv-grid .v { color: var(--text-2); font-family: 'SF Mono', monospace; word-break: break-all; }
  .auto-view .kv-grid .v.muted { color: var(--dim); }
  .auto-view .status-pill { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
  .auto-view .status-pill.on { background: rgba(86, 211, 100, 0.2); color: var(--green); }
  .auto-view .status-pill.off { background: var(--bg); color: var(--dim); }
  .auto-view .status-pill.warn { background: rgba(227, 179, 65, 0.15); color: var(--yellow); }
  .auto-view .interval-input { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .auto-view .interval-input input { width: 90px; background: var(--bg); color: var(--text); border: 1px solid var(--border); padding: 6px 10px; border-radius: 4px; font: inherit; font-size: 13px; }
  .auto-view .interval-input select { background: var(--bg); color: var(--text); border: 1px solid var(--border); padding: 6px 8px; border-radius: 4px; font: inherit; font-size: 13px; }
  .auto-view .presets { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
  .auto-view .preset {
    background: var(--bg-3); color: var(--text-2); border: 1px solid var(--border);
    padding: 5px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px;
  }
  .auto-view .preset:hover { border-color: var(--accent); color: var(--accent); }
  .auto-view .preset.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .auto-view .mode-toggle { display: flex; gap: 0; margin: 0 0 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; max-width: 460px; }
  .auto-view .mode-toggle button {
    flex: 1; background: var(--bg-3); color: var(--text-2); border: none; padding: 12px 16px;
    cursor: pointer; font: inherit; font-size: 13px; text-align: left; border-right: 1px solid var(--border);
  }
  .auto-view .mode-toggle button:last-child { border-right: none; }
  .auto-view .mode-toggle button:hover { background: var(--bg); color: var(--accent); }
  .auto-view .mode-toggle button.active { background: var(--accent); color: var(--bg); }
  .auto-view .mode-toggle button .mode-name { display: block; font-weight: 600; margin-bottom: 2px; }
  .auto-view .mode-toggle button .mode-desc { display: block; font-size: 11px; opacity: 0.85; font-weight: 400; }
  .auto-view .mode-block { display: none; }
  .auto-view .mode-block.active { display: block; }
  .auto-view .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .auto-view button.primary {
    background: var(--accent); color: var(--bg); border: none; padding: 8px 16px;
    border-radius: 5px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
  }
  .auto-view button.primary:hover { background: #79b8ff; }
  .auto-view button.primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .auto-view button.secondary {
    background: var(--bg-3); color: var(--text-2); border: 1px solid var(--border);
    padding: 8px 16px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 500;
  }
  .auto-view button.secondary:hover { border-color: var(--accent); color: var(--accent); }
  .auto-view button.danger {
    background: rgba(248, 81, 73, 0.15); color: var(--red); border: 1px solid var(--red);
    padding: 8px 16px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 500;
  }
  .auto-view button.danger:hover { background: rgba(248, 81, 73, 0.25); }
  .auto-view .note { background: rgba(227, 179, 65, 0.1); border-left: 3px solid var(--yellow); padding: 10px 14px; margin: 12px 0; font-size: 12px; color: var(--text-2); }
  .auto-view .toast { background: rgba(86, 211, 100, 0.15); border-left: 3px solid var(--green); padding: 8px 12px; margin: 10px 0; font-size: 12px; color: var(--green); }
  .auto-view .toast.err { background: rgba(248, 81, 73, 0.15); border-left-color: var(--red); color: var(--red); }
  /* Progress pane — one human-readable line per agent action */
  #progress-list {
    height: 100%; box-sizing: border-box;
    overflow-y: scroll;
    padding: 12px 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', monospace;
    font-size: 13px;
    line-height: 1.7;
  }
  #progress-list .pl-row { display: flex; gap: 10px; padding: 1px 0; align-items: baseline; }
  #progress-list .pl-row:hover { background: rgba(255,255,255,0.02); }
  #progress-list .pl-time { color: var(--dim); font-family: 'SF Mono', monospace; font-size: 11px; flex-shrink: 0; min-width: 62px; }
  #progress-list .pl-icon { flex-shrink: 0; width: 18px; text-align: center; }
  #progress-list .pl-body { flex: 1; min-width: 0; word-break: break-word; }
  #progress-list .pl-verb { color: var(--accent); font-weight: 600; margin-right: 4px; }
  #progress-list .pl-obj  { color: var(--text); }
  #progress-list .pl-arg  { color: var(--dim); font-size: 11px; }
  #progress-list .pl-row.r-thinking .pl-body { color: var(--dim); font-style: italic; }
  #progress-list .pl-row.r-asst     .pl-body { color: var(--cyan); }
  #progress-list .pl-row.r-error    .pl-body { color: var(--red); }
  #progress-list .pl-row.r-error    .pl-verb { color: var(--red); }
  #progress-list .pl-row.r-end      { background: rgba(86,211,100,0.08); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  #progress-list .pl-row.r-end      .pl-verb { color: var(--green); }
  #progress-list .pl-plan { flex-shrink: 0; align-self: center; font-size: 10px; font-weight: 600; line-height: 16px; padding: 0 6px; border-radius: 7px; background: rgba(255,255,255,0.07); color: var(--dim); }
  #progress-list .pl-row.me .pl-plan { background: var(--accent); color: #0a0a0a; }
  #progress-list .pl-source { font-family: 'SF Mono', monospace; font-size: 11px; color: var(--dim); padding: 4px 2px 6px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  #progress-list .pl-source.session { color: var(--cyan); }
  #progress-list .pl-row.r-tick-start { background: rgba(88,166,255,0.08); border-top: 1px solid var(--border); }
  #progress-list .pl-row.r-tick-start .pl-verb { color: var(--accent); }
  #progress-list .pl-row.r-rate     .pl-verb { color: var(--yellow); }
  /* Pause banner */
  #pause-banner { display: none; background: var(--yellow); color: #000; padding: 4px 20px; font-size: 12px; font-weight: 500; cursor: pointer; text-align: center; position: absolute; bottom: 0; left: 0; right: 0; }
  #pause-banner.visible { display: block; }
  body.signed-out > :not(#viewer-login):not(script) { display: none; }
  #viewer-login { grid-column: 1 / -1; max-width: 520px; margin: 12vh auto; padding: 24px; }
  #viewer-login label, #viewer-login input { display: block; margin: 12px 0; }
  #viewer-login input { width: 100%; box-sizing: border-box; padding: 10px; background: var(--bg-2); border: 1px solid var(--border); color: var(--text); }
  #viewer-login button, #viewer-sign-out { cursor: pointer; padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--border); color: var(--text); }
  #viewer-login .hint { font-size: 12px; color: var(--dim); overflow-wrap: anywhere; }
  #viewer-login-error { color: var(--red); }
</style>
</head>
<body class="signed-out">
<section id="viewer-login" aria-labelledby="viewer-login-title">
  <h1 id="viewer-login-title">Sign in to your workplans</h1>
  <p>Your plans and live activity are private to this node.</p>
  <form id="viewer-login-form">
    <label for="viewer-key">Node access key</label>
    <input id="viewer-key" type="password" required autocomplete="off" spellcheck="false">
    <button type="submit">Sign in</button>
    <p id="viewer-login-error" role="alert"></p>
  </form>
  <p class="hint">Use the key in <code>~/.openclaw/config/workplan-viewer-token</code>.
  This browser session expires after four hours or when the viewer restarts.</p>
</section>
<aside>
  <button id="viewer-sign-out" type="button">Sign out</button>
  <div class="brand">workplan <span class="v">v2</span></div>
  <h2>Plans</h2>
  <ul class="plan-list" id="plan-list"></ul>
  <div class="footer" id="discovery-info"></div>
</aside>

<main>
  <div class="header-bar">
    <span class="title" id="h-title">—</span>
    <span class="badge"><span class="key">version</span><span class="val" id="h-version">—</span></span>
    <span class="badge"><span class="key">progress</span><span class="val" id="h-progress">—</span></span>
    <span class="badge" id="h-lock-wrap"><span class="key">lock</span><span class="val" id="h-lock">—</span></span>
    <span class="badge" id="h-block-wrap"><span class="key">block</span><span class="val" id="h-block">—</span></span>
    <span class="badge" id="h-tree-wrap"><span class="key">tree</span><span class="val" id="h-tree">—</span></span>
    <span class="spacer"></span>
    <span class="step" id="h-step"></span>
    <button class="pause-btn" id="notify-toggle" title="Toggle step/block notifications">🔔 Notify</button>
    <button class="pause-btn" id="header-pause-btn" title="Pause future ticks">⏸ Pause</button>
  </div>

  <div class="tabs" id="plan-tabs">
    <button class="tab-btn active" data-tab="plan">Master Plan</button>
    <button class="tab-btn" data-tab="steps">Steps</button>
    <button class="tab-btn" data-tab="auto" id="tab-auto">Automation</button>
    <button class="tab-btn" data-tab="block" id="tab-block">Block</button>
    <button class="tab-btn" data-tab="docs">Documents</button>
    <button class="tab-btn" data-tab="history">History</button>
  </div>

  <div id="pane-plan" class="pane active">
    <div class="plan-view" id="plan-view"><div class="empty">loading…</div></div>
  </div>

  <div id="pane-steps" class="pane">
    <div class="step-list" id="step-list"></div>
    <div class="step-detail" id="step-detail">
      <div class="empty">select a step to view audit-pre / audit-post</div>
    </div>
  </div>

  <div id="pane-docs" class="pane">
    <div class="doc-list" id="doc-list"></div>
    <div class="doc-view" id="doc-view"><div class="empty">select a document</div></div>
  </div>

  <div id="pane-history" class="pane">
    <div class="history-list" id="history-list"></div>
  </div>

  <div id="pane-block" class="pane">
    <div class="block-view" id="block-view"></div>
  </div>

  <div id="pane-auto" class="pane">
    <div class="auto-view" id="auto-view"></div>
  </div>
</main>

<section id="activity-dock">
  <div class="dock-resize" id="dock-resize" title="Drag to resize"></div>
  <div class="dock-bar">
    <span class="dock-title">📡 Activity <span class="dock-sub">live across all plans</span></span>
    <button class="gtab-btn active" data-gtab="glive">Live</button>
    <button class="gtab-btn" data-gtab="gprogress">Progress</button>
    <span class="spacer"></span>
    <div class="controls" id="live-controls">
      <label><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
      <label><input type="checkbox" id="follow-new" checked> follow new tick</label>
      <button class="pause-btn" id="unpin-log" title="Return to live across all plans" style="display:none;">⟲ back to live</button>
    </div>
  </div>

  <div id="pane-live" class="dock-pane active">
    <div id="log"><div class="empty">connecting…</div></div>
  </div>

  <div id="pane-progress" class="dock-pane">
    <div id="progress-list"><div class="empty" style="padding:20px;color:var(--dim);">connecting…</div></div>
  </div>

  <div id="pause-banner">⏸ scroll paused — click to resume auto-scroll</div>
</section>

<script type="module" src="/viewer-client.js"></script>
</body>
</html>
`;

// ── HTTP server ───────────────────────────────────────────────────────────────

function json(res, body, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

function generatedBlockDoc({ trigger, detail, version }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stamp = new Date().toLocaleString('en-CA', { hour12: false }).replace(',', '') + ' ' + tz;
  return [
    '# CONTINUATION_BLOCKED — ' + stamp,
    '',
    '**Step**: (current)',
    '**Phase you were in**: (operator pause)',
    '**Trigger**: ' + (trigger || 'operator pause'),
    '',
    '## What failed',
    '',
    detail && detail.trim()
      ? detail.trim()
      : 'Operator paused the plan from the workplan viewer.',
    '',
    '## What\'s needed from the user',
    '',
    '- Investigate, address as needed.',
    '- Delete `BLOCKED.md` (or click ▶ Resume in the viewer) to let the next tick run.',
    '',
    '## How to resume',
    '',
    '1. Address whatever caused the pause.',
    '2. Delete `BLOCKED.md`.',
    '3. The next scheduled tick will pick up from the current state.',
    '',
    '## State at block',
    '',
    '- Source: workplan-viewer pause button',
    '- Time: ' + stamp,
    version ? '- VERSION at pause: `' + version + '`' : '',
  ].filter(Boolean).join('\n') + '\n';
}

// ── Activity stream (brief human-readable per-action lines) ──────────────────
// Reads from the wrapper's raw stream-json sidecar (<tick-log>.jsonl) and
// converts each event into ONE concise activity line. Powers the "Progress"
// tab — different rendering of the same source data the Live tab uses.

const ACTIVITY_REPO_PREFIX = '/Users/moltymac/openclaw-nodedev/';
const ACTIVITY_HOME = os.homedir();

function relPath(p) {
  if (!p) return '?';
  let s = String(p);
  if (s.startsWith(ACTIVITY_REPO_PREFIX)) s = s.slice(ACTIVITY_REPO_PREFIX.length);
  else if (s.startsWith(ACTIVITY_HOME))    s = '~' + s.slice(ACTIVITY_HOME.length);
  return s;
}

function truncMid(s, max = 110) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// One JSON event → zero-or-more activity lines. Each line is:
//   { time, icon, verb, body, kind }
// kind ∈ {tick-start, tool, asst, thinking, rate, error, end, info}
// Parse one stream-json event into activity lines, then stamp each line with the
// plan it belongs to. A tool action that names a plan path wins (attributePlan);
// otherwise we fall back to ctx.plan — the plan that OWNS the source feed. A tick
// runs exactly one plan, so passing that plan as ctx.plan tags *every* line
// (including thinking/text/result lines that carry no path). This is what makes a
// future plan's tick auto-label its progress lines: globalActivitySource hands
// the running tick's plan id in as ctx.plan, no per-plan wiring required.
function eventToActivity(evt, ctx) {
  const out = eventToActivityRaw(evt);
  const def = ctx && ctx.plan;
  if (def) for (const a of out) { if (a.plan == null) a.plan = def; }
  return out;
}

function eventToActivityRaw(evt) {
  const out = [];
  const t = evt.timestamp
    ? new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false })
    : new Date().toLocaleTimeString('en-GB', { hour12: false });

  if (evt.type === 'system') {
    const model = evt.model || '?';
    const tools = Array.isArray(evt.tools) ? evt.tools.length : 0;
    const mcps = Array.isArray(evt.mcp_servers) ? evt.mcp_servers.length : 0;
    out.push({ time: t, icon: '🚀', verb: 'Tick started', body: `${model} · ${tools} tools · ${mcps} MCP servers`, kind: 'tick-start' });
    return out;
  }

  if (evt.type === 'assistant') {
    const content = (evt.message && evt.message.content) || [];
    for (const c of content) {
      if (!c) continue;
      if (c.type === 'text') {
        const text = truncMid(c.text, 140);
        if (text) out.push({ time: t, icon: '💬', verb: '', body: text, kind: 'asst' });
      } else if (c.type === 'thinking') {
        const text = truncMid(c.thinking, 140);
        if (text) out.push({ time: t, icon: '💭', verb: 'thinking', body: text, kind: 'thinking' });
      } else if (c.type === 'tool_use') {
        const desc = describeToolCall(c.name, c.input || {});
        out.push({ time: t, icon: desc.icon, verb: desc.verb, body: desc.body, kind: 'tool', tool_id: c.id, plan: attributePlan(c.input || {}) });
      }
    }
    return out;
  }

  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    for (const c of evt.message.content) {
      if (!c || c.type !== 'tool_result') continue;
      if (c.is_error) {
        let msg = c.content;
        if (Array.isArray(msg)) msg = msg.map(x => x.text || '').join(' ');
        out.push({ time: t, icon: '✗', verb: 'error', body: truncMid(msg, 200), kind: 'error' });
      }
      // Skip non-error results — keeps Progress lean. Click the Live tab
      // if you want the actual result content.
    }
    return out;
  }

  if (evt.type === 'rate_limit_event') {
    const info = evt.rate_limit_info || {};
    if (info.status && info.status !== 'allowed') {
      out.push({ time: t, icon: '⏳', verb: 'rate limit', body: `${info.status} (${info.rateLimitType || '?'})`, kind: 'rate' });
    }
    return out;
  }

  if (evt.type === 'result') {
    const cost = evt.total_cost_usd != null ? `$${Number(evt.total_cost_usd).toFixed(4)}` : '?';
    const dur  = evt.duration_ms != null ? `${Math.floor(evt.duration_ms / 1000)}s` : '?';
    const turns = evt.num_turns ?? '?';
    out.push({ time: t, icon: '✅', verb: 'Tick done', body: `${evt.subtype || 'success'} · ${cost} · ${dur} · ${turns} turns`, kind: 'end' });
    return out;
  }

  return out;
}

// Render one activity line as plain pretty text (for the Live tab when it falls
// back to an interactive session — there's no wrapper-formatted .log to tail).
function prettyActivityLine(act) {
  const planTag = act.plan ? `[${act.plan}] ` : '';
  const verb = act.verb ? act.verb + ' ' : '';
  return `${act.time}  ${act.icon || '·'} ${planTag}${verb}${act.body || ''}`;
}

function describeToolCall(name, input) {
  switch (name) {
    case 'Read': {
      const p = relPath(input.file_path);
      const range = (input.offset || input.limit)
        ? ` (lines ${input.offset || 1}${input.limit ? '–' + ((input.offset || 0) + input.limit) : '+'})`
        : '';
      return { icon: '📖', verb: 'Reading', body: p + range };
    }
    case 'Write': {
      const p = relPath(input.file_path);
      const lines = input.content ? input.content.split('\n').length : 0;
      return { icon: '💾', verb: 'Writing', body: `${p}${lines ? ' (' + lines + ' lines)' : ''}` };
    }
    case 'Edit':
      return { icon: '✏️', verb: 'Editing', body: relPath(input.file_path) + (input.replace_all ? ' (replace all)' : '') };
    case 'MultiEdit':
      return { icon: '✏️', verb: 'Editing', body: `${relPath(input.file_path)} (${(input.edits || []).length} changes)` };
    case 'Bash': {
      const cmd = truncMid(input.command, 110);
      const desc = input.description ? ` — ${truncMid(input.description, 60)}` : '';
      return { icon: '▶️', verb: 'Running', body: cmd + desc };
    }
    case 'BashOutput':
      return { icon: '▶️', verb: 'Reading shell output', body: input.bash_id || '?' };
    case 'KillShell':
      return { icon: '🛑', verb: 'Killing shell', body: input.shell_id || '?' };
    case 'Glob':
      return { icon: '🔍', verb: 'Listing', body: `${input.pattern || '?'}${input.path ? ' in ' + relPath(input.path) : ''}` };
    case 'Grep': {
      const q = truncMid(input.pattern, 60);
      const where = input.path ? ' in ' + relPath(input.path) : '';
      const glob = input.glob ? ` (include ${input.glob})` : '';
      return { icon: '🔍', verb: 'Grep', body: `"${q}"${where}${glob}` };
    }
    case 'WebFetch':
      return { icon: '🌐', verb: 'Fetching', body: input.url || '?' };
    case 'WebSearch':
      return { icon: '🌐', verb: 'Web search', body: `"${truncMid(input.query, 100)}"` };
    case 'Task':
      return { icon: '🧬', verb: 'Spawning subagent', body: `${input.subagent_type || 'general'}: ${truncMid(input.description, 100)}` };
    case 'TodoWrite':
      return { icon: '✓', verb: 'Updating todos', body: `${(input.todos || []).length} items` };
    case 'AskUserQuestion': {
      const q = input.questions && input.questions[0] && input.questions[0].question;
      return { icon: '❓', verb: 'Asking user', body: truncMid(q, 120) };
    }
    case 'NotebookEdit':
      return { icon: '📓', verb: 'Editing notebook', body: relPath(input.notebook_path) };
    case 'mcp__knowledge__semantic_search':
      return { icon: '🧠', verb: 'Semantic search', body: `"${truncMid(input.query, 100)}"` };
    case 'mcp__knowledge__find_related':
      return { icon: '🧠', verb: 'Finding related', body: truncMid(input.text, 100) };
    case 'mcp__knowledge__reindex':
      return { icon: '🧠', verb: 'Reindexing knowledge', body: input.path || '(default)' };
    case 'mcp__knowledge__knowledge_stats':
      return { icon: '🧠', verb: 'Knowledge stats', body: '' };
    default: {
      if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const server = parts[1] || 'mcp';
        const tool = parts.slice(2).join('.');
        const arg = Object.keys(input)[0];
        return { icon: '🔌', verb: `${server}.${tool}`, body: arg ? `${arg}=${truncMid(JSON.stringify(input[arg]), 80)}` : '' };
      }
      return { icon: '⚙️', verb: name, body: truncMid(JSON.stringify(input), 100) };
    }
  }
}

// JSONL path for a given tick log. The wrapper writes <log>.jsonl alongside.
function jsonlPathFor(logPath) {
  if (!logPath) return null;
  // current.log symlinks to <timestamp>.log; we need <timestamp>.jsonl.
  const resolved = fs.realpathSync.native ? fs.realpathSync(logPath) : logPath;
  if (resolved.endsWith('.log')) return resolved.slice(0, -4) + '.jsonl';
  return resolved + '.jsonl';
}

// ── Activity source resolution ──────────────────────────────────────────────
// A plan's Live/Progress feed comes from its autonomous tick logs when any have
// run. Otherwise it falls back to the newest interactive Claude Code session for
// this repo, so the tabs reflect interactive work too (each line is attributed
// to the plan it touches — see attributePlan). Tick always wins once one fires.
const SESSION_DIR = path.join(os.homedir(), '.claude', 'projects',
  process.cwd().replace(/[/.]/g, '-'));

function newestSessionJsonl() {
  try {
    const picks = fs.readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => { const fp = path.join(SESSION_DIR, f); return { fp, m: fs.statSync(fp).mtimeMs }; })
      .sort((a, b) => b.m - a.m);
    return picks.length ? picks[0].fp : null;
  } catch { return null; }
}

// A tick log only counts as the *live* source while it's actively being
// written. A finished plan's last tick log (e.g. legacy's) is static history —
// it must NOT pin the Live/Progress tabs, or they'd show a frozen old run
// forever. Fresh = modified within this window (a running tick streams
// continuously, so its log mtime stays well inside it). Past runs live in the
// History tab; when no tick is running we fall back to the live session.
const TICK_FRESH_MS = 120000;
function freshTickLog(plan) {
  const lg = latestLog(plan);
  if (!lg || !fs.existsSync(lg)) return null;
  try {
    if (Date.now() - fs.statSync(lg).mtimeMs <= TICK_FRESH_MS) return lg;
  } catch {}
  return null;
}

// Progress source: the raw stream-json (.jsonl) to parse into activity lines.
function activitySource(plan) {
  const tick = jsonlPathFor(freshTickLog(plan));
  if (tick && fs.existsSync(tick)) return { path: tick, kind: 'tick', plan: plan.id };
  const sess = newestSessionJsonl();
  if (sess) return { path: sess, kind: 'session' };
  return { path: null, kind: 'none' };
}

// Which plan (if any) a tool action touches — matched by the plan-silo marker in
// any path-bearing field. Lets the project-global session stream attribute each
// line to its plan, so a plan tab shows what's actually happening to it.
function attributePlan(input) {
  if (!input) return null;
  let blob = '';
  for (const k of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'glob']) {
    if (input[k]) blob += ' ' + input[k];
  }
  if (!blob) return null;
  for (const p of PLANS) {
    if (blob.includes(p.dir) || blob.includes('plans/' + p.id + '/')) return p.id;
  }
  return null;
}

// Live source (pretty .log to tail) for one plan: pinned log, else the actively
// running tick, else the interactive session rendered from its raw .jsonl.
function openPinnedLog(plan, name) {
  if (path.basename(name) !== name || name.includes('\\') || !name.endsWith('.log')) return null;
  let fd;
  try {
    const base = fs.realpathSync(planTickLogDir(plan));
    const file = fs.realpathSync(path.join(base, name));
    if (!file.startsWith(base + path.sep)) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) { fs.closeSync(fd); return null; }
    return { path: file, fd, mode: 'raw' };
  } catch { if (fd !== undefined) fs.closeSync(fd); return null; }
}

function planLiveSource(plan) {
  const tickLog = freshTickLog(plan);
  if (tickLog) return { path: tickLog, mode: 'raw' };
  const sess = newestSessionJsonl();
  if (sess) return { path: sess, mode: 'pretty' };
  return { path: null, mode: 'none' };
}

// Global (plan-independent) sources: the Activity view shows whatever is running
// NOW across all plans — any actively-running tick wins; otherwise the live
// interactive session. Per-line plan attribution disambiguates inside the feed.
function globalActivitySource() {
  for (const p of PLANS) {
    const j = jsonlPathFor(freshTickLog(p));
    if (j && fs.existsSync(j)) return { path: j, kind: 'tick', plan: p.id };
  }
  const sess = newestSessionJsonl();
  if (sess) return { path: sess, kind: 'session' };
  return { path: null, kind: 'none' };
}
function globalLiveSource() {
  for (const p of PLANS) {
    const lg = freshTickLog(p);
    if (lg) return { path: lg, mode: 'raw' };
  }
  const sess = newestSessionJsonl();
  if (sess) return { path: sess, mode: 'pretty' };
  return { path: null, mode: 'none' };
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};
const SESSION_TAIL_BYTES = 131072;

// Progress stream (parsed activity lines). `resolve()` returns {path,kind} and is
// re-polled so a freshly-fired tick supersedes the interactive session live.
function sseActivity(req, res, resolve) {
  res.writeHead(200, SSE_HEADERS);
  res.write(':ok\n\n');
  let src = resolve();
  let currentJsonl = src.path;
  let sourceKind = src.kind;
  let sourcePlan = src.plan || null;
  let position = 0, closed = false, buffer = '';

  const send = (event, data) => {
    if (closed) return;
    res.write('event: ' + event + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
  };
  const processChunk = (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt; try { evt = JSON.parse(line); } catch { continue; }
      for (const act of eventToActivity(evt, { plan: sourcePlan })) send('activity', act);
    }
  };
  const emitFull = () => {
    if (!currentJsonl || !fs.existsSync(currentJsonl)) {
      send('info', { msg: 'No activity yet — no tick is running, and no interactive session was found for this repo.' });
      return;
    }
    buffer = '';
    send('reset', { source: path.basename(currentJsonl), kind: sourceKind });
    const stat = fs.statSync(currentJsonl);
    if (sourceKind === 'session' && stat.size > SESSION_TAIL_BYTES) {
      const start = stat.size - SESSION_TAIL_BYTES;
      const fd = fs.openSync(currentJsonl, 'r');
      const buf = Buffer.alloc(SESSION_TAIL_BYTES);
      fs.readSync(fd, buf, 0, SESSION_TAIL_BYTES, start);
      fs.closeSync(fd);
      position = stat.size;
      let s = buf.toString('utf8');
      const i = s.indexOf('\n'); if (i !== -1) s = s.slice(i + 1);
      processChunk(s);
      return;
    }
    const data = fs.readFileSync(currentJsonl, 'utf8');
    position = Buffer.byteLength(data, 'utf8');
    processChunk(data);
  };
  emitFull();

  const interval = setInterval(() => {
    if (closed) return;
    try {
      const ns = resolve();
      if (ns.path && ns.path !== currentJsonl) {
        currentJsonl = ns.path; sourceKind = ns.kind; sourcePlan = ns.plan || null; position = 0; buffer = '';
        emitFull(); return;
      }
      if (!currentJsonl || !fs.existsSync(currentJsonl)) return;
      const stat = fs.statSync(currentJsonl);
      if (stat.size > position) {
        const fd = fs.openSync(currentJsonl, 'r');
        const buf = Buffer.alloc(stat.size - position);
        fs.readSync(fd, buf, 0, buf.length, position);
        fs.closeSync(fd);
        position = stat.size;
        processChunk(buf.toString('utf8'));
      } else if (stat.size < position) {
        position = 0; buffer = ''; emitFull();
      }
    } catch {}
  }, 500);
  const heartbeat = setInterval(() => { if (!closed) res.write(':hb\n\n'); }, 15000);
  req.on('close', () => { closed = true; clearInterval(interval); clearInterval(heartbeat); try { res.end(); } catch {} });
}

// Live stream (raw pretty .log, or session .jsonl rendered to pretty lines).
// `allowSwitch` is false when a specific log is pinned (History view).
function sseLive(req, res, resolve, allowSwitch) {
  res.writeHead(200, SSE_HEADERS);
  res.write(':ok\n\n');
  let cur = resolve();
  const pinnedFd = cur.fd;
  let currentPath = cur.path;
  let mode = cur.mode;
  let position = 0, closed = false, buffer = '';

  const send = (event, data) => {
    if (closed) return;
    res.write('event: ' + event + '\n' + 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
  };
  const renderJsonl = (chunk) => {
    buffer += chunk;
    let nl, lines = '';
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt; try { evt = JSON.parse(line); } catch { continue; }
      for (const act of eventToActivity(evt)) lines += prettyActivityLine(act) + '\n';
    }
    if (lines) send('append', JSON.stringify(lines));
  };
  const emitFull = () => {
    if (!currentPath || (pinnedFd === undefined && !fs.existsSync(currentPath))) {
      send('file', '— no activity yet');
      send('append', JSON.stringify('No tick is running, and no interactive session was found for this repo.\n'));
      return;
    }
    buffer = '';
    if (mode === 'pretty') {
      const stat = pinnedFd === undefined ? fs.statSync(currentPath) : fs.fstatSync(pinnedFd);
      const start = stat.size > SESSION_TAIL_BYTES ? stat.size - SESSION_TAIL_BYTES : 0;
      const len = stat.size - start;
      const fd = pinnedFd ?? fs.openSync(currentPath, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      if (pinnedFd === undefined) fs.closeSync(fd);
      position = stat.size;
      let s = buf.toString('utf8');
      if (start > 0) { const i = s.indexOf('\n'); if (i !== -1) s = s.slice(i + 1); }
      send('file', path.basename(currentPath) + ' · interactive session');
      renderJsonl(s);
      return;
    }
    let buf;
    if (pinnedFd !== undefined) {
      const data = Buffer.alloc(fs.fstatSync(pinnedFd).size);
      const count = fs.readSync(pinnedFd, data, 0, data.length, 0);
      buf = data.subarray(0, count).toString('utf8');
    } else buf = fs.readFileSync(currentPath, 'utf8');
    position = Buffer.byteLength(buf, 'utf8');
    send('file', path.basename(currentPath));
    send('append', JSON.stringify(buf));
  };
  emitFull();

  const interval = setInterval(() => {
    if (closed) return;
    try {
      if (allowSwitch) {
        const ns = resolve();
        if (ns.path && ns.path !== currentPath) {
          currentPath = ns.path; mode = ns.mode; position = 0; buffer = '';
          send('switch', path.basename(currentPath));
          emitFull(); return;
        }
      }
      if (!currentPath || (pinnedFd === undefined && !fs.existsSync(currentPath))) return;
      const stat = pinnedFd === undefined ? fs.statSync(currentPath) : fs.fstatSync(pinnedFd);
      if (stat.size > position) {
        const fd = pinnedFd ?? fs.openSync(currentPath, 'r');
        const buf = Buffer.alloc(stat.size - position);
        fs.readSync(fd, buf, 0, buf.length, position);
        if (pinnedFd === undefined) fs.closeSync(fd);
        position = stat.size;
        if (mode === 'pretty') renderJsonl(buf.toString('utf8'));
        else send('append', JSON.stringify(buf.toString('utf8')));
      } else if (stat.size < position) {
        send('switch', path.basename(currentPath));
        position = 0; buffer = ''; emitFull();
      }
    } catch {}
  }, 400);
  const heartbeat = setInterval(() => { if (!closed) res.write(':hb\n\n'); }, 15000);
  res.on('close', () => {
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    if (pinnedFd !== undefined) fs.closeSync(pinnedFd);
  });
}

const PLAN_PATH_RE = /^\/api\/plans\/([^/]+)(\/.*)?$/;

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const boundary = checkViewerRequest(req, PORT);
  if (boundary.status !== 200) return json(res, { error: 'request origin rejected' }, boundary.status);
  const { url } = boundary;

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/viewer-client.js' || url.pathname === '/viewer-session.mjs')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(url.pathname === '/viewer-client.js' ? clientScript : sessionScript);
  }

  if (req.method === 'POST' && url.pathname === '/api/session') {
    try {
      const body = await readJsonBody(req, 1024);
      const session = viewerAuth.issue(body?.token);
      return json(res, session || { error: 'access key rejected' }, session ? 200 : 401);
    } catch { return json(res, { error: 'invalid sign-in request' }, 400); }
  }

  const grant = viewerAuth.authorize(req.headers.authorization);
  if (!grant) return json(res, { error: 'sign-in required' }, 401);
  if (req.method === 'DELETE' && url.pathname === '/api/session') {
    viewerAuth.revoke(grant);
    return json(res, { ok: true });
  }

  if (url.pathname === '/api/notify-config') {
    if (req.method === 'POST') {
      const raw = url.searchParams.get('enabled');
      const v = (raw === '1' || raw === 'true' || raw === 'on');
      saveNotifyEnabled(v);
    }
    return json(res, { enabled: notifyEnabled, persisted_to: NOTIFY_CONFIG_FILE });
  }

  if (req.method === 'POST' && url.pathname === '/api/notify-test') {
    const kind = url.searchParams.get('kind') === 'block' ? 'blocked' : 'closed';
    const plan = findPlan(url.searchParams.get('plan') || '') || PLANS[0] || null;
    let version = 'v-test', message = kind === 'blocked' ? 'notify-test: BLOCKED' : 'notify-test: step forward';
    if (plan) {
      const s = planSummary(plan);
      version = s.version;
      message = kind === 'blocked'
        ? `${plan.id}: ${blockMessage(s)}`
        : `${plan.id}: ${forwardMessage(plan, s.current_step ? s.current_step.version : s.version, s.version)}`;
    }
    fireNotify(kind, version, message, plan?.id);
    return json(res, { fired: kind, enabled: notifyEnabled, plan: plan?.id || null, version, message });
  }

  if (req.method === 'GET' && url.pathname === '/api/plans') {
    const loadedLabels = await getAllLoadedLabels();
    const plans = PLANS.map(p => {
      const cfg = readAutomationConfig(p);
      const summary = planSummary(p);
      return { ...summary, scheduler_loaded: loadedLabels.has(cfg.plist_label) };
    });
    return json(res, { roots: ROOTS, plans });
  }

  if (url.pathname === '/api/global/activity-stream') {
    viewerAuth.watch(req, res, grant);
    return sseActivity(req, res, globalActivitySource);
  }
  if (url.pathname === '/api/global/stream') {
    viewerAuth.watch(req, res, grant);
    return sseLive(req, res, globalLiveSource, true);
  }

  const m = url.pathname.match(PLAN_PATH_RE);
  if (m) {
    const plan = findPlan(m[1]);
    if (!plan) return json(res, { error: 'plan not found: ' + m[1] }, 404);
    const sub = m[2] || '/';

    if (sub === '/state') return json(res, planSummary(plan));
    if (sub === '/logs')  return json(res, [
      ...tickLogs(plan).map(l => ({ ...l, kind: 'tick' })),
      ...auditClosures(plan),
    ].sort((a, b) => b.mtime - a.mtime).slice(0, 100));
    if (sub === '/inventory') return json(res, inventoryRows(plan));
    if (sub === '/docs')  return json(res, planDocuments(plan));
    if (sub === '/registry')     return json(res, parseRegistry(plan));
    if (sub === '/decisions')    return json(res, parseDecisions(plan));

    if (sub === '/blocked' && req.method === 'GET') {
      const file = path.join(plan.dir, 'BLOCKED.md');
      if (!fs.existsSync(file)) return json(res, { blocked: false, content: null });
      try {
        const content = fs.readFileSync(file, 'utf8');
        const stat = fs.statSync(file);
        return json(res, { blocked: true, content, mtime: stat.mtimeMs });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    if (sub === '/block' && req.method === 'POST') {
      return readJsonBody(req).then((body) => {
        const file = path.join(plan.dir, 'BLOCKED.md');
        const exists = fs.existsSync(file);
        if (exists && !body.force) {
          return json(res, { error: 'already blocked — pass {force:true} to overwrite, or unblock first' }, 409);
        }
        const content = (typeof body.content === 'string' && body.content.length > 0)
          ? body.content
          : generatedBlockDoc({
              trigger: body.trigger,
              detail:  body.detail,
              version: readVersion(plan),
            });
        try {
          fs.writeFileSync(file, content);
          return json(res, { ok: true, blocked: true, path: 'BLOCKED.md' });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }).catch((e) => json(res, { error: e.message }, 400));
    }

    if (sub === '/unblock' && req.method === 'POST') {
      const file = path.join(plan.dir, 'BLOCKED.md');
      let removed = false;
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); removed = true; }
        catch (e) { return json(res, { error: e.message }, 500); }
      }
      // If the scheduler had auto-paused itself (plist exists but launchd no
      // longer has the job), bring it back up so the chain/interval resumes.
      const cfg = readAutomationConfig(plan);
      const plistExists = fs.existsSync(cfg.plist_path);
      const status = await launchdStatus(cfg.plist_label);
      let scheduler_reloaded = false;
      let scheduler_error = null;
      if (plistExists && !status.loaded) {
        const r = await launchctlBoot(process.getuid(), cfg.plist_path, cfg.plist_label);
        if (r.ok) scheduler_reloaded = true;
        else scheduler_error = r.error;
      }
      return json(res, {
        ok: true,
        blocked: false,
        note: removed ? 'BLOCKED.md removed' : 'already clear',
        scheduler_reloaded,
        scheduler_error,
      });
    }

    // ── Automation ──
    if (sub === '/automation' && req.method === 'GET') {
      return getAutomationState(plan).then((s) => json(res, s));
    }

    if (sub === '/automation/config' && req.method === 'PUT') {
      return readJsonBody(req).then(async (body) => {
        const current = readAutomationConfig(plan);
        const next = {
          ...current,
          plist_label:      body.plist_label      ?? current.plist_label,
          plist_path:       body.plist_path       ?? current.plist_path,
          tick_command:     body.tick_command     ?? current.tick_command,
          working_dir:      body.working_dir      ?? current.working_dir,
          mode:             body.mode             ?? current.mode,
          interval_seconds: body.interval_seconds != null ? Number(body.interval_seconds) : current.interval_seconds,
          throttle_seconds: body.throttle_seconds != null ? Number(body.throttle_seconds) : current.throttle_seconds,
          stdout_path:      body.stdout_path      ?? current.stdout_path,
          stderr_path:      body.stderr_path      ?? current.stderr_path,
          env:              body.env              ?? current.env,
        };
        if (next.mode !== 'interval' && next.mode !== 'chain') {
          return json(res, { error: 'mode must be "interval" or "chain"' }, 400);
        }
        if (next.mode === 'interval' && (!Number.isFinite(next.interval_seconds) || next.interval_seconds < 60)) {
          return json(res, { error: 'interval_seconds must be ≥ 60' }, 400);
        }
        if (next.mode === 'chain' && (!Number.isFinite(next.throttle_seconds) || next.throttle_seconds < 10)) {
          return json(res, { error: 'throttle_seconds must be ≥ 10 (launchd minimum)' }, 400);
        }
        try {
          const saved = writeAutomationConfig(plan, next);
          // If plist exists OR launchd loaded, rewrite plist; reload if loaded.
          const status = await launchdStatus(saved.plist_label);
          if (fs.existsSync(saved.plist_path) || status.loaded) {
            fs.mkdirSync(path.dirname(saved.plist_path), { recursive: true });
            fs.writeFileSync(saved.plist_path, generatePlistXml(saved));
            if (status.loaded) {
              await launchctlBootout(process.getuid(), saved.plist_label, saved.plist_path);
              await launchctlBoot(process.getuid(), saved.plist_path, saved.plist_label);
            }
          }
          return json(res, { ok: true, config: saved, applied_to_plist: fs.existsSync(saved.plist_path), reloaded: status.loaded });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }).catch((e) => json(res, { error: e.message }, 400));
    }

    if (sub === '/automation/load' && req.method === 'POST') {
      const cfg = readAutomationConfig(plan);
      try {
        if (!fs.existsSync(cfg.tick_command)) {
          return json(res, { error: 'tick command not found: ' + cfg.tick_command }, 400);
        }
        fs.mkdirSync(path.dirname(cfg.plist_path), { recursive: true });
        fs.mkdirSync(path.dirname(cfg.stdout_path), { recursive: true });
        fs.writeFileSync(cfg.plist_path, generatePlistXml(cfg));
        const r = await launchctlBoot(process.getuid(), cfg.plist_path, cfg.plist_label);
        if (!r.ok) return json(res, { error: r.error }, 500);
        const state = await getAutomationState(plan);
        return json(res, { ok: true, msg: r.msg || 'loaded', state });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    if (sub === '/automation/unload' && req.method === 'POST') {
      const cfg = readAutomationConfig(plan);
      const r = await launchctlBootout(process.getuid(), cfg.plist_label, cfg.plist_path);
      if (!r.ok) return json(res, { error: r.error }, 500);
      const state = await getAutomationState(plan);
      return json(res, { ok: true, msg: r.msg || 'unloaded', state });
    }

    if (sub === '/automation/kickstart' && req.method === 'POST') {
      const cfg = readAutomationConfig(plan);
      const status = await launchdStatus(cfg.plist_label);
      if (!status.loaded) {
        return json(res, { error: 'launchd job not loaded — Load it first, or use the manual tick command' }, 400);
      }
      const r = await launchctlKickstart(process.getuid(), cfg.plist_label);
      if (!r.ok) return json(res, { error: r.error }, 500);
      return json(res, { ok: true, msg: 'kickstart fired — a new tick should start within a second' });
    }

    // Run a single tick manually, without involving launchd. Spawns the
    // tick wrapper detached and returns immediately. Works whether or not
    // the scheduler is loaded.
    if (sub === '/automation/run-once' && req.method === 'POST') {
      const cfg = readAutomationConfig(plan);
      if (!fs.existsSync(cfg.tick_command)) {
        return json(res, { error: 'tick command not found: ' + cfg.tick_command }, 400);
      }
      // Reject if the lock is already held — would just skip-fast.
      if (fs.existsSync(path.join(plan.dir, '.tick.lock'))) {
        return json(res, { error: 'a tick is already running (lock held)' }, 409);
      }
      // Reject if blocked — clearer than running and immediately exiting.
      if (fs.existsSync(path.join(plan.dir, 'BLOCKED.md'))) {
        return json(res, { error: 'plan is paused (BLOCKED.md present) — clear the block first' }, 409);
      }
      try {
        const { spawn } = await import('node:child_process');
        const child = spawn(cfg.tick_command, [], {
          cwd: cfg.working_dir,
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            // Don't auto-pause launchd for manual runs (in case it IS loaded).
            WORKPLAN_AUTOPAUSE: '0',
            // Clear nested-claude guard so the manual fire works from inside
            // an interactive claude session.
            CLAUDECODE: undefined,
            CLAUDECODE_TICK: undefined,
            CLAUDE_CODE_ENTRYPOINT: undefined,
          },
        });
        child.unref();
        return json(res, { ok: true, msg: 'tick wrapper spawned (pid ' + child.pid + ') — watch the Live tab', pid: child.pid });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    if (sub === '/doc') {
      const rel = url.searchParams.get('path');
      if (!rel) return json(res, { error: 'missing ?path=' }, 400);
      // Fully siloed: resolve ONLY within the plan's own dir (no path traversal).
      const full = safeJoin(plan.dir, rel);
      if (!full || !fs.existsSync(full)) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      fs.createReadStream(full).pipe(res);
      return;
    }

    const auditMatch = sub.match(/^\/audits\/(\d+)$/);
    if (auditMatch) {
      const idx = Number(auditMatch[1]);
      const rows = inventoryRows(plan);
      const audits = planAudits(plan);
      const folderNames = Object.keys(audits).sort();
      const dirName = folderNames[idx];
      if (!rows[idx]) return json(res, { error: 'step out of range' }, 404);
      if (!dirName)  return json(res, { dirName: null, step: rows[idx], pre: null, post: null });
      const full = path.join(planAuditsDir(plan), dirName);
      const readMaybe = (rel) => {
        try { return fs.readFileSync(path.join(full, rel), 'utf8'); }
        catch { return null; }
      };
      return json(res, {
        dirName,
        step: rows[idx],
        pre:  readMaybe('AUDIT_PRE.md'),
        post: readMaybe('AUDIT_POST.md'),
      });
    }

    if (sub === '/activity-stream') {
      viewerAuth.watch(req, res, grant);
      return sseActivity(req, res, () => activitySource(plan));
    }

    if (sub === '/stream') {
      const pinned = url.searchParams.get('log');
      const pinnedSource = pinned ? openPinnedLog(plan, pinned) : null;
      if (pinned && !pinnedSource) return json(res, { error: 'log not found' }, 404);
      viewerAuth.watch(req, res, grant);
      return sseLive(req, res, () => pinnedSource || planLiveSource(plan), !pinned);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`workplan viewer → http://localhost:${PORT}\n`);
  process.stdout.write(`access key file: ${viewerTokenPath()}\n`);
  process.stdout.write(`discovery roots: ${ROOTS.join(', ')}\n`);
  process.stdout.write(`discovered ${PLANS.length} plan(s): ${PLANS.map(p => p.id).join(', ') || '(none yet)'}\n`);
});

process.on('SIGINT',  () => { viewerAuth.close(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { viewerAuth.close(); server.close(() => process.exit(0)); });
