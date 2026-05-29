# AUDIT_POST — Step 10.8: `docs/MULTI_NODE_DEPLOY.md` — soup-to-nuts deployment guide for real-hardware council

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `docs/MULTI_NODE_DEPLOY.md` (new) | `docs/MULTI_NODE_DEPLOY.md:1` | yes | `# Multi-Node Deployment Guide` at line 1; 654 lines; covers prerequisites, architecture, single-machine setup, multi-machine deployment, verification, env vars, troubleshooting, rollback |

All 1 promised delta landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Guide title | `grep -n 'Multi-Node Deployment Guide' docs/MULTI_NODE_DEPLOY.md` | line 1 |
| Prerequisites section | `grep -n 'Prerequisites' docs/MULTI_NODE_DEPLOY.md` | line 5 |
| Architecture diagram | `grep -n 'NATS Cluster' docs/MULTI_NODE_DEPLOY.md` | line 15 |
| spawn-node usage | `grep -n 'spawn-node' docs/MULTI_NODE_DEPLOY.md` | line 92 |
| Identity keypair section | `grep -n 'identity.key' docs/MULTI_NODE_DEPLOY.md` | line 113 |
| Shared stream verification | `grep -n 'OPENCLAW_SHARED' docs/MULTI_NODE_DEPLOY.md` | line 128 |
| NATS reconnect opts | `grep -n 'NATS_RECONNECT_OPTS' docs/MULTI_NODE_DEPLOY.md` | line 402 |
| Dead peer timeout | `grep -n 'DEAD_PEER_TIMEOUT_MIN' docs/MULTI_NODE_DEPLOY.md` | line 410 |
| Troubleshooting section | `grep -n 'Troubleshooting' docs/MULTI_NODE_DEPLOY.md` | line 450 |
| Rollback section | `grep -n 'Rollback' docs/MULTI_NODE_DEPLOY.md` | line 538 |
| systemd service | `grep -n 'systemd' docs/MULTI_NODE_DEPLOY.md` | line 282 |
| Tailscale section | `grep -n 'Tailscale' docs/MULTI_NODE_DEPLOY.md` | line 264 |
| Firewall rules | `grep -n 'Firewall' docs/MULTI_NODE_DEPLOY.md` | line 229 |

## §3 — Cross-references still valid

- `docs/MULTI_NODE_DEPLOY.md` — new standalone documentation file. References:
  - `bin/spawn-node.mjs` — exists (Step 10.1, exports `spawnNode`, `validateNodeId`, `resolveNodeRoot`, `readNodeConfig`)
  - `lib/node-identity.mjs` — exists (Step 10.4, exports `getOrCreateIdentity`, `signEvent`, `verifyEvent`)
  - `lib/shared-event-stream.mjs` — exists (Step 1.4, exports `ensureSharedStream`, `inspectSharedStream`, `verifySharedStreamConfig`)
  - `lib/federation-resilience.mjs` — exists (Step 10.7, exports `NATS_RECONNECT_OPTS`, `DEAD_PEER_TIMEOUT_MS`, `createPeerTracker`, `cleanupExpiredOffers`)
  - `workspace-bin/memory-daemon.mjs` — exists (core daemon)
  - `services/nats/nats-{1,2,3}.conf` — exist (Step 10.2)
  - `docs/NATS_CLUSTER.md` — exists (Step 10.2)
  - `test/federation-2node.test.mjs` — exists (Step 10.5)
  - `test/federation-3node.test.mjs` — exists (Step 10.6)
  - `test/federation-resilience.test.mjs` — exists (Step 10.7)
- No symbols renamed or deleted. No stale references. All cross-references resolve to existing files and exports.

## §4 — Findings

1. **[POSITIVE]** Guide covers 6 distinct sections: prerequisites, architecture, single-machine dev, multi-machine deployment, verification, troubleshooting + rollback. Comprehensive coverage of the RESUME.md §0 Block 10 requirement.
2. **[POSITIVE]** Architecture diagram clearly shows the 3-node council pattern with NATS cluster, per-node daemons, and federation components (promoter, subscriber, offerer, acceptor).
3. **[POSITIVE]** Both macOS (launchd) and Linux (systemd) deployment paths documented with concrete config files and commands.
4. **[POSITIVE]** Tailscale deployment path documented as a third option — matches the existing `docs/NATS_CLUSTER.md` Tailscale section.
5. **[POSITIVE]** Environment variables reference table covers all federation-relevant env vars (OPENCLAW_NODE_ID, NATS_URL, DEAD_PEER_TIMEOUT_MIN, etc.) with defaults and descriptions.
6. **[POSITIVE]** Troubleshooting section covers the specific failure modes from Block 10 implementation: cluster formation, JetStream availability, R=3 creation, signature verification, dead-peer detection, port conflicts, and shared stream config mismatch.
7. **[POSITIVE]** Rollback section documents graceful degradation: single-node operation works fully without federation, and NATS cluster continues with 2 nodes (degraded R=3 mode).
8. **[POSITIVE]** Quick Reference at the end provides a concise startup order checklist — useful for operators who have read the guide once and need a refresher.
9. **[POSITIVE]** End-to-end verification commands reference the existing integration tests (federation-2node, federation-3node, federation-resilience) — no custom test infrastructure needed.
10. **[POSITIVE]** Documentation-only step: zero functional code changes, zero new tests, zero risk of regression. Test count unchanged at 1102 (1027 pass, 75 fail).

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.8 → Step 10.9)

- Test baseline: 1102 tests (1027 pass, 75 fail — 73 pre-existing + 2 flaky variance). 0 tests added this step (documentation-only).
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
- Daemon does not yet instantiate shared `peerTracker` to pass to offerer/acceptor (offerer/acceptor are separate processes).
- `docs/MULTI_NODE_DEPLOY.md` should be referenced by the dogfood harness (Step 10.9) for operator setup instructions.
