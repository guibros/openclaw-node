import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractStructuredCues, embedPrompt, analyzeQuery } from '../lib/query-analysis.mjs';

// ─── extractStructuredCues ───────────────────────────────────────────────────

describe('extractStructuredCues', () => {
  it('extracts file paths from prompt text', () => {
    const result = extractStructuredCues(
      'Can you check lib/memory-budget.mjs and also test/memory-budget.test.mjs for the reload bug?'
    );
    assert.ok(result.filePaths.includes('lib/memory-budget.mjs'), 'should find lib/memory-budget.mjs');
    assert.ok(result.filePaths.includes('test/memory-budget.test.mjs'), 'should find test file');
    assert.ok(result.filePaths.length >= 2, 'should find at least 2 file paths');
  });

  it('extracts version and step references', () => {
    const result = extractStructuredCues(
      'What changed between v6.3 and v6.4-pre? Also see Step 7.1 for the next task.'
    );
    assert.ok(result.versionRefs.some(r => r === 'v6.3'), 'should find v6.3');
    assert.ok(result.versionRefs.some(r => r === 'v6.4-pre'), 'should find v6.4-pre');
    assert.ok(result.versionRefs.some(r => /step\s+7\.1/i.test(r)), 'should find Step 7.1');
  });

  it('extracts backtick code references', () => {
    const result = extractStructuredCues(
      'How does `spreadingActivation` work with `createGraphAdapter`?'
    );
    assert.ok(result.codeRefs.includes('spreadingActivation'), 'should find spreadingActivation');
    assert.ok(result.codeRefs.includes('createGraphAdapter'), 'should find createGraphAdapter');
  });

  it('returns empty arrays for prompt with no structured cues', () => {
    const result = extractStructuredCues('How does the memory system work?');
    assert.deepStrictEqual(result.filePaths, []);
    assert.deepStrictEqual(result.versionRefs, []);
    assert.deepStrictEqual(result.codeRefs, []);
  });

  it('handles null and empty input gracefully', () => {
    assert.deepStrictEqual(extractStructuredCues(null).filePaths, []);
    assert.deepStrictEqual(extractStructuredCues('').filePaths, []);
    assert.deepStrictEqual(extractStructuredCues(undefined).filePaths, []);
  });

  it('deduplicates repeated references', () => {
    const result = extractStructuredCues(
      'Check lib/foo.mjs and then lib/foo.mjs again. Also v6.4 and v6.4.'
    );
    assert.equal(result.filePaths.filter(f => f === 'lib/foo.mjs').length, 1, 'file path deduplicated');
    assert.equal(result.versionRefs.filter(v => v === 'v6.4').length, 1, 'version ref deduplicated');
  });
});

// ─── embedPrompt ─────────────────────────────────────────────────────────────

describe('embedPrompt', () => {
  it('returns embedding from injected embedFn', async () => {
    const mockVec = new Float32Array([0.1, 0.2, 0.3]);
    const mockEmbed = async () => mockVec;
    const result = await embedPrompt('test prompt', mockEmbed);
    assert.ok(result instanceof Float32Array, 'should return Float32Array');
    assert.deepStrictEqual(result, mockVec);
  });

  it('returns null when embedFn throws', async () => {
    const failEmbed = async () => { throw new Error('model not cached'); };
    const result = await embedPrompt('test prompt', failEmbed);
    assert.equal(result, null, 'should return null on failure');
  });

  it('returns null for empty or invalid input', async () => {
    assert.equal(await embedPrompt(null), null);
    assert.equal(await embedPrompt(''), null);
  });
});

// ─── analyzeQuery ────────────────────────────────────────────────────────────

describe('analyzeQuery', () => {
  it('returns complete analysis with all fields', async () => {
    const mockVec = new Float32Array([0.5, 0.6]);
    const result = await analyzeQuery(
      'How does `spreadingActivation` in lib/spreading-activation.mjs relate to v6.1?',
      { embedFn: async () => mockVec }
    );

    assert.equal(result.rawQuery, 'How does `spreadingActivation` in lib/spreading-activation.mjs relate to v6.1?');
    assert.ok(result.embedding instanceof Float32Array, 'embedding should be Float32Array');
    assert.ok(result.structuredCues.filePaths.includes('lib/spreading-activation.mjs'));
    assert.ok(result.structuredCues.versionRefs.includes('v6.1'));
    assert.ok(result.structuredCues.codeRefs.includes('spreadingActivation'));
  });

  it('degrades gracefully with null embedding on failure', async () => {
    const result = await analyzeQuery(
      'What is NATS?',
      { embedFn: async () => { throw new Error('fail'); } }
    );
    assert.equal(result.rawQuery, 'What is NATS?');
    assert.equal(result.embedding, null, 'embedding null on failure');
    assert.ok(result.structuredCues, 'structuredCues still present');
  });
});
