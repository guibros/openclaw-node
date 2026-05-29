# AUDIT_PRE — Step 10.2: NATS cluster setup (`services/nats/` plists + `docs/NATS_CLUSTER.md`)

## §1 — Intent

Stand up the launchd-managed 3-node NATS cluster infrastructure that Block 10's integration tests (Steps 10.5–10.7) and the dogfood harness (Step 10.9) will consume. This step produces config files and documentation only — no code logic changes, no new library modules.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.2 | v10.2 | [A] | NATS cluster setup (`services/nats/` plists + `docs/NATS_CLUSTER.md`) |

## §3 — Design decisions (consumed from Step 10.1 AUDIT_POST §6)

- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance).
- `bin/spawn-node.mjs` creates node trees but does NOT start NATS processes — that's this step.
- `config/node.json` stores `nats_url` for spawned nodes connecting to the cluster.
- `nats-server` binary confirmed at `/opt/homebrew/bin/nats-server` (Homebrew install).
- Block 10 §0: "Real NATS, not ephemeral in-process" — requires actual `nats-server` instances.
- Block 10 §0: "NATS cluster size: 3" — minimum for R=3 federation.
- Block 10 §0: ports 4222/4223/4224 per the step description.
- Existing pattern: `services/launchd/ai.openclaw.*.plist` uses `${OPENCLAW_WORKSPACE}` and `${HOME}` placeholders.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| NATS config syntax error prevents cluster formation | LOW | Configs follow NATS documentation verbatim; testable via `nats-server --config <file> -t` (dry-run) |
| Port conflict on 4222 (existing single-node NATS) | LOW | Documentation covers shutdown of standalone NATS before starting cluster |
| launchd plist placeholders inconsistent with existing convention | LOW | Follow exact pattern from `ai.openclaw.consolidation-scheduler.plist` |

## §5 — Deferrals

- Actually STARTING the cluster (operator action after deployment) — documented, not automated.
- Identity key generation for nodes (Step 10.4).
- Wiring `ensureSharedStream` at daemon startup (Step 10.3).

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `services/nats/nats-1.conf` | new | NATS config for node 1: client 4222, cluster 6222, routes to 6223+6224, JetStream enabled with data dir |
| 2 | `services/nats/nats-2.conf` | new | NATS config for node 2: client 4223, cluster 6223, routes to 6222+6224 |
| 3 | `services/nats/nats-3.conf` | new | NATS config for node 3: client 4224, cluster 6224, routes to 6222+6223 |
| 4 | `services/nats/ai.openclaw.nats-1.plist` | new | launchd plist for NATS node 1 |
| 5 | `services/nats/ai.openclaw.nats-2.plist` | new | launchd plist for NATS node 2 |
| 6 | `services/nats/ai.openclaw.nats-3.plist` | new | launchd plist for NATS node 3 |
| 7 | `docs/NATS_CLUSTER.md` | new | Deployment documentation for local dev + real-VM setup |
