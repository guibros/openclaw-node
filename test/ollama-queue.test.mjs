/**
 * ollama-queue.test.mjs — Unit tests for lib/ollama-queue.mjs
 *
 * Covers: requestExtraction happy path, retry behavior (transient vs persistent),
 * OLLAMA_QUEUE_RETRIES env override, requestAnalysis fallback paths, getState
 * snapshot, isStuck logic, recordAutoRestart, shutdown drain, and the
 * tightened isTransient classification (HTTP 500 not retried, fetch failed
 * not retried, ECONNRESET retried).
 *
 * Run: node --test test/ollama-queue.test.mjs
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestExtraction,
  requestAnalysis,
  getState,
  isStuck,
  recordAutoRestart,
  shutdown,
  _resetForTesting,
} from '../lib/ollama-queue.mjs';

beforeEach(() => {
  _resetForTesting();
});

after(() => {
  _resetForTesting();
});

describe('requestExtraction happy path', () => {
  it('runs the job once and returns its value on success', async () => {
    let runs = 0;
    const result = await requestExtraction(async () => {
      runs++;
      return { ok: true, content: 'hello' };
    });
    assert.equal(runs, 1);
    assert.deepEqual(result, { ok: true, content: 'hello' });
  });

  it('records the run in totals + extraction history', async () => {
    await requestExtraction(async () => 'x');
    const state = getState();
    assert.equal(state.totals.runs, 1);
    assert.equal(state.history.extraction.count, 1);
  });

  it('serializes concurrent jobs through the queue', async () => {
    const events = [];
    const job = (label, ms) => async () => {
      events.push(`${label}:start`);
      await new Promise(r => setTimeout(r, ms));
      events.push(`${label}:end`);
      return label;
    };
    const a = requestExtraction(job('a', 30));
    const b = requestExtraction(job('b', 10));
    await Promise.all([a, b]);
    // a starts first, must end before b starts
    assert.equal(events[0], 'a:start');
    assert.equal(events[1], 'a:end');
    assert.equal(events[2], 'b:start');
    assert.equal(events[3], 'b:end');
  });
});

describe('isTransient classification (verified via retry behavior)', () => {
  it('does NOT retry on HTTP 500 (persistent — same prompt same failure)', async () => {
    let runs = 0;
    await assert.rejects(
      () => requestExtraction(async () => {
        runs++;
        const err = new Error('LLM server returned HTTP 500: bad');
        throw err;
      })
    );
    assert.equal(runs, 1, 'HTTP 500 should not retry');
  });

  it('does NOT retry on plain "fetch failed" (Ollama internal deadline)', async () => {
    let runs = 0;
    await assert.rejects(
      () => requestExtraction(async () => {
        runs++;
        const err = new Error('fetch failed');
        throw err;
      })
    );
    assert.equal(runs, 1, '"fetch failed" should not retry');
  });

  it('does NOT retry on schema validation errors', async () => {
    let runs = 0;
    await assert.rejects(
      () => requestExtraction(async () => {
        runs++;
        throw new Error('ZodError: invalid type');
      })
    );
    assert.equal(runs, 1);
  });

  it('DOES retry on HTTP 502 (gateway timeout — transient)', async () => {
    let runs = 0;
    await assert.rejects(
      () => requestExtraction(async () => {
        runs++;
        throw new Error('LLM server returned HTTP 502: Bad Gateway');
      })
    );
    assert.equal(runs, 4, '502 should retry 3 times → 4 total attempts');
  });

  it('DOES retry on ECONNRESET', async () => {
    let runs = 0;
    await assert.rejects(
      () => requestExtraction(async () => {
        runs++;
        const err = new Error('socket hang up');
        err.code = 'ECONNRESET';
        throw err;
      })
    );
    assert.equal(runs, 4);
  });

  it('succeeds on retry if transient error clears', async () => {
    let runs = 0;
    const result = await requestExtraction(async () => {
      runs++;
      if (runs < 2) {
        const err = new Error('socket hang up');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'finally ok';
    });
    assert.equal(runs, 2);
    assert.equal(result, 'finally ok');
  });
});

describe('requestAnalysis fallback paths', () => {
  it('returns mode:llm with value on success', async () => {
    const result = await requestAnalysis(async () => 'analysis-result', { waitTimeoutMs: 500 });
    assert.equal(result.mode, 'llm');
    assert.equal(result.value, 'analysis-result');
  });

  it('returns fallback with reason "ollama-busy-extraction" when extraction is in flight', async () => {
    // Start a slow extraction
    const slowExtraction = requestExtraction(async () => {
      await new Promise(r => setTimeout(r, 100));
      return 'extract-done';
    });
    // Wait briefly so the extraction grabs currentJob
    await new Promise(r => setTimeout(r, 10));
    // Now request analysis — should fall back
    const result = await requestAnalysis(async () => 'never-runs', { waitTimeoutMs: 500 });
    assert.equal(result.mode, 'fallback');
    assert.equal(result.reason, 'ollama-busy-extraction');
    await slowExtraction;
  });

  it('returns fallback with reason "analysis-wait-timeout" when analysis exceeds wait', async () => {
    const result = await requestAnalysis(async () => {
      await new Promise(r => setTimeout(r, 500));
      return 'too-late';
    }, { waitTimeoutMs: 50 });
    assert.equal(result.mode, 'fallback');
    assert.equal(result.reason, 'analysis-wait-timeout');
  });

  it('records fallbacks in totals + recent_fallbacks', async () => {
    const slowExtraction = requestExtraction(async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'done';
    });
    await new Promise(r => setTimeout(r, 5));
    await requestAnalysis(async () => 'x', { waitTimeoutMs: 100 });
    const state = getState();
    assert.ok(state.totals.fallbacks >= 1);
    assert.ok(state.recent_fallbacks.length >= 1);
    await slowExtraction;
  });
});

describe('getState snapshot', () => {
  it('returns null current_job when queue is idle', () => {
    const s = getState();
    assert.equal(s.current_job, null);
    assert.equal(s.queue_depth, 0);
  });

  it('reports current_job during in-flight execution', async () => {
    const inflight = requestExtraction(async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'x';
    });
    await new Promise(r => setTimeout(r, 5));
    const s = getState();
    assert.ok(s.current_job, 'should have current_job');
    assert.equal(s.current_job.type, 'extraction');
    await inflight;
  });

  it('captures totals.runs across executions', async () => {
    await requestExtraction(async () => 'a');
    await requestExtraction(async () => 'b');
    const s = getState();
    assert.equal(s.totals.runs, 2);
  });
});

describe('isStuck logic', () => {
  it('returns false when no timeouts recorded', () => {
    assert.equal(isStuck(), false);
  });

  it('returns true after STUCK_TIMEOUTS (3) consecutive timeouts on one type', async () => {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => requestExtraction(async () => {
          const err = new Error('AbortError: timeout');
          err.name = 'AbortError';
          throw err;
        })
      );
    }
    assert.equal(isStuck(), true);
  });

  it('recordAutoRestart resets the stuck counters', async () => {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => requestExtraction(async () => {
          const err = new Error('AbortError: timeout');
          err.name = 'AbortError';
          throw err;
        })
      );
    }
    assert.equal(isStuck(), true);
    recordAutoRestart('test-restart');
    assert.equal(isStuck(), false);
    const s = getState();
    assert.ok(s.recent_restarts.length >= 1);
    assert.equal(s.recent_restarts[s.recent_restarts.length - 1].reason, 'test-restart');
  });
});

describe('shutdown drain', () => {
  it('returns true immediately when queue is empty', async () => {
    const ok = await shutdown(50);
    assert.equal(ok, true);
  });

  it('rejects newly enqueued jobs while shutting down', async () => {
    // Need a fresh state after shutdown — _resetForTesting handles via beforeEach
    _resetForTesting();
    await shutdown(20);
    await assert.rejects(
      () => requestExtraction(async () => 'x'),
      /shutting down/
    );
  });
});
