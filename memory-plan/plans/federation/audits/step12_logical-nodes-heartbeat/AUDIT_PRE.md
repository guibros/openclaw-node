# AUDIT_PRE — Step 1.2 · 3 spawned logical nodes heartbeating through the :4222 bus

## §0 Micro Re-Orient (≤6 lines)

Block 1 (Substrate), step 1.2. Step 1.1 closed: NATS cluster configs hardened + scratch R=3 proven, live :4222 untouched.
This step contributes: the first live observable grappe substrate — 3 spawned node trees each with a running health-publisher.
North-star line: ROADMAP Block 1 exit criterion, Feeds block 1.3 (registry entries) and Block 2 (sessions run on these nodes).
Still the right next step? **YES.** Pre-screen finding: D5 said "install.sh already deploys correctly" — FALSE. All 4 mesh plist templates carry `${HOME}/openclaw/bin/` (stale path that caused the crash-loops). Fixing them is this step's implementation (one outcome: heartbeats; plist fix is the enabling code change).

## §1 Intent

Spawn 3 isolated logical node trees (alpha, bravo, charlie) and run mesh-health-publisher for each, producing 3 distinct node-id entries in the MESH_NODE_HEALTH JetStream KV bucket with heartbeats < 60s old, stable for 10+ minutes.

The "mesh daemons revived per the 0.1 triage" language in the INVENTORY means: fix the plist templates so that install.sh renders working units (the stale `${HOME}/openclaw/bin/` paths → `${OPENCLAW_REPO_DIR}/bin/`), then start the publishers. For this step, we start them as direct background processes (one per logical node); launchd units for the spawned nodes are Block 6 (6.1 fleet profile).

## §2 Design (consuming AUDIT_POST 1.1 carry-forwards)

**Carry-forward from step 1.1:**
- D5 + COMPONENT_REGISTRY confirmed four in-scope mesh units have stale-path plists AND a class-A NATS breadcrumb from before the rename.
- When revived at the correct path, NATS reachability at :4222 is the first thing to verify before declaring the daemon healthy.
- Do NOT enable old disabled plists — re-render from `services/launchd/` templates.

**Finding at Phase 1 (deviates from carry-forward):** The `services/launchd/` templates themselves still use `${HOME}/openclaw/bin/` — so re-rendering them without fixing the templates would reproduce the exact same stale path. D5's claim "install.sh already deploys correctly per the recent fresh-node commits" was inaccurate for the mesh unit templates. The NATS conf templates (nats-1.conf etc.) that step 1.1 touched are correct; the mesh unit templates were never updated.

**Fix for all 4 mesh plist templates (mesh-health-publisher, mesh-task-daemon, mesh-agent, mesh-bridge):**
- `${HOME}/openclaw/bin/<script>.js` → `${OPENCLAW_REPO_DIR}/bin/<script>.js`
- `NODE_PATH: ${HOME}/openclaw/node_modules:${HOME}/openclaw/lib` → `${OPENCLAW_REPO_DIR}/node_modules:${OPENCLAW_REPO_DIR}/lib`
- NATS URL: hardcode `nats://127.0.0.1:4222` in EnvironmentVariables (local-first, matching memory-daemon pattern); `${OPENCLAW_NATS}` template substitution is polluted by the Tailscale remote mesh IP in openclaw.env

**Spawning logical nodes:** `node bin/spawn-node.mjs --id alpha`, `--id bravo`, `--id charlie`. Each creates `~/.openclaw-alpha/` etc. with config/node.json + state.db + subdirs.

