/**
 * memory-inject-server.mjs — Loopback HTTP endpoint for per-prompt memory injection.
 *
 * Block 7 amendment (B) — Companion-bridge harness Tier 0 integration.
 *
 * Why an HTTP server: companion-bridge is a separate Bun process. It can't
 * directly import the in-repo lib/memory-injector.mjs. The memory daemon
 * already has every dependency loaded (BGE-M3 model, knowledge.db, state.db,
 * graph cache, llm-client, ollama-queue). Exposing injection as a small
 * loopback endpoint inside the daemon piggybacks on that state — zero
 * cold-loads, BGE-M3 stays warm across thousands of prompts (which solves
 * Block 7 amendment D for free).
 *
 * Endpoint: POST /memory/inject  (loopback only, bearer-token auth)
 *
 * Request body:  { prompt: string, session_id?: string, frontend?: string, directive?: string }
 * Response 200:  { block: string, analysis: {...}, tokens: number, items: {...} }
 * Response 401:  { error: "unauthorized" }
 * Response 400:  { error: "missing prompt" }
 * Response 500:  { error: "<message>" }
 *
 * Token: stored at ~/.openclaw/config/memory-injection-token, auto-generated
 * on first server start. Companion-bridge reads the same file.
 *
 * @module lib/memory-inject-server
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

import { createMemoryInjector } from './memory-injector.mjs';
import { formatMemoryBlock } from './memory-formatter.mjs';
import { parseMemoryDirective, replaceLastUserContent } from './memory-directives.mjs';

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_PORT = Number(process.env.MEMORY_INJECT_PORT) || 7893;
const DEFAULT_HOST = '127.0.0.1';  // loopback only — never expose
const TOKEN_PATH = join(homedir(), '.openclaw/config/memory-injection-token');
const MAX_BODY_BYTES = 64 * 1024;  // prompts > 64 KB rejected — abuse guard

// ─── Token Management ────────────────────────────────────────────────────────

/**
 * Read the auth token from disk, or generate + persist one if missing.
 * Returns the 32-byte hex string. Same file is read by companion-bridge.
 */
export function getOrCreateToken() {
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

// ─── HTTP Handler ────────────────────────────────────────────────────────────

function readJsonBody(req, max = MAX_BODY_BYTES) {
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
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid JSON: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Build the request handler. Captures dependencies (injector + token) in closure
 * so we don't reach into module globals from the server callback.
 */
function buildHandler({ injector, token }) {
  return async (req, res) => {
    // Loopback enforcement: req.socket.remoteAddress should be 127.0.0.1 / ::1
    const remote = req.socket?.remoteAddress || '';
    if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
      return sendJson(res, 403, { error: 'loopback only' });
    }

    // Auth: Bearer token must match.
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== token) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, ts: Date.now() });
    }

    if (req.method === 'POST' && req.url === '/memory/inject') {
      let body;
      try { body = await readJsonBody(req); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }

      const { prompt, session_id, frontend, directive } = body || {};
      if (typeof prompt !== 'string' || !prompt.length) {
        return sendJson(res, 400, { error: 'missing prompt' });
      }

      // Parse @memory directive from the prompt (override caller-passed directive
      // if the prompt itself contains one).
      let effectivePrompt = prompt;
      let effectiveDirective = directive;
      const parsed = parseMemoryDirective(prompt);
      if (parsed) {
        effectiveDirective = parsed.type === 'only' ? `only:${parsed.param}` : parsed.type;
        effectivePrompt = parsed.cleanedText;
      }

      // Honor @memory off / @memory none — return empty injection
      if (effectiveDirective === 'off' || effectiveDirective === 'none') {
        return sendJson(res, 200, {
          block: '',
          analysis: { mode: 'noop', skip_reason: `directive:${effectiveDirective}` },
          tokens: 0,
          items: {},
        });
      }

      // Token budget override for @memory deep
      const retrieveOpts = {
        sessionId: session_id,
        frontend: frontend || 'companion-bridge',
        directive: effectiveDirective,
      };
      if (effectiveDirective === 'deep') {
        retrieveOpts.tokenBudget = 3000;  // 2× safety ceiling for deep mode
      }
      if (typeof effectiveDirective === 'string' && effectiveDirective.startsWith('only:')) {
        // 'only:X' constrains retrieval; pass X as a hint via opts.themeFilter
        retrieveOpts.themeFilter = effectiveDirective.slice(5);
      }

      try {
        const t0 = Date.now();
        const memory = await injector.retrieve(effectivePrompt, retrieveOpts);
        const block = formatMemoryBlock(memory);
        const elapsedMs = Date.now() - t0;

        return sendJson(res, 200, {
          block,
          analysis: memory.analysis || null,
          tokens: memory.tokenCount || 0,
          items: {
            concepts: (memory.concepts || []).length,
            decisions: (memory.decisions || []).length,
            snippets: (memory.snippets || []).length,
          },
          elapsed_ms: elapsedMs,
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message?.slice(0, 200) || 'unknown error' });
      }
    }

    sendJson(res, 404, { error: 'not found' });
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Open default DB handles (knowledge + extraction) if not provided.
 * Caller can pass already-open handles to share with the rest of the daemon.
 */
async function resolveDeps(deps = {}) {
  let knowledgeDb = deps.knowledgeDb;
  let extractionDb = deps.extractionDb;
  let graphCache = deps.graphCache;

  // knowledge DB (BGE-M3 + chunks) — used by retrieval pipeline channels 1, 2
  if (!knowledgeDb) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const { DB_PATH } = await import('./mcp-knowledge/core.mjs');
      if (existsSync(DB_PATH)) knowledgeDb = new Database(DB_PATH, { readonly: true });
    } catch {}
  }

  // extraction DB (entities, decisions) — used for concept/decision queries
  if (!extractionDb) {
    try {
      const { createExtractionStore } = await import('./extraction-store.mjs');
      extractionDb = createExtractionStore().db;
    } catch {}
  }

  // graph cache — used for spreading activation channel 5
  if (!graphCache) {
    try {
      const { loadAdjacency } = await import('./obsidian-graph-cache.mjs');
      graphCache = loadAdjacency ? await loadAdjacency() : null;
    } catch {}
  }

  return { knowledgeDb, extractionDb, graphCache, llmClient: deps.llmClient };
}

/**
 * Start the memory-injection HTTP server. Called once at daemon startup.
 *
 * @param {object} [deps]
 * @param {import('better-sqlite3').Database} [deps.knowledgeDb]
 * @param {import('better-sqlite3').Database} [deps.extractionDb]
 * @param {object} [deps.graphCache]
 * @param {object} [deps.llmClient] — if omitted, memory-injector creates a default
 * @param {object} [opts]
 * @param {number} [opts.port=7893]
 * @param {string} [opts.host='127.0.0.1']
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ server, port, token, close }>}
 */
export async function startInjectionServer(deps = {}, opts = {}) {
  const log = opts.log || ((m) => process.stderr.write(`[memory-inject-server] ${m}\n`));
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;
  const token = getOrCreateToken();

  const resolved = await resolveDeps(deps);
  const injector = createMemoryInjector(resolved);
  const server = http.createServer(buildHandler({ injector, token }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`listening on http://${host}:${port}/memory/inject (token at ${TOKEN_PATH})`);
      resolve();
    });
  });

  return {
    server,
    port,
    token,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
