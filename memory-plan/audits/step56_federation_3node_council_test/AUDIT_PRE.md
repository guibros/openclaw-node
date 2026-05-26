# AUDIT_PRE — Step 10.6: Three-node council test (`test/federation-3node.test.mjs`) — A broadcasts, B+C offer, A picks

## §1 — Intent

Validate the full federation council pattern with 3 real NATS servers forming an R=3 cluster, 3 spawned openclaw nodes with distinct ed25519 identities. Node A broadcasts, nodes B and C independently process the broadcast and produce competing offers, A's acceptor receives both, selects the higher-scoring one via relevance, and emits context.accepted. This is the first test exercising R=3 replication and multi-offer selection.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.6 | v10.6 | [A] | Three-node council test (`test/federation-3node.test.mjs`) — A broadcasts, B+C offer, A picks |

## §3 — Design decisions (consumed from Step 10.5 AUDIT_POST §6)

- Test baseline: 1075 tests (1000 pass, 75 fail — 73 pre-existing + 2 flaky variance). +11 `it()` blocks added in Step 10.5.
- The nats-server lifecycle helper (`startNatsServer`/`stopNatsServer`) and `createTestSharedStream` from Step 10.5 are reusable patterns. This step re-implements them locally in the 3-node test file (no shared extraction needed — self-contained tests are simpler and Step 10.5's helpers are already tightly scoped to 2-node).
- Step 10.6 needs 3 NATS servers for R=3 replication. The existing `services/nats/nats-{1,2,3}.conf` files from Step 10.2 provide the cluster config pattern — but the test uses ephemeral ports and temp store dirs to avoid conflicts with dev NATS instances.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5 → 10.6).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | 3 nats-server processes forming a cluster may take longer to converge | LOW | Use `cluster_ready` log message detection + generous 15s timeout per server. Graceful skip if nats-server unavailable. |
| 2 | R=3 stream creation may fail if cluster not fully converged | LOW | Wait for all 3 servers to be up before creating the shared stream. Retry with backoff if needed. |
| 3 | Port conflicts with running dev NATS instances | LOW | Use randomized high port range (15000+) with random offset. |
| 4 | Test file size — 3-node has more setup than 2-node | LOW | Extract cluster management into a helper section at the top; keep individual tests focused. |

## §5 — Deferrals

- `@publish` directive wiring (carried from 9.5 → 10.4 → 10.5 → 10.6 → 10.7).
- event-schemas dist rebuild (carried from 10.4 → 10.5 → 10.6 → 10.7).

## §6 — Phase 4 implementation outline

| # | File | Action | Detail |
|---|------|--------|--------|
| 1 | `test/federation-3node.test.mjs` | new | Three-node council test with real 3-node NATS cluster (R=3). Starts 3 `nats-server` processes with cluster routing on ephemeral ports, spawns 3 isolated openclaw node trees (A/B/C) with distinct ed25519 identities. ~12 `it()` blocks covering: (1) three distinct identities, (2) R=3 stream created across cluster, (3) broadcast signed by A persists in R=3 stream, (4) full council round-trip: A broadcasts → B and C both offer → A picks higher-scored → context.accepted, (5) dedup_key independence: B and C generate different dedup_keys for the same broadcast (independent retrieval), (6) expired offer ignored by acceptor, (7) tampered offer rejected in 3-node context, (8) self-originated broadcast skipped by all three nodes, (9) below-threshold results: one node has relevant content, other does not → only one offer produced, (10) relevance scoring: A picks the higher-scored offer, (11) context.accepted references the correct offer and artifacts, (12) timing: full council cycle completes within 10 seconds. Uses `startNatsCluster`/`stopNatsCluster` helpers for 3-server lifecycle management with cluster convergence detection. |
