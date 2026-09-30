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
import { fileURLToPath } from 'node:url';
import { gradeCoordinator, gradeClusterQuorum, parseLaunchdPrint, FED_STATUS } from './fed-probes.mjs';
import { localEventStreamName } from './local-event-log.mjs';
import { MIN_SESSION_BYTES } from './transcript-discovery.mjs';

const require = createRequire(import.meta.url);
const EMBED_PROBE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/embed-probe.mjs');

export const VERDICT = Object.freeze({
  PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', NA: 'N/A', BLOCK: 'BLOCK',
});

// ── result builders ──────────────────────────────────────────────────────────
const pass = (detail, evidence, threshold) => ({ status: VERDICT.PASS, detail, evidence, threshold });
const fail = (detail, evidence, threshold) => ({ status: VERDICT.FAIL, detail, evidence, threshold });
const block = (detail, evidence) => ({ status: VERDICT.BLOCK, detail, evidence });
const skip = (detail) => ({ status: VERDICT.SKIP, detail, evidence: '' });
const FIXTURE_MARKER = 'node-readiness-memory-fixture-v1';
const DECISION_RATIONALE = /embedded|portable|file.based|serverless|single.file|no (?:separate )?server/i;

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function registryDirs(raw, home) {
  const parsed = JSON.parse(raw);
  const dirs = Array.isArray(parsed) ? parsed : (parsed.sources || parsed.dirs || []);
  return dirs.filter((source) => typeof source === 'string' || source.enabled !== false)
    .map((source) => typeof source === 'string' ? source : (source.path || source.dir))
    .filter(Boolean)
    .map((dir) => dir.startsWith('~') ? path.join(home, dir.slice(1)) : dir);
}

function envValue(raw, key) {
  const line = raw.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null;
}

