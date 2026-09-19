/**
 * flush-economics.test.mjs — the marginal-value gate on pre-compression extraction.
 *
 * Two layers:
 *   decideExtraction — the pure policy, every reason path
 *   runFlush         — the policy wired into the real extraction path, asserting
 *                      on whether the LLM was actually called
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

// A long tail with a trivial append: the shape a repeated idle boundary makes.
const LOW_YIELD = Object.freeze({
  tailTokens: 8000,
  newTokens: 200,
  unchanged: false,
  priorExtraction: true,
  deferrable: true,
  sessionTokens: 150_000,
  contextWindowTokens: 200_000,
});

describe('decideExtraction', () => {
  it('skips an unchanged tail — identical content yields identical facts', () => {
    const d = decideExtraction({ ...LOW_YIELD, unchanged: true });
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.UNCHANGED_TAIL);
  });

  it('skips an unchanged tail even when it is the last chance', () => {
    const d = decideExtraction({ ...LOW_YIELD, unchanged: true, deferrable: false });
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.UNCHANGED_TAIL);
  });

  it('defers a long tail carrying only a trivial append', () => {
    const d = decideExtraction(LOW_YIELD);
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
    assert.ok(d.marginalYield < DEFAULT_FLUSH_ECONOMICS.minMarginalYield);
  });

  it('never defers when no later flush will cover the material', () => {
    const d = decideExtraction({ ...LOW_YIELD, deferrable: false });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.NOT_DEFERRABLE);
  });

  it('extracts the first time — the whole tail is new material', () => {
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

  it('overrides the yield gate inside the window reserve', () => {
    const d = decideExtraction({ ...LOW_YIELD, sessionTokens: 190_000 });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.WINDOW_PROTECTION);
    assert.ok(d.headroomTokens <= DEFAULT_FLUSH_ECONOMICS.windowReserveTokens);
  });

  it('extracts once enough absolute new material has accumulated', () => {
    const d = decideExtraction({ ...LOW_YIELD, newTokens: DEFAULT_FLUSH_ECONOMICS.minNewTokens });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  });

  it('extracts a short tail that is mostly new, below the absolute floor', () => {
    const d = decideExtraction({ ...LOW_YIELD, tailTokens: 1000, newTokens: 400 });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.HIGH_MARGINAL_YIELD);
  });

  it('honours caller economics overrides', () => {
    const d = decideExtraction({ ...LOW_YIELD, economics: { minNewTokens: 100 } });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  });

  it('extracts a fully-new tail rather than let it scroll out of the window', () => {
    const d = decideExtraction({ ...LOW_YIELD, tailSaturated: true });
    assert.equal(d.extract, true);
    assert.equal(d.reason, FLUSH_REASONS.TAIL_SATURATED);
  });

  it('keeps the saturation guard even under economics that would defer everything', () => {
    const d = decideExtraction({
      ...LOW_YIELD,
      tailSaturated: true,
      economics: { minNewTokens: 1e9, minMarginalYield: 99 },
    });
    assert.equal(d.extract, true, 'fact retention must not depend on tuning');
    assert.equal(d.reason, FLUSH_REASONS.TAIL_SATURATED);
  });

  it('treats a zero-length tail as unmeasurable yield, not divide-by-zero', () => {
    const d = decideExtraction({ ...LOW_YIELD, tailTokens: 0, newTokens: 0 });
    assert.equal(d.marginalYield, null);
    assert.equal(d.extract, false);
    assert.equal(d.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
  });
});

// ─── runFlush wiring ─────────────────────────────────────────────────────────

const mockExtractionResult = {
  entities: [{ name: 'NATS JetStream', type: 'technology', salience: 0.9 }],
  themes: [{ label: 'Message queue configuration', hierarchy: ['infrastructure'] }],
  actions: ['debugging'],
  decisions: [],
  friction_signals: [],
};

describe('runFlush marginal gate', () => {
  let tmpDir, store, llmCalls, mockClient, jsonlPath, memoryMdPath;

  // ~200 tokens per message, so a 10-message tail costs ~2000 tokens to extract.
  const bigMessage = (i) => JSON.stringify({
    type: 'user',
    message: { role: 'user', content: `Turn ${i} about NATS JetStream. ${'detail '.repeat(110)}` },
    timestamp: `2026-09-19T10:${String(i).padStart(2, '0')}:00Z`,
  });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-economics-test-'));
    store = createExtractionStore({ dbPath: path.join(tmpDir, 'test.db') });
    llmCalls = 0;
    mockClient = {
      async generate() {
        llmCalls++;
        return { content: JSON.stringify(mockExtractionResult), usage: null, finishReason: 'stop' };
      },
    };
    jsonlPath = path.join(tmpDir, 'marginal-session.jsonl');
    memoryMdPath = path.join(tmpDir, 'MEMORY-marginal.md');
    fs.writeFileSync(jsonlPath, Array.from({ length: 10 }, (_, i) => bigMessage(i)).join('\n'));
  });

  afterEach(() => {
    if (store) store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const opts = (extra = {}) => ({
    charBudget: 2200,
    llmClient: mockClient,
    extractionStore: store,
    vaultPath: path.join(tmpDir, 'vault'),
    ...extra,
  });

  const appendTiny = () => fs.appendFileSync(jsonlPath, '\n' + JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'ok thanks' },
    timestamp: '2026-09-19T11:00:00Z',
  }));

  it('defers a deferrable re-extraction whose tail barely moved', async () => {
    const first = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    assert.equal(first.mode, 'llm');
    const callsAfterFirst = llmCalls;

    appendTiny();
    const second = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));

    assert.equal(second.mode, 'llm-deferred');
    assert.equal(second.flushed, false);
    assert.equal(second.decision.reason, FLUSH_REASONS.LOW_MARGINAL_YIELD);
    assert.equal(llmCalls, callsAfterFirst, 'the extraction model must not be called');
  });

  it('leaves behaviour unchanged when the caller does not opt in', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts());
    const callsAfterFirst = llmCalls;

    appendTiny();
    const second = await runFlush(jsonlPath, memoryMdPath, opts());

    assert.equal(second.mode, 'llm');
    assert.equal(llmCalls, callsAfterFirst + 1, 'an un-opted caller still extracts');
  });

  it('extracts inside the window reserve despite a trivial delta', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    const callsAfterFirst = llmCalls;

    appendTiny();
    const second = await runFlush(jsonlPath, memoryMdPath, opts({
      deferrable: true,
      sessionTokens: 190_000,
      contextWindowTokens: 200_000,
    }));

    assert.equal(second.mode, 'llm');
    assert.equal(llmCalls, callsAfterFirst + 1, 'window pressure must override the gate');
  });

  it('extracts once the deferred material accumulates past the floor', async () => {
    await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));
    const callsAfterFirst = llmCalls;

    // Well past minNewTokens (1500) of genuinely new material.
    fs.appendFileSync(jsonlPath, '\n' + Array.from({ length: 5 }, (_, i) => bigMessage(50 + i)).join('\n'));
    const second = await runFlush(jsonlPath, memoryMdPath, opts({ deferrable: true }));

    assert.equal(second.mode, 'llm');
    assert.equal(second.decision, undefined, 'an extracting flush returns no skip decision');
    assert.equal(llmCalls, callsAfterFirst + 1);
  });
});

// ─── retention under sustained deferral ──────────────────────────────────────

describe('runFlush retention', () => {
  it('loses nothing across a long stream of messages too small to clear the floor', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-retention-test-'));
    const store = createExtractionStore({ dbPath: path.join(tmpDir, 'test.db') });
    try {
      // The mock reports one entity per turn it is shown, so the entity table is
      // exactly the set of turns that ever reached the extraction model.
      const client = {
        async generate(messages) {
          const turns = [...JSON.stringify(messages).matchAll(/TURN(\d+)/g)].map((m) => Number(m[1]));
          return {
            content: JSON.stringify({
              entities: turns.map((t) => ({ name: `TURN${t}`, type: 'technology', salience: 0.9 })),
              themes: [], actions: [], decisions: [], friction_signals: [],
            }),
            usage: null, finishReason: 'stop',
          };
        },
      };
      const jsonlPath = path.join(tmpDir, 'retention.jsonl');
      const memoryMdPath = path.join(tmpDir, 'MEMORY-retention.md');
      let n = 0;
      const msg = () => JSON.stringify({
        type: 'user', message: { role: 'user', content: `TURN${n++}` }, timestamp: '2026-09-19T10:00:00Z',
      });
      fs.writeFileSync(jsonlPath, Array.from({ length: 5 }, msg).join('\n'));

      const opts = {
        charBudget: 2200, llmClient: client, extractionStore: store,
        vaultPath: path.join(tmpDir, 'vault'), deferrable: true,
        contextWindowTokens: 200_000, sessionTokens: 80_000,
      };
      await runFlush(jsonlPath, memoryMdPath, opts);

      // Far more boundaries than the 40-message tail window holds, each adding
      // a message worth ~2 tokens — nowhere near minNewTokens on its own.
      for (let i = 0; i < 120; i++) {
        fs.appendFileSync(jsonlPath, '\n' + msg());
        await runFlush(jsonlPath, memoryMdPath, opts);
      }
      await runFlush(jsonlPath, memoryMdPath, { ...opts, deferrable: false });

      const stored = new Set(store.db.prepare('SELECT name FROM entities').all().map((r) => r.name));
      const missing = [];
      for (let t = 0; t < n; t++) if (!stored.has(`TURN${t}`)) missing.push(t);
      assert.deepEqual(missing, [], `deferral dropped turns: ${missing.slice(0, 20).join(',')}`);
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
