import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EventEnvelopeSchema,
  MemoryEventSchema,
  SessionStartedSchema,
  SessionEndedSchema,
  TurnRecordedSchema,
  FactExtractedSchema,
  ConceptMentionedSchema,
  SnapshotTakenSchema,
  CompactionTriggeredSchema,
  ArtifactAttachedSchema,
  toJsonSchema,
} from '../packages/event-schemas/dist/index.js';

function makeEnvelope(overrides = {}) {
  return {
    event_id: randomUUID(),
    event_type: 'memory.session_started',
    event_version: 1,
    entity_id: 'session-001',
    entity_type: 'session',
    timestamp: new Date().toISOString(),
    causation_id: null,
    correlation_id: null,
    actor: { type: 'agent', id: 'daedalus' },
    node_id: 'moltymac',
    idempotency_key: randomUUID(),
    ...overrides,
  };
}

describe('EventEnvelopeSchema', () => {
  it('parses a valid envelope', () => {
    const result = EventEnvelopeSchema.parse(makeEnvelope());
    assert.equal(result.entity_type, 'session');
    assert.equal(result.actor.type, 'agent');
  });

  it('applies defaults for event_version, causation_id, correlation_id', () => {
    const input = makeEnvelope();
    delete input.event_version;
    delete input.causation_id;
    delete input.correlation_id;
    const result = EventEnvelopeSchema.parse(input);
    assert.equal(result.event_version, 1);
    assert.equal(result.causation_id, null);
    assert.equal(result.correlation_id, null);
  });

  it('rejects an envelope with invalid entity_type', () => {
    assert.throws(() => {
      EventEnvelopeSchema.parse(makeEnvelope({ entity_type: 'invalid' }));
    });
  });

  it('rejects an envelope with missing required fields', () => {
    assert.throws(() => {
      EventEnvelopeSchema.parse({ event_id: randomUUID() });
    });
  });
});

describe('Memory event schemas', () => {
  function makeEvent(eventType, data) {
    return {
      ...makeEnvelope({ event_type: eventType }),
      data,
    };
  }

  it('validates session_started', () => {
    const event = makeEvent('memory.session_started', {
      session_id: 'sess-001',
      start_time: new Date().toISOString(),
      session_type: 'interactive',
    });
    const result = SessionStartedSchema.parse(event);
    assert.equal(result.data.session_id, 'sess-001');
    assert.equal(result.data.session_type, 'interactive');
  });

  it('validates session_ended', () => {
    const event = makeEvent('memory.session_ended', {
      session_id: 'sess-001',
      end_time: new Date().toISOString(),
      duration_ms: 300000,
      turn_count: 42,
    });
    const result = SessionEndedSchema.parse(event);
    assert.equal(result.data.duration_ms, 300000);
  });

  it('validates turn_recorded', () => {
    const event = makeEvent('memory.turn_recorded', {
      session_id: 'sess-001',
      turn_index: 5,
      role: 'user',
      content_hash: 'abc123',
    });
    const result = TurnRecordedSchema.parse(event);
    assert.equal(result.data.turn_index, 5);
    assert.equal(result.data.role, 'user');
  });

  it('validates fact_extracted', () => {
    const event = makeEvent('memory.fact_extracted', {
      session_id: 'sess-001',
      fact: 'User prefers dark mode',
      category: 'preference',
      speaker: 'user',
    });
    const result = FactExtractedSchema.parse(event);
    assert.equal(result.data.fact, 'User prefers dark mode');
  });

  it('validates concept_mentioned', () => {
    const event = makeEvent('memory.concept_mentioned', {
      session_id: 'sess-001',
      concept_name: 'NATS JetStream',
      turn_index: 3,
      salience: 0.85,
    });
    const result = ConceptMentionedSchema.parse(event);
    assert.equal(result.data.concept_name, 'NATS JetStream');
  });

  it('validates snapshot_taken', () => {
    const event = makeEvent('memory.snapshot_taken', {
      session_id: 'sess-001',
      snapshot_type: 'memory',
      content_hash: 'sha256-abc',
      byte_count: 4096,
    });
    const result = SnapshotTakenSchema.parse(event);
    assert.equal(result.data.snapshot_type, 'memory');
  });

  it('validates compaction_triggered', () => {
    const event = makeEvent('memory.compaction_triggered', {
      session_id: 'sess-001',
      trigger: 'budget_exceeded',
      entries_before: 50,
      entries_after: 30,
    });
    const result = CompactionTriggeredSchema.parse(event);
    assert.equal(result.data.trigger, 'budget_exceeded');
  });

  it('validates artifact_attached', () => {
    const event = makeEvent('memory.artifact_attached', {
      session_id: 'sess-001',
      artifact_ref: 'sha256:abcdef123456',
      mime_type: 'application/json',
      filename: 'data.json',
      byte_count: 2048,
    });
    const result = ArtifactAttachedSchema.parse(event);
    assert.equal(result.data.artifact_ref, 'sha256:abcdef123456');
  });
});

describe('MemoryEventSchema discriminated union', () => {
  it('routes to the correct schema by event_type', () => {
    const event = {
      ...makeEnvelope({ event_type: 'memory.fact_extracted' }),
      data: {
        session_id: 'sess-001',
        fact: 'Test fact',
        category: 'test',
        speaker: 'user',
      },
    };
    const result = MemoryEventSchema.parse(event);
    assert.equal(result.event_type, 'memory.fact_extracted');
    assert.equal(result.data.fact, 'Test fact');
  });

  it('rejects an unknown event_type', () => {
    const event = {
      ...makeEnvelope({ event_type: 'memory.unknown_event' }),
      data: {},
    };
    assert.throws(() => {
      MemoryEventSchema.parse(event);
    });
  });
});

describe('toJsonSchema', () => {
  it('generates a JSON Schema object with definitions', () => {
    const schema = toJsonSchema();
    assert.equal(typeof schema, 'object');
    assert.ok(schema.$schema || schema.definitions || schema.$defs,
      'should have $schema, definitions, or $defs');
  });
});
