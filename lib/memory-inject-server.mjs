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
import crypto, { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { atomicWriteFileSync } from './atomic-write.mjs';

import { createMemoryInjector } from './memory-injector.mjs';
import { setChannelErrorSink } from './retrieval-pipeline.mjs';
import { formatMemoryBlock } from './memory-formatter.mjs';
import { parseMemoryDirective, replaceLastUserContent } from './memory-directives.mjs';
import { buildMemoryEvent } from './local-event-log.mjs';

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
  // F-Q211/F-P313 fix: previously two concurrent processes (daemon + bridge)
  // could both pass the existsSync check, both generate distinct tokens,
  // and the last writer would win — leaving the other side with auth that
  // permanently fails. atomicWriteFileSync uses an exclusive-ish openSync
  // pattern via tmp + rename; on the second writer's rename, the first
  // file is replaced atomically (last write wins, but at least no torn
  // file). Re-read after the race to converge on the winning value.
  const token = randomBytes(32).toString('hex');
  atomicWriteFileSync(TOKEN_PATH, token, { mode: 0o600, mkdirp: true });
  // After concurrent writes, the on-disk token is whichever rename
  // landed last. Read it back so we and any sibling process agree.
  return readFileSync(TOKEN_PATH, 'utf8').trim();
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
 * Build the request handler. Captures dependencies (injector + token + eventLog) in closure
 * so we don't reach into module globals from the server callback.
 */
function buildHandler({ injector, token, eventLog, nodeId }) {
  return async (req, res) => {
    // Loopback enforcement: req.socket.remoteAddress should be 127.0.0.1 / ::1
    const remote = req.socket?.remoteAddress || '';
    if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
      return sendJson(res, 403, { error: 'loopback only' });
    }

    // Auth: Bearer token must match.
    // F-M13 fix: use timing-safe comparison to thwart timing-side-channel
    // attacks. Loopback-only mitigates most exposure, but a local process
    // with port access could otherwise enumerate the token bit-by-bit by
    // measuring response latency on the '===' string compare.
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const presented = Buffer.from(auth.slice(7).trim());
    const expected = Buffer.from(token);
    let ok = presented.length === expected.length;
    if (ok) {
      try { ok = crypto.timingSafeEqual(presented, expected); }
      catch { ok = false; }
    }
    if (!ok) {
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
      // F-M12 fix: empty/missing prompt is not an error — return 200 with an
      // empty block + noop analysis, matching what memory-injector.retrieve()
      // returns for empty input. Contract consistency between HTTP layer and
      // library layer.
      if (typeof prompt !== 'string' || !prompt.length) {
        return sendJson(res, 200, {
          block: '',
          analysis: { mode: 'noop', skip_reason: 'empty_prompt' },
          tokens: 0,
          items: {},
        });
      }

      // Parse @memory directive from the prompt (override caller-passed directive
      // ONLY if the prompt itself actually contains a directive). parseMemoryDirective
      // always returns a {type, param, cleanedText} object — `type === null` means
      // no directive found and we must keep the body-level directive untouched.
      let effectivePrompt = prompt;
      let effectiveDirective = directive;
      const parsed = parseMemoryDirective(prompt);
      if (parsed) {
        if (parsed.type !== null) {
          effectiveDirective = parsed.type === 'only' ? `only:${parsed.param}` : parsed.type;
        }
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
      // Local-first: the inject server is loopback-only (127.0.0.1) and serves
      // the operator's own data. Privacy filtering (default-private entities)
      // is designed for federation; locally it blocks all retrieval results.
      const retrieveOpts = {
        sessionId: session_id,
        frontend: frontend || 'companion-bridge',
        directive: effectiveDirective,
        respectPrivacy: false,
      };
      if (effectiveDirective === 'deep') {
        retrieveOpts.tokenBudget = 3000;  // 2× safety ceiling for deep mode
      }
      if (typeof effectiveDirective === 'string' && effectiveDirective.startsWith('only:')) {
        // 'only:X' constrains retrieval; pass X as a hint via opts.themeFilter
        retrieveOpts.themeFilter = effectiveDirective.slice(5);
      }

      try {
        const requestId = crypto.randomUUID();
        const t0 = Date.now();
        const memory = await injector.retrieve(effectivePrompt, retrieveOpts);
        const tRetrieved = Date.now();
        const block = formatMemoryBlock(memory);
        const elapsedMs = Date.now() - t0;

        const conceptsCount = (memory.concepts || []).length;
        const decisionsCount = (memory.decisions || []).length;
        const snippetsCount = (memory.snippets || []).length;

        if (eventLog && nodeId) {
          const queryHash = crypto.createHash('sha256').update(effectivePrompt).digest('hex').slice(0, 16);
          const channelsHit = (conceptsCount > 0 ? 1 : 0) + (decisionsCount > 0 ? 1 : 0) + (snippetsCount > 0 ? 1 : 0);

          const conceptNames = (memory.concepts || []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
          const decisionTexts = (memory.decisions || []).map((d) => (typeof d === 'string' ? d : d.decision)).filter(Boolean);

          const retrievedEvent = buildMemoryEvent('memory.retrieved', requestId, 'memory', {
            query_hash: queryHash,
            // The actual query text (capped) + what came back — not just a hash and a count.
            query: effectivePrompt.slice(0, 200),
            channels_hit: channelsHit,
            results_count: conceptsCount + decisionsCount + snippetsCount,
            concept_names: conceptNames.slice(0, 20).map((s) => String(s).slice(0, 200)),
            decision_texts: decisionTexts.slice(0, 10).map((s) => String(s).slice(0, 500)),
            duration_ms: tRetrieved - t0,
          }, nodeId);
          eventLog.publishLocal(retrievedEvent).catch(err =>
            process.stderr.write(`[inject-server] memory.retrieved emit failed: ${err.message}\n`)
          );

          const injectedEvent = buildMemoryEvent('memory.injected', requestId, 'memory', {
            request_id: requestId,
            token_count: memory.tokenCount || 0,
            blocks_count: conceptsCount + decisionsCount + snippetsCount,
            // Preview of the actual memory block text injected into the prompt.
            block_preview: (block || '').slice(0, 400),
            duration_ms: elapsedMs,
          }, nodeId);
          eventLog.publishLocal(injectedEvent).catch(err =>
            process.stderr.write(`[inject-server] memory.injected emit failed: ${err.message}\n`)
          );
        }

        return sendJson(res, 200, {
          block,
          analysis: memory.analysis || null,
          tokens: memory.tokenCount || 0,
          items: {
            concepts: conceptsCount,
            decisions: decisionsCount,
            snippets: snippetsCount,
          },
          elapsed_ms: elapsedMs,
        });
      } catch (err) {
        if (eventLog && nodeId) {
          const errorEvent = buildMemoryEvent('memory.error', crypto.randomUUID(), 'memory', {
            boundary: 'retrieve',
            error_code: err.code || err.constructor?.name || 'UNKNOWN',
            error_message: (err.message || String(err)).slice(0, 500),
            ...(retrieveOpts.sessionId ? { session_id: retrieveOpts.sessionId } : {}),
          }, nodeId);
          eventLog.publishLocal(errorEvent).catch(emitErr =>
            process.stderr.write(`[inject-server] memory.error emit failed: ${emitErr.message}\n`)
          );
        }
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
      const { openStore } = await import('./sqlite-store.mjs');
      const { DB_PATH } = await import('./mcp-knowledge/core.mjs');
      if (existsSync(DB_PATH)) knowledgeDb = openStore(DB_PATH, { readonly: true, integrityCheck: false });
    } catch (err) {
      // STUB_AUDIT fix: this was a silent `catch {}` — DB open failures
      // disappeared into the void and the inject server degraded to no-DB
      // mode with no signal. Log so operators can see why retrieval is
      // returning empty results.
      process.stderr.write(`[memory-inject-server] knowledgeDb open failed (Channels 1+2 will be inert): ${err.message}\n`);
    }
  }

  // extraction DB (entities, decisions) — used for concept/decision queries
  if (!extractionDb) {
    try {
      const { createExtractionStore } = await import('./extraction-store.mjs');
      extractionDb = createExtractionStore().db;
    } catch (err) {
      // STUB_AUDIT fix: silent `catch {}` removed. Without extractionDb the
      // privacy filter fails-CLOSED to [] (correct per F-N51) but legitimate
      // retrieval also drops — operator needs to know.
      process.stderr.write(`[memory-inject-server] extractionDb open failed (privacy filter will reject all results, concepts/decisions queries will be empty): ${err.message}\n`);
    }
  }

  // graph cache — used for spreading activation channel 5 (F-C14 fix:
  // path was './obsidian-graph-cache.mjs' (lib/) but file lives at
  // bin/obsidian-graph-cache.mjs, AND the symbol was 'loadAdjacency' which
  // never existed — actual export is createGraphCache, which returns an
  // object with the queryNeighbors API spreading-activation expects.
  // Previously the import threw silently and graphCache stayed null,
  // permanently disabling Channel 5 when started via this server.)
  if (!graphCache) {
    try {
      const { createGraphCache } = await import('../bin/obsidian-graph-cache.mjs');
      graphCache = createGraphCache ? createGraphCache() : null;
    } catch (err) {
      // Log so future failures don't go silent — earlier swallow was the bug
      const stream = process.stderr;
      stream && stream.write && stream.write(`[memory-inject-server] graphCache disabled (channel 5 inert): ${err.message}\n`);
    }
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
 * @param {{ publishLocal: function }} [deps.eventLog] — local event log for memory.retrieved/injected emission
 * @param {string} [deps.nodeId] — node identifier for event envelope
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

  // R19 fix (repair 5.2): surface channel failures — log AND publish
  // memory.error so the watcher distinguishes "no matches" from "broken".
  setChannelErrorSink((channel, err) => {
    log(`retrieval channel '${channel}' failed: ${err?.message || err}`);
    if (deps.eventLog && deps.nodeId) {
      const event = buildMemoryEvent('memory.error', `channel-${channel}`, 'memory', {
        boundary: 'retrieve',
        error_code: err?.code || err?.constructor?.name || 'CHANNEL_ERROR',
        error_message: `channel '${channel}': ${String(err?.message || err).slice(0, 450)}`,
      }, deps.nodeId);
      deps.eventLog.publishLocal(event).catch(() => { /* fire-and-forget */ });
    }
  });

  const server = http.createServer(buildHandler({ injector, token, eventLog: deps.eventLog, nodeId: deps.nodeId }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  // After listen, server.address().port reflects the OS-assigned port when
  // port:0 was requested. The caller relies on this for tests + dynamic
  // allocation scenarios.
  const boundPort = server.address()?.port ?? port;
  log(`listening on http://${host}:${boundPort}/memory/inject (token at ${TOKEN_PATH})`);

  return {
    server,
    port: boundPort,
    token,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
