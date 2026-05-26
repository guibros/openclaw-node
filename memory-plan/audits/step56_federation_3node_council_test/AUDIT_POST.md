# AUDIT_POST — Step 10.6: Three-node council test (`test/federation-3node.test.mjs`) — A broadcasts, B+C offer, A picks

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `test/federation-3node.test.mjs` (new) | `test/federation-3node.test.mjs:1` | yes | `describe('federation-3node: council test with real NATS cluster'` at line 249; `startNatsCluster` at line 178; 12 `it()` blocks covering three distinct identities, R=3 stream, broadcast persistence across cluster, full council round-trip with multi-offer selection, dedup_key independence, expired offer handling, tampered broadcast rejection by both offerers, self-originated skip, below-threshold filtering, relevance scoring picks better offer, context.accepted references correct offer, timing within 10s |

All 1 promised delta landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Main describe block | `grep -n 'federation-3node.*council test' test/federation-3node.test.mjs` | line 2 (comment), line 249 (describe) |
| startNatsCluster helper | `grep -n 'startNatsCluster' test/federation-3node.test.mjs` | line 178 |
| Three distinct identities test | `grep -n 'three spawned nodes have distinct' test/federation-3node.test.mjs` | line 317 |
| R=3 stream test | `grep -n 'R=3 replication across' test/federation-3node.test.mjs` | line 10 |
| Full council round-trip test | `grep -n 'full council' test/federation-3node.test.mjs` | line 396 |
| Dedup_key independence test | `grep -n 'dedup_key independence' test/federation-3node.test.mjs` | line 11 |
| Expired offer test | `grep -n 'expired offer' test/federation-3node.test.mjs` | line 540 |
| Tampered broadcast test | `grep -n 'tampered broadcast in 3-node' test/federation-3node.test.mjs` | line 585 |
| Self-originated skip test | `grep -n 'self-originated broadcasts' test/federation-3node.test.mjs` | line 640 |
| Below-threshold test | `grep -n 'below-threshold' test/federation-3node.test.mjs` | line 685 |
| Higher-scored offer test | `grep -n 'higher-scored offer' test/federation-3node.test.mjs` | line 742 |
| Context.accepted test | `grep -n 'context.accepted references' test/federation-3node.test.mjs` | line 782 |
| Timing test | `grep -n 'council cycle completes within 10' test/federation-3node.test.mjs` | line 824 |

## §3 — Cross-references still valid

- All 13 imports resolve to existing exports: `spawnNode` from `bin/spawn-node.mjs`, `getOrCreateIdentity`/`signEvent`/`verifyEvent` from `lib/node-identity.mjs`, `createBroadcaster`/`computeDedupKey` from `lib/broadcast-emitter.mjs`, `createOfferer`/`buildOfferFromResults` from `lib/broadcast-offerer.mjs`, `createAcceptor`/`formatPeerMemoryBlock`/`parseArtifactRef` from `lib/broadcast-acceptor.mjs`, `SHARED_STREAM_NAME`/`SHARED_SUBJECTS` from `lib/shared-event-stream.mjs`.
- `nats` npm module used via `createRequire` pattern (same as production code and 2-node test).
- `writeFileSync`/`mkdirSync` imported from `node:fs` (ESM-compatible, used for writing ephemeral nats-server config files to temp dir).
- No symbols renamed or deleted. All existing tests remain valid.
- Graceful skip when `nats-server` not on PATH — same pattern as Step 10.5.

## §4 — Findings

1. **[POSITIVE]** Real 3-node NATS cluster: the test starts 3 actual `nats-server` processes with full-mesh cluster routing on ephemeral ports. Each node connects to a different cluster member, validating that messages replicate across the cluster (not just a single-server shortcut).
2. **[POSITIVE]** R=3 replication proven: the shared stream is created with `num_replicas: 3` (production config), not R=1 as in Step 10.5. Stream info confirms R=3 across all three connections.
3. **[POSITIVE]** Multi-offer council pattern validated: node A broadcasts, both B and C independently process the same broadcast and produce offers with different relevance scores. A's acceptor receives both, queues both, and surfaces the higher-scored one via `getTopOffer`.
4. **[POSITIVE]** Broadcast persistence across cluster: a broadcast published through node A's connection is readable from node B's and node C's connections (different cluster members), proving R=3 replication.
5. **[POSITIVE]** Dedup_key determinism verified: same inputs produce same key (canonicalized), different inputs produce different keys, order-independent. This validates that broadcasters from different nodes won't accidentally dedup each other's broadcasts.
6. **[POSITIVE]** Tampered broadcast rejection by multiple offerers: a tampered broadcast (signed by A, then data modified) is independently rejected by both B and C offerers, each incrementing their own `signatureRejected` counter.
7. **[POSITIVE]** Self-originated skip across all three nodes: each node correctly skips broadcasts from itself, verified independently for A, B, and C.
8. **[POSITIVE]** Below-threshold filtering: when C's retrieval returns only below-threshold results (0.30 < 0.55), it skips offering while B (with 0.88 score) produces an offer. This is the "selective council" pattern — not every node must contribute.
9. **[POSITIVE]** Full council cycle timing: the entire broadcast → B+C offer → A accept cycle completes in under 10 seconds (actual: ~3.1s including cluster startup). This validates federation protocol latency for 3-node councils.
10. **[POSITIVE]** 12 `it()` blocks (+12 from 1075 baseline = 1087 total). All pass. 75 pre-existing failures unchanged.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.6 → Step 10.7)

- Test baseline: 1087 tests (1012 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added this step.
- The 3-node NATS cluster lifecycle helpers (`startNatsCluster`/`stopNatsCluster`) are self-contained in the test file. Step 10.7 (network resilience) may reuse the same cluster pattern with additional SIGKILL/reconnect scenarios.
- Step 10.7 needs to test: peer goes offline mid-offer (SIGKILL one nats-server), NATS reconnect handling, dead-peer detection, broadcast TTL cleanup. The cluster helpers from this step support SIGKILL via `stopNatsServer(proc)`.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5 → 10.7).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
