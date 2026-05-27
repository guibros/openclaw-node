/**
 * federation-startup.mjs — Wire the federation factories into a running daemon.
 *
 * F-N1 fix: the previous review found that createBroadcaster / createOfferer /
 * createAcceptor were correctly implemented but NEVER INSTANTIATED outside
 * tests. None of bin/ called them. The signing/auth/replay work from
 * Cluster A was effectively dead code at runtime.
 *
 * F-N2 fix: even when callers existed, `opts.registry` and `opts.seenIds`
 * defaulted to null, disabling the nodeId↔pubkey binding (F-C3) and the
 * replay-event LRU (F-C4). This module constructs both and threads them
 * into every factory.
 *
 * F-N3 fix: default mode is STRICT, not TOFU. A TOFU default lets the first
 * attacker reaching the shared NATS stream become the trusted alice-node,
 * locking the real alice out forever (pubkey-mismatch). Strict requires
 * explicit registration via `bin/openclaw-trust-peer`. Set
 * OPENCLAW_TRUST_MODE=tofu to override (only for dev / single-node bootstrapping).
 *
 * Usage:
 *   import { startFederation } from '../lib/federation-startup.mjs';
 *   const fed = await startFederation(nc, nodeId, {
 *     extractionDb, knowledgeDb, graphCache, log
 *   });
 *   // ... daemon runs ...
 *   await fed.stop();
 *
 * Returns { broadcaster, offerer, acceptor, registry, seenIds, stats, stop }.
 */

import os from 'node:os';
import {
  getOrCreateIdentity,
  createIdentityRegistry,
  createSeenEventCache,
} from './node-identity.mjs';

/**
 * @param {object} nc — NATS connection
 * @param {string} nodeId — this node's identifier
 * @param {object} opts
 * @param {import('better-sqlite3').Database} [opts.extractionDb]
 * @param {import('better-sqlite3').Database} [opts.knowledgeDb]
 * @param {object} [opts.graphCache] — Block 6 graph cache (optional)
 * @param {string} [opts.identityDir] — path to ~/.openclaw equivalent
 * @param {string} [opts.trustMode] — 'strict' (default) | 'tofu' (dev)
 * @param {number} [opts.seenCacheSize=10000]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{
 *   broadcaster: any, offerer: any, acceptor: any,
 *   registry: any, seenIds: any, identity: any,
 *   stop: () => Promise<void>
 * }>}
 */
export async function startFederation(nc, nodeId, opts = {}) {
  const log = opts.log || (() => {});
  const trustMode = opts.trustMode
    || process.env.OPENCLAW_TRUST_MODE
    || 'strict';

  // 1. Identity. getOrCreateIdentity is idempotent — uses existing keypair
  //    if present, else generates and persists one.
  const identity = getOrCreateIdentity(opts.identityDir);
  log(`[federation] identity loaded — pubkey ${identity.publicKeyBase64}`);

  // 2. Registry — nodeId↔pubkey trust bindings. STRICT mode in production
  //    so an attacker reaching the shared stream first can't TOFU-spoof.
  const registry = createIdentityRegistry({ mode: trustMode });
  // Always self-trust: our own events should verify against our own
  // registered pubkey. This is the one TOFU we accept because the binding
  // is to a key we generated ourselves.
  registry.trust(nodeId, identity.publicKeyBase64, 'self');
  const peerCount = registry.entries().length - 1;  // minus self
  log(`[federation] registry mode=${trustMode}, ${peerCount} trusted peer(s)`);
  if (trustMode === 'strict' && peerCount === 0) {
    log(`[federation] WARNING: strict mode with no registered peers. ` +
        `Run "openclaw-trust-peer --my-pubkey" on each peer and share, ` +
        `then "openclaw-trust-peer <peerNodeId> <peerPubkey>" on this node.`);
  }

  // 3. Replay protection — F-C4. Bounded LRU of seen event_ids.
  const seenIds = createSeenEventCache(opts.seenCacheSize || 10_000);

  // 4. Build the three federation modules. Imports are lazy to keep the
  //    startup cost small for single-node deployments that disable federation.
  const { createBroadcaster } = await import('./broadcast-emitter.mjs');
  const { createOfferer }     = await import('./broadcast-offerer.mjs');
  const { createAcceptor }    = await import('./broadcast-acceptor.mjs');

  const sharedDeps = { identity, registry, seenIds, log };

  const broadcaster = createBroadcaster(nc, nodeId, sharedDeps);

  let offerer = null;
  let acceptor = null;
  if (opts.extractionDb && opts.knowledgeDb) {
    // The retrieval pipeline is what the offerer uses to score peer broadcasts
    // against local memory. Without these DBs the offerer has nothing to offer,
    // so we just skip it (a still-running broadcaster is still useful).
    const { createRetrievalPipeline } = await import('./retrieval-pipeline.mjs');
    const retrievalPipeline = createRetrievalPipeline({
      knowledgeDb: opts.knowledgeDb,
      extractionDb: opts.extractionDb,
      graphCache: opts.graphCache || null,
      // F-N50/F-N51: offerer always respects privacy. Private memory must
      // never become a peer offer.
      respect_privacy: true,
    });
    offerer = createOfferer(nc, nodeId, {
      ...sharedDeps,
      retrievalPipeline,
    });
    acceptor = createAcceptor(nc, nodeId, {
      ...sharedDeps,
      // ownBroadcastIds: pull from the broadcaster's published set so we
      // recognize offers responding to our broadcasts.
      ownBroadcastIds: () => broadcaster.publishedIds?.() ?? new Set(),
    });
    await offerer.start();
    await acceptor.start();
    log(`[federation] offerer + acceptor started`);
  } else {
    log(`[federation] broadcaster only (no extractionDb/knowledgeDb)`);
  }

  return {
    broadcaster,
    offerer,
    acceptor,
    registry,
    seenIds,
    identity,
    async stop() {
      if (offerer) await offerer.stop();
      if (acceptor) await acceptor.stop();
      // broadcaster doesn't currently have a stop() (stateless emitter); add
      // if/when it gains background work.
    },
  };
}

/** Default node-id resolver. Matches memory-subscriber.mjs's convention. */
export function defaultNodeId() {
  return process.env.OPENCLAW_NODE_ID || os.hostname();
}
