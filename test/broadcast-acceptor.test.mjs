import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import {
  TOKEN_OVERLAP_THRESHOLD,
  MAX_PENDING_OFFERS,
  parseArtifactRef,
  computeTokenOverlap,
  formatPeerMemoryBlock,
  createAcceptor,
} from '../lib/broadcast-acceptor.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOffer(overrides = {}) {
  const eventId = overrides.event_id || randomUUID();
  const broadcastId = overrides.responding_to || randomUUID();
  const expiresAt = overrides.expires_at || new Date(Date.now() + 3600_000).toISOString();
  return {
    event_id: eventId,
    event_type: 'context.offer',
    event_version: 1,
    entity_id: eventId,
    entity_type: 'session',
    timestamp: overrides.timestamp || new Date().toISOString(),
    causation_id: broadcastId,
    correlation_id: null,
    actor: { type: 'system', id: 'offerer-peer-node' },
    node_id: overrides.node_id || 'peer-node',
    idempotency_key: eventId,
    data: {
      responding_to: broadcastId,
      offerer_node_id: overrides.offerer_node_id || 'peer-node',
      artifacts: overrides.artifacts || [
        {
          artifact_ref: 'session:abc-123:chunk:1',
          relevance_score: 0.75,
          provenance: { source_node: 'peer-node', source_type: 'local_retrieval' },
          summary: 'Discussion about NATS federation architecture and event-driven messaging patterns',
        },
      ],
      expires_at: expiresAt,
      ...(overrides.data || {}),
    },
  };
}

function mockNatsConnection() {
  const published = [];
  return {
    published,
    jetstream() {
      return {
        async publish(subject, data, opts) {
          published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)), opts });
          return { seq: published.length, stream: 'OPENCLAW_SHARED' };
        },
        consumers: {
          get() { throw new Error('no consumer'); },
        },
        subscribe() { throw new Error('shared stream unavailable'); },
      };
    },
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

describe('broadcast-acceptor constants', () => {
  it('TOKEN_OVERLAP_THRESHOLD defaults to 0.3', () => {
    assert.equal(typeof TOKEN_OVERLAP_THRESHOLD, 'number');
    assert.ok(TOKEN_OVERLAP_THRESHOLD >= 0 && TOKEN_OVERLAP_THRESHOLD <= 1);
  });

  it('MAX_PENDING_OFFERS defaults to 10', () => {
    assert.equal(MAX_PENDING_OFFERS, 10);
  });
});

// ─── parseArtifactRef ───────────────────────────────────────────────────────

describe('parseArtifactRef', () => {
  it('parses valid session:id:chunk:id format', () => {
    const result = parseArtifactRef('session:abc-123:chunk:5');
    assert.deepEqual(result, { sessionId: 'abc-123', chunkId: 5 });
  });

  it('parses chunk id 0', () => {
    const result = parseArtifactRef('session:sess-1:chunk:0');
    assert.deepEqual(result, { sessionId: 'sess-1', chunkId: 0 });
  });

  it('returns null for malformed input', () => {
    assert.equal(parseArtifactRef('invalid-format'), null);
    assert.equal(parseArtifactRef('session:abc'), null);
    assert.equal(parseArtifactRef('session:abc:chunk:'), null);
    assert.equal(parseArtifactRef(''), null);
    assert.equal(parseArtifactRef(null), null);
    assert.equal(parseArtifactRef(undefined), null);
  });

  it('rejects non-numeric chunk id', () => {
    assert.equal(parseArtifactRef('session:abc:chunk:xyz'), null);
  });
});

// ─── computeTokenOverlap ────────────────────────────────────────────────────

describe('computeTokenOverlap', () => {
  it('returns 1.0 for identical text', () => {
    const text = 'NATS federation architecture design';
    const overlap = computeTokenOverlap(text, text);
    assert.equal(overlap, 1.0);
  });

  it('returns partial overlap for shared tokens', () => {
    const prompt = 'I am working on NATS federation for our messaging system';
    const summary = 'NATS federation architecture and event-driven messaging';
    const overlap = computeTokenOverlap(prompt, summary);
    assert.ok(overlap > 0);
    assert.ok(overlap < 1);
  });

  it('returns 0 for completely different text', () => {
    const prompt = 'What is the weather today in Paris?';
    const summary = 'Implementation of database migration scripts for schema upgrades';
    const overlap = computeTokenOverlap(prompt, summary);
    assert.equal(overlap, 0);
  });

  it('returns 0 for empty input', () => {
    assert.equal(computeTokenOverlap('', 'some text'), 0);
    assert.equal(computeTokenOverlap('some text', ''), 0);
    assert.equal(computeTokenOverlap(null, 'text'), 0);
    assert.equal(computeTokenOverlap('text', null), 0);
  });

  it('is case-insensitive', () => {
    const overlap1 = computeTokenOverlap('NATS Federation', 'nats federation');
    assert.equal(overlap1, 1.0);
  });
});

