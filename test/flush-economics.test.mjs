/**
 * flush-economics.test.mjs — the marginal-value gate on pre-compression extraction.
 *
 * Three layers:
 *   decideExtraction  — the pure policy, every reason path
 *   runFlush gate     — the policy wired into the real extraction path, asserting
 *                       on whether the LLM was actually called and what the daemon
 *                       sees (mode, decision, no phantom extraction event)
 *   runFlush retention — nothing a deferral holds back can ever be lost: the
 *                       extraction window reaches back to the last extraction
 *                       point, so bursts and long runs of tiny messages all land
 *
 * Run: node --test test/flush-economics.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { decideExtraction, FLUSH_REASONS, DEFAULT_FLUSH_ECONOMICS } from '../lib/flush-economics.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { runFlush } from '../lib/pre-compression-flush.mjs';

// ─── decideExtraction ────────────────────────────────────────────────────────

// A long window with a trivial append: the shape a repeated idle boundary makes.
const LOW_YIELD = Object.freeze({
  tailTokens: 8000,
  newTokens: 200,
  unchanged: false,
  priorExtraction: true,
  deferrable: true,
});

describe('decideExtraction', () => {
  it('skips an unchanged window — identical content yields identical facts', () => {
    const d = decideExtraction({ ...LOW_YIELD, unchanged: true });
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.UNCHANGED_TAIL);
  });

  it('skips an unchanged window even when it is the last chance', () => {
    const d = decideExtraction({ ...LOW_YIELD, unchanged: true, deferrable: false });
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.UNCHANGED_TAIL);
  });

  it('defers a long window carrying only a trivial append', () => {
    const d = decideExtraction(LOW_YIELD);
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
    assert.ok(d.marginalYield < DEFAULT_FLUSH_ECONOMICS.minMarginalYield);
  });

  it('never defers when no later flush is promised', () => {
    const d = decideExtraction({ ...LOW_YIELD, deferrable: false });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.NOT_DEFERRABLE);
  });

  it('extracts the first time — the whole window is new material', () => {
    const d = decideExtraction({ ...LOW_YIELD, priorExtraction: false });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.FIRST_EXTRACTION);
  });

  it('extracts when the delta is unknowable rather than guessing', () => {
    const d = decideExtraction({ ...LOW_YIELD, newTokens: null });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.MARGIN_UNKNOWN);
    assert.equal(d.marginalYield, null);
  });

  it('extracts once enough absolute new material has accumulated', () => {
    const d = decideExtraction({ ...LOW_YIELD, newTokens: DEFAULT_FLUSH_ECONOMICS.minNewTokens });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  });

  it('extracts a short window that is mostly new, below the absolute floor', () => {
    const d = decideExtraction({ ...LOW_YIELD, tailTokens: 1000, newTokens: 400 });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.HIGH_MARGINAL_YIELD);
  });

  it('honours caller economics overrides', () => {
    const d = decideExtraction({ ...LOW_YIELD, economics: { minNewTokens: 100 } });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  });

  it('treats a zero-length window as unmeasurable yield, not divide-by-zero', () => {
    const d = decideExtraction({ ...LOW_YIELD, tailTokens: 0, newTokens: 0 });
    assert.equal(d.marginalYield, null);
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
  });
});

// ─── shared harness for the runFlush layers ──────────────────────────────────

// The mock reports one entity per distinct turn label it is shown, so the
// entity table is exactly the set of turns that ever reached the model.
function trackingClient(counter) {
  return {
    async generate(messages) {
      counter.calls++;
      const turns = [...new Set([...JSON.stringify(messages).matchAll(/\b(TINY\d+|BIG\d+|TURN\d+)\b/g)].map((m) => m[1]))];
      return {
        content: JSON.stringify({
          entities: turns.map((t) => ({ name: t, type: 'technology', salience: 0.9 })),
          themes: [], actions: [], decisions: [], friction_signals: [],
        }),
        usage: null, finishReason: 'stop',
      };
    },
  };
}

const line = (content) => JSON.stringify({
  type: 'user', message: { role: 'user', content }, timestamp: '2026-09-19T10:00:00Z',
});
// ~1000 tokens: an already-extracted window this large makes any tiny append low-yield.
const big = (i) => line(`BIG${i} ${'detail '.repeat(570)}`);
const tiny = (i) => line(`TINY${i} ok`);

function missingTurns(store, prefix, n) {
  const stored = new Set(store.db.prepare('SELECT name FROM entities').all().map((r) => r.name));
  const missing = [];
  for (let t = 0; t < n; t++) if (!stored.has(`${prefix}${t}`)) missing.push(`${prefix}${t}`);
  return missing;
}

let tmpDir, store, counter, jsonlPath, memoryMdPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-economics-test-'));
  store = createExtractionStore({ dbPath: path.join(tmpDir, 'test.db') });
  counter = { calls: 0 };
  jsonlPath = path.join(tmpDir, 'session.jsonl');
  memoryMdPath = path.join(tmpDir, 'MEMORY.md');
});

afterEach(() => {
  if (store) store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const opts = (extra = {}) => ({
  charBudget: 2200,
  llmClient: trackingClient(counter),
  extractionStore: store,
  vaultPath: path.join(tmpDir, 'vault'),
  ...extra,
});

// ─── runFlush gate ───────────────────────────────────────────────────────────

describe('runFlush marginal gate', () => {
  beforeEach(() => {
    fs.writeFileSync(jsonlPath, Array.from({ length: 10 }, (_, i) => big(i)).join('\n'));
  });

  it('defers a deferrable re-extraction whose window barely moved', async () => {
    const first = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    assert.equal(first.mode, 'llm');
    assert.equal(first.decision.reason, FLUSH_REASONS.FIRST_EXTRACTION);
    const callsAfterFirst = counter.calls;

    fs.appendFileSync(jsonlPath, '\n' + tiny(0));
    const second = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));

    assert.equal(second.mode, 'llm-deferred');
    assert.equal(second.flushed, false);
    assert.equal(second.decision.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
    assert.equal(counter.calls, callsAfterFirst, 'the extraction model must not be called');
    // Not an extraction: no zero-count block, or the daemon would emit a
    // memory.extracted the watcher counts as a failed run.
    assert.equal(second.extraction, undefined);
  });

  it('leaves behaviour unchanged when the caller does not opt in', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts());
    const callsAfterFirst = counter.calls;

    fs.appendFileSync(jsonlPath, '\n' + tiny(0));
    const second = await runFlush(jsonlPath, memoryMdPath, opts());

    assert.equal(second.mode, 'llm');
    assert.equal(second.decision.reason, FLUSH_REASONS.NOT_DEFERRABLE);
    assert.equal(counter.calls, callsAfterFirst + 1, 'an un-opted caller still extracts');
  });

  it('still reports an unchanged window as llm-dedup with its zero-count block', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    const callsAfterFirst = counter.calls;

    const second = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));

    assert.equal(second.mode, 'llm-dedup');
    assert.equal(second.decision.reason, FLUSH_REASONS.UNCHANGED_TAIL);
    assert.equal(second.extraction.entities_count, 0);
    assert.equal(counter.calls, callsAfterFirst);
  });

  it('extracts once the deferred material accumulates past the floor', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    const callsAfterFirst = counter.calls;

    // Well past minNewTokens (1500) of genuinely new material.
    fs.appendFileSync(jsonlPath, '\n' + Array.from({ length: 5 }, (_, i) => big(50 + i)).join('\n'));
    const second = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));

    assert.equal(second.mode, 'llm');
    assert.equal(second.decision.reason, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
    assert.equal(counter.calls, callsAfterFirst + 1);
  });
});

// ─── runFlush retention ──────────────────────────────────────────────────────

describe('runFlush retention', () => {
  it('loses nothing across a long stream of messages too small to clear the floor', async () => {
    let n = 0;
    fs.writeFileSync(jsonlPath, Array.from({ length: 5 }, () => line(`TURN${n++}`)).join('\n'));
    const o = opts({ deferrable: true });
    await runFlush(jsonlPath, memoryMdPath, o);

    // Far more boundaries than the 40-message tail holds, each adding a
    // message worth ~2 tokens — nowhere near minNewTokens on its own.
    for (let i = 0; i < 120; i++) {
      fs.appendFileSync(jsonlPath, '\n' + line(`TURN${n++}`));
      await runFlush(jsonlPath, memoryMdPath, o);
    }
    await runFlush(jsonlPath, memoryMdPath, { ...o, deferrable: false });

    assert.deepEqual(missingTurns(store, 'TURN', n), []);
  });

  for (const burst of [12, 15, 45]) {
    it(`loses nothing when ${burst} messages arrive between two boundaries after a run of deferrals`, async () => {
      // 10 large already-extracted messages keep every tiny append low-yield.
      fs.writeFileSync(jsonlPath, Array.from({ length: 10 }, (_, i) => big(i)).join('\n'));
      const o = opts({ deferrable: true });
      await runFlush(jsonlPath, memoryMdPath, o);
      const callsAfterFirst = counter.calls;

      // 29 boundaries each deferring one tiny message: 39 unextracted messages
      // now sit in a 40-message tail...
      let n = 0;
      for (let i = 0; i < 29; i++) {
        fs.appendFileSync(jsonlPath, '\n' + tiny(n++));
        await runFlush(jsonlPath, memoryMdPath, o);
      }
      assert.equal(counter.calls, callsAfterFirst, 'every tiny append should have been deferred');

      // ...and a burst pushes the oldest of them past where a fixed tail ends.
      for (let i = 0; i < burst; i++) fs.appendFileSync(jsonlPath, '\n' + tiny(n++));
      await runFlush(jsonlPath, memoryMdPath, o);
      await runFlush(jsonlPath, memoryMdPath, { ...o, deferrable: false });

      assert.deepEqual(missingTurns(store, 'TINY', n), [], 'the window must reach back to the last extraction point');
    });
  }

  it('covers a single boundary interval larger than the tail, even ungated', async () => {
    // Pre-gate behaviour extracted a fixed last-40 and silently dropped the
    // oldest of a 60-message interval; the window now reaches back instead.
    fs.writeFileSync(jsonlPath, Array.from({ length: 5 }, (_, i) => big(i)).join('\n'));
    const o = opts();
    await runFlush(jsonlPath, memoryMdPath, o);

    let n = 0;
    fs.appendFileSync(jsonlPath, '\n' + Array.from({ length: 60 }, () => tiny(n++)).join('\n'));
    await runFlush(jsonlPath, memoryMdPath, o);

    assert.deepEqual(missingTurns(store, 'TINY', n), []);
  });
});