async function isolatedMemoryFixture(ctx, config, transcriptDir = null) {
  if (!config.isolatedMemoryAcceptance) return 'ACCEPT_ISOLATED_MEMORY=1 is required';
  if (!config.natsUrl) return 'an explicit OPENCLAW_NATS fixture URL is required';
  let bus;
  try { bus = new URL(config.natsUrl); } catch { return 'OPENCLAW_NATS is not a URL'; }
  if (bus.protocol !== 'nats:' || !['127.0.0.1', 'localhost', '[::1]'].includes(bus.hostname)
    || !Number(bus.port) || Number(bus.port) < 10000) return 'fixture NATS must use a dedicated high loopback port';
  if (config.injectPort === 7893 || !Number.isInteger(config.injectPort)) return 'fixture inject server must use a dedicated port';
  if (!config.natsToken) return 'an explicit fixture NATS token is required';
  if (!config.workspaceEnv || path.resolve(config.workspaceEnv) !== path.resolve(config.workspace)) return 'fixture daemon requires an explicit OPENCLAW_WORKSPACE';
  try {
    const root = await ctx.fsp.realpath(config.home);
    const runtimeHome = await ctx.fsp.realpath(path.join(ctx.runtimeHome(), '.openclaw'));
    if (root !== runtimeHome) return 'fixture home does not match the daemon HOME/.openclaw path';
    const live = await ctx.fsp.realpath(path.join(ctx.accountHome(), '.openclaw')).catch(() => null);
    if (live && (within(live, root) || within(root, live))) return 'fixture root overlaps the live OpenClaw home';
    const targets = [config.workspace, config.stateDb, config.knowledgeDb, config.injectToken, config.transcriptSources, config.fixtureMarker, config.fixtureEnv, config.daemonConfig];
    if (transcriptDir) targets.push(transcriptDir);
    for (const target of targets) {
      if (!within(root, await ctx.fsp.realpath(target))) return 'fixture path resolves outside its root';
    }
    const marker = JSON.parse(await ctx.fsp.readFile(config.fixtureMarker, 'utf8'));
    if (marker.type !== FIXTURE_MARKER || !/^acc-[a-z0-9-]{8,}$/i.test(marker.natsServerName)) return 'fixture marker is invalid';
    const fixtureEnv = await ctx.fsp.readFile(config.fixtureEnv, 'utf8');
    if (envValue(fixtureEnv, 'OPENCLAW_NATS') !== config.natsUrl
      || envValue(fixtureEnv, 'OPENCLAW_NATS_TOKEN') !== config.natsToken) return 'fixture daemon bus settings do not match the runner';
    const daemonConfig = JSON.parse(await ctx.fsp.readFile(config.daemonConfig, 'utf8'));
    if (Object.keys(daemonConfig).some((key) => !['workspace', 'intervals', 'contextWindowTokens', 'timezone', 'nodeId'].includes(key))
      || (daemonConfig.workspace && path.resolve(daemonConfig.workspace) !== path.resolve(config.workspace))) {
      return 'fixture daemon config points outside the isolated workspace';
    }
    if (config.vaultEnv && !within(root, await ctx.fsp.realpath(config.vaultEnv))) return 'fixture vault path resolves outside its root';
    if (!config.modelCacheEnv || !within(root, await ctx.fsp.realpath(config.modelCacheEnv))) return 'fixture model cache resolves outside its root';
    if (config.vaultSyncConfigEnv && path.resolve(config.vaultSyncConfigEnv) !== path.resolve(config.vaultSyncConfig)) {
      return 'fixture Obsidian sync config points outside its root';
    }
    const vaultConfigRaw = await ctx.fsp.readFile(config.vaultSyncConfig, 'utf8').catch(() => '');
    if (!vaultConfigRaw) return 'fixture Obsidian sync must be explicitly disabled';
    {
      const vaultConfig = JSON.parse(vaultConfigRaw);
      if (vaultConfig.enabled !== false) return 'fixture Obsidian sync must be disabled';
      const apiKeyFile = vaultConfig.apiKeyFile || 'projects/arcane-vault/.obsidian-api-key';
      if (await ctx.fsp.stat(path.join(config.workspace, apiKeyFile)).catch(() => null)) {
        return 'fixture contains an Obsidian API credential';
      }
      if (vaultConfig.memoryVaultPath) {
        const vault = path.isAbsolute(vaultConfig.memoryVaultPath)
          ? vaultConfig.memoryVaultPath : path.join(config.workspace, vaultConfig.memoryVaultPath);
        if (!within(root, await ctx.fsp.realpath(vault))) return 'fixture configured vault path resolves outside its root';
      }
    }
    const liveEnv = live ? await ctx.fsp.readFile(path.join(live, 'openclaw.env'), 'utf8').catch(() => '') : '';
    if (envValue(liveEnv, 'OPENCLAW_NATS_TOKEN') === config.natsToken) return 'fixture bus token matches the live bus';
    const liveMeshEnv = await ctx.fsp.readFile(path.join(ctx.accountHome(), 'openclaw', '.mesh-config'), 'utf8').catch(() => '');
    if (envValue(liveMeshEnv, 'OPENCLAW_NATS_TOKEN') === config.natsToken) return 'fixture bus token matches the live bus';
    if (await ctx.fsp.stat(path.join(root, 'config', 'mc-session-token')).catch(() => null)) {
      return 'fixture contains a Mission Control session credential';
    }
    for (const [fixtureDb, liveDb] of live ? [
      [config.stateDb, path.join(live, 'state.db')],
      [config.knowledgeDb, path.join(live, 'workspace', '.knowledge.db')],
    ] : []) {
      for (const suffix of ['', '-wal', '-shm']) {
        const fixtureStat = await ctx.fsp.stat(fixtureDb + suffix).catch(() => null);
        const liveStat = await ctx.fsp.stat(liveDb + suffix).catch(() => null);
        if (fixtureStat && liveStat && fixtureStat.dev === liveStat.dev && fixtureStat.ino === liveStat.ino) {
          return 'fixture database hardlinks to live state';
        }
      }
    }
    const liveRegistry = live ? await ctx.fsp.readFile(path.join(live, 'config', 'transcript-sources.json'), 'utf8').catch(() => '') : '';
    let liveSources;
    try { liveSources = registryDirs(liveRegistry, ctx.accountHome()); }
    catch { liveSources = []; }
    liveSources.push(path.join(ctx.accountHome(), '.claude', 'projects'));
    for (const source of liveSources) {
      const observed = await ctx.fsp.realpath(source).catch(() => path.resolve(source));
      if (within(observed, root) || (transcriptDir && within(observed, await ctx.fsp.realpath(transcriptDir)))) {
        return 'fixture transcript path overlaps a live daemon source';
      }
    }
    if (transcriptDir) {
      const monitor = new URL(config.natsMonitorUrl);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(monitor.hostname)
        || !Number(monitor.port) || Number(monitor.port) < 10000) return 'fixture NATS monitor must use a dedicated high loopback port';
      const nc = await ctx.natsConnect('acc-identity');
      try {
        const info = nc.info || {};
        if (info.server_name !== marker.natsServerName || info.cluster || info.connect_urls?.length) return 'fixture bus identity or topology mismatch';
        const varz = await ctx.httpGet(`${config.natsMonitorUrl}/varz`);
        const connz = await ctx.httpGet(`${config.natsMonitorUrl}/connz`);
        const routez = await ctx.httpGet(`${config.natsMonitorUrl}/routez`);
        const leafz = await ctx.httpGet(`${config.natsMonitorUrl}/leafz`);
        const gatewayz = await ctx.httpGet(`${config.natsMonitorUrl}/gatewayz`);
        if (!varz.ok || varz.json?.server_id !== info.server_id || varz.json?.server_name !== marker.natsServerName
          || !connz.ok || connz.json?.connections?.filter((conn) => conn.name === 'memory-daemon').length !== 1
          || [connz, routez, leafz, gatewayz].some((reply) => !reply.ok || reply.json?.server_id !== info.server_id)
          || routez.json.routes?.length || leafz.json.leafnodes
          || Object.keys(gatewayz.json.outbound_gateways || {}).length
          || Object.keys(gatewayz.json.inbound_gateways || {}).length) {
          return 'fixture monitor does not show an isolated bus and memory daemon';
        }
        const injectToken = (await ctx.fsp.readFile(config.injectToken, 'utf8')).trim();
        const runtime = await ctx.httpGet(`http://127.0.0.1:${config.injectPort}/runtime/paths`, {
          headers: { Authorization: `Bearer ${injectToken}` },
        });
        const owned = runtime.json;
        if (!runtime.ok || !owned || !Number.isInteger(owned.pid) || owned.pid <= 0 || owned.isolatedMemory !== true
          || owned.natsServerId !== info.server_id
          || await ctx.fsp.realpath(owned.home) !== await ctx.fsp.realpath(ctx.runtimeHome())
          || await ctx.fsp.realpath(owned.workspace) !== await ctx.fsp.realpath(config.workspace)
          || await ctx.fsp.realpath(owned.configuredWorkspace) !== await ctx.fsp.realpath(config.workspace)) {
          return 'fixture daemon does not attest the isolated process and workspace';
        }
        for (const writePath of [owned.script, owned.extractionDb, owned.knowledgeDb,
          owned.extractionStoreDb, owned.federationExtractionDb, owned.federationKnowledgeDb,
          owned.graphCacheDb, owned.vault, owned.modelCache, owned.transcriptRegistry, owned.singletonSocket]) {
          if (!writePath || !within(root, await ctx.fsp.realpath(writePath))) {
            return 'fixture daemon reports a write path outside its root';
          }
        }
      } finally { await nc.close(); }
    }
  } catch (e) { return `fixture paths or marker unavailable: ${e.message}`; }
  return null;
}

