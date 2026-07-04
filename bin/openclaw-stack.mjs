#!/usr/bin/env node
// openclaw-stack — one command (and one double-clickable icon) for the whole node.
//
//   openclaw-stack up        start everything installed + probe + popup
//   openclaw-stack status    probe table only, no side effects
//   openclaw-stack down      stop every openclaw unit (and the bridge child)
//
// Discovery over hardcoding: starts whatever ai.openclaw.* launchd plists
// (macOS) or openclaw-* systemd user units (Linux) are installed on this node.
// Units parked as .disabled are REPORTED but never resurrected — they were
// disabled deliberately (crash-loop triage 2026-07-03); re-enabling is an
// operator move. companion-bridge lives in its own repo with no service unit:
// when its repo exists and :8787 is closed, `up` spawns it detached.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const LAUNCH_AGENTS = path.join(HOME, 'Library', 'LaunchAgents');
const BRIDGE_DIR = process.env.OPENCLAW_BRIDGE_DIR
  || path.join(HOME, 'Documents', 'openclaw infrastructure', 'companion-bridge');
const BRIDGE_LOG = path.join(HOME, '.openclaw', 'logs', 'companion-bridge.log');
const MC_URL = process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000';

// Port probes for the units that expose one; everything else is judged by
// launchd/systemd process state. Periodic (timer-style) units are healthy
// while LOADED even with no live pid.
export const PORTS = {
  'nats': 4222,
  'mission-control': 3000,
  'workplan-viewer': 7892,
  'memory-daemon': 7893,
  'companion-bridge': 8787,
};
export const PERIODIC = new Set([
  'observer', 'consolidation-scheduler', 'scheduler-heartbeat',
  'transcript-archive', 'log-rotate',
]);

export function shortId(unit) {
  return unit.replace(/^ai\.openclaw\./, '').replace(/^openclaw-/, '')
    .replace(/\.(plist|service|timer)$/, '');
}

export function scanLaunchdUnits(dir = LAUNCH_AGENTS) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const units = [];
  for (const f of entries) {
    if (!f.startsWith('ai.openclaw.')) continue;
    if (f.endsWith('.plist')) {
      units.push({ id: shortId(f), label: f.replace(/\.plist$/, ''), plist: path.join(dir, f), disabled: false });
    } else if (f.endsWith('.plist.disabled')) {
      units.push({ id: shortId(f.replace(/\.disabled$/, '')), label: f.replace(/\.plist\.disabled$/, ''), plist: path.join(dir, f), disabled: true });
    }
  }
  return units.sort((a, b) => a.id.localeCompare(b.id));
}

export function scanSystemdUnits(exec = execFileSync) {
  try {
    const out = String(exec('systemctl', ['--user', 'list-unit-files', 'openclaw-*', '--no-legend', '--plain'], { encoding: 'utf8' }));
    return out.split('\n').filter(Boolean).map(l => {
      const [name, state] = l.trim().split(/\s+/);
      return { id: shortId(name), label: name, disabled: state === 'masked', timer: name.endsWith('.timer') };
    });
  } catch { return []; }
}

export function probePort(port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = ok => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function launchctlPids() {
  const pids = new Map();
  try {
    for (const line of execFileSync('launchctl', ['list'], { encoding: 'utf8' }).split('\n')) {
      const m = line.match(/^(\d+|-)\t(-?\d+)\t(\S+)/);
      if (m) pids.set(m[3], m[1] === '-' ? null : Number(m[1]));
    }
  } catch { /* table stays empty → units read as not loaded */ }
  return pids;
}

export function classify(unit, { loaded, pid, portOk }) {
  if (unit.disabled) return 'DISABLED';
  if (unit.id in PORTS || unit.port) return portOk ? 'LIVE' : (loaded ? 'DOWN' : 'OFF');
  if (!loaded) return 'OFF';
  if (pid) return 'LIVE';
  return PERIODIC.has(unit.id) ? 'LOADED' : 'DOWN';
}

async function statusTable(units) {
  const pids = process.platform === 'darwin' ? launchctlPids() : new Map();
  const rows = [];
  for (const u of units) {
    const loaded = process.platform === 'darwin'
      ? pids.has(u.label)
      : systemdActive(u.label);
    const pid = process.platform === 'darwin' ? pids.get(u.label) : null;
    const port = PORTS[u.id];
    const portOk = port ? await probePort(port) : undefined;
    rows.push({ ...u, loaded, pid, port, portOk, status: classify(u, { loaded, pid, portOk }) });
  }
  const bridgeOk = await probePort(PORTS['companion-bridge']);
  rows.push({
    id: 'companion-bridge', label: '(external repo)', port: 8787, portOk: bridgeOk,
    status: bridgeOk ? 'LIVE' : (fs.existsSync(BRIDGE_DIR) ? 'DOWN' : 'ABSENT'),
  });
  return rows;
}

function systemdActive(unit) {
  try {
    return execFileSync('systemctl', ['--user', 'is-active', unit], { encoding: 'utf8' }).trim() === 'active';
  } catch { return false; }
}

function printTable(rows) {
  const pad = (s, n) => String(s ?? '').padEnd(n);
  console.log(pad('UNIT', 26) + pad('STATUS', 10) + pad('PID', 8) + 'PORT');
  for (const r of rows) {
    const port = r.port ? `${r.port} ${r.portOk ? 'open' : 'closed'}` : '';
    console.log(pad(r.id, 26) + pad(r.status, 10) + pad(r.pid ?? '', 8) + port);
  }
}

function up(units) {
  const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
  const pids = launchctlPids();
  const started = [];
  for (const u of units) {
    if (u.disabled) continue;
    if (!pids.has(u.label)) {
      try {
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, u.plist], { stdio: 'pipe' });
        started.push(u.id);
      } catch { /* already bootstrapped or racing — kickstart below covers it */ }
    }
  }
  const after = launchctlPids();
  for (const u of units) {
    if (u.disabled || PERIODIC.has(u.id)) continue;
    if (after.has(u.label) && !after.get(u.label)) {
      try {
        execFileSync('launchctl', ['kickstart', `gui/${uid}/${u.label}`], { stdio: 'pipe' });
        if (!started.includes(u.id)) started.push(u.id);
      } catch { /* reported by the probe table */ }
    }
  }
  return started;
}

