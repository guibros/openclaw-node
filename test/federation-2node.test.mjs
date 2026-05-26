/**
 * federation-2node.test.mjs — Two-node integration test with REAL NATS
 *
 * Validates the full federation broadcast → offer → accepted round-trip
 * using a real nats-server process, real JetStream, and real ed25519 signing.
 *
 * Two isolated openclaw node trees are spawned (via bin/spawn-node.mjs) with
 * distinct ed25519 identities (via lib/node-identity.mjs). The test verifies:
 *   - Signed events traverse the federation loop correctly
 *   - STRICT signature verification works across nodes
 *   - Tampered events are rejected
 *   - Protocol edge cases (self-skip, TTL expiry) work on real NATS
 *
 * Requires `nats-server` on PATH. Skips gracefully if unavailable.
 *
 * Step 10.5 — Block 10 (Federation validation in the real world).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync, spawn as spawnProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { spawnNode } from '../bin/spawn-node.mjs';
import {
  getOrCreateIdentity,
  signEvent,
  verifyEvent,
} from '../lib/node-identity.mjs';
import {
  createBroadcaster,
  computeDedupKey,
} from '../lib/broadcast-emitter.mjs';
import {
  createOfferer,
  buildOfferFromResults,
} from '../lib/broadcast-offerer.mjs';
import {
  createAcceptor,
  formatPeerMemoryBlock,
  parseArtifactRef,
} from '../lib/broadcast-acceptor.mjs';
import {
  SHARED_STREAM_NAME,
  SHARED_SUBJECTS,
} from '../lib/shared-event-stream.mjs';

const _require = createRequire(import.meta.url);

// ─── nats-server availability check ──────────────────────────────────────────

let NATS_SERVER_BIN = null;
try {
  NATS_SERVER_BIN = execSync('which nats-server', { encoding: 'utf8' }).trim();
} catch {
  // nats-server not on PATH
}

const SKIP = !NATS_SERVER_BIN;

// ─── Helper: start a real nats-server with JetStream ─────────────────────────

/**
 * Start a nats-server process with JetStream enabled.
 *
 * @param {{ port: number, storeDir: string }} opts
 * @returns {Promise<{ proc: ChildProcess, port: number }>}
 */
function startNatsServer(opts) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', String(opts.port),
      '-a', '127.0.0.1',
      '-js',
      '-sd', opts.storeDir,
    ];

    const proc = spawnProcess(NATS_SERVER_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        reject(new Error(`nats-server failed to start within 10s. stderr: ${stderr}`));
      }
    }, 10_000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // nats-server prints "Listening for client connections on 127.0.0.1:PORT"
      if (!resolved && stderr.includes('Listening for client connections')) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ proc, port: opts.port });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`nats-server exited with code ${code}. stderr: ${stderr}`));
      }
    });
  });
}

/**
 * Kill a nats-server process and wait for it to exit.
 * @param {ChildProcess} proc
 * @returns {Promise<void>}
 */
function stopNatsServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    // Force kill after 3s
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 3000);
  });
}

/**
 * Create the OPENCLAW_SHARED stream on a single-node NATS (R=1).
 * Production uses R=3 but a single-server test requires R=1.
 *
 * @param {object} nc — NATS connection
 */
async function createTestSharedStream(nc) {
  const { StorageType } = _require('nats');
  const jsm = await nc.jetstreamManager();
  await jsm.streams.add({
    name: SHARED_STREAM_NAME,
    subjects: SHARED_SUBJECTS,
    storage: StorageType.File,
    num_replicas: 1,
  });
}

/**
 * Mock retrieval pipeline that returns canned results.
 */
