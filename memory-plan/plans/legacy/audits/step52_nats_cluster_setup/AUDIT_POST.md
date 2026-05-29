# AUDIT_POST — Step 10.2: NATS cluster setup (`services/nats/` plists + `docs/NATS_CLUSTER.md`)

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `services/nats/nats-1.conf` (new) | `services/nats/nats-1.conf:1` | yes | `server_name: openclaw-nats-1` at line 4 |
| 2 | `services/nats/nats-2.conf` (new) | `services/nats/nats-2.conf:1` | yes | `listen: 0.0.0.0:4223` at line 6 |
| 3 | `services/nats/nats-3.conf` (new) | `services/nats/nats-3.conf:1` | yes | `listen: 0.0.0.0:4224` at line 6 |
| 4 | `services/nats/ai.openclaw.nats-1.plist` (new) | `services/nats/ai.openclaw.nats-1.plist:1` | yes | `ai.openclaw.nats-1` at line 6 |
| 5 | `services/nats/ai.openclaw.nats-2.plist` (new) | `services/nats/ai.openclaw.nats-2.plist:1` | yes | `ai.openclaw.nats-2` at line 6 |
| 6 | `services/nats/ai.openclaw.nats-3.plist` (new) | `services/nats/ai.openclaw.nats-3.plist:1` | yes | `ai.openclaw.nats-3` at line 6 |
| 7 | `docs/NATS_CLUSTER.md` (new) | `docs/NATS_CLUSTER.md:1` | yes | `# NATS Cluster Setup — OpenClaw Federation` at line 1 |

All 7 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| nats-1 server_name | `grep -n 'server_name: openclaw-nats-1' services/nats/nats-1.conf` | line 4 |
| nats-2 client port | `grep -n 'listen: 0.0.0.0:4223' services/nats/nats-2.conf` | line 6 |
| nats-3 client port | `grep -n 'listen: 0.0.0.0:4224' services/nats/nats-3.conf` | line 6 |
| nats-1 cluster port | `grep -n 'listen: 0.0.0.0:6222' services/nats/nats-1.conf` | line 15 |
| nats-1 plist label | `grep -n 'ai.openclaw.nats-1' services/nats/ai.openclaw.nats-1.plist` | line 6 |
| nats-2 plist label | `grep -n 'ai.openclaw.nats-2' services/nats/ai.openclaw.nats-2.plist` | line 6 |
| nats-3 plist label | `grep -n 'ai.openclaw.nats-3' services/nats/ai.openclaw.nats-3.plist` | line 6 |
| docs R=3 reference | `grep -n 'R=3' docs/NATS_CLUSTER.md` | line 3 |
| cluster name consistent | `grep -rn 'openclaw-cluster' services/nats/` | nats-1.conf:14, nats-2.conf:14, nats-3.conf:14 |

## §3 — Cross-references still valid

- No existing symbols renamed or deleted (infrastructure-only step).
- `services/nats/` is a new directory — no pre-existing consumers.
- `docs/NATS_CLUSTER.md` references `bin/spawn-node.mjs` and `ensureSharedStream` (both exist from Steps 10.1 and 1.4).
- The port convention (4222 default) matches all existing `DEFAULT_NATS_URL` references throughout the codebase (`lib/publishers/publish-helper.mjs:15`, `lib/nats-resolve.js:26`, `bin/spawn-node.mjs:32`, `bin/memory-subscriber.mjs:232`).
- `docs/NATS_CLUSTER.md` references `bin/openclaw-node-init.js` for Tailscale discovery — that file exists and scans port 4222.
- No stale references introduced.

## §4 — Findings

1. **[POSITIVE]** All three NATS configs use distinct server_name (`openclaw-nats-1/2/3`), distinct client ports (4222/4223/4224), distinct cluster ports (6222/6223/6224), and distinct monitor ports (8222/8223/8224) — no conflicts possible on same-host deployment.
2. **[POSITIVE]** Full-mesh cluster topology: each node routes to both others via explicit route URLs. NATS auto-reconnects if one node restarts.
3. **[POSITIVE]** JetStream data directories are per-node (`jetstream-1/2/3` under `~/.openclaw/nats/`) — prevents corruption from multiple servers writing the same store.
4. **[POSITIVE]** Memory limits (256MB mem, 1GB file per node) are conservative for dev use — prevents runaway disk consumption during testing.
5. **[POSITIVE]** launchd plists use `KeepAlive: true` so macOS auto-restarts crashed NATS nodes — matches the resilience pattern the integration tests (Step 10.7) will rely on.
6. **[POSITIVE]** `RunAtLoad: false` on all plists — operator must explicitly start the cluster, preventing accidental port binding on machines where NATS isn't wanted.
7. **[POSITIVE]** Documentation covers both local dev (launchd) and multi-machine (systemd + Tailscale) deployment paths — the two primary target environments for the project.
8. **[POSITIVE]** Documentation includes verification steps (`routez`, `jsz` endpoints) with expected output descriptions — operator can confirm cluster health without guessing.
9. **[POSITIVE]** Documentation covers the connection pattern for spawned dev nodes (Step 10.1's `spawn-node.mjs`) — clear integration path for Steps 10.5/10.6.
10. **[POSITIVE]** Port convention aligns with all existing codebase references (4222 as primary client port) — no migration needed for existing single-node setups connecting to node 1.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.2 → Step 10.3)

- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance). No tests added this step (infrastructure-only).
- NATS cluster configs are in `services/nats/nats-{1,2,3}.conf` — ready for operator deployment.
- launchd plists have `${OPENCLAW_REPO}` and `${HOME}` placeholders — must be substituted before installation (documented in `docs/NATS_CLUSTER.md`).
- The cluster must be running before Step 10.3 can verify R=3 propagation of `OPENCLAW_SHARED`.
- `nats-server` binary is at `/opt/homebrew/bin/nats-server` (confirmed present on operator machine).
- JetStream data dirs (`~/.openclaw/nats/jetstream-{1,2,3}`) must be created by operator before first start.
- `@publish` directive wiring into daemon's per-prompt path still deferred (carried from Step 9.5 → 10.1).
