import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createExtractionStore, PROVENANCE_LOCAL } from '../lib/extraction-store.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('provenance fields on extraction store', () => {
  let store;
  let dbPath;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `provenance-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = createExtractionStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  const sampleResult = {
    entities: [{ name: 'NATS', type: 'technology', salience: 0.9 }],
    themes: [{ label: 'messaging', hierarchy: ['infrastructure', 'messaging'] }],
    actions: [],
    decisions: [{ decision: 'Use NATS JetStream', rationale: 'Event sourcing', confidence: 0.95 }],
    friction_signals: [],
    relationships: [],
  };

  it('provenance columns exist on entities table', () => {
    const db = new Database(dbPath, { readonly: true });
    const cols = db.pragma('table_info(entities)').map(c => c.name);
    db.close();
    assert.ok(cols.includes('source_type'), 'entities should have source_type');
    assert.ok(cols.includes('source_node'), 'entities should have source_node');
    assert.ok(cols.includes('source_event_id'), 'entities should have source_event_id');
  });

  it('provenance columns exist on themes table', () => {
    const db = new Database(dbPath, { readonly: true });
    const cols = db.pragma('table_info(themes)').map(c => c.name);
    db.close();
    assert.ok(cols.includes('source_type'), 'themes should have source_type');
    assert.ok(cols.includes('source_node'), 'themes should have source_node');
    assert.ok(cols.includes('source_event_id'), 'themes should have source_event_id');
  });

  it('provenance columns exist on mentions table', () => {
    const db = new Database(dbPath, { readonly: true });
    const cols = db.pragma('table_info(mentions)').map(c => c.name);
    db.close();
    assert.ok(cols.includes('source_type'), 'mentions should have source_type');
    assert.ok(cols.includes('source_node'), 'mentions should have source_node');
    assert.ok(cols.includes('source_event_id'), 'mentions should have source_event_id');
  });

  it('provenance columns exist on decisions table', () => {
    const db = new Database(dbPath, { readonly: true });
    const cols = db.pragma('table_info(decisions)').map(c => c.name);
    db.close();
    assert.ok(cols.includes('source_type'), 'decisions should have source_type');
    assert.ok(cols.includes('source_node'), 'decisions should have source_node');
    assert.ok(cols.includes('source_event_id'), 'decisions should have source_event_id');
  });

  it('storeExtractionResult without provenance defaults to local', () => {
    store.storeExtractionResult('session-1', sampleResult);

    const db = new Database(dbPath, { readonly: true });
    const entity = db.prepare('SELECT source_type, source_node, source_event_id FROM entities WHERE name = ?').get('NATS');
    const theme = db.prepare('SELECT source_type, source_node, source_event_id FROM themes WHERE label = ?').get('messaging');
    const decision = db.prepare('SELECT source_type, source_node, source_event_id FROM decisions WHERE session_id = ?').get('session-1');
    const mention = db.prepare('SELECT source_type, source_node, source_event_id FROM mentions WHERE session_id = ?').get('session-1');
    db.close();

    assert.equal(entity.source_type, 'local');
    assert.equal(entity.source_node, null);
    assert.equal(entity.source_event_id, null);
    assert.equal(theme.source_type, 'local');
    assert.equal(decision.source_type, 'local');
    assert.equal(mention.source_type, 'local');
  });

  it('storeExtractionResult with shared provenance stores provenance fields', () => {
    const sharedProvenance = {
      source_type: 'shared',
      source_node: 'node-beta',
      source_event_id: 'evt-abc123',
    };

    store.storeExtractionResult('session-shared-1', sampleResult, sharedProvenance);

    const db = new Database(dbPath, { readonly: true });
    const entity = db.prepare('SELECT source_type, source_node, source_event_id FROM entities WHERE name = ?').get('NATS');
    const theme = db.prepare('SELECT source_type, source_node, source_event_id FROM themes WHERE label = ?').get('messaging');
    const decision = db.prepare('SELECT source_type, source_node, source_event_id FROM decisions WHERE session_id = ?').get('session-shared-1');
    const mention = db.prepare('SELECT source_type, source_node, source_event_id FROM mentions WHERE session_id = ?').get('session-shared-1');
    db.close();

    assert.equal(entity.source_type, 'shared');
    assert.equal(entity.source_node, 'node-beta');
    assert.equal(entity.source_event_id, 'evt-abc123');
    assert.equal(theme.source_type, 'shared');
    assert.equal(theme.source_node, 'node-beta');
    assert.equal(decision.source_type, 'shared');
    assert.equal(decision.source_node, 'node-beta');
    assert.equal(decision.source_event_id, 'evt-abc123');
    assert.equal(mention.source_type, 'shared');
    assert.equal(mention.source_node, 'node-beta');
  });

  it('entities can be queried by source_type', () => {
    store.storeExtractionResult('session-local', sampleResult);
    store.storeExtractionResult('session-shared', {
      ...sampleResult,
      entities: [{ name: 'Redis', type: 'technology', salience: 0.8 }],
    }, { source_type: 'shared', source_node: 'node-gamma', source_event_id: 'evt-xyz' });

    const db = new Database(dbPath, { readonly: true });
    const localEntities = db.prepare('SELECT name FROM entities WHERE source_type = ?').all('local');
    const sharedEntities = db.prepare('SELECT name FROM entities WHERE source_type = ?').all('shared');
    db.close();

    assert.equal(localEntities.length, 1);
    assert.equal(localEntities[0].name, 'NATS');
    assert.equal(sharedEntities.length, 1);
    assert.equal(sharedEntities[0].name, 'Redis');
  });

  it('PROVENANCE_LOCAL constant has expected shape', () => {
    assert.equal(PROVENANCE_LOCAL.source_type, 'local');
    assert.equal(PROVENANCE_LOCAL.source_node, null);
    assert.equal(PROVENANCE_LOCAL.source_event_id, null);
    assert.ok(Object.isFrozen(PROVENANCE_LOCAL));
  });
});
