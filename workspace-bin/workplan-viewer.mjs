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
import { execFile } from 'node:child_process';

// Promise wrapper around execFile with a timeout.
function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || ''), rc: err?.code ?? 0 });
    });
  });
}

const PORT = Number(process.env.WORKPLAN_VIEWER_PORT || 7892);
const ROOTS = (process.env.WORKPLAN_ROOTS
  ? process.env.WORKPLAN_ROOTS.split(':')
  : [process.cwd()])
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

// ── Plan-state probes ─────────────────────────────────────────────────────────

const planTickLogDir = (p) => path.join(p.dir, 'tick-logs');
const planAuditsDir  = (p) => path.join(p.dir, 'audits');

function readVersion(plan) {
  try { return fs.readFileSync(path.join(plan.dir, 'VERSION'), 'utf8').trim(); }
  catch { return '<missing>'; }
}

const isBlocked = (p) => fs.existsSync(path.join(p.dir, 'BLOCKED.md'));
const isLocked  = (p) => fs.existsSync(path.join(p.dir, '.tick.lock'));

function inventoryRows(plan) {
  let raw;
  try { raw = fs.readFileSync(path.join(plan.dir, 'INVENTORY.md'), 'utf8'); }
  catch { return []; }
  const rows = [];
  const re = /^\|\s*(\d+)\s*\|\s*(\d+\.\d+)\s*\|\s*(v\d+\.\d+)\s*\|\s*\[([xA ])\]\s*\|\s*([^|]+?)\s*\|$/;
  for (const line of raw.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    rows.push({
      block: Number(m[1]),
      step: m[2],
      version: m[3],
      state: m[4],
      desc: m[5].trim(),
    });
  }
  return rows;
}

function tickLogs(plan, limit = 100) {
  const dir = planTickLogDir(plan);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.log'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    });
}

function latestLog(plan) {
  const logs = tickLogs(plan, 1);
  return logs.length ? path.join(planTickLogDir(plan), logs[0].name) : null;
}

