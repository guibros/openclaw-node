#!/usr/bin/env node
// memory-plan-web.mjs — local web viewer for memory-plan tick logs.
//
// Serves a single HTML page at http://localhost:7892 that shows the live
// verbatim transcript from memory-plan/tick-logs/<newest>.log, auto-switches
// when a new tick starts, and displays current plan state in a header bar.
//
// Independent from mission-control (which runs on :3000). Pure stdlib —
// no npm install needed.
//
// Usage:
//   ./workspace-bin/memory-plan-web.mjs                # bind 127.0.0.1:7892
//   MEMORY_PLAN_WEB_PORT=9000 ./workspace-bin/memory-plan-web.mjs
//
// Stop with Ctrl-C. Safe to run in the background:
//   nohup ./workspace-bin/memory-plan-web.mjs </dev/null \
//         >>/tmp/memory-plan-web.log 2>&1 & disown

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.MEMORY_PLAN_WEB_PORT || 7892);
const ROOT = '/Users/moltymac/openclaw-nodedev';
const LOG_DIR = path.join(ROOT, 'memory-plan/tick-logs');
const STATUS_SCRIPT = path.join(ROOT, 'workspace-bin/memory-plan-status.sh');

function latestLog() {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
  if (!files.length) return null;
  // Filename format is YYYYMMDD-HHMMSS.log so lexicographic sort = chronological.
  files.sort();
  return path.join(LOG_DIR, files[files.length - 1]);
}

function listLogs() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .sort()
    .reverse()
    .slice(0, 50)
    .map(f => {
      const full = path.join(LOG_DIR, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    });
}

