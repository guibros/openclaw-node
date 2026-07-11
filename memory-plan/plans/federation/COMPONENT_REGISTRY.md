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

### NATS — :4222, ai.openclaw.nats

| | |
|---|---|
| **Status** | LIVE (single node — NOT the R=3 cluster this plan needs; cluster configs hardened + manifest/install wired by step 1.1; cutover gated at step 1.5) |
| **Verified** | 2026-07-10 — curl :8222/varz → server_name=openclaw-local, pid=1989, port=4222, cluster=NONE, in_msgs≈12716; config at `~/.openclaw/nats/nats.conf` (separate from repo cluster templates). Scratch proof 2026-07-10: R=3 cluster on ports 4322-4324 formed, token-auth enforced, quorum 2/3 survived node kill, live :4222 undisturbed. Hardened templates in services/nats/nats-{1,2,3}.conf; plists in services/launchd/ai.openclaw.nats-{1,2,3}.plist; rendered to ~/.openclaw/config/ by install.sh. |

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
