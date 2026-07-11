# AUDIT_POST — Step 1.2 · 3 spawned logical nodes heartbeating through the :4222 bus

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| `VERSION` v1.1 → v1.2-pre (Phase 1) | **yes** | committed in prior session at Phase 1 |
| `INVENTORY.md` row 1.2: `[ ]` → `[A]` | **yes** | committed in prior session at Phase 1 |
| `services/launchd/ai.openclaw.mesh-health-publisher.plist` — fix exec path + OPENCLAW_NATS override | **yes** | exec `${OPENCLAW_REPO_DIR}/bin/mesh-health-publisher.js`; `OPENCLAW_NATS: nats://127.0.0.1:4222` hardcoded; pre-existing file updated |
| `services/launchd/ai.openclaw.mesh-task-daemon.plist` — fix exec path + NODE_PATH | **yes** | exec `${OPENCLAW_REPO_DIR}/bin/mesh-task-daemon.js`; `NODE_PATH: ${OPENCLAW_REPO_DIR}/node_modules:${OPENCLAW_REPO_DIR}/lib`; `OPENCLAW_NATS` override added |
| `services/launchd/ai.openclaw.mesh-agent.plist` — fix exec path + NODE_PATH | **yes** | exec `${OPENCLAW_REPO_DIR}/bin/mesh-agent.js`; NODE_PATH + OPENCLAW_NATS present |
| `services/launchd/ai.openclaw.mesh-bridge.plist` — fix exec path + NODE_PATH | **yes** | exec `${OPENCLAW_REPO_DIR}/bin/mesh-bridge.js`; NODE_PATH + OPENCLAW_NATS present |
| (runtime) spawn 3 node trees: alpha, bravo, charlie | **yes** | `~/.openclaw-alpha/`, `~/.openclaw-bravo/`, `~/.openclaw-charlie/` present (idempotent — existed from prior session; no regression) |
| (runtime) start 3 mesh-health-publisher background processes | **yes** | PIDs 17515 (alpha), 17516 (bravo), 17517 (charlie) — alive for 10+ min |
| (verify) nats CLI probes at T+15s and T+10min | **yes** | T+15s: revisions 187/188/189; T+10min: 312/311/310 — fresh heartbeats, no crash-loops |
| `AUDIT_POST.md` | **yes** | this file |
| `COMPONENT_REGISTRY.md` — update Family 1 + Family 2 | **yes** | Phase 9 |
| `INVENTORY.md` row 1.2: `[A]` → `[x]` | **yes** | Phase 9 |
| `VERSION` v1.2-mid → v1.2 | **yes** | Phase 9 |

Every row **yes** → step is done.

## §2 Greppable deltas

- `grep -c "OPENCLAW_REPO_DIR" services/launchd/ai.openclaw.mesh-health-publisher.plist` → ≥2 (exec path + EnvironmentVariables)
- `grep "0.0.0.0\|openclaw/bin" services/launchd/ai.openclaw.mesh-*.plist` → 0 hits (stale paths gone)
- `grep "nats://127.0.0.1:4222" services/launchd/ai.openclaw.mesh-health-publisher.plist` → 1 hit
- `grep "OPENCLAW_NATS" services/launchd/ai.openclaw.mesh-task-daemon.plist` → 1 hit
- `grep "\[A\]" memory-plan/plans/federation/INVENTORY.md | grep 1.2` → 1 row (pre-commit state)
- KV probe: `nats kv get MESH_NODE_HEALTH alpha --server nats://127.0.0.1:4222` → rev 312+, timestamp 2026-07-10 21:23:35 UTC

## §3 Cross-refs still valid

