import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateIngestionPolicy,
  parseSharedSubject,
} from '../bin/memory-subscriber.mjs';
import { createBackoff } from '../bin/memory-promoter.mjs';

// ── parseSharedSubject ───────────────────────────────────

describe('parseSharedSubject', () => {
  it('parses kanban subject', () => {
    const result = parseSharedSubject('kanban.events.task-1.kanban.created');
    assert.deepStrictEqual(result, {
      category: 'kanban',
      remainder: 'task-1.kanban.created',
    });
  });

  it('parses concept subject', () => {
    const result = parseSharedSubject('concepts.shared.entity-abc');
    assert.deepStrictEqual(result, {
      category: 'concept',
      remainder: 'entity-abc',
    });
  });

  it('parses lesson subject', () => {
    const result = parseSharedSubject('lessons.shared.fact-xyz');
    assert.deepStrictEqual(result, {
      category: 'lesson',
      remainder: 'fact-xyz',
    });
  });

  it('parses artifact subject', () => {
    const result = parseSharedSubject('artifacts.shared.sha256-abc');
    assert.deepStrictEqual(result, {
      category: 'artifact',
      remainder: 'sha256-abc',
    });
  });

  it('returns null for unknown subject', () => {
    const result = parseSharedSubject('unknown.subject.foo');
    assert.strictEqual(result, null);
  });

  it('returns null for non-string input', () => {
    assert.strictEqual(parseSharedSubject(null), null);
    assert.strictEqual(parseSharedSubject(42), null);
  });
});

// ── evaluateIngestionPolicy ──────────────────────────────

describe('evaluateIngestionPolicy', () => {
  const nodeId = 'node-A';

  it('skips self-originated events', () => {
    const event = { promoted_from: { node_id: 'node-A' } };
    const parsed = { category: 'kanban', remainder: 'task-1' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'self_originated');
  });

  it('accepts kanban events unconditionally from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const parsed = { category: 'kanban', remainder: 'task-1.kanban.created' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'kanban_always_ingest');
  });

  it('accepts concept events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-C' } };
    const parsed = { category: 'concept', remainder: 'entity-abc' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_concept');
  });

  it('accepts lesson events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-D' } };
    const parsed = { category: 'lesson', remainder: 'fact-xyz' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_lesson');
  });

  it('accepts artifact events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-E' } };
    const parsed = { category: 'artifact', remainder: 'sha-abc' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_artifact');
  });

  it('skips broadcast/offer/accepted (Block 9 scope)', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const parsed = { category: 'broadcast', remainder: 'topic-1' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'deferred_to_block_9');
  });

  it('skips events with null parsed subject', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const result = evaluateIngestionPolicy(event, nodeId, null);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'unknown_subject');
  });
});

// ── createBackoff reuse ──────────────────────────────────

describe('createBackoff import reuse', () => {
  it('createBackoff imported from promoter works for subscriber', () => {
    const backoff = createBackoff({ baseDelay: 500, maxDelay: 5000 });
    assert.strictEqual(backoff.getDelay(), 500);
    backoff.recordFailure();
    assert.strictEqual(backoff.getDelay(), 1000);
    backoff.reset();
    assert.strictEqual(backoff.getDelay(), 500);
  });
});
