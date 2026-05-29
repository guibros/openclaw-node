# AUDIT_PRE — Step 10.5: Two-node integration test (`test/federation-2node.test.mjs`) — real NATS, real round-trip

## §1 — Intent

Validate the full federation broadcast → offer → accepted round-trip using REAL NATS JetStream (not mock connections). This test spawns a real `nats-server` process, creates two isolated openclaw node trees with distinct ed25519 identities (from Steps 10.1 + 10.4), runs the broadcast protocol across the shared stream, and asserts that signatures are verified, content is matched, and the protocol completes correctly on real network infrastructure.

Step 9.6 validated the protocol logic with mock NATS; this step proves it works on the real wire.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.5 | v10.5 | [A] | Two-node integration test (`test/federation-2node.test.mjs`) — real NATS, real round-trip |

## §3 — Design decisions (from Step 10.4 AUDIT_POST §6)

- Test baseline: 1064 tests (989 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added in Step 10.4.
- `getOrCreateIdentity()` creates keypair at `<dir>/identity.key`. For spawned nodes (Step 10.1), the identity dir is `~/.openclaw-<nodeid>/`. This test verifies both nodes have distinct identities.
- Signing is wired into `publishLocal` via `opts.identity`. The memory daemon needs to pass its identity at startup — this wiring is validated by the integration test setup.
- STRICT verification is active in offerer and acceptor. This test verifies that signed events traverse the federation loop correctly (broadcast signed by A → offerer on B verifies → offer signed by B → acceptor on A verifies).
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- Dist files for event-schemas need full tsc rebuild when toolchain available.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| `nats-server` not available in CI/test environments | MEDIUM | Test uses `describe` skip when `nats-server` binary not found on PATH — graceful degradation, not a hard failure |
| Port collision with running NATS instances | LOW | Test uses port 0 / dynamic port allocation via nats-server `-p 0` flag + `-a 127.0.0.1` bind |
| Temp directory cleanup on test failure | LOW | `after()` hooks with force-cleanup; node trees created in os.tmpdir() |
| JetStream stream with R=1 vs production R=3 | LOW | Acceptable — test validates protocol, not replication. Single nats-server can only support R=1. The R=3 3-node cluster is tested in Step 10.6 |

## §5 — Deferrals

- Three-node council testing deferred to Step 10.6.
- Network resilience (peer-offline, reconnect) deferred to Step 10.7.
- `@publish` directive daemon wiring deferred (carried forward).

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `test/federation-2node.test.mjs` | new | Two-node integration test with real NATS: ~10 `it()` blocks covering full round-trip with signatures, distinct node identities, signature verification across nodes, tampered signature rejection by offerer, tampered signature rejection by acceptor, self-originated broadcast skip, TTL-expired broadcast skip, timing assertions, JetStream message persistence, and NATS connection cleanup. Uses `child_process.spawn` for nats-server lifecycle, `spawnNode` + `getOrCreateIdentity` for node setup, and real `nats` npm module connections. Includes `before`/`after` hooks for nats-server process management and temp directory cleanup. Skips entire suite when nats-server is not on PATH. |