function planDocuments(plan) {
  return fs.readdirSync(plan.dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const full = path.join(plan.dir, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    });
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
  return {
    id: plan.id,
    dir: plan.dir,
    root: plan.root,
    version: readVersion(plan),
    blocked: isBlocked(plan),
    locked: isLocked(plan),
    closed_steps: closed,
    in_flight_steps: active,
    total_steps: rows.length,
    current_step: (rows.find(r => r.state === 'A') || rows.find(r => r.state === ' ') || null),
    latest_log: latestLog(plan)?.split('/').pop() || null,
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
  const legacyLabel = `com.openclaw.${id}-tick`;
  const cmdCandidates = [
    path.join(repo, 'workspace-bin', `${id}-tick.sh`),
    path.join(repo, 'workspace-bin', 'memory-plan-tick.sh'),
  ];
  const cmd = cmdCandidates.find(p => fs.existsSync(p)) || cmdCandidates[0];
  return {
    plist_label: legacyLabel,
    plist_path: path.join(LAUNCH_AGENTS, `${legacyLabel}.plist`),
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

async function launchctlBoot(uid, plistPath) {
  // bootstrap is the modern equivalent of `load`. Falls back to load on older macOS.
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
    grid-template-rows: 100vh;
  }
  /* Sidebar */
  aside { background: var(--bg-2); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
  aside .brand { padding: 14px 16px; font-weight: 600; border-bottom: 1px solid var(--border); color: var(--accent); display: flex; align-items: center; justify-content: space-between; }
  aside .brand .v { color: var(--dim); font-weight: 400; font-size: 11px; }
  aside h2 { margin: 14px 16px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim-2); font-weight: 500; }
  aside .plan-list { list-style: none; padding: 0; margin: 0; }
  aside .plan-list li { padding: 10px 16px; cursor: pointer; border-left: 3px solid transparent; }
  aside .plan-list li:hover { background: var(--bg-3); }
  aside .plan-list li.active { background: var(--bg-3); border-left-color: var(--accent); }
  aside .plan-list .name { font-weight: 500; }
  aside .plan-list .meta { font-size: 11px; color: var(--dim); margin-top: 2px; display: flex; gap: 8px; align-items: center; }
  aside .plan-list .pill { display: inline-block; padding: 1px 6px; border-radius: 9px; font-size: 10px; font-weight: 500; background: var(--bg); }
  aside .plan-list .pill.run { background: rgba(86, 211, 100, 0.15); color: var(--green); }
  aside .plan-list .pill.idle { background: var(--bg); color: var(--dim); }
  aside .plan-list .pill.blocked { background: rgba(248, 81, 73, 0.15); color: var(--red); }
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
  /* Panes */
  .pane { overflow: hidden; display: none; }
  .pane.active { display: grid; }
  #pane-live { grid-template-rows: 1fr; }
  #log { overflow-y: scroll; padding: 12px 20px; white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 12px; line-height: 1.55; }
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
  /* Pause banner */
  #pause-banner { display: none; background: var(--yellow); color: #000; padding: 4px 20px; font-size: 12px; font-weight: 500; cursor: pointer; text-align: center; position: absolute; bottom: 0; left: 240px; right: 0; }
  #pause-banner.visible { display: block; }
</style>
</head>
<body>
<aside>
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
    <span class="spacer"></span>
    <span class="step" id="h-step"></span>
    <button class="pause-btn" id="header-pause-btn" title="Pause future ticks">⏸ Pause</button>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-tab="live">Live</button>
    <button class="tab-btn" data-tab="steps">Steps</button>
    <button class="tab-btn" data-tab="auto" id="tab-auto">Automation</button>
    <button class="tab-btn" data-tab="block" id="tab-block">Block</button>
    <button class="tab-btn" data-tab="docs">Documents</button>
    <button class="tab-btn" data-tab="history">History</button>
    <span class="spacer"></span>
    <div class="controls" id="live-controls">
      <label><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
      <label><input type="checkbox" id="follow-new" checked> follow new tick</label>
      <select id="log-picker"></select>
    </div>
  </div>

  <div id="pane-live" class="pane active">
    <div id="log"><div class="empty">select a plan…</div></div>
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

<div id="pause-banner">⏸ scroll paused — click to resume auto-scroll</div>

<script>
const $ = (id) => document.getElementById(id);

const state = {
  planId: null,
  tab: 'live',
  evtSource: null,
  userPaused: false,
  selectedStep: null,
  selectedDoc: null,
};

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(ESC + '\\[([0-9;]*)m', 'g');
const ANSI_CLASS = {
  '0': null, '1': 'a-bold', '2': 'a-dim',
  '31': 'a-red', '32': 'a-green', '33': 'a-yellow', '34': 'a-blue',
  '35': 'a-magenta', '36': 'a-cyan',
};

function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function ansiToHtml(text) {
  const escaped = esc(text);
  let out = '';
  let last = 0;
  let depth = 0;
  let m;
  ANSI_RE.lastIndex = 0;
  while ((m = ANSI_RE.exec(escaped)) !== null) {
    out += escaped.slice(last, m.index);
    const codes = m[1].split(';').filter(Boolean);
    if (!codes.length || codes.includes('0')) {
      while (depth > 0) { out += '</span>'; depth--; }
    } else {
      for (const c of codes) {
        const cls = ANSI_CLASS[c];
        if (cls) { out += '<span class="' + cls + '">'; depth++; }
      }
    }
    last = m.index + m[0].length;
  }
  out += escaped.slice(last);
  while (depth > 0) { out += '</span>'; depth--; }
  return out;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
async function refreshPlans() {
  const r = await fetch('/api/plans');
  const data = await r.json();
  const list = $('plan-list');
  list.innerHTML = '';
  for (const p of data.plans) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === state.planId) li.classList.add('active');
    const status = p.blocked ? 'blocked' : (p.locked ? 'run' : 'idle');
    const statusLabel = p.blocked ? 'BLOCKED' : (p.locked ? 'running' : 'idle');
    li.innerHTML = '<div class="name">' + esc(p.id) + '</div>' +
      '<div class="meta">' +
      '<span class="pill ' + status + '">' + statusLabel + '</span>' +
      '<span>' + p.closed_steps + '/' + p.total_steps + '</span>' +
      '<span>' + esc(p.version) + '</span>' +
      '</div>';
    li.addEventListener('click', () => selectPlan(p.id));
    list.appendChild(li);
  }
  $('discovery-info').textContent =
    data.plans.length + ' plan(s) · roots: ' + data.roots.map(r => r.split('/').pop()).join(', ');
  if (!state.planId && data.plans.length) selectPlan(data.plans[0].id);
}

async function selectPlan(id) {
  state.planId = id;
  state.selectedStep = null;
  state.selectedDoc = null;
  document.querySelectorAll('aside .plan-list li').forEach(li =>
    li.classList.toggle('active', li.dataset.id === id));
  await refreshState();
  if (state.tab === 'live') reconnectStream();
  else if (state.tab === 'steps') renderSteps();
  else if (state.tab === 'docs') renderDocList();
  else if (state.tab === 'history') renderHistory();
  else if (state.tab === 'block') renderBlock();
  else if (state.tab === 'auto') renderAutomation();
}

// ── Header ────────────────────────────────────────────────────────────────────
async function refreshState() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/state');
  if (!r.ok) return;
  const s = await r.json();
  $('h-title').textContent = s.id;
  $('h-version').textContent = s.version;
  $('h-progress').textContent = s.closed_steps + '/' + s.total_steps;
  $('h-lock').textContent = s.locked ? 'held' : 'free';
  $('h-lock-wrap').className = 'badge ' + (s.locked ? 'warn' : 'ok');
  $('h-block').textContent = s.blocked ? 'BLOCKED' : 'clear';
  $('h-block-wrap').className = 'badge ' + (s.blocked ? 'bad' : 'ok');
  $('h-step').textContent = s.current_step
    ? (s.current_step.step + '  ' + s.current_step.version + '  ' + s.current_step.desc).slice(0, 90)
    : '';
  // Header pause/resume button mirrors the block state.
  const btn = $('header-pause-btn');
  btn.classList.toggle('paused', !!s.blocked);
  btn.textContent = s.blocked ? '▶ Resume' : '⏸ Pause';
  btn.title = s.blocked
    ? 'Plan is paused — click to delete BLOCKED.md and resume'
    : 'Pause future ticks by writing BLOCKED.md';
  state.lastBlocked = s.blocked;
  state.lastLocked = s.locked;
  // If user is on Block tab, refresh its content too.
  if (state.tab === 'block') renderBlock();
  if (state.tab === 'auto') renderAutomation();
}
setInterval(refreshState, 5000);

// Header pause/resume button.
$('header-pause-btn').addEventListener('click', async () => {
  if (state.lastBlocked) {
    if (!confirm('Resume the plan?\\n\\nDeletes BLOCKED.md so the next tick runs.')) return;
    await doUnblock();
  } else {
    // Quick pause: prompt for trigger, use simple defaults.
    const trigger = prompt('Pause future ticks. Brief reason (one line):', 'operator-requested pause');
    if (trigger == null) return;
    await doBlock({ trigger, detail: '' });
  }
});

async function doBlock({ trigger, detail }) {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: trigger || 'operator pause', detail: detail || '' }),
  });
  const data = await r.json();
  await refreshState();
  await refreshPlans();
  if (state.tab === 'block') renderBlock();
  return data;
}

