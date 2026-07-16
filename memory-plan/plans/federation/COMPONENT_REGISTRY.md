# COMPONENT_REGISTRY — federation plan

Current state of every component this plan touches. **Reality, not aspiration** — probed
2026-07-06. Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe before acting.

## Family 0: specification artifacts

### Federation contract — docs/FEDERATION_SPEC.md

| | |
|---|---|
| **Status** | LIVE (documentation only, no runtime component) |
| **Verified** | 2026-07-10 — `ls docs/FEDERATION_SPEC.md` → present; grep confirms 3 mode flows, 3 envelope schemas, 23 file:line cross-refs. Produced by step 0.2. |

## Family 1: substrate (NATS, nodes, identity)

### NATS — :4222, ai.openclaw.nats-{1,2,3}

| | |
|---|---|
| **Status** | LIVE as a real 3-node `openclaw-cluster` **on ONE machine** (nats-1/2/3, client 4222/4223/4224, monitor 8222/8224/8223) since **2026-07-14 19:41 EDT** — an undocumented manual cutover, retro-ledgered in **D12**. Mesh KV buckets migrated R=1→R=3 on 07-15 (also retro-ledgered). ⚠️ **This is NOT failsafe**: three procs on one box die together. Step **1.5 stays `[D]`** — machine-loss failover is unproven and needs real separate hardware. The old single-node unit `ai.openclaw.nats` is still loaded and **dead (exit 1)**. |
| **Verified** | **2026-07-16 11:21–11:35Z** — `:8222/jsz` → `meta_cluster {cluster_size:3, leader:openclaw-nats-3}`; `varz` → `cluster.name=openclaw-cluster`, `cluster.urls=[127.0.0.1:6223, 127.0.0.1:6224]`, `connect_urls=[4222,4223,4224]` (**includes self** — the fact that broke the old quorum probe). 3 `nats-server` procs live. **Quorum-loss detection proven by induced outage**: unloaded nats-2+nats-3 → raft stepped down at ~24s → node-watch `BROKEN — quorum LOST — no raft leader elected`; `node-acceptance --axis federation` → `GATE: REJECTED`; both units reloaded → 3/3, `WORKING — raft leader openclaw-nats-3`. All 5 mesh KV buckets R=3, 2/2 healthy followers. Detection latency ~24s (raft election timeout) — honest characteristic. Hardened templates in services/nats/nats-{1,2,3}.conf (loopback dev sim); the multi-MACHINE template `nats-cluster-node.conf` exists but is **deployed nowhere** and regresses D2/D4 (binds 0.0.0.0, unauthenticated cluster port — see D12 §3, must be fixed before a second machine joins). |

### NATS cluster configs — services/nats/nats-{1,2,3}.conf

| | |
|---|---|
| **Status** | HARDENED (step 1.1) — loopback-bind + `authorization { token: "${OPENCLAW_NATS_TOKEN}" }` in all three; install.sh generates token if absent; templates rendered to `~/.openclaw/config/` at install time. Cutover to real ports is step 1.5 (operator-gated). |
| **Verified** | 2026-07-10 — no 0.0.0.0 in any conf (grep clean); authorization block + token template in all three; 3 entries in service-manifest.json (role=both, autostart=false); 3 plist templates in services/launchd/ (correct ${HOME} path, rendered conf path). |

### Logical node trees — bin/spawn-node.mjs

| | |
|---|---|
| **Status** | LIVE (3 trees: alpha/bravo/charlie; 3 health-publishers running) |
| **Verified** | 2026-07-10 — `~/.openclaw-{alpha,bravo,charlie}/` present with config/node.json + state.db; PIDs 17515/17516/17517 (mesh-health-publisher.js per node); MESH_NODE_HEALTH KV revisions 312/311/310 at T+10min (2026-07-10 21:23:35 UTC). Publishers are manually-started background processes (not launchd); per-node launchd units are Block 6 (6.1) scope. |

### Grappe registry + CLI — bin/openclaw-grappe.mjs, GRAPPE_REGISTRY KV bucket

| | |
|---|---|
| **Status** | LIVE (steps 1.3 + 1.4) — form/status/dissolve/issue-token/join all working; join_token_hash non-null; valid join accepted; forged join rejected. |
| **Verified** | 2026-07-11 (step 1.4) — `nats kv get GRAPPE_REGISTRY grappe.wg-alpha --raw` → `{"id":"wg-alpha","mode":"adversarial","members":["alpha","bravo","charlie","delta"],"formed_at":"2026-07-11T01:41:53.440Z","status":"live","join_token_hash":"7d562ce0de7e2472e22518dffc25ac57093d972ae775c48bd790ace82afd60ca"}`. Valid join (delta): accepted, in members. Forged join (epsilon): `[grappe-auth] join rejected: invalid-token`, exit 1, not in members. |

### Membership & signing — bin/mesh-join-token.js, lib/deploy-trigger-auth.mjs, bin/openclaw-grappe.mjs (join/issue-token)

