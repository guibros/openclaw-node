import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createGraphCache, DEFAULT_DB_PATH, DEFAULT_REFRESH_INTERVAL_MS } from '../bin/obsidian-graph-cache.mjs';

describe('obsidian-graph-cache', () => {
  let tmpDir;
  let db;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'graph-cache-test-'));
    db = new Database(':memory:');
  });

  afterEach(async () => {
    try { db.close(); } catch { /* already closed */ }
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: write a concept note to the vault.
   */
  async function writeNote(subdir, name, frontmatter, body) {
    const dir = join(tmpDir, subdir);
    await mkdir(dir, { recursive: true });
    let content = '';
    if (frontmatter) {
      content += '---\n';
      for (const [k, v] of Object.entries(frontmatter)) {
        if (Array.isArray(v)) {
          content += `${k}:\n`;
          for (const item of v) content += `  - ${item}\n`;
        } else {
          content += `${k}: ${v}\n`;
        }
      }
      content += '---\n';
    }
    content += body || '';
    await writeFile(join(dir, `${name}.md`), content);
  }

  it('creates tables and indexes on init', () => {
    const cache = createGraphCache({ db, vaultPath: tmpDir });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    assert.ok(tables.includes('concept_graph_nodes'));
    assert.ok(tables.includes('concept_graph_edges'));
    assert.ok(tables.includes('graph_cache_meta'));

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_edges%'"
    ).all().map(r => r.name);
    assert.ok(indexes.includes('idx_edges_source'));
    assert.ok(indexes.includes('idx_edges_target'));
    cache.close();
  });

  it('populates cache from a vault with linked notes', async () => {
    await writeNote('concepts', 'nats', { type: 'concept', mention_count: 12 },
      'NATS is the messaging backbone. See also [[jetstream]] and [[memory-daemon]].');
    await writeNote('concepts', 'jetstream', { type: 'concept', mention_count: 8 },
      'JetStream provides persistent messaging on top of [[nats]].');
    await writeNote('concepts', 'memory-daemon', { type: 'concept', mention_count: 5 },
      'The memory daemon manages session lifecycle.');

    const cache = createGraphCache({ db, vaultPath: tmpDir });
    const result = await cache.refreshCache();

    assert.equal(result.nodeCount, 3);
    assert.equal(result.edgeCount, 3); // nats→jetstream, nats→memory-daemon, jetstream→nats
    assert.ok(result.refreshedAt);
    cache.close();
  });

  it('queryNeighbors returns correct edges and neighbors', async () => {
    await writeNote('concepts', 'alpha', null, 'Links to [[beta]] and [[gamma]].');
    await writeNote('concepts', 'beta', null, 'Links to [[alpha]].');
    await writeNote('concepts', 'gamma', null, 'Standalone note.');

    const cache = createGraphCache({ db, vaultPath: tmpDir });
    await cache.refreshCache();

    const result = cache.queryNeighbors('alpha');
    // alpha→beta, alpha→gamma (outgoing) + beta→alpha (incoming)
    assert.equal(result.edges.length, 3);
    assert.equal(result.neighbors.length, 2); // beta and gamma

    const outgoing = cache.queryNeighbors('alpha', { direction: 'outgoing' });
    assert.equal(outgoing.edges.length, 2);

    const incoming = cache.queryNeighbors('alpha', { direction: 'incoming' });
    assert.equal(incoming.edges.length, 1);
    assert.equal(incoming.edges[0].source_id, 'beta');
    cache.close();
  });

  it('getStats returns correct counts and lastRefreshAt', async () => {
    const cache = createGraphCache({ db, vaultPath: tmpDir });

    // Before refresh
    let stats = cache.getStats();
    assert.equal(stats.nodeCount, 0);
    assert.equal(stats.edgeCount, 0);
    assert.equal(stats.lastRefreshAt, null);

    // After refresh with empty vault
    await cache.refreshCache();
    stats = cache.getStats();
    assert.equal(stats.nodeCount, 0);
    assert.equal(stats.edgeCount, 0);
    assert.ok(stats.lastRefreshAt); // timestamp set even for empty vault
    cache.close();
  });

  it('refresh replaces stale data (full replacement)', async () => {
    await writeNote('concepts', 'old-node', null, 'Old content with [[old-link]].');

    const cache = createGraphCache({ db, vaultPath: tmpDir });
    await cache.refreshCache();

    let stats = cache.getStats();
    assert.equal(stats.nodeCount, 1);

    // Remove old note, add new one
    await rm(join(tmpDir, 'concepts', 'old-node.md'));
    await writeNote('concepts', 'new-node-a', null, 'New A links to [[new-node-b]].');
    await writeNote('concepts', 'new-node-b', null, 'New B is standalone.');

    await cache.refreshCache();

    stats = cache.getStats();
    assert.equal(stats.nodeCount, 2); // old-node gone, new-node-a + new-node-b
    const nodes = cache.getNodes();
    const nodeIds = nodes.map(n => n.id);
    assert.ok(!nodeIds.includes('old-node'));
    assert.ok(nodeIds.includes('new-node-a'));
    assert.ok(nodeIds.includes('new-node-b'));
    cache.close();
  });

  it('preserves edge types from frontmatter', async () => {
    await writeNote('concepts', 'derived-concept', {
      type: 'concept',
      edge_types: '{ "base-concept": "derived_from" }',
    }, 'This concept is derived from [[base-concept]].');
    await writeNote('concepts', 'base-concept', null, 'The base concept.');

    const cache = createGraphCache({ db, vaultPath: tmpDir });
    await cache.refreshCache();

    const edges = cache.getEdges();
    const derivedEdge = edges.find(e => e.source_id === 'derived-concept' && e.target_id === 'base-concept');
    assert.ok(derivedEdge);
    assert.equal(derivedEdge.edge_type, 'derived_from');
    cache.close();
  });

  it('initializes node weights to 1.0', async () => {
    await writeNote('concepts', 'weighted', { type: 'concept' }, 'A concept.');

    const cache = createGraphCache({ db, vaultPath: tmpDir });
    await cache.refreshCache();

    const nodes = cache.getNodes();
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].weight, 1.0);
    assert.equal(nodes[0].last_activated_at, null);
    cache.close();
  });

  it('handles empty vault gracefully', async () => {
    const cache = createGraphCache({ db, vaultPath: tmpDir });
    const result = await cache.refreshCache();

    assert.equal(result.nodeCount, 0);
    assert.equal(result.edgeCount, 0);

    const stats = cache.getStats();
    assert.equal(stats.nodeCount, 0);
    assert.equal(stats.edgeCount, 0);

    const neighbors = cache.queryNeighbors('nonexistent');
    assert.equal(neighbors.edges.length, 0);
    assert.equal(neighbors.neighbors.length, 0);
    cache.close();
  });

  it('exports constants with correct values', () => {
    assert.ok(DEFAULT_DB_PATH.endsWith('graph-cache.db'));
    assert.equal(DEFAULT_REFRESH_INTERVAL_MS, 600000); // 10 * 60 * 1000
  });

  it('startWatcher and stopWatcher lifecycle works without error', async () => {
    const cache = createGraphCache({ db, vaultPath: tmpDir });
    // Start and immediately stop — should not throw
    cache.startWatcher({ intervalMs: 60000, watchFs: false });
    cache.stopWatcher();
    cache.close();
  });
});