async function doUnblock() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/unblock', { method: 'POST' });
  const data = await r.json();
  await refreshState();
  await refreshPlans();
  if (state.tab === 'block') renderBlock();
  return data;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + state.tab));
    $('live-controls').style.display = state.tab === 'live' ? '' : 'none';
    if (state.tab === 'live') reconnectStream();
    else if (state.tab === 'steps') renderSteps();
    else if (state.tab === 'docs') renderDocList();
    else if (state.tab === 'history') renderHistory();
    else if (state.tab === 'block') renderBlock();
    else if (state.tab === 'auto') renderAutomation();
  });
});

// ── Live transcript ───────────────────────────────────────────────────────────
const logEl = $('log');

function appendText(text) {
  if (!text) return;
  if (logEl.firstElementChild && logEl.firstElementChild.classList.contains('empty')) {
    logEl.innerHTML = '';
  }
  const html = ansiToHtml(text);
  const tmp = document.createElement('span');
  tmp.innerHTML = html;
  while (tmp.firstChild) logEl.appendChild(tmp.firstChild);
  if ($('autoscroll').checked && !state.userPaused) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function reconnectStream() {
  if (state.evtSource) { state.evtSource.close(); state.evtSource = null; }
  logEl.innerHTML = '<div class="empty">connecting…</div>';
  if (!state.planId) return;
  refreshLogPicker();
  const pinned = $('log-picker').dataset.pinned || '';
  const url = '/api/plans/' + state.planId + '/stream' + (pinned ? '?log=' + encodeURIComponent(pinned) : '');
  state.evtSource = new EventSource(url);
  state.evtSource.addEventListener('append', (e) => {
    try { appendText(JSON.parse(e.data)); } catch {}
  });
  state.evtSource.addEventListener('switch', () => {
    if ($('follow-new').checked) logEl.innerHTML = '';
  });
}

logEl.addEventListener('scroll', () => {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 20;
  if (!atBottom && $('autoscroll').checked) {
    state.userPaused = true;
    $('pause-banner').classList.add('visible');
  } else if (atBottom) {
    state.userPaused = false;
    $('pause-banner').classList.remove('visible');
  }
});
$('pause-banner').addEventListener('click', () => {
  state.userPaused = false;
  $('pause-banner').classList.remove('visible');
  logEl.scrollTop = logEl.scrollHeight;
});

async function refreshLogPicker() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/logs');
  if (!r.ok) return;
  const logs = await r.json();
  const sel = $('log-picker');
  const current = sel.dataset.pinned || '';
  sel.innerHTML = '<option value="">(newest, auto-follow)</option>' + logs.map(l => {
    const kb = (l.size / 1024).toFixed(1);
    return '<option value="' + l.name + '">' + l.name + ' (' + kb + ' KB)</option>';
  }).join('');
  if (current) sel.value = current;
}

$('log-picker').addEventListener('change', (e) => {
  $('log-picker').dataset.pinned = e.target.value;
  $('follow-new').checked = !e.target.value;
  reconnectStream();
});

// ── Steps ─────────────────────────────────────────────────────────────────────
async function renderSteps() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/inventory');
  if (!r.ok) return;
  const rows = await r.json();
  const list = $('step-list');
  list.innerHTML = '';
  let lastBlock = null;
  rows.forEach((row, idx) => {
    if (row.block !== lastBlock) {
      const hdr = document.createElement('div');
      hdr.className = 'block-hdr';
      hdr.textContent = 'Phase ' + row.block;
      list.appendChild(hdr);
      lastBlock = row.block;
    }
    const div = document.createElement('div');
    div.className = 'step' + (state.selectedStep === idx ? ' active' : '');
    const mClass = row.state === 'x' ? 'x' : row.state === 'A' ? 'A' : 'empty';
    const mText  = row.state === 'x' ? '✓' : row.state === 'A' ? '●' : '○';
    div.innerHTML =
      '<div class="marker ' + mClass + '">' + mText + '</div>' +
      '<div class="info">' +
        '<div class="id-row"><span class="id">' + row.step + '</span><span class="ver">' + row.version + '</span></div>' +
        '<div class="desc">' + esc(row.desc) + '</div>' +
      '</div>';
    div.addEventListener('click', () => { state.selectedStep = idx; renderStepDetail(idx); document.querySelectorAll('.step-list .step').forEach((el, i) => el.classList.toggle('active', i === idx)); });
    list.appendChild(div);
  });
  if (state.selectedStep != null) renderStepDetail(state.selectedStep);
}

