/**
 * obsidian-graph-cache.mjs — Adjacency cache for the Obsidian wikilink graph.
 *
 * Caches the output of buildGraph() into SQLite tables for fast
 * spreading-activation queries (Block 6 dependency).
 *
 * Tables:
 *   concept_graph_nodes(id, label, last_activated_at, weight)
 *   concept_graph_edges(source_id, target_id, edge_type, weight)
 *
 * Refresh cadence: every 10 min (configurable) or on filesystem change.
 *
 * Depends on:
 *   - lib/obsidian-graph.mjs (buildGraph)
 *   - lib/obsidian-vault.mjs (getVaultPath)
 *   - better-sqlite3 (existing dependency)
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { watch } from 'node:fs';
import Database from 'better-sqlite3';
import { buildGraph } from '../lib/obsidian-graph.mjs';
import { getVaultPath } from '../lib/obsidian-vault.mjs';

/** Default database path */
export const DEFAULT_DB_PATH = join(homedir(), '.openclaw', 'graph-cache.db');

/** Default refresh interval in milliseconds (10 minutes) */
export const DEFAULT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Initialize the SQLite database with graph cache tables and indexes.
 *
 * @param {import('better-sqlite3').Database} db
 */
function initDb(db) {
  // F-M20 fix: enable WAL so concurrent processes (daemon + --refresh CLI)
  // don't block each other.
  db.pragma('journal_mode = WAL');
  // F-P206 fix (F-N158 partial): without busy_timeout, a concurrent reader
  // (inject-server keeps its own handle) can cause the rebuild txn to throw
  // SQLITE_BUSY immediately. The startWatcher catch swallows that, but
  // until the next interval the cache reflects pre-failure state — the
  // same silent-disable failure mode F-N158 set out to fix. 5s matches
  // the rest of the codebase's busy_timeout convention.
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS concept_graph_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      last_activated_at TEXT,
      weight REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS concept_graph_edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'mentions',
      weight REAL DEFAULT 1.0
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON concept_graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON concept_graph_edges(target_id);
    -- F-C17 fix: dedupe edges so multiple wikilinks to same target don't
    -- accumulate duplicate rows that distort weight aggregations. Use
    -- INSERT OR REPLACE on top of this constraint (see insertEdge below).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
      ON concept_graph_edges(source_id, target_id, edge_type);

    CREATE TABLE IF NOT EXISTS graph_cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/**
 * Create a graph cache instance.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — SQLite database path (default: ~/.openclaw/graph-cache.db)
 * @param {import('better-sqlite3').Database} [opts.db] — existing DB instance (for testing)
 * @param {string} [opts.vaultPath] — vault path override
 * @returns {{ refreshCache: Function, queryNeighbors: Function, getNodes: Function, getEdges: Function, getStats: Function, startWatcher: Function, stopWatcher: Function, close: Function }}
 */
export function createGraphCache(opts = {}) {
  const dbPath = opts.dbPath || process.env.GRAPH_CACHE_DB_PATH || DEFAULT_DB_PATH;
  const db = opts.db || new Database(dbPath);
  const vaultPath = opts.vaultPath || getVaultPath();
  const ownsDb = !opts.db;

  initDb(db);

  // Prepared statements
  const insertNode = db.prepare(
    'INSERT OR REPLACE INTO concept_graph_nodes (id, label, last_activated_at, weight) VALUES (?, ?, ?, ?)'
  );
  // F-C17: use INSERT OR REPLACE so dedupe is enforced even if buildGraph
  // emits the same edge twice; weight is taken from the latest insert.
  const insertEdge = db.prepare(
    'INSERT OR REPLACE INTO concept_graph_edges (source_id, target_id, edge_type, weight) VALUES (?, ?, ?, ?)'
  );
  const clearNodes = db.prepare('DELETE FROM concept_graph_nodes');
  const clearEdges = db.prepare('DELETE FROM concept_graph_edges');
  const setMeta = db.prepare(
    'INSERT OR REPLACE INTO graph_cache_meta (key, value) VALUES (?, ?)'
  );
  const getMeta = db.prepare('SELECT value FROM graph_cache_meta WHERE key = ?');

  let intervalHandle = null;
  let fsWatcher = null;
  let refreshDebounceTimer = null;

  /**
   * Refresh the cache from the vault graph.
   * Full-replace strategy: clear all rows, then insert from buildGraph().
   */
  async function refreshCache() {
    const graph = await buildGraph(vaultPath);
    const now = new Date().toISOString();

    const runTransaction = db.transaction(() => {
      clearEdges.run();
      clearNodes.run();

      for (const [id, nodeData] of graph.nodes) {
        insertNode.run(id, nodeData.label || id, null, 1.0);
      }

      for (const edge of graph.edges) {
        insertEdge.run(edge.source, edge.target, edge.type || 'mentions', 1.0);
      }

      setMeta.run('last_refresh_at', now);
    });

    runTransaction();
    return { nodeCount: graph.nodes.size, edgeCount: graph.edges.length, refreshedAt: now };
  }

  /**
   * Query neighbors of a node (for spreading activation).
   * Returns edges where nodeId is either source or target, plus the neighbor node data.
   *
   * @param {string} nodeId
   * @param {object} [queryOpts]
   * @param {string} [queryOpts.direction] — 'outgoing', 'incoming', or 'both' (default)
   * @returns {{ edges: Array, neighbors: Array }}
   */
  function queryNeighbors(nodeId, queryOpts = {}) {
    const direction = queryOpts.direction || 'both';
    let edgeRows;

    if (direction === 'outgoing') {
      edgeRows = db.prepare(
        'SELECT source_id, target_id, edge_type, weight FROM concept_graph_edges WHERE source_id = ?'
      ).all(nodeId);
    } else if (direction === 'incoming') {
      edgeRows = db.prepare(
        'SELECT source_id, target_id, edge_type, weight FROM concept_graph_edges WHERE target_id = ?'
      ).all(nodeId);
    } else {
      edgeRows = db.prepare(
        'SELECT source_id, target_id, edge_type, weight FROM concept_graph_edges WHERE source_id = ? OR target_id = ?'
      ).all(nodeId, nodeId);
    }

    const neighborIds = new Set();
    for (const row of edgeRows) {
      if (row.source_id !== nodeId) neighborIds.add(row.source_id);
      if (row.target_id !== nodeId) neighborIds.add(row.target_id);
    }

    const neighbors = [];
    for (const nid of neighborIds) {
      const node = db.prepare(
        'SELECT id, label, last_activated_at, weight FROM concept_graph_nodes WHERE id = ?'
      ).get(nid);
      if (node) neighbors.push(node);
    }

    return { edges: edgeRows, neighbors };
  }

  /**
   * Get all cached nodes.
   * @returns {Array<{id: string, label: string, last_activated_at: string|null, weight: number}>}
   */
  function getNodes() {
    return db.prepare('SELECT id, label, last_activated_at, weight FROM concept_graph_nodes').all();
  }

  /**
   * Get all cached edges.
   * @returns {Array<{source_id: string, target_id: string, edge_type: string, weight: number}>}
   */
  function getEdges() {
    return db.prepare('SELECT source_id, target_id, edge_type, weight FROM concept_graph_edges').all();
  }

  /**
   * Get cache statistics.
   * @returns {{ nodeCount: number, edgeCount: number, lastRefreshAt: string|null }}
   */
  function getStats() {
    const nodeCount = db.prepare('SELECT COUNT(*) as cnt FROM concept_graph_nodes').get().cnt;
    const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM concept_graph_edges').get().cnt;
    const metaRow = getMeta.get('last_refresh_at');
    return {
      nodeCount,
      edgeCount,
      lastRefreshAt: metaRow ? metaRow.value : null,
    };
  }

  /**
   * Start the periodic refresh watcher.
   *
   * @param {object} [watchOpts]
   * @param {number} [watchOpts.intervalMs] — refresh interval (default: 10 min)
   * @param {boolean} [watchOpts.watchFs] — enable filesystem watching (default: true on macOS)
   */
  function startWatcher(watchOpts = {}) {
    const intervalMs = watchOpts.intervalMs
      || (process.env.GRAPH_CACHE_INTERVAL_MS ? parseInt(process.env.GRAPH_CACHE_INTERVAL_MS, 10) : DEFAULT_REFRESH_INTERVAL_MS);
    const watchFs = watchOpts.watchFs !== undefined ? watchOpts.watchFs : (process.platform === 'darwin');

    // Periodic timer
    intervalHandle = setInterval(async () => {
      try {
        await refreshCache();
      } catch (err) {
        // Log but don't crash — daemon must stay up
        process.stderr.write(`[graph-cache] refresh error: ${err.message}\n`);
      }
    }, intervalMs);

    // Filesystem watcher (macOS supports recursive; other platforms use timer-only)
    if (watchFs) {
      try {
        fsWatcher = watch(vaultPath, { recursive: true }, (_eventType, filename) => {
          if (!filename || !filename.endsWith('.md')) return;
          // Debounce: wait 2s after last change before refreshing
          if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
          refreshDebounceTimer = setTimeout(async () => {
            try {
              await refreshCache();
            } catch (err) {
              process.stderr.write(`[graph-cache] fs-triggered refresh error: ${err.message}\n`);
            }
          }, 2000);
        });
      } catch {
        // fs.watch may fail on some platforms — fall back to timer-only
      }
    }
  }

  /**
   * Stop the watcher and clean up resources.
   */
  function stopWatcher() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (fsWatcher) {
      fsWatcher.close();
      fsWatcher = null;
    }
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = null;
    }
  }

  /**
   * Close the database connection and stop watchers.
   */
  function close() {
    stopWatcher();
    if (ownsDb) {
      db.close();
    }
  }

  return {
    refreshCache,
    queryNeighbors,
    getNodes,
    getEdges,
    getStats,
    startWatcher,
    stopWatcher,
    close,
  };
}

