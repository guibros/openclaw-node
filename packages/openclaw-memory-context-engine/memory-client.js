/**
 * memory-client.js — HTTP client for the memory daemon's loopback inject
 * server (lib/memory-inject-server.mjs: POST /memory/inject, GET /health).
 *
 * The plugin runs INSIDE the OpenClaw gateway process, so it must not import
 * anything from the openclaw-node tree (that tree is deployed elsewhere and
 * the gateway does not have it on its module path). Node built-ins only.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_INJECT_URL = 'http://127.0.0.1:7893';
export const DEFAULT_TOKEN_PATH = join(homedir(), '.openclaw/config/memory-injection-token');
export const DEFAULT_TIMEOUT_MS = 4000;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.injectUrl]
 * @param {string} [opts.tokenPath]
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetch] — injectable for tests
 */
export function createMemoryClient(opts = {}) {
  const injectUrl = (opts.injectUrl || DEFAULT_INJECT_URL).replace(/\/+$/, '');
  const tokenPath = expandHome(opts.tokenPath || DEFAULT_TOKEN_PATH);
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetch || globalThis.fetch;

  // The daemon only serves loopback and the token is a local secret: refuse
  // to ever send it anywhere else, whatever the config says.
  const host = new URL(injectUrl).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`memory inject URL must be loopback, got ${host}`);
  }

  // Re-read per request: the daemon may rotate the token (it regenerates a
  // missing file on start), and a cached value would 401 until restart.
  function readToken() {
    try {
      return readFileSync(tokenPath, 'utf8').trim();
    } catch {
      return null;
    }
  }

  async function request(method, path, body) {
    const token = readToken();
    if (!token) {
      const err = new Error(`memory token not readable at ${tokenPath} (is the memory daemon installed?)`);
      err.code = 'NO_TOKEN';
      throw err;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('memory inject timeout')), timeoutMs);
    try {
      const res = await doFetch(`${injectUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
      if (!res.ok) {
        const err = new Error(`memory inject ${res.status}: ${json?.error || text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    injectUrl,
    tokenPath,
    /** @returns {Promise<{ok:boolean, ts:number}>} */
    health: () => request('GET', '/health'),
    /**
     * @param {{prompt:string, session_id?:string, frontend?:string, directive?:string}} body
     * @returns {Promise<{block:string, analysis:object, tokens:number, items:object}>}
     */
    inject: (body) => request('POST', '/memory/inject', body),
  };
}
