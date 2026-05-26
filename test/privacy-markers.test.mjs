import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createExtractionStore, PROVENANCE_LOCAL } from '../lib/extraction-store.mjs';
import { parsePublishDirective, PUBLISH_DIRECTIVE_REGEX } from '../lib/memory-directives.mjs';
import { filterPrivateResults } from '../lib/retrieval-pipeline.mjs';
import { lookupItem, listPublishedItems } from '../bin/publish-item.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDbPath() {
  return path.join(os.tmpdir(), `privacy-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function seedStore(store) {
  // Insert sample extraction result with entities, themes, decisions
  store.storeExtractionResult('session-1', {
    entities: [
      { name: 'NATS', type: 'technology', salience: 0.9 },
      { name: 'OpenClaw', type: 'project', salience: 0.8 },
    ],
    themes: [{ label: 'federation', hierarchy: ['infrastructure'] }],
    decisions: [{
      decision: 'Use NATS JetStream',
      rationale: 'Cross-node messaging',
      confidence: 0.95,
    }],
    actions: [],
    friction_signals: [],
    relationships: [],
  });

  store.storeExtractionResult('session-2', {
    entities: [
      { name: 'Ollama', type: 'technology', salience: 0.7 },
    ],
    themes: [{ label: 'llm-extraction', hierarchy: ['ai'] }],
    decisions: [],
    actions: [],
    friction_signals: [],
    relationships: [],
  });
}

// ─── Privacy Migration Tests ──────────────────────────────────────────────────

describe('Privacy migration', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = createExtractionStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('adds private column to entities with default 1', () => {
    const cols = store.db.pragma('table_info(entities)');
    const privateCol = cols.find(c => c.name === 'private');
    assert.ok(privateCol, 'private column exists on entities');
    assert.equal(privateCol.dflt_value, '1', 'default value is 1');
  });

  it('adds private column to decisions with default 1', () => {
    const cols = store.db.pragma('table_info(decisions)');
    const privateCol = cols.find(c => c.name === 'private');
    assert.ok(privateCol, 'private column exists on decisions');
    assert.equal(privateCol.dflt_value, '1', 'default value is 1');
  });

  it('adds private column to themes with default 1', () => {
    const cols = store.db.pragma('table_info(themes)');
    const privateCol = cols.find(c => c.name === 'private');
    assert.ok(privateCol, 'private column exists on themes');
    assert.equal(privateCol.dflt_value, '1', 'default value is 1');
  });

  it('creates published_items table', () => {
    const tables = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='published_items'"
    ).all();
    assert.equal(tables.length, 1, 'published_items table exists');
  });

  it('newly stored entities default to private=1', () => {
    seedStore(store);
    const entity = store.db.prepare('SELECT private FROM entities WHERE name = ?').get('NATS');
    assert.equal(entity.private, 1, 'new entities are private by default');
  });

  it('newly stored decisions default to private=1', () => {
    seedStore(store);
    const decision = store.db.prepare('SELECT private FROM decisions LIMIT 1').get();
    assert.equal(decision.private, 1, 'new decisions are private by default');
  });

  it('newly stored themes default to private=1', () => {
    seedStore(store);
    const theme = store.db.prepare('SELECT private FROM themes WHERE label = ?').get('federation');
    assert.equal(theme.private, 1, 'new themes are private by default');
  });
});

// ─── Publish/Unpublish API Tests ──────────────────────────────────────────────

describe('publishItem / unpublishItem / isItemPublished', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = createExtractionStore({ dbPath });
    seedStore(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('publishItem sets private=0 and adds to published_items', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity', 'session-pub');

    const updated = store.db.prepare('SELECT private FROM entities WHERE id = ?').get(entity.id);
    assert.equal(updated.private, 0, 'entity is now public');
    assert.ok(store.isItemPublished(entity.id, 'entity'), 'item is in published_items');
  });

  it('unpublishItem sets private=1 and removes from published_items', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity');
    store.unpublishItem(entity.id, 'entity');

    const updated = store.db.prepare('SELECT private FROM entities WHERE id = ?').get(entity.id);
    assert.equal(updated.private, 1, 'entity is private again');
    assert.ok(!store.isItemPublished(entity.id, 'entity'), 'item removed from published_items');
  });

  it('isItemPublished returns false for unpublished item', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    assert.ok(!store.isItemPublished(entity.id, 'entity'));
  });

  it('getPublishedItems returns published items list', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity', 'sess-1');

    const items = store.getPublishedItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].item_type, 'entity');
    assert.equal(items[0].item_id, entity.id);
  });

  it('publishItem works for themes', () => {
    const theme = store.db.prepare('SELECT id FROM themes WHERE label = ?').get('federation');
    store.publishItem(theme.id, 'theme');

    const updated = store.db.prepare('SELECT private FROM themes WHERE id = ?').get(theme.id);
    assert.equal(updated.private, 0);
    assert.ok(store.isItemPublished(theme.id, 'theme'));
  });

  it('publishItem works for decisions', () => {
    const decision = store.db.prepare('SELECT id FROM decisions LIMIT 1').get();
    store.publishItem(decision.id, 'decision');

    const updated = store.db.prepare('SELECT private FROM decisions WHERE id = ?').get(decision.id);
    assert.equal(updated.private, 0);
    assert.ok(store.isItemPublished(decision.id, 'decision'));
  });

  it('publishItem is idempotent (re-publish updates published_at)', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity', 'sess-1');
    store.publishItem(entity.id, 'entity', 'sess-2');

    const items = store.getPublishedItems();
    assert.equal(items.length, 1, 'still one entry after re-publish');
    assert.equal(items[0].published_by_session, 'sess-2', 'session updated');
  });

  it('publishItem throws on unknown type', () => {
    assert.throws(() => store.publishItem(1, 'unknown'), /Unknown item type/);
  });
});

// ─── @publish Directive Tests ─────────────────────────────────────────────────

describe('parsePublishDirective', () => {
  it('parses unquoted @publish directive', () => {
    const result = parsePublishDirective('hello @publish nats world');
    assert.equal(result.name, 'nats');
    assert.equal(result.cleanedText, 'hello world');
  });

  it('parses quoted @publish directive', () => {
    const result = parsePublishDirective('testing @publish "my entity name" here');
    assert.equal(result.name, 'my entity name');
    assert.equal(result.cleanedText, 'testing here');
  });

  it('returns null name when no directive present', () => {
    const result = parsePublishDirective('just a normal message');
    assert.equal(result.name, null);
    assert.equal(result.cleanedText, 'just a normal message');
  });

  it('handles empty/null input gracefully', () => {
    assert.equal(parsePublishDirective('').name, null);
    assert.equal(parsePublishDirective(null).name, null);
  });

  it('is case-insensitive', () => {
    const result = parsePublishDirective('@PUBLISH nats');
    assert.equal(result.name, 'nats');
  });

  it('PUBLISH_DIRECTIVE_REGEX matches expected patterns', () => {
    assert.ok(PUBLISH_DIRECTIVE_REGEX.test('@publish nats'));
    assert.ok(PUBLISH_DIRECTIVE_REGEX.test('@publish "multi word"'));
    assert.ok(!PUBLISH_DIRECTIVE_REGEX.test('@memory off'));
  });
});

// ─── lookupItem Tests ─────────────────────────────────────────────────────────

describe('lookupItem', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = createExtractionStore({ dbPath });
    seedStore(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('finds entity by case-insensitive name', () => {
    const item = lookupItem(store.db, 'nats', 'entity');
    assert.ok(item);
    assert.equal(item.name, 'NATS');
  });

  it('finds theme by case-insensitive label', () => {
    const item = lookupItem(store.db, 'Federation', 'theme');
    assert.ok(item);
    assert.equal(item.name, 'federation');
  });

  it('returns null for non-existent item', () => {
    const item = lookupItem(store.db, 'nonexistent', 'entity');
    assert.equal(item, null);
  });
});

// ─── listPublishedItems Tests ─────────────────────────────────────────────────

describe('listPublishedItems', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = createExtractionStore({ dbPath });
    seedStore(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('returns enriched list with entity names', () => {
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity');

    const items = listPublishedItems(store.db);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'NATS');
    assert.equal(items[0].item_type, 'entity');
  });
});

// ─── filterPrivateResults Tests ───────────────────────────────────────────────

describe('filterPrivateResults', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = createExtractionStore({ dbPath });
    seedStore(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('filters sessions with only private entities', () => {
    const results = [
      { chunk_id: 1, session_id: 'session-1', score: 0.9, snippet: 'test' },
      { chunk_id: 2, session_id: 'session-2', score: 0.8, snippet: 'test2' },
    ];

    // All entities are private (default) — sessions with mentions get filtered
    const filtered = filterPrivateResults(results, store.db);
    assert.equal(filtered.length, 0, 'all sessions with private-only entities are filtered');
  });

  it('keeps sessions with at least one public entity', () => {
    // Publish one entity in session-1
    const entity = store.db.prepare('SELECT id FROM entities WHERE name = ?').get('NATS');
    store.publishItem(entity.id, 'entity');

    const results = [
      { chunk_id: 1, session_id: 'session-1', score: 0.9, snippet: 'test' },
      { chunk_id: 2, session_id: 'session-2', score: 0.8, snippet: 'test2' },
    ];

    const filtered = filterPrivateResults(results, store.db);
    assert.equal(filtered.length, 1, 'session with public entity kept');
    assert.equal(filtered[0].session_id, 'session-1');
  });

  it('keeps sessions with no entity mentions at all', () => {
    const results = [
      { chunk_id: 1, session_id: 'session-unknown', score: 0.9, snippet: 'no entities' },
    ];

    const filtered = filterPrivateResults(results, store.db);
    assert.equal(filtered.length, 1, 'session with no mentions is kept');
  });

  it('returns all results when extractionDb is null', () => {
    const results = [{ chunk_id: 1, session_id: 's1', score: 0.5, snippet: 'x' }];
    const filtered = filterPrivateResults(results, null);
    assert.equal(filtered.length, 1);
  });

  it('returns empty array for empty results', () => {
    const filtered = filterPrivateResults([], store.db);
    assert.equal(filtered.length, 0);
  });
});
