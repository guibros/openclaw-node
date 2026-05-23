import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDLE_THRESHOLD_MS,
  HARD_CAP_MS,
  ANALYSIS_QUIET_MS,
  DEFAULT_INTERVAL_MS,
  isQueueIdle,
  isOllamaIdle,
  isSystemIdle,
  runScheduledCycle,
  createConsolidationScheduler,
} from '../bin/consolidation-scheduler.mjs';

// ─── Constants ──────────────────────────────────────────────────────────────

describe('consolidation-scheduler constants', () => {
  it('exports expected constant values', () => {
    assert.equal(IDLE_THRESHOLD_MS, 5 * 60 * 1000);
    assert.equal(HARD_CAP_MS, 5 * 60 * 1000);
    assert.equal(ANALYSIS_QUIET_MS, 60 * 1000);
    assert.equal(DEFAULT_INTERVAL_MS, 30 * 60 * 1000);
  });
});

// ─── isQueueIdle ────────────────────────────────────────────────────────────

describe('isQueueIdle', () => {
  it('returns idle when no current job, no pending, no recent activity', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, true);
    assert.equal(result.reason, null);
  });

  it('returns not idle when current job is running', () => {
    const state = {
      current_job: { type: 'extraction', elapsed_ms: 3000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('active extraction'));
  });

  it('returns not idle when pending jobs exist', () => {
    const state = {
      current_job: null,
      queue_depth: 2,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('2 pending'));
  });

  it('returns not idle when analysis fallback is recent', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [{ ts: Date.now() - 10_000, reason: 'analysis-wait-timeout' }],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('analysis activity'));
  });

  it('returns idle when fallbacks are older than ANALYSIS_QUIET_MS', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [{ ts: Date.now() - 120_000, reason: 'analysis-wait-timeout' }],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, true);
  });
});

// ─── isOllamaIdle ───────────────────────────────────────────────────────────

describe('isOllamaIdle', () => {
  it('returns true when Ollama is unreachable (graceful fallback)', async () => {
    // Port that is almost certainly not listening
    const result = await isOllamaIdle('http://127.0.0.1:19999');
    assert.equal(result, true);
  });
});

// ─── isSystemIdle ───────────────────────────────────────────────────────────

describe('isSystemIdle', () => {
  it('returns not idle when in-process queue reports busy', async () => {
    const getStateFn = () => ({
      current_job: { type: 'extraction', elapsed_ms: 1000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const result = await isSystemIdle({ getStateFn, ollamaBaseUrl: 'http://127.0.0.1:19999' });
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('active extraction'));
  });

  it('returns idle when queue is idle and Ollama unreachable', async () => {
    const getStateFn = () => ({
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const result = await isSystemIdle({ getStateFn, ollamaBaseUrl: 'http://127.0.0.1:19999' });
    assert.equal(result.idle, true);
  });
});

// ─── runScheduledCycle ──────────────────────────────────────────────────────

describe('runScheduledCycle', () => {
  it('runs a mock cycle successfully and returns ok + durationMs', async () => {
    const mockResult = { decayed: { decayedEntities: 3 }, durationMs: 100 };
    const result = await runScheduledCycle({
      hardCapMs: 5000,
      runCycle: async () => mockResult,
    });
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.result, mockResult);
    assert.ok(result.durationMs >= 0);
  });

  it('returns error when cycle exceeds hard cap', async () => {
    const result = await runScheduledCycle({
      hardCapMs: 50, // very short cap
      runCycle: async () => {
        await new Promise(r => setTimeout(r, 200)); // exceed cap
        return {};
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('hard cap'));
    assert.ok(result.durationMs >= 50);
  });

  it('returns error when cycle throws', async () => {
    const result = await runScheduledCycle({
      hardCapMs: 5000,
      runCycle: async () => { throw new Error('db crashed'); },
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('db crashed'));
  });
});

// ─── createConsolidationScheduler ───────────────────────────────────────────

describe('createConsolidationScheduler', () => {
  it('returns object with start, stop, runOnce', () => {
    const scheduler = createConsolidationScheduler({ log: () => {} });
    assert.equal(typeof scheduler.start, 'function');
    assert.equal(typeof scheduler.stop, 'function');
    assert.equal(typeof scheduler.runOnce, 'function');
    scheduler.stop(); // cleanup
  });

  it('runOnce skips when system is busy', async () => {
    const getStateFn = () => ({
      current_job: { type: 'extraction', elapsed_ms: 1000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const logs = [];
    const scheduler = createConsolidationScheduler({
      getStateFn,
      ollamaBaseUrl: 'http://127.0.0.1:19999',
      log: msg => logs.push(msg),
    });
    const result = await scheduler.runOnce();
    assert.equal(result.skipped, true);
    assert.ok(result.reason.includes('extraction'));
    assert.ok(logs.some(l => l.includes('skipping')));
  });
});
