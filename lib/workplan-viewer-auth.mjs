import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function viewerTokenPath() {
  return process.env.WORKPLAN_VIEWER_TOKEN_FILE || path.join(os.homedir(), '.openclaw/config/workplan-viewer-token');
}

export function readViewerToken(file = viewerTokenPath()) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 128 || (stat.mode & 0o077) || stat.uid !== process.getuid()) {
      throw new Error('Viewer token must be an owner-private regular file');
    }
    const token = fs.readFileSync(fd, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid viewer token file');
    return token;
  } finally {
    fs.closeSync(fd);
  }
}

export function viewerAuthHeaders() {
  try { return { Authorization: `Bearer ${readViewerToken()}` }; }
  catch { return {}; }
}

function ensureToken(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (fd !== undefined) {
    try { fs.writeFileSync(fd, randomBytes(32).toString('hex') + '\n'); }
    finally { fs.closeSync(fd); }
  }
  return readViewerToken(file);
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkViewerRequest(req, port) {
  const guarded = new Set(['host', 'authorization', 'origin', 'sec-fetch-site']);
  const seen = new Set();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    if (guarded.has(name) && seen.has(name)) return { status: 400 };
    seen.add(name);
  }
  const host = String(req.headers.host || '').toLowerCase();
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (port === 80) hosts.push('localhost', '127.0.0.1');
  if (!hosts.includes(host)) return { status: 403 };
  const origin = new URL(`http://${host}`).origin;
  if (req.headers.origin !== undefined && req.headers.origin !== origin) return { status: 403 };
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return { status: 403 };
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) return { status: 403 };
  try {
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return { status: 403 };
    return { status: 200, url };
  } catch { return { status: 400 }; }
}

export function createViewerAuth({ file = viewerTokenPath(), now = Date.now, sessionTtlMs = 4 * 60 * 60 * 1000 } = {}) {
  let master = ensureToken(file);
  const sessions = new Map();
  const streams = new Map();

  function refresh() {
    let next;
    try { next = readViewerToken(file); } catch { next = null; }
    if (next !== master) {
      master = next;
      sessions.clear();
      for (const res of streams.keys()) res.destroy();
      streams.clear();
    }
    for (const [token, expiresAt] of sessions) if (expiresAt <= now()) sessions.delete(token);
    return master;
  }

  function valid(token) {
    return !!master && (equal(token, master) || (sessions.get(token) || 0) > now());
  }

  const timer = setInterval(() => {
    refresh();
    for (const [res, token] of streams) if (!valid(token)) { streams.delete(res); res.destroy(); }
  }, 1000);
  timer.unref();

  return {
    issue(credential) {
      refresh();
      if (!equal(credential, master)) return null;
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      const expiresAt = now() + sessionTtlMs;
      sessions.set(token, expiresAt);
      return { token, expiresAt };
    },
    authorize(header) {
      refresh();
      const token = /^Bearer ([a-f0-9]{64})$/i.exec(header || '')?.[1];
      return valid(token) ? token : null;
    },
    watch(req, res, token) {
      streams.set(res, token);
      res.once('close', () => streams.delete(res));
    },
    revoke(token) {
      sessions.delete(token);
      for (const [res, grant] of streams) if (grant === token) { streams.delete(res); res.destroy(); }
    },
    close() {
      clearInterval(timer);
      for (const res of streams.keys()) res.destroy();
      streams.clear();
      sessions.clear();
    },
  };
}