async function renderStepDetail(idx) {
  const detail = $('step-detail');
  detail.innerHTML = '<div class="empty">loading…</div>';
  const r = await fetch('/api/plans/' + state.planId + '/audits/' + idx);
  if (!r.ok) { detail.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const data = await r.json();
  if (!data.dirName) {
    detail.innerHTML = '<div class="empty">no audit folder yet — step is queued or not started</div>';
    return;
  }
  let html = '';
  html += '<div class="doc-section">' +
    '<h3>AUDIT_PRE.md <span class="meta">audits/' + esc(data.dirName) + '/AUDIT_PRE.md</span></h3>' +
    '<div class="doc-body' + (data.pre ? '' : ' missing') + '">' +
      (data.pre ? esc(data.pre) : '(not written yet)') +
    '</div></div>';
  html += '<div class="doc-section">' +
    '<h3>AUDIT_POST.md <span class="meta">audits/' + esc(data.dirName) + '/AUDIT_POST.md</span></h3>' +
    '<div class="doc-body' + (data.post ? '' : ' missing') + '">' +
      (data.post ? esc(data.post) : '(not written yet)') +
    '</div></div>';
  detail.innerHTML = html;
}

// ── Documents ─────────────────────────────────────────────────────────────────
async function renderDocList() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/docs');
  if (!r.ok) return;
  const docs = await r.json();
  const list = $('doc-list');
  list.innerHTML = '';
  for (const d of docs) {
    const div = document.createElement('div');
    div.className = 'doc-item' + (state.selectedDoc === d.name ? ' active' : '');
    const kb = (d.size / 1024).toFixed(1);
    div.innerHTML = '<div class="name">' + esc(d.name) + '</div>' +
      '<div class="meta">' + kb + ' KB</div>';
    div.addEventListener('click', () => { state.selectedDoc = d.name; renderDoc(d.name); document.querySelectorAll('.doc-list .doc-item').forEach(el => el.classList.toggle('active', el.querySelector('.name').textContent === d.name)); });
    list.appendChild(div);
  }
  if (state.selectedDoc) renderDoc(state.selectedDoc);
  else $('doc-view').innerHTML = '<div class="empty">select a document</div>';
}

async function renderDoc(name) {
  const r = await fetch('/api/plans/' + state.planId + '/doc?path=' + encodeURIComponent(name));
  if (!r.ok) { $('doc-view').textContent = '(failed to load)'; return; }
  const text = await r.text();
  $('doc-view').textContent = text;
}

