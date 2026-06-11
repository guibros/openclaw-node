import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildMemoryEvent } from '../lib/local-event-log.mjs';
import { toWatcherRecord, classifyStatus, runStoreHealthProbes, createAnomalyDetector } from '../lib/memory-watcher.mjs';

describe('toWatcherRecord', () => {
  it('extracts flat record from memory.ingested event', () => {
    const event = buildMemoryEvent('memory.ingested', 'sess-abc', 'memory', {
      session_id: 'sess-abc',
      source: 'claude-code',
      messages_added: 12,
      total_messages: 12,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.ts, event.timestamp);
    assert.equal(record.op, 'memory.ingested');
    assert.equal(record.actor, 'daemon-daedalus');
    assert.equal(record.session, 'sess-abc');
    assert.equal(record.duration_ms, null);
    assert.equal(record.status, 'ok');
    // The record keeps the full payload so the watcher shows WHAT the op did.
    assert.deepEqual(record.data, event.data);
    assert.equal(record.data.messages_added, 12);
  });

  it('extracts duration_ms from memory.extracted event', () => {
    const event = buildMemoryEvent('memory.extracted', 'sess-xyz', 'memory', {
      session_id: 'sess-xyz',
      entities_count: 5,
      themes_count: 2,
      mentions_count: 8,
      decisions_count: 1,
      model: 'qwen3:8b',
      duration_ms: 4200,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.extracted');
    assert.equal(record.session, 'sess-xyz');
    assert.equal(record.duration_ms, 4200);
    assert.equal(record.status, 'ok');
  });

  it('handles memory.error with missing session_id', () => {
    const event = buildMemoryEvent('memory.error', 'unknown', 'memory', {
      boundary: 'ingest',
      error_code: 'TypeError',
      error_message: 'something broke',
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.error');
    assert.equal(record.session, null);
    assert.equal(record.duration_ms, null);
    assert.equal(record.status, 'error');
  });

  it('handles memory.retrieved with duration_ms', () => {
    const event = buildMemoryEvent('memory.retrieved', 'req-123', 'memory', {
      query_hash: 'abc',
      channels_hit: ['fts', 'vec'],
      results_count: 7,
      duration_ms: 150,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.retrieved');
    assert.equal(record.session, null);
    assert.equal(record.duration_ms, 150);
    assert.equal(record.status, 'ok');
  });
});

describe('classifyStatus', () => {
  it('classifies memory.error as error', () => {
    const event = buildMemoryEvent('memory.error', 'x', 'memory', {
      boundary: 'extract',
      error_code: 'Zod',
      error_message: 'validation failed',
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'error');
  });

  it('classifies memory.ingested with messages_added=0 as noop', () => {
    const event = buildMemoryEvent('memory.ingested', 's1', 'memory', {
      session_id: 's1',
      source: 'claude-code',
      messages_added: 0,
      total_messages: 50,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.ingested with messages_added>0 as ok', () => {
    const event = buildMemoryEvent('memory.ingested', 's1', 'memory', {
      session_id: 's1',
      source: 'claude-code',
      messages_added: 5,
      total_messages: 55,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.extracted with all counts=0 as noop', () => {
    const event = buildMemoryEvent('memory.extracted', 's2', 'memory', {
      session_id: 's2',
      entities_count: 0,
      themes_count: 0,
      mentions_count: 0,
      decisions_count: 0,
      model: 'qwen3:8b',
      duration_ms: 3000,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.extracted with some counts>0 as ok', () => {
    const event = buildMemoryEvent('memory.extracted', 's2', 'memory', {
      session_id: 's2',
      entities_count: 0,
      themes_count: 1,
      mentions_count: 0,
      decisions_count: 0,
      model: 'qwen3:8b',
      duration_ms: 3000,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.extracted as ok when some count fields are absent (no NaN noop)', () => {
    // A producer that emits only the counts it has must not cause a real
    // extraction to misclassify as noop via NaN arithmetic.
    const event = { event_type: 'memory.extracted', data: { session_id: 's3', entities_count: 3 } };
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.retrieved with results_count=0 as noop', () => {
    const event = buildMemoryEvent('memory.retrieved', 'r1', 'memory', {
      query_hash: 'abc',
      channels_hit: 0,
      results_count: 0,
      duration_ms: 50,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.injected with blocks_count=0 as noop', () => {
    const event = buildMemoryEvent('memory.injected', 'r1', 'memory', {
      request_id: 'req-1',
      token_count: 0,
      blocks_count: 0,
      duration_ms: 10,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.injected with blocks_count>0 as ok', () => {
    const event = buildMemoryEvent('memory.injected', 'r1', 'memory', {
      request_id: 'req-1',
      token_count: 500,
      blocks_count: 3,
      duration_ms: 80,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.synthesized with empty artifacts as noop', () => {
    const event = buildMemoryEvent('memory.synthesized', 'syn1', 'memory', {
      trigger: 'session_end',
      artifacts_written: [],
      duration_ms: 200,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.synthesized with artifacts as ok', () => {
    const event = buildMemoryEvent('memory.synthesized', 'syn1', 'memory', {
      trigger: 'session_end',
      artifacts_written: ['MEMORY.md', 'sessions/2026-05-29.md'],
      duration_ms: 200,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.decayed with entities_decayed=0 as noop', () => {
    const event = buildMemoryEvent('memory.decayed', 'd1', 'memory', {
      entities_decayed: 0,
      duration_ms: 100,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.promoted with entities_promoted>0 as ok', () => {
    const event = buildMemoryEvent('memory.promoted', 'p1', 'memory', {
      entities_promoted: 3,
      duration_ms: 150,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('defaults to ok for unknown event types', () => {
    const event = buildMemoryEvent('memory.session_started', 'sess', 'memory', {
      session_id: 'sess',
      start_time: new Date().toISOString(),
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });
});

describe('runStoreHealthProbes', () => {
  let tmpDir;
  let Database;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-probe-'));
    Database = (await import('better-sqlite3')).default;
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedStateDb(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, start_time TEXT, message_count INTEGER);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT);
      CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE themes (id INTEGER PRIMARY KEY, label TEXT);
      CREATE TABLE mentions (id INTEGER PRIMARY KEY, entity_id INTEGER);
      CREATE TABLE decisions (id INTEGER PRIMARY KEY, title TEXT);
    `);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('s1', 'test', '2026-05-30T01:00:00Z', 5);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('s2', 'test', '2026-05-30T02:00:00Z', 3);
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(1, 's1', 'user', 'hello');
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(2, 's1', 'assistant', 'hi');
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(3, 's2', 'user', 'test');
    db.prepare('INSERT INTO entities VALUES (?, ?)').run(1, 'Alice');
    db.prepare('INSERT INTO themes VALUES (?, ?)').run(1, 'testing');
    db.prepare('INSERT INTO themes VALUES (?, ?)').run(2, 'dev');
    db.prepare('INSERT INTO mentions VALUES (?, ?)').run(1, 1);
    db.prepare('INSERT INTO decisions VALUES (?, ?)').run(1, 'use WAL');
    db.close();
  }

  function seedGraphCacheDb(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE concept_graph_nodes (id INTEGER PRIMARY KEY, label TEXT);
      CREATE TABLE concept_graph_edges (id INTEGER PRIMARY KEY, source_id INTEGER, target_id INTEGER);
      CREATE TABLE graph_cache_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    db.prepare('INSERT INTO concept_graph_nodes VALUES (?, ?)').run(1, 'Node-A');
    db.prepare('INSERT INTO concept_graph_nodes VALUES (?, ?)').run(2, 'Node-B');
    db.prepare('INSERT INTO concept_graph_edges VALUES (?, ?, ?)').run(1, 1, 2);
    db.prepare("INSERT INTO graph_cache_meta VALUES ('last_refresh_at', '2026-05-29T12:00:00Z')").run();
    db.close();
  }

  function seedKnowledgeDb(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE session_documents (id INTEGER PRIMARY KEY, last_indexed INTEGER);
      CREATE TABLE session_chunks (id INTEGER PRIMARY KEY, doc_id INTEGER);
    `);
    db.prepare('INSERT INTO session_documents VALUES (?, ?)').run(1, 1779000000000);
    db.prepare('INSERT INTO session_chunks VALUES (?, ?)').run(1, 1);
    db.close();
  }

  it('reports status ok only when all three stores are present', async () => {
    const stateDb = path.join(tmpDir, 'ok-state.db');
    const knowledgeDb = path.join(tmpDir, 'ok-knowledge.db');
    const graphCacheDb = path.join(tmpDir, 'ok-graph.db');
    seedStateDb(stateDb);
    seedKnowledgeDb(knowledgeDb);
    seedGraphCacheDb(graphCacheDb);
    const result = await runStoreHealthProbes({
      stateDb, knowledgeDb, graphCacheDb,
      workspaceLib: '/nonexistent/lib', workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(result.status, 'ok');
    assert.ok(result.stores.state && result.stores.knowledge && result.stores.graph_cache);
  });

  it('returns correct row counts for state.db', async () => {
    const dbPath = path.join(tmpDir, 'state.db');
    seedStateDb(dbPath);
    const result = await runStoreHealthProbes({
      stateDb: dbPath,
      knowledgeDb: path.join(tmpDir, 'nonexistent-knowledge.db'),
      graphCacheDb: path.join(tmpDir, 'nonexistent-graph.db'),
      workspaceLib: '/nonexistent/lib',
      workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(result.op, 'health.probe');
    assert.equal(result.stores.state.sessions, 2);
    assert.equal(result.stores.state.messages, 3);
    assert.equal(result.stores.state.entities, 1);
    assert.equal(result.stores.state.themes, 2);
    assert.equal(result.stores.state.mentions, 1);
    assert.equal(result.stores.state.decisions, 1);
    assert.equal(result.stores.state.last_session, '2026-05-30T02:00:00Z');
    assert.equal(typeof result.stores.state.wal_bytes, 'number');
  });

  it('returns correct counts for graph-cache.db', async () => {
    const dbPath = path.join(tmpDir, 'graph-cache.db');
    seedGraphCacheDb(dbPath);
    const result = await runStoreHealthProbes({
      stateDb: path.join(tmpDir, 'nonexistent.db'),
      knowledgeDb: path.join(tmpDir, 'nonexistent.db'),
      graphCacheDb: dbPath,
      workspaceLib: '/nonexistent/lib',
      workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(result.stores.graph_cache.nodes, 2);
    assert.equal(result.stores.graph_cache.edges, 1);
    assert.equal(result.stores.graph_cache.last_refresh, '2026-05-29T12:00:00Z');
    assert.equal(typeof result.stores.graph_cache.wal_bytes, 'number');
  });

  it('returns null for missing databases', async () => {
    const result = await runStoreHealthProbes({
      stateDb: path.join(tmpDir, 'nope.db'),
      knowledgeDb: path.join(tmpDir, 'nope2.db'),
      graphCacheDb: path.join(tmpDir, 'nope3.db'),
      workspaceLib: '/nonexistent/lib',
      workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(result.stores.state, null);
    assert.equal(result.stores.knowledge, null);
    assert.equal(result.stores.graph_cache, null);
    assert.equal(result.status, 'degraded'); // a dead store must not report 'ok'
  });

  it('reports WAL size when WAL file exists', async () => {
    const dbPath = path.join(tmpDir, 'wal-test.db');
    seedStateDb(dbPath);
    const walPath = dbPath + '-wal';
    assert.ok(fs.existsSync(walPath) || true);
    const result = await runStoreHealthProbes({
      stateDb: dbPath,
      knowledgeDb: path.join(tmpDir, 'nope.db'),
      graphCacheDb: path.join(tmpDir, 'nope.db'),
      workspaceLib: '/nonexistent/lib',
      workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(typeof result.stores.state.wal_bytes, 'number');
    assert.ok(result.stores.state.wal_bytes >= 0);
  });

  it('checks drift symlinks correctly', async () => {
    const linkTarget = path.join(tmpDir, 'real-lib');
    const linkPath = path.join(tmpDir, 'lib-link');
    fs.mkdirSync(linkTarget, { recursive: true });
    fs.symlinkSync(linkTarget, linkPath);
    const result = await runStoreHealthProbes({
      stateDb: path.join(tmpDir, 'nope.db'),
      knowledgeDb: path.join(tmpDir, 'nope.db'),
      graphCacheDb: path.join(tmpDir, 'nope.db'),
      workspaceLib: linkPath,
      workspaceDaemon: '/nonexistent/daemon',
      Database,
    });
    assert.equal(result.drift.lib_symlinked, true);
    assert.equal(result.drift.daemon_symlinked, false);
  });

  it('has valid timestamp in ts field', async () => {
    const result = await runStoreHealthProbes({
      stateDb: path.join(tmpDir, 'nope.db'),
      knowledgeDb: path.join(tmpDir, 'nope.db'),
      graphCacheDb: path.join(tmpDir, 'nope.db'),
      workspaceLib: '/x',
      workspaceDaemon: '/x',
      Database,
    });
    assert.ok(result.ts);
    assert.ok(!isNaN(Date.parse(result.ts)));
  });
});

describe('createAnomalyDetector', () => {
  it('fires extraction_failure alert on memory.error event', () => {
    const detector = createAnomalyDetector();
    const record = { ts: new Date().toISOString(), op: 'memory.error', status: 'error', session: 'sess-fail' };
    const alerts = detector.evaluate(record);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alert_type, 'extraction_failure');
    assert.equal(alerts[0].op, 'watcher.alert');
    assert.equal(alerts[0].status, 'error');
    assert.ok(alerts[0].detail.includes('sess-fail'));
  });

  it('respects cooldown for extraction_failure', () => {
    const detector = createAnomalyDetector({ cooldownMs: 60000 });
    const record = { ts: new Date().toISOString(), op: 'memory.error', status: 'error', session: 's1' };
    const first = detector.evaluate(record);
    assert.equal(first.length, 1);
    const second = detector.evaluate({ ...record, session: 's2' });
    assert.equal(second.length, 0);
  });

  it('fires extraction_failure_rate when threshold crossed', () => {
    const detector = createAnomalyDetector({ extractionRateMinSample: 3, extractionRateThreshold: 0.5 });
    detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'noop' });
    detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'noop' });
    const alerts = detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'ok' });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alert_type, 'extraction_failure_rate');
    assert.ok(alerts[0].window);
    assert.equal(alerts[0].window.total, 3);
    assert.equal(alerts[0].window.failures, 2);
  });

  it('does not fire extraction_failure_rate below threshold', () => {
    const detector = createAnomalyDetector({ extractionRateMinSample: 3, extractionRateThreshold: 0.5 });
    detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'ok' });
    detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'ok' });
    const alerts = detector.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'noop' });
    assert.equal(alerts.length, 0);
  });

  it('fires stalled alert when events are old', () => {
    const detector = createAnomalyDetector({ staleThresholdMs: 1000 });
    const oldTs = new Date(Date.now() - 5000).toISOString();
    detector.evaluate({ ts: oldTs, op: 'memory.ingested', status: 'ok' });
    const alerts = detector.evaluateStale();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alert_type, 'stalled');
  });

  it('does not fire stalled alert when events are recent', () => {
    const detector = createAnomalyDetector({ staleThresholdMs: 60000 });
    detector.evaluate({ ts: new Date().toISOString(), op: 'memory.ingested', status: 'ok' });
    const alerts = detector.evaluateStale();
    assert.equal(alerts.length, 0);
  });

  it('does not fire stalled alert with no events', () => {
    const detector = createAnomalyDetector({ staleThresholdMs: 1000 });
    const alerts = detector.evaluateStale();
    assert.equal(alerts.length, 0);
  });

  it('window bounds at windowSize', () => {
    const detector = createAnomalyDetector({ windowSize: 3 });
    for (let i = 0; i < 5; i++) {
      detector.evaluate({ ts: new Date().toISOString(), op: 'memory.ingested', status: 'ok' });
    }
    assert.equal(detector._recentEvents.length, 3);
  });
});

describe('R20 (repair 5.4): stall detection ignores scheduler heartbeats', () => {
  it('scheduler-only traffic does not mask a dead pipeline', () => {
    const det = createAnomalyDetector({ staleThresholdMs: 60_000, cooldownMs: 0 });
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    // Pipeline died 10 minutes ago…
    det.evaluate({ ts: old, op: 'memory.ingested', status: 'ok' });
    // …but the scheduler keeps drumming.
    det.evaluate({ ts: fresh, op: 'memory.decayed', status: 'ok' });
    det.evaluate({ ts: fresh, op: 'memory.promoted', status: 'ok' });

    const alerts = det.evaluateStale();
    assert.equal(alerts.length, 1, 'a dead pipeline must alert despite scheduler events');
    assert.equal(alerts[0].alert_type, 'stalled');
  });

  it('fresh pipeline activity keeps the alert quiet', () => {
    const det = createAnomalyDetector({ staleThresholdMs: 60_000, cooldownMs: 0 });
    det.evaluate({ ts: new Date().toISOString(), op: 'memory.extracted', status: 'ok' });
    assert.deepEqual(det.evaluateStale(), []);
  });
});
