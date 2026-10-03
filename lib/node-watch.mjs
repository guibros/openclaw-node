/**
 * lib/node-watch.mjs — the node watcher: reports the REAL status of each key
 * element of the node, continuously or one-shot.
 *
 * Verdict model (honesty invariant — the whole point):
 *   WORKING  — a probe OBSERVED the working signal.
 *   BROKEN   — a probe observed a failure (should be working, isn't).
 *   OFF      — intentionally not active on this node (not configured / not deployed / on-demand).
 *   UNKNOWN  — could not observe (no probe yet, probe errored, dependency for the probe absent).
 *
 * Nothing is ever WORKING without an observation. A target with no implemented
 * probe returns UNKNOWN, never green. Watch mode does not mutate the node it
 * observes; it stores only reports and ingest-lag observation state. Heavy
 * probes (LLM generate/embed/extract) run only one-shot
 * or with includeHeavy, else UNKNOWN("not probed this cycle"). Reuses
 * health-check.mjs + the read-only node-acceptance probes (no parallel impl).
 */

import { readFileSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runHealthCheck } from './health-check.mjs';
import { mcAuthHeaders } from './mc-session-token.mjs';
import { viewerAuthHeaders } from './workplan-viewer-auth.mjs';
import { resolveNodeConfig } from './node-acceptance.mjs';
import { createRuntimeContext, buildProbes } from './node-acceptance-probes.mjs';
import { getVaultPath, VAULT_SUBDIRS } from './obsidian-vault.mjs';
import { PROTECTED_NATS_HANDOFF } from './nats-writer-ownership.mjs';
import { parseJsonlStream } from './transcript-parser.mjs';
import { observeIngestLag } from './node-watch-ingest-ledger.mjs';
import {
  probeGrappeMembers, probeSessionLiveness, gradeClusterQuorum, gradeCoordinator,
  parseLaunchdPrint,
} from './fed-probes.mjs';
export { parseLaunchdPrint } from './fed-probes.mjs';

export const STATUS = Object.freeze({ WORKING: 'WORKING', BROKEN: 'BROKEN', OFF: 'OFF', UNKNOWN: 'UNKNOWN' });

const W = (detail, evidence = '') => ({ status: STATUS.WORKING, detail, evidence });
const B = (detail, evidence = '') => ({ status: STATUS.BROKEN, detail, evidence });
const OFF = (detail) => ({ status: STATUS.OFF, detail, evidence: '' });
const U = (detail) => ({ status: STATUS.UNKNOWN, detail, evidence: '' });

// fed-probes graders return { status: 'WORKING'|'BROKEN'|'OFF'|'UNKNOWN', detail } — map to node-watch shape.
const mapFed = (v) => ({ status: v.status, detail: v.detail, evidence: v.evidence || '' });

function mapAcceptance(v) {
  switch (v && v.status) {
    case 'PASS': return W(v.detail, v.evidence);
    case 'FAIL': return B(v.detail, v.evidence);
    case 'N/A': return OFF(v.detail);
    case 'SKIP': return OFF(v.detail);
    default: return U((v && v.detail) || 'unobservable');
  }
}

const HOUR = 3600_000;

function parseTs(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // seconds vs ms
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return Date.parse(v);
}

// ── reusable read-only checks (all via injected ctx) ─────────────────────────

async function reuse(probes, id, { includeHeavy } = {}) {
  const p = probes[id];
  if (!p) return U(`no probe '${id}'`);
  if (p.slow && !includeHeavy) return U('not probed this cycle (heavy; run one-shot or --deep)');
  try { return mapAcceptance(await p.run()); } catch (e) { return U(`probe error: ${e.message}`); }
}

async function newestMtimeMs(ctx, dir, accept = () => true) {
  try {
    const names = await ctx.fsp.readdir(dir);
    let newest = 0;
    for (const n of names) {
      if (!accept(n)) continue;
      try { const st = await ctx.fsp.stat(ctx.path.join(dir, n)); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch { /* skip */ }
    }
    return newest || null;
  } catch { return null; }
}

async function launchdService(ctx, label, domain = null) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid == null) return { observable: false, loaded: false, running: false, pid: null, state: null, error: 'uid unavailable' };
  domain ||= `gui/${uid}`;
  const result = await ctx.exec('launchctl', ['print', `${domain}/${label}`]);
  const rawExit = result.stdout?.match(/^[ \t]*last exit code = (-?\d+)(?:[ \t]*:[ \t]*[^\r\n]*)?[ \t]*$/m)?.[1];
  const neverExited = /^[ \t]*last exit code = \(never exited\)[ \t]*$/m.test(result.stdout || '');
  const terminatingSignal = /^[ \t]*last terminating signal = [^\r\n]+$/m.test(result.stdout || '');
  const home = result.stdout?.match(/^\s*HOME => (.+)$/m)?.[1]?.trim() || null;
  return { label, domain, ...parseLaunchdPrint(result),
    lastExitCode: rawExit === undefined ? null : Number(rawExit), exitKnown: rawExit !== undefined || neverExited,
    terminatingSignal, home };
}

export function gradeMeshServices(services = [], { discordEnabled, discordPolicyError } = {}) {
  const observable = services.filter((s) => s.observable);
  const loaded = observable.filter((s) => s.loaded);
  const discord = services.find((s) => s.label === 'ai.openclaw.mesh-tool-discord');
  if (discordEnabled === false && discord?.observable && discord.loaded && discord.running) {
    return B('Discord is explicitly disabled but its mesh tool is running', `${discord.label}:${discord.pid}`);
  }
  const inactive = discordEnabled === false && discord?.observable && discord.loaded && !discord.running
    && discord.lastExitCode === 0 && discord.state === 'not running' ? discord : null;
  const idleAgent = services.find((s) => s.label === 'ai.openclaw.mesh-agent'
    && s.observable && s.loaded && !s.running && s.state === 'not running'
    && s.exitKnown === true && !s.terminatingSignal && (s.lastExitCode === null || s.lastExitCode === 0));
  const expected = loaded.filter((s) => s !== inactive && s !== idleAgent);
  const running = expected.filter((s) => s.running);
  const stopped = expected.filter((s) => !s.running);
  const uncertain = stopped.filter((s) => s === discord && (discordEnabled === false || discordPolicyError)
    && (s.lastExitCode == null || s.lastExitCode === 0));
  const failed = stopped.filter((s) => !uncertain.includes(s));
  const evidence = running.map((s) => `${s.label}:${s.pid}`)
    .concat(inactive ? [`${inactive.label}:OFF(exit0)`] : []).join(',');
  if (failed.length) return B(`${running.length}/${expected.length} loaded mesh service(s) running; no PID: ${failed.map((s) => s.label.replace('ai.openclaw.', '')).join(', ')}`, evidence);
  const unobservable = services.filter((s) => !s.observable);
  if (unobservable.length) return U(`mesh service state unobservable: ${unobservable.map((s) => s.label).join(', ')}`);
  if (discordPolicyError) return U(discordPolicyError);
  if (uncertain.length) return U('disabled Discord inactivity unconfirmed: need not-running state and observed exit0');
  if (idleAgent) return U(`mesh-agent idle on demand; execution path not probed; ${running.length}/${expected.length} other loaded mesh service(s) running`);
  if (!expected.length) {
    return OFF(inactive ? 'Discord OFF (explicitly disabled; loaded/not-running; exit0); no active mesh services loaded' : 'no mesh services loaded (role/standalone)');
  }
  return W(`${running.length}/${expected.length} loaded mesh service(s) running with PID evidence${inactive ? '; mesh-tool-discord OFF (explicitly disabled; loaded/not-running; exit0)' : ''}`, evidence);
}

