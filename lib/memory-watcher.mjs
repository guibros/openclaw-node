import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';

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

function probeStore(Database, dbPath, queries) {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const result = {};
    for (const [key, sql] of Object.entries(queries)) {
      try {
        const row = db.prepare(sql).get();
        result[key] = row ? Object.values(row)[0] : 0;
      } catch { result[key] = null; }
    }
    result.wal_bytes = walSize(dbPath);
    return result;
  } finally {
    db.close();
  }
}

export async function runStoreHealthProbes(opts = {}) {
  const stateDb = opts.stateDb || DEFAULT_STATE_DB;
  const knowledgeDb = opts.knowledgeDb || DEFAULT_KNOWLEDGE_DB;
  const graphCacheDb = opts.graphCacheDb || DEFAULT_GRAPH_CACHE_DB;
  const workspaceLib = opts.workspaceLib || DEFAULT_WORKSPACE_LIB;
  const workspaceDaemon = opts.workspaceDaemon || DEFAULT_WORKSPACE_DAEMON;

  const Database = opts.Database || (await import('better-sqlite3')).default;

  const state = probeStore(Database, stateDb, {
    sessions: 'SELECT COUNT(*) FROM sessions',
    messages: 'SELECT COUNT(*) FROM messages',
    entities: 'SELECT COUNT(*) FROM entities',
    themes: 'SELECT COUNT(*) FROM themes',
    mentions: 'SELECT COUNT(*) FROM mentions',
    decisions: 'SELECT COUNT(*) FROM decisions',
    last_session: "SELECT MAX(start_time) FROM sessions",
  });

  const knowledge = probeStore(Database, knowledgeDb, {
    session_documents: 'SELECT COUNT(*) FROM session_documents',
    session_chunks: 'SELECT COUNT(*) FROM session_chunks',
    last_indexed: 'SELECT MAX(last_indexed) FROM session_documents',
  });

  const graph_cache = probeStore(Database, graphCacheDb, {
    nodes: 'SELECT COUNT(*) FROM concept_graph_nodes',
    edges: 'SELECT COUNT(*) FROM concept_graph_edges',
    last_refresh: "SELECT value FROM graph_cache_meta WHERE key = 'last_refresh_at'",
  });

  return {
    ts: new Date().toISOString(),
    op: 'health.probe',
    status: 'ok',
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
    case 'memory.extracted':  return (d.entities_count + d.themes_count + d.mentions_count + d.decisions_count) > 0 ? 'ok' : 'noop';
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
    status: classifyStatus(event),
    actor: event.actor?.id || null,
    session: event.data?.session_id || null,
    duration_ms: event.data?.duration_ms ?? null,
  };
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

  const processingLoop = (async () => {
    for await (const msg of iter) {
      if (!running) break;
      try {
        const event = JSON.parse(msg.string());
        const record = toWatcherRecord(event);
        fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
        msg.ack();
      } catch (e) {
        log(`watcher: failed to process message: ${e.message}`);
        msg.ack();
      }
    }
  })().catch(() => {});

  log(`Memory watcher initialized (consumer: ${consumerName}, output: ${outputPath})`);

  return {
    stop() {
      running = false;
      iter.stop();
      return processingLoop;
    },
  };
}
