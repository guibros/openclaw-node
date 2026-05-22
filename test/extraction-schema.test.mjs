import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExtractionResultSchema,
  validateExtractionResult,
  EntitySchema,
  ENTITY_TYPES,
  ACTION_TYPES,
} from '../lib/extraction-schema.mjs';

import {
  buildExtractionPrompt,
  extractStructured,
} from '../lib/extraction-prompt.mjs';

// ── Schema Validation ──────────────────────────────────

describe('ExtractionResultSchema', () => {
  it('accepts a fully populated valid result', () => {
    const valid = {
      entities: [
        { name: 'NATS JetStream', type: 'technology', salience: 0.9 },
        { name: 'Gui', type: 'person', salience: 0.7 },
      ],
      themes: [
        { label: 'message broker setup', hierarchy: ['infrastructure', 'messaging'] },
      ],
      actions: ['debugging', 'implementing'],
      decisions: [
        { decision: 'Use NATS over RabbitMQ', rationale: 'Better fit for mesh topology', confidence: 0.95 },
      ],
      friction_signals: [
        { signal: 'JetStream cluster timeout on M4', severity: 'medium' },
      ],
      relationships: [
        { source: 'NATS JetStream', target: 'mesh-coordination', type: 'depends_on' },
      ],
    };

    const result = validateExtractionResult(valid);
    assert.equal(result.entities.length, 2);
    assert.equal(result.themes.length, 1);
    assert.deepEqual(result.actions, ['debugging', 'implementing']);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.friction_signals.length, 1);
    assert.equal(result.relationships.length, 1);
  });

  it('accepts a result with all empty arrays', () => {
    const minimal = {
      entities: [],
      themes: [],
      actions: [],
      decisions: [],
      friction_signals: [],
      relationships: [],
    };

    const result = validateExtractionResult(minimal);
    assert.equal(result.entities.length, 0);
    assert.equal(result.actions.length, 0);
  });

  it('rejects when a required top-level field is missing', () => {
    const missing = {
      entities: [{ name: 'X', type: 'concept', salience: 0.5 }],
      // themes missing
      actions: [],
      decisions: [],
      friction_signals: [],
      relationships: [],
    };

    assert.throws(() => validateExtractionResult(missing));
  });

  it('rejects an entity with an invalid type', () => {
    const badType = {
      entities: [{ name: 'X', type: 'invalid_type', salience: 0.5 }],
      themes: [],
      actions: [],
      decisions: [],
      friction_signals: [],
      relationships: [],
    };

    assert.throws(() => validateExtractionResult(badType));
  });
});

// ── Prompt Builder ─────────────────────────────────────

describe('buildExtractionPrompt', () => {
  it('returns system and user messages from session tail', () => {
    const messages = [
      { role: 'user', content: 'How do I configure NATS?' },
      { role: 'assistant', content: 'You need to set up JetStream first.' },
      { role: 'tool', content: '{"result": "ok"}' },
    ];

    const prompt = buildExtractionPrompt(messages);
    assert.equal(prompt.length, 2);
    assert.equal(prompt[0].role, 'system');
    assert.equal(prompt[1].role, 'user');
    // System prompt should mention JSON
    assert.ok(prompt[0].content.includes('JSON'));
    // User prompt should include user and assistant messages, not tool
    assert.ok(prompt[1].content.includes('configure NATS'));
    assert.ok(prompt[1].content.includes('JetStream'));
    assert.ok(!prompt[1].content.includes('tool'));
  });
});

// ── Extraction Runner ──────────────────────────────────

describe('extractStructured', () => {
  it('validates a well-formed mock LLM response', async () => {
    const mockResponse = {
      entities: [{ name: 'SQLite', type: 'technology', salience: 0.8 }],
      themes: [{ label: 'database setup', hierarchy: ['infrastructure', 'storage'] }],
      actions: ['implementing'],
      decisions: [],
      friction_signals: [],
      relationships: [],
    };

    const mockClient = {
      generate: async () => ({
        content: JSON.stringify(mockResponse),
        usage: null,
        finishReason: 'stop',
      }),
    };

    const result = await extractStructured(mockClient, [
      { role: 'user', content: 'Set up the SQLite database.' },
    ]);

    assert.equal(result.entities[0].name, 'SQLite');
    assert.equal(result.entities[0].type, 'technology');
    assert.equal(result.themes[0].label, 'database setup');
  });

  it('throws on malformed JSON from the LLM', async () => {
    const mockClient = {
      generate: async () => ({
        content: 'This is not JSON at all {broken',
        usage: null,
        finishReason: 'stop',
      }),
    };

    await assert.rejects(
      () => extractStructured(mockClient, [{ role: 'user', content: 'test' }]),
      (err) => {
        assert.ok(err.message.includes('not valid JSON'));
        return true;
      },
    );
  });
});