// ── Block / Pause control ─────────────────────────────────────────────────────
async function renderBlock() {
  if (!state.planId) return;
  const view = $('block-view');
  view.innerHTML = '<div class="empty">loading…</div>';
  const r = await fetch('/api/plans/' + state.planId + '/blocked');
  if (!r.ok) { view.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const data = await r.json();
  view.classList.toggle('is-blocked', !!data.blocked);

  if (data.blocked) {
    // Parse the trigger out of the body if present (matches BLOCK_TEMPLATE).
    const trigMatch = (data.content || '').match(/^\*\*Trigger\*\*:\s*(.+)$/m);
    const trigger = trigMatch ? trigMatch[1].trim() : '(no trigger line)';
    view.innerHTML =
      '<h2><span class="status-pill blocked">PAUSED</span> Plan is blocked</h2>' +
      '<p class="lede">No further ticks will run until <code>BLOCKED.md</code> is removed.</p>' +
      (state.lastLocked
        ? '<div class="note"><strong>Note:</strong> a tick is currently still running. Pausing only prevents future ticks — the in-flight tick will finish on its own (it does not check the block file mid-run).</div>'
        : '') +
      '<div class="meta-row">file: memory-plan/BLOCKED.md · trigger: ' + esc(trigger) + '</div>' +
      '<div class="actions">' +
        '<button class="primary" id="btn-resume">▶ Resume (delete BLOCKED.md)</button>' +
        '<button class="danger" id="btn-edit-block">Edit reason</button>' +
      '</div>' +
      '<div id="block-toast"></div>' +
      '<div class="doc-render">' + esc(data.content || '(empty)') + '</div>';
    $('btn-resume').addEventListener('click', async () => {
      if (!confirm('Resume the plan?\\n\\nDeletes BLOCKED.md so the next tick runs. If the scheduler was auto-unloaded by a previous fast-exit, it will also be reloaded.')) return;
      const res = await doUnblock();
      if (res.error) showToast('block-toast', 'Error: ' + res.error, true);
      else {
        let msg = 'Resumed — block file deleted.';
        if (res.scheduler_reloaded) msg += ' Scheduler reloaded.';
        else if (res.scheduler_error) msg += ' (Scheduler reload failed: ' + res.scheduler_error + ')';
        showToast('block-toast', msg, false);
      }
    });
    $('btn-edit-block').addEventListener('click', () => renderBlockEditor(data.content || ''));
  } else {
    view.innerHTML =
      '<h2><span class="status-pill clear">CLEAR</span> Plan is running</h2>' +
      '<p class="lede">Write a <code>BLOCKED.md</code> file to pause future ticks. The framework checks for this file at the start of every tick.</p>' +
      (state.lastLocked
        ? '<div class="note"><strong>Heads up:</strong> a tick is running right now. Pausing now will prevent the <em>next</em> tick — the in-flight one runs to completion regardless.</div>'
        : '') +
      '<div class="form-row"><label for="block-trigger">Trigger (one line)</label>' +
        '<input type="text" id="block-trigger" placeholder="e.g. operator pause — investigating Step 0.5"></div>' +
      '<div class="form-row"><label for="block-detail">Detail (optional — multi-line)</label>' +
        '<textarea id="block-detail" placeholder="What\'s wrong, what you need to look into, anything the next operator should know."></textarea></div>' +
      '<div class="actions">' +
        '<button class="primary" id="btn-pause">⏸ Pause future ticks</button>' +
      '</div>' +
      '<div id="block-toast"></div>';
    $('btn-pause').addEventListener('click', async () => {
      const trigger = $('block-trigger').value.trim() || 'operator pause';
      const detail  = $('block-detail').value;
      if (!confirm('Pause future ticks?\n\nWrites memory-plan/BLOCKED.md. The current tick (if any) continues.')) return;
      const res = await doBlock({ trigger, detail });
      showToast('block-toast', res.error ? 'Error: ' + res.error : 'Paused — BLOCKED.md written.', !!res.error);
    });
  }
}

function renderBlockEditor(currentContent) {
  const view = $('block-view');
  view.innerHTML =
    '<h2><span class="status-pill blocked">PAUSED</span> Edit block reason</h2>' +
    '<p class="lede">Replace the full content of <code>BLOCKED.md</code>. The plan stays paused until you click Resume on the previous screen.</p>' +
    '<div class="form-row"><label for="block-edit">BLOCKED.md content</label>' +
      '<textarea id="block-edit" style="min-height:280px;">' + esc(currentContent) + '</textarea></div>' +
    '<div class="actions">' +
      '<button class="primary" id="btn-save">Save</button>' +
      '<button class="danger" id="btn-cancel">Cancel</button>' +
    '</div>' +
    '<div id="block-toast"></div>';
  $('btn-cancel').addEventListener('click', () => renderBlock());
  $('btn-save').addEventListener('click', async () => {
    const content = $('block-edit').value;
    const r = await fetch('/api/plans/' + state.planId + '/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, force: true }),
    });
    const res = await r.json();
    if (res.error) showToast('block-toast', 'Error: ' + res.error, true);
    else renderBlock();
  });
}

function showToast(id, msg, isErr) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = '<div class="toast' + (isErr ? ' err' : '') + '">' + esc(msg) + '</div>';
  if (!isErr) setTimeout(() => { el.innerHTML = ''; }, 4000);
}

// ── Automation ────────────────────────────────────────────────────────────────
function humanInterval(sec) {
  sec = Number(sec);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return (sec / 60).toFixed(sec % 60 === 0 ? 0 : 1) + ' min';
  if (sec < 86400) return (sec / 3600).toFixed(sec % 3600 === 0 ? 0 : 1) + ' h';
  return (sec / 86400).toFixed(sec % 86400 === 0 ? 0 : 1) + ' d';
}

function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'in the future';
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}

const INTERVAL_PRESETS = [
  { label: '5 min',  s: 300   },
  { label: '15 min', s: 900   },
  { label: '30 min', s: 1800  },
  { label: '1 h',    s: 3600  },
  { label: '2 h',    s: 7200  },
  { label: '6 h',    s: 21600 },
];

