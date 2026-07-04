/**
 * Tests for lib/extraction-store.mjs and the LLM extraction path in pre-compression-flush.mjs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { runFlush, USE_LLM_EXTRACTION } from '../lib/pre-compression-flush.mjs';

// Use a temporary database for each test
let tmpDir;
let store;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-store-test-'));
  store = createExtractionStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(() => {
  if (store) store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Mock ExtractionResult matching the schema
const mockExtractionResult = {
  entities: [
    { name: 'NATS JetStream', type: 'technology', salience: 0.9 },
    { name: 'Gui', type: 'person', salience: 0.7 },
  ],
  themes: [
    { label: 'Message queue configuration', hierarchy: ['infrastructure', 'messaging'] },
  ],
  actions: ['implementing', 'debugging'],
  decisions: [
    { decision: 'Use file storage for JetStream', rationale: 'Durability over speed', confidence: 0.85 },
  ],
  friction_signals: [
    { signal: 'WAL mode conflicts with concurrent writers', severity: 'medium' },
  ],
  relationships: [
    { source: 'NATS JetStream', target: 'Gui', type: 'depends_on' },
  ],
};

describe('createExtractionStore', () => {
  it('creates tables and returns a valid store object', () => {
    assert.equal(typeof store.storeExtractionResult, 'function');
    assert.equal(typeof store.generateMemoryContent, 'function');
    assert.equal(typeof store.getExtractionStats, 'function');
    assert.equal(typeof store.close, 'function');

    const stats = store.getExtractionStats();
    assert.equal(stats.entityCount, 0);
    assert.equal(stats.themeCount, 0);
    assert.equal(stats.mentionCount, 0);
    assert.equal(stats.decisionCount, 0);
  });

  it('storeExtractionResult populates all tables', () => {
    store.storeExtractionResult('session-001', mockExtractionResult);

    const stats = store.getExtractionStats();
    assert.equal(stats.entityCount, 2);
    assert.equal(stats.themeCount, 1);
    assert.equal(stats.mentionCount, 2);
    assert.equal(stats.decisionCount, 1);
  });

  it('storeExtractionResult populates turn_index when opts.turnIndex is provided', () => {
    store.storeExtractionResult('session-001', mockExtractionResult, undefined, { turnIndex: 42 });

    const mentions = store.db.prepare('SELECT turn_index FROM mentions WHERE session_id = ?').all('session-001');
    assert.equal(mentions.length, 2);
    for (const m of mentions) {
      assert.equal(m.turn_index, 42);
    }
  });

  it('storeExtractionResult leaves turn_index NULL when no opts provided', () => {
    store.storeExtractionResult('session-001', mockExtractionResult);

    const mentions = store.db.prepare('SELECT turn_index FROM mentions WHERE session_id = ?').all('session-001');
    assert.equal(mentions.length, 2);
    for (const m of mentions) {
      assert.equal(m.turn_index, null);
    }
  });

  it('storeExtractionResult upserts entities and increments mention_count', () => {
    store.storeExtractionResult('session-001', mockExtractionResult);
    store.storeExtractionResult('session-002', mockExtractionResult);

    const stats = store.getExtractionStats();
    // Entities remain 2 (upsert, not duplicate)
    assert.equal(stats.entityCount, 2);
    // Mentions accumulate (2 per call × 2 calls = 4)
    assert.equal(stats.mentionCount, 4);
    // Decisions accumulate (1 per call × 2 calls = 2)
    assert.equal(stats.decisionCount, 2);
  });

  it('re-extracting the same session is idempotent (D5: no mention/decision inflation)', () => {
    // The flush pipeline re-extracts the overlapping message tail every flush.
    // Storing the same result for the same session repeatedly must NOT grow
    // mentions/decisions or inflate entities.mention_count.
    store.storeExtractionResult('session-001', mockExtractionResult);
    store.storeExtractionResult('session-001', mockExtractionResult);
    store.storeExtractionResult('session-001', mockExtractionResult);

    const stats = store.getExtractionStats();
    assert.equal(stats.entityCount, 2);
    assert.equal(stats.mentionCount, 2, 'mentions must not duplicate on re-flush');
    assert.equal(stats.decisionCount, 1, 'decisions must not duplicate on re-flush');

    const counts = store.db.prepare('SELECT name, mention_count FROM entities ORDER BY name').all();
    for (const e of counts) {
      assert.equal(e.mention_count, 1, `${e.name} mention_count must equal distinct mentions, not flush count`);
    }
  });

  it('case/underscore variants of a name upsert into ONE entity (v4 canonical identity)', () => {
    store.storeExtractionResult('session-001', {
      ...mockExtractionResult,
      entities: [{ name: 'OpenClaw', type: 'project', salience: 0.9 }],
    });
    store.storeExtractionResult('session-002', {
      ...mockExtractionResult,
      entities: [{ name: 'openclaw', type: 'project', salience: 0.7 }],
    });
    store.storeExtractionResult('session-003', {
      ...mockExtractionResult,
      entities: [{ name: 'OPEN_CLAW', type: 'project', salience: 0.5 }],
    });

    const rows = store.db.prepare(`SELECT name, canonical_name, mention_count FROM entities WHERE canonical_name IN ('openclaw', 'open claw')`).all();
    // "OpenClaw"/"openclaw" merge; "OPEN_CLAW" canonicalizes to "open claw" (distinct words kept distinct)
    const openclaw = rows.find((r) => r.canonical_name === 'openclaw');
    assert.ok(openclaw);
    assert.equal(openclaw.name, 'OpenClaw', 'first-seen display name kept');
    assert.equal(openclaw.mention_count, 2, 'variant mentions accumulate on one entity');
  });

  it('v4 migration merges pre-existing case-variant entities (mentions re-pointed, counts recomputed)', () => {
    // Simulate a pre-v4 DB: distinct rows for case variants, version rolled back
    const db = store.db;
    db.prepare(`INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
                VALUES ('NATS', 'technology', 'NATS', 't1', 't2', 0)`).run();
    db.prepare(`INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
                VALUES ('nats', 'technology', 'nats', 't0', 't3', 0)`).run();
    const idA = db.prepare(`SELECT id FROM entities WHERE name = 'NATS'`).get().id;
    const idB = db.prepare(`SELECT id FROM entities WHERE name = 'nats'`).get().id;
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, 's-1', 0.8, 't1')`).run(idA);
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, 's-1', 0.8, 't1')`).run(idB); // duplicate of winner's mention post-merge
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, 's-2', 0.6, 't2')`).run(idA);
    db.prepare(`UPDATE entities SET mention_count = (SELECT COUNT(*) FROM mentions WHERE entity_id = entities.id)`).run();
    db.exec('DROP INDEX IF EXISTS idx_entities_canonical');
    db.pragma('user_version = 3');
    const dbPath = db.prepare('PRAGMA database_list').get().file;
    store.close();

    // Re-open: v4 runs
    store = createExtractionStore({ dbPath });
    const merged = store.db.prepare(`SELECT id, name, mention_count FROM entities WHERE canonical_name = 'nats'`).all();
    assert.equal(merged.length, 1, 'one row per canonical name');
    assert.equal(merged[0].name, 'NATS', 'highest-mention variant wins');
    assert.equal(merged[0].mention_count, 2, 'duplicate (session,turn) mention dropped; distinct one re-pointed');
    const orphan = store.db.prepare('SELECT COUNT(*) c FROM mentions WHERE entity_id NOT IN (SELECT id FROM entities)').get();
    assert.equal(orphan.c, 0, 'no orphaned mentions');
  });

  it('re-extracting a decision refreshes rationale/confidence instead of duplicating', () => {
    store.storeExtractionResult('session-001', mockExtractionResult);
    const updated = {
      ...mockExtractionResult,
      decisions: [{ decision: 'Use file storage for JetStream', rationale: 'Refined: durability + crash safety', confidence: 0.95 }],
    };
    store.storeExtractionResult('session-001', updated);

    const rows = store.db.prepare('SELECT rationale, confidence FROM decisions WHERE session_id = ?').all('session-001');
    assert.equal(rows.length, 1, 'same decision text in same session must not duplicate');
    assert.equal(rows[0].rationale, 'Refined: durability + crash safety');
    assert.equal(rows[0].confidence, 0.95);
  });

  it('generateMemoryContent produces formatted markdown', () => {
    store.storeExtractionResult('session-001', mockExtractionResult);

    const content = generateContentFromStore(store);
    assert.ok(content.includes('# Memory'));
    assert.ok(content.includes('## Active Entities'));
    assert.ok(content.includes('NATS JetStream'));
    assert.ok(content.includes('## Recent Decisions'));
    assert.ok(content.includes('Use file storage for JetStream'));
    assert.ok(content.includes('## Active Themes'));
    assert.ok(content.includes('Message queue configuration'));
  });

  it('generateMemoryContent returns minimal content when empty', () => {
    const content = store.generateMemoryContent(2200);
    assert.ok(content.includes('# Memory'));
    assert.ok(content.includes('No structured data extracted yet'));
  });

  it('generateMemoryContent respects character budget', () => {
    // Store enough data to potentially exceed a tiny budget
    store.storeExtractionResult('session-001', mockExtractionResult);
    const content = store.generateMemoryContent(200);
    assert.ok(content.length <= 200 + 50); // some tolerance for the trimming loop
  });
});

describe('runFlush with LLM extraction', () => {
  it('uses LLM path when llmClient and extractionStore are provided', async () => {
    // Create a minimal JSONL file in claude-code format (type + message wrapper)
    const jsonlPath = path.join(tmpDir, 'test-session.jsonl');
    const memoryMdPath = path.join(tmpDir, 'MEMORY.md');
    const messages = [
      { type: 'user', message: { role: 'user', content: "Let's configure NATS JetStream with file storage" }, timestamp: '2026-05-22T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: "I'll set up JetStream with file-backed storage for durability" }, timestamp: '2026-05-22T10:00:05Z' },
    ];
    fs.writeFileSync(jsonlPath, messages.map(m => JSON.stringify(m)).join('\n'));

    // Mock LLM client that returns a valid ExtractionResult
    const mockClient = {
      async generate() {
        return { content: JSON.stringify(mockExtractionResult), usage: null, finishReason: 'stop' };
      },
    };

    const result = await runFlush(jsonlPath, memoryMdPath, {
      vaultPath: path.join(tmpDir, 'vault'),
      charBudget: 2200,
      llmClient: mockClient,
      extractionStore: store,
    });

    assert.equal(result.flushed, true);
    assert.equal(result.mode, 'llm');
    assert.ok(result.facts > 0);

    // Verify MEMORY.md was written with structured content
    const memoryContent = fs.readFileSync(memoryMdPath, 'utf-8');
    assert.ok(memoryContent.includes('NATS JetStream'));
  });

  it('populates turn_index on mentions via runFlush pipeline', async () => {
    const jsonlPath = path.join(tmpDir, 'turn-idx-session.jsonl');
    const memoryMdPath = path.join(tmpDir, 'MEMORY.md');
    const messages = [
      { type: 'user', message: { role: 'user', content: 'Message one' }, timestamp: '2026-05-29T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Reply one' }, timestamp: '2026-05-29T10:00:05Z' },
      { type: 'user', message: { role: 'user', content: 'Message two' }, timestamp: '2026-05-29T10:00:10Z' },
    ];
    fs.writeFileSync(jsonlPath, messages.map(m => JSON.stringify(m)).join('\n'));

    const mockClient = {
      async generate() {
        return { content: JSON.stringify(mockExtractionResult), usage: null, finishReason: 'stop' };
      },
    };

    await runFlush(jsonlPath, memoryMdPath, {
      vaultPath: path.join(tmpDir, 'vault'),
      charBudget: 2200,
      llmClient: mockClient,
      extractionStore: store,
    });

    const mentions = store.db.prepare('SELECT turn_index FROM mentions').all();
    assert.equal(mentions.length, 2);
    for (const m of mentions) {
      // 3 messages, 0-based turns → last real turn is 2 (R5, repair 1.5:
      // the old stamp of messageCount pointed one past the end)
      assert.equal(m.turn_index, 2);
    }
  });

  it('skips re-extraction when the tail is unchanged (R4, repair 1.4)', async () => {
    const jsonlPath = path.join(tmpDir, 'dedup-session.jsonl');
    const memoryMdPath = path.join(tmpDir, 'MEMORY-dedup.md');
    const messages = [
      { type: 'user', message: { role: 'user', content: 'Dedup check message one' }, timestamp: '2026-06-02T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Dedup check reply' }, timestamp: '2026-06-02T10:00:05Z' },
    ];
    fs.writeFileSync(jsonlPath, messages.map(m => JSON.stringify(m)).join('\n'));

    let llmCalls = 0;
    const mockClient = {
      async generate() {
        llmCalls++;
        return { content: JSON.stringify(mockExtractionResult), usage: null, finishReason: 'stop' };
      },
    };
    const opts = { charBudget: 2200, llmClient: mockClient, extractionStore: store, vaultPath: path.join(tmpDir, 'vault') };

    const first = await runFlush(jsonlPath, memoryMdPath, opts);
    assert.equal(first.mode, 'llm');
    const mentionsAfterFirst = store.db.prepare(`SELECT COUNT(*) c FROM mentions WHERE session_id = 'dedup-session'`).get().c;
    const callsAfterFirst = llmCalls;

    const second = await runFlush(jsonlPath, memoryMdPath, opts);
    assert.equal(second.mode, 'llm-dedup');
    assert.equal(second.flushed, false);
    assert.equal(second.skipped, 1);
    assert.equal(second.extraction.entities_count, 0);
    assert.equal(llmCalls, callsAfterFirst);
    assert.equal(
      store.db.prepare(`SELECT COUNT(*) c FROM mentions WHERE session_id = 'dedup-session'`).get().c,
      mentionsAfterFirst
    );

    fs.appendFileSync(jsonlPath, '\n' + JSON.stringify(
      { type: 'user', message: { role: 'user', content: 'New content arrives' }, timestamp: '2026-06-02T10:01:00Z' }
    ));
    const third = await runFlush(jsonlPath, memoryMdPath, opts);
    assert.equal(third.mode, 'llm');
    assert.ok(
      store.db.prepare(`SELECT COUNT(*) c FROM mentions WHERE session_id = 'dedup-session'`).get().c > mentionsAfterFirst,
      'a grown tail must extract again'
    );
  });

  it('falls back to regex when LLM extraction fails', async () => {
    const jsonlPath = path.join(tmpDir, 'test-session.jsonl');
    const memoryMdPath = path.join(tmpDir, 'MEMORY.md');
    const messages = [
      { type: 'user', message: { role: 'user', content: "I prefer using NATS over RabbitMQ for messaging" }, timestamp: '2026-05-22T10:00:00Z' },
    ];
    fs.writeFileSync(jsonlPath, messages.map(m => JSON.stringify(m)).join('\n'));

    // Mock LLM client that throws an error
    const failingClient = {
      async generate() {
        throw new Error('LLM server unreachable');
      },
    };

    const result = await runFlush(jsonlPath, memoryMdPath, {
      vaultPath: path.join(tmpDir, 'vault'),
      charBudget: 2200,
      llmClient: failingClient,
      extractionStore: store,
    });

    assert.equal(result.flushed, true);
    assert.equal(result.mode, 'regex');
    // Regex should still extract the preference pattern
    assert.ok(result.facts > 0);
  });
});

describe('decisions_fts (schema v3)', () => {
  const matchCount = (q) =>
    store.db.prepare('SELECT COUNT(*) c FROM decisions_fts WHERE decisions_fts MATCH ?').get(q).c;

  it('indexes stored decisions and stays in sync on conflict-update and delete', () => {
    store.storeExtractionResult('fts-session', {
      entities: [], themes: [],
      decisions: [{ decision: 'Adopt JetStream', rationale: 'durable messaging needed', confidence: 0.9 }],
    });
    assert.equal(matchCount('"durable"'), 1);

    // Same (session, decision) re-stated → ON CONFLICT UPDATE path; the FTS
    // row must follow the new rationale, not keep the old one
    store.storeExtractionResult('fts-session', {
      entities: [], themes: [],
      decisions: [{ decision: 'Adopt JetStream', rationale: 'replicated persistence needed', confidence: 0.9 }],
    });
    assert.equal(matchCount('"durable"'), 0);
    assert.equal(matchCount('"replicated"'), 1);

    store.db.prepare(`DELETE FROM decisions WHERE session_id = 'fts-session'`).run();
    assert.equal(matchCount('"replicated"'), 0);
  });

  it('backfills pre-existing decisions on migration and reopens idempotently', () => {
    const dbPath = path.join(tmpDir, 'v3-migration.db');
    // Simulate a pre-v3 database: decisions exist, no FTS table
    {
      const first = createExtractionStore({ dbPath });
      first.storeExtractionResult('old-session', {
        entities: [], themes: [],
        decisions: [{ decision: 'Keep FTS local', rationale: 'no cloud dependency', confidence: 0.8 }],
      });
      first.db.exec(`
        DROP TRIGGER decisions_fts_ai; DROP TRIGGER decisions_fts_ad;
        DROP TRIGGER decisions_fts_au; DROP TABLE decisions_fts;
      `);
      first.db.pragma('user_version = 2');
      first.close();
    }
    for (let reopen = 0; reopen < 2; reopen++) {
      const s = createExtractionStore({ dbPath });
      assert.equal(
        s.db.prepare('SELECT COUNT(*) c FROM decisions_fts WHERE decisions_fts MATCH ?').get('"cloud"').c,
        1
      );
      s.close();
    }
  });
});

// Helper to call generateMemoryContent (avoids repeating the budget default)
function generateContentFromStore(s) {
  return s.generateMemoryContent(2200);
}