function mockRetrieval(results) {
  return {
    async retrieve() {
      return results;
    },
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('federation-2node: real NATS integration', { skip: SKIP ? 'nats-server not found on PATH' : false }, () => {
  const TEST_PORT = 14_222 + Math.floor(Math.random() * 1000);
  const NODE_A = 'test-alpha';
  const NODE_B = 'test-beta';

  let tmpDir;
  let natsStoreDir;
  let natsProc;
  let ncA; // NATS connection for node A
  let ncB; // NATS connection for node B
  let identityA;
  let identityB;
  let nodeRootA;
  let nodeRootB;

  before(async () => {
    // 1. Create temp directories
    tmpDir = await mkdtemp(join(tmpdir(), 'openclaw-fed2-'));
    natsStoreDir = join(tmpDir, 'nats-store');

    // 2. Spawn node trees
    const resultA = await spawnNode({ id: NODE_A, baseDir: tmpDir });
    const resultB = await spawnNode({ id: NODE_B, baseDir: tmpDir });
    nodeRootA = resultA.nodeRoot;
    nodeRootB = resultB.nodeRoot;

    // 3. Create distinct identities
    identityA = getOrCreateIdentity(nodeRootA);
    identityB = getOrCreateIdentity(nodeRootB);

    // 4. Start real nats-server
    const server = await startNatsServer({ port: TEST_PORT, storeDir: natsStoreDir });
    natsProc = server.proc;

    // 5. Connect both nodes
    const { connect } = _require('nats');
    ncA = await connect({ servers: `nats://127.0.0.1:${TEST_PORT}` });
    ncB = await connect({ servers: `nats://127.0.0.1:${TEST_PORT}` });

    // 6. Create shared stream (R=1 for single-server test)
    await createTestSharedStream(ncA);
  });

  after(async () => {
    // Drain and close NATS connections
    try { if (ncA) await ncA.drain(); } catch { /* ignore */ }
    try { if (ncB) await ncB.drain(); } catch { /* ignore */ }

    // Stop nats-server
    if (natsProc) await stopNatsServer(natsProc);

    // Clean up temp directories
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ─── Test: Distinct node identities ──────────────────────────────────────

  it('spawned nodes have distinct ed25519 identities', () => {
    assert.ok(identityA.publicKeyBase64, 'node A has a public key');
    assert.ok(identityB.publicKeyBase64, 'node B has a public key');
    assert.notEqual(
      identityA.publicKeyBase64,
      identityB.publicKeyBase64,
      'node A and B must have different public keys',
    );

    // Verify key sizes (ed25519 raw = 32 bytes → 44 chars base64)
    assert.equal(Buffer.from(identityA.publicKeyBase64, 'base64').length, 32);
    assert.equal(Buffer.from(identityB.publicKeyBase64, 'base64').length, 32);
  });

  // ─── Test: Broadcast publishes to real JetStream ─────────────────────────

  it('broadcast publishes a signed event to real JetStream and it persists', async () => {
    const broadcaster = createBroadcaster(ncA, NODE_A, {
      rateLimitMs: 0,
      dedupWindowMs: 0,
    });

    const result = await broadcaster.maybeBroadcast(
      'How do I set up NATS federation between nodes?',
      { llmAnalysis: { themes: ['federation', 'nats', 'configuration'], entities: ['NATS', 'JetStream'] } },
    );
    broadcaster.stop();

    assert.equal(result.suppressed, false, 'broadcast should not be suppressed');
    assert.ok(result.eventId, 'broadcast should return an eventId');

    // Read back from JetStream to confirm persistence
    const { StringCodec } = _require('nats');
    const sc = StringCodec();
    const jsm = await ncA.jetstreamManager();
    const streamInfo = await jsm.streams.info(SHARED_STREAM_NAME);
    assert.ok(streamInfo.state.messages >= 1, 'at least 1 message in the shared stream');
  });

  // ─── Test: Full round-trip with signatures ───────────────────────────────

  it('completes full signed round-trip: broadcast → offerer verifies → offer → acceptor verifies → accepted', async () => {
    // 1. Node A broadcasts (via direct JetStream publish with signing)
    const { StringCodec } = _require('nats');
    const sc = StringCodec();
    const jsA = ncA.jetstream();

    const broadcastId = crypto.randomUUID();
    const broadcastEvent = {
      event_id: broadcastId,
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: broadcastId,
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_A}` },
      node_id: NODE_A,
      idempotency_key: broadcastId,
      data: {
        themes: ['memory', 'federation', 'retrieval'],
        entities: ['NATS', 'JetStream'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['memory', 'federation', 'retrieval'], ['NATS', 'JetStream']),
      },
    };

    // Sign with node A's identity
    const signedBroadcast = signEvent(broadcastEvent, identityA.privateKey);
    assert.ok(signedBroadcast.signature, 'broadcast should be signed');
    assert.equal(signedBroadcast.signer_pubkey, identityA.publicKeyBase64);

    // Publish to real JetStream
    await jsA.publish(
      `context.broadcast.${NODE_A}`,
      sc.encode(JSON.stringify(signedBroadcast)),
      { msgID: broadcastId },
    );

    // 2. Node B's offerer processes the broadcast
    const offererResults = [
      { snippet: 'NATS JetStream federation setup guide', session_id: 'sess-fed-1', chunk_id: 1, score: 0.85 },
      { snippet: 'Memory retrieval architecture notes', session_id: 'sess-fed-2', chunk_id: 3, score: 0.70 },
    ];

    const offerer = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval(offererResults),
      relevanceThreshold: 0.55,
      maxArtifacts: 3,
    });

    // Offerer processes the signed broadcast — should VERIFY the signature
    const offerResult = await offerer._processBroadcast(signedBroadcast);
    assert.equal(offerResult.action, 'offered', 'offerer should produce an offer');
    assert.equal(offerResult.artifactCount, 2, 'both results above threshold');
    assert.equal(offerer.stats.signatureRejected, 0, 'valid signature should not be rejected');

    // 3. Read the offer from JetStream (it was published by the offerer)
    const jsm = await ncB.jetstreamManager();
    const streamInfo = await jsm.streams.info(SHARED_STREAM_NAME);
    assert.ok(streamInfo.state.messages >= 2, 'stream should have broadcast + offer');

    // Consume the offer from the stream
    const jsB = ncB.jetstream();
    const consumer = await jsm.consumers.add(SHARED_STREAM_NAME, {
      filter_subject: `context.offer.${NODE_B}`,
      ack_policy: 'none',
      deliver_policy: 'last',
    });
    const sub = await jsB.consumers.get(SHARED_STREAM_NAME, consumer.name);
    const msg = await sub.next({ expires: 5000 });
    assert.ok(msg, 'should receive the offer message from JetStream');

    const offerEvent = JSON.parse(sc.decode(msg.data));
    assert.equal(offerEvent.data.responding_to, broadcastId);
    assert.equal(offerEvent.data.offerer_node_id, NODE_B);
    assert.equal(offerEvent.data.artifacts.length, 2);

    // 4. Sign the offer with node B's identity (simulate what a production offerer would do)
    const signedOffer = signEvent(offerEvent, identityB.privateKey);
    assert.ok(signedOffer.signature, 'offer should be signed');
    assert.equal(signedOffer.signer_pubkey, identityB.publicKeyBase64);

    // 5. Node A's acceptor processes the signed offer
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds,
      overlapThreshold: 0.2,
    });

    const queueResult = await acceptor._processOffer(signedOffer);
    assert.equal(queueResult.action, 'queued', 'offer should be queued');
    assert.equal(acceptor.stats.signatureRejected, 0, 'valid offer signature not rejected');

    // 6. Verify peer-memory block is surfaced
    const peerBlock = acceptor.getTopOffer();
    assert.ok(peerBlock.includes('[peer-memory:'), 'peer-memory block present');
    assert.ok(peerBlock.includes(NODE_B), 'peer-memory mentions offering node');

    // 7. User prompt triggers acceptance
    const acceptResult = await acceptor.checkAcceptance(
      'Tell me about NATS JetStream federation setup and memory retrieval architecture',
    );
    assert.equal(acceptResult.accepted, true, 'should accept the offer');
    assert.equal(acceptResult.offerId, offerEvent.event_id);

    offerer.stop();
    acceptor.stop();
  });

  // ─── Test: Cross-node signature verification ─────────────────────────────

  it('node B can verify a signature created by node A (and vice versa)', () => {
    const event = {
      event_id: crypto.randomUUID(),
      event_type: 'context.broadcast',
      node_id: NODE_A,
      data: { themes: ['test'] },
    };

    // A signs, B verifies
    const signedByA = signEvent(event, identityA.privateKey);
    assert.equal(verifyEvent(signedByA), true, 'B should verify A\'s signature');
    assert.equal(signedByA.signer_pubkey, identityA.publicKeyBase64);

    // B signs, A verifies
    const signedByB = signEvent(event, identityB.privateKey);
    assert.equal(verifyEvent(signedByB), true, 'A should verify B\'s signature');
    assert.equal(signedByB.signer_pubkey, identityB.publicKeyBase64);

    // Different signers produce different signatures
    assert.notEqual(signedByA.signature, signedByB.signature);
  });

  // ─── Test: Tampered broadcast rejected by offerer ────────────────────────

  it('offerer rejects a broadcast with a tampered signature', async () => {
    const broadcastEvent = {
      event_id: crypto.randomUUID(),
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_A}` },
      node_id: NODE_A,
      idempotency_key: crypto.randomUUID(),
      data: {
        themes: ['security', 'signing', 'verification'],
        entities: ['ed25519'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['security', 'signing', 'verification'], ['ed25519']),
      },
    };

    // Sign with A's key, then tamper with the data
    const signed = signEvent(broadcastEvent, identityA.privateKey);
    signed.data.themes.push('tampered-theme'); // tamper!

    const offerer = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'some content', session_id: 's1', chunk_id: 0, score: 0.9 },
      ]),
    });

    const result = await offerer._processBroadcast(signed);
    offerer.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'bad_signature');
    assert.equal(offerer.stats.signatureRejected, 1, 'tampered broadcast rejected');
  });

  // ─── Test: Tampered offer rejected by acceptor ───────────────────────────

  it('acceptor rejects an offer with a tampered signature', async () => {
    const broadcastId = crypto.randomUUID();
    const offerEvent = {
      event_id: crypto.randomUUID(),
      event_type: 'context.offer',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: broadcastId,
      correlation_id: null,
      actor: { type: 'system', id: `offerer-${NODE_B}` },
      node_id: NODE_B,
      idempotency_key: crypto.randomUUID(),
      data: {
        responding_to: broadcastId,
        offerer_node_id: NODE_B,
        artifacts: [{
          artifact_ref: 'session:sess-tamper:chunk:0',
          relevance_score: 0.9,
          provenance: { source_node: NODE_B, source_type: 'local_retrieval' },
          summary: 'Original summary text',
        }],
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    };

    // Sign with B's key, then tamper
    const signed = signEvent(offerEvent, identityB.privateKey);
    signed.data.artifacts[0].summary = 'Tampered summary!'; // tamper!

    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
    });

    const result = await acceptor._processOffer(signed);
    acceptor.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'bad_signature');
    assert.equal(acceptor.stats.signatureRejected, 1, 'tampered offer rejected');
  });

  // ─── Test: Self-originated broadcast skipped ─────────────────────────────

  it('offerer skips self-originated broadcasts on real NATS', async () => {
    const broadcastEvent = {
      event_id: crypto.randomUUID(),
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_B}` },
      node_id: NODE_B, // same as offerer node
      idempotency_key: crypto.randomUUID(),
      data: {
        themes: ['self', 'test', 'broadcast'],
        entities: ['self-node'],
        intensity: 'passive',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['self', 'test', 'broadcast'], ['self-node']),
      },
    };

    const signed = signEvent(broadcastEvent, identityB.privateKey);

    const offerer = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'content', session_id: 's1', chunk_id: 0, score: 0.9 },
      ]),
    });

    const result = await offerer._processBroadcast(signed);
    offerer.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'self');
    assert.equal(offerer.stats.selfSkipped, 1);
  });

  // ─── Test: TTL-expired broadcast skipped ─────────────────────────────────

  it('offerer skips TTL-expired broadcasts on real NATS', async () => {
    const broadcastEvent = {
      event_id: crypto.randomUUID(),
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date(Date.now() - 2 * 3600_000).toISOString(), // 2 hours ago
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_A}` },
      node_id: NODE_A,
      idempotency_key: crypto.randomUUID(),
      data: {
        themes: ['stale', 'expired', 'broadcast'],
        entities: ['TTL'],
        intensity: 'actively_seeking',
        ttl_minutes: 60, // 60 min TTL, but broadcast is 2h old
        dedup_key: computeDedupKey(['stale', 'expired', 'broadcast'], ['TTL']),
      },
    };

    const signed = signEvent(broadcastEvent, identityA.privateKey);

    const offerer = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'content', session_id: 's1', chunk_id: 0, score: 0.9 },
      ]),
    });

    const result = await offerer._processBroadcast(signed);
    offerer.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
    assert.equal(offerer.stats.expiredSkipped, 1);
  });

  // ─── Test: JetStream consumer can read published messages ────────────────

  it('JetStream consumer on node B reads broadcast published by node A', async () => {
    const { StringCodec } = _require('nats');
    const sc = StringCodec();
    const jsA = ncA.jetstream();

    // Publish a fresh broadcast
    const eventId = crypto.randomUUID();
    const broadcastEvent = {
      event_id: eventId,
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: eventId,
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_A}` },
      node_id: NODE_A,
      idempotency_key: eventId,
      data: {
        themes: ['consume', 'test', 'jetstream'],
        entities: ['consumer'],
        intensity: 'interested',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['consume', 'test', 'jetstream'], ['consumer']),
      },
    };

    const signed = signEvent(broadcastEvent, identityA.privateKey);
    await jsA.publish(
      `context.broadcast.${NODE_A}`,
      sc.encode(JSON.stringify(signed)),
      { msgID: eventId },
    );

    // Node B consumes from the stream
    const jsmB = await ncB.jetstreamManager();
    const consumerName = `test-consumer-${Date.now()}`;
    await jsmB.consumers.add(SHARED_STREAM_NAME, {
      name: consumerName,
      filter_subject: `context.broadcast.${NODE_A}`,
      ack_policy: 'none',
      deliver_policy: 'last',
    });
    const jsB = ncB.jetstream();
    const sub = await jsB.consumers.get(SHARED_STREAM_NAME, consumerName);
    const msg = await sub.next({ expires: 5000 });

    assert.ok(msg, 'node B should receive the message');
    const decoded = JSON.parse(sc.decode(msg.data));

    assert.equal(decoded.event_id, eventId);
    assert.equal(decoded.node_id, NODE_A);
    assert.ok(decoded.signature, 'received message should have signature');
    assert.equal(decoded.signer_pubkey, identityA.publicKeyBase64);
    assert.equal(verifyEvent(decoded), true, 'signature should verify on receiving node');
  });

  // ─── Test: Round-trip timing ─────────────────────────────────────────────

  it('full broadcast → offer cycle completes within 5 seconds', async () => {
    const startTime = Date.now();

    // Broadcast
    const broadcastId = crypto.randomUUID();
    const broadcastEvent = {
      event_id: broadcastId,
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: broadcastId,
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${NODE_A}` },
      node_id: NODE_A,
      idempotency_key: broadcastId,
      data: {
        themes: ['timing', 'performance', 'benchmark'],
        entities: ['latency'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['timing', 'performance', 'benchmark'], ['latency']),
      },
    };

    const signed = signEvent(broadcastEvent, identityA.privateKey);
    const { StringCodec } = _require('nats');
    const sc = StringCodec();
    const jsA = ncA.jetstream();

    await jsA.publish(
      `context.broadcast.${NODE_A}`,
      sc.encode(JSON.stringify(signed)),
      { msgID: broadcastId },
    );

    // Offerer processes
    const offerer = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Latency measurement data', session_id: 'sess-timing', chunk_id: 0, score: 0.80 },
      ]),
      relevanceThreshold: 0.55,
    });

    const offerResult = await offerer._processBroadcast(signed);
    assert.equal(offerResult.action, 'offered');

    // Acceptor processes
    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.2,
    });

    // Build a signed offer to feed to acceptor
    const offerEvent = buildOfferFromResults(
      broadcastId, NODE_B,
      [{ snippet: 'Latency measurement data', session_id: 'sess-timing', chunk_id: 0, score: 0.80 }],
      ['Performance timing data relevant to federation latency benchmarking'],
      60,
    );
    const signedOffer = signEvent(offerEvent, identityB.privateKey);

    await acceptor._processOffer(signedOffer);
    const acceptResult = await acceptor.checkAcceptance(
      'Show me the latency measurement and performance timing data for federation benchmarking',
    );

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 5000, `round-trip took ${elapsed}ms — should be under 5000ms`);
    assert.equal(acceptResult.accepted, true);

    offerer.stop();
    acceptor.stop();
  });

  // ─── Test: context.accepted event lands on JetStream ─────────────────────

  it('context.accepted event is published to real JetStream', async () => {
    const { StringCodec } = _require('nats');
    const sc = StringCodec();

    // Get initial message count
    const jsmA = await ncA.jetstreamManager();
    const initialInfo = await jsmA.streams.info(SHARED_STREAM_NAME);
    const initialCount = initialInfo.state.messages;

    // Set up a broadcast ID and offer
    const broadcastId = crypto.randomUUID();
    const offerEvent = buildOfferFromResults(
      broadcastId, NODE_B,
      [{ snippet: 'Accepted content test', session_id: 'sess-accepted', chunk_id: 2, score: 0.88 }],
      ['Content about acceptance testing and JetStream persistence'],
      60,
    );

    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.15,
    });

    await acceptor._processOffer(offerEvent);

    // Trigger acceptance
    const result = await acceptor.checkAcceptance(
      'I want to learn about acceptance testing and JetStream persistence for the federation protocol',
    );
    assert.equal(result.accepted, true);

    // Verify the accepted event landed in JetStream
    const finalInfo = await jsmA.streams.info(SHARED_STREAM_NAME);
    assert.ok(
      finalInfo.state.messages > initialCount,
      `stream messages should increase (was ${initialCount}, now ${finalInfo.state.messages})`,
    );

    acceptor.stop();
  });
});
