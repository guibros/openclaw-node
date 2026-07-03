/**
 * lib/node-acceptance-probes.mjs — the real hard-test probes for a deployed
 * OpenClaw node, plus the runtime context that wires them to the live system.
 *
 * Design: every external effect (HTTP, SQLite, NATS, embedder, LLM, filesystem)
 * goes through an injected `ctx` function. In production createRuntimeContext()
 * supplies the real implementations (lazy-loaded so importing this module is
 * cheap); in tests a mock ctx is passed, so the probe logic is verified without
 * ever touching a live node. Heavy modules (transformers, nats, better-sqlite3)
 * load only when their probe actually runs.
 *
 * Probe descriptor: { id, layer, axis, required, mutate?, deep?, slow?,
 *   timeoutMs?, run: async (ctx) => { status, detail, evidence, threshold } }.
 * Mutating probes register cleanups on ctx.teardown — the engine always drains it.
 */

import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const VERDICT = Object.freeze({
  PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', NA: 'N/A', BLOCK: 'BLOCK',
});

// ── result builders ──────────────────────────────────────────────────────────
const pass = (detail, evidence, threshold) => ({ status: VERDICT.PASS, detail, evidence, threshold });
const fail = (detail, evidence, threshold) => ({ status: VERDICT.FAIL, detail, evidence, threshold });
const block = (detail, evidence) => ({ status: VERDICT.BLOCK, detail, evidence });
const skip = (detail) => ({ status: VERDICT.SKIP, detail, evidence: '' });

function genRunId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function l2norm(vec) {
  let s = 0;
  for (const v of vec) s += v * v;
  return Math.sqrt(s);
}