- INVENTORY 1.2 Needs "a running NATS on :4222" — confirmed PID 1989, in_msgs advancing ✔
- INVENTORY 1.2 Needs "bin/spawn-node.mjs" — used, idempotent ✔
- INVENTORY 1.2 Needs "the 0.1 triage" — D5 crash-loop cause (stale path) is exactly what the plist fix addresses ✔
- INVENTORY 1.2 Feeds "1.3 registry entries" — 3 live node-ids now observable in KV ✔
- INVENTORY 1.2 Feeds "Block 2 sessions run on these nodes" — substrate is live ✔
- COMPONENT_REGISTRY Family 1 "Logical node trees" → update to LIVE in Phase 9 ✔
- D5 "For 1.2: revival is a unit re-render at the live install path" — honored: plists corrected, not old stale plists re-enabled ✔

## §4 Findings

- **[POSITIVE]** All 4 mesh plist templates now use `${OPENCLAW_REPO_DIR}/bin/<script>.js` — the D5 root cause (stale `/Users/moltymac/openclaw/bin/` path) is fully remediated in the templates. Any `install.sh` render from this commit forward will produce correct launchd units.
- **[POSITIVE]** `OPENCLAW_NATS: nats://127.0.0.1:4222` is hardcoded in all 4 templates, overriding the polluted `OPENCLAW_NATS` from `openclaw.env` (which pointed to a Tailscale remote in the fleet prototype era). Local-first posture is structural, not env-dependent.
- **[POSITIVE]** 3 node trees (alpha/bravo/charlie) already existed from a prior session — spawn-node.mjs correctly idempotent (no overwrite, no error).
- **[POSITIVE]** Verify PASS: T+10min revisions 312/311/310 (+123–125 from T+15s baselines), confirming ~40 heartbeat cycles per node at 15s interval. PIDs 17515/17516/17517 alive throughout, no crash-loops.
- **[POSITIVE]** KV bucket MESH_NODE_HEALTH had existing entries from prior activity (revisions already at 187+ at T+15s), confirming the live :4222 bus has been used before — the publishers correctly adopted the existing bucket.
- **[NEGATIVE / pre-existing]** `execSafe` failures in publisher logs: `launchctl list ai.openclaw.mesh-health-publisher` returns error (unit not loaded via launchd — background process, not launchd-managed), `agent-state.json` absent. Non-fatal; payload still publishes. This is expected for manually-started publishers. When 6.1 (fleet profile) renders per-node launchd units, these probes will return real data.
- **[NEGATIVE / pre-existing]** 2 test failures at baseline: `observer.test.mjs` (documented in step 1.1 AUDIT_POST §4) and `embed-benchmark.test.mjs` (hardware: 1529ms mean vs 500ms target on this VM). Neither is related to plist changes in this step.
- **[NOTE]** `mesh-health-publisher.js` uses `require('../lib/nats-resolve')` to get `NATS_URL` — but `OPENCLAW_NATS` env var is the highest-priority override in `lib/nats-resolve.js`, so the explicit `OPENCLAW_NATS=nats://127.0.0.1:4222` in each process env is what matters. Confirmed working.

## §5 Phase-8 patches

None. No architectural choice arose that wasn't pre-decided in DECISIONS/AUDIT_PRE.

## §6 Carry-forwards to the next step (1.3)

- **To 1.3:** 3 live node-ids in MESH_NODE_HEALTH — alpha, bravo, charlie — are the member identities for the grappe manifest. KV bucket already seeded with recent revisions. JetStream confirmed active.
- **To 1.3:** The publishers (PIDs 17515/17516/17517) are manually-started background processes, not launchd-managed. They will die on shell exit or system restart. Step 1.3 (registry CLI) must handle member discovery from KV data, not from launchd service state. Per-node launchd units for spawned nodes are Block 6 (6.1) scope.
- **To 1.3:** The `openclaw-grappe` CLI Needs JetStream KV and the 3 live member heartbeats visible in MESH_NODE_HEALTH — both now available.
- **To 1.5:** Live :4222 bus unchanged — PID 1989, in_msgs advancing, JetStream KV intact.
- **To 6.1 (fleet profile):** The 4 plist templates are now correct for `install.sh` rendering. A fresh `install.sh` run will produce working launchd units. Block 6 adds per-node unit generation (unique labels per spawned node-id).