| | |
|---|---|
| **Status** | LIVE (step 1.4) — grappe join tokens operational: issue-token provisions SHA-256 hash in KV manifest; join verifies and accepts/rejects with logged reason. deploy-trigger-auth pattern (issue → hash → verify on presentation) adopted. |
| **Verified** | 2026-07-11 — `openclaw-grappe issue-token --id wg-alpha` → token issued, join_token_hash written to GRAPPE_REGISTRY; `openclaw-grappe join ... --token <valid>` → join accepted; `... --token forged` → `[grappe-auth] join rejected: invalid-token` exit 1. OPENCLAW_REQUIRE_SIGNED_DEPLOY remains unset (deploy signing is a separate layer). |

## Family 2: worker-grappe machinery (the paper's stack)

### Circling implementation — lib/mesh-collab.js · lib/circling-parser.js · bin/mesh-task-daemon.js · bin/mesh-agent.js · bin/mesh-bridge.js

| | |
|---|---|
| **Status** | LIVE (steps 2.1 + 2.2 + 2.3) — full circling lifecycle observed end-to-end (2.1); adaptive convergence early-exit proven (2.2); parse-failure retry ×3 before degradation live (2.3). Paper gaps §14.1 + §14.2 closed. Paper gap §14.3 [D]. |
| **Verified** | 2026-07-11 (step 2.3) — parse-failure retry: session collab-task-retry-test-rt-001-1783750452601 in real JetStream KV: worker_parse_failures=2, failure_count_at_step1=2, degraded=false, worker_artifact_present=true, barrier_advanced=true. 5/5 new tests pass (4 unit + 1 NATS integration). Test baseline: 1729 pass / 2 fail / 1 skipped. |

### Task kanban + plans layer — mesh.tasks.* / mesh.plans.* subjects

| | |
|---|---|
| **Status** | DORMANT (full lifecycle subjects implemented in mesh-task-daemon; daemon not running) |
| **Verified** | 2026-07-06 — grep: mesh.tasks.{claim,complete,fail,heartbeat,attempt,approve,reject,cancel,get,list}, mesh.plans.{create,approve,abort,get,list,subtask.update}, mesh.collab.{create,join,leave,reflect,recruiting,gate.approve,gate.reject,find,status} all present in bin/mesh-task-daemon.js. |

## Family 3: memory-federation heritage (deferred context)

### Broadcast libs — lib/broadcast-{emitter,offerer,acceptor}.mjs, lib/node-identity.mjs

| | |
|---|---|
| **Status** | DORMANT (unit-proven, wired nowhere at runtime; content scope stays deferred — this plan's 7.3 [D]) |
| **Verified** | 2026-07-06 — `node --test test/federation-2node.test.mjs` → 11/11 pass, 0 skipped (nats-server binary present on this host; suites spin ephemeral servers). Redesign plan steps 7.1–7.4 are [D]; 7.1 (cluster) absorbed by this plan's 1.1 (D1). |

## Family 4: surfaces this plan will extend

### Observability & control — node-watch, openclaw-notify, Mission Control, openclaw-stack

| | |
|---|---|
| **Status** | LIVE (single-node scope; no federation awareness yet — Block 6 extends) |
| **Verified** | 2026-07-06 — prior-session evidence ≤48h old: node-watch continuous unit live w/ transition notifications observed; notification ledger + MC /notifications 200; openclaw-stack `up` observed 12/12; MC on 127.0.0.1:3000. No fed.* probes, no federation MC page, no grappe/management/savant notify sources yet. |

## Family 5: install path (deployability — D9)

### install.sh + service-manifest + unit templates + NODE_SPEC/INSTALL_TEST_PROTOCOL

| | |
|---|---|
| **Status** | OVERHAULED + SANDBOX-VERIFIED (D9, 2026-07-11) — NOT fresh-machine-verified: the T7 clean-machine gate (6.1) is still open |
| **Verified** | 2026-07-11 — full `install.sh --sandbox` run against a scratch root: 19 units rendered, 0 unrendered placeholders (new in-install render audit), all plists lint-valid; memory-daemon BOOTS on the deployed tree (5 import kills closed — mcp-knowledge, graph-cache, nats, zod, event-schemas; the last two caught only by the live boot test) with-bus and bus-down; single-node NATS from the rendered conf: JetStream on, token enforced both directions (`Authorization Violation` on wrong token); ed25519 identity provisioned; env carries the full §3 parameter set. Evidence: `audits/deployability_overhaul/AUDIT.md`. |

### Single-node bus — services/nats/nats-single.conf + ai.openclaw.nats.{plist,service}

| | |
|---|---|
| **Status** | TEMPLATE VERIFIED (scratch runtime proof); autostart:true in the manifest — the default bus a fresh node runs; live dev :4222 still the hand-built pre-existing unit (unchanged) |
| **Verified** | 2026-07-11 — rendered conf started on scratch ports: nats-server v2.12.6, server_name carries the node id, jetstream=true, token accept/reject both observed. |
