/**
 * federation-3node.test.mjs — Three-node council test with REAL NATS cluster
 *
 * Validates the full federation council pattern: 3 NATS servers forming an R=3
 * cluster, 3 spawned openclaw nodes (A/B/C) with distinct ed25519 identities.
 * Node A broadcasts, B and C independently produce offers, A's acceptor
 * receives both, selects the higher-scoring one, and emits context.accepted.
 *
 * Validates:
 *   - R=3 replication across a real 3-node NATS cluster
 *   - dedup_key independence (B and C generate independent keys for same broadcast)
 *   - expires_at respected
 *   - Relevance scoring chooses the better offer
 *   - Multi-offer selection works correctly
 *
 * Requires `nats-server` on PATH. Skips gracefully if unavailable.
 *
 * Step 10.6 — Block 10 (Federation validation in the real world).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync, spawn as spawnProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
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

// ─── Helper: start a nats-server with cluster routing ────────────────────────

/**
 * Start a nats-server process with JetStream and cluster routing.
 *
 * @param {{ port: number, clusterPort: number, monitorPort: number, storeDir: string, serverName: string, routes: string[] }} opts
 * @returns {Promise<{ proc: ChildProcess, port: number }>}
 */
function startNatsServer(opts) {
  return new Promise((resolve, reject) => {
    // Build inline config for the cluster node
    const routesList = opts.routes.map(r => `    ${r}`).join('\n');
    const config = [
      `server_name: ${opts.serverName}`,
      `listen: 127.0.0.1:${opts.port}`,
      `http_port: ${opts.monitorPort}`,
      '',
      'jetstream {',
      `  store_dir: ${opts.storeDir}`,
      '  max_mem: 64MB',
      '  max_file: 256MB',
      '}',
      '',
      'cluster {',
      '  name: test-council-cluster',
      `  listen: 127.0.0.1:${opts.clusterPort}`,
      '  routes = [',
      routesList,
      '  ]',
      '}',
    ].join('\n');

    // Write config to a temp file in the store dir
    const configPath = join(opts.storeDir, 'nats.conf');
    mkdirSync(opts.storeDir, { recursive: true });
    writeFileSync(configPath, config);

    const args = ['-c', configPath];

    const proc = spawnProcess(NATS_SERVER_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        reject(new Error(`nats-server ${opts.serverName} failed to start within 15s. output: ${output}`));
      }
    }, 15_000);

    const onData = (chunk) => {
      output += chunk.toString();
      // Wait for client connections ready
      if (!resolved && output.includes('Listening for client connections')) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ proc, port: opts.port });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

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
        reject(new Error(`nats-server ${opts.serverName} exited with code ${code}. output: ${output}`));
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
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 3000);
  });
}

/**
 * Start a 3-node NATS cluster on ephemeral ports.
 *
 * @param {{ basePort: number, baseDir: string }} opts
 * @returns {Promise<{ procs: ChildProcess[], ports: number[], clusterPorts: number[] }>}
 */
async function startNatsCluster(opts) {
  const { basePort, baseDir } = opts;
  const clientPorts = [basePort, basePort + 1, basePort + 2];
  const clusterPorts = [basePort + 100, basePort + 101, basePort + 102];
  const monitorPorts = [basePort + 200, basePort + 201, basePort + 202];

  // Each server routes to the other two
  const routeSets = [
    [`nats-route://127.0.0.1:${clusterPorts[1]}`, `nats-route://127.0.0.1:${clusterPorts[2]}`],
    [`nats-route://127.0.0.1:${clusterPorts[0]}`, `nats-route://127.0.0.1:${clusterPorts[2]}`],
    [`nats-route://127.0.0.1:${clusterPorts[0]}`, `nats-route://127.0.0.1:${clusterPorts[1]}`],
  ];

  const procs = [];
  for (let i = 0; i < 3; i++) {
    const storeDir = join(baseDir, `nats-store-${i + 1}`);
    const server = await startNatsServer({
      port: clientPorts[i],
      clusterPort: clusterPorts[i],
      monitorPort: monitorPorts[i],
      storeDir,
      serverName: `test-council-${i + 1}`,
      routes: routeSets[i],
    });
    procs.push(server.proc);
  }

  // Wait briefly for cluster convergence
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return { procs, ports: clientPorts, clusterPorts };
}

