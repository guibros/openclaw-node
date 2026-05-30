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
  MemoryIngestedSchema,
  MemoryExtractedSchema,
  MemoryRetrievedSchema,
  MemoryInjectedSchema,
  MemorySynthesizedSchema,
  MemoryDecayedSchema,
  MemoryPromotedSchema,
  MemoryErrorSchema,
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

describe('Boundary event schemas (Block 1 vocabulary)', () => {
  function makeMemEvent(eventType, data) {
    return {
      ...makeEnvelope({ event_type: eventType, entity_type: 'memory' }),
      data,
    };
  }

  it('validates memory.ingested', () => {
    const event = makeMemEvent('memory.ingested', {
      session_id: 'sess-001',
      source: '~/.claude/projects/-Users-moltymac-openclaw-workspace/',
      messages_added: 12,
      total_messages: 42,
    });
    const result = MemoryIngestedSchema.parse(event);
    assert.equal(result.data.messages_added, 12);
    assert.equal(result.data.source, '~/.claude/projects/-Users-moltymac-openclaw-workspace/');
  });

  it('validates memory.extracted', () => {
    const event = makeMemEvent('memory.extracted', {
      session_id: 'sess-001',
      entities_count: 5,
      themes_count: 3,
      mentions_count: 8,
      decisions_count: 2,
      model: 'qwen3:8b',
      duration_ms: 4200,
    });
    const result = MemoryExtractedSchema.parse(event);
    assert.equal(result.data.entities_count, 5);
    assert.equal(result.data.model, 'qwen3:8b');
  });

  it('validates memory.retrieved', () => {
    const event = makeMemEvent('memory.retrieved', {
      query_hash: 'sha256-abc123',
      channels_hit: 4,
      results_count: 15,
      duration_ms: 87,
    });
    const result = MemoryRetrievedSchema.parse(event);
    assert.equal(result.data.channels_hit, 4);
    assert.equal(result.data.results_count, 15);
  });

  it('validates memory.injected', () => {
    const event = makeMemEvent('memory.injected', {
      request_id: 'req-001',
      token_count: 1200,
      blocks_count: 3,
      duration_ms: 45,
    });
    const result = MemoryInjectedSchema.parse(event);
    assert.equal(result.data.token_count, 1200);
    assert.equal(result.data.blocks_count, 3);
  });

  it('validates memory.synthesized', () => {
    const event = makeMemEvent('memory.synthesized', {
      trigger: 'session_end',
      artifacts_written: ['MEMORY.md', 'concepts/nats-jetstream.md'],
      duration_ms: 3500,
    });
    const result = MemorySynthesizedSchema.parse(event);
    assert.equal(result.data.trigger, 'session_end');
    assert.equal(result.data.artifacts_written.length, 2);
  });

  it('validates memory.decayed', () => {
    const event = makeMemEvent('memory.decayed', {
      entities_decayed: 14,
      duration_ms: 230,
    });
    const result = MemoryDecayedSchema.parse(event);
    assert.equal(result.data.entities_decayed, 14);
  });

  it('validates memory.promoted', () => {
    const event = makeMemEvent('memory.promoted', {
      entities_promoted: 3,
      duration_ms: 150,
    });
    const result = MemoryPromotedSchema.parse(event);
    assert.equal(result.data.entities_promoted, 3);
  });

  it('validates memory.error', () => {
    const event = makeMemEvent('memory.error', {
      boundary: 'extract',
      error_code: 'ZOD_VALIDATION',
      error_message: 'Missing required field: actions',
      session_id: 'sess-001',
    });
    const result = MemoryErrorSchema.parse(event);
    assert.equal(result.data.boundary, 'extract');
    assert.equal(result.data.error_code, 'ZOD_VALIDATION');
  });

  it('memory.error accepts optional session_id', () => {
    const event = makeMemEvent('memory.error', {
      boundary: 'retrieve',
      error_code: 'TIMEOUT',
      error_message: 'Channel 2 timed out',
    });
    const result = MemoryErrorSchema.parse(event);
    assert.equal(result.data.session_id, undefined);
  });

  it('all 8 boundary events route through MemoryEventSchema discriminated union', () => {
    const events = [
      makeMemEvent('memory.ingested', { session_id: 's', source: 'x', messages_added: 0, total_messages: 0 }),
      makeMemEvent('memory.extracted', { session_id: 's', entities_count: 0, themes_count: 0, mentions_count: 0, decisions_count: 0, model: 'm', duration_ms: 0 }),
      makeMemEvent('memory.retrieved', { query_hash: 'h', channels_hit: 0, results_count: 0, duration_ms: 0 }),
      makeMemEvent('memory.injected', { request_id: 'r', token_count: 0, blocks_count: 0, duration_ms: 0 }),
      makeMemEvent('memory.synthesized', { trigger: 'manual', artifacts_written: [], duration_ms: 0 }),
      makeMemEvent('memory.decayed', { entities_decayed: 0, duration_ms: 0 }),
      makeMemEvent('memory.promoted', { entities_promoted: 0, duration_ms: 0 }),
      makeMemEvent('memory.error', { boundary: 'ingest', error_code: 'E', error_message: 'msg' }),
    ];
    for (const event of events) {
      const result = MemoryEventSchema.safeParse(event);
      assert.equal(result.success, true, `Failed for ${event.event_type}: ${JSON.stringify(result.error?.issues)}`);
    }
  });
});

describe('buildMemoryEvent produces valid boundary events (Block 1 producers)', () => {
  let buildMemoryEvent;
  it('loads buildMemoryEvent', async () => {
    ({ buildMemoryEvent } = await import('../lib/local-event-log.mjs'));
  });

  it('buildMemoryEvent("memory.ingested") passes MemoryIngestedSchema', () => {
    const event = buildMemoryEvent('memory.ingested', 'sess-test-001', 'memory', {
      session_id: 'sess-test-001',
      source: 'claude-code',
      messages_added: 42,
      total_messages: 42,
    }, 'daedalus');
    const result = MemoryIngestedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
    assert.equal(result.data.data.session_id, 'sess-test-001');
    assert.equal(result.data.data.source, 'claude-code');
    assert.equal(result.data.data.messages_added, 42);
    assert.equal(result.data.node_id, 'daedalus');
    assert.equal(result.data.actor.type, 'system');
  });

  it('buildMemoryEvent("memory.extracted") passes MemoryExtractedSchema', () => {
    const event = buildMemoryEvent('memory.extracted', 'sess-test-002', 'memory', {
      session_id: 'sess-test-002',
      entities_count: 5,
      themes_count: 3,
      mentions_count: 5,
      decisions_count: 2,
      model: 'qwen3:8b',
      duration_ms: 12345,
    }, 'daedalus');
    const result = MemoryExtractedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
    assert.equal(result.data.data.session_id, 'sess-test-002');
    assert.equal(result.data.data.entities_count, 5);
    assert.equal(result.data.data.themes_count, 3);
    assert.equal(result.data.data.mentions_count, 5);
    assert.equal(result.data.data.decisions_count, 2);
    assert.equal(result.data.data.model, 'qwen3:8b');
    assert.equal(result.data.data.duration_ms, 12345);
    assert.equal(result.data.node_id, 'daedalus');
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