**Starting publishers:** direct background processes per node, NOT launchd units (which would need unique labels per node — that's Block 6 infrastructure):
```
nohup env OPENCLAW_NODE_ID=alpha OPENCLAW_NATS=nats://127.0.0.1:4222 \
  node /Users/moltymac/openclaw-nodedev/bin/mesh-health-publisher.js \
  >> ~/.openclaw-alpha/logs/health-publisher.log 2>&1 &
```
PIDs captured for the ps-stable check.

**Verify path:** NATS :4222 has no auth (confirmed from nats.conf — no `authorization` block). nats CLI at `/opt/homebrew/bin/nats` version 0.3.1 is available for KV inspection.

## §3 Risk register

| Risk | Mitigation |
|---|---|
| NATS connection fails (OPENCLAW_NATS override not effective) | Pass `OPENCLAW_NATS=nats://127.0.0.1:4222` as env var (highest priority in nats-resolve.js) |
| mesh-health-publisher requires modules not in repo node_modules | `nats` confirmed present in `node_modules/`; `lib/tracer`, `lib/mesh-roles`, `lib/nats-resolve` are in `lib/` |
| Background processes die on shell exit | nohup + redirect logs; PIDs verified in ps after 10+ min |
| MESH_NODE_HEALTH KV bucket creation fails (JetStream API) | JetStream confirmed enabled (varz shows 2696 API calls, 0 critical errors) |
| NODE_PATH fix unnecessary (Node.js resolves by directory walk) | Correct regardless; fix is safe even if redundant |
| The 4 plist template fix introduces new bugs | Only path/env substitutions; no logic changes |

## §4 Pre-screen of Needs (PROTOCOL §11)

- ✓ **NATS on :4222** — PID 1989, in_msgs=12807, JetStream enabled, no token auth, single-node (loopback-only, nats.conf confirmed)
- ✓ **bin/spawn-node.mjs** — present, verified `ls` output
- ✓ **0.1 triage** — D5 logged, all 11 units class-C stale-path, four in-scope mesh units' revive-precondition = re-render at live install path
- ✓ **bin/mesh-agent.js** — present (verified)
- ✓ **bin/mesh-health-publisher.js** — present (verified); requires `nats`, `lib/tracer`, `lib/nats-resolve`, `lib/mesh-roles` — all in repo
- ✓ **NATS CLI** — `/opt/homebrew/bin/nats` v0.3.1 for KV inspection at verify time
- ✓ **OPENCLAW_NATS_TOKEN not required** — live :4222 server has no `authorization` block; nats-resolve.js will return null token (correct)

All Needs present. Proceeding.

## §6 File-delta outline

1. `memory-plan/plans/federation/SCOPE.md` — active with step-1.2 files block [DONE]
2. `memory-plan/plans/federation/audits/step12_logical-nodes-heartbeat/AUDIT_PRE.md` — this file [DONE]
3. `memory-plan/plans/federation/VERSION` — v1.1 → v1.2-pre
4. `memory-plan/plans/federation/INVENTORY.md` — row 1.2: `[ ]` → `[A]`
5. `services/launchd/ai.openclaw.mesh-health-publisher.plist` — fix exec path + EnvironmentVariables
6. `services/launchd/ai.openclaw.mesh-task-daemon.plist` — fix exec path + NODE_PATH
7. `services/launchd/ai.openclaw.mesh-agent.plist` — fix exec path + NODE_PATH
8. `services/launchd/ai.openclaw.mesh-bridge.plist` — fix exec path + NODE_PATH
9. (runtime, not git) — `node bin/spawn-node.mjs --id alpha/bravo/charlie`
10. (runtime, not git) — start 3 mesh-health-publisher background processes
11. (verify) — nats CLI probes MESH_NODE_HEALTH KV at T+15s and T+10min
12. `memory-plan/plans/federation/audits/step12_logical-nodes-heartbeat/AUDIT_POST.md` — Phase 7
13. `memory-plan/plans/federation/COMPONENT_REGISTRY.md` — update Family 1 + Family 2
14. `memory-plan/plans/federation/INVENTORY.md` — row 1.2: `[A]` → `[x]`
15. `memory-plan/plans/federation/VERSION` — v1.2-mid → v1.2
