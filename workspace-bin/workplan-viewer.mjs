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
      if (!confirm('Resume the plan? This deletes BLOCKED.md so the next tick runs.')) return;
      const res = await doUnblock();
      showToast('block-toast', res.error ? 'Error: ' + res.error : 'Resumed — block file deleted.', !!res.error);
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

const server = http.createServer((req, res) => {
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
      if (!fs.existsSync(file)) return json(res, { ok: true, blocked: false, note: 'already clear' });
      try {
        fs.unlinkSync(file);
        return json(res, { ok: true, blocked: false });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
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
