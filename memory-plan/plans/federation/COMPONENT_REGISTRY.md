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
| **Status** | LIVE (single node — NOT the R=3 cluster this plan needs) |
| **Verified** | 2026-07-06 — lsof :4222 LISTEN (pid 696); :8222/varz → server_name=openclaw-local, cluster: NONE. docs/NATS_CLUSTER.md documents the 3-node local-dev cluster (4222-4224/6222-6224/8222-8224) — documented only, never stood up (step 1.1). |

### Logical node trees — bin/spawn-node.mjs

| | |
|---|---|
| **Status** | UNBUILT (tool exists, no trees spawned) |
| **Verified** | 2026-07-06 — `ls ~/.openclaw-*` → none. spawn-node.mjs present (isolated tree per node: own state.db, config, workspace, vault, logs; no containers). |

### Membership & signing — bin/mesh-join-token.js, lib/deploy-trigger-auth.mjs

| | |
|---|---|
| **Status** | DEGRADED (code + 15/15 auth tests exist; signing opt-in, keys not provisioned, no grappe concept) |
| **Verified** | 2026-07-06 — deploy-trigger-auth verified via its test suite in the 2026-07-03g batch (signed→verified, forged→rejected observed then); OPENCLAW_REQUIRE_SIGNED_DEPLOY unset on this node. |

## Family 2: worker-grappe machinery (the paper's stack)

### Circling implementation — lib/mesh-collab.js · lib/circling-parser.js · bin/mesh-task-daemon.js · bin/mesh-agent.js · bin/mesh-bridge.js

| | |
|---|---|
| **Status** | DORMANT — code believed-good, stranded behind **stale-path unit files** (crash-loop root cause diagnosed 2026-07-09, step 0.1 / D5) |
| **Verified** | 2026-07-09 (step 0.1) — the 6 mesh units + 3 aux + system `com.openclaw.agent` all crash-looped on **one root cause**: plists exec `/Users/moltymac/openclaw/…` (ABSENT — renamed to `~/.openclaw/workspace/` + repo). Disable-time evidence: `Cannot find module '…/openclaw/bin/<script>.js'`, `requireStack:[]` (entry missing); `mesh-task-daemon.err` = **269,948** MODULE_NOT_FOUND records, 72–263 MB per file, frozen Jul 3 17:35. Class-C stale-config; **code health unobservable** (entry never loaded). Revival (1.2) = re-render at live install path, NOT re-enable the stale plist; NATS reachable (1.1) first (class-A breadcrumb in the err heads). Test baseline 2026-07-06: 44/44 (collab-circling+daemon). Paper: docs/circling-strategy-implementationV3.md (gaps §14.1/.2/.3 open). |

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