async function renderAutomation() {
  if (!state.planId) return;
  const view = $('auto-view');
  view.innerHTML = '<div class="empty" style="padding:30px;color:var(--dim);">loading…</div>';
  const r = await fetch('/api/plans/' + state.planId + '/automation');
  if (!r.ok) { view.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const s = await r.json();
  const cfg = s.config;

  const loaded = s.launchd.loaded;
  const plistExists = s.plist_exists;
  const persisted = cfg._persisted;
  // Effective mode/interval/throttle: prefer installed plist values, else config.
  const effMode     = s.plist_mode || cfg.mode || 'interval';
  const currentInterval = s.plist_interval_seconds || cfg.interval_seconds;
  const currentThrottle = s.plist_throttle_seconds || cfg.throttle_seconds || 30;

  const statusPill = loaded
    ? '<span class="status-pill on">RUNNING</span>'
    : (plistExists ? '<span class="status-pill warn">plist on disk, not loaded</span>' : '<span class="status-pill off">not installed</span>');

  let html = '';
  html += '<h2>' + statusPill + ' Automated tick scheduler</h2>';
  html += '<p class="lede" style="color:var(--dim);margin:0 0 24px;font-size:13px;">' +
    'Runs <code>' + esc(cfg.tick_command.split('/').pop()) + '</code> via macOS launchd. ' +
    'Independent from manual <code>./...-tick.sh</code> invocations.</p>';

  // ── Section: Current status ──
  html += '<div class="section"><h3>Current status</h3><div class="kv-grid">';
  const stateLine = loaded
    ? (effMode === 'chain'
        ? 'loaded — <strong>chain mode</strong> (restarts ≥' + humanInterval(currentThrottle) + ' after each tick exits)'
        : 'loaded — <strong>interval mode</strong> (fires every ' + humanInterval(currentInterval) + ')')
    : 'not loaded';
  html += '<div class="k">State</div><div class="v">' + stateLine + '</div>';
  if (loaded) {
    html += '<div class="k">launchd PID</div><div class="v ' + (s.launchd.pid ? '' : 'muted') + '">' +
      (s.launchd.pid != null ? s.launchd.pid : '(not currently executing)') + '</div>';
    html += '<div class="k">Last exit status</div><div class="v ' + (s.launchd.last_exit_status === 0 ? '' : 'muted') + '">' +
      (s.launchd.last_exit_status != null ? s.launchd.last_exit_status : '—') + '</div>';
  }
  html += '<div class="k">Last tick log</div><div class="v">' +
    (s.last_tick_name ? esc(s.last_tick_name) + '  <span class="muted">(' + relativeTime(s.last_tick_mtime) + ')</span>' : '—') +
    '</div>';
  html += '<div class="k">Config persisted</div><div class="v ' + (persisted ? '' : 'muted') + '">' +
    (persisted ? 'automation.json present' : 'using derived defaults (not saved yet)') + '</div>';
  html += '</div></div>';

  // ── Section: Schedule ──
  html += '<div class="section"><h3>Schedule</h3>';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:14px;">' +
    'Choose how the autonomous tick is triggered.' +
    '</div>';

  // Mode toggle.
  html += '<div class="mode-toggle">' +
    '<button type="button" data-mode="interval" class="' + (effMode === 'interval' ? 'active' : '') + '">' +
      '<span class="mode-name">⏱ Interval</span>' +
      '<span class="mode-desc">Fires every N minutes regardless of work</span>' +
    '</button>' +
    '<button type="button" data-mode="chain" class="' + (effMode === 'chain' ? 'active' : '') + '">' +
      '<span class="mode-name">⛓ Chain</span>' +
      '<span class="mode-desc">Fires the next tick as soon as the previous one exits</span>' +
    '</button>' +
  '</div>';

  // Interval mode block.
  html += '<div class="mode-block' + (effMode === 'interval' ? ' active' : '') + '" id="mode-block-interval">';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px;">' +
    'Each tick may close one step (typically 5–15 min of headless Claude work). Pick an interval longer than a typical tick to avoid overlap (the lock dir prevents real overlap, but skips waste a slot).' +
    '</div>';
  html += '<div class="presets" id="interval-presets">';
  for (const p of INTERVAL_PRESETS) {
    html += '<button type="button" class="preset' + (p.s === currentInterval ? ' active' : '') + '" data-seconds="' + p.s + '">' + esc(p.label) + '</button>';
  }
  html += '</div>';
  html += '<div class="interval-input">' +
    '<label style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Custom:</label>' +
    '<input type="number" id="interval-val" value="' + (currentInterval / 60).toFixed(currentInterval % 60 === 0 ? 0 : 1) + '" min="1" step="1">' +
    '<select id="interval-unit">' +
      '<option value="60">minutes</option>' +
      '<option value="1">seconds</option>' +
      '<option value="3600">hours</option>' +
    '</select>' +
    '<button type="button" class="primary" id="interval-save">Apply interval</button>' +
    '</div>';
  html += '</div>'; // /mode-block-interval

  // Chain mode block.
  html += '<div class="mode-block' + (effMode === 'chain' ? ' active' : '') + '" id="mode-block-chain">';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px;">' +
    'launchd <code>KeepAlive</code>: every time the tick wrapper exits, it is restarted after the throttle gap. This means ticks run back-to-back — the next one fires as soon as the previous one closes a step (or exits early because the lock is held / tree dirty / blocked).' +
    '</div>';
  html += '<div class="note" style="margin:8px 0 12px;">' +
    '<strong>Heads up:</strong> chain mode keeps polling whenever there\'s nothing to do (BLOCKED.md, dirty tree, lock held, plan complete). It exits fast and waits the throttle gap. Set a sane floor.' +
    '</div>';
  html += '<div class="interval-input">' +
    '<label style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Throttle (min gap):</label>' +
    '<input type="number" id="throttle-val" value="' + currentThrottle + '" min="10" step="5">' +
    '<span style="color:var(--dim);font-size:12px;">seconds (launchd minimum: 10)</span>' +
    '<button type="button" class="primary" id="throttle-save" style="margin-left:8px;">Apply throttle</button>' +
    '</div>';
  html += '<div class="presets" style="margin-top:8px;">';
  for (const t of [10, 30, 60, 120, 300]) {
    html += '<button type="button" class="preset throttle-preset' + (t === currentThrottle ? ' active' : '') + '" data-throttle="' + t + '">' + t + 's</button>';
  }
  html += '</div>';
  html += '</div>'; // /mode-block-chain

  html += '<div id="interval-toast"></div>';
  html += '</div>'; // /section schedule

  // ── Section: Actions ──
  html += '<div class="section"><h3>Actions</h3>';
  if (state.lastLocked && !loaded) {
    html += '<div class="note">A tick is currently running (manual or just finished). Loading the scheduler is safe — the lock will be released when the in-flight tick completes.</div>';
  }
  html += '<div class="actions">';
  if (loaded) {
    html += '<button type="button" class="primary" id="btn-kickstart">▶ Fire tick now</button>';
    html += '<button type="button" class="danger" id="btn-unload">⏹ Unload (stop scheduler)</button>';
  } else {
    html += '<button type="button" class="primary" id="btn-load"' + (s.tick_command_exists ? '' : ' disabled title="tick command not found"') + '>▶ Load scheduler</button>';
  }
  html += '</div>';
  html += '<div id="action-toast"></div>';
  html += '</div>';

  // ── Section: Configuration (read-only display) ──
  html += '<div class="section"><h3>Configuration</h3><div class="kv-grid">';
  html += '<div class="k">launchd label</div><div class="v">' + esc(cfg.plist_label) + '</div>';
  html += '<div class="k">plist file</div><div class="v">' + esc(cfg.plist_path) + '</div>';
  html += '<div class="k">tick command</div><div class="v">' + esc(cfg.tick_command) +
    (s.tick_command_exists ? '' : '  <span style="color:var(--red);">(missing!)</span>') + '</div>';
  html += '<div class="k">working dir</div><div class="v">' + esc(cfg.working_dir) + '</div>';
  html += '<div class="k">stdout log</div><div class="v">' + esc(cfg.stdout_path) + '</div>';
  html += '<div class="k">stderr log</div><div class="v">' + esc(cfg.stderr_path) + '</div>';
  html += '<div class="k">env</div><div class="v">' + Object.entries(cfg.env || {}).map(([k,v]) => k + '=' + v).join('  ') + '</div>';
  html += '</div>';
  html += '<div style="margin-top:14px;font-size:11px;color:var(--dim);">Stored at <code>' + esc(state.planId) + '/automation.json</code>. Hand-edit then re-save from the UI to apply.</div>';
  html += '</div>';

  view.innerHTML = html;

  // Wire interactions.
  for (const btn of view.querySelectorAll('.preset[data-seconds]')) {
    btn.addEventListener('click', () => {
      const sec = Number(btn.dataset.seconds);
      $('interval-val').value = (sec / 60).toFixed(sec % 60 === 0 ? 0 : 1);
      $('interval-unit').value = '60';
      view.querySelectorAll('.preset[data-seconds]').forEach(b => b.classList.toggle('active', b === btn));
    });
  }
  for (const btn of view.querySelectorAll('.throttle-preset')) {
    btn.addEventListener('click', () => {
      $('throttle-val').value = btn.dataset.throttle;
      view.querySelectorAll('.throttle-preset').forEach(b => b.classList.toggle('active', b === btn));
    });
  }
  // Mode toggle.
  for (const btn of view.querySelectorAll('.mode-toggle button')) {
    btn.addEventListener('click', async () => {
      const newMode = btn.dataset.mode;
      if (newMode === effMode) return;
      const msg = newMode === 'chain'
        ? 'Switch to CHAIN mode? Next tick fires as soon as the previous one exits (min ' + currentThrottle + 's gap).\\n\\nThe scheduler will reload now.'
        : 'Switch to INTERVAL mode? Next tick fires every ' + Math.round(currentInterval / 60) + ' min on a fixed cadence.\\n\\nThe scheduler will reload now.';
      if (!confirm(msg)) return;
      const r2 = await fetch('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Switched to ' + newMode + ' mode' +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const throttleSaveBtn = $('throttle-save');
  if (throttleSaveBtn) {
    throttleSaveBtn.addEventListener('click', async () => {
      const sec = Number($('throttle-val').value);
      if (!Number.isFinite(sec) || sec < 10) {
        showToast('interval-toast', 'Throttle must be at least 10 seconds (launchd minimum).', true);
        return;
      }
      const r2 = await fetch('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ throttle_seconds: sec, mode: 'chain' }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Throttle set to ' + sec + 's' +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const intervalSaveBtn = $('interval-save');
  if (intervalSaveBtn) {
    intervalSaveBtn.addEventListener('click', async () => {
      const val = Number($('interval-val').value);
      const unit = Number($('interval-unit').value);
      const sec = Math.round(val * unit);
      if (!Number.isFinite(sec) || sec < 60) {
        showToast('interval-toast', 'Interval must be at least 60 seconds.', true);
        return;
      }
      const r2 = await fetch('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_seconds: sec, mode: 'interval' }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Interval set to ' + humanInterval(sec) +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (config saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const loadBtn = $('btn-load');
  if (loadBtn) loadBtn.addEventListener('click', async () => {
    const r2 = await fetch('/api/plans/' + state.planId + '/automation/load', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else { showToast('action-toast', res.msg || 'loaded', false); setTimeout(renderAutomation, 600); }
  });
  const unloadBtn = $('btn-unload');
  if (unloadBtn) unloadBtn.addEventListener('click', async () => {
    if (!confirm('Unload the scheduler? No more automated ticks will fire until you load it again.')) return;
    const r2 = await fetch('/api/plans/' + state.planId + '/automation/unload', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else { showToast('action-toast', res.msg || 'unloaded', false); setTimeout(renderAutomation, 600); }
  });
  const kickBtn = $('btn-kickstart');
  if (kickBtn) kickBtn.addEventListener('click', async () => {
    const r2 = await fetch('/api/plans/' + state.planId + '/automation/kickstart', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else { showToast('action-toast', res.msg || 'kickstart fired', false); }
  });
}

// ── History ───────────────────────────────────────────────────────────────────
async function renderHistory() {
  if (!state.planId) return;
  const r = await fetch('/api/plans/' + state.planId + '/logs');
  if (!r.ok) return;
  const logs = await r.json();
  const list = $('history-list');
  list.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    div.className = 'h-item';
    const kb = (l.size / 1024).toFixed(1);
    const when = new Date(l.mtime).toLocaleString();
    div.innerHTML =
      '<div class="name">' + esc(l.name) + '</div>' +
      '<div class="size">' + kb + ' KB</div>' +
      '<div class="time">' + esc(when) + '</div>';
    div.addEventListener('click', () => {
      $('log-picker').dataset.pinned = l.name;
      $('follow-new').checked = false;
      state.tab = 'live';
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'live'));
      document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-live'));
      $('live-controls').style.display = '';
      reconnectStream();
      setTimeout(() => { $('log-picker').value = l.name; }, 200);
    });
    list.appendChild(div);
  }
  if (!logs.length) list.innerHTML = '<div class="empty">no tick logs yet</div>';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
refreshPlans();
setInterval(refreshPlans, 30000);
</script>
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

const PLAN_PATH_RE = /^\/api\/plans\/([^/]+)(\/.*)?$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/plans') {
    return json(res, {
      roots: ROOTS,
      plans: PLANS.map(planSummary),
    });
  }

  const m = url.pathname.match(PLAN_PATH_RE);
  if (m) {
    const plan = findPlan(m[1]);
    if (!plan) return json(res, { error: 'plan not found: ' + m[1] }, 404);
    const sub = m[2] || '/';

    if (sub === '/state') return json(res, planSummary(plan));
    if (sub === '/logs')  return json(res, tickLogs(plan));
    if (sub === '/inventory') return json(res, inventoryRows(plan));
    if (sub === '/docs')  return json(res, planDocuments(plan));

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
        const r = await launchctlBoot(process.getuid(), cfg.plist_path);
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
              await launchctlBoot(process.getuid(), saved.plist_path);
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
        const r = await launchctlBoot(process.getuid(), cfg.plist_path);
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

    if (sub === '/doc') {
      const rel = url.searchParams.get('path');
      if (!rel) return json(res, { error: 'missing ?path=' }, 400);
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

    if (sub === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(':ok\n\n');

      const pinned = url.searchParams.get('log');
      let currentPath = pinned ? path.join(planTickLogDir(plan), pinned) : latestLog(plan);
      let position = 0;
      let closed = false;

      const send = (event, data) => {
        if (closed) return;
        res.write('event: ' + event + '\n' + 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
      };

      const emitFull = () => {
        if (!currentPath || !fs.existsSync(currentPath)) {
          send('file', '(no tick logs yet)');
          return;
        }
        const buf = fs.readFileSync(currentPath, 'utf8');
        position = Buffer.byteLength(buf, 'utf8');
        send('file', path.basename(currentPath));
        send('append', JSON.stringify(buf));
      };

      emitFull();

      const interval = setInterval(() => {
        if (closed) return;
        try {
          if (!pinned) {
            const newest = latestLog(plan);
            if (newest && newest !== currentPath) {
              currentPath = newest;
              position = 0;
              send('switch', path.basename(newest));
              send('file', path.basename(newest));
              const buf = fs.readFileSync(currentPath, 'utf8');
              position = Buffer.byteLength(buf, 'utf8');
              send('append', JSON.stringify(buf));
              return;
            }
          }
          if (!currentPath || !fs.existsSync(currentPath)) return;
          const stat = fs.statSync(currentPath);
          if (stat.size > position) {
            const fd = fs.openSync(currentPath, 'r');
            const buf = Buffer.alloc(stat.size - position);
            fs.readSync(fd, buf, 0, buf.length, position);
            fs.closeSync(fd);
            position = stat.size;
            send('append', JSON.stringify(buf.toString('utf8')));
          } else if (stat.size < position) {
            position = 0;
            emitFull();
          }
        } catch {}
      }, 400);

      const heartbeat = setInterval(() => {
        if (!closed) res.write(':hb\n\n');
      }, 15000);

      req.on('close', () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try { res.end(); } catch {}
      });
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`workplan viewer → http://localhost:${PORT}\n`);
  process.stdout.write(`discovery roots: ${ROOTS.join(', ')}\n`);
  process.stdout.write(`discovered ${PLANS.length} plan(s): ${PLANS.map(p => p.id).join(', ') || '(none yet)'}\n`);
});

process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
