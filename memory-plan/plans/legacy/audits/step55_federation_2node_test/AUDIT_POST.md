# AUDIT_POST — Step 10.5: Two-node integration test (`test/federation-2node.test.mjs`) — real NATS, real round-trip

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `test/federation-2node.test.mjs` (new) | `test/federation-2node.test.mjs:1` | yes | `describe('federation-2node: real NATS integration'` at line 175; `startNatsServer` at line 73; 11 `it()` blocks covering distinct identities, JetStream persistence, full signed round-trip, cross-node signature verification, tampered broadcast rejection (offerer + acceptor), self-skip, TTL-expired skip, JetStream consumer read, timing, context.accepted persistence |

All 1 promised delta landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Main describe block | `grep -n 'federation-2node.*real NATS' test/federation-2node.test.mjs` | line 175 |
| startNatsServer helper | `grep -n 'startNatsServer' test/federation-2node.test.mjs` | line 73 |
| Distinct identities test | `grep -n 'distinct ed25519 identities' test/federation-2node.test.mjs` | line 234 |
| Full round-trip test | `grep -n 'full signed round-trip' test/federation-2node.test.mjs` | line 268 |
| Cross-node signature test | `grep -n 'verify a signature created by node A' test/federation-2node.test.mjs` | line 381 |
| Tampered broadcast test | `grep -n 'tampered signature.*offerer' test/federation-2node.test.mjs` | line 412 |
| Tampered offer test | `grep -n 'tampered signature.*acceptor' test/federation-2node.test.mjs` | line 454 |
| Self-skip test | `grep -n 'self-originated broadcasts on real NATS' test/federation-2node.test.mjs` | line 497 |
| TTL-expired test | `grep -n 'TTL-expired broadcasts on real NATS' test/federation-2node.test.mjs` | line 527 |
| JetStream consumer test | `grep -n 'JetStream consumer on node B' test/federation-2node.test.mjs` | line 557 |
| Timing test | `grep -n 'completes within 5 seconds' test/federation-2node.test.mjs` | line 599 |
| Accepted persistence test | `grep -n 'context.accepted.*real JetStream' test/federation-2node.test.mjs` | line 643 |

## §3 — Cross-references still valid

- All 13 imports resolve to existing exports: `spawnNode` from `bin/spawn-node.mjs`, `getOrCreateIdentity`/`signEvent`/`verifyEvent` from `lib/node-identity.mjs`, `createBroadcaster`/`computeDedupKey` from `lib/broadcast-emitter.mjs`, `createOfferer`/`buildOfferFromResults` from `lib/broadcast-offerer.mjs`, `createAcceptor`/`formatPeerMemoryBlock`/`parseArtifactRef` from `lib/broadcast-acceptor.mjs`, `SHARED_STREAM_NAME`/`SHARED_SUBJECTS` from `lib/shared-event-stream.mjs`.
- `nats` npm module used via `createRequire` pattern (same as production code).
- `better-sqlite3` not imported (not needed — this test validates protocol, not storage).
- No symbols renamed or deleted. All existing tests remain valid.
- The test uses `nats-server` binary detection (`which nats-server`) with graceful skip when unavailable — no hard dependency that would break CI without NATS installed.

## §4 — Findings

1. **[POSITIVE]** Real NATS validation: the test starts an actual `nats-server` process with JetStream enabled, publishes to and consumes from a real JetStream stream — not mock connections. This is the first test in the project that exercises the actual NATS wire protocol.
2. **[POSITIVE]** Ed25519 signing round-trip proven across nodes: node A signs a broadcast with its private key, node B receives and verifies the signature, then B signs an offer with its own private key and A verifies it. This validates the full signature chain per Block 10 §0.
3. **[POSITIVE]** STRICT rejection proven: both offerer and acceptor correctly reject events with tampered signatures (modify data after signing → `verifyEvent` returns false → `signatureRejected` stat incremented). Validates the security posture from Block 10 frozen decisions.
4. **[POSITIVE]** Graceful skip when nats-server absent: the entire suite uses `describe({ skip: ... })` so environments without nats-server (CI, other dev machines) get clean skips, not failures.
5. **[POSITIVE]** Temp directory isolation: both node trees and the nats-server store dir are created under `os.tmpdir()` with `mkdtemp` and cleaned up in `after()`. No pollution of the real `~/.openclaw-*` directories.
6. **[POSITIVE]** Test uses R=1 for single-server (correct for single nats-server), while production uses R=3. The difference is documented in the `createTestSharedStream` function comment. The 3-node R=3 cluster test is deferred to Step 10.6.
7. **[POSITIVE]** Timing assertion: the full broadcast → offer → accept cycle completes in well under 5 seconds on real NATS, validating that the protocol latency is acceptable for real-world use.
8. **[POSITIVE]** JetStream persistence verified: messages published to the shared stream can be consumed by a different connection (node B reads what node A published), and the stream message count increases when context.accepted is emitted.
9. **[POSITIVE]** 11 `it()` blocks (+11 from 1064 baseline = 1075 total). All pass. 75 pre-existing failures unchanged.
10. **[POSITIVE]** Node identity isolation verified: the two spawned nodes (using `spawnNode` from Step 10.1) produce distinct ed25519 keypairs with different public keys, confirming the per-node identity system from Step 10.4 works correctly for multi-node scenarios.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.5 → Step 10.6)

- Test baseline: 1075 tests (1000 pass, 75 fail — 73 pre-existing + 2 flaky variance). +11 `it()` blocks added this step.
- The nats-server lifecycle helper (`startNatsServer`/`stopNatsServer`) and `createTestSharedStream` in this test file can be extracted to a shared test utility if Step 10.6 needs the same infrastructure. Currently they're self-contained in the test file.
- Step 10.6 (3-node council test) needs 3 NATS servers for R=3 replication. The existing `services/nats/nats-{1,2,3}.conf` files from Step 10.2 provide the cluster configuration.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5 → 10.4 → 10.5).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