// Federation is on-demand, so its axis must never be the SOLE reason a node is
// rejected (computeGate rejects on ANY fail/block). Map the node-watch honesty
// verdicts to acceptance: an inactive/unobservable substrate is SKIP, not FAIL.
// Only a genuinely broken substrate that was expected to work (e.g. R=3 quorum
// LOST while the local server answers) survives as FAIL.
function mapFedVerdict(v, threshold) {
  switch (v.status) {
    case FED_STATUS.WORKING: return pass(v.detail, '', threshold);
    case FED_STATUS.BROKEN:  return fail(v.detail, '', threshold);
    default:                 return skip(v.detail); // OFF / UNKNOWN → not applicable / unobservable
  }
}

function genRunId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function l2norm(vec) {
  let s = 0;
  for (const v of vec) s += v * v;
  return Math.sqrt(s);
}

export function parseIsolatedEmbedResult({ error, stdout = '', stderr = '' }) {
  let payload = null;
  try { payload = JSON.parse(stdout.trim()); } catch {}
  if (error) {
    if (payload?.ok === false && payload.error) throw new Error(payload.error);
    const exit = error.signal || error.code || 'unknown exit';
    throw new Error(`isolated embed probe failed (${exit}): ${stderr.trim() || error.message}`);
  }
  if (payload?.ok === false) throw new Error(payload.error || 'isolated embed probe failed');
  if (!payload?.ok || !Array.isArray(payload.vector)) throw new Error('isolated embed probe returned malformed output');
  return new Float32Array(payload.vector);
}

function runIsolatedEmbed(text, timeoutMs = 60000) {
  const { execFile } = require('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [EMBED_PROBE_PATH, text], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      try { resolve(parseIsolatedEmbedResult({ error, stdout, stderr })); }
      catch (err) { reject(err); }
    });
  });
}

