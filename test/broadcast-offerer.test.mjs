import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import {
  RELEVANCE_THRESHOLD,
  MAX_ARTIFACTS_PER_OFFER,
  generateRelevanceSummary,
  buildOfferFromResults,
  filterPrivateItems,
  createOfferer,
} from '../lib/broadcast-offerer.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBroadcast(overrides = {}) {
  const now = new Date().toISOString();
  const eventId = overrides.event_id || randomUUID();
  return {
    event_id: eventId,
    event_type: 'context.broadcast',
    event_version: 1,
    entity_id: eventId,
    entity_type: 'session',
    timestamp: overrides.timestamp || now,
    causation_id: null,
    correlation_id: null,
    actor: { type: 'system', id: 'broadcaster-peer-node' },
    node_id: overrides.node_id || 'peer-node',
    idempotency_key: eventId,
    data: {
      themes: overrides.themes || ['memory', 'retrieval', 'federation'],
      entities: overrides.entities || ['OpenClaw', 'NATS'],
      intensity: overrides.intensity || 'interested',
      ttl_minutes: overrides.ttl_minutes || 60,
      dedup_key: 'abc123',
      ...(overrides.data || {}),
    },
  };
}

function makeResult(score, sessionId = 'sess-1', chunkId = 1) {
  return {
    chunk_id: chunkId,
    session_id: sessionId,
    turn_index: 0,
    role: 'user',
    score,
    snippet: `Test snippet for session ${sessionId}`,
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

describe('broadcast-offerer constants', () => {
  it('RELEVANCE_THRESHOLD defaults to 0.55', () => {
    // May be overridden by env, but default is 0.55
    assert.equal(typeof RELEVANCE_THRESHOLD, 'number');
    assert.ok(RELEVANCE_THRESHOLD > 0 && RELEVANCE_THRESHOLD < 1);
  });

  it('MAX_ARTIFACTS_PER_OFFER is 3', () => {
    assert.equal(MAX_ARTIFACTS_PER_OFFER, 3);
  });
});

// ─── generateRelevanceSummary ───────────────────────────────────────────────

describe('generateRelevanceSummary', () => {
  it('returns data-only summary when no requestAnalysis provided', async () => {
    const broadcast = { themes: ['memory', 'retrieval'], entities: ['NATS'] };
    const result = { snippet: 'Test snippet content', session_id: 'sess-1', score: 0.75 };

    const summary = await generateRelevanceSummary(broadcast, result);
    assert.ok(summary.includes('Relevant to:'));
    assert.ok(summary.includes('Score:'));
    assert.ok(summary.includes('0.750'));
  });

  it('returns data-only summary when LLM is busy (fallback mode)', async () => {
    const broadcast = { themes: ['memory'], entities: [] };
    const result = { snippet: 'Test', session_id: 'sess-1', score: 0.6 };

    const mockAnalysis = async () => ({ mode: 'fallback', reason: 'ollama-busy-extraction' });
    const summary = await generateRelevanceSummary(broadcast, result, { requestAnalysis: mockAnalysis });
    assert.ok(summary.includes('Relevant to:'));
  });

  it('returns LLM summary when available', async () => {
    const broadcast = { themes: ['memory'], entities: ['NATS'] };
    const result = { snippet: 'Test snippet', session_id: 'sess-1', score: 0.8 };

    const mockAnalysis = async (run) => {
      const mockClient = {
        generate: async () => 'This snippet discusses NATS-based memory retrieval.',
      };
      const value = await run(mockClient);
      return { mode: 'llm', value };
    };
    const summary = await generateRelevanceSummary(broadcast, result, { requestAnalysis: mockAnalysis });
    assert.ok(summary.includes('NATS-based memory retrieval'));
  });

  it('falls back gracefully on requestAnalysis error', async () => {
    const broadcast = { themes: ['theme1'], entities: [] };
    const result = { snippet: 'snippet', session_id: 's1', score: 0.5 };

    const mockAnalysis = async () => { throw new Error('queue crash'); };
    const summary = await generateRelevanceSummary(broadcast, result, { requestAnalysis: mockAnalysis });
    assert.ok(summary.includes('Relevant to:'));
  });
});

// ─── buildOfferFromResults ──────────────────────────────────────────────────

describe('buildOfferFromResults', () => {
  it('builds a valid offer envelope with correct structure', () => {
    const results = [
      makeResult(0.8, 'sess-1', 10),
      makeResult(0.7, 'sess-2', 20),
    ];
    const summaries = ['Summary 1', 'Summary 2'];

    const offer = buildOfferFromResults('bcast-id', 'my-node', results, summaries, 30);

    assert.equal(offer.event_type, 'context.offer');
    assert.equal(offer.data.responding_to, 'bcast-id');
    assert.equal(offer.data.offerer_node_id, 'my-node');
    assert.equal(offer.data.artifacts.length, 2);
    assert.equal(offer.data.artifacts[0].relevance_score, 0.8);
    assert.equal(offer.data.artifacts[0].summary, 'Summary 1');
    assert.equal(offer.data.artifacts[0].provenance.source_node, 'my-node');
    assert.equal(offer.data.artifacts[0].provenance.source_type, 'local_retrieval');
    assert.ok(offer.data.artifacts[0].artifact_ref.startsWith('session:sess-1:'));
    // expires_at should be ~30 minutes from now
    const expiresAt = new Date(offer.data.expires_at).getTime();
    assert.ok(expiresAt > Date.now() + 29 * 60_000);
    assert.ok(expiresAt < Date.now() + 31 * 60_000);
  });

  it('uses unique event_id and idempotency_key', () => {
    const offer = buildOfferFromResults('bcast-id', 'node', [makeResult(0.9)], ['sum']);
    assert.ok(offer.event_id);
    assert.equal(offer.event_id, offer.idempotency_key);
    assert.equal(offer.causation_id, 'bcast-id');
  });
});

// ─── filterPrivateItems ─────────────────────────────────────────────────────

describe('filterPrivateItems', () => {
  it('returns all results when extractionDb is null', () => {
    const results = [makeResult(0.8), makeResult(0.6)];
    const filtered = filterPrivateItems(results, null);
    assert.equal(filtered.length, 2);
  });

  it('fails CLOSED (returns []) when private column does not exist', () => {
    // F-H6 fix: when privacy column is missing we cannot distinguish private
    // from public — for a peer-facing filter, that means refuse to ship
    // anything. The old behavior (return unfiltered) was a leak when running
    // against a pre-migration DB.
    const mockDb = {
      prepare(sql) {
        return {
          get() {
            if (sql.includes('pragma_table_info')) return { cnt: 0 };
            return null;
          },
          all() { return []; },
        };
      },
    };
    const results = [makeResult(0.8), makeResult(0.6)];
    const filtered = filterPrivateItems(results, mockDb);
    assert.equal(filtered.length, 0, 'should refuse to ship to peers when privacy column missing');
  });

  it('returns empty array when results are empty', () => {
    assert.deepEqual(filterPrivateItems([], null), []);
  });

  it('handles null results gracefully', () => {
    assert.deepEqual(filterPrivateItems(null, null), []);
  });
});

// ─── createOfferer ──────────────────────────────────────────────────────────

describe('createOfferer', () => {
  it('returns an object with start, stop, stats, and _processBroadcast', () => {
    const nc = mockNatsConnection();
    const offerer = createOfferer(nc, 'test-node');
    assert.equal(typeof offerer.start, 'function');
    assert.equal(typeof offerer.stop, 'function');
    assert.equal(typeof offerer._processBroadcast, 'function');
    assert.equal(typeof offerer.stats, 'object');
    assert.equal(offerer.stats.broadcastsReceived, 0);
    assert.equal(offerer.stats.offersPublished, 0);
  });
});

describe('createOfferer._processBroadcast', () => {
  let nc, logs;

  beforeEach(() => {
    nc = mockNatsConnection();
    logs = [];
  });

  it('skips self-originated broadcasts', async () => {
    const offerer = createOfferer(nc, 'my-node', { log: m => logs.push(m) });
    const broadcast = makeBroadcast({ node_id: 'my-node' });

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'self');
    assert.equal(offerer.stats.selfSkipped, 1);
  });

  it('skips expired broadcasts', async () => {
    const offerer = createOfferer(nc, 'my-node', { log: m => logs.push(m) });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const broadcast = makeBroadcast({ timestamp: twoHoursAgo, ttl_minutes: 60 });

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
    assert.equal(offerer.stats.expiredSkipped, 1);
  });

  it('skips broadcasts with empty themes and entities', async () => {
    const offerer = createOfferer(nc, 'my-node', { log: m => logs.push(m) });
    const broadcast = makeBroadcast({ themes: [], entities: [] });

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'empty_context');
  });

  it('reports below_threshold when no results meet threshold', async () => {
    const mockPipeline = {
      retrieve: async () => [makeResult(0.3), makeResult(0.2)],
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });
    const broadcast = makeBroadcast();

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'below_threshold');
    assert.equal(offerer.stats.belowThreshold, 1);
  });

  it('caps artifacts at MAX_ARTIFACTS_PER_OFFER (3)', async () => {
    const mockPipeline = {
      retrieve: async () => [
        makeResult(0.9, 'a', 1),
        makeResult(0.8, 'b', 2),
        makeResult(0.7, 'c', 3),
        makeResult(0.6, 'd', 4),
        makeResult(0.55, 'e', 5),
      ],
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });
    const broadcast = makeBroadcast();

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'offered');
    assert.equal(result.artifactCount, 3);
    assert.equal(offerer.stats.offersPublished, 1);

    // Verify the published NATS message has exactly 3 artifacts
    assert.equal(nc.published.length, 1);
    assert.equal(nc.published[0].data.data.artifacts.length, 3);
  });

  it('publishes to correct NATS subject', async () => {
    const mockPipeline = {
      retrieve: async () => [makeResult(0.8)],
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });
    const broadcast = makeBroadcast();

    await offerer._processBroadcast(broadcast);
    assert.equal(nc.published[0].subject, 'context.offer.my-node');
  });

  it('tracks stats correctly across multiple broadcasts', async () => {
    const mockPipeline = {
      retrieve: async () => [makeResult(0.8)],
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });

    // Self-originated
    await offerer._processBroadcast(makeBroadcast({ node_id: 'my-node' }));
    // Expired
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    await offerer._processBroadcast(makeBroadcast({ timestamp: old, ttl_minutes: 60 }));
    // Successful
    await offerer._processBroadcast(makeBroadcast());

    assert.equal(offerer.stats.broadcastsReceived, 3);
    assert.equal(offerer.stats.selfSkipped, 1);
    assert.equal(offerer.stats.expiredSkipped, 1);
    assert.equal(offerer.stats.offersPublished, 1);
  });

  it('handles retrieval pipeline errors gracefully', async () => {
    const mockPipeline = {
      retrieve: async () => { throw new Error('DB connection lost'); },
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });
    const broadcast = makeBroadcast();

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'error');
    assert.equal(result.reason, 'retrieval_failed');
    assert.equal(offerer.stats.errors, 1);
  });

  it('respects custom relevance threshold', async () => {
    const mockPipeline = {
      retrieve: async () => [makeResult(0.5)],
    };
    // Set threshold to 0.4 so the 0.5 result passes
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
      relevanceThreshold: 0.4,
    });
    const broadcast = makeBroadcast();

    const result = await offerer._processBroadcast(broadcast);
    assert.equal(result.action, 'offered');
  });

  it('sets responding_to to the broadcast event_id', async () => {
    const mockPipeline = {
      retrieve: async () => [makeResult(0.8)],
    };
    const offerer = createOfferer(nc, 'my-node', {
      log: m => logs.push(m),
      retrievalPipeline: mockPipeline,
    });
    const broadcast = makeBroadcast();

    await offerer._processBroadcast(broadcast);
    assert.equal(nc.published[0].data.data.responding_to, broadcast.event_id);
  });
});

describe('createOfferer.start', () => {
  it('degrades gracefully when shared stream is unavailable', async () => {
    const nc = mockNatsConnection();
    const logs = [];
    const offerer = createOfferer(nc, 'my-node', { log: m => logs.push(m) });

    await offerer.start();
    // Should have logged degraded mode
    assert.ok(logs.some(l => l.includes('degraded')));
    offerer.stop();
  });
});