export async function probeMeshServices(ctx, { platform = process.platform } = {}) {
  if (platform !== 'darwin') return U('mesh process check is darwin-only here');
  const labels = [
    'ai.openclaw.mesh-agent',
    'ai.openclaw.mesh-bridge',
    'ai.openclaw.mesh-deploy-listener',
    'ai.openclaw.mesh-health-publisher',
    'ai.openclaw.mesh-task-daemon',
    'ai.openclaw.mesh-tool-discord',
  ];
  const services = await Promise.all(labels.map((label) => launchdService(ctx, label)));
  const discord = services.find((s) => s.label === 'ai.openclaw.mesh-tool-discord');
  let discordEnabled;
  let discordPolicyError;
  if (discord.observable && discord.loaded) {
    if (!discord.home) discordPolicyError = 'Discord effective config unobservable: loaded HOME missing';
    else {
      try {
        const configPath = ctx.path.join(discord.home, '.openclaw', 'openclaw.json');
        discordEnabled = JSON.parse(await ctx.fsp.readFile(configPath, 'utf8')).channels?.discord?.enabled;
      } catch {
        discordPolicyError = 'Discord effective config unreadable or malformed';
      }
    }
  }
  return gradeMeshServices(services, { discordEnabled, discordPolicyError });
}

export function gradeRequiredServices(services = []) {
  const unobservable = services.filter((s) => !s.observable).map((s) => s.label);
  if (unobservable.length) return U(`required service state unobservable: ${unobservable.join(', ')}`);
  const missing = services.filter((s) => !s.loaded).map((s) => s.label);
  if (missing.length) return B(`required service(s) not loaded: ${missing.join(', ')}`);
  const stopped = services.filter((s) => !s.running).map((s) => s.label);
  if (stopped.length) return B(`required service(s) loaded without PID: ${stopped.join(', ')}`);
  return W('core services running with PID evidence', services.map((s) => `${s.domain ? `${s.domain}/` : ''}${s.label}:${s.pid}`).join(','));
}

const KNOWN_NATS_JOBS = ['ai.openclaw.nats', 'ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'];
const NATS_LAYOUTS = [
  ['ai.openclaw.nats'],
  ['ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'],
  ['ai.openclaw.nats', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'],
];

function validNatsLayout(labels) {
  return Array.isArray(labels) && NATS_LAYOUTS.some((layout) =>
    labels.length === layout.length && layout.every((label) => labels.includes(label)));
}

export async function probeCoreLaunchdServices(ctx, { platform = process.platform } = {}) {
  if (platform !== 'darwin') return U('service process check is darwin-only here');
  let protectedNats = false;
  let activeNats;
  try {
    const marker = await ctx.fsp.lstat(PROTECTED_NATS_HANDOFF);
    if (!marker.isFile() || marker.isSymbolicLink() || marker.uid !== 0 || (marker.mode & 0o022)) {
      return U('protected NATS handoff marker has invalid identity');
    }
    const handoff = JSON.parse(await ctx.fsp.readFile(PROTECTED_NATS_HANDOFF, 'utf8'));
    if (handoff?.schema !== 1 || handoff?.kind !== 'openclaw-nats-writer-handoff'
        || !validNatsLayout(handoff.activeLabels)) {
      return U('protected NATS handoff marker has invalid content');
    }
    activeNats = handoff.activeLabels;
    protectedNats = true;
  } catch (error) {
    if (error.code !== 'ENOENT') return U(`protected NATS handoff state unobservable: ${error.code || error.message}`);
  }
  if (!protectedNats) {
    try {
      const configured = JSON.parse(await ctx.fsp.readFile(join(ctx.config?.home || resolveNodeConfig().home,
        'config', 'nats-writer-cohort.json'), 'utf8'));
      if (configured?.schema !== 1 || !validNatsLayout(configured.activeLabels)) return U('legacy NATS cohort has invalid content');
      activeNats = configured.activeLabels;
    } catch (error) {
      if (error.code !== 'ENOENT') return U(`legacy NATS cohort unobservable: ${error.code || error.message}`);
      return U('NATS cohort declaration absent');
    }
  }
  const core = ['ai.openclaw.memory-daemon', ...activeNats, 'ai.openclaw.mission-control'];
  const services = await Promise.all(core.map((label) => launchdService(ctx, label,
    protectedNats && activeNats.includes(label) ? 'system' : null)));
  const uid = process.getuid();
  const otherDomains = protectedNats ? [null, `user/${uid}`] : ['system', `user/${uid}`];
  const other = await Promise.all([
    ...otherDomains.flatMap((domain) => KNOWN_NATS_JOBS.map((label) => launchdService(ctx, label, domain))),
    ...KNOWN_NATS_JOBS.filter((label) => !activeNats.includes(label)).map((label) =>
      launchdService(ctx, label, protectedNats ? 'system' : null)),
  ]);
  if (other.some((service) => !service.observable)) return U('other NATS job state unobservable');
  const loaded = other.filter((service) => service.loaded);
  if (loaded.length) return B(`unexpected NATS job(s) loaded: ${loaded.map((service) => `${service.domain}/${service.label}`).join(', ')}`);
  return gradeRequiredServices(services);
}

export function gradeGateway({ service, newestSessionMs, now = Date.now(), freshMs = 24 * HOUR }) {
  if (!service?.observable) return U(`gateway launchd state unobservable${service?.error ? `: ${service.error}` : ''}`);
  if (!service.loaded) return OFF('gateway service not loaded');
  if (!service.running) return B(`gateway loaded but not running (state=${service.state || 'unknown'}, no PID)`);
  if (!Number.isFinite(newestSessionMs)) return U(`gateway pid=${service.pid} running but no session JSONL is observable`);
  const age = Math.max(0, now - newestSessionMs);
  const ageMin = Math.round(age / 60000);
  if (age > freshMs) return U(`gateway pid=${service.pid} running but newest session is stale (${ageMin}min); request path unverified`);
  return W(`gateway pid=${service.pid} running; newest session ${ageMin}min ago`, String(newestSessionMs));
}

/** Extraction verdict: entities must keep pace with ingested messages. */
export function gradeExtraction({ entityCount, lastEntityMs, lastMessageMs, stallBudgetMs = 6 * HOUR }) {
  if (!entityCount) return U('no entities extracted yet');
  if (Number.isFinite(lastMessageMs) && Number.isFinite(lastEntityMs)
      && lastMessageMs - lastEntityMs > stallBudgetMs) {
    const lagH = ((lastMessageMs - lastEntityMs) / HOUR).toFixed(1);
    return B(`extraction STALLED — ingest has flowed ${lagH}h past the newest entity landing (${new Date(lastEntityMs).toISOString()})`);
  }
  return W(`entities=${entityCount}, latest=${lastEntityMs ? new Date(lastEntityMs).toISOString() : 'n/a'}`, String(lastEntityMs || ''));
}

/** Scan enabled transcript sources and retain missing or unreadable paths. */
async function scanTranscriptSources(ctx, config) {
  const registryPath = ctx.path.join(config.home, 'config', 'transcript-sources.json');
  let sources;
  try {
    sources = (JSON.parse(await ctx.fsp.readFile(registryPath, 'utf8')).sources || [])
      .filter((s) => s.enabled !== false);
  } catch { return { missingSources: null }; } // registry unreadable → unobservable
  const home = config.home.replace(/\/\.openclaw$/, '');
  const missingSources = [];
  const unreadableFiles = [];
  const files = [];
  for (const s of sources) {
    const dir = String(s.path || '').replace(/^~(?=\/)/, home).replace(/\/$/, '');
    try { await ctx.fsp.access(dir); } catch { missingSources.push(`${s.name} (${dir})`); continue; }
    let names;
    try { names = await ctx.fsp.readdir(dir); } catch { missingSources.push(`${s.name} (${dir})`); continue; }
    for (const name of names.filter((n) => n.endsWith('.jsonl'))) {
      const file = ctx.path.join(dir, name);
      try {
        const st = await ctx.fsp.lstat(file);
        if (!st.isFile()) { unreadableFiles.push(file); continue; }
        files.push({ file, format: s.format, mtimeMs: st.mtimeMs,
          identity: [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':') });
      } catch { unreadableFiles.push(file); }
    }
  }
  return { missingSources, unreadableFiles, files };
}

const transcriptTurnCache = new Map();

async function transcriptTurnSummary(ctx, entry) {
  const cached = transcriptTurnCache.get(entry.file);
  if (cached?.identity === entry.identity && cached.format === entry.format) return cached;
  const handle = await ctx.fsp.open(entry.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('transcript is not a regular file');
    const identity = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':');
    if (identity !== entry.identity) throw new Error('transcript changed before opening');
    const messages = await parseJsonlStream(handle.createReadStream({ autoClose: false }),
      { format: entry.format || 'auto' });
    const after = await handle.stat();
    const afterIdentity = [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':');
    if (after.isFile() && identity === afterIdentity) {
      const lastTurn = messages.at(-1)?.timestamp || null;
      const summary = { identity, format: entry.format, count: messages.length, lastTurn };
      transcriptTurnCache.set(entry.file, summary);
      return summary;
    }
    throw new Error('transcript changed during turn comparison');
  } finally { await handle.close(); }
}