/** A tiny synthetic transcript carrying a unique sentinel, in claude-code JSONL form. */
export function syntheticTranscript(nonce, sessionId) {
  const lines = [
    { type: 'user', message: { role: 'user', content: `Remember this fact: the project codename is ${nonce}.` }, timestamp: new Date().toISOString() },
    { type: 'assistant', message: { role: 'assistant', content: `Noted — codename ${nonce} recorded.` }, timestamp: new Date().toISOString() },
    { type: 'user', message: { role: 'user', content: `What database does ${nonce} use?` }, timestamp: new Date().toISOString() },
    { type: 'assistant', message: { role: 'assistant', content: `We decided ${nonce} uses SQLite because it is embedded and portable, with a NATS event log.` }, timestamp: new Date().toISOString() },
  ];
  const transcript = lines.map((line, index) => JSON.stringify({ ...line,
    uuid: `acc-${nonce}-${index}`, parentUuid: index ? `acc-${nonce}-${index - 1}` : null,
    sessionId, cwd: '/fixture/workspace', version: '2.0.0',
  })).join('\n') + '\n';
  if (Buffer.byteLength(transcript) < MIN_SESSION_BYTES) throw new Error('synthetic transcript is below daemon discovery floor');
  return transcript;
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
    startedAt: Date.now(),
    options: { mutate: options.mutate !== false, deep: !!options.deep },
    teardown,
    fs: require('node:fs'),
    fsp: require('node:fs/promises'),
    path,
    runtimeHome: () => os.homedir(),
    accountHome: () => os.userInfo().homedir,

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
      try { db.pragma('foreign_keys = ON'); return fn(db); } finally { db.close(); }
    },

    async embed(text) {
      return runIsolatedEmbed(text);
    },

    async runExtraction(messages) {
      const { createLlmClient } = await import('./llm-client.mjs');
      const { extractStructured } = await import('./extraction-prompt.mjs');
      const client = createLlmClient({ baseUrl: config.llmBaseUrl, model: config.llmModel, nativeApi: config.llmNativeApi, timeout: config.extractBudgetMs });
      return extractStructured(client, messages);
    },

    async runGeneration(messages) {
      const { createLlmClient } = await import('./llm-client.mjs');
      const client = createLlmClient({ baseUrl: config.llmBaseUrl, model: config.llmModel, nativeApi: config.llmNativeApi, timeout: config.genBudgetMs });
      return client.generate(messages, { maxTokens: 32, temperature: 0.1, bypassQueue: true });
    },

    async natsConnect(name) {
      const { connect } = await import('nats');
      const { natsConnectOpts } = require('./nats-resolve.js');
      const opts = { name, servers: config.natsUrl || undefined, timeout: 5000, maxReconnectAttempts: 0, reconnect: false };
      return connect(config.isolatedMemoryAcceptance
        ? { ...opts, token: config.natsToken }
        : natsConnectOpts(opts));
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
  const startedAt = ctx.startedAt || Date.now();
  const nonce = `ACCPROBE${ctx.runId.replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
  const ingestNonce = `ACCINGEST${ctx.runId.replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
  const synthSessionId = `acc-probe-${ctx.runId}`;
  const ingestSessionId = `acc-ingest-${ctx.runId}`;
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
      if (config.eventSchemasDist) checks.push(['event-schemas dist (daemon exits at startup without it)', config.eventSchemasDist]);
      const missing = [];
      for (const [name, p] of checks) { try { await ctx.fsp.access(p); } catch { missing.push(`${name} (${p})`); } }
      return missing.length
        ? fail(`deploy surface missing: ${missing.join('; ')}`, '', 'daemon bin + lib/ + event-schemas dist deployed in workspace')
        : pass('memory-daemon binary + lib/ + event-schemas dist deployed', `${config.daemonBin}`, 'daemon bin + lib/ + event-schemas dist deployed in workspace');
    },
  });
  probes.push({
    id: 'L0-HYPERAGENT', layer: 'L0', axis: 'memory', required: true,
    async run() {
      const bin = path.join(config.workspace, 'bin', 'hyperagent.mjs');
      const lib = path.join(config.workspace, 'lib', 'hyperagent-store.mjs');
      const missing = [];
      for (const target of [bin, lib]) {
        try { await ctx.fsp.access(target); } catch { missing.push(target); }
      }
      if (missing.length > 0) {
        return fail('HyperAgent deploy surface missing', missing.join(', '), 'workspace CLI + store deployed');
      }
      const result = await ctx.exec(process.execPath, [bin, '--help'], { timeoutMs: 5000 });
      return result.code === 0 && result.stdout.includes('hyperagent')
        ? pass('HyperAgent CLI imports successfully', bin, 'workspace CLI imports with deployed dependencies')
        : fail('HyperAgent CLI import failed', result.stderr || result.stdout, 'workspace CLI imports with deployed dependencies');
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
      const streamName = localEventStreamName(config.nodeId);
      let nc;
      try { nc = await ctx.natsConnect('acc-stream'); }
      catch (e) { return /Cannot find|ERR_MODULE/.test(e.message) ? block(`nats package unavailable: ${e.message}`) : fail(`NATS unreachable: ${e.message}`, '', `stream ${streamName} exists`); }
      try {
        const jsm = await nc.jetstreamManager();
        const info = await jsm.streams.info(streamName);
        return pass(`per-node stream present`, `subjects=${(info.config.subjects || []).join(',')} msgs=${info.state.messages}`, `${streamName} exists`);
      } catch (e) {
        return fail(`stream ${streamName} not found: ${e.message}`, '', `${streamName} exists`);
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
      try {
        const result = await ctx.runGeneration([{ role: 'user', content: 'Reply with exactly the word: OK' }]);
        const text = (result.content || '').trim();
        const tokens = result.usage?.completion_tokens;
        const validTokens = config.llmNativeApi ? tokens > 0 : (tokens === undefined || tokens > 0);
        return (text && validTokens)
          ? pass('generation runs', `response="${text.slice(0, 40)}" completion_tokens=${tokens ?? 'unreported'}`, 'non-empty completion in budget')
          : fail('empty/degenerate generation', `response="${text}" completion_tokens=${tokens ?? 'unreported'}`, 'non-empty completion in budget');
      } catch (error) {
        return fail(`generation failed: ${error.message}`, '', 'non-empty completion in budget');
      }
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
    timeoutMs: config.extractBudgetMs + 30000,
    async run() {
      const messages = [
        { role: 'user', content: `We considered Postgres for ${nonce}, but rejected it because it needs a separate server. We decided to use SQLite for ${nonce} because it is embedded and portable.` },
        { role: 'assistant', content: `Confirmed: ${nonce} uses SQLite, not Postgres, with a NATS event log.` },
      ];
      try {
        const result = await ctx.runExtraction(messages);
        const evidence = `entities=${(result.entities || []).length} decisions=${(result.decisions || []).length} themes=${(result.themes || []).length}`;
        const decisions = result.decisions || [];
        const foundDecision = decisions.some((d) =>
          String(d.decision || '').toUpperCase().includes(nonce)
          && /\bsqlite3?\b/i.test(d.decision || '')
          && DECISION_RATIONALE.test(d.rationale || ''));
        const chosePostgres = decisions.some((d) => /\bpostgres(?:ql)?\b/i.test(d.decision || '')
          && !/\bsqlite3?\b/i.test(d.decision || '')
          && /\b(?:use|using|adopt|adopted|choose|chose|select|switch(?:ed)? to)\b/i.test(d.decision || '')
          && !/\b(?:not|never|rejected|instead of|rather than)\b/i.test(d.decision || ''));
        return foundDecision && !chosePostgres
          ? pass('structured extraction recovered the project decision', evidence, 'schema-valid nonce-linked SQLite decision with rationale; Postgres rejected')
          : fail(`structured extraction missed decision (nonce_linked_sqlite=${foundDecision} postgres_chosen=${chosePostgres})`, evidence, 'schema-valid nonce-linked SQLite decision with rationale; Postgres rejected');
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
      const isolationError = await isolatedMemoryFixture(ctx, config);
      if (isolationError) return block(`synthetic ingest requires an isolated fixture: ${isolationError}`);
      const tmp = ctx.path.join(os.tmpdir(), `${ingestSessionId}.jsonl`);
      await ctx.fsp.writeFile(tmp, syntheticTranscript(ingestNonce, ingestSessionId), 'utf8');
      ctx.teardown.push(async () => { await ctx.fsp.unlink(tmp).catch(() => {}); });
      ctx.teardown.push(() => cleanupState(ctx, config, ingestSessionId, ingestNonce));
      ctx.teardown.push(() => cleanupKnowledge(ctx, config, ingestSessionId));
      let res;
      try { res = await ctx.importSession(tmp, { source: 'claude-code', sessionId: ingestSessionId }); }
      catch (e) { return /Cannot find|ERR_MODULE/.test(e.message) ? block(`session-store unavailable: ${e.message}`) : fail(`ingest failed: ${e.message}`); }
      let count = 0;
      try { count = ctx.queryDb(config.stateDb, (db) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(res?.sessionId || ingestSessionId).n); }
      catch (e) { return fail(`post-ingest query failed: ${e.message}`); }
      return count >= 2
        ? pass(`ingest landed in state.db`, `session=${res?.sessionId || ingestSessionId} messages=${count}`, 'messages count grows ≥2')
        : fail(`ingest did not land (count=${count})`, '', 'messages count grows ≥2');
    },
  });
  const injectProbe = {
    id: 'MEM-L2-INJECT', layer: 'L2', axis: 'memory', required: true,
    // The inject server embeds the prompt (query-analysis → mcp-knowledge
    // embed → Xenova/bge-m3, ~2 GB). --skip-llm never prefetches that model,
    // so the first inject on a model-less node starts the download and the
    // probe times out ("This operation was aborted" on the virgin-Mac run).
    // Like MEM-L4-ROUNDTRIP this needs the LLM axis: skipped honestly, never
    // a false REJECT.
    needs: ['llm'],
    // Budget > the server's DESIGNED worst case: 8s analysis fallback + retrieval
    // ≈ 9–11s honest latency, plus deep-run LLM-probe contention on the same box.
    // 12s clipped real 200s (observed 10.04s full-pipeline responses) → false BROKEN.
    timeoutMs: config.injectBudgetMs + 5000,
    async run() {
      let token;
      try { token = (await ctx.fsp.readFile(config.injectToken, 'utf8')).trim(); }
      catch (e) { return block(`inject token unreadable: ${e.message}`); }
      const url = `http://${config.injectHost}:${config.injectPort}/memory/inject`;
      const r = await ctx.httpPost(url, {
        timeoutMs: config.injectBudgetMs,
        headers: { Authorization: `Bearer ${token}` },
        body: { prompt: config.isolatedMemoryAcceptance ? `What database does ${nonce} use?` : 'memory daemon architecture and decisions', frontend: 'node-acceptance' },
      }).catch((e) => ({ status: 0, error: e.message }));
      if (r.status === 401) return fail('inject auth rejected (401)', '', 'authorized 200 with items shape');
      if (r.status !== 200) return fail(`inject HTTP ${r.status || r.error}`, '', 'authorized 200 with items shape');
      const j = r.json || {};
      const it = j.items || {};
      const wellFormed = typeof j.block === 'string' && it && ['concepts', 'decisions', 'snippets'].every((k) => typeof it[k] === 'number');
      if (!wellFormed) return fail(`inject response malformed`, JSON.stringify(j).slice(0, 160), 'authorized 200 with items shape');
      const total = it.concepts + it.decisions + it.snippets;
      if (total === 0) {
        // P5-4: "answers with nothing" used to be green. A well-formed empty
        // answer proves the HTTP path, not retrieval. If the store holds
        // entities and none come back, retrieval is dead → FAIL; if the
        // store is genuinely empty there is nothing to observe yet → SKIP
        // (required, so the gate is INCOMPLETE, never ACCEPTED).
        let stored = null;
        try { stored = ctx.queryDb(config.stateDb, (db) => db.prepare('SELECT COUNT(*) AS n FROM entities').get().n); }
        catch { /* no store yet */ }
        if (stored > 0) return fail(`inject returned no items although the store holds ${stored} entities (retrieval dead)`, JSON.stringify(it), 'items > 0 when the store is non-empty');
        return skip(`inject answers but the store is empty (${stored ?? 'unreadable'} entities) — nothing to retrieve yet; re-run after the first extraction`);
      }
      return pass(`inject pipeline answers`, `concepts=${it.concepts} decisions=${it.decisions} snippets=${it.snippets} tokens=${j.tokens} ${j.elapsed_ms}ms`, 'authorized 200, items > 0');
    },
  };
  probes.push({
    id: 'MEM-L4-ROUNDTRIP', layer: 'L4', axis: 'memory', required: true, mutate: true, slow: true,
    needs: ['llm'], // extraction needs a model — skipped with --skip-axis llm
    timeoutMs: config.roundtripPollMs + config.injectBudgetMs + 10000,
    async run() {
      // 1. place a nonce transcript where the deployed daemon ingests it
      const sourceDir = await firstTranscriptSource(ctx, config);
      if (!sourceDir) return block('no writable transcript source dir configured (config/transcript-sources.json) — cannot exercise the deployed ingest loop');
      const isolationError = await isolatedMemoryFixture(ctx, config, sourceDir);
      if (isolationError) return block(`gold round-trip requires an isolated fixture: ${isolationError}`);
      const file = ctx.path.join(sourceDir, `${synthSessionId}.jsonl`);
      await ctx.fsp.writeFile(file, syntheticTranscript(nonce, synthSessionId), 'utf8');
      ctx.teardown.push(async () => { await ctx.fsp.unlink(file).catch(() => {}); });
      ctx.teardown.push(() => cleanupState(ctx, config, synthSessionId, nonce));
      ctx.teardown.push(() => cleanupKnowledge(ctx, config, synthSessionId));

      // 2. nudge the deployed extraction path
      let nc = null;
      try { nc = await ctx.natsConnect('acc-roundtrip'); await ctx.publishTrigger(nc, 'node-acceptance-roundtrip'); }
      catch { /* daemon may flush on its own poll; continue */ }
      finally { if (nc) await nc.close().catch(() => {}); }

      // 3. wait for the daemon's import, index, and extraction of this session
      const budget = config.roundtripPollMs;
      const interval = Math.min(3000, budget);
      const deadline = Date.now() + budget;
      let storedDecision = null;
      let importedCount = 0;
      let indexedTurns = 0;
      while (Date.now() < deadline) {
        try {
          const state = ctx.queryDb(config.stateDb, (db) => ({
            importedCount: db.prepare('SELECT message_count FROM sessions WHERE id = ?').get(synthSessionId)?.message_count || 0,
            candidates: db.prepare('SELECT id, decision, rationale FROM decisions WHERE session_id = ? AND decision LIKE ? AND decision LIKE ? ORDER BY id DESC').all(synthSessionId, `%${nonce}%`, '%SQLite%'),
          }));
          importedCount = state.importedCount;
          indexedTurns = ctx.queryDb(config.knowledgeDb, (db) => db.prepare('SELECT turn_count FROM session_documents WHERE session_id = ?').get(synthSessionId)?.turn_count || 0);
          storedDecision = state.candidates.find((row) => DECISION_RATIONALE.test(row.rationale || '')) || null;
        }
        catch { /* db may be mid-write */ }
        if (importedCount >= 4 && indexedTurns >= 4 && storedDecision) break;
        await new Promise((r) => setTimeout(r, interval));
      }
      if (importedCount < 4 || indexedTurns < 4 || !storedDecision) return fail('daemon import, index, or SQLite extraction did not complete', `session=${synthSessionId} imported=${importedCount} indexed=${indexedTurns} decision=${Boolean(storedDecision)}`, 'daemon-imported indexed session with nonce-linked SQLite decision');

      // 4. retrieve by content through the inject server
      let token;
      try { token = (await ctx.fsp.readFile(config.injectToken, 'utf8')).trim(); } catch (e) { return block(`inject token unreadable: ${e.message}`); }
      const url = `http://${config.injectHost}:${config.injectPort}/memory/inject`;
      const r = await ctx.httpPost(url, { timeoutMs: config.injectBudgetMs, headers: { Authorization: `Bearer ${token}` }, body: { prompt: `What database does ${nonce} use?`, frontend: 'node-acceptance' } })
        .catch((e) => ({ status: 0, error: e.message }));
      if (r.status !== 200) return fail(`inject HTTP ${r.status || r.error}`, '', 'nonce-linked SQLite decision persisted and retrievable');
      const { sanitizeField, FIELD_CAPS } = await import('./memory-formatter.mjs');
      const block_ = ((r.json || {}).block || '');
      const decisionCount = Number(r.json?.items?.decisions || 0);
      const decisionSection = block_.split('Recent decisions:\n')[1]?.split('\nRelated sessions:')[0]?.split('\n[end memory]')[0] || '';
      const renderedDecision = sanitizeField(storedDecision.decision, FIELD_CAPS.decision);
      const foundStoredDecision = decisionSection.split('\n').some((line) => line.startsWith('- ') && line.includes(`: ${renderedDecision} (`));
      return foundStoredDecision && decisionCount > 0
        ? pass('gold round-trip: SQLite decision ingested→extracted→retrieved', `decision #${storedDecision.id} found in injected block`, 'nonce-linked SQLite decision persisted and retrievable')
        : fail('synthetic SQLite decision not retrievable via inject (indexed?)', `decision #${storedDecision.id} present=${foundStoredDecision} decision_count=${decisionCount}`, 'nonce-linked SQLite decision persisted and retrievable');
    },
  });
  probes.push(injectProbe);
  probes.push({
    id: 'MEM-L2-WATCHER', layer: 'L2', axis: 'memory', required: true,
    timeoutMs: 12000,
    async run() {
      const watcherPath = path.join(config.home, 'watcher.jsonl');
      const since = config.isolatedMemoryAcceptance ? startedAt : Date.now() - 300000;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const raw = await ctx.fsp.readFile(watcherPath, 'utf8').catch(() => '');
        const records = raw.split('\n').filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line)]; } catch { return []; }
        }).filter((record) => new Date(record.ts).getTime() >= since);
        const alerts = records.filter((record) => record.op === 'watcher.alert');
        if (alerts.length) return fail(`watcher alert during acceptance: ${alerts.map((record) => record.alert_type).join(', ')}`, watcherPath, 'fresh watcher events with no open alert');
        const extracted = records.filter((record) => record.op === 'memory.extracted'
          && (!config.isolatedMemoryAcceptance || record.session === synthSessionId));
        const injected = records.some((record) => record.op === 'memory.injected' && record.status === 'ok');
        if (extracted.length && injected) {
          const successIndex = extracted.findIndex((record) => record.status === 'ok');
          return successIndex !== 0
            ? fail(`extraction required ${successIndex < 0 ? extracted.length : successIndex + 1} attempts`, `session=${synthSessionId}`, 'first extraction succeeds without watcher alert')
            : pass('watcher observed extraction and injection without alert', config.isolatedMemoryAcceptance ? `session=${synthSessionId} extraction_attempts=1` : 'recent extraction and injection', 'fresh watcher events with no open alert');
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!config.isolatedMemoryAcceptance) return skip('no recent extraction and injection to observe in the live watcher');
      return fail('watcher did not observe fresh extraction and injection', watcherPath, 'fresh watcher events with no open alert');
    },
  });

  // ── Federation substrate fitness (step 6.4) ───────────────────────────────
  // Acceptance = fitness-to-deploy: can this node coordinate a grappe, is the
  // bus quorate. Runtime grappe/session LIVENESS is node-watch's job (6.3), not
  // the gate's — on a fresh install there is never a live grappe. All required:
  // false; a standalone/worker node with no coordinator is a valid ACCEPTED node.
  probes.push({
    id: 'FED-L2-COORD', layer: 'L2', axis: 'federation', required: false,
    async run() {
      if (process.platform !== 'darwin') return skip('coordinator presence check is launchd/darwin-only here');
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      if (uid == null) return skip('coordinator launchd domain unobservable (uid unavailable)');
      const state = parseLaunchdPrint(await ctx.exec('launchctl', ['print', `gui/${uid}/ai.openclaw.mesh-task-daemon`]));
      return mapFedVerdict(
        gradeCoordinator(state),
        'mesh-task-daemon running PID ⇒ can coordinate grappes (else worker/standalone)',
      );
    },
  });
  probes.push({
    id: 'FED-L2-QUORUM', layer: 'L2', axis: 'federation', required: false,
    timeoutMs: 6000,
    async run() {
      const jsz = await ctx.httpGet(`${config.natsMonitorUrl}/jsz`, { timeoutMs: 2500 }).catch((e) => ({ status: 0, error: e.message }));
      // Bus down is owned by the REQUIRED network axis (NET-L2-JSZ) — don't
      // double-reject here; federation is simply unobservable without a bus.
      if (jsz.status !== 200) return skip(`NATS bus unobservable (jsz ${jsz.status || jsz.error}) — network axis owns bus liveness`);
      // Graded from raft (jsz.meta_cluster), not varz connect_urls — the latter
      // includes self and is gossip, so it cannot detect quorum loss.
      return mapFedVerdict(
        gradeClusterQuorum({
          jszReachable: true,
          jszParsed: !!jsz.json,
          metaCluster: jsz.json?.meta_cluster ?? null,
        }),
        'raft leader elected ⇒ majority of the cluster reachable (jsz.meta_cluster)',
      );
    },
  });

  return probes;
}