/** A tiny synthetic transcript carrying a unique sentinel, in claude-code JSONL form. */
export function syntheticTranscript(nonce) {
  const lines = [
    { type: 'user', message: { role: 'user', content: `Remember this fact: the project codename is ${nonce}.` }, timestamp: new Date().toISOString() },
    { type: 'assistant', message: { role: 'assistant', content: `Noted — codename ${nonce} recorded.` }, timestamp: new Date().toISOString() },
    { type: 'user', message: { role: 'user', content: `What database does ${nonce} use?` }, timestamp: new Date().toISOString() },
    { type: 'assistant', message: { role: 'assistant', content: `${nonce} uses SQLite with a NATS event log.` }, timestamp: new Date().toISOString() },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

// ── runtime context (production wiring; lazy + injectable) ─────────────────────

/**
 * Build the live runtime context. All heavy modules are imported on first use.
 * @param {object} config  from resolveNodeConfig()
 * @param {object} [options] { mutate, deep, runId }
 */
export function createRuntimeContext(config, options = {}) {
  const runId = options.runId || genRunId();
  const teardown = [];

  async function httpJson(method, url, { headers = {}, body, timeoutMs = 5000 } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
      let json = null, text = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) { json = await res.json().catch(() => null); }
      else { text = await res.text().catch(() => null); }
      return { status: res.status, ok: res.ok, json, text };
    } finally {
      clearTimeout(t);
    }
  }

  function openDb(dbPath, { readonly = true } = {}) {
    const Database = require('better-sqlite3');
    return new Database(dbPath, { readonly, fileMustExist: true });
  }

  return {
    config,
    runId,
    options: { mutate: options.mutate !== false, deep: !!options.deep },
    teardown,
    fs: require('node:fs'),
    fsp: require('node:fs/promises'),
    path,

    httpGet: (url, opts) => httpJson('GET', url, opts),
    httpPost: (url, opts) => httpJson('POST', url, opts),

    /** Run fn(db) against a readonly handle, always closing it. */
    queryDb(dbPath, fn) {
      const db = openDb(dbPath, { readonly: true });
      try { return fn(db); } finally { db.close(); }
    },
    /** Run fn(db) against a writable handle (teardown deletes only). */
    writeDb(dbPath, fn) {
      const db = openDb(dbPath, { readonly: false });
      try { return fn(db); } finally { db.close(); }
    },

    async embed(text) {
      const mod = await import('./mcp-knowledge/core.mjs');
      return mod.embed(text);
    },

    async runExtraction(messages) {
      const { createLlmClient } = await import('./llm-client.mjs');
      const { extractStructured } = await import('./extraction-prompt.mjs');
      const client = createLlmClient({ baseUrl: config.llmBaseUrl, model: config.llmModel });
      return extractStructured(client, messages);
    },

    async natsConnect(name) {
      const { connect } = await import('nats');
      const { natsConnectOpts } = require('./nats-resolve.js');
      return connect(natsConnectOpts({ name, timeout: 5000, maxReconnectAttempts: 0, reconnect: false }));
    },

    async importSession(jsonlPath, opts) {
      const mod = await import('./session-store.mjs');
      const store = mod.createSessionStore
        ? mod.createSessionStore({ dbPath: config.stateDb })
        : new mod.SessionStore({ dbPath: config.stateDb });
      try { return await store.importSession(jsonlPath, opts); }
      finally { store.close?.(); }
    },

    async publishTrigger(nc, triggeredBy = 'node-acceptance') {
      const mod = await import('./publishers/publish-helper.mjs');
      mod.publishExtractDirect(nc, config.nodeId, triggeredBy);
    },

    /** Read-only vault link integrity report (wraps lib/obsidian-link-checker.mjs). */
    async checkVaultLinks(vaultPath) {
      const mod = await import('./obsidian-link-checker.mjs');
      return mod.checkVaultLinks(vaultPath);
    },

    /** Read-only command exec (launchctl list, diff -rq, …). Resolves {code, stdout, stderr}. */
    exec(cmd, cmdArgs = [], { timeoutMs = 5000 } = {}) {
      const { execFile } = require('node:child_process');
      return new Promise((resolve) => {
        execFile(cmd, cmdArgs, { timeout: timeoutMs }, (err, stdout, stderr) => {
          resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
      });
    },
  };
}

// ── probe catalog ──────────────────────────────────────────────────────────

/** @returns {Array<probe>} all L0/L2/L4 probes (L1 liveness lives in the engine). */
export function buildProbes(ctx) {
  const { config } = ctx;
  const nonce = `ACCPROBE${ctx.runId.replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
  const synthSessionId = `acc-probe-${ctx.runId}`;
  const probes = [];

  // ── L0 Presence ─────────────────────────────────────────────────────────
  probes.push({
    id: 'L0-DB', layer: 'L0', axis: 'storage', required: true,
    async run() {
      const targets = [['state.db', config.stateDb], ['knowledge.db', config.knowledgeDb], ['graph-cache.db', config.graphCacheDb]];
      const missing = [], sizes = [];
      for (const [name, p] of targets) {
        try { const st = await ctx.fsp.stat(p); sizes.push(`${name}=${st.size}B`); if (st.size === 0) missing.push(`${name} empty`); }
        catch { missing.push(`${name} absent (${p})`); }
      }
      return missing.length
        ? fail(`DB presence: ${missing.join('; ')}`, sizes.join(' '), 'all 3 DBs exist + non-empty')
        : pass('all 3 DBs present + non-empty', sizes.join(' '), 'all 3 DBs exist + non-empty');
    },
  });
  probes.push({
    id: 'L0-DEPLOY', layer: 'L0', axis: 'memory', required: true,
    async run() {
      const checks = [['daemon bin', config.daemonBin], ['workspace lib/', config.workspaceLib]];
      const missing = [];
      for (const [name, p] of checks) { try { await ctx.fsp.access(p); } catch { missing.push(`${name} (${p})`); } }
      return missing.length
        ? fail(`deploy surface missing: ${missing.join('; ')}`, '', 'daemon bin + lib/ deployed in workspace')
        : pass('memory-daemon binary + lib/ deployed', `${config.daemonBin}`, 'daemon bin + lib/ deployed in workspace');
    },
  });
  probes.push({
    id: 'L0-TOKEN', layer: 'L0', axis: 'memory', required: true,
    async run() {
      try {
        const st = await ctx.fsp.stat(config.injectToken);
        const mode = (st.mode & 0o777).toString(8);
        const note = (process.platform !== 'win32' && (st.mode & 0o077)) ? ` (warning: mode ${mode}, expected 600)` : '';
        return pass(`inject token present${note}`, `${config.injectToken} mode=${mode} size=${st.size}`, 'token exists');
      } catch { return fail('inject token absent', config.injectToken, 'token exists'); }
    },
  });

  // ── L2 Network (local) ────────────────────────────────────────────────────
  probes.push({
    id: 'NET-L2-JSZ', layer: 'L2', axis: 'network', required: true,
    async run() {
      const r = await ctx.httpGet(`${config.natsMonitorUrl}/jsz`, { timeoutMs: 5000 });
      if (r.status !== 200) return fail(`monitor /jsz HTTP ${r.status}`, '', 'JetStream stats 200');
      const j = r.json || {};
      const ok = j.config || j.limits || j.memory !== undefined || j.streams !== undefined;
      return ok ? pass('JetStream enabled', `streams=${j.streams ?? '?'} memory=${j.memory ?? '?'}`, 'JetStream stats present')
                : fail('jsz returned no JetStream stats', JSON.stringify(j).slice(0, 120), 'JetStream stats present');
    },
  });
  probes.push({
    id: 'NET-L2-STREAM', layer: 'L2', axis: 'network', required: true,
    timeoutMs: 8000,
    async run() {
      let nc;
      try { nc = await ctx.natsConnect('acc-stream'); }
      catch (e) { return /Cannot find|ERR_MODULE/.test(e.message) ? block(`nats package unavailable: ${e.message}`) : fail(`NATS unreachable: ${e.message}`, '', `stream local-events-${config.nodeId} exists`); }
      try {
        const jsm = await nc.jetstreamManager();
        const info = await jsm.streams.info(`local-events-${config.nodeId}`);
        return pass(`per-node stream present`, `subjects=${(info.config.subjects || []).join(',')} msgs=${info.state.messages}`, `local-events-${config.nodeId} exists`);
      } catch (e) {
        return fail(`stream local-events-${config.nodeId} not found: ${e.message}`, '', `local-events-${config.nodeId} exists`);
      } finally { await nc.close().catch(() => {}); }
    },
  });
  probes.push({
    id: 'NET-L2-PUBSUB', layer: 'L2', axis: 'network', required: true,
    timeoutMs: 8000,
    async run() {
      let nc;
      try { nc = await ctx.natsConnect('acc-pubsub'); }
      catch (e) { return /Cannot find|ERR_MODULE/.test(e.message) ? block(`nats package unavailable`) : fail(`NATS unreachable: ${e.message}`, '', 'pub/sub round-trip <1s'); }
      const subject = `acc.probe.${ctx.runId}`;
      const payload = `nonce-${ctx.runId}`;
      try {
        const { connect, StringCodec } = await import('nats');
        const sc = StringCodec();
        const sub = nc.subscribe(subject);
        const got = (async () => { for await (const m of sub) return sc.decode(m.data); })();
        nc.publish(subject, sc.encode(payload));
        await nc.flush();
        const received = await Promise.race([got, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1500))]);
        return received === payload
          ? pass('core pub/sub round-trip ok', `subject=${subject}`, 'payload echoed <1.5s')
          : fail(`payload mismatch: ${received}`, '', 'payload echoed <1.5s');
      } catch (e) {
        return fail(`pub/sub failed: ${e.message}`, '', 'payload echoed <1.5s');
      } finally { await nc.close().catch(() => {}); }
    },
  });
  probes.push({
    id: 'NET-L2-TRIGGER', layer: 'L2', axis: 'network', required: false, deep: true,
    timeoutMs: 8000,
    async run() {
      let nc;
      try { nc = await ctx.natsConnect('acc-trigger'); }
      catch (e) { return fail(`NATS unreachable: ${e.message}`); }
      try { await ctx.publishTrigger(nc, 'node-acceptance'); return pass('extract trigger published', 'subject=mesh.memory.extract_request', 'publish succeeds (flush not awaited)'); }
      catch (e) { return fail(`trigger publish failed: ${e.message}`); }
      finally { await nc.close().catch(() => {}); }
    },
  });

  // ── L2 LLM backing ─────────────────────────────────────────────────────────
  probes.push({
    id: 'LLM-L2-MODEL', layer: 'L2', axis: 'llm', required: true,
    async run() {
      const r = await ctx.httpGet(`${config.llmBaseUrl}/api/tags`, { timeoutMs: 5000 });
      if (r.status !== 200) return fail(`/api/tags HTTP ${r.status}`, '', `model ${config.llmModel} present`);
      const names = ((r.json || {}).models || []).map((m) => m.name || m.model);
      return names.includes(config.llmModel)
        ? pass(`configured model present`, `${config.llmModel} in [${names.slice(0, 4).join(', ')}]`, `model ${config.llmModel} present`)
        : fail(`configured model ${config.llmModel} NOT in tags`, names.join(', '), `model ${config.llmModel} present`);
    },
  });
  probes.push({
    id: 'LLM-L2-GEN', layer: 'L2', axis: 'llm', required: true, slow: true,
    timeoutMs: config.genBudgetMs || 30000,
    async run() {
      const r = await ctx.httpPost(`${config.llmBaseUrl}/api/generate`, {
        timeoutMs: config.genBudgetMs || 30000,
        body: { model: config.llmModel, prompt: 'Reply with exactly the word: OK', stream: false },
      });
      if (r.status !== 200) return fail(`/api/generate HTTP ${r.status}`, '', 'non-empty completion in budget');
      const j = r.json || {};
      const text = (j.response || '').trim();
      return (text && (j.eval_count > 0))
        ? pass('generation runs', `response="${text.slice(0, 40)}" eval_count=${j.eval_count}`, 'non-empty completion, eval_count>0')
        : fail(`empty/degenerate generation`, `response="${text}" eval_count=${j.eval_count}`, 'non-empty completion, eval_count>0');
    },
  });
  probes.push({
    id: 'LLM-L2-EMBED', layer: 'L2', axis: 'llm', required: true, slow: true,
    timeoutMs: 120000,
    async run() {
      let vec;
      try { vec = await ctx.embed(`acceptance embed probe ${ctx.runId}`); }
      catch (e) { return /not cached|download|Cannot find|ENOENT/i.test(e.message) ? block(`embedder model not available: ${e.message}`) : fail(`embed failed: ${e.message}`); }
      const arr = Array.from(vec || []);
      const finite = arr.length > 0 && arr.every(Number.isFinite);
      const norm = l2norm(arr);
      return (arr.length === config.embedDim && finite && norm > 0)
        ? pass(`embedder runs`, `dim=${arr.length} norm=${norm.toFixed(3)}`, `dim=${config.embedDim}, finite, norm>0`)
        : fail(`bad embedding`, `dim=${arr.length} finite=${finite} norm=${norm}`, `dim=${config.embedDim}, finite, norm>0`);
    },
  });
  probes.push({
    id: 'LLM-L2-EXTRACT', layer: 'L2', axis: 'llm', required: true, slow: true,
    timeoutMs: 120000,
    async run() {
      const messages = [
        { role: 'user', content: `We decided to use SQLite for ${nonce} because it is embedded and portable.` },
        { role: 'assistant', content: `Understood. ${nonce} will store memory in SQLite with a NATS event log.` },
      ];
      try {
        const result = await ctx.runExtraction(messages);
        const n = (result.entities || []).length + (result.decisions || []).length + (result.themes || []).length;
        return pass(`structured extraction schema-valid`, `entities=${(result.entities || []).length} decisions=${(result.decisions || []).length} themes=${(result.themes || []).length}`, 'schema-valid extraction (production task)');
      } catch (e) {
        return /Cannot find|ERR_MODULE/.test(e.message) ? block(`extraction modules unavailable: ${e.message}`) : fail(`extraction failed/invalid: ${e.message}`, '', 'schema-valid extraction');
      }
    },
  });

  // ── L2 Memory + L4 gold round-trip (mutating; teardown registered) ──────────
  probes.push({
    id: 'MEM-L2-INGEST', layer: 'L2', axis: 'memory', required: true, mutate: true,
    timeoutMs: 20000,
    async run() {
      const tmp = ctx.path.join(os.tmpdir(), `${synthSessionId}.jsonl`);
      await ctx.fsp.writeFile(tmp, syntheticTranscript(nonce), 'utf8');
      ctx.teardown.push(async () => { await ctx.fsp.unlink(tmp).catch(() => {}); });
      ctx.teardown.push(() => cleanupState(ctx, config, synthSessionId, nonce));
      let res;
      try { res = await ctx.importSession(tmp, { source: 'claude-code', sessionId: synthSessionId }); }
      catch (e) { return /Cannot find|ERR_MODULE/.test(e.message) ? block(`session-store unavailable: ${e.message}`) : fail(`ingest failed: ${e.message}`); }
      let count = 0;
      try { count = ctx.queryDb(config.stateDb, (db) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(res?.sessionId || synthSessionId).n); }
      catch (e) { return fail(`post-ingest query failed: ${e.message}`); }
      return count >= 2
        ? pass(`ingest landed in state.db`, `session=${res?.sessionId || synthSessionId} messages=${count}`, 'messages count grows ≥2')
        : fail(`ingest did not land (count=${count})`, '', 'messages count grows ≥2');
    },
  });
  probes.push({
    id: 'MEM-L2-INJECT', layer: 'L2', axis: 'memory', required: true,
    timeoutMs: 15000,
    async run() {
      let token;
      try { token = (await ctx.fsp.readFile(config.injectToken, 'utf8')).trim(); }
      catch (e) { return block(`inject token unreadable: ${e.message}`); }
      const url = `http://${config.injectHost}:${config.injectPort}/memory/inject`;
      const r = await ctx.httpPost(url, {
        timeoutMs: 12000,
        headers: { Authorization: `Bearer ${token}` },
        body: { prompt: 'memory daemon architecture and decisions', frontend: 'node-acceptance' },
      }).catch((e) => ({ status: 0, error: e.message }));
      if (r.status === 401) return fail('inject auth rejected (401)', '', 'authorized 200 with items shape');
      if (r.status !== 200) return fail(`inject HTTP ${r.status || r.error}`, '', 'authorized 200 with items shape');
      const j = r.json || {};
      const it = j.items || {};
      const wellFormed = typeof j.block === 'string' && it && ['concepts', 'decisions', 'snippets'].every((k) => typeof it[k] === 'number');
      return wellFormed
        ? pass(`inject pipeline answers`, `concepts=${it.concepts} decisions=${it.decisions} snippets=${it.snippets} tokens=${j.tokens} ${j.elapsed_ms}ms`, 'authorized 200, items{concepts,decisions,snippets} numeric')
        : fail(`inject response malformed`, JSON.stringify(j).slice(0, 160), 'authorized 200 with items shape');
    },
  });
  probes.push({
    id: 'MEM-L4-ROUNDTRIP', layer: 'L4', axis: 'memory', required: true, mutate: true, slow: true,
    timeoutMs: 90000,
    async run() {
      // 1. place a nonce transcript where the deployed daemon ingests it
      const sourceDir = await firstTranscriptSource(ctx, config);
      if (!sourceDir) return block('no writable transcript source dir configured (config/transcript-sources.json) — cannot exercise the deployed ingest loop');
      const file = ctx.path.join(sourceDir, `${synthSessionId}.jsonl`);
      await ctx.fsp.writeFile(file, syntheticTranscript(nonce), 'utf8');
      ctx.teardown.push(async () => { await ctx.fsp.unlink(file).catch(() => {}); });
      ctx.teardown.push(() => cleanupState(ctx, config, synthSessionId, nonce));
      ctx.teardown.push(() => cleanupKnowledge(ctx, config, synthSessionId));

      // 2. nudge the deployed extraction path
      let nc = null;
      try { nc = await ctx.natsConnect('acc-roundtrip'); await ctx.publishTrigger(nc, 'node-acceptance-roundtrip'); }
      catch { /* daemon may flush on its own poll; continue */ }
      finally { if (nc) await nc.close().catch(() => {}); }

      // 3. poll for extraction landing (mentions tied to our synthetic session)
      const budget = config.roundtripPollMs || 60000;
      const interval = Math.min(3000, budget);
      const deadline = Date.now() + budget;
      let landed = 0;
      while (Date.now() < deadline) {
        try { landed = ctx.queryDb(config.stateDb, (db) => db.prepare('SELECT COUNT(*) AS n FROM mentions WHERE session_id = ?').get(synthSessionId).n); }
        catch { /* db may be mid-write */ }
        if (landed > 0) break;
        await new Promise((r) => setTimeout(r, interval));
      }
      if (landed === 0) return fail('extraction never landed for the synthetic session (is the daemon running + NATS up?)', `session=${synthSessionId}`, 'nonce fact retrievable end-to-end');

      // 4. retrieve by content through the inject server
      let token;
      try { token = (await ctx.fsp.readFile(config.injectToken, 'utf8')).trim(); } catch (e) { return block(`inject token unreadable: ${e.message}`); }
      const url = `http://${config.injectHost}:${config.injectPort}/memory/inject`;
      const r = await ctx.httpPost(url, { timeoutMs: 15000, headers: { Authorization: `Bearer ${token}` }, body: { prompt: `what is the codename ${nonce}`, frontend: 'node-acceptance' } })
        .catch((e) => ({ status: 0, error: e.message }));
      if (r.status !== 200) return fail(`inject HTTP ${r.status || r.error}`, '', 'nonce fact retrievable end-to-end');
      const block_ = ((r.json || {}).block || '');
      return block_.includes(nonce)
        ? pass('gold round-trip: nonce fact ingested→extracted→retrieved', `nonce ${nonce} found in injected block`, 'nonce fact retrievable end-to-end')
        : fail('nonce fact not retrievable via inject (indexed?)', `block had no ${nonce}`, 'nonce fact retrievable end-to-end');
    },
  });

  return probes;
}

