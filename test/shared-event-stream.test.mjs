/**
 * shared-event-stream.test.mjs — Unit tests for lib/shared-event-stream.mjs
 *
 * Tests the shared JetStream stream configuration module.
 * Uses mock NATS connection (no live NATS cluster required).
 *
 * Run: node --test test/shared-event-stream.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  SHARED_STREAM_NAME,
  SHARED_SUBJECTS,
  ensureSharedStream,
  inspectSharedStream,
} from '../lib/shared-event-stream.mjs';

const _require = createRequire(import.meta.url);
const { StorageType } = _require('nats');

// ── Constants ────────────────────────────────────────────

describe('SHARED_STREAM_NAME', () => {
  it('equals OPENCLAW_SHARED', () => {
    assert.equal(SHARED_STREAM_NAME, 'OPENCLAW_SHARED');
  });
});

describe('SHARED_SUBJECTS', () => {
  it('contains all 7 federation subject patterns', () => {
    assert.equal(SHARED_SUBJECTS.length, 7);
  });

  it('includes kanban.events.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('kanban.events.>'));
  });

  it('includes lessons.shared.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('lessons.shared.>'));
  });

  it('includes concepts.shared.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('concepts.shared.>'));
  });

  it('includes context.broadcast.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('context.broadcast.>'));
  });

  it('includes context.offer.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('context.offer.>'));
  });

  it('includes context.accepted.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('context.accepted.>'));
  });

  it('includes artifacts.shared.>', () => {
    assert.ok(SHARED_SUBJECTS.includes('artifacts.shared.>'));
  });
});

// ── Mock helpers ─────────────────────────────────────────

function createMockNc({ streamExists = false, existingConfig = null } = {}) {
  const addCalls = [];
  const infoCalls = [];

  const mockStreamInfo = existingConfig || {
    config: {
      name: SHARED_STREAM_NAME,
      subjects: SHARED_SUBJECTS,
      num_replicas: 3,
      storage: StorageType.File,
    },
    state: {
      messages: 0,
      bytes: 0,
      consumer_count: 0,
    },
  };

  return {
    addCalls,
    infoCalls,
    jetstreamManager: async () => ({
      streams: {
        info: async (name) => {
          infoCalls.push(name);
          if (!streamExists) {
            const err = new Error('stream not found');
            err.code = '404';
            throw err;
          }
          return mockStreamInfo;
        },
        add: async (config) => {
          addCalls.push(config);
          return {
            config,
            state: { messages: 0, bytes: 0, consumer_count: 0 },
          };
        },
      },
    }),
  };
}

// ── ensureSharedStream ───────────────────────────────────

describe('ensureSharedStream', () => {
  it('creates stream with correct name when it does not exist', async () => {
    const mock = createMockNc({ streamExists: false });
    await ensureSharedStream(mock);

    assert.equal(mock.addCalls.length, 1);
    assert.equal(mock.addCalls[0].name, 'OPENCLAW_SHARED');
  });

  it('creates stream with num_replicas=3', async () => {
    const mock = createMockNc({ streamExists: false });
    await ensureSharedStream(mock);

    assert.equal(mock.addCalls[0].num_replicas, 3);
  });

  it('creates stream with all 7 subject patterns', async () => {
    const mock = createMockNc({ streamExists: false });
    await ensureSharedStream(mock);

    assert.deepEqual(mock.addCalls[0].subjects, SHARED_SUBJECTS);
  });

  it('creates stream with File storage', async () => {
    const mock = createMockNc({ streamExists: false });
    await ensureSharedStream(mock);

    assert.equal(mock.addCalls[0].storage, StorageType.File);
  });

  it('skips creation when stream already exists (idempotent)', async () => {
    const mock = createMockNc({ streamExists: true });
    const info = await ensureSharedStream(mock);

    assert.equal(mock.addCalls.length, 0, 'should not call streams.add');
    assert.equal(mock.infoCalls.length, 1);
    assert.equal(mock.infoCalls[0], 'OPENCLAW_SHARED');
    assert.ok(info.config);
  });
});

// ── inspectSharedStream ──────────────────────────────────

describe('inspectSharedStream', () => {
  it('returns config and state from existing stream', async () => {
    const mock = createMockNc({ streamExists: true });
    const result = await inspectSharedStream(mock);

    assert.ok(result.config, 'should have config');
    assert.ok(result.state, 'should have state');
    assert.equal(result.config.name, 'OPENCLAW_SHARED');
    assert.equal(result.config.num_replicas, 3);
  });

  it('throws when stream does not exist', async () => {
    const mock = createMockNc({ streamExists: false });
    await assert.rejects(
      () => inspectSharedStream(mock),
      { message: 'stream not found' },
    );
  });
});