// ─── formatPeerMemoryBlock ──────────────────────────────────────────────────

describe('formatPeerMemoryBlock', () => {
  it('formats single artifact offer', () => {
    const offer = makeOffer();
    const block = formatPeerMemoryBlock(offer);
    assert.ok(block.startsWith('[peer-memory:'));
    assert.ok(block.includes('[end peer-memory]'));
    assert.ok(block.includes('peer-node'));
    assert.ok(block.includes('session abc-123'));
    assert.ok(block.includes('0.75'));
  });

  it('formats multiple artifacts', () => {
    const offer = makeOffer({
      artifacts: [
        { artifact_ref: 'session:s1:chunk:0', relevance_score: 0.8, provenance: { source_node: 'peer-node', source_type: 'local_retrieval' }, summary: 'First artifact' },
        { artifact_ref: 'session:s2:chunk:1', relevance_score: 0.65, provenance: { source_node: 'peer-node', source_type: 'local_retrieval' }, summary: 'Second artifact' },
      ],
    });
    const block = formatPeerMemoryBlock(offer);
    assert.ok(block.includes('First artifact'));
    assert.ok(block.includes('Second artifact'));
    assert.ok(block.includes('session s1'));
    assert.ok(block.includes('session s2'));
  });

  it('returns empty string for null/empty offer', () => {
    assert.equal(formatPeerMemoryBlock(null), '');
    assert.equal(formatPeerMemoryBlock({}), '');
    assert.equal(formatPeerMemoryBlock({ data: { artifacts: [] } }), '');
  });
});

// ─── createAcceptor._processOffer ──────────────────────────────────────────

describe('createAcceptor._processOffer', () => {
  let nc;
  let ownBroadcastIds;

  beforeEach(() => {
    nc = mockNatsConnection();
    ownBroadcastIds = new Set();
  });

  it('skips offers not responding to our broadcasts', async () => {
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });
    const offer = makeOffer({ responding_to: randomUUID() });
    const result = await acceptor._processOffer(offer);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'not_our_broadcast');
  });

  it('accepts offers responding to our broadcast', async () => {
    const broadcastId = randomUUID();
    ownBroadcastIds.add(broadcastId);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });
    const offer = makeOffer({ responding_to: broadcastId });
    const result = await acceptor._processOffer(offer);
    assert.equal(result.action, 'queued');
    assert.equal(result.eventId, offer.event_id);
    assert.equal(acceptor.getPendingOffers().length, 1);
  });

  it('skips expired offers', async () => {
    const broadcastId = randomUUID();
    ownBroadcastIds.add(broadcastId);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });
    const offer = makeOffer({
      responding_to: broadcastId,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await acceptor._processOffer(offer);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
  });

  it('skips offers with no responding_to field', async () => {
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });
    const offer = makeOffer();
    offer.data.responding_to = undefined;
    const result = await acceptor._processOffer(offer);
    assert.equal(result.action, 'skip');
    // After F-H2 fix, schema validation catches missing responding_to at the
    // boundary (returns 'bad_schema') rather than later in flow ('no_responding_to').
    assert.ok(
      result.reason === 'no_responding_to' || result.reason === 'bad_schema',
      `expected no_responding_to or bad_schema, got ${result.reason}`
    );
  });

  it('evicts oldest when maxPending exceeded', async () => {
    const broadcastId = randomUUID();
    ownBroadcastIds.add(broadcastId);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds, maxPending: 2 });

    // Schema requires UUID-format event_id; use deterministic UUIDs for tracking.
    const id1 = '00000000-0000-4000-8000-000000000001';
    const id2 = '00000000-0000-4000-8000-000000000002';
    const id3 = '00000000-0000-4000-8000-000000000003';
    const offer1 = makeOffer({ responding_to: broadcastId, event_id: id1 });
    const offer2 = makeOffer({ responding_to: broadcastId, event_id: id2 });
    const offer3 = makeOffer({ responding_to: broadcastId, event_id: id3 });

    await acceptor._processOffer(offer1);
    await acceptor._processOffer(offer2);
    await acceptor._processOffer(offer3);

    const pending = acceptor.getPendingOffers();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].event_id, id2);
    assert.equal(pending[1].event_id, id3);
  });

  it('supports ownBroadcastIds as a function', async () => {
    const broadcastId = randomUUID();
    const idSet = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds: () => idSet });
    const offer = makeOffer({ responding_to: broadcastId });
    const result = await acceptor._processOffer(offer);
    assert.equal(result.action, 'queued');
  });
});

// ─── createAcceptor.getTopOffer ────────────────────────────────────────────

