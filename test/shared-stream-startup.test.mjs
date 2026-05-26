/**
 * shared-stream-startup.test.mjs — Tests for shared stream startup verification
 *
 * Tests the verifySharedStreamConfig function and the ensure → inspect → verify
 * pipeline used by the memory daemon at startup.
 *
 * Run: node --test test/shared-stream-startup.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  SHARED_STREAM_NAME,
  SHARED_SUBJECTS,
  EXPECTED_REPLICAS,
  ensureSharedStream,
  inspectSharedStream,
  verifySharedStreamConfig,
} from '../lib/shared-event-stream.mjs';

const _require = createRequire(import.meta.url);
const { StorageType } = _require('nats');

// ── Mock helpers ─────────────────────────────────────────

function createMockNc({ streamExists = false, config = null } = {}) {
  const defaultConfig = {
    name: SHARED_STREAM_NAME,
    subjects: SHARED_SUBJECTS,
    num_replicas: 3,
    storage: StorageType.File,
  };

  const streamConfig = config || defaultConfig;

  return {
    jetstreamManager: async () => ({
      streams: {
        info: async (name) => {
          if (!streamExists) {
            throw new Error('stream not found');
          }
          return {
            config: streamConfig,
            state: { messages: 0, bytes: 0, consumer_count: 0 },
          };
        },
        add: async (addConfig) => {
          return {
            config: addConfig,
            state: { messages: 0, bytes: 0, consumer_count: 0 },
          };
        },
      },
    }),
  };
}

// ── EXPECTED_REPLICAS ────────────────────────────────────

describe('EXPECTED_REPLICAS', () => {
  it('equals 3', () => {
    assert.equal(EXPECTED_REPLICAS, 3);
  });
});

// ── verifySharedStreamConfig ─────────────────────────────

describe('verifySharedStreamConfig', () => {
  it('returns valid for correct R=3 + File storage', () => {
    const result = verifySharedStreamConfig({
      config: {
        num_replicas: 3,
        storage: StorageType.File,
      },
    });
    assert.equal(result.valid, true);
    assert.equal(result.reasons.length, 0);
  });

  it('returns invalid when num_replicas is not 3', () => {
    const result = verifySharedStreamConfig({
      config: {
        num_replicas: 1,
        storage: StorageType.File,
      },
    });
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 1);
    assert.ok(result.reasons[0].includes('num_replicas'));
    assert.ok(result.reasons[0].includes('1'));
  });

  it('returns invalid when storage is not File', () => {
    const result = verifySharedStreamConfig({
      config: {
        num_replicas: 3,
        storage: StorageType.Memory,
      },
    });
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 1);
    assert.ok(result.reasons[0].includes('storage'));
  });

  it('returns two reasons when both num_replicas and storage are wrong', () => {
    const result = verifySharedStreamConfig({
      config: {
        num_replicas: 1,
        storage: StorageType.Memory,
      },
    });
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 2);
  });

  it('handles flat config object (no nested config property)', () => {
    const result = verifySharedStreamConfig({
      num_replicas: 3,
      storage: StorageType.File,
    });
    assert.equal(result.valid, true);
  });

  it('handles undefined num_replicas as invalid', () => {
    const result = verifySharedStreamConfig({
      config: {
        storage: StorageType.File,
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons[0].includes('num_replicas'));
  });

  it('handles undefined storage as invalid', () => {
    const result = verifySharedStreamConfig({
      config: {
        num_replicas: 3,
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons[0].includes('storage'));
  });
});

// ── ensure → inspect → verify pipeline ──────────────────

describe('ensure → inspect → verify pipeline', () => {
  it('passes verification on correctly configured existing stream', async () => {
    const mock = createMockNc({ streamExists: true });
    await ensureSharedStream(mock);
    const info = await inspectSharedStream(mock);
    const result = verifySharedStreamConfig(info);
    assert.equal(result.valid, true);
  });

  it('passes verification on newly created stream', async () => {
    const mock = createMockNc({ streamExists: false });
    const ensureInfo = await ensureSharedStream(mock);
    const result = verifySharedStreamConfig(ensureInfo);
    assert.equal(result.valid, true);
  });

  it('fails verification on misconfigured existing stream', async () => {
    const mock = createMockNc({
      streamExists: true,
      config: {
        name: SHARED_STREAM_NAME,
        num_replicas: 1,
        storage: StorageType.Memory,
      },
    });
    await ensureSharedStream(mock);
    const info = await inspectSharedStream(mock);
    const result = verifySharedStreamConfig(info);
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 2);
  });
});
