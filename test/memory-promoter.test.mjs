/**
 * memory-promoter.test.mjs — Unit tests for bin/memory-promoter.mjs
 *
 * Tests the promoter daemon's policy evaluation, subject mapping,
 * and backoff controller. Uses mock objects (no live NATS required).
 *
 * Run: node --test test/memory-promoter.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePromotionPolicy,
  mapToSharedSubject,
  createBackoff,
} from '../bin/memory-promoter.mjs';

// ── Fixtures ─────────────────────────────────────────────

const DEFAULT_POLICY = {
  automatic: ['kanban_events'],
  explicit: ['share_true'],
  threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
  manual_review: ['everything_else'],
};

function makeEvent(overrides = {}) {
  return {
    event_id: 'evt-001',
    event_type: 'memory.session_started',
    event_version: 1,
    entity_id: 'sess-001',
    entity_type: 'session',
    timestamp: new Date().toISOString(),
    causation_id: null,
    correlation_id: null,
    actor: { type: 'system', id: 'daemon-test' },
    node_id: 'test-node',
    idempotency_key: 'key-001',
    data: {},
    ...overrides,
  };
}

// ── evaluatePromotionPolicy ──────────────────────────────

describe('evaluatePromotionPolicy', () => {
  it('promotes kanban events as automatic', () => {
    const event = makeEvent({
      event_type: 'kanban.task_created',
      entity_type: 'task',
      entity_id: 'task-001',
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'promote');
    assert.equal(result.category, 'automatic');
    assert.equal(result.reason, 'kanban_events');
  });

  it('promotes events with share:true in data as explicit', () => {
    const event = makeEvent({
      event_type: 'memory.fact_extracted',
      entity_type: 'memory',
      data: { share: true, fact: 'some fact' },
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'promote');
    assert.equal(result.category, 'explicit');
    assert.equal(result.reason, 'share_true');
  });

  it('promotes concepts with mention_count >= threshold', () => {
    const event = makeEvent({
      event_type: 'memory.concept_mentioned',
      entity_type: 'memory',
      entity_id: 'concept-nats',
      data: { mention_count: 15, concept: 'NATS JetStream' },
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'promote');
    assert.equal(result.category, 'threshold');
    assert.ok(result.reason.includes('concept_mention_count'));
  });

  it('promotes decisions with confidence >= threshold', () => {
    const event = makeEvent({
      event_type: 'memory.fact_extracted',
      entity_type: 'memory',
      data: { confidence: 0.98, decision: 'Use NATS over RabbitMQ' },
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'promote');
    assert.equal(result.category, 'threshold');
    assert.ok(result.reason.includes('decision_confidence'));
  });

  it('queues for review when concept_mention_count below threshold', () => {
    const event = makeEvent({
      event_type: 'memory.concept_mentioned',
      entity_type: 'memory',
      data: { mention_count: 3, concept: 'minor concept' },
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'queue_for_review');
    assert.equal(result.category, 'manual_review');
  });

  it('queues unrelated memory events for review', () => {
    const event = makeEvent({
      event_type: 'memory.session_started',
      entity_type: 'session',
      data: {},
    });
    const result = evaluatePromotionPolicy(event, DEFAULT_POLICY);
    assert.equal(result.decision, 'queue_for_review');
    assert.equal(result.category, 'manual_review');
  });
});

// ── mapToSharedSubject ───────────────────────────────────

describe('mapToSharedSubject', () => {
  it('maps kanban events to kanban.events.* subject', () => {
    const event = makeEvent({
      event_type: 'kanban.task_created',
      entity_type: 'task',
      entity_id: 'task-42',
    });
    const subject = mapToSharedSubject(event);
    assert.equal(subject, 'kanban.events.task-42.kanban.task_created');
  });

  it('maps concept_mentioned events to concepts.shared.* subject', () => {
    const event = makeEvent({
      event_type: 'memory.concept_mentioned',
      entity_id: 'concept-nats',
    });
    const subject = mapToSharedSubject(event);
    assert.equal(subject, 'concepts.shared.concept-nats');
  });

  it('maps fact_extracted events to lessons.shared.* subject', () => {
    const event = makeEvent({
      event_type: 'memory.fact_extracted',
      entity_id: 'sess-001',
    });
    const subject = mapToSharedSubject(event);
    assert.equal(subject, 'lessons.shared.sess-001');
  });
});

// ── createBackoff ────────────────────────────────────────

describe('createBackoff', () => {
  it('increases delay exponentially with cap and resets', () => {
    const b = createBackoff({ baseDelay: 100, maxDelay: 1000, multiplier: 2 });

    // Initial state
    assert.equal(b.failures, 0);
    assert.equal(b.getDelay(), 100);

    // First failure: 100 * 2 = 200
    const d1 = b.recordFailure();
    assert.equal(d1, 200);
    assert.equal(b.failures, 1);

    // Second failure: 200 * 2 = 400
    const d2 = b.recordFailure();
    assert.equal(d2, 400);
    assert.equal(b.failures, 2);

    // Third failure: 400 * 2 = 800
    const d3 = b.recordFailure();
    assert.equal(d3, 800);

    // Fourth failure: 800 * 2 = 1600 → capped at 1000
    const d4 = b.recordFailure();
    assert.equal(d4, 1000);
    assert.equal(b.failures, 4);

    // Reset
    b.reset();
    assert.equal(b.failures, 0);
    assert.equal(b.getDelay(), 100);
  });
});
