/**
 * broadcast-cross-node.test.mjs — Deterministic two-node integration test
 *
 * Validates the full broadcast protocol round-trip:
 *   node A emits context.broadcast
 *   → peer B's offerer receives it, retrieves locally, publishes context.offer
 *   → node A's acceptor queues the offer
 *   → node A's next prompt triggers token-overlap acceptance
 *   → node A emits context.accepted
 *
 * Uses mock NATS connections with a shared message bus — no external broker.
 * This is the deterministic equivalent of Block 8's "3 clean cycles" gate.
 *
 * Step 9.6 (operator-added beyond REFERENCE_PLAN).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import {
  createBroadcaster,
  inferIntensity,
  computeDedupKey,
} from '../lib/broadcast-emitter.mjs';

import {
  createOfferer,
  filterPrivateItems,
  buildOfferFromResults,
  generateRelevanceSummary,
} from '../lib/broadcast-offerer.mjs';

import {
  createAcceptor,
  computeTokenOverlap,
  formatPeerMemoryBlock,
  parseArtifactRef,
} from '../lib/broadcast-acceptor.mjs';

// ─── Shared Mock Infrastructure ──────────────────────────────────────────────

/**
 * Create a shared message bus that connects two mock NATS connections.
 * Messages published by one connection are visible to the other via the bus.
 */
function createSharedBus() {
  const messages = []; // { subject, data, opts }
  return {
    messages,
    publish(subject, data, opts) {
      messages.push({ subject, data, opts });
    },
    getBySubjectPrefix(prefix) {
      return messages.filter(m => m.subject.startsWith(prefix));
    },
  };
}

/**
 * Create a mock NATS connection that publishes to a shared bus.
 */
function mockNc(bus) {
  return {
    jetstream() {
      return {
        async publish(subject, data, opts) {
          const decoded = JSON.parse(new TextDecoder().decode(data));
          bus.publish(subject, decoded, opts);
          return { seq: bus.messages.length, stream: 'OPENCLAW_SHARED' };
        },
        consumers: {
          get() { throw new Error('no consumer'); },
        },
        subscribe() { throw new Error('shared stream unavailable'); },
      };
    },
  };
}

/**
 * Build a valid broadcast event for testing.
 */
function makeBroadcast(nodeId, overrides = {}) {
  const eventId = overrides.event_id || randomUUID();
  const timestamp = overrides.timestamp || new Date().toISOString();
  return {
    event_id: eventId,
    event_type: 'context.broadcast',
    event_version: 1,
    entity_id: eventId,
    entity_type: 'session',
    timestamp,
    causation_id: null,
    correlation_id: null,
    actor: { type: 'system', id: `broadcaster-${nodeId}` },
    node_id: nodeId,
    idempotency_key: eventId,
    data: {
      themes: overrides.themes || ['memory', 'federation', 'retrieval'],
      entities: overrides.entities || ['NATS', 'JetStream'],
      intensity: overrides.intensity || 'actively_seeking',
      ttl_minutes: overrides.ttl_minutes ?? 60,
      dedup_key: computeDedupKey(
        overrides.themes || ['memory', 'federation', 'retrieval'],
        overrides.entities || ['NATS', 'JetStream'],
      ),
      ...(overrides.problem_class ? { problem_class: overrides.problem_class } : {}),
    },
  };
}

/**
 * Build a valid offer event for testing.
 */
function makeOffer(nodeId, broadcastEventId, overrides = {}) {
  const eventId = overrides.event_id || randomUUID();
  const expiresAt = overrides.expires_at || new Date(Date.now() + 3600_000).toISOString();
  return {
    event_id: eventId,
    event_type: 'context.offer',
    event_version: 1,
    entity_id: eventId,
    entity_type: 'session',
    timestamp: overrides.timestamp || new Date().toISOString(),
    causation_id: broadcastEventId,
    correlation_id: null,
    actor: { type: 'system', id: `offerer-${nodeId}` },
    node_id: nodeId,
    idempotency_key: eventId,
    data: {
      responding_to: broadcastEventId,
      offerer_node_id: nodeId,
      artifacts: overrides.artifacts || [
        {
          artifact_ref: 'session:sess-001:chunk:1',
          relevance_score: 0.78,
          provenance: { source_node: nodeId, source_type: 'local_retrieval' },
          summary: 'Discussion about NATS federation architecture and event-driven messaging patterns',
        },
      ],
      expires_at: expiresAt,
    },
  };
}