function getState(cb) {
  execFile(STATUS_SCRIPT, ['--json'], { timeout: 5000 }, (err, stdout) => {
    if (err) return cb({ error: err.message });
    try { cb(JSON.parse(stdout)); }
    catch (e) { cb({ error: 'status JSON parse: ' + e.message, raw: stdout }); }
  });
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>memory-plan — live tick</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --dim: #8b949e;
    --accent: #58a6ff;
    --green: #56d364;
    --yellow: #e3b341;
    --red: #f85149;
    --magenta: #d2a8ff;
    --cyan: #79c0ff;
    --blue: #58a6ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.5;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    flex-shrink: 0;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  header .title {
    font-weight: 600;
    color: var(--accent);
  }
  header .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  header .badge .key {
    color: var(--dim);
  }
  header .badge .val {
    color: var(--text);
    font-weight: 500;
  }
  header .badge.ok .val { color: var(--green); }
  header .badge.warn .val { color: var(--yellow); }
  header .badge.bad .val { color: var(--red); }
  header .spacer { flex: 1; }
  header .controls {
    display: flex;
    gap: 10px;
    font-size: 12px;
    color: var(--dim);
  }
  header .controls label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  header .controls select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
  }
  #pause-banner {
    display: none;
    background: var(--yellow);
    color: #000;
    padding: 4px 16px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  #pause-banner.visible { display: block; }
  main {
    flex: 1;
    overflow-y: scroll;
    padding: 12px 16px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  main .empty {
    color: var(--dim);
    font-style: italic;
  }
  /* ANSI color classes */
  .a-dim     { color: var(--dim); }
  .a-bold    { font-weight: 700; }
  .a-red     { color: var(--red); }
  .a-green   { color: var(--green); }
  .a-yellow  { color: var(--yellow); }
  .a-blue    { color: var(--blue); }
  .a-magenta { color: var(--magenta); }
  .a-cyan    { color: var(--cyan); }
  /* Subtle highlight for header lines (start with "[HH:MM:SS]") */
  .ev-line { border-left: 2px solid transparent; padding-left: 8px; margin-left: -8px; }
  .ev-line:hover { background: rgba(255,255,255,0.02); }
</style>
</head>
<body>
<header>
  <span class="title">memory-plan</span>
  <span class="badge"><span class="key">log:</span><span class="val" id="b-log">—</span></span>
  <span class="badge"><span class="key">version:</span><span class="val" id="b-version">—</span></span>
  <span class="badge"><span class="key">progress:</span><span class="val" id="b-progress">—</span></span>
  <span class="badge" id="b-lock-wrap"><span class="key">lock:</span><span class="val" id="b-lock">—</span></span>
  <span class="badge" id="b-block-wrap"><span class="key">block:</span><span class="val" id="b-block">—</span></span>
  <span class="badge"><span class="key">step:</span><span class="val" id="b-step">—</span></span>
  <span class="spacer"></span>
  <div class="controls">
    <label><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
    <label><input type="checkbox" id="follow-new" checked> follow new tick</label>
    <select id="log-picker"></select>
  </div>
</header>
<div id="pause-banner">⏸ scroll paused — click to resume auto-scroll</div>
<main id="log">
  <div class="empty">connecting…</div>
</main>
<script>
  const logEl = document.getElementById('log');
  const banner = document.getElementById('pause-banner');
  const autoscrollEl = document.getElementById('autoscroll');
  const followNewEl = document.getElementById('follow-new');
  const pickerEl = document.getElementById('log-picker');

  let currentLog = null;
  let evtSource = null;
  let userPaused = false;

  // Convert ANSI escape codes in plain text to safe HTML.
  function ansiToHtml(text) {
    // 1. HTML-escape first.
    text = text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    // 2. Walk the escape sequences and emit spans.
    const re = /\\u001b\\[([0-9;]*)m/g;
    // Actually use real escape char:
    const ESC = String.fromCharCode(27);
    const real = new RegExp(ESC + '\\\\[([0-9;]*)m', 'g');
    let out = '';
    let lastEnd = 0;
    let openSpans = 0;
    const codeToClass = {
      '0':  null,
      '1':  'a-bold',
      '2':  'a-dim',
      '31': 'a-red',
      '32': 'a-green',
      '33': 'a-yellow',
      '34': 'a-blue',
      '35': 'a-magenta',
      '36': 'a-cyan',
    };
    let m;
    while ((m = real.exec(text)) !== null) {
      out += text.slice(lastEnd, m.index);
      const codes = m[1].split(';').filter(Boolean);
      if (codes.length === 0 || codes.includes('0')) {
        // reset
        while (openSpans > 0) { out += '</span>'; openSpans--; }
      } else {
        for (const c of codes) {
          const cls = codeToClass[c];
          if (cls) {
            out += '<span class="' + cls + '">';
            openSpans++;
          }
        }
      }
      lastEnd = m.index + m[0].length;
    }
    out += text.slice(lastEnd);
    while (openSpans > 0) { out += '</span>'; openSpans--; }
    return out;
  }

  function wrapEventLines(html) {
    // Wrap lines starting with [HH:MM:SS] in a hover-highlight div.
    return html.replace(/^(\\[\\d{2}:\\d{2}:\\d{2}\\].*)$/gm, '<span class="ev-line">$1</span>');
  }

  function appendText(text) {
    if (!text) return;
    // Remove the "connecting…" placeholder if present.
    if (logEl.firstElementChild && logEl.firstElementChild.classList.contains('empty')) {
      logEl.innerHTML = '';
    }
    // Convert in chunks. Append by setting innerHTML on a placeholder.
    const html = wrapEventLines(ansiToHtml(text));
    const tmp = document.createElement('span');
    tmp.innerHTML = html;
    while (tmp.firstChild) logEl.appendChild(tmp.firstChild);
    if (autoscrollEl.checked && !userPaused) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function clearLog() {
    logEl.innerHTML = '';
  }

  function connect(logName) {
    if (evtSource) { evtSource.close(); evtSource = null; }
    clearLog();
    currentLog = logName || null;
    const url = '/stream' + (logName ? '?log=' + encodeURIComponent(logName) : '');
    evtSource = new EventSource(url);
    evtSource.addEventListener('file', (e) => {
      currentLog = e.data;
      document.getElementById('b-log').textContent = e.data;
      // Reflect in picker.
      if (pickerEl.value !== e.data) pickerEl.value = e.data;
    });
    evtSource.addEventListener('append', (e) => {
      try {
        const text = JSON.parse(e.data);
        appendText(text);
      } catch {}
    });
    evtSource.addEventListener('switch', (e) => {
      // A new tick started — clear and switch only if "follow new tick" is on.
      const newName = e.data;
      if (followNewEl.checked) {
        clearLog();
        currentLog = newName;
        document.getElementById('b-log').textContent = newName;
      }
    });
    evtSource.onerror = () => {
      // Auto-reconnect — EventSource does this for us.
    };
  }

  // Pause auto-scroll when user scrolls up.
  logEl.addEventListener('scroll', () => {
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 20;
    if (!atBottom && autoscrollEl.checked) {
      userPaused = true;
      banner.classList.add('visible');
    } else if (atBottom) {
      userPaused = false;
      banner.classList.remove('visible');
    }
  });
  banner.addEventListener('click', () => {
    userPaused = false;
    banner.classList.remove('visible');
    logEl.scrollTop = logEl.scrollHeight;
  });

  // Refresh state header every 5s.
  async function refreshState() {
    try {
      const r = await fetch('/state');
      if (!r.ok) return;
      const s = await r.json();
      if (s.error) return;
      document.getElementById('b-version').textContent = s.version;
      document.getElementById('b-progress').textContent = (s.closed_steps || 0) + '/' + (s.total_steps || 0);
      document.getElementById('b-lock').textContent = s.tick_locked === 'yes' ? 'held' : 'free';
      document.getElementById('b-lock-wrap').className = 'badge ' + (s.tick_locked === 'yes' ? 'warn' : 'ok');
      document.getElementById('b-block').textContent = s.blocked === 'yes' ? 'BLOCKED' : 'clear';
      document.getElementById('b-block-wrap').className = 'badge ' + (s.blocked === 'yes' ? 'bad' : 'ok');
      document.getElementById('b-step').textContent = (s.current_step || '').replace(/\\s+/g, ' ').slice(0, 80) || '(none)';
    } catch {}
  }
  setInterval(refreshState, 5000);
  refreshState();

  // Populate log picker.
  async function refreshLogs() {
    try {
      const r = await fetch('/logs');
      if (!r.ok) return;
      const logs = await r.json();
      const sel = currentLog || (logs[0] && logs[0].name);
      pickerEl.innerHTML = logs.map(l => {
        const kb = (l.size / 1024).toFixed(1);
        return '<option value="' + l.name + '">' + l.name + '  (' + kb + ' KB)</option>';
      }).join('');
      if (sel) pickerEl.value = sel;
    } catch {}
  }
  pickerEl.addEventListener('change', () => {
    followNewEl.checked = false;
    connect(pickerEl.value);
  });
  refreshLogs();
  setInterval(refreshLogs, 10000);

  // Connect to newest log on load.
  connect(null);
</script>
</body>
</html>
`;

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/state') {
    getState((s) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(s));
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(listLogs()));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const pinnedName = url.searchParams.get('log');
    let currentPath = pinnedName ? path.join(LOG_DIR, pinnedName) : latestLog();
    let position = 0;
    let closed = false;

    function send(event, data) {
      if (closed) return;
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    }

    function emitFull() {
      if (!currentPath || !fs.existsSync(currentPath)) {
        send('file', '(no logs yet)');
        return;
      }
      const buf = fs.readFileSync(currentPath, 'utf8');
      position = Buffer.byteLength(buf, 'utf8');
      send('file', path.basename(currentPath));
      send('append', JSON.stringify(buf));
    }

    emitFull();

    // Poll every 400ms. Cheap on a 100KB-ish file.
    const interval = setInterval(() => {
      if (closed) return;
      try {
        // Detect a newer log when not pinned.
        if (!pinnedName) {
          const newest = latestLog();
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
          // File got truncated — reset and re-emit.
          position = 0;
          emitFull();
        }
      } catch (e) {
        // Best-effort. Continue polling.
      }
    }, 400);

    // Heartbeat to keep the connection alive through proxies.
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(':hb\n\n');
    }, 15000);

    req.on('close', () => {
      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`memory-plan web viewer → http://localhost:${PORT}\n`);
});

process.on('SIGINT',  () => { process.stdout.write('\nshutting down\n'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
