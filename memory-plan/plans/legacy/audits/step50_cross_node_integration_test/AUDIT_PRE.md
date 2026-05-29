# AUDIT_PRE — Step 9.6: Cross-node integration test for broadcast → offer → accepted round-trip

## §1 — Intent

Step 9.6 creates a deterministic two-node integration test that validates the full broadcast protocol round-trip: node A emits a `context.broadcast`, peer node B's offerer receives it and produces a `context.offer`, node A's acceptor queues and surfaces the offer, and after a token-overlap match in the next prompt, node A emits `context.accepted`. This is the last step in Block 9 and provides the automated guard against regressions in Block 10+.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.6 | v9.6 | [A] | Cross-node integration test for broadcast → offer → accepted round-trip |

## §3 — Design decisions (from AUDIT_POST Step 9.5 §6)

- Test baseline: 1014 tests (939 pass, 75 fail — 73 pre-existing + 2 flaky variance). +30 `it()` blocks added in Step 9.5.
- `lib/extraction-store.mjs` now exposes `db` (raw Database handle) — available for direct DB assertions in cross-node test.
- `filterPrivateResults` at `lib/retrieval-pipeline.mjs:366` — available for verifying private items don't cross the offer boundary.
- The offerer's `filterPrivateItems` at `lib/broadcast-offerer.mjs:160` is now active (the `private` column exists). All entities default to private → offerer will filter ALL entity-linked sessions until items are published.
- Step 9.6 should verify: broadcast from node A → offerer on node B only offers public items → acceptor on node A receives offer → accepted event flows back. Private items must never cross the offer boundary.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Schema dynamic import may fail in test context | LOW | Tests use the same pattern as existing broadcast tests — mock NATS, real pure functions. Schema validation happens inside the modules; test exercises the exported APIs. |
| No real NATS broker available in CI | LOW | Test uses mock NATS connections (same pattern as all Block 9 tests). The `_processBroadcast` and `_processOffer` entry points are exposed for deterministic testing. |
| Privacy filter depends on SQLite | LOW | Test creates in-memory SQLite DB for extraction store, populates with test data, passes to offerer's `filterPrivateItems`. |

## §5 — Deferrals

- Real multi-process NATS integration (requires running nats-server) is out of scope — this test uses in-process mocks per the frozen decision.
- Wiring `@publish` directive into the daemon's per-prompt path is deferred (per Step 9.5 carry-forward).

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `test/broadcast-cross-node.test.mjs` | new | Two-node integration test: 8 `describe` groups covering full round-trip, TTL-expired broadcasts, privacy filtering, offer expiry, artifact ref flow, self-skip, below-threshold skip, non-matching responding_to skip. ~8-10 `it()` blocks. Uses mock NATS connections with shared message bus, mock retrieval pipeline, and in-memory extraction store for privacy tests. |
