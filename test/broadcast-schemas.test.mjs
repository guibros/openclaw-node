import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContextBroadcastSchema,
  ContextOfferSchema,
  ContextAcceptedSchema,
  BroadcastEventSchema,
} from '../packages/event-schemas/dist/index.js';

function makeEnvelope(overrides = {}) {
  return {
    event_id: randomUUID(),
    event_type: 'context.broadcast',
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

describe('ContextBroadcastSchema', () => {
  it('validates a valid broadcast event', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.broadcast' }),
      data: {
        themes: ['memory-architecture', 'federation'],
        entities: ['NATS JetStream', 'SQLite'],
        problem_class: 'design',
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: 'abc123def456',
      },
    };
    const result = ContextBroadcastSchema.parse(event);
    assert.deepEqual(result.data.themes, ['memory-architecture', 'federation']);
    assert.equal(result.data.intensity, 'actively_seeking');
    assert.equal(result.data.ttl_minutes, 60);
    assert.equal(result.data.dedup_key, 'abc123def456');
  });

  it('allows optional problem_class', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.broadcast' }),
      data: {
        themes: ['testing'],
        entities: [],
        intensity: 'passive',
        ttl_minutes: 30,
        dedup_key: 'key1',
      },
    };
    const result = ContextBroadcastSchema.parse(event);
    assert.equal(result.data.problem_class, undefined);
  });

  it('rejects invalid intensity value', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.broadcast' }),
      data: {
        themes: ['testing'],
        entities: [],
        intensity: 'urgent',
        ttl_minutes: 30,
        dedup_key: 'key1',
      },
    };
    assert.throws(() => ContextBroadcastSchema.parse(event));
  });
});

describe('ContextOfferSchema', () => {
  it('validates a valid offer event', () => {
    const broadcastId = randomUUID();
    const event = {
      ...makeEnvelope({ event_type: 'context.offer' }),
      data: {
        responding_to: broadcastId,
        offerer_node_id: 'peer-node-1',
        artifacts: [
          {
            artifact_ref: 'sha256:abcdef123456',
            relevance_score: 0.85,
            provenance: { source_node: 'peer-node-1', source_type: 'local' },
            summary: 'Relevant concept about NATS federation patterns',
          },
        ],
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    };
    const result = ContextOfferSchema.parse(event);
    assert.equal(result.data.responding_to, broadcastId);
    assert.equal(result.data.offerer_node_id, 'peer-node-1');
    assert.equal(result.data.artifacts.length, 1);
    assert.equal(result.data.artifacts[0].relevance_score, 0.85);
  });

  it('rejects non-uuid responding_to', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.offer' }),
      data: {
        responding_to: 'not-a-uuid',
        offerer_node_id: 'peer-node-1',
        artifacts: [],
        expires_at: new Date().toISOString(),
      },
    };
    assert.throws(() => ContextOfferSchema.parse(event));
  });

  it('validates multiple artifacts', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.offer' }),
      data: {
        responding_to: randomUUID(),
        offerer_node_id: 'peer-node-2',
        artifacts: [
          {
            artifact_ref: 'sha256:aaa',
            relevance_score: 0.9,
            provenance: { source_node: 'peer-node-2', source_type: 'local' },
            summary: 'First artifact',
          },
          {
            artifact_ref: 'sha256:bbb',
            relevance_score: 0.7,
            provenance: { source_node: 'peer-node-2', source_type: 'shared' },
            summary: 'Second artifact',
          },
        ],
        expires_at: new Date(Date.now() + 7200000).toISOString(),
      },
    };
    const result = ContextOfferSchema.parse(event);
    assert.equal(result.data.artifacts.length, 2);
  });
});

describe('ContextAcceptedSchema', () => {
  it('validates a valid accepted event with feedback', () => {
    const offerId = randomUUID();
    const event = {
      ...makeEnvelope({ event_type: 'context.accepted' }),
      data: {
        responding_to: offerId,
        accepted_artifacts: ['sha256:abcdef123456'],
        feedback: { useful: true, note: 'Helped solve the design problem' },
      },
    };
    const result = ContextAcceptedSchema.parse(event);
    assert.equal(result.data.responding_to, offerId);
    assert.deepEqual(result.data.accepted_artifacts, ['sha256:abcdef123456']);
    assert.equal(result.data.feedback.useful, true);
  });

  it('allows optional feedback', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.accepted' }),
      data: {
        responding_to: randomUUID(),
        accepted_artifacts: ['sha256:abc'],
      },
    };
    const result = ContextAcceptedSchema.parse(event);
    assert.equal(result.data.feedback, undefined);
  });

  it('allows feedback without note', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.accepted' }),
      data: {
        responding_to: randomUUID(),
        accepted_artifacts: [],
        feedback: { useful: false },
      },
    };
    const result = ContextAcceptedSchema.parse(event);
    assert.equal(result.data.feedback.useful, false);
    assert.equal(result.data.feedback.note, undefined);
  });
});

describe('BroadcastEventSchema discriminated union', () => {
  it('routes to ContextBroadcastSchema by event_type', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.broadcast' }),
      data: {
        themes: ['test'],
        entities: [],
        intensity: 'interested',
        ttl_minutes: 45,
        dedup_key: 'dk1',
      },
    };
    const result = BroadcastEventSchema.parse(event);
    assert.equal(result.event_type, 'context.broadcast');
    assert.deepEqual(result.data.themes, ['test']);
  });

  it('routes to ContextOfferSchema by event_type', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.offer' }),
      data: {
        responding_to: randomUUID(),
        offerer_node_id: 'node-x',
        artifacts: [],
        expires_at: new Date().toISOString(),
      },
    };
    const result = BroadcastEventSchema.parse(event);
    assert.equal(result.event_type, 'context.offer');
  });

  it('rejects unknown broadcast event_type', () => {
    const event = {
      ...makeEnvelope({ event_type: 'context.unknown' }),
      data: {},
    };
    assert.throws(() => BroadcastEventSchema.parse(event));
  });
});
