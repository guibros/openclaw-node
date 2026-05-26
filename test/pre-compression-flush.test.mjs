/**
 * pre-compression-flush.test.mjs — Unit tests for lib/pre-compression-flush.mjs
 *
 * Targeted coverage for the public API surface NOT already exercised by
 * memory-budget.test.mjs (which covers extractFacts, mergeFacts,
 * cleanParentheticalChains, stripSupersedes, stripSpeaker, truncateAtWord)
 * or extraction-store.test.mjs (which covers runFlush integration).
 *
 * Covers here:
 *   estimateTokens          — char-count → token estimate
 *   estimateSessionTokens   — JSONL session token estimation (file path)
 *   shouldFlush             — threshold logic, missing-file handling, custom opts
 *   bigramSimilarity        — Jaccard-on-bigrams, identical / orthogonal / partial
 *   parseMemoryMd           — section parsing, bullet extraction, raw preservation
 *   USE_LLM_EXTRACTION const — env-var pickup
 *
 * Run: node --test test/pre-compression-flush.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  estimateTokens,
  estimateSessionTokens,
  shouldFlush,
  bigramSimilarity,
  parseMemoryMd,
  USE_LLM_EXTRACTION,
} from '../lib/pre-compression-flush.mjs';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'pcf-test-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('approximates chars/4 (default CHARS_PER_TOKEN)', () => {
    assert.equal(estimateTokens('a'.repeat(40)), 10);
    assert.equal(estimateTokens('a'.repeat(100)), 25);
  });

  it('rounds up (ceil)', () => {
    assert.equal(estimateTokens('a'.repeat(5)), 2);  // 5/4 = 1.25 → 2
    assert.equal(estimateTokens('a'.repeat(1)), 1);  // 1/4 = 0.25 → 1
  });
});

// ─── estimateSessionTokens ───────────────────────────────────────────────────

describe('estimateSessionTokens', () => {
  it('returns zeros for missing file', async () => {
    const result = await estimateSessionTokens(join(TMP, 'no.jsonl'));
    assert.equal(result.totalTokens, 0);
    assert.equal(result.messageCount, 0);
    assert.deepEqual(result.tailMessages, []);
  });

  it('counts messages + estimates tokens from JSONL', async () => {
    const path = join(TMP, 's1.jsonl');
    writeFileSync(path,
      JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n' +
      JSON.stringify({ type: 'assistant', message: { content: 'world' } }) + '\n'
    );
    const result = await estimateSessionTokens(path);
    assert.equal(result.messageCount, 2);
    assert.equal(result.totalTokens, Math.ceil((5 + 5) / 4));
  });

  it('returns last N messages as tailMessages', async () => {
    const path = join(TMP, 's2.jsonl');
    writeFileSync(path,
      ['a', 'b', 'c', 'd', 'e'].map(c =>
        JSON.stringify({ type: 'user', message: { content: c } })
      ).join('\n') + '\n'
    );
    const result = await estimateSessionTokens(path, 2);
    assert.equal(result.tailMessages.length, 2);
    assert.equal(result.tailMessages[0].content, 'd');
    assert.equal(result.tailMessages[1].content, 'e');
  });

  it('honors explicit format option', async () => {
    const path = join(TMP, 's3.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'message', message: { role: 'user', content: 'gw' } }) + '\n');
    const result = await estimateSessionTokens(path, 40, { format: 'openclaw-gateway' });
    assert.equal(result.messageCount, 1);
    assert.equal(result.tailMessages[0].content, 'gw');
  });
});

// ─── shouldFlush ─────────────────────────────────────────────────────────────

describe('shouldFlush', () => {
  it('returns shouldFlush:false for missing file', async () => {
    const result = await shouldFlush(join(TMP, 'absent.jsonl'));
    assert.equal(result.shouldFlush, false);
    assert.equal(result.estimatedTokens, 0);
    assert.equal(result.pctUsed, 0);
    assert.ok(result.threshold > 0);
  });

  it('returns shouldFlush:false for small file (below threshold)', async () => {
    const path = join(TMP, 'small.jsonl');
    writeFileSync(path, 'tiny content\n');
    const result = await shouldFlush(path);
    assert.equal(result.shouldFlush, false);
    assert.ok(result.pctUsed < 100);
  });

  it('returns shouldFlush:true for file exceeding threshold', async () => {
    const path = join(TMP, 'big.jsonl');
    // Use a tiny context window so we hit the threshold easily
    writeFileSync(path, 'x'.repeat(10_000));
    const result = await shouldFlush(path, { contextWindowTokens: 1000, flushPct: 0.5 });
    assert.equal(result.shouldFlush, true);
    assert.ok(result.pctUsed >= 50);
  });

  it('respects custom contextWindowTokens', async () => {
    const path = join(TMP, 'mid.jsonl');
    writeFileSync(path, 'a'.repeat(5_000));
    // With a giant context window, this is well below threshold
    const huge = await shouldFlush(path, { contextWindowTokens: 1_000_000 });
    assert.equal(huge.shouldFlush, false);
    // With a tiny window, it triggers
    const tiny = await shouldFlush(path, { contextWindowTokens: 500 });
    assert.equal(tiny.shouldFlush, true);
  });

  it('respects custom flushPct', async () => {
    const path = join(TMP, 'pct.jsonl');
    writeFileSync(path, 'a'.repeat(4_000));
    // At default 75%, this likely doesn't flush
    const r75 = await shouldFlush(path, { contextWindowTokens: 1000, flushPct: 0.75 });
    // At 25%, more likely to flush
    const r25 = await shouldFlush(path, { contextWindowTokens: 1000, flushPct: 0.25 });
    assert.ok(r25.threshold < r75.threshold);
  });
});

// ─── bigramSimilarity ────────────────────────────────────────────────────────

describe('bigramSimilarity', () => {
  it('returns 0 for either empty input', () => {
    assert.equal(bigramSimilarity('', 'hello world'), 0);
    assert.equal(bigramSimilarity('hello world', ''), 0);
    assert.equal(bigramSimilarity('', ''), 0);
    assert.equal(bigramSimilarity(null, 'x'), 0);
  });

  it('returns 1.0 for identical strings', () => {
    assert.equal(bigramSimilarity('hello world', 'hello world'), 1);
  });

  it('returns ~1 for case-only differences (norm strips case)', () => {
    assert.equal(bigramSimilarity('Hello World', 'hello world'), 1);
  });

  it('returns higher score for partial overlap than orthogonal pair', () => {
    const partial = bigramSimilarity('the quick brown fox', 'the lazy dog brown');
    const ortho = bigramSimilarity('the quick brown fox', 'completely different words');
    assert.ok(partial > ortho);
  });

  it('strips punctuation when normalizing', () => {
    // Punctuation-only differences should produce very high similarity
    const a = 'hello, world!';
    const b = 'hello world';
    assert.ok(bigramSimilarity(a, b) >= 0.9);
  });

  it('handles short single-word strings via unigram fallback', () => {
    assert.ok(bigramSimilarity('hello', 'hello') === 1);
  });
});

// ─── parseMemoryMd ───────────────────────────────────────────────────────────

describe('parseMemoryMd', () => {
  it('returns empty array for empty content', () => {
    assert.deepEqual(parseMemoryMd(''), []);
  });

  it('groups bullets under their preceding heading section', () => {
    const md = `# Memory

## Preferences
- Likes dark mode
- Uses tabs not spaces

## Decisions
- Adopted Neo4j for graph storage
`;
    const entries = parseMemoryMd(md);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].section, 'Preferences');
    assert.equal(entries[0].text, 'Likes dark mode');
    assert.equal(entries[2].section, 'Decisions');
    assert.equal(entries[2].text, 'Adopted Neo4j for graph storage');
  });

  it('handles entries before any heading (empty section)', () => {
    const md = `- orphan bullet
## Section
- in-section bullet`;
    const entries = parseMemoryMd(md);
    assert.equal(entries[0].section, '');
    assert.equal(entries[0].text, 'orphan bullet');
    assert.equal(entries[1].section, 'Section');
  });

  it('handles asterisk bullets (alternate markdown)', () => {
    const md = `## Bullets
* using stars
* still works`;
    const entries = parseMemoryMd(md);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].text, 'using stars');
  });

  it('preserves raw bullet line', () => {
    const md = `## S
- hello world`;
    const entries = parseMemoryMd(md);
    assert.equal(entries[0].raw, '- hello world');
  });

  it('skips non-bullet, non-heading content', () => {
    const md = `## S
Just a paragraph
- but this is a bullet`;
    const entries = parseMemoryMd(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, 'but this is a bullet');
  });
});

// ─── USE_LLM_EXTRACTION const ────────────────────────────────────────────────

describe('USE_LLM_EXTRACTION', () => {
  it('is a boolean reflecting env var (default true)', () => {
    assert.equal(typeof USE_LLM_EXTRACTION, 'boolean');
    // Default behavior: only false when env explicitly set to "false"
    if (process.env.USE_LLM_EXTRACTION === 'false') {
      assert.equal(USE_LLM_EXTRACTION, false);
    } else {
      assert.equal(USE_LLM_EXTRACTION, true);
    }
  });
});
