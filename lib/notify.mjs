// Unified desktop notification path: every event is appended to a JSONL ledger
// (the truth source) and then dispatched as an OS popup that click-links back
// to its origin URL. Platform support: macOS terminal-notifier (clickable via
// -open) with osascript fallback (honest-unclickable), Linux notify-send
// (clickable via -A + xdg-open when libnotify supports actions).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';

export const KINDS = ['info', 'success', 'warn', 'error', 'block'];

export function notifyPaths(env = process.env) {
  const home = env.OPENCLAW_NOTIFY_HOME || os.homedir();
  return {
    ledger: env.OPENCLAW_NOTIFY_LEDGER || path.join(home, '.openclaw', 'notifications', 'ledger.jsonl'),
    config: env.OPENCLAW_NOTIFY_CONFIG || path.join(home, '.openclaw', 'config', 'notify.json'),
    iconDir: env.OPENCLAW_NOTIFY_ICONS || path.join(home, '.openclaw', 'share', 'notify-icons'),
  };
}

export const DEFAULT_CONFIG = {
  enabled: true,
  sources: {},
  icons: {
    default: 'default.png',
    info: 'info.png',
    success: 'success.png',
    warn: 'warn.png',
    error: 'error.png',
    block: 'block.png',
  },
  sounds: { info: 'default', success: 'Glass', warn: 'Funk', error: 'Sosumi', block: 'Sosumi' },
};

export function loadConfig(paths = notifyPaths()) {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(paths.config, 'utf8')); } catch { /* absent/bad → defaults */ }
  return {
    ...DEFAULT_CONFIG,
    ...user,
    sources: { ...DEFAULT_CONFIG.sources, ...(user.sources || {}) },
    icons: { ...DEFAULT_CONFIG.icons, ...(user.icons || {}) },
    sounds: { ...DEFAULT_CONFIG.sounds, ...(user.sounds || {}) },
  };
}