// ── teardown helpers ──────────────────────────────────────────────────────

async function cleanupState(ctx, config, sessionId, nonce) {
  ctx.writeDb(config.stateDb, (db) => {
    db.transaction(() => {
      db.prepare('UPDATE decisions SET superseded_by = NULL WHERE superseded_by IN (SELECT id FROM decisions WHERE session_id = ?)').run(sessionId);
      db.prepare('DELETE FROM concept_edges WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM entity_aliases WHERE alias LIKE ?').run(`%${nonce}%`);
      db.prepare('DELETE FROM entity_aliases WHERE entity_id IN (SELECT id FROM entities WHERE name = ? OR name LIKE ?)').run(nonce, `%${nonce}%`);
      db.prepare('DELETE FROM mentions WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM decisions WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      db.prepare('DELETE FROM entities WHERE name = ? OR name LIKE ?').run(nonce, `%${nonce}%`);
      db.prepare('DELETE FROM themes WHERE label LIKE ?').run(`%${nonce}%`);
    })();
  });
}

async function cleanupKnowledge(ctx, config, sessionId) {
  ctx.writeDb(config.knowledgeDb, (db) => {
    db.prepare('DELETE FROM session_chunks WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM session_documents WHERE session_id = ?').run(sessionId);
  });
}

async function firstTranscriptSource(ctx, config) {
  try {
    const raw = await ctx.fsp.readFile(config.transcriptSources, 'utf8');
    for (const dir of registryDirs(raw, ctx.runtimeHome())) {
      try { await ctx.fsp.access(dir); return dir; } catch { /* skip */ }
    }
  } catch { /* no sources file */ }
  return null;
}