function upLinux(units) {
  const started = [];
  for (const u of units) {
    if (u.disabled) continue;
    if (!systemdActive(u.label)) {
      try {
        execFileSync('systemctl', ['--user', 'start', u.label], { stdio: 'pipe' });
        started.push(u.id);
      } catch { /* reported by the probe table */ }
    }
  }
  return started;
}

async function startBridge() {
  if (await probePort(PORTS['companion-bridge'])) return 'already-live';
  const entry = path.join(BRIDGE_DIR, 'bin', 'companion-bridge.mjs');
  if (!fs.existsSync(entry)) return 'absent';
  fs.mkdirSync(path.dirname(BRIDGE_LOG), { recursive: true });
  const log = fs.openSync(BRIDGE_LOG, 'a');
  spawn(process.execPath, [entry], {
    cwd: BRIDGE_DIR, detached: true, stdio: ['ignore', log, log],
  }).unref();
  return 'started';
}

function down(units) {
  const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
  for (const u of units) {
    if (u.disabled) continue;
    if (process.platform === 'darwin') {
      try { execFileSync('launchctl', ['bootout', `gui/${uid}/${u.label}`], { stdio: 'pipe' }); } catch { }
    } else {
      try { execFileSync('systemctl', ['--user', 'stop', u.label], { stdio: 'pipe' }); } catch { }
    }
  }
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${PORTS['companion-bridge']}`], { encoding: 'utf8' }).trim();
    for (const pid of out.split('\n').filter(Boolean)) process.kill(Number(pid), 'SIGTERM');
  } catch { /* bridge not running */ }
}

function notifyResult(rows) {
  const live = rows.filter(r => r.status === 'LIVE' || r.status === 'LOADED').length;
  const total = rows.filter(r => r.status !== 'DISABLED' && r.status !== 'ABSENT').length;
  const bad = rows.filter(r => r.status === 'DOWN' || r.status === 'OFF').map(r => r.id);
  const kind = bad.length === 0 ? 'success' : 'warn';
  try {
    execFileSync(process.execPath, [
      path.join(HERE, 'openclaw-notify.mjs'),
      '--source', 'stack', '--kind', kind,
      '--title', `OpenClaw stack — ${live}/${total} up`,
      '--message', bad.length ? `not running: ${bad.join(', ')}` : 'all systems live',
      '--url', `${MC_URL}/diagnostics`,
    ], { stdio: 'pipe', timeout: 15_000 });
  } catch { /* popup is best-effort; the table already printed */ }
}

const cmd = process.argv[2] || 'status';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const units = process.platform === 'darwin' ? scanLaunchdUnits() : scanSystemdUnits();
  if (!units.length) { console.error('no openclaw units installed — run install.sh first'); process.exit(1); }

  if (cmd === 'up') {
    const started = process.platform === 'darwin' ? up(units) : upLinux(units);
    const bridge = await startBridge();
    console.log(`started: ${started.length ? started.join(', ') : '(everything already running)'} · bridge: ${bridge}`);
    await new Promise(r => setTimeout(r, 4000));
    const rows = await statusTable(units);
    printTable(rows);
    notifyResult(rows);
    process.exit(rows.some(r => r.status === 'DOWN') ? 1 : 0);
  } else if (cmd === 'down') {
    down(units);
    console.log('stack stopped (disabled units untouched)');
  } else if (cmd === 'status') {
    const rows = await statusTable(units);
    printTable(rows);
    process.exit(rows.some(r => r.status === 'DOWN') ? 1 : 0);
  } else {
    console.error('usage: openclaw-stack [up|status|down]');
    process.exit(1);
  }
}
