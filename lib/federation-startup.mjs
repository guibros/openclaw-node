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
  // F-P101 fix: self-trust uses force=true so a stale/wrong registry entry
  // for our own nodeId can't silently lock us out. Previously, if an
  // operator ran `openclaw-trust-peer <our-nodeId> <wrong-pubkey>` by
  // accident (or a malicious peer pre-registered us), registry.trust() was
  // a no-op and every event we published failed verification on every
  // node as `registry:pubkey-mismatch` — including our own acceptor.
  registry.trust(nodeId, identity.publicKeyBase64, 'self', { force: true });
  // F-P105 fix: count peers as "registry entries excluding self," not
  // "size - 1". With self-trust now reliable via force=true the simpler
  // calculation also works, but the explicit filter is clearer and
  // robust against any future registry-entry source.
  const peerCount = registry.entries().filter(([k]) => k !== nodeId).length;
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
      // F-P106 fix: F-H6 added a SECOND fail-CLOSED privacy check at the
      // peer-facing boundary, precisely because the retrieval-layer filter
      // has had multiple regression escapes (F-N50/N51/N102). Without
      // extractionDb here, the offerer's filterPrivateItems becomes a
      // pass-through, reverting to single-point-of-failure.
      extractionDb: opts.extractionDb,
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
      // F-P104 fix: broadcaster DOES have a stop() that clears the 5-min
      // dedup-sweep setInterval. Previously the stale comment claimed it
      // didn't, and the timer leaked across construct/teardown cycles
      // (a real cost in test scenarios that build and stop federation in
      // a loop). Order: offerer + acceptor first (they touch NATS), then
      // broadcaster (just clears timers).
      if (offerer) await offerer.stop();
      if (acceptor) await acceptor.stop();
      try { broadcaster.stop?.(); } catch { /* best-effort */ }
    },
  };
}

/** Default node-id resolver. Matches memory-subscriber.mjs's convention. */
export function defaultNodeId() {
  return process.env.OPENCLAW_NODE_ID || os.hostname();
}