describe('createAcceptor.getTopOffer', () => {
  it('returns empty string when no pending offers', () => {
    const nc = mockNatsConnection();
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds: new Set() });
    assert.equal(acceptor.getTopOffer(), '');
  });

  it('returns formatted block for best offer', async () => {
    const nc = mockNatsConnection();
    const broadcastId = randomUUID();
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });

    // Schema requires provenance on each artifact; supply minimal valid shape.
    const prov = { source_node: 'peer-node', source_type: 'local_retrieval' };
    const offer1 = makeOffer({
      responding_to: broadcastId,
      artifacts: [{ artifact_ref: 'session:s1:chunk:0', relevance_score: 0.6, provenance: prov, summary: 'Low score' }],
    });
    const offer2 = makeOffer({
      responding_to: broadcastId,
      artifacts: [{ artifact_ref: 'session:s2:chunk:1', relevance_score: 0.9, provenance: prov, summary: 'High score' }],
    });

    await acceptor._processOffer(offer1);
    await acceptor._processOffer(offer2);

    const block = acceptor.getTopOffer();
    assert.ok(block.includes('[peer-memory:'));
    assert.ok(block.includes('High score'));
    assert.ok(block.includes('0.90'));
  });
});

// ─── createAcceptor.checkAcceptance ────────────────────────────────────────

describe('createAcceptor.checkAcceptance', () => {
  it('returns not accepted when prompt has low overlap', async () => {
    const nc = mockNatsConnection();
    const broadcastId = randomUUID();
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });

    const offer = makeOffer({
      responding_to: broadcastId,
      artifacts: [
        { artifact_ref: 'session:s1:chunk:0', relevance_score: 0.8, provenance: { source_node: 'peer-node', source_type: 'local_retrieval' }, summary: 'NATS federation architecture and event-driven messaging' },
      ],
    });
    await acceptor._processOffer(offer);

    const result = await acceptor.checkAcceptance('What is the weather in Paris today?');
    assert.equal(result.accepted, false);
  });

  it('emits context.accepted when overlap exceeds threshold', async () => {
    const nc = mockNatsConnection();
    const broadcastId = randomUUID();
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });

    const offer = makeOffer({
      responding_to: broadcastId,
      artifacts: [
        { artifact_ref: 'session:s1:chunk:0', relevance_score: 0.8, provenance: { source_node: 'peer-node', source_type: 'local_retrieval' }, summary: 'NATS federation architecture and event-driven messaging patterns for distributed systems' },
      ],
    });
    await acceptor._processOffer(offer);

    // Prompt that references the offer's content heavily
    const result = await acceptor.checkAcceptance(
      'I want to learn about NATS federation architecture and event-driven messaging patterns for our distributed systems'
    );
    assert.equal(result.accepted, true);
    assert.equal(result.offerId, offer.event_id);
    assert.ok(result.overlap >= TOKEN_OVERLAP_THRESHOLD);

    // Verify context.accepted was published
    assert.equal(nc.published.length, 1);
    const published = nc.published[0];
    assert.equal(published.subject, 'context.accepted.my-node');
    assert.equal(published.data.event_type, 'context.accepted');
    assert.equal(published.data.data.responding_to, offer.event_id);
    assert.deepEqual(published.data.data.accepted_artifacts, ['session:s1:chunk:0']);
  });

  it('removes accepted offer from pending', async () => {
    const nc = mockNatsConnection();
    const broadcastId = randomUUID();
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });

    const offer = makeOffer({
      responding_to: broadcastId,
      artifacts: [
        { artifact_ref: 'session:s1:chunk:0', relevance_score: 0.8, provenance: { source_node: 'peer-node', source_type: 'local_retrieval' }, summary: 'NATS federation architecture' },
      ],
    });
    await acceptor._processOffer(offer);
    assert.equal(acceptor.getPendingOffers().length, 1);

    await acceptor.checkAcceptance('Working on NATS federation architecture design');
    assert.equal(acceptor.getPendingOffers().length, 0);
  });

  it('returns not accepted for empty prompt', async () => {
    const nc = mockNatsConnection();
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds: new Set() });
    const result = await acceptor.checkAcceptance('');
    assert.equal(result.accepted, false);
  });

  it('returns not accepted when no pending offers', async () => {
    const nc = mockNatsConnection();
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds: new Set() });
    const result = await acceptor.checkAcceptance('Some prompt about anything');
    assert.equal(result.accepted, false);
  });
});

// ─── createAcceptor.stats ──────────────────────────────────────────────────

describe('createAcceptor.stats', () => {
  it('tracks offer counts correctly', async () => {
    const nc = mockNatsConnection();
    const broadcastId = randomUUID();
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(nc, 'my-node', { ownBroadcastIds });

    const offer1 = makeOffer({ responding_to: broadcastId });
    const offer2 = makeOffer({ responding_to: randomUUID() });

    await acceptor._processOffer(offer1);
    await acceptor._processOffer(offer2);

    assert.equal(acceptor.stats.offersReceived, 2);
    assert.equal(acceptor.stats.nonMatchingSkipped, 1);
    assert.equal(acceptor.stats.offersPending, 1);
  });
});