// ── teardown helpers ──────────────────────────────────────────────────────

async function cleanupState(ctx, config, sessionId, nonce) {
  try {
    ctx.writeDb(config.stateDb, (db) => {
      db.prepare('DELETE FROM mentions WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM decisions WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      db.prepare('DELETE FROM entities WHERE name = ? OR name LIKE ?').run(nonce, `%${nonce}%`);
    });
  } catch { /* best-effort */ }
}

async function cleanupKnowledge(ctx, config, sessionId) {
  try {
    ctx.writeDb(config.knowledgeDb, (db) => {
      db.prepare('DELETE FROM session_chunks WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM session_documents WHERE session_id = ?').run(sessionId);
    });
  } catch { /* best-effort; vec tables may cascade or be rebuilt */ }
}

async function firstTranscriptSource(ctx, config) {
  try {
    const raw = await ctx.fsp.readFile(config.transcriptSources, 'utf8');
    const parsed = JSON.parse(raw);
    const dirs = Array.isArray(parsed) ? parsed : (parsed.sources || parsed.dirs || []);
    for (const d of dirs) {
      const dir = typeof d === 'string' ? d : (d.path || d.dir);
      if (!dir) continue;
      const expanded = dir.replace(/^~/, os.homedir());
      try { await ctx.fsp.access(expanded); return expanded; } catch { /* skip */ }
    }
  } catch { /* no sources file */ }
  return null;
}