export function resolveIcon(kind, cfg, paths, explicit) {
  for (const name of [explicit, cfg.icons[kind], cfg.icons.default]) {
    if (!name) continue;
    const p = path.isAbsolute(name) ? name : path.join(paths.iconDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── ledger ────────────────────────────────────────────────────────────────────

export function appendLedger(line, paths = notifyPaths()) {
  fs.mkdirSync(path.dirname(paths.ledger), { recursive: true });
  fs.appendFileSync(paths.ledger, JSON.stringify(line) + '\n');
}

export function recordClick(ref, paths = notifyPaths()) {
  appendLedger({ v: 1, type: 'click', ref, ts: new Date().toISOString() }, paths);
}

export function readLedger({ limit = 100, source, kind } = {}, paths = notifyPaths()) {
  let raw;
  try { raw = fs.readFileSync(paths.ledger, 'utf8'); } catch { return { events: [], total: 0 }; }
  const events = [];
  const byId = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'notification' && obj.id) {
      events.push(obj);
      byId.set(obj.id, obj);
    } else if (obj.type === 'click' && obj.ref) {
      const target = byId.get(obj.ref);
      if (target && !target.clicked_at) target.clicked_at = obj.ts;
    }
  }
  let filtered = events;
  if (source) filtered = filtered.filter(e => e.source === source);
  if (kind) filtered = filtered.filter(e => e.kind === kind);
  filtered.reverse();
  return { events: filtered.slice(0, limit), total: filtered.length };
}

// ── platform dispatch ─────────────────────────────────────────────────────────

export function findTerminalNotifier(env = process.env) {
  const candidates = [
    ...(env.PATH || '').split(':').map(d => path.join(d, 'terminal-notifier')),
    '/opt/homebrew/bin/terminal-notifier',
    '/usr/local/bin/terminal-notifier',
  ];
  return candidates.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}

let cachedActions = null;
export function notifySendSupportsActions(exec = execFileSync) {
  if (cachedActions === null) {
    try { cachedActions = /^\s*-A[,\s]/m.test(String(exec('notify-send', ['--help']))); }
    catch { cachedActions = false; }
  }
  return cachedActions;
}
export function _resetCapabilityCache() { cachedActions = null; }

export function buildDarwinArgs(evt, sound) {
  const args = [
    '-title', evt.title,
    '-message', evt.message || evt.title,
    '-group', `openclaw-${evt.source}`,
    '-sound', sound,
  ];
  if (evt.subtitle) args.push('-subtitle', evt.subtitle);
  if (evt.icon) args.push('-contentImage', evt.icon);
  if (evt.url) args.push('-open', evt.url);
  return args;
}

export function buildLinuxArgs(evt, { clickable }) {
  const urgency = evt.kind === 'error' || evt.kind === 'block' ? 'critical' : 'normal';
  const args = ['--app-name=OpenClaw', '-u', urgency];
  if (evt.icon) args.push('-i', evt.icon);
  if (clickable) args.push('-A', 'default=Open');
  args.push(evt.subtitle ? `${evt.title} — ${evt.subtitle}` : evt.title, evt.message || '');
  return args;
}

function osascriptArgs(evt, sound) {
  const esc = (s, n) => String(s || '').replace(/\n/g, ' ').replace(/"/g, '\\"').slice(0, n);
  let script = `display notification "${esc(evt.message, 200)}" with title "${esc(evt.title, 100)}"`;
  if (evt.subtitle) script += ` subtitle "${esc(evt.subtitle, 100)}"`;
  if (sound && sound !== 'default') script += ` sound name "${sound}"`;
  return ['-e', script];
}

function execQuiet(exec, cmd, args, timeout = 10_000) {
  return new Promise(resolve => {
    try { exec(cmd, args, { timeout }, err => resolve(!err)); }
    catch { resolve(false); }
  });
}

// On Linux with action support, click delivery needs a process that outlives the
// caller: notify-send -A blocks until the notification is activated or expires.
// The CLI re-spawns itself detached as that waiter (see bin/openclaw-notify.mjs).
export async function dispatch(evt, cfg, opts = {}) {
  const platform = opts.platform || process.platform;
  const exec = opts.exec || execFile;
  const sound = opts.sound || cfg.sounds[evt.kind] || 'default';

  if (platform === 'darwin') {
    const tn = opts.terminalNotifier !== undefined ? opts.terminalNotifier : findTerminalNotifier();
    if (tn) {
      const ok = await execQuiet(exec, tn, buildDarwinArgs(evt, sound));
      return { method: 'terminal-notifier', clickable: !!evt.url, ok };
    }
    const ok = await execQuiet(exec, 'osascript', osascriptArgs(evt, sound));
    return { method: 'osascript', clickable: false, ok };
  }

  if (platform === 'linux') {
    const hasActions = opts.hasActions !== undefined ? opts.hasActions : notifySendSupportsActions();
    const clickable = !!evt.url && hasActions;
    if (clickable && opts.spawnClickWaiter) {
      opts.spawnClickWaiter(evt);
      return { method: 'notify-send', clickable: true, ok: true };
    }
    const ok = await execQuiet(exec, 'notify-send', buildLinuxArgs(evt, { clickable: false }));
    return { method: 'notify-send', clickable: false, ok };
  }

  return { method: 'none', clickable: false, ok: false };
}

// Blocking path run inside the detached waiter process: shows the actionable
// notification, and if the user activates it, opens the origin + ledgers the click.
export function awaitClickAndOpen(evt, paths = notifyPaths(), opts = {}) {
  const exec = opts.exec || execFileSync;
  const open = opts.open || (url => spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref());
  let out;
  try { out = String(exec('notify-send', buildLinuxArgs(evt, { clickable: true }), { timeout: 120_000 })); }
  catch { return false; }
  if (out.trim() === 'default') {
    open(evt.url);
    recordClick(evt.id, paths);
    return true;
  }
  return false;
}

// ── the entry point ───────────────────────────────────────────────────────────

export async function notify(input, opts = {}) {
  const paths = opts.paths || notifyPaths();
  const cfg = opts.config || loadConfig(paths);
  const kind = KINDS.includes(input.kind) ? input.kind : 'info';
  const source = input.source || 'cli';
  const evt = {
    v: 1,
    type: 'notification',
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    source,
    kind,
    title: input.title || 'OpenClaw',
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    message: input.message || '',
    ...(input.url ? { url: input.url } : {}),
    node: os.hostname(),
  };
  const icon = resolveIcon(kind, cfg, paths, input.icon);
  if (icon) evt.icon = icon;

  const muted = cfg.enabled === false || cfg.sources[source] === false;
  evt.delivery = muted
    ? { method: 'muted', clickable: false, ok: false }
    : await dispatch(evt, cfg, opts);
  appendLedger(evt, paths);
  return evt;
}
