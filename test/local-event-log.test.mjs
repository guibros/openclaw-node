/**
 * local-event-log.test.mjs — Unit tests for lib/local-event-log.mjs
 *
 * Tests buildMemoryEvent helper and MemoryBudget dual-write integration.
 * Uses mock event log (no live NATS required).
 *
 * Run: node --test test/local-event-log.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildMemoryEvent, canonicalNodeId, localEventStreamName, configuredLocalEventStreamName, localEventConsumerName, createLocalEventLog } from '../lib/local-event-log.mjs';
import { MemoryBudget } from '../lib/memory-budget.mjs';
import {
  MemoryEventSchema,
  SessionStartedSchema,
  SessionEndedSchema,
  FactExtractedSchema,
} from '../packages/event-schemas/dist/index.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-event-log-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildMemoryEvent ────────────────────────────────────

describe('buildMemoryEvent', () => {
  it('produces valid envelope fields', () => {
    const event = buildMemoryEvent(
      'memory.session_started',
      'sess-123',
      'session',
      { session_id: 'sess-123', start_time: new Date().toISOString(), session_type: 'daemon' },
      'test-node',
    );

    // UUID format for event_id
    assert.match(event.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // ISO timestamp
    assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    // idempotency_key defaults to event_id
    assert.equal(event.idempotency_key, event.event_id);
    // envelope fields
    assert.equal(event.event_type, 'memory.session_started');
    assert.equal(event.event_version, 1);
    assert.equal(event.entity_id, 'sess-123');
    assert.equal(event.entity_type, 'session');
    assert.equal(event.node_id, 'test-node');
    assert.deepEqual(event.actor, { type: 'system', id: 'daemon-test-node' });
    assert.equal(event.causation_id, null);
    assert.equal(event.correlation_id, null);
  });

  it('session_started event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.session_started',
      'sess-456',
      'session',
      { session_id: 'sess-456', start_time: new Date().toISOString(), session_type: 'interactive' },
      'node-a',
    );
    const result = SessionStartedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });

  it('session_ended event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.session_ended',
      'sess-456',
      'session',
      { session_id: 'sess-456', end_time: new Date().toISOString(), duration_ms: 60000, turn_count: 10 },
      'node-a',
    );
    const result = SessionEndedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });

  it('fact_extracted event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.fact_extracted',
      'sess-789',
      'session',
      { session_id: 'sess-789', fact: 'User prefers dark mode', category: 'preference', speaker: 'user' },
      'node-b',
    );
    const result = FactExtractedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });
});

describe('local event stream naming', () => {
  it('preserves a valid deployed node id', () => {
    assert.equal(localEventStreamName('moltymacs-virtual-machine'), 'local-events-moltymacs-virtual-machine');
  });

  it('maps the dotted macOS hostname to the deployed canonical node id', () => {
    assert.equal(canonicalNodeId('MoltyMacs-Virtual-Machine.local'), 'moltymacs-virtual-machine');
    assert.equal(localEventStreamName('MoltyMacs-Virtual-Machine.local'), 'local-events-moltymacs-virtual-machine');
  });

  it('rejects an empty node identity', () => {
    assert.throws(() => localEventStreamName('...'), /nodeId/);
  });

  it('keeps a persisted legacy stream while using the current node identity', () => {
    fs.writeFileSync(path.join(tmpDir, 'openclaw.env'), 'OPENCLAW_LOCAL_EVENT_STREAM=local-events-daedalus\n');
    assert.equal(configuredLocalEventStreamName('current-node', { OPENCLAW_HOME: tmpDir }), 'local-events-daedalus');
    assert.equal(localEventConsumerName('watcher', 'local-events-daedalus'), 'watcher-daedalus');
    assert.equal(localEventConsumerName('promoter', 'local-events-daedalus'), 'promoter-daedalus');
  });

  it('uses the current identity on a fresh node and rejects malformed overrides', () => {
    assert.equal(configuredLocalEventStreamName('current-node', { OPENCLAW_HOME: tmpDir }), 'local-events-current-node');
    assert.throws(
      () => configuredLocalEventStreamName('current-node', { OPENCLAW_HOME: tmpDir, OPENCLAW_LOCAL_EVENT_STREAM: 'MESH_TASKS' }),
      /OPENCLAW_LOCAL_EVENT_STREAM/,
    );
  });

  it('refuses a missing legacy override without creating a replacement stream', async () => {
    const previousHome = process.env.OPENCLAW_HOME;
    const previousOverride = process.env.OPENCLAW_LOCAL_EVENT_STREAM;
    process.env.OPENCLAW_HOME = tmpDir;
    process.env.OPENCLAW_LOCAL_EVENT_STREAM = 'local-events-daedalus';
    let adds = 0;
    const nc = { jetstreamManager: async () => ({ streams: {
      info: async () => { const error = new Error('stream not found'); error.code = '404'; throw error; },
      add: async () => { adds++; },
    } }) };
    try {
      await assert.rejects(() => createLocalEventLog(nc, 'current-node'), /configured local event stream .* missing/);
      assert.equal(adds, 0);
    } finally {
      if (previousHome === undefined) delete process.env.OPENCLAW_HOME;
      else process.env.OPENCLAW_HOME = previousHome;
      if (previousOverride === undefined) delete process.env.OPENCLAW_LOCAL_EVENT_STREAM;
      else process.env.OPENCLAW_LOCAL_EVENT_STREAM = previousOverride;
    }
  });

  it('creates a canonical stream on a fresh node', async () => {
    const previousHome = process.env.OPENCLAW_HOME;
    const previousOverride = process.env.OPENCLAW_LOCAL_EVENT_STREAM;
    process.env.OPENCLAW_HOME = tmpDir;
    delete process.env.OPENCLAW_LOCAL_EVENT_STREAM;
    let adds = 0;
    const nc = { jetstreamManager: async () => ({ streams: {
      info: async () => {
        if (!adds) { const error = new Error('stream not found'); error.code = '404'; throw error; }
        return { config: { subjects: ['local.>'], storage: 'file', num_replicas: 1 } };
      },
      add: async (config) => { assert.equal(config.name, 'local-events-current-node'); adds++; },
    } }), jetstream: () => ({}) };
    try {
      const log = await createLocalEventLog(nc, 'current-node');
      assert.equal(log.streamName, 'local-events-current-node');
      assert.equal(adds, 1);
    } finally {
      if (previousHome === undefined) delete process.env.OPENCLAW_HOME;
      else process.env.OPENCLAW_HOME = previousHome;
      if (previousOverride === undefined) delete process.env.OPENCLAW_LOCAL_EVENT_STREAM;
      else process.env.OPENCLAW_LOCAL_EVENT_STREAM = previousOverride;
    }
  });
});

// ── MemoryBudget dual-write ─────────────────────────────

describe('MemoryBudget dual-write', () => {
  it('calls publishLocal on startSession when eventLog provided', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const published = [];
    const mockEventLog = {
      publishLocal: async (event) => { published.push(event); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });
    mb.startSession();

    // Give fire-and-forget a tick to resolve
    await new Promise(r => setTimeout(r, 10));

    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'memory.session_started');
    assert.equal(published[0].entity_type, 'session');
    assert.ok(published[0].data.session_id);
    assert.equal(published[0].data.session_type, 'daemon');
  });

  it('calls publishLocal on endSession when eventLog provided', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const published = [];
    const mockEventLog = {
      publishLocal: async (event) => { published.push(event); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });
    mb.startSession();
    await new Promise(r => setTimeout(r, 10));
    published.length = 0; // clear startSession event

    mb.endSession();
    await new Promise(r => setTimeout(r, 10));

    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'memory.session_ended');
    assert.ok(published[0].data.duration_ms >= 0);
    assert.equal(published[0].data.turn_count, 0);
  });

  it('calls publishLocal on addEntry when eventLog provided', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const published = [];
    const mockEventLog = {
      publishLocal: async (event) => { published.push(event); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });
    mb.startSession();
    await new Promise(r => setTimeout(r, 10));
    published.length = 0;

    mb.addEntry('User prefers dark mode');
    await new Promise(r => setTimeout(r, 10));

    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'memory.fact_extracted');
    assert.equal(published[0].data.fact, 'User prefers dark mode');
    assert.equal(published[0].data.category, 'Recent');
    assert.equal(published[0].data.speaker, 'user');
  });

  it('works without eventLog (no errors)', () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const mb = new MemoryBudget(memFile);
    const frozen = mb.startSession();
    assert.equal(frozen, '# Memory\n');

    const result = mb.addEntry('test fact');
    assert.equal(result.added, true);

    mb.endSession();
    assert.equal(mb.isFrozen, false);
    // No errors thrown — this is the baseline behavior
  });

  it('publishLocal errors do not propagate to MemoryBudget callers', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const mockEventLog = {
      publishLocal: async () => { throw new Error('NATS connection lost'); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });

    // None of these should throw despite publishLocal errors
    const frozen = mb.startSession();
    assert.equal(typeof frozen, 'string');

    const result = mb.addEntry('another fact');
    assert.equal(result.added, true);

    mb.endSession();
    assert.equal(mb.isFrozen, false);

    // Give fire-and-forget promises time to settle
    await new Promise(r => setTimeout(r, 20));
  });
});

describe('R31 (repair 7.7): content samples are byte-capped', () => {
  it('an oversized decision text is rejected by the schema', async () => {
    const { MemoryEventSchema } = await import('../packages/event-schemas/dist/index.js');
    const event = buildMemoryEvent('memory.extracted', 's-cap', 'memory', {
      session_id: 's-cap', entities_count: 0, themes_count: 0, mentions_count: 0,
      decisions_count: 1, decision_texts: ['x'.repeat(10_000)],
      model: 'qwen3:8b', duration_ms: 1,
    }, 'daedalus');
    assert.throws(() => MemoryEventSchema.parse(event), /too_big|500/i);
  });

  it('a producer-truncated decision text passes', async () => {
    const { MemoryEventSchema } = await import('../packages/event-schemas/dist/index.js');
    const event = buildMemoryEvent('memory.extracted', 's-cap', 'memory', {
      session_id: 's-cap', entities_count: 0, themes_count: 0, mentions_count: 0,
      decisions_count: 1, decision_texts: ['x'.repeat(10_000).slice(0, 500)],
      model: 'qwen3:8b', duration_ms: 1,
    }, 'daedalus');
    assert.doesNotThrow(() => MemoryEventSchema.parse(event));
  });
});