// --- CLI entry ---

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('obsidian-graph-cache.mjs') ||
  process.argv[1].endsWith('obsidian-graph-cache')
);

if (isMainModule) {
  const args = process.argv.slice(2);
  const statsMode = args.includes('--stats');
  const refreshMode = args.includes('--refresh');

  const cache = createGraphCache();

  if (statsMode) {
    // --stats: print stats and exit
    const stats = cache.getStats();
    process.stdout.write(`Graph cache stats:\n`);
    process.stdout.write(`  Nodes: ${stats.nodeCount}\n`);
    process.stdout.write(`  Edges: ${stats.edgeCount}\n`);
    process.stdout.write(`  Last refresh: ${stats.lastRefreshAt || 'never'}\n`);
    cache.close();
  } else if (refreshMode) {
    // --refresh: single refresh and exit
    cache.refreshCache().then(result => {
      process.stdout.write(`Refreshed: ${result.nodeCount} nodes, ${result.edgeCount} edges at ${result.refreshedAt}\n`);
      cache.close();
    }).catch(err => {
      process.stderr.write(`Refresh failed: ${err.message}\n`);
      cache.close();
      process.exit(1);
    });
  } else {
    // Daemon mode: initial refresh + periodic watcher
    process.stdout.write(`[graph-cache] starting daemon...\n`);

    cache.refreshCache().then(result => {
      process.stdout.write(`[graph-cache] initial refresh: ${result.nodeCount} nodes, ${result.edgeCount} edges\n`);
      cache.startWatcher();
      process.stdout.write(`[graph-cache] watcher started (interval: ${DEFAULT_REFRESH_INTERVAL_MS / 1000}s)\n`);
    }).catch(err => {
      process.stderr.write(`[graph-cache] initial refresh failed: ${err.message}\n`);
      // Start watcher anyway — next interval may succeed
      cache.startWatcher();
    });

    // Graceful shutdown
    const shutdown = () => {
      process.stdout.write(`[graph-cache] shutting down...\n`);
      cache.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
