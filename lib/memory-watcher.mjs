import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { openStore } from './sqlite-store.mjs';

const _require = createRequire(import.meta.url);

const STREAM_PREFIX = 'local-events';

const HOME = os.homedir();
const DEFAULT_STATE_DB = path.join(HOME, '.openclaw', 'state.db');
const DEFAULT_KNOWLEDGE_DB = path.join(HOME, '.openclaw', 'workspace', '.knowledge.db');
const DEFAULT_GRAPH_CACHE_DB = path.join(HOME, '.openclaw', 'graph-cache.db');
const DEFAULT_WORKSPACE_LIB = path.join(HOME, '.openclaw', 'workspace', 'lib');
const DEFAULT_WORKSPACE_DAEMON = path.join(HOME, '.openclaw', 'workspace', 'bin', 'memory-daemon.mjs');

function walSize(dbPath) {
  try { return fs.statSync(dbPath + '-wal').size; } catch { return 0; }
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function probeStore(dbPath, queries) {
  if (!fs.existsSync(dbPath)) return null;
  let db;
  try {
    db = openStore(dbPath, { readonly: true, integrityCheck: false });
    const result = {};
    for (const [key, sql] of Object.entries(queries)) {
      try {
        const row = db.prepare(sql).get();
        result[key] = row ? Object.values(row)[0] : 0;
      } catch { result[key] = null; }
    }
    result.wal_bytes = walSize(dbPath);
    return result;
  } catch {
    return null; // missing/locked/corrupt DB — surfaced as a degraded store, not a throw
  } finally {
    if (db) db.close();
  }
}

export async function runStoreHealthProbes(opts = {}) {
  const stateDb = opts.stateDb || DEFAULT_STATE_DB;
  const knowledgeDb = opts.knowledgeDb || DEFAULT_KNOWLEDGE_DB;
  const graphCacheDb = opts.graphCacheDb || DEFAULT_GRAPH_CACHE_DB;
  const workspaceLib = opts.workspaceLib || DEFAULT_WORKSPACE_LIB;
  const workspaceDaemon = opts.workspaceDaemon || DEFAULT_WORKSPACE_DAEMON;

  const state = probeStore(stateDb, {
    sessions: 'SELECT COUNT(*) FROM sessions',
    messages: 'SELECT COUNT(*) FROM messages',
    entities: 'SELECT COUNT(*) FROM entities',
    themes: 'SELECT COUNT(*) FROM themes',
    mentions: 'SELECT COUNT(*) FROM mentions',
    decisions: 'SELECT COUNT(*) FROM decisions',
    last_session: "SELECT MAX(start_time) FROM sessions",
  });

  const knowledge = probeStore(knowledgeDb, {
    session_documents: 'SELECT COUNT(*) FROM session_documents',
    session_chunks: 'SELECT COUNT(*) FROM session_chunks',
    last_indexed: 'SELECT MAX(last_indexed) FROM session_documents',
  });

  const graph_cache = probeStore(graphCacheDb, {
    nodes: 'SELECT COUNT(*) FROM concept_graph_nodes',
    edges: 'SELECT COUNT(*) FROM concept_graph_edges',
    last_refresh: "SELECT value FROM graph_cache_meta WHERE key = 'last_refresh_at'",
  });

  return {
    ts: new Date().toISOString(),
    op: 'health.probe',
    status: (state && knowledge && graph_cache) ? 'ok' : 'degraded',
    stores: { state, knowledge, graph_cache },
    drift: {
      lib_symlinked: isSymlink(workspaceLib),
      daemon_symlinked: isSymlink(workspaceDaemon),
    },
  };
}

export function classifyStatus(event) {
  const type = event.event_type;
  if (type === 'memory.error') return 'error';

  const d = event.data || {};
  switch (type) {
    case 'memory.ingested':   return d.messages_added > 0 ? 'ok' : 'noop';
    case 'memory.extracted':  return ((d.entities_count || 0) + (d.themes_count || 0) + (d.mentions_count || 0) + (d.decisions_count || 0)) > 0 ? 'ok' : 'noop';
    case 'memory.retrieved':  return d.results_count > 0 ? 'ok' : 'noop';
    case 'memory.injected':   return d.blocks_count > 0 ? 'ok' : 'noop';
    case 'memory.synthesized': return (d.artifacts_written?.length || 0) > 0 ? 'ok' : 'noop';
    case 'memory.decayed':    return d.entities_decayed > 0 ? 'ok' : 'noop';
    case 'memory.promoted':   return d.entities_promoted > 0 ? 'ok' : 'noop';
    default:                  return 'ok';
  }
}

export function toWatcherRecord(event) {
  return {
    ts: event.timestamp,
    op: event.event_type,
    // Stable row identity for UIs (repair 6.1) — index-keyed rows remounted
    // on every poll and expanded panels snapped shut.
    event_id: event.event_id || null,
    status: classifyStatus(event),
    actor: event.actor?.id || null,
    session: event.data?.session_id || null,
    duration_ms: event.data?.duration_ms ?? null,
    // Keep the full event payload so the watcher records WHAT each op did
    // (entity counts, written files, query results, promote/decay counts) —
    // not just that it ran. The panel renders a per-op summary from this.
    data: event.data || null,
  };
}

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_EXTRACTION_RATE_THRESHOLD = 0.5;
const DEFAULT_EXTRACTION_RATE_MIN_SAMPLE = 3;
const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000;

// R27 fix (repair 6.5): watcher.jsonl grew without bound (no rotation
// anywhere; the runtime log-rotate job is disabled). Size-capped with a
// single rotated generation; both appenders (watcher loop, daemon health
// probe) route through here.
export const WATCHER_MAX_BYTES = Number(process.env.OPENCLAW_WATCHER_MAX_BYTES) || 5 * 1024 * 1024;

export function appendWatcherRecord(outputPath, record, maxBytes = WATCHER_MAX_BYTES) {
  try {
    if (fs.statSync(outputPath).size >= maxBytes) {
      fs.renameSync(outputPath, `${outputPath}.1`);
    }
  } catch { /* no file yet */ }
  fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
}

export function createAnomalyDetector(opts = {}) {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const extractionRateThreshold = opts.extractionRateThreshold ?? DEFAULT_EXTRACTION_RATE_THRESHOLD;
  const extractionRateMinSample = opts.extractionRateMinSample ?? DEFAULT_EXTRACTION_RATE_MIN_SAMPLE;
  const staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  const recentEvents = [];
  const lastFired = {};

  function canFire(alertType) {
    const last = lastFired[alertType];
    if (!last) return true;
    return Date.now() - last >= cooldownMs;
  }

  function fired(alertType) {
    lastFired[alertType] = Date.now();
  }

  function buildAlert(alertType, detail, extra) {
    return {
      ts: new Date().toISOString(),
      op: 'watcher.alert',
      status: 'error',
      alert_type: alertType,
      detail,
      ...extra,
    };
  }

  function evaluate(record) {
    recentEvents.push(record);
    if (recentEvents.length > windowSize) recentEvents.shift();

    const alerts = [];

    if (record.op === 'memory.error' && canFire('extraction_failure')) {
      fired('extraction_failure');
      alerts.push(buildAlert(
        'extraction_failure',
        `memory.error at ${record.session || 'unknown session'}`,
        { session: record.session },
      ));
    }

    const extracted = recentEvents.filter(e => e.op === 'memory.extracted');
    if (extracted.length >= extractionRateMinSample) {
      const failures = extracted.filter(e => e.status === 'noop' || e.status === 'error');
      const rate = failures.length / extracted.length;
      if (rate >= extractionRateThreshold && canFire('extraction_failure_rate')) {
        fired('extraction_failure_rate');
        alerts.push(buildAlert(
          'extraction_failure_rate',
          `${failures.length}/${extracted.length} extractions failed (${(rate * 100).toFixed(0)}%)`,
          { window: { total: extracted.length, failures: failures.length, rate } },
        ));
      }
    }

    return alerts;
  }

  // R20 fix (repair 5.4): liveness = the WRITE pipeline's ops. Scheduler ops
  // (decayed/promoted) tick every 30 min regardless, and retrieval traffic
  // depends on bridge usage — counting either made a dead ingest/extract
  // pipeline undetectable.
  const PIPELINE_OPS = new Set(['memory.ingested', 'memory.extracted', 'memory.synthesized']);

  function evaluateStale() {
    if (!canFire('stalled')) return [];
    const lastEvent = recentEvents.findLast(e => PIPELINE_OPS.has(e.op));
    if (!lastEvent) return [];
    const age = Date.now() - new Date(lastEvent.ts).getTime();
    if (age >= staleThresholdMs) {
      fired('stalled');
      return [buildAlert(
        'stalled',
        `No memory events for ${Math.round(age / 60000)} minutes`,
        { last_event_ts: lastEvent.ts, age_ms: age },
      )];
    }
    return [];
  }

  return { evaluate, evaluateStale, _recentEvents: recentEvents, _lastFired: lastFired };
}

export async function createMemoryWatcher(nc, nodeId, opts = {}) {
  const outputPath = opts.outputPath || path.join(os.homedir(), '.openclaw', 'watcher.jsonl');
  const log = opts.log || (() => {});

  const streamName = `${STREAM_PREFIX}-${nodeId}`;
  const consumerName = `watcher-${nodeId}`;

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      deliver_policy: _require('nats').DeliverPolicy.All,
    });
  }

  const consumer = await js.consumers.get(streamName, consumerName);
  const iter = await consumer.consume();
  let running = true;
  const anomalyDetector = createAnomalyDetector(opts.anomaly || {});

  function writeRecord(record) {
    appendWatcherRecord(outputPath, record);
  }

  const processingLoop = (async () => {
    for await (const msg of iter) {
      if (!running) break;
      try {
        const event = JSON.parse(msg.string());
        const record = toWatcherRecord(event);
        writeRecord(record);
        const alerts = anomalyDetector.evaluate(record);
        for (const alert of alerts) {
          writeRecord(alert);
          log(`[watcher] ALERT: ${alert.alert_type} — ${alert.detail}`);
        }
        msg.ack();
      } catch (e) {
        log(`watcher: failed to process message: ${e.message}`);
        msg.ack();
      }
    }
  })().catch(() => {});

  const STALE_CHECK_INTERVAL = 5 * 60 * 1000;
  function runStaleCheck() {
    const alerts = anomalyDetector.evaluateStale();
    for (const alert of alerts) {
      writeRecord(alert);
      log(`[watcher] ALERT: ${alert.alert_type} — ${alert.detail}`);
    }
    return alerts;
  }
  const staleTimer = setInterval(runStaleCheck, STALE_CHECK_INTERVAL);

  log(`Memory watcher initialized (consumer: ${consumerName}, output: ${outputPath})`);

  return {
    anomalyDetector,
    checkStale: runStaleCheck,
    stop() {
      running = false;
      clearInterval(staleTimer);
      iter.stop();
      return processingLoop;
    },
  };
}
