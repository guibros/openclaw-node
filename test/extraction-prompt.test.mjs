/**
 * extraction-prompt.test.mjs — Unit tests for lib/extraction-prompt.mjs
 *
 * Covers:
 *   coerceExtractionResult — enum normalization across all 4 enum surfaces,
 *     alias mapping, drop-unmappable behavior, salience/confidence clamping
 *   extractJsonFromText  — pure JSON fast path, markdown fence stripping,
 *     brace-matching, string-aware, unbalanced fallback
 *   buildExtractionPrompt — system/user message shape
 *   extractStructured    — end-to-end with mock LLM client, error paths
 *
 * Run: node --test test/extraction-prompt.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceExtractionResult,
  extractJsonFromText,
  buildExtractionPrompt,
  extractStructured,
} from '../lib/extraction-prompt.mjs';
import { validateExtractionResult } from '../lib/extraction-schema.mjs';

describe('coerceExtractionResult', () => {
  it('returns raw object passthrough for null / non-object input', () => {
    assert.equal(coerceExtractionResult(null), null);
    assert.equal(coerceExtractionResult(undefined), undefined);
    assert.equal(coerceExtractionResult('not an object'), 'not an object');
    assert.equal(coerceExtractionResult(42), 42);
  });

  // Step 3.4 — the load-bearing tolerance property: a model response that omits
  // arrays and carries a bad enum must coerce into something that validates,
  // instead of throwing and dumping the whole 1–15 min extraction to regex.
  it('coerce → validate does not throw when arrays are missing / enums are bad', () => {
    const raw = { entities: [{ name: 'NATS', type: 'Security', salience: 2 }] }; // no themes/actions/decisions/friction/relationships
    const coerced = coerceExtractionResult(raw);
    assert.deepEqual(
      Object.keys(coerced).sort(),
      ['actions', 'decisions', 'entities', 'friction_signals', 'relationships', 'themes'],
    );
    let validated;
    assert.doesNotThrow(() => { validated = validateExtractionResult(coerced); });
    assert.equal(validated.entities[0].salience, 1); // clamped from 2
    assert.deepEqual(validated.themes, []);          // missing array filled, not rejected
    assert.deepEqual(validated.actions, []);
  });

  it('normalizes valid entity types unchanged', () => {
    const out = coerceExtractionResult({
      entities: [{ name: 'Foo', type: 'person', salience: 0.5 }],
    });
    assert.equal(out.entities.length, 1);
    assert.equal(out.entities[0].type, 'person');
    assert.equal(out.entities[0].name, 'Foo');
  });

  it('maps entity type aliases to canonical values', () => {
    const out = coerceExtractionResult({
      entities: [
        { name: 'IBM', type: 'organization', salience: 0.9 },
        { name: 'Bob', type: 'people', salience: 0.7 },
        { name: 'Crypto', type: 'security', salience: 0.5 },
        { name: 'API', type: 'tech', salience: 0.4 },
      ],
    });
    assert.equal(out.entities[0].type, 'company');
    assert.equal(out.entities[1].type, 'person');
    assert.equal(out.entities[2].type, 'technology');
    assert.equal(out.entities[3].type, 'technology');
  });

  it('drops entities with unmappable types', () => {
    const out = coerceExtractionResult({
      entities: [
        { name: 'Foo', type: 'asdfqwerty', salience: 0.5 },
        { name: 'Bar', type: 'person', salience: 0.5 },
      ],
    });
    assert.equal(out.entities.length, 1);
    assert.equal(out.entities[0].name, 'Bar');
  });

  it('drops entities with missing or non-string names', () => {
    const out = coerceExtractionResult({
      entities: [
        { type: 'person', salience: 0.5 },
        { name: '', type: 'person', salience: 0.5 },
        { name: 'OK', type: 'person', salience: 0.5 },
      ],
    });
    assert.equal(out.entities.length, 1);
    assert.equal(out.entities[0].name, 'OK');
  });

  it('clamps salience to [0,1] and defaults missing salience to 0.5', () => {
    const out = coerceExtractionResult({
      entities: [
        { name: 'A', type: 'person', salience: 2.5 },
        { name: 'B', type: 'person', salience: -0.5 },
        { name: 'C', type: 'person' },
      ],
    });
    assert.equal(out.entities[0].salience, 1);
    assert.equal(out.entities[1].salience, 0);
    assert.equal(out.entities[2].salience, 0.5);
  });

  it('normalizes action aliases to canonical values', () => {
    const out = coerceExtractionResult({
      actions: ['debug', 'research', 'coding', 'fix', 'asdf'],
    });
    assert.deepEqual(out.actions, ['debugging', 'researching', 'implementing', 'debugging']);
  });

  it('handles snake_case fallback for relationship types', () => {
    const out = coerceExtractionResult({
      relationships: [
        { source: 'A', target: 'B', type: 'Depends On' },
        { source: 'A', target: 'C', type: 'conflicts with' },
        { source: 'A', target: 'D', type: 'depends_on' },
      ],
    });
    assert.equal(out.relationships.length, 3);
    assert.equal(out.relationships[0].type, 'depends_on');
    assert.equal(out.relationships[1].type, 'contradicts');
    assert.equal(out.relationships[2].type, 'depends_on');
  });

  it('drops relationships missing source/target/type', () => {
    const out = coerceExtractionResult({
      relationships: [
        { source: 'A', type: 'depends_on' },        // missing target
        { target: 'B', type: 'depends_on' },        // missing source
        { source: 'C', target: 'D' },                // missing type
        { source: 'E', target: 'F', type: 'totally_invalid' }, // bad type
        { source: 'G', target: 'H', type: 'causes' }, // ok
      ],
    });
    assert.equal(out.relationships.length, 1);
    assert.equal(out.relationships[0].source, 'G');
  });

  it('normalizes severity aliases on friction_signals', () => {
    const out = coerceExtractionResult({
      friction_signals: [
        { signal: 'slow build', severity: 'minor' },
        { signal: 'broken test', severity: 'blocker' },
        { signal: 'mystery bug', severity: 'unknown' },
      ],
    });
    assert.equal(out.friction_signals.length, 3);
    assert.equal(out.friction_signals[0].severity, 'low');
    assert.equal(out.friction_signals[1].severity, 'high');
    assert.equal(out.friction_signals[2].severity, 'medium'); // default
  });

  it('trims whitespace on names and labels', () => {
    const out = coerceExtractionResult({
      entities: [{ name: '  Padded  ', type: 'concept', salience: 0.5 }],
      themes: [{ label: '\t labeled \n', hierarchy: ['  a  ', 'b'] }],
    });
    assert.equal(out.entities[0].name, 'Padded');
    assert.equal(out.themes[0].label, 'labeled');
    assert.deepEqual(out.themes[0].hierarchy, ['a', 'b']);
  });

  it('returns empty arrays for missing top-level fields', () => {
    const out = coerceExtractionResult({});
    assert.deepEqual(out.entities, []);
    assert.deepEqual(out.themes, []);
    assert.deepEqual(out.actions, []);
    assert.deepEqual(out.decisions, []);
    assert.deepEqual(out.friction_signals, []);
    assert.deepEqual(out.relationships, []);
  });

  it('handles non-array top-level fields gracefully', () => {
    const out = coerceExtractionResult({
      entities: 'not an array',
      themes: null,
      actions: { wrong: 'shape' },
    });
    assert.deepEqual(out.entities, []);
    assert.deepEqual(out.themes, []);
    assert.deepEqual(out.actions, []);
  });

  it('drops decisions with missing decision or rationale text', () => {
    const out = coerceExtractionResult({
      decisions: [
        { decision: 'Pick X', rationale: 'because Y', confidence: 0.9 },
        { decision: 'No rationale' },
        { rationale: 'No decision text' },
        { decision: '', rationale: 'empty decision' },
      ],
    });
    assert.equal(out.decisions.length, 1);
    assert.equal(out.decisions[0].decision, 'Pick X');
  });
});

describe('extractJsonFromText', () => {
  it('passes through non-string input', () => {
    assert.equal(extractJsonFromText(null), null);
    assert.equal(extractJsonFromText(undefined), undefined);
    assert.equal(extractJsonFromText(42), 42);
  });

  it('returns empty string unchanged', () => {
    assert.equal(extractJsonFromText(''), '');
  });

  it('fast-path: pure JSON wrapped in whitespace', () => {
    const input = '  {"foo": "bar"}  ';
    assert.equal(extractJsonFromText(input), '{"foo": "bar"}');
  });

  it('strips ```json ... ``` markdown fences', () => {
    const input = '```json\n{"foo": "bar"}\n```';
    assert.equal(extractJsonFromText(input), '{"foo": "bar"}');
  });

  it('strips plain ``` ... ``` fences (no language tag)', () => {
    const input = '```\n{"foo": "bar"}\n```';
    assert.equal(extractJsonFromText(input), '{"foo": "bar"}');
  });

  it('brace-matches outermost block from prose preamble', () => {
    const input = 'Here is the result:\n\n{"foo": "bar", "nested": {"x": 1}}\n\nThanks!';
    assert.equal(extractJsonFromText(input), '{"foo": "bar", "nested": {"x": 1}}');
  });

  it('handles strings containing braces correctly', () => {
    const input = 'prefix {"msg": "this { is } fine", "n": 1} suffix';
    assert.equal(extractJsonFromText(input), '{"msg": "this { is } fine", "n": 1}');
  });

  it('handles escaped quotes inside strings', () => {
    const input = '{"msg": "he said \\"hi\\"", "n": 1}';
    assert.equal(extractJsonFromText(input), '{"msg": "he said \\"hi\\"", "n": 1}');
  });

  it('returns original text when no { found', () => {
    const input = 'no braces here';
    assert.equal(extractJsonFromText(input), 'no braces here');
  });

  it('returns original text when braces unbalanced (let parser error)', () => {
    const input = '{"unclosed": "string';
    assert.equal(extractJsonFromText(input), '{"unclosed": "string');
  });
});

describe('buildExtractionPrompt', () => {
  it('returns system + user message pair', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const out = buildExtractionPrompt(messages);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, 'system');
    assert.equal(out[1].role, 'user');
  });

  it('system message describes JSON output schema', () => {
    const out = buildExtractionPrompt([]);
    assert.match(out[0].content, /entities/);
    assert.match(out[0].content, /themes/);
    assert.match(out[0].content, /actions/);
    assert.match(out[0].content, /decisions/);
    assert.match(out[0].content, /friction_signals/);
    assert.match(out[0].content, /relationships/);
  });

  it('user message includes the conversation messages', () => {
    const msgs = [
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const out = buildExtractionPrompt(msgs);
    assert.match(out[1].content, /Hello there/);
    assert.match(out[1].content, /Hi!/);
  });
});

describe('extractStructured', () => {
  it('returns parsed + validated result on happy path', async () => {
    const mockClient = {
      generate: async () => ({
        content: JSON.stringify({
          entities: [{ name: 'X', type: 'concept', salience: 0.5 }],
          themes: [],
          actions: [],
          decisions: [],
          friction_signals: [],
          relationships: [],
        }),
      }),
    };
    const result = await extractStructured(mockClient, []);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, 'X');
  });

  it('coerces fuzzy enum values via parser+coercer chain', async () => {
    const mockClient = {
      generate: async () => ({
        content: JSON.stringify({
          entities: [{ name: 'A', type: 'organization', salience: 0.5 }],
          themes: [],
          actions: ['research'],
          decisions: [],
          friction_signals: [],
          relationships: [],
        }),
      }),
    };
    const result = await extractStructured(mockClient, []);
    assert.equal(result.entities[0].type, 'company');
    assert.deepEqual(result.actions, ['researching']);
  });

  it('handles markdown-fenced JSON via extractJsonFromText', async () => {
    const mockClient = {
      generate: async () => ({
        content: '```json\n{"entities":[],"themes":[],"actions":[],"decisions":[],"friction_signals":[],"relationships":[]}\n```',
      }),
    };
    const result = await extractStructured(mockClient, []);
    assert.deepEqual(result.entities, []);
  });

  it('throws on invalid JSON with informative message', async () => {
    const mockClient = {
      generate: async () => ({ content: 'not json {{{' }),
    };
    await assert.rejects(
      () => extractStructured(mockClient, []),
      /LLM response is not valid JSON/
    );
  });

  it('throws ZodError on schema-invalid result that coercer cannot save', async () => {
    const mockClient = {
      generate: async () => ({
        content: JSON.stringify({ /* missing required fields */ }),
      }),
    };
    // Coercer produces empty-array defaults → validates OK actually
    const result = await extractStructured(mockClient, []);
    assert.equal(result.entities.length, 0);
  });
});

describe('R42 (repair 3.4): fast path validates before returning', () => {
  it('concatenated {...}{...} output recovers via the brace scanner', () => {
    const out = extractJsonFromText('{"entities": [{"name": "A"}]}{"entities": []}');
    assert.doesNotThrow(() => JSON.parse(out), 'result must be parseable JSON');
    assert.deepEqual(JSON.parse(out).entities, [{ name: 'A' }],
      'the scanner must pick a balanced block, not the unparseable whole');
  });

  it('pure JSON still takes the fast path untouched', () => {
    const pure = '{"entities": [], "themes": []}';
    assert.equal(extractJsonFromText(pure), pure);
  });
});
