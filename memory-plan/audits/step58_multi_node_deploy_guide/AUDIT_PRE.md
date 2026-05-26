# AUDIT_PRE — Step 10.8: `docs/MULTI_NODE_DEPLOY.md` — soup-to-nuts deployment guide for real-hardware council

## §1 — Intent

Create a comprehensive deployment guide (`docs/MULTI_NODE_DEPLOY.md`) for standing up a 3-node OpenClaw council on real hardware. Covers prerequisites, per-node setup, identity key generation, NATS cluster configuration, shared stream verification, end-to-end broadcast round-trip testing, troubleshooting, and rollback. Documentation-only step; zero functional code changes.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.8 | v10.8 | [A] | `docs/MULTI_NODE_DEPLOY.md` — soup-to-nuts deployment guide for real-hardware council |

## §3 — Design decisions (consumed from Step 10.7 AUDIT_POST §6)

- Test baseline: 1102 tests (1027 pass, 75 fail — 73 pre-existing + 2 flaky variance).
- `createPeerTracker` is available for use by any daemon — document `DEAD_PEER_TIMEOUT_MIN` env var in the deployment guide.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5 → 10.8+).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
- Daemon does not yet instantiate a shared `peerTracker` to pass to offerer/acceptor — offerer/acceptor are separate processes; document this architecture in deployment guide.

Per RESUME.md §0 Block 10 frozen decisions:
- Targets any combination of macOS/Linux nodes.
- NATS cluster size: 3 (R=3 replication).
- Node identity = ed25519 keypair at `<node-root>/identity.key`.
- Auth strictness: STRICT — reject events with bad signatures.
- Real NATS, not ephemeral in-process.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Guide references features not yet tested on real multi-machine | LOW | Guide cross-references existing integration tests (Steps 10.5/10.6/10.7) and documents verification commands |
| Guide becomes stale as code evolves | LOW | Guide references CLI commands and env vars rather than line numbers; structural changes would require a docs update |

No HIGH-severity risks.

## §5 — Deferrals

- Actual multi-machine deployment testing deferred to operator post-guide.
- Kubernetes/Docker deployment paths out of scope — guide covers bare metal + systemd + launchd + Tailscale.
- `@publish` directive wiring continues to be deferred.
- Event-schemas dist rebuild continues to be deferred.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `docs/MULTI_NODE_DEPLOY.md` | new | Comprehensive deployment guide covering: prerequisites (Node.js ≥18, nats-server ≥2.6, Ollama optional), per-node setup via `bin/spawn-node.mjs`, identity key generation via `lib/node-identity.mjs`, NATS cluster config (local dev + multi-machine + Tailscale), shared stream R=3 verification, memory daemon startup with federation, end-to-end broadcast→offer→accepted round-trip test, environment variables reference, troubleshooting (firewall, DNS, signature mismatch, dead peers), and rollback procedure |