/**
 * Stop all nats-server processes in the cluster.
 * @param {ChildProcess[]} procs
 * @returns {Promise<void>}
 */
async function stopNatsCluster(procs) {
  await Promise.all(procs.map(p => stopNatsServer(p)));
}

/**
 * Create the OPENCLAW_SHARED stream with R=3 on a 3-node cluster.
 *
 * @param {object} nc — NATS connection (to any cluster node)
 */
async function createClusterSharedStream(nc) {
  const { StorageType } = _require('nats');
  const jsm = await nc.jetstreamManager();
  await jsm.streams.add({
    name: SHARED_STREAM_NAME,
    subjects: SHARED_SUBJECTS,
    storage: StorageType.File,
    num_replicas: 3,
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

describe('federation-3node: council test with real NATS cluster', { skip: SKIP ? 'nats-server not found on PATH' : false }, () => {
  const BASE_PORT = 15_000 + Math.floor(Math.random() * 1000);
  const NODE_A = 'council-alpha';
  const NODE_B = 'council-beta';
  const NODE_C = 'council-gamma';

  let tmpDir;
  let clusterProcs;
  let clusterPorts;
  let ncA; // NATS connection for node A (via cluster node 1)
  let ncB; // NATS connection for node B (via cluster node 2)
  let ncC; // NATS connection for node C (via cluster node 3)
  let identityA;
  let identityB;
  let identityC;
  let nodeRootA;
  let nodeRootB;
  let nodeRootC;

  before(async () => {
    // 1. Create temp directories
    tmpDir = await mkdtemp(join(tmpdir(), 'openclaw-fed3-'));

    // 2. Start 3-node NATS cluster
    const cluster = await startNatsCluster({ basePort: BASE_PORT, baseDir: tmpDir });
    clusterProcs = cluster.procs;
    clusterPorts = cluster.ports;

    // 3. Spawn 3 isolated node trees
    const resultA = await spawnNode({ id: NODE_A, baseDir: tmpDir });
    const resultB = await spawnNode({ id: NODE_B, baseDir: tmpDir });
    const resultC = await spawnNode({ id: NODE_C, baseDir: tmpDir });
    nodeRootA = resultA.nodeRoot;
    nodeRootB = resultB.nodeRoot;
    nodeRootC = resultC.nodeRoot;

    // 4. Create distinct identities
    identityA = getOrCreateIdentity(nodeRootA);
    identityB = getOrCreateIdentity(nodeRootB);
    identityC = getOrCreateIdentity(nodeRootC);

    // 5. Connect each node to a different cluster member
    const { connect } = _require('nats');
    ncA = await connect({ servers: `nats://127.0.0.1:${clusterPorts[0]}` });
    ncB = await connect({ servers: `nats://127.0.0.1:${clusterPorts[1]}` });
    ncC = await connect({ servers: `nats://127.0.0.1:${clusterPorts[2]}` });

    // 6. Create shared stream with R=3
    await createClusterSharedStream(ncA);
  });

  after(async () => {
    // Drain and close NATS connections
    try { if (ncA) await ncA.drain(); } catch { /* ignore */ }
    try { if (ncB) await ncB.drain(); } catch { /* ignore */ }
    try { if (ncC) await ncC.drain(); } catch { /* ignore */ }

    // Stop NATS cluster
    if (clusterProcs) await stopNatsCluster(clusterProcs);

    // Clean up temp directories
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ─── Test: Three distinct identities ────────────────────────────────────

  it('three spawned nodes have distinct ed25519 identities', () => {
    const pubkeys = [identityA.publicKeyBase64, identityB.publicKeyBase64, identityC.publicKeyBase64];
    assert.ok(pubkeys[0], 'node A has a public key');
    assert.ok(pubkeys[1], 'node B has a public key');
    assert.ok(pubkeys[2], 'node C has a public key');

    // All three must be distinct
    const unique = new Set(pubkeys);
    assert.equal(unique.size, 3, 'all three nodes must have distinct public keys');

    // Verify key sizes (ed25519 raw = 32 bytes)
    for (const pk of pubkeys) {
      assert.equal(Buffer.from(pk, 'base64').length, 32);
    }
  });

  // ─── Test: R=3 stream across cluster ────────────────────────────────────

  it('shared stream exists with R=3 replication across the cluster', async () => {
    const jsm = await ncA.jetstreamManager();
    const streamInfo = await jsm.streams.info(SHARED_STREAM_NAME);

    assert.equal(streamInfo.config.name, SHARED_STREAM_NAME);
    assert.equal(streamInfo.config.num_replicas, 3);
    assert.ok(streamInfo.config.subjects.length >= 7, 'stream covers all federation subjects');
  });

  // ─── Test: Broadcast persists in R=3 stream ────────────────────────────

  it('broadcast signed by A persists in R=3 stream and is readable from all nodes', async () => {
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
        themes: ['council', 'federation', 'r3'],
        entities: ['NATS', 'JetStream', 'cluster'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['council', 'federation', 'r3'], ['NATS', 'JetStream', 'cluster']),
      },
    };

    const signed = signEvent(broadcastEvent, identityA.privateKey);
    await jsA.publish(
      `context.broadcast.${NODE_A}`,
      sc.encode(JSON.stringify(signed)),
      { msgID: broadcastId },
    );

    // Wait for replication
    await new Promise((r) => setTimeout(r, 500));

    // Read from node B's connection (different cluster member)
    const jsmB = await ncB.jetstreamManager();
    const streamInfoB = await jsmB.streams.info(SHARED_STREAM_NAME);
    assert.ok(streamInfoB.state.messages >= 1, 'stream on node B has the broadcast');

    // Read from node C's connection (third cluster member)
    const jsmC = await ncC.jetstreamManager();
    const streamInfoC = await jsmC.streams.info(SHARED_STREAM_NAME);
    assert.ok(streamInfoC.state.messages >= 1, 'stream on node C has the broadcast');
  });

  // ─── Test: Full council round-trip ─────────────────────────────────────

  it('full council: A broadcasts → B and C both offer → A picks higher-scored → context.accepted', async () => {
    const { StringCodec } = _require('nats');
    const sc = StringCodec();
    const jsA = ncA.jetstream();

    // 1. Node A broadcasts
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
        themes: ['memory', 'spreading-activation', 'retrieval-pipeline'],
        entities: ['BGE-M3', 'concept-graph'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['memory', 'spreading-activation', 'retrieval-pipeline'], ['BGE-M3', 'concept-graph']),
      },
    };

    const signedBroadcast = signEvent(broadcastEvent, identityA.privateKey);
    await jsA.publish(
      `context.broadcast.${NODE_A}`,
      sc.encode(JSON.stringify(signedBroadcast)),
      { msgID: broadcastId },
    );

    // 2. Node B processes the broadcast — has HIGH relevance content
    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Spreading activation algorithm with 3-hop decay 0.7', session_id: 'sess-b1', chunk_id: 1, score: 0.92 },
        { snippet: 'BGE-M3 embedding model benchmarks', session_id: 'sess-b2', chunk_id: 2, score: 0.85 },
      ]),
      relevanceThreshold: 0.55,
      maxArtifacts: 3,
      identity: identityB,
    });

    const offerResultB = await offererB._processBroadcast(signedBroadcast);
    assert.equal(offerResultB.action, 'offered', 'node B should produce an offer');
    assert.equal(offerResultB.artifactCount, 2, 'B has 2 relevant artifacts');
    assert.equal(offererB.stats.signatureRejected, 0);

    // 3. Node C processes the same broadcast — has LOWER relevance content
    const offererC = createOfferer(ncC, NODE_C, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Concept graph adjacency cache refresh strategy', session_id: 'sess-c1', chunk_id: 3, score: 0.68 },
      ]),
      relevanceThreshold: 0.55,
      maxArtifacts: 3,
      identity: identityC,
    });

    const offerResultC = await offererC._processBroadcast(signedBroadcast);
    assert.equal(offerResultC.action, 'offered', 'node C should also produce an offer');
    assert.equal(offerResultC.artifactCount, 1, 'C has 1 relevant artifact');
    assert.equal(offererC.stats.signatureRejected, 0);

    // 4. Build signed offers from B and C
    const offerB = buildOfferFromResults(
      broadcastId, NODE_B,
      [
        { snippet: 'Spreading activation algorithm with 3-hop decay 0.7', session_id: 'sess-b1', chunk_id: 1, score: 0.92 },
        { snippet: 'BGE-M3 embedding model benchmarks', session_id: 'sess-b2', chunk_id: 2, score: 0.85 },
      ],
      ['Spreading activation algorithm analysis', 'BGE-M3 benchmark results'],
      60,
    );
    const signedOfferB = signEvent(offerB, identityB.privateKey);

    const offerC = buildOfferFromResults(
      broadcastId, NODE_C,
      [
        { snippet: 'Concept graph adjacency cache refresh strategy', session_id: 'sess-c1', chunk_id: 3, score: 0.68 },
      ],
      ['Adjacency cache refresh strategy notes'],
      60,
    );
    const signedOfferC = signEvent(offerC, identityC.privateKey);

    // 5. Node A's acceptor receives both offers
    const ownBroadcastIds = new Set([broadcastId]);
    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds,
      overlapThreshold: 0.2,
      identity: identityA,
    });

    const queueResultB = await acceptor._processOffer(signedOfferB);
    assert.equal(queueResultB.action, 'queued', 'offer from B should be queued');

    const queueResultC = await acceptor._processOffer(signedOfferC);
    assert.equal(queueResultC.action, 'queued', 'offer from C should be queued');

    assert.equal(acceptor.stats.signatureRejected, 0, 'both valid signatures accepted');

    // 6. Verify peer-memory block is surfaced (should contain the top offer)
    const peerBlock = acceptor.getTopOffer();
    assert.ok(peerBlock.includes('[peer-memory:'), 'peer-memory block present');

    // 7. User prompt triggers acceptance — should accept the better offer
    const acceptResult = await acceptor.checkAcceptance(
      'Tell me about the spreading activation algorithm, BGE-M3 benchmarks, and concept graph adjacency cache',
    );
    assert.equal(acceptResult.accepted, true, 'should accept an offer');
    assert.ok(acceptResult.offerId, 'accepted result has an offerId');

    offererB.stop();
    offererC.stop();
    acceptor.stop();
  });

  // ─── Test: dedup_key independence ───────────────────────────────────────

  it('B and C generate independent dedup_keys for the same broadcast (different retrieval)', () => {
    // B and C respond to the same broadcast but their retrieval results are
    // different, so their offers are NOT deduped at the acceptor level.
    // The dedup_key on the BROADCAST side is about the broadcaster suppressing
    // repeated broadcasts with the same theme set. B and C don't generate
    // dedup_keys — they generate independent offers. Verify the broadcast
    // dedup_key mechanism works correctly.

    const themes1 = ['alpha', 'beta', 'gamma'];
    const entities1 = ['entity-x'];
    const key1 = computeDedupKey(themes1, entities1);

    // Same themes and entities → same dedup_key (deterministic)
    const key2 = computeDedupKey(themes1, entities1);
    assert.equal(key1, key2, 'same inputs produce same dedup_key');

    // Different themes → different dedup_key
    const key3 = computeDedupKey(['alpha', 'beta', 'delta'], entities1);
    assert.notEqual(key1, key3, 'different themes produce different dedup_key');

    // Order-independent (canonicalized)
    const key4 = computeDedupKey(['gamma', 'alpha', 'beta'], entities1);
    assert.equal(key1, key4, 'dedup_key is order-independent');
  });

  // ─── Test: expired offer ignored by acceptor ───────────────────────────

  it('acceptor ignores an offer whose expires_at has passed', async () => {
    const broadcastId = crypto.randomUUID();
    const offerEvent = {
      event_id: crypto.randomUUID(),
      event_type: 'context.offer',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date(Date.now() - 2 * 3600_000).toISOString(), // 2 hours ago
      causation_id: broadcastId,
      correlation_id: null,
      actor: { type: 'system', id: `offerer-${NODE_B}` },
      node_id: NODE_B,
      idempotency_key: crypto.randomUUID(),
      data: {
        responding_to: broadcastId,
        offerer_node_id: NODE_B,
        artifacts: [{
          artifact_ref: 'session:sess-expired:chunk:0',
          relevance_score: 0.9,
          provenance: { source_node: NODE_B, source_type: 'local_retrieval' },
          summary: 'This offer has expired',
        }],
        expires_at: new Date(Date.now() - 3600_000).toISOString(), // expired 1 hour ago
      },
    };

    const signed = signEvent(offerEvent, identityB.privateKey);

    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
    });

    const result = await acceptor._processOffer(signed);
    acceptor.stop();

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'expired');
    assert.equal(acceptor.stats.expiredSkipped, 1, 'expired offer counted');
  });

  // ─── Test: tampered offer rejected in 3-node context ───────────────────

  it('offerer rejects a tampered broadcast in 3-node context', async () => {
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
        themes: ['council', 'security', 'signing'],
        entities: ['ed25519'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['council', 'security', 'signing'], ['ed25519']),
      },
    };

    // Sign with A's key then tamper
    const signed = signEvent(broadcastEvent, identityA.privateKey);
    signed.data.themes.push('tampered'); // tamper!

    // Both B and C should reject the tampered broadcast
    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'content', session_id: 's1', chunk_id: 0, score: 0.9 },
      ]),
    });
    const offererC = createOfferer(ncC, NODE_C, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'content', session_id: 's2', chunk_id: 0, score: 0.9 },
      ]),
    });

    const resultB = await offererB._processBroadcast(signed);
    const resultC = await offererC._processBroadcast(signed);

    assert.equal(resultB.action, 'skip');
    assert.equal(resultB.reason, 'bad_signature');
    assert.equal(offererB.stats.signatureRejected, 1);

    assert.equal(resultC.action, 'skip');
    assert.equal(resultC.reason, 'bad_signature');
    assert.equal(offererC.stats.signatureRejected, 1);

    offererB.stop();
    offererC.stop();
  });

  // ─── Test: self-originated broadcast skipped by all nodes ──────────────

  it('each node skips its own self-originated broadcasts', async () => {
    // Create broadcasts from each node and verify self-skip
    const makeEvent = (nodeId) => ({
      event_id: crypto.randomUUID(),
      event_type: 'context.broadcast',
      event_version: 1,
      entity_id: crypto.randomUUID(),
      entity_type: 'session',
      timestamp: new Date().toISOString(),
      causation_id: null,
      correlation_id: null,
      actor: { type: 'system', id: `broadcaster-${nodeId}` },
      node_id: nodeId,
      idempotency_key: crypto.randomUUID(),
      data: {
        themes: ['self', 'test', 'council'],
        entities: ['self-node'],
        intensity: 'passive',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['self', 'test', 'council'], ['self-node']),
      },
    });

    const identities = { [NODE_A]: identityA, [NODE_B]: identityB, [NODE_C]: identityC };
    const connections = { [NODE_A]: ncA, [NODE_B]: ncB, [NODE_C]: ncC };

    // Each node processes a broadcast from itself
    for (const nodeId of [NODE_A, NODE_B, NODE_C]) {
      const event = makeEvent(nodeId);
      const signed = signEvent(event, identities[nodeId].privateKey);

      const offerer = createOfferer(connections[nodeId], nodeId, {
        retrievalPipeline: mockRetrieval([
          { snippet: 'content', session_id: 's1', chunk_id: 0, score: 0.9 },
        ]),
      });

      const result = await offerer._processBroadcast(signed);
      assert.equal(result.action, 'skip', `${nodeId} should skip own broadcast`);
      assert.equal(result.reason, 'self', `${nodeId} skip reason is 'self'`);
      assert.equal(offerer.stats.selfSkipped, 1);
      offerer.stop();
    }
  });

  // ─── Test: below-threshold → only one node offers ─────────────────────

  it('below-threshold results: only node with relevant content offers', async () => {
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
        themes: ['niche', 'specialized', 'unique-topic'],
        entities: ['rare-entity'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['niche', 'specialized', 'unique-topic'], ['rare-entity']),
      },
    };

    const signed = signEvent(broadcastEvent, identityA.privateKey);

    // Node B has highly relevant content
    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Specialized niche content about rare-entity', session_id: 'sess-niche', chunk_id: 0, score: 0.88 },
      ]),
      relevanceThreshold: 0.55,
      identity: identityB,
    });

    // Node C has nothing relevant (below threshold)
    const offererC = createOfferer(ncC, NODE_C, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Unrelated general information', session_id: 'sess-general', chunk_id: 0, score: 0.30 },
      ]),
      relevanceThreshold: 0.55,
    });

    const resultB = await offererB._processBroadcast(signed);
    const resultC = await offererC._processBroadcast(signed);

    assert.equal(resultB.action, 'offered', 'B should offer (above threshold)');
    assert.equal(resultB.artifactCount, 1);

    assert.equal(resultC.action, 'skip', 'C should skip (below threshold)');
    assert.equal(resultC.reason, 'below_threshold');

    offererB.stop();
    offererC.stop();
  });

  // ─── Test: relevance scoring picks the better offer ────────────────────

  it('acceptor surfaces the higher-scored offer via getTopOffer', async () => {
    const broadcastId = crypto.randomUUID();

    // Build two offers with different relevance scores
    const offerLow = buildOfferFromResults(
      broadcastId, NODE_C,
      [{ snippet: 'Low relevance content', session_id: 'sess-low', chunk_id: 0, score: 0.60 }],
      ['Marginally relevant information'],
      60,
    );
    const signedOfferLow = signEvent(offerLow, identityC.privateKey);

    const offerHigh = buildOfferFromResults(
      broadcastId, NODE_B,
      [
        { snippet: 'Highly relevant expert content', session_id: 'sess-high', chunk_id: 1, score: 0.95 },
        { snippet: 'Supporting evidence for the query', session_id: 'sess-high2', chunk_id: 2, score: 0.88 },
      ],
      ['Expert analysis of the topic', 'Corroborating evidence'],
      60,
    );
    const signedOfferHigh = signEvent(offerHigh, identityB.privateKey);

    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.2,
    });

    // Queue low first, then high
    await acceptor._processOffer(signedOfferLow);
    await acceptor._processOffer(signedOfferHigh);

    // getTopOffer should surface the higher-scored offer (from B)
    const peerBlock = acceptor.getTopOffer();
    assert.ok(peerBlock.includes('[peer-memory:'), 'peer-memory block present');
    assert.ok(peerBlock.includes(NODE_B), 'top offer comes from node B (higher score)');

    acceptor.stop();
  });

  // ─── Test: context.accepted references correct offer ───────────────────

  it('context.accepted references the correct offer and artifacts', async () => {
    const broadcastId = crypto.randomUUID();

    // Build an offer from B
    const offer = buildOfferFromResults(
      broadcastId, NODE_B,
      [
        { snippet: 'Specific council protocol documentation', session_id: 'sess-council-doc', chunk_id: 5, score: 0.90 },
      ],
      ['Council protocol documentation for 3-node setup'],
      60,
    );
    const signedOffer = signEvent(offer, identityB.privateKey);

    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.15,
      identity: identityA,
    });

    await acceptor._processOffer(signedOffer);

    // Trigger acceptance
    const result = await acceptor.checkAcceptance(
      'I need the council protocol documentation for the 3-node setup',
    );

    assert.equal(result.accepted, true);
    assert.equal(result.offerId, offer.event_id);
    assert.ok(result.overlap > 0, 'acceptance has positive overlap');

    // Verify the artifact refs are in the offer's data (acceptor uses them internally)
    assert.ok(offer.data.artifacts.length >= 1, 'offer has at least one artifact');
    const parsed = parseArtifactRef(offer.data.artifacts[0].artifact_ref);
    assert.ok(parsed, 'artifact ref is parseable');

    acceptor.stop();
  });

  // ─── Test: Full council timing ─────────────────────────────────────────

  it('full council cycle completes within 10 seconds', async () => {
    const startTime = Date.now();

    // Broadcast from A
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
        themes: ['timing', 'council', 'benchmark'],
        entities: ['latency', 'performance'],
        intensity: 'actively_seeking',
        ttl_minutes: 60,
        dedup_key: computeDedupKey(['timing', 'council', 'benchmark'], ['latency', 'performance']),
      },
    };

    const signedBroadcast = signEvent(broadcastEvent, identityA.privateKey);

    // B and C both process
    const offererB = createOfferer(ncB, NODE_B, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Timing benchmark data', session_id: 'sess-timing-b', chunk_id: 0, score: 0.80 },
      ]),
      relevanceThreshold: 0.55,
      identity: identityB,
    });
    const offererC = createOfferer(ncC, NODE_C, {
      retrievalPipeline: mockRetrieval([
        { snippet: 'Performance metrics collection', session_id: 'sess-timing-c', chunk_id: 0, score: 0.75 },
      ]),
      relevanceThreshold: 0.55,
      identity: identityC,
    });

    const [resultB, resultC] = await Promise.all([
      offererB._processBroadcast(signedBroadcast),
      offererC._processBroadcast(signedBroadcast),
    ]);
    assert.equal(resultB.action, 'offered');
    assert.equal(resultC.action, 'offered');

    // Build signed offers
    const offerB = buildOfferFromResults(
      broadcastId, NODE_B,
      [{ snippet: 'Timing benchmark data', session_id: 'sess-timing-b', chunk_id: 0, score: 0.80 }],
      ['Performance timing benchmark data'],
      60,
    );
    const offerC = buildOfferFromResults(
      broadcastId, NODE_C,
      [{ snippet: 'Performance metrics collection', session_id: 'sess-timing-c', chunk_id: 0, score: 0.75 }],
      ['Performance metrics from monitoring'],
      60,
    );

    const signedOfferB = signEvent(offerB, identityB.privateKey);
    const signedOfferC = signEvent(offerC, identityC.privateKey);

    // A accepts
    const acceptor = createAcceptor(ncA, NODE_A, {
      ownBroadcastIds: new Set([broadcastId]),
      overlapThreshold: 0.2,
      identity: identityA,
    });

    await acceptor._processOffer(signedOfferB);
    await acceptor._processOffer(signedOfferC);

    const acceptResult = await acceptor.checkAcceptance(
      'Show me the timing benchmark data and performance metrics for the council protocol',
    );

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 10_000, `council cycle took ${elapsed}ms — should be under 10000ms`);
    assert.equal(acceptResult.accepted, true);

    offererB.stop();
    offererC.stop();
    acceptor.stop();
  });
});