/**
 * Create a mock retrieval pipeline that returns canned results.
 */
function mockRetrievalPipeline(results) {
  return {
    async retrieve(_query, _opts) {
      return results;
    },
  };
}

/**
 * Create an in-memory extraction store DB with test data for privacy tests.
 * Returns the raw database handle.
 */
function createTestExtractionDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      embedding BLOB,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT,
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      private INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      salience REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_session ON mentions(session_id);
  `);

  return db;
}

// ─── Full Round-Trip ─────────────────────────────────────────────────────────

describe('cross-node integration: full broadcast → offer → accepted round-trip', () => {
  let bus;
  let ncA;
  let ncB;
  const NODE_A = 'node-alpha';
  const NODE_B = 'node-beta';

  beforeEach(() => {
    bus = createSharedBus();
    ncA = mockNc(bus);
    ncB = mockNc(bus);
  });

  it('completes the full round-trip: broadcast → offerer → acceptor → accepted', async () => {
    // 1. Node A broadcasts
    const broadcasterA = createBroadcaster(ncA, NODE_A, {
      rateLimitMs: 0,
      dedupWindowMs: 0,
    });

    const broadcastResult = await broadcasterA.maybeBroadcast(
      'How do I fix the NATS federation setup?',
      { llmAnalysis: { themes: ['memory', 'federation', 'retrieval'], entities: ['NATS'] } },
    );
    broadcasterA.stop();

    assert.equal(broadcastResult.suppressed, false, 'broadcast should not be suppressed');
    assert.ok(broadcastResult.eventId, 'broadcast should have an eventId');

    // Verify broadcast landed on the bus
    const broadcasts = bus.getBySubjectPrefix('context.broadcast.');
    assert.equal(broadcasts.length, 1, 'one broadcast on the bus');
    assert.equal(broadcasts[0].data.node_id, NODE_A);
    const broadcastEvent = broadcasts[0].data;

    // 2. Node B's offerer processes the broadcast
    const offererResults = [
      { snippet: 'NATS JetStream federation configuration guide', session_id: 'sess-001', chunk_id: 1, score: 0.82 },
      { snippet: 'Memory retrieval pipeline architecture', session_id: 'sess-002', chunk_id: 3, score: 0.65 },
    ];
    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrievalPipeline(offererResults),
      relevanceThreshold: 0.55,
      maxArtifacts: 3,
    });

    const offerResult = await offererB._processBroadcast(broadcastEvent);
    offererB.stop();

    assert.equal(offerResult.action, 'offered', 'offerer should produce an offer');
    assert.equal(offerResult.artifactCount, 2, 'both results above threshold');

    // Verify offer landed on the bus
    const offers = bus.getBySubjectPrefix('context.offer.');
    assert.equal(offers.length, 1, 'one offer on the bus');
    const offerEvent = offers[0].data;
    assert.equal(offerEvent.data.responding_to, broadcastEvent.event_id);
    assert.equal(offerEvent.data.offerer_node_id, NODE_B);
    assert.equal(offerEvent.data.artifacts.length, 2);

    // 3. Node A's acceptor processes the offer
    const ownBroadcastIds = new Set([broadcastEvent.event_id]);
    const acceptorA = createAcceptor(ncA, NODE_A, { ownBroadcastIds });

    const queueResult = await acceptorA._processOffer(offerEvent);
    assert.equal(queueResult.action, 'queued', 'offer should be queued');

    // Verify top offer is surfaced
    const peerBlock = acceptorA.getTopOffer();
    assert.ok(peerBlock.includes('[peer-memory:'), 'should include peer-memory block');
    assert.ok(peerBlock.includes(NODE_B), 'should mention the offering node');

    // 4. User's next prompt references the offer content → acceptance
    const acceptResult = await acceptorA.checkAcceptance(
      'Tell me about NATS JetStream federation configuration and memory retrieval pipeline',
    );

    assert.equal(acceptResult.accepted, true, 'should accept the offer');
    assert.equal(acceptResult.offerId, offerEvent.event_id);
    assert.ok(acceptResult.overlap >= 0.3, 'overlap should meet threshold');

    // Verify context.accepted landed on the bus
    const accepted = bus.getBySubjectPrefix('context.accepted.');
    assert.equal(accepted.length, 1, 'one accepted event on the bus');
    assert.equal(accepted[0].data.data.responding_to, offerEvent.event_id);
    assert.equal(accepted[0].data.data.accepted_artifacts.length, 2);
    assert.ok(accepted[0].data.data.accepted_artifacts.includes('session:sess-001:chunk:1'));

    acceptorA.stop();
  });
});

// ─── TTL-expired broadcasts ──────────────────────────────────────────────────

describe('cross-node integration: TTL-expired broadcasts', () => {
  it('offerer skips broadcasts past their TTL', async () => {
    const bus = createSharedBus();
    const ncB = mockNc(bus);
    const NODE_B = 'node-beta';

    // Create a broadcast from 2 hours ago with a 60-min TTL → expired
    const staleTimestamp = new Date(Date.now() - 2 * 3600_000).toISOString();
    const broadcast = makeBroadcast('node-alpha', {
      timestamp: staleTimestamp,
      ttl_minutes: 60,
    });

    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrievalPipeline([
        { snippet: 'relevant content', session_id: 'sess-x', chunk_id: 0, score: 0.9 },
      ]),
    });

    const result = await offererB._processBroadcast(broadcast);
    offererB.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
    assert.equal(offererB.stats.expiredSkipped, 1);
    assert.equal(bus.messages.length, 0, 'no offer published for expired broadcast');
  });
});

// ─── Privacy filtering ──────────────────────────────────────────────────────

describe('cross-node integration: private items do not leak into offers', () => {
  it('filterPrivateItems removes results linked to private entities', () => {
    const db = createTestExtractionDb();

    // Insert a private entity with a mention
    db.prepare(
      `INSERT INTO entities (name, type, first_seen, last_seen, mention_count, private)
       VALUES ('secret-project', 'project', '2026-01-01', '2026-05-25', 5, 1)`,
    ).run();
    const entityId = db.prepare('SELECT id FROM entities WHERE name = ?').get('secret-project').id;

    db.prepare(
      `INSERT INTO mentions (entity_id, session_id, turn_index, salience, created_at)
       VALUES (?, 'sess-private', 1, 0.8, '2026-05-25')`,
    ).run(entityId);

    // Insert a public entity with a mention
    db.prepare(
      `INSERT INTO entities (name, type, first_seen, last_seen, mention_count, private)
       VALUES ('open-project', 'project', '2026-01-01', '2026-05-25', 10, 0)`,
    ).run();
    const pubEntityId = db.prepare('SELECT id FROM entities WHERE name = ?').get('open-project').id;

    db.prepare(
      `INSERT INTO mentions (entity_id, session_id, turn_index, salience, created_at)
       VALUES (?, 'sess-public', 1, 0.8, '2026-05-25')`,
    ).run(pubEntityId);

    // Retrieval results include both sessions
    const results = [
      { snippet: 'secret stuff', session_id: 'sess-private', chunk_id: 0, score: 0.9 },
      { snippet: 'open stuff', session_id: 'sess-public', chunk_id: 0, score: 0.8 },
      { snippet: 'unlinked stuff', session_id: 'sess-unlinked', chunk_id: 0, score: 0.7 },
    ];

    const filtered = filterPrivateItems(results, db);
    db.close();

    // sess-private should be removed (linked to private entity)
    // sess-public and sess-unlinked should remain
    assert.equal(filtered.length, 2, 'private session filtered out');
    const ids = filtered.map(r => r.session_id);
    assert.ok(!ids.includes('sess-private'), 'private session not in results');
    assert.ok(ids.includes('sess-public'), 'public session retained');
    assert.ok(ids.includes('sess-unlinked'), 'unlinked session retained');
  });

  it('offerer with extractionDb filters private items before offering', async () => {
    const db = createTestExtractionDb();

    // Only private entities exist
    db.prepare(
      `INSERT INTO entities (name, type, first_seen, last_seen, mention_count, private)
       VALUES ('top-secret', 'concept', '2026-01-01', '2026-05-25', 3, 1)`,
    ).run();
    const eid = db.prepare('SELECT id FROM entities WHERE name = ?').get('top-secret').id;
    db.prepare(
      `INSERT INTO mentions (entity_id, session_id, turn_index, salience, created_at)
       VALUES (?, 'sess-classified', 1, 0.9, '2026-05-25')`,
    ).run(eid);

    const bus = createSharedBus();
    const nc = mockNc(bus);

    // Retrieval returns a result from the private session
    const offerer = createOfferer(nc, 'node-beta', {
      retrievalPipeline: mockRetrievalPipeline([
        { snippet: 'classified content', session_id: 'sess-classified', chunk_id: 0, score: 0.9 },
      ]),
      extractionDb: db,
      relevanceThreshold: 0.55,
    });

    const broadcast = makeBroadcast('node-alpha');
    const result = await offerer._processBroadcast(broadcast);
    offerer.stop();
    db.close();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'below_threshold', 'all results filtered by privacy → below threshold');
    assert.equal(bus.messages.length, 0, 'no offer published');
  });
});

// ─── Offer expiry (expires_at) ───────────────────────────────────────────────

describe('cross-node integration: offer expires_at respected by acceptor', () => {
  it('acceptor skips offers past their expires_at', async () => {
    const bus = createSharedBus();
    const nc = mockNc(bus);
    const broadcastId = randomUUID();

    const expiredOffer = makeOffer('node-beta', broadcastId, {
      expires_at: new Date(Date.now() - 60_000).toISOString(), // expired 1 min ago
    });

    const acceptor = createAcceptor(nc, 'node-alpha', {
      ownBroadcastIds: new Set([broadcastId]),
    });

    const result = await acceptor._processOffer(expiredOffer);
    acceptor.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
    assert.equal(acceptor.stats.expiredSkipped, 1);
    assert.equal(acceptor.getPendingOffers().length, 0, 'no pending offers from expired event');
  });
});

// ─── Artifact refs flow correctly ────────────────────────────────────────────

describe('cross-node integration: accepted artifact_refs flow correctly', () => {
  it('context.accepted contains the exact artifact_refs from the offer', async () => {
    const bus = createSharedBus();
    const nc = mockNc(bus);
    const broadcastId = randomUUID();

    const artifacts = [
      {
        artifact_ref: 'session:sess-abc:chunk:5',
        relevance_score: 0.9,
        provenance: { source_node: 'node-beta', source_type: 'local_retrieval' },
        summary: 'Detailed analysis of spreading activation algorithm tuning',
      },
      {
        artifact_ref: 'session:sess-def:chunk:12',
        relevance_score: 0.7,
        provenance: { source_node: 'node-beta', source_type: 'local_retrieval' },
        summary: 'Retrieval pipeline RRF weight optimization results',
      },
    ];

    const offer = makeOffer('node-beta', broadcastId, { artifacts });

    const acceptor = createAcceptor(nc, 'node-alpha', {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.2, // low threshold for reliable test trigger
    });

    await acceptor._processOffer(offer);

    // Prompt referencing both summaries to trigger acceptance
    const result = await acceptor.checkAcceptance(
      'I need help with spreading activation algorithm tuning and retrieval pipeline RRF weight optimization',
    );
    acceptor.stop();

    assert.equal(result.accepted, true);

    // Verify the accepted event on the bus
    const accepted = bus.getBySubjectPrefix('context.accepted.');
    assert.equal(accepted.length, 1);
    const acceptedData = accepted[0].data.data;

    assert.deepEqual(
      acceptedData.accepted_artifacts.sort(),
      ['session:sess-abc:chunk:5', 'session:sess-def:chunk:12'].sort(),
      'accepted_artifacts must match the offer artifacts exactly',
    );

    // Verify artifact_refs parse correctly
    const ref1 = parseArtifactRef(acceptedData.accepted_artifacts[0]);
    assert.ok(ref1, 'first ref should parse');
    assert.ok(ref1.sessionId, 'parsed ref should have sessionId');
    assert.equal(typeof ref1.chunkId, 'number', 'parsed ref chunkId should be a number');
  });
});

// ─── Self-skip by offerer ────────────────────────────────────────────────────

describe('cross-node integration: offerer skips self-originated broadcasts', () => {
  it('offerer skips broadcasts from the same node', async () => {
    const bus = createSharedBus();
    const nc = mockNc(bus);
    const SAME_NODE = 'node-alpha';

    const offerer = createOfferer(nc, SAME_NODE, {
      retrievalPipeline: mockRetrievalPipeline([
        { snippet: 'content', session_id: 's1', chunk_id: 0, score: 0.9 },
      ]),
    });

    const broadcast = makeBroadcast(SAME_NODE); // same node
    const result = await offerer._processBroadcast(broadcast);
    offerer.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'self');
    assert.equal(offerer.stats.selfSkipped, 1);
    assert.equal(bus.messages.length, 0, 'no offer published for self-broadcast');
  });
});

// ─── Below-threshold results ─────────────────────────────────────────────────

describe('cross-node integration: below-threshold results produce no offer', () => {
  it('offerer skips when all results are below relevance threshold', async () => {
    const bus = createSharedBus();
    const nc = mockNc(bus);

    const offerer = createOfferer(nc, 'node-beta', {
      retrievalPipeline: mockRetrievalPipeline([
        { snippet: 'vaguely related', session_id: 's1', chunk_id: 0, score: 0.30 },
        { snippet: 'barely related', session_id: 's2', chunk_id: 0, score: 0.40 },
      ]),
      relevanceThreshold: 0.55,
    });

    const broadcast = makeBroadcast('node-alpha');
    const result = await offerer._processBroadcast(broadcast);
    offerer.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'below_threshold');
    assert.equal(offerer.stats.belowThreshold, 1);
    assert.equal(bus.messages.length, 0, 'no offer published');
  });
});

// ─── Non-matching responding_to ──────────────────────────────────────────────

describe('cross-node integration: acceptor skips offers not responding to own broadcasts', () => {
  it('acceptor skips offers whose responding_to does not match own broadcast IDs', async () => {
    const bus = createSharedBus();
    const nc = mockNc(bus);

    const ownBroadcastId = randomUUID();
    const unrelatedBroadcastId = randomUUID();

    const offer = makeOffer('node-beta', unrelatedBroadcastId);

    const acceptor = createAcceptor(nc, 'node-alpha', {
      ownBroadcastIds: new Set([ownBroadcastId]),
    });

    const result = await acceptor._processOffer(offer);
    acceptor.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'not_our_broadcast');
    assert.equal(acceptor.stats.nonMatchingSkipped, 1);
    assert.equal(acceptor.getPendingOffers().length, 0);
  });
});

// ─── buildOfferFromResults + formatPeerMemoryBlock integration ───────────────

describe('cross-node integration: offer building and peer-memory formatting', () => {
  it('buildOfferFromResults creates valid artifact_refs that formatPeerMemoryBlock renders', () => {
    const results = [
      { snippet: 'NATS config details', session_id: 'sess-99', chunk_id: 7, score: 0.88 },
    ];
    const summaries = ['Relevant NATS configuration for federation setup'];

    const offer = buildOfferFromResults('bcast-123', 'node-beta', results, summaries, 60);

    assert.equal(offer.data.artifacts.length, 1);
    assert.equal(offer.data.artifacts[0].artifact_ref, 'session:sess-99:chunk:7');
    assert.equal(offer.data.artifacts[0].relevance_score, 0.88);
    assert.equal(offer.data.artifacts[0].summary, 'Relevant NATS configuration for federation setup');

    // Format as peer-memory block
    const block = formatPeerMemoryBlock(offer);
    assert.ok(block.includes('[peer-memory:'), 'block starts with peer-memory tag');
    assert.ok(block.includes('node-beta'), 'block mentions offering node');
    assert.ok(block.includes('sess-99'), 'block includes session ID');
    assert.ok(block.includes('0.88'), 'block includes relevance score');
    assert.ok(block.includes('[end peer-memory]'), 'block ends with end tag');

    // Verify artifact_ref parses
    const parsed = parseArtifactRef(offer.data.artifacts[0].artifact_ref);
    assert.deepEqual(parsed, { sessionId: 'sess-99', chunkId: 7 });
  });
});