async function fileFresh(ctx, p, maxMs, { missingIsBroken = true } = {}) {
  try {
    const st = await ctx.fsp.stat(p);
    const age = Date.now() - st.mtimeMs;
    return { age, fresh: age <= maxMs, exists: true };
  } catch {
    return { age: null, fresh: false, exists: false, missingIsBroken };
  }
}

async function dbMeta(ctx, dbPath, table, key) {
  return ctx.queryDb(dbPath, (db) => db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key)?.value);
}

// ── the locked watch-target registry ─────────────────────────────────────────
// Each: { id, family, label, signal, applies?(env), run(env) -> verdict }.
// env = { ctx, config, hc, probes, includeHeavy }.

export const WATCH_TARGETS = [
  // ── Memory ───────────────────────────────────────────────────────────────
  { id: 'mem.daemon', family: 'memory', label: 'Memory daemon', signal: 'process alive',
    run: ({ hc }) => hc.daemon?.ok ? W(hc.daemon.detail) : B(hc.daemon?.detail || 'not running') },
  { id: 'mem.ingest', family: 'memory', label: 'Session ingest', signal: 'configured transcript turns are archived; no archive progress for over 2h is broken',
    async run({ ctx, config }) {
      let r;
      try {
        r = ctx.queryDb(config.stateDb, (db) => ({ n: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n }));
      } catch (e) { return B(`state.db unreadable: ${e.message}`); }
      const scan = await scanTranscriptSources(ctx, config);
      if (scan.missingSources?.length) return B(`enabled transcript source dir(s) MISSING: ${scan.missingSources.join(', ')}`);
      if (!scan.files) return U('transcript source registry unreadable');
      if (!scan.files.length && !scan.unreadableFiles.length) return U('no configured transcript JSONL files observable');
      try {
        const parsed = [];
        const parsedFiles = new Set();
        const uncertain = scan.unreadableFiles.map((file) => ctx.path.basename(file));
        const currentFiles = new Set(scan.files.map(({ file }) => file));
        for (const file of transcriptTurnCache.keys()) {
          if (!currentFiles.has(file)) transcriptTurnCache.delete(file);
        }
        for (const entry of scan.files) {
          try {
            const { count, lastTurn } = await transcriptTurnSummary(ctx, entry);
            parsed.push({ ...entry, sessionId: ctx.path.basename(entry.file, '.jsonl'), count,
              lastTurn });
            parsedFiles.add(entry.file);
          } catch { uncertain.push(ctx.path.basename(entry.file)); }
        }
        const compared = ctx.queryDb(config.stateDb, (db) => {
          const archive = db.prepare(`
            SELECT s.id AS archived_session_id, s.message_count, s.end_time,
              (SELECT COUNT(*) FROM messages WHERE session_id = ?) AS actual_count
            FROM (SELECT 1) LEFT JOIN sessions AS s ON s.id = ?
          `);
          return parsed.map((entry) => {
            const { sessionId, count, lastTurn } = entry;
            const record = archive.get(sessionId, sessionId);
            const declaredCount = record.message_count ?? 0;
            const inconsistent = declaredCount !== record.actual_count
              || declaredCount > count
              || (declaredCount === count && record.archived_session_id !== null && record.end_time !== lastTurn);
            return { ...entry, inconsistent, pending: declaredCount < count, archivedCount: declaredCount };
          });
        });
        const stable = [];
        for (const entry of compared) {
          try {
            const after = await ctx.fsp.lstat(entry.file);
            if (after.isFile() && [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') === entry.identity) {
              stable.push(entry);
              continue;
            }
          } catch { /* changed or removed */ }
          uncertain.push(ctx.path.basename(entry.file));
        }
        for (const entry of scan.files) {
          if (parsedFiles.has(entry.file)) continue;
          try {
            const after = await ctx.fsp.lstat(entry.file);
            if (!after.isFile() || [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') !== entry.identity) {
              uncertain.push(ctx.path.basename(entry.file));
            }
          } catch { uncertain.push(ctx.path.basename(entry.file)); }
        }
        const mismatches = stable.filter(({ inconsistent, pending }) => inconsistent || pending);
        const inconsistent = mismatches.filter((entry) => entry.inconsistent);
        let ledger = { overdue: [], lower: [] };
        let ledgerError = null;
        try {
          ledger = (ctx.observeIngestLag || observeIngestLag)(config.home, stable,
            [...scan.files.map((entry) => entry.file), ...scan.unreadableFiles], ctx.now || Date.now);
        } catch (error) { ledgerError = error; }
        const uncertainNames = [...new Set(uncertain)];
        if (inconsistent.length || ledger.overdue.length) {
          return B(`${inconsistent.length + ledger.overdue.length} transcript session(s) have overdue or inconsistent archive state`
            + (uncertainNames.length ? `; ${uncertainNames.length} other file(s) unobservable: ${uncertainNames.join(', ')}` : ''));
        }
        if (ledgerError) return U(`ingest progress ledger unavailable: ${ledgerError.message}`);
        if (ledger.lower.length) return U(`${ledger.lower.length} transcript archive count(s) below a prior observation; awaiting a stable recheck`);
        if (uncertainNames.length) {
          return U(`${uncertainNames.length} transcript file(s) unreadable, not regular or changed: ${uncertainNames.join(', ')}`
            + (mismatches.length ? `; ${mismatches.length} session(s) awaiting ingest` : ''));
        }
        if (mismatches.length) {
          return U(`${mismatches.length} transcript session(s) awaiting ingest; archive progress is not yet overdue`);
        }
        const importable = stable.filter(({ count }) => count > 0);
        if (!importable.length) return U('no importable turns in configured transcript sources');
        return W(`${importable.length} configured transcript session(s) match archived turn counts and last timestamps`, String(r.n));
      } catch (e) { return U(`transcript turn comparison unavailable: ${e.message}`); }
    } },
  { id: 'mem.extraction', family: 'memory', label: 'LLM extraction', signal: 'entities keep pace with ingested messages (stall >6h = BROKEN)',
    async run({ ctx, config }) {
      try {
        const r = ctx.queryDb(config.stateDb, (db) => ({
          n: db.prepare('SELECT COUNT(*) AS n FROM entities').get().n,
          last: db.prepare('SELECT MAX(last_seen) AS t FROM entities').get().t,
          lastMsg: db.prepare('SELECT MAX(timestamp) AS t FROM messages').get().t,
        }));
        return gradeExtraction({
          entityCount: r.n,
          lastEntityMs: parseTs(r.last),
          lastMessageMs: parseTs(r.lastMsg),
        });
      } catch (e) { return B(`extraction tables unreadable: ${e.message}`); }
    } },
  { id: 'mem.knowledge_index', family: 'memory', label: 'Knowledge index', signal: 'knowledge.db last_index_time fresh (<2h)',
    async run({ ctx, config }) {
      try {
        const v = await dbMeta(ctx, config.knowledgeDb, 'meta', 'last_index_time');
        if (v == null) return U('no last_index_time recorded');
        const age = Date.now() - parseTs(v);
        return age <= 2 * HOUR ? W(`indexed ${Math.round(age / 60000)}min ago`, String(v))
                               : B(`stale: last index ${Math.round(age / HOUR)}h ago (indexer running?)`, String(v));
      } catch (e) { return B(`knowledge.db unreadable: ${e.message}`); }
    } },
  { id: 'mem.inject', family: 'memory', label: 'Inject server :7893', signal: 'authorized POST returns memory block + items',
    reuses: 'MEM-L2-INJECT',
    run: ({ probes, includeHeavy }) => reuse(probes, 'MEM-L2-INJECT', { includeHeavy }) },
  { id: 'mem.watcher', family: 'memory', label: 'Memory watcher', signal: 'watcher.jsonl fresh (<30min)',
    async run({ ctx, config }) {
      const p = ctx.path.join(config.home, 'watcher.jsonl');
      const f = await fileFresh(ctx, p, 30 * 60_000);
      if (!f.exists) return U('watcher.jsonl absent (watcher run yet?)');
      return f.fresh ? W(`fresh ${Math.round(f.age / 60000)}min`, p) : B(`stale ${Math.round(f.age / 60000)}min (watcher running?)`, p);
    } },

  // ── Obsidian (memory subsystem) ────────────────────────────────────────────
  { id: 'obs.sync', family: 'obsidian', label: 'Local vault notes', signal: 'vault notes written recently (<2h)',
    async run({ ctx }) {
      const vault = getVaultPath();
      const mtimes = await Promise.all(VAULT_SUBDIRS.map((subdir) =>
        newestMtimeMs(ctx, ctx.path.join(vault, subdir), (name) => name.endsWith('.md'))));
      const newest = Math.max(...mtimes.filter((mtime) => mtime != null));
      if (!Number.isFinite(newest)) return U(`no vault notes found at ${vault}`);
      const age = Date.now() - newest;
      return age <= 2 * HOUR ? W(`newest note ${Math.round(age / 60000)}min ago`) : B(`stale: newest note ${Math.round(age / HOUR)}h ago (vault writers running?)`);
    } },
  { id: 'obs.graph_cache', family: 'obsidian', label: 'Graph cache (retrieval ch.5)', signal: 'graph-cache.db last_refresh_at <30min',
    async run({ ctx, config }) {
      try {
        const v = await dbMeta(ctx, config.graphCacheDb, 'graph_cache_meta', 'last_refresh_at');
        if (v == null) return U('no last_refresh_at recorded');
        const age = Date.now() - parseTs(v);
        return age <= 30 * 60_000 ? W(`refreshed ${Math.round(age / 60000)}min ago`, String(v))
                                  : B(`stale ${Math.round(age / 60000)}min — channel 5 degraded (daemon refreshing?)`, String(v));
      } catch (e) { return B(`graph-cache.db unreadable: ${e.message}`); }
    } },
  { id: 'obs.links', family: 'obsidian', label: 'Vault link integrity', signal: 'no dangling wikilinks', slow: true, timeoutMs: 15000,
    async run({ ctx }) {
      const vault = getVaultPath();
      let rep;
      try { rep = await ctx.checkVaultLinks(vault); }
      catch (e) { return /Cannot find|ERR_MODULE/i.test(e.message) ? U(`link-checker unavailable: ${e.message}`) : B(`link check failed: ${e.message}`); }
      if (!rep || rep.notes === 0) return U(`no vault notes found at ${vault}`);
      const dangling = (rep.dangling || []).length;
      return dangling === 0
        ? W(`${rep.resolved}/${rep.links} links resolved, 0 dangling (${rep.notes} notes)`)
        : B(`${dangling} dangling wikilink(s) of ${rep.links}`, (rep.dangling || []).slice(0, 5).map((d) => `${d.file}->${d.target}`).join('; '));
    } },

  // ── LLM ────────────────────────────────────────────────────────────────────
  { id: 'llm.local_model', family: 'llm-local', label: 'Ollama model present', signal: 'LLM_MODEL in /api/tags',
    reuses: 'LLM-L2-MODEL',
    run: ({ probes, includeHeavy }) => reuse(probes, 'LLM-L2-MODEL', { includeHeavy }) },
  { id: 'llm.local_gen', family: 'llm-local', label: 'Local generation', signal: '/api/generate non-empty completion',
    reuses: 'LLM-L2-GEN',
    run: ({ probes, includeHeavy }) => reuse(probes, 'LLM-L2-GEN', { includeHeavy }) },
  { id: 'llm.embedder', family: 'llm-local', label: 'Embedder (BGE-M3)', signal: '1024-dim finite vector',
    reuses: 'LLM-L2-EMBED',
    run: ({ probes, includeHeavy }) => reuse(probes, 'LLM-L2-EMBED', { includeHeavy }) },
  { id: 'llm.extraction_task', family: 'llm-local', label: 'Structured extraction', signal: 'schema-valid extraction (production task)',
    reuses: 'LLM-L2-EXTRACT',
    run: ({ probes, includeHeavy }) => reuse(probes, 'LLM-L2-EXTRACT', { includeHeavy }) },
  { id: 'llm.cloud', family: 'llm-cloud', label: 'Cloud LLM (via companion-bridge)', signal: 'bridge :8787 /health reports healthy served sessions',
    timeoutMs: 4000,
    async run({ ctx }) {
      // Wired THROUGH companion-bridge (it proxies to the upstream cloud LLM).
      // /health is free (no tokens); we never send a billable generation in watch.
      const port = process.env.ADAPTER_PORT || 8787;
      const r = await ctx.httpGet(`http://127.0.0.1:${port}/health`, { timeoutMs: 3000 }).catch((e) => ({ status: 0, error: e.message }));
      if (!r.status) return OFF(`companion-bridge not running on :${port} (on-demand; cloud LLM routes through it when up)`);
      if (r.status !== 200) return B(`companion-bridge /health HTTP ${r.status}`);
      const h = r.json || {};
      if (h.status && h.status !== 'ok') return B(`bridge unhealthy: status=${h.status}`);
      const sessions = Array.isArray(h.sessions) ? h.sessions : [];
      const degraded = sessions.filter((s) => (s.zombieRetryCount || 0) > 0 || s.contextTrackingHealthy === false);
      if (degraded.length) return B(`bridge sessions degraded (${degraded.length} w/ zombie-retry or context-tracking failure)`, `companion=${h.companion || '?'}`);
      const served = sessions.filter((s) => (s.lifetimeTurns || 0) > 0);
      if (served.length) return W(`bridge serving — ${served.length} session(s) with completed turns`, `companion=${h.companion || '?'} model=${h.model || '?'}`);
      return U('bridge up but no completed turns yet — upstream reachability unconfirmed (watcher sends no billable generation)');
    } },

  // ── Network ────────────────────────────────────────────────────────────────
  { id: 'net.nats', family: 'network', label: 'NATS + JetStream', signal: ':8222/jsz returns JetStream stats',
    reuses: 'NET-L2-JSZ',
    run: ({ probes, includeHeavy }) => reuse(probes, 'NET-L2-JSZ', { includeHeavy }) },
  { id: 'net.stream', family: 'network', label: 'Per-node event stream', signal: 'local-events-<node> exists',
    reuses: 'NET-L2-STREAM',
    run: ({ probes, includeHeavy }) => reuse(probes, 'NET-L2-STREAM', { includeHeavy }) },
  { id: 'net.pubsub', family: 'network', label: 'Pub/sub round-trip', signal: 'published msg echoed <1.5s',
    reuses: 'NET-L2-PUBSUB',
    run: ({ probes, includeHeavy }) => reuse(probes, 'NET-L2-PUBSUB', { includeHeavy }) },
  { id: 'net.mesh', family: 'network', label: 'Mesh services', signal: 'mesh-* launchd units have running PIDs',
    run: ({ ctx }) => probeMeshServices(ctx) },
  { id: 'net.federation', family: 'network', label: 'Federation (cross-node)', signal: 'identity-registry + shared stream',
    async run({ ctx, config }) {
      try { await ctx.fsp.access(ctx.path.join(config.home, 'identity-registry.json')); return U('registry present but no live federation probe yet'); }
      catch { return OFF('not deployed (no identity-registry.json) — deferred'); }
    } },

  // ── Storage ──────────────────────────────────────────────────────────────
  { id: 'store.state_db', family: 'storage', label: 'state.db', signal: 'opens, integrity ok',
    run: ({ ctx, config }) => dbIntegrity(ctx, config.stateDb) },
  { id: 'store.knowledge_db', family: 'storage', label: 'knowledge.db', signal: 'opens, integrity ok',
    run: ({ ctx, config }) => dbIntegrity(ctx, config.knowledgeDb) },
  { id: 'store.graph_cache_db', family: 'storage', label: 'graph-cache.db', signal: 'opens, integrity ok',
    run: ({ ctx, config }) => dbIntegrity(ctx, config.graphCacheDb) },

  // ── Agent runtime ──────────────────────────────────────────────────────────
  { id: 'runtime.gateway', family: 'runtime', label: 'OpenClaw gateway', signal: 'running launchd PID + session JSONL fresh (<24h)',
    async run({ ctx, config }) {
      if (process.platform !== 'darwin') return U('gateway process check is darwin-only here');
      const service = await launchdService(ctx, 'ai.openclaw.gateway');
      const dir = ctx.path.join(config.home, 'agents', 'main', 'sessions');
      const newest = await newestMtimeMs(ctx, dir, (name) => name.endsWith('.jsonl'));
      return gradeGateway({ service, newestSessionMs: newest });
    } },
  { id: 'runtime.bridge', family: 'runtime', label: 'companion-bridge :8787', signal: 'HTTP responds',
    async run({ ctx }) {
      const r = await ctx.httpGet('http://127.0.0.1:8787/', { timeoutMs: 2000 }).catch((e) => ({ status: 0, error: e.message }));
      return r.status ? W(`responds HTTP ${r.status}`) : OFF('not listening (runs on-demand, not a daemon)');
    } },

  // ── Operations & planning surfaces ───────────────────────────────────────
  { id: 'ops.taskboard', family: 'ops', label: 'Task board (kanban)', signal: 'active-tasks.md parses',
    async run({ ctx, config }) {
      const p = ctx.path.join(config.workspace, 'memory', 'active-tasks.md');
      try { const txt = await ctx.fsp.readFile(p, 'utf8'); return txt.trim() ? W(`active-tasks.md present (${txt.split('\n').length} lines)`, p) : U('active-tasks.md empty'); }
      catch { return U(`active-tasks.md not found at ${p}`); }
    } },
  { id: 'ops.hyperagent', family: 'ops', label: 'HyperAgent evidence loop', signal: 'CLI imports + daemon scheduler tick fresh (<90min)',
    reuses: 'L0-HYPERAGENT',
    async run({ ctx, config, probes, includeHeavy }) {
      const deployed = await reuse(probes, 'L0-HYPERAGENT', { includeHeavy });
      if (deployed.status !== STATUS.WORKING) return deployed;
      let throttle;
      try {
        throttle = JSON.parse(await ctx.fsp.readFile(ctx.path.join(config.workspace, '.tmp', 'daemon-throttle.json'), 'utf8'));
      } catch (e) { return B(`HyperAgent scheduler state unreadable: ${e.message}`); }
      const lastTick = Number(throttle.lastHyperagentReflect);
      if (!Number.isFinite(lastTick) || lastTick <= 0) return B('HyperAgent scheduler has never ticked');
      const age = Date.now() - lastTick;
      let counts;
      try {
        counts = ctx.queryDb(config.stateDb, (db) => ({
          telemetry: db.prepare('SELECT COUNT(*) AS n FROM ha_telemetry').get().n,
          reflections: db.prepare('SELECT COUNT(*) AS n FROM ha_reflections').get().n,
          strategies: db.prepare('SELECT COUNT(*) AS n FROM ha_strategies WHERE active = 1').get().n,
        }));
      } catch (e) { return B(`HyperAgent tables unreadable: ${e.message}`); }
      const detail = `scheduler ${Math.round(age / 60000)}min ago; telemetry=${counts.telemetry} reflections=${counts.reflections} strategies=${counts.strategies}`;
      return age <= 90 * 60_000 ? W(detail) : B(`stale ${detail}`);
    } },
  { id: 'ops.calendar', family: 'ops', label: 'Calendar / scheduler', signal: '/api/scheduler/status reachable; no overdue triggers',
    timeoutMs: 4000,
    async run({ ctx }) {
      // Read-only GET /api/scheduler/status (does NOT dispatch — /tick does).
      // MC requires its session token on every /api method; the watcher reads the same 0600 file.
      const r = await ctx.httpGet('http://127.0.0.1:3000/api/scheduler/status', { timeoutMs: 3000, headers: mcAuthHeaders() }).catch((e) => ({ status: 0, error: e.message }));
      if (!r.status) return OFF('Mission Control not running on :3000 (scheduler surface)');
      if (r.status !== 200) return B(`/api/scheduler/status HTTP ${r.status}`);
      const s = r.json || {};
      if ((s.overdue || 0) > 0) return B(`${s.overdue} scheduled task(s) overdue >${s.graceMinutes ?? 30}min — scheduler tick not running?`, (s.overdueIds || []).join(','));
      return W(`scheduler reachable — ${s.scheduled?.at ?? 0} at + ${s.scheduled?.cron ?? 0} cron queued, ${s.ready ?? 0} ready, 0 overdue`);
    } },
  { id: 'ops.roadmap', family: 'ops', label: 'Workplan viewer :7892', signal: 'HTTP 200 + plans discovered',
    async run({ ctx }) {
      const r = await ctx.httpGet('http://127.0.0.1:7892/api/plans', { timeoutMs: 2000, headers: viewerAuthHeaders() }).catch((e) => ({ status: 0, error: e.message }));
      if (!r.status) return OFF('not listening (start workplan-viewer)');
      if (r.status !== 200) return B(`viewer HTTP ${r.status}`);
      return Array.isArray(r.json?.plans) ? W(`viewer authenticated; ${r.json.plans.length} plans discovered`) : B('viewer plan discovery response invalid');
    } },
  { id: 'ops.diagnostics', family: 'ops', label: 'Diagnostics (MC + health report)', signal: '/api/diagnostics 200 + .daemon-health.md fresh',
    async run({ ctx, config }) {
      const r = await ctx.httpGet('http://127.0.0.1:3000/api/diagnostics', { timeoutMs: 2500, headers: mcAuthHeaders() }).catch((e) => ({ status: 0, error: e.message }));
      const f = await fileFresh(ctx, ctx.path.join(config.workspace, '.daemon-health.md'), 5 * 60_000);
      const mc = r.status === 200 ? 'MC /api/diagnostics 200' : r.status ? `MC HTTP ${r.status}` : 'MC down';
      const health = f.exists ? (f.fresh ? `health-report fresh ${Math.round(f.age / 60000)}min` : `health-report STALE ${Math.round(f.age / 60000)}min`) : 'no health-report';
      if (r.status === 200 && f.exists && f.fresh) return W(`${mc}; ${health}`);
      if (!r.status && !f.exists) return OFF('MC down + no health report (diagnostics not running)');
      return B(`${mc}; ${health}`);
    } },

  // ── Node fabric ────────────────────────────────────────────────────────────
  { id: 'fabric.services', family: 'fabric', label: 'Core launchd services', signal: 'required ai.openclaw.* units have running PIDs',
    async run({ ctx }) {
      return probeCoreLaunchdServices(ctx);
    } },
  { id: 'fabric.deploy_drift', family: 'fabric', label: 'Deploy in sync (repo↔workspace)', signal: 'diff -rq lib empty',
    async run({ ctx, config }) {
      // cwd is meaningless under launchd (/) and self-comparing under a systemd
      // WorkingDirectory pointed at the workspace. Resolve the repo explicitly:
      // OPENCLAW_REPO_DIR, else the tree this module runs from.
      const repoDir = process.env.OPENCLAW_REPO_DIR || dirname(dirname(fileURLToPath(import.meta.url)));
      const repoLib = ctx.path.join(repoDir, 'lib');
      if (ctx.path.resolve(repoLib) === ctx.path.resolve(config.workspaceLib)) {
        return U('running from the workspace copy — set OPENCLAW_REPO_DIR to compare against the repo');
      }
      const r = await ctx.exec('diff', ['-rq', repoLib, config.workspaceLib], { timeoutMs: 8000 });
      if (r.code === 0) return W('repo lib == workspace lib (no drift)');
      if (/No such file|cannot/.test(r.stderr)) return U(`cannot compare: ${r.stderr.slice(0, 60)}`);
      return B(`drift: ${r.stdout.split('\n').filter(Boolean).length} differing entries`);
    } },
  { id: 'fabric.identity_config', family: 'fabric', label: 'Identity + token + config', signal: 'token 0600, identity keypair, configs parse',
    async run({ ctx, config }) {
      const issues = [];
      try { const st = await ctx.fsp.stat(config.injectToken); if (process.platform !== 'win32' && (st.mode & 0o077)) issues.push('token not 0600'); }
      catch { issues.push('inject token missing'); }
      try { await ctx.fsp.access(ctx.path.join(config.home, 'identity.key')); } catch { issues.push('identity.key missing'); }
      return issues.length ? B(issues.join('; ')) : W('token 0600 + identity keypair present');
    } },

  // ── Federation (step 6.3) ────────────────────────────────────────────────
  { id: 'fed.coordinator', family: 'federation', label: 'Grappe coordinator', signal: 'mesh-task-daemon launchd unit has a running PID',
    async run({ ctx }) {
      if (process.platform !== 'darwin') return U('coordinator process check is darwin-only here');
      return mapFed(gradeCoordinator(await launchdService(ctx, 'ai.openclaw.mesh-task-daemon')));
    } },
  { id: 'fed.cluster.quorum', family: 'federation', label: 'NATS bus quorum', signal: ':8222/jsz meta_cluster — raft leader elected ⇒ majority reachable',
    async run({ ctx }) {
      const jsz = await ctx.httpGet('http://127.0.0.1:8222/jsz', { timeoutMs: 2500 }).catch((e) => ({ status: 0, error: e.message }));
      if (!jsz.status) return mapFed(gradeClusterQuorum({ jszReachable: false }));
      // varz `connect_urls` is gossip AND includes self, so counting it cannot see
      // quorum loss (both peers dead still graded "2/3 up"). jsz.meta_cluster is the
      // raft view: a leader exists only while a majority is reachable.
      return mapFed(gradeClusterQuorum({
        jszReachable: true,
        jszParsed: !!jsz.json,
        metaCluster: jsz.json?.meta_cluster ?? null,
      }));
    } },
  { id: 'fed.grappe.members', family: 'federation', label: 'Grappe member heartbeats', signal: 'GRAPPE_REGISTRY members fresh in MESH_NODE_HEALTH',
    run: async () => mapFed(await probeGrappeMembers()) },
  { id: 'fed.session.liveness', family: 'federation', label: 'Collab session liveness', signal: 'no active MESH_COLLAB session stalled',
    run: async () => mapFed(await probeSessionLiveness()) },
];

async function dbIntegrity(ctx, dbPath) {
  try {
    return ctx.queryDb(dbPath, (db) => {
      const r = db.prepare('PRAGMA integrity_check').get();
      const ok = r && (r.integrity_check === 'ok' || Object.values(r)[0] === 'ok');
      return ok ? W('opens; integrity ok') : B(`integrity_check: ${JSON.stringify(r)}`);
    });
  } catch (e) {
    return /ENOENT|fileMustExist|unable to open/i.test(e.message) ? B(`absent/unopenable: ${e.message}`) : U(`probe error: ${e.message}`);
  }
}

// ── runner ──────────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 30000;
function withTimeout(p, ms) {
  let t;
  return Promise.race([Promise.resolve().then(() => p), new Promise((_, r) => { t = setTimeout(() => r(new Error(`timeout ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}

function lineOfId(lines, id) {
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(`id: '${id}'`)) return i + 1;
  return null;
}

/**
 * Raw source provenance for every check: the file:line where the check is
 * defined plus its literal code. Reused (acceptance) probes resolve to their
 * real definition in node-acceptance-probes.mjs. Best-effort (reads own source).
 * @returns {Object<string,{file:string,line:number|null,code:string}>}
 */
export function buildSourceMap(ctx, targets) {
  const here = dirname(fileURLToPath(import.meta.url));
  const watchSrc = readFileSync(join(here, 'node-watch.mjs'), 'utf8').split('\n');
  let probesSrc = [];
  try { probesSrc = readFileSync(join(here, 'node-acceptance-probes.mjs'), 'utf8').split('\n'); } catch { /* optional */ }
  const probeCode = {};
  try { for (const p of buildProbes(ctx)) probeCode[p.id] = String(p.run); } catch { /* optional */ }
  const map = {};
  for (const t of targets) {
    const code = String(t.run);
    const m = code.match(/reuse\(\s*probes\s*,\s*'([^']+)'/);
    if (m && probeCode[m[1]]) {
      map[t.id] = { file: 'lib/node-acceptance-probes.mjs', line: lineOfId(probesSrc, m[1]), code: probeCode[m[1]] };
    } else {
      map[t.id] = { file: 'lib/node-watch.mjs', line: lineOfId(watchSrc, t.id), code };
    }
  }
  return map;
}

/**
 * Probe every watch target once. Read-only. Injectable for tests via opts.ctx /
 * opts.healthCheckFn / opts.probes / opts.targets.
 */
export async function runWatch(opts = {}) {
  const config = opts.config || resolveNodeConfig();
  const includeHeavy = opts.includeHeavy ?? (opts.mode !== 'watch'); // one-shot probes heavy; watch loop skips unless asked
  const allTargets = opts.targets || WATCH_TARGETS;
  const targets = allTargets.filter((t) => !opts.axis || t.family === opts.axis);
  if (opts.axis && targets.length === 0) {
    // A typo'd axis must not become an observed-nothing ACCEPT (health 100, exit 0).
    const families = [...new Set(allTargets.map((t) => t.family))].join(', ');
    throw new Error(`unknown axis '${opts.axis}' — no watch targets match (families: ${families})`);
  }

  const ctx = opts.ctx || createRuntimeContext(config, { mutate: false });
  const hc = await (opts.healthCheckFn || runHealthCheck)(opts.checkOpts || {});
  const probes = opts.probes || indexById(buildProbes(ctx));
  const env = { ctx, config, hc, probes, includeHeavy };

  const results = [];
  try {
    for (const t of targets) {
      const start = performance.now();
      let v;
      try {
        if (t.applies && !(await t.applies(env))) v = OFF('not applicable on this node');
        else if (t.slow && !includeHeavy) v = U('not probed this cycle (heavy; run one-shot or --deep)');
        else {
          // a target reusing an acceptance probe inherits that probe's declared budget
          // (120s LLM probes were being clamped to the 30s default -> false UNKNOWN)
          const budget = t.timeoutMs || (t.reuses && probes[t.reuses]?.timeoutMs) || PROBE_TIMEOUT_MS;
          v = await withTimeout(t.run(env), budget);
        }
      } catch (e) { v = U(`probe error: ${e.message}`); }
      results.push({ id: t.id, family: t.family, label: t.label, signal: t.signal, ...v, latency_ms: Math.round(performance.now() - start) });
    }
  } finally {
    for (const fn of (ctx.teardown || [])) { try { await fn(); } catch { /* best-effort */ } }
  }

  // attach raw source provenance (file:line + code) to every check
  try {
    const sm = buildSourceMap(ctx, targets);
    for (const r of results) { const s = sm[r.id]; if (s) { r.source = `${s.file}:${s.line ?? '?'}`; r.code = s.code; } }
  } catch { /* source provenance is best-effort */ }

  const counts = countBy(results);
  return {
    meta: { nodeId: config.nodeId, mode: opts.mode || 'once', includeHeavy, timestamp: new Date().toISOString() },
    results, counts, health: healthPct(counts),
  };
}

/**
 * Global health %: WORKING / (WORKING+BROKEN+UNKNOWN). OFF is excluded
 * (intentionally off). Zero observations is null, never 100 — a run that
 * observed nothing has no health to report (honesty invariant).
 */
export function healthPct(counts = {}) {
  const applicable = (counts.WORKING || 0) + (counts.BROKEN || 0) + (counts.UNKNOWN || 0);
  return applicable > 0 ? Math.round(((counts.WORKING || 0) / applicable) * 100) : null;
}

function fmtHealth(h) { return h === null ? 'n/a (nothing observed)' : `${h}%`; }

function indexById(probeArr) { const m = {}; for (const p of probeArr) m[p.id] = p; return m; }
function countBy(results) {
  const c = { WORKING: 0, BROKEN: 0, OFF: 0, UNKNOWN: 0 };
  for (const r of results) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

// ── formatters ───────────────────────────────────────────────────────────────

const GLYPH = { WORKING: 'OK ', BROKEN: 'XX ', OFF: '-- ', UNKNOWN: '?? ' };

export function formatTable(report) {
  const { meta, results, counts } = report;
  const lines = [
    `Node Watch — node=${meta.nodeId} mode=${meta.mode}${meta.includeHeavy ? '' : ' (heavy probes skipped)'} — ${meta.timestamp}`,
    `HEALTH ${fmtHealth(report.health ?? healthPct(counts))}   (WORKING=${counts.WORKING}  BROKEN=${counts.BROKEN}  OFF=${counts.OFF}  UNKNOWN=${counts.UNKNOWN})`,
    '',
  ];
  let fam = null;
  for (const r of results) {
    if (r.family !== fam) { lines.push(`[${r.family}]`); fam = r.family; }
    lines.push(`  ${GLYPH[r.status]}${r.status.padEnd(7)} ${r.label.padEnd(30)} ${r.detail}`);
  }
  const broken = results.filter((r) => r.status === STATUS.BROKEN);
  lines.push('', broken.length ? `BROKEN: ${broken.map((r) => r.id).join(', ')}` : 'No BROKEN elements observed.');
  return lines.join('\n');
}

export function formatReport(report) {
  const { meta, results, counts } = report;
  const lines = [
    `# Node Watch Report`, ``,
    `**Node:** ${meta.nodeId}  **Mode:** ${meta.mode}  **Checked:** ${meta.timestamp}`,
    `**Health:** ${fmtHealth(report.health ?? healthPct(counts))}  ·  **Tally:** WORKING=${counts.WORKING} BROKEN=${counts.BROKEN} OFF=${counts.OFF} UNKNOWN=${counts.UNKNOWN}`,
    ``,
    `| Element | Family | Status | Signal | Detail | Latency |`,
    `|---|---|---|---|---|---|`,
  ];
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const r of results) {
    lines.push(`| ${r.label} | ${r.family} | ${r.status} | ${esc(r.signal)} | ${esc(r.detail)} | ${r.latency_ms}ms |`);
  }
  lines.push('');
  return lines.join('\n');
}

const STATUS_COLOR = { WORKING: '#1a7f37', BROKEN: '#cf222e', OFF: '#6e7781', UNKNOWN: '#9a6700' };
const htmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Self-contained HTML view: a dropdown of every checked item + its result, plus
 * a detail panel. No external resources (works offline). Embeds the report JSON.
 */
export function formatHtml(report) {
  const { meta, results, counts } = report;
  // group options by family into <optgroup>s; first BROKEN (else first) is preselected
  const families = [...new Set(results.map((r) => r.family))];
  const defaultIdx = Math.max(0, results.findIndex((r) => r.status === STATUS.BROKEN));
  const optgroups = families.map((fam) => {
    const opts = results
      .map((r, i) => [r, i])
      .filter(([r]) => r.family === fam)
      .map(([r, i]) => `<option value="${i}">${htmlEsc(`${r.status} — ${r.label}`)}</option>`)
      .join('');
    return `<optgroup label="${htmlEsc(fam)}">${opts}</optgroup>`;
  }).join('');
  const data = htmlEsc(JSON.stringify(results)).replace(/</g, '\\u003c');
  const tally = ['WORKING', 'BROKEN', 'OFF', 'UNKNOWN']
    .map((s) => `<span class="pill" style="background:${STATUS_COLOR[s]}">${s} ${counts[s]}</span>`).join(' ');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Node Watch — ${htmlEsc(meta.nodeId)}</title>
<style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:2rem;max-width:900px}
 h1{font-size:1.3rem;margin:0 0 .25rem} .sub{color:#6e7781;margin-bottom:1rem}
 .pill{color:#fff;border-radius:10px;padding:2px 8px;font-size:12px;white-space:nowrap}
 select{font:inherit;padding:.5rem;width:100%;max-width:560px}
 label{font-weight:600;display:block;margin:1rem 0 .35rem}
 #detail{margin-top:1rem;border:1px solid #d0d7de;border-radius:8px;padding:1rem}
 #detail .badge{color:#fff;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600}
 #detail dt{color:#6e7781;font-size:12px;text-transform:uppercase;margin-top:.6rem}
 #detail dd{margin:.1rem 0 0;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<h1>Node Watch — ${htmlEsc(meta.nodeId)}</h1>
<div class="sub">mode=${htmlEsc(meta.mode)} · ${htmlEsc(meta.timestamp)}<br>${tally}</div>
<label for="items">Items checked (${results.length}) — select to see result:</label>
<select id="items" size="1">${optgroups}</select>
<div id="detail"></div>
<script>
 const R = JSON.parse("${data}".replace(/\\u003c/g,'<'));
 const C = ${JSON.stringify(STATUS_COLOR)};
 const sel = document.getElementById('items'), det = document.getElementById('detail');
 function render(i){ const r = R[i]; if(!r){det.textContent='';return;}
   det.innerHTML = '<span class="badge" style="background:'+(C[r.status]||'#333')+'">'+r.status+'</span> <b>'+esc(r.label)+'</b>'
   + '<dl><dt>family</dt><dd>'+esc(r.family)+'</dd>'
   + '<dt>signal</dt><dd>'+esc(r.signal)+'</dd>'
   + '<dt>detail</dt><dd>'+esc(r.detail)+'</dd>'
   + (r.evidence?'<dt>evidence</dt><dd>'+esc(r.evidence)+'</dd>':'')
   + '<dt>latency</dt><dd>'+(r.latency_ms||0)+'ms</dd></dl>'; }
 function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
 sel.addEventListener('change', ()=>render(+sel.value));
 sel.value="${defaultIdx}"; render(${defaultIdx});
</script></body></html>`;
}
