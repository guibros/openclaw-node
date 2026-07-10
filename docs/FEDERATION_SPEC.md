# FEDERATION_SPEC — OpenClaw Node Federation

**Status:** v0.2 (initial, 2026-07-10). This is the living contract for the federation system.
Implementation-discovered divergences go into DECISIONS.md (append-only), not into silent
rewrites of this spec.

**Read alongside:** docs/circling-strategy-implementationV3.md (the paper — adversarial mode's
complete reference), ROADMAP.md (block intent and constraints), DECISIONS.md (locked choices).

---

## 1. Overview

The federation system organises nodes into **grappes** — bundles that execute tasks through a
shared protocol — and layers those grappes into three tiers:

```
                ┌─────────────────────────────────────────┐
  L3  SAVANT    │ savant grappe (3, adversarial)           │  observes everything
                │ work product: CHANGE-SETS                │  emits gated proposals
                └──────────────┬──────────────────────────┘
                               │ operator-gated change-sets
                               ▼
                ┌─────────────────────────────────────────┐
  L2  MGMT      │ management grappe (5): intake →          │  complex task in
                │ decompose (3/5 quorum) → dispatch →      │  decomposed + dispatched
                │ assemble → verify (3/5 quorum) → deliver │  to worker grappes
                └──────┬───────────┬───────────┬──────────┘
                       │           │           │  signed task envelopes ↓
                       ▼           ▼           ▼  result envelopes ↑
                ┌──────────┐ ┌──────────┐ ┌──────────┐
  L1  WORKER    │ grappe A │ │ grappe B │ │ grappe C │  each = 3 nodes, one mode
                │ adversar.│ │ cooperat.│ │ collab.  │
                └──────────┘ └──────────┘ └──────────┘
  L0  SUBSTRATE  3-node NATS cluster (R=3 JetStream) · grappe KV registry
                 signed membership (ed25519) · logical nodes via spawn-node.mjs
```

**Key invariants (non-negotiable, from MASTER_PLAN §3.2 + DECISIONS D1/D2/D3):**
1. Consumer hardware: one grappe (3 logical nodes) + NATS cluster runs on one MacBook/box.
2. Local-first: a node outside any grappe keeps full single-node function.
3. One daemon, one session layer: all protocol handlers live in `bin/mesh-task-daemon.js`
   (see `lib/mesh-collab.js:30` — `COLLAB_MODE`); no second daemon, no parallel impl.
4. Quality amplifier, not throughput engine: ~35 GPU-min per adversarial session (18 serialised
   inferences × ~120s); step 2.6 benchmarks whether circling beats solo before Phase 2 opens.
5. Savant proposals are never auto-applied: signed → notification + OUT_OF_SCOPE entry → gate.

---

## 2. L0 Substrate

### 2.1 NATS cluster

Three local-dev NATS nodes form an R=3 JetStream cluster (adopted from
`services/nats/nats-1.conf:16` — cluster block). Step 1.1 hardens the existing configs:

- **Listen loopback-only** (`listen: 127.0.0.1:<port>`, overriding the current `0.0.0.0`).
- **Token auth** — `OPENCLAW_NATS_TOKEN` rendered into the server config by `install.sh`
  (clients already resolve and send it via `lib/nats-resolve.js`; the gap is server-side only).
- Cluster routes stay on loopback (`nats-route://127.0.0.1:6222/3/4`).
- Ports: client 4222-4224, cluster 6222-6224, monitor 8222-8224.
- The live single-node bus at 4222 is a **production migration** (not a green-field bring-up):
  existing JetStream data (local-events stream, MESH_* KV) must survive the cutover.

### 2.2 Logical nodes (`bin/spawn-node.mjs`)

Each federation node is an isolated tree spawned by `bin/spawn-node.mjs:131` (`spawnNode()`):
`~/.openclaw-<id>/` with its own `state.db`, `config/node.json`, `workspace/`, vault, logs.
Nodes share only the NATS cluster and the repo code; no filesystem coupling.

```
~/.openclaw-<id>/
  config/node.json   { node_id, nats_url, port }
  state.db           isolated session + memory state
  workspace/         agent working directory
  logs/
```

A full worker grappe (3 nodes) fits on one consumer machine. Multi-machine federation uses the
same protocol over Tailscale; `spawn-node.mjs` is the single code path for both (D1).

### 2.3 Node identity and signing (`lib/node-identity.mjs`, `lib/deploy-trigger-auth.mjs`)

Each node holds an ed25519 keypair at `<nodeRoot>/identity.key` provisioned by
`lib/node-identity.mjs:76` (`getOrCreateIdentity()`). Signing pattern:

```
lib/node-identity.mjs:374  signEvent(event, privateKey)   → adds { signature, signer_pubkey, event_id }
lib/node-identity.mjs:76   getOrCreateIdentity(dir)       → { privateKey, publicKey, publicKeyBase64 }
lib/deploy-trigger-auth.mjs:58  signDeployTrigger(trigger) → reuses signEvent for deploy triggers
```

The same sign/verify pair is used for **join tokens** (1.4) and **task envelopes** (4.2, §5).
Token authenticates *connection to the bus*; envelope signature authenticates *the sender*.
Both are required; neither replaces the other (D2).

### 2.4 Grappe KV registry

Grappes are first-class objects stored in JetStream KV under key `grappe.<id>`:

```javascript
// Grappe manifest schema (§1.3 implementation anchor)
{
  id: "wg-alpha",              // globally unique, operator-chosen
  mode: "adversarial",         // "adversarial" | "cooperative" | "collaborative"
  members: ["alpha","bravo","charlie"],   // node_ids
  formed_at: "<ISO timestamp>",
  status: "live",              // "recruiting" | "live" | "dissolved"
  join_token_hash: "<sha256 of the provisioned join token>",
}
```

The `openclaw-grappe` CLI (step 1.3) wraps KV reads/writes: `form`, `status`, `dissolve`.
Management layer addresses grappes by registry `id`.

---

## 3. L1 Worker grappes — three modes

All three architectures share the same state layer (`lib/mesh-collab.js`), session subject
namespace (`mesh.collab.*`), and daemon handlers (`bin/mesh-task-daemon.js`). The only
structural difference is the session `architecture` field (step 3.1 adds it; `mode` stays
`circling_strategy` for adversarial; cooperative/collaborative get new values).

### 3.1 Mode A — Adversarial (the circling paper)

**Full reference:** docs/circling-strategy-implementationV3.md.
**Implementation status:** code believed-good, dormant behind stale unit paths (D5); revival in step 1.2.

```
TASK SUBMITTED (mesh.collab.create)
  │
  ▼ RECRUITING — 3 nodes join; roles stored once at close
  │   worker_node_id, reviewerA_node_id, reviewerB_node_id (lib/mesh-collab.js:105)
  │   bin/mesh-task-daemon.js:754  handleCollabJoin()
  │
  ▼ INIT STEP — all nodes receive task plan
  │   Worker → workArtifact (v0)
  │   Reviewer A → reviewStrategy
  │   Reviewer B → reviewStrategy
  │   bin/mesh-task-daemon.js:1253  startCirclingStep()
  │
  ▼ SUB-ROUND LOOP (SR 1 .. max_subrounds, default 3)
  │
  │  STEP 1 — Review Pass (barrier: 3/3, 10 min)
  │    Worker  receives: both reviewStrategies [+ reviewArtifacts in SR2+]
  │    Worker  produces: workerReviewsAnalysis
  │    Reviewer receives: workArtifact [+ reconciliationDoc in SR2+]
  │    Reviewer produces: reviewArtifact
  │    lib/mesh-collab.js:619  compileDirectedInput()
  │    lib/mesh-collab.js:704  isCirclingStepComplete()
  │
  │  STEP 2 — Integration + Refinement (barrier: 3/3, 10 min)
  │    Worker  receives: both reviewArtifacts
  │    Worker  produces: workArtifact (updated) + reconciliationDoc [multi-artifact]
  │    Reviewer receives: workerReviewsAnalysis + cross-review (other reviewer)
  │    Reviewer produces: reviewStrategy (refined)
  │    lib/mesh-collab.js:727  advanceCirclingStep()
  │
  │  [tier gate if automation_tier == 3]
  │
  ▼ FINALIZATION — all nodes receive final workArtifact + task plan (barrier: 3/3)
  │   Worker   → workArtifact (final) + completionDiff + vote
  │   Reviewer → vote (converged | blocked)
  │   bin/mesh-task-daemon.js:1393  completeCirclingSession()
  │
  │  if ANY vote == "blocked": gate fires (kanban bin/mesh-bridge.js:334)
  │  if ALL non-blocked: SESSION COMPLETE
  ▼
DONE — artifacts in JetStream KV, parent task completed
```

**Key parse contract** (`lib/circling-parser.js:26` — `parseCirclingReflection()`):
- Single-artifact: all content before `===CIRCLING_REFLECTION===` is the artifact.
- Multi-artifact: content between `===CIRCLING_ARTIFACT===` / `===END_ARTIFACT===` pairs.
- `parse_failed: true` → `lib/mesh-collab.js:791` `recordArtifactFailure()` tracks it;
  step advances with degraded input (gap §14.2 — retry ×3 pending, step 2.3).
- Adaptive convergence (gap §14.1 — early exit when all converged): step 2.2.

**Timeouts:** dual-layer — in-memory `setTimeout` in `bin/mesh-task-daemon.js:1310` + 60s cron
sweep via `sweepCirclingStepTimeouts()` that rehydrates from `step_started_at` after restart.
Default `CIRCLING_STEP_TIMEOUT_MS` = 10 min (`bin/mesh-task-daemon.js:54`).

**Prompt construction:** `bin/mesh-agent.js:779` `buildCirclingPrompt(task, circlingData)` builds
phase-specific instructions; agent imports the standalone parser at `bin/mesh-agent.js:962`.

### 3.2 Mode B — Cooperative

Cooperative sessions are **proposal-all / integrate-one / rotate-integrator** rounds. Three
nodes each propose; one designated integrator merges; integrator role rotates each round. Best
for exploratory tasks with no natural single owner.

```
TASK SUBMITTED
  │
  ▼ RECRUITING — 3 nodes, no fixed roles
  │
  ▼ ROUND LOOP (up to max_rounds)
  │
  │  PROPOSE — all 3 nodes produce proposals (barrier: 3/3)
  │    Each node receives: task + prior integration artifact (if round > 1)
  │    Each node produces: proposalArtifact
  │
  │  INTEGRATE — designated integrator merges proposals (barrier: 1/1)
  │    Integrator receives: all 3 proposalArtifacts
  │    Integrator produces: integrationArtifact
  │    KV state records: integrator_node_id for this round
  │
  │  integrator_node_id rotates (round % 3 → node index)
  │
  │  [convergence check or max_rounds reached → finalization]
  ▼
DONE — integrationArtifact is the work product
```

**Session field anchor (step 3.1):** `session.architecture = "cooperative"` on the
`lib/mesh-collab.js:54` (`createSession()`) schema. Existing `circling` block stays null.
The round-state (integrator_node_id, round_number) is the cooperative equivalent of the
circling sub-round state — added to the session schema in step 3.2.

### 3.3 Mode C — Collaborative

Collaborative sessions **decompose → per-node subtasks → parallel work → merge + merge-review**.
Best for decomposable work (N files, N documents, N probes). Reuses `mesh.plans.*` subtask
machinery that already exists in `bin/mesh-task-daemon.js` (comment block at line 8-13).

```
TASK SUBMITTED
  │
  ▼ DECOMPOSE — coordinator proposes 3 subtasks (one per node)
  │   coordinator produces: subtask list [{subtask_id, description, assigned_node_id}]
  │
  ▼ PARALLEL WORK — 3 nodes work concurrently (no barrier between nodes)
  │   Each node receives: its subtask description
  │   Each node produces: subtaskArtifact
  │
  ▼ MERGE — designated merger assembles subtaskArtifacts
  │   merger receives: all 3 subtaskArtifacts
  │   merger produces: mergeArtifact
  │
  ▼ MERGE-REVIEW — 2 non-merger nodes review the merge (barrier: 2/2)
  │   reviewer receives: mergeArtifact
  │   reviewer produces: mergeReview (approve | reject + reason)
  │   if both approve: SESSION COMPLETE
  │   if any reject: operator gate raised
  ▼
DONE — mergeArtifact is the work product
```

**Session field anchor:** `session.architecture = "collaborative"` (step 3.1). Subtask tracking
reuses the `mesh.plans.{create,subtask.update}` subject family already implemented.

### 3.4 Mode selection guidance

| Task shape | Recommended mode | Rationale |
|---|---|---|
| High-stakes single artifact (contract, migration, spec) | **adversarial** | Information asymmetry prevents groupthink; paper's protocol proven for this case |
| Exploratory, no natural owner | **cooperative** | All nodes contribute equally; integrator rotation keeps perspectives fresh |
| Decomposable (N independent pieces) | **collaborative** | Parallelism is real (no barriers between nodes during work); merge review catches integration errors |

The management decomposer (step 4.1) applies this table mechanically when dispatching to worker
grappes. Step 3.4 adds `preferred_mode` to the task envelope schema (§5.1) and verifies dispatch
honors it.

---

## 4. L2 Management grappe (5 nodes)

### 4.1 Session type

Management sessions use `session.type = "management"` (new value alongside `collab`) within
`bin/mesh-task-daemon.js`. Handlers are added to the existing daemon (D2 — no separate daemon).
Five stored roles: coordinator, decomposer, assembler, verifier-A, verifier-B.

```
INTAKE (mesh.mgmt.submit)
  │ complex task → management session in KV
  ▼
DECOMPOSE
  │ decomposer node proposes subtask breakdown + preferred_mode per subtask
  │ schema: { session_id, subtasks: [{id, description, preferred_mode, assigned_grappe}] }
  │ 3/5 quorum vote (≥3 approve → state advances; <3 → operator gate)
  ▼
DISPATCH
  │ coordinator sends SIGNED task envelopes to worker grappes (§5.1)
  │ each envelope is addressed by grappe registry id
  ▼
MONITOR
  │ heartbeat watch (uses grappe member heartbeats from 1.2)
  │ timeout/death → reassignment to another grappe (step 4.4)
  ▼
ASSEMBLE
  │ assembler collects result envelopes from all worker grappes (§5.2)
  │ assembles into combined artifact
  ▼
VERIFY
  │ verifier-A and verifier-B independently review the assembled artifact
  │ 3/5 quorum vote (≥3 approve → DELIVER; <3 → operator gate)
  ▼
DELIVER — artifact reaches the operator (kanban notification + KV)
```

### 4.2 Role identity

Same stored-ID pattern as circling (D2, paper precedent):

```javascript
// Management session schema additions (step 4.1)
management: {
  coordinator_node_id: null,   // assigned at recruiting close
  decomposer_node_id: null,
  assembler_node_id: null,
  verifierA_node_id: null,
  verifierB_node_id: null,
  quorum_threshold: 3,         // of 5
  phase: "intake",             // intake|decompose|dispatch|assemble|verify|complete
  decomposition: null,         // { subtasks: [...] } after decompose vote
  result_envelopes: [],        // collected from workers (§5.2)
}
```

---

## 5. Envelopes

### 5.1 Task envelope (management → worker grappe)

```javascript
// Task envelope — signed by the coordinator node (lib/node-identity.mjs:374 signEvent)
{
  envelope_type: "task",
  task_id: "<uuid>",                // management session subtask id
  session_id: "<management_sess>",  // management session (return address)
  target_grappe: "wg-alpha",        // registry id (§2.4)
  preferred_mode: "adversarial",    // "adversarial" | "cooperative" | "collaborative"
  description: "<task text>",
  deadline_ms: 3600000,             // wall-clock budget (ms)
  issued_at: "<ISO timestamp>",

  // ed25519 signature (from lib/deploy-trigger-auth.mjs:58 signDeployTrigger pattern)
  signature: "<base64>",
  signer_pubkey: "<base64>",        // coordinator node's public key
  event_id: "<uuid>",               // replay-prevention
}
```

A worker grappe that receives an unsigned or tampered envelope REJECTS it (logged + ledgered
notification). The token authenticates the bus connection (§2.2); the signature authenticates
the sender. Both required.

### 5.2 Result envelope (worker grappe → management)

```javascript
// Result envelope — signed by the worker grappe coordinator
{
  envelope_type: "result",
  task_id: "<uuid>",                // matches the task envelope
  session_id: "<worker_sess>",      // the worker collab session id
  source_grappe: "wg-alpha",
  management_session: "<mgmt_sess>",
  status: "complete",               // "complete" | "failed" | "timeout"
  artifact: "<text content>",       // the work product (or null on failure)
  artifact_key: "<KV key>",         // JetStream KV key for the full artifact
  converged: true,                  // whether finalization was unanimous
  issued_at: "<ISO timestamp>",

  signature: "<base64>",
  signer_pubkey: "<base64>",
  event_id: "<uuid>",
}
```

### 5.3 Change-set envelope (savant → operator gate, §6.3)

```javascript
// Change-set artifact — the savant grappe's work product (step 5.2)
{
  envelope_type: "change_set",
  change_set_id: "<uuid>",
  savant_session_id: "<sess>",
  level: "substrate",    // "substrate" | "worker" | "management" | "policy"

  rationale: "<why the change is warranted — evidence from telemetry>",

  // Exactly ONE of the following (whichever fits the level):
  edit: {
    type: "patch",               // for code-level changes
    target_file: "lib/foo.mjs",
    patch: "<unified diff>",
  },
  // OR:
  edit: {
    type: "scope_addendum",      // for workplan-level changes
    target_plan: "federation",
    proposed_text: "<scope entry text>",
  },

  expected_evidence: "<what you will observe if the edit is correct>",

  // Signed by the savant session coordinator (same pattern as §5.1)
  signature: "<base64>",
  signer_pubkey: "<base64>",
  event_id: "<uuid>",
  issued_at: "<ISO timestamp>",
}
```

---

## 6. L3 Savant grappe

### 6.1 Telemetry substrate (step 5.1)

The savant observes the whole system through one queryable feed. Sources:
- `node-watch` JSON snapshots (per-tick health reports)
- notification ledger (all `openclaw-notify` events)
- session KV outcomes (all grappe sessions, by level)
- tick digests (workplan tick logs)

The collector mechanism (JetStream consumer vs periodic scrape) is decided in step 5.1's
Phase-1 design and logged in DECISIONS (not pre-decided here — §4.3 of MASTER_PLAN forbids
drift, and the tradeoff between JetStream fanout vs scrape simplicity needs the implementation
context of step 5.1).

### 6.2 Session type

Savant sessions are **adversarial sessions** (`architecture = "adversarial"`, same circling
paper protocol) whose TASK is "review the telemetry feed and produce a change-set" and whose
ARTIFACT is a change-set (§5.3). No new session type; no new protocol machinery.

The savant _input_ is the telemetry query result; the savant _output_ is a change-set validated
against the §5.3 schema before leaving the session.

### 6.3 Proposal pipeline (step 5.3)

```
Savant session COMPLETE
  │ change-set artifact produced (§5.3)
  │ validated against schema
  ▼
SIGN — signed by the savant coordinator (lib/node-identity.mjs:374)
  ▼
NOTIFY — openclaw-notify event: level + change_set_id + summary (click-through to MC)
  │ notification ledger entry (same path every other grappe event uses)
  ▼
OUT_OF_SCOPE ENTRY — PROPOSED entry appended to target plan's OUT_OF_SCOPE.md
  │ format: "PROPOSED <change_set_id> (savant, level=<level>): <rationale>"
  │ the entry includes the full change-set (§5.3) as a code block
  ▼
OPERATOR GATE
  │ operator reviews in MC (step 6.2 page) or by reading OUT_OF_SCOPE.md
  │ APPROVE → normal SCOPE.md/commit discipline applies the edit
  │ REJECT  → entry flagged; next savant cycle sees the rejection in telemetry
  ▼
NO AUTO-APPLY PATH EXISTS (write-jail: gate-security test cells G1–G5, step 5.5)
```

**Write-jail invariant (gate-security):** the savant pipeline has write access ONLY to
`OUT_OF_SCOPE.md` (always-writeable per MASTER_PLAN §4.3) and the notification ledger. It has
NO write path to any file outside that contract. The gate is structural, not policy — step 5.3's
Verify includes a grep-asserting test that no apply-path exists that bypasses the gate.

**Self-referential safety note (from D3):** same-model reviewers (qwen3:8b reviewing qwen3:8b)
can share failure modes. The write-jail is the safety mechanism, not the review itself. A
change-set proposing to weaken the gate must be flagged by the G4 test cell (self-referential
flag) — the review is defence-in-depth, not the primary control.

---

## 7. Subject namespace

```
mesh.collab.*          — existing worker collab layer (create/join/reflect/gate/status/find)
mesh.tasks.*           — existing task kanban (submit/claim/complete/fail/heartbeat/…)
mesh.plans.*           — existing subtask layer (create/approve/subtask.update)
mesh.mgmt.*            — NEW (step 4.1) management layer (submit/decompose.vote/dispatch/assemble/verify.vote/deliver)
mesh.grappe.*          — NEW (step 1.3) grappe registry operations (form/dissolve/status)
mesh.savant.*          — NEW (step 5.3) savant pipeline (proposal/gate.approve/gate.reject)
```

All federation subjects use `mesh.*` — the `openclaw.*` fleet namespace is retired in step 6.1
(D4). No `openclaw.*` subject must remain after 6.1 closes.

---

## 8. Layer contracts (what each layer guarantees its consumer)

| Layer | Guarantees | Does NOT guarantee |
|---|---|---|
| L0 Substrate | JetStream R=3 durable; bus is token-authed + loopback-only; nodes have stable ed25519 identities; grappe registry is KV-backed | Any application-level protocol above the bus |
| L1 Worker | A session reaches COMPLETE with a finalization vote; artifacts are in JetStream KV with deterministic keys; the paper's protocol (adversarial) is faithfully executed; modes B/C produce their specified work product | Quality of the LLM output; convergence within N rounds; absence of parse failures |
| L2 Management | A complex task is decomposed (quorum-approved), dispatched (signed), results assembled, and quorum-verified before delivery; worker-grappe failure triggers reassignment; the operator gate fires on rejection | Worker grappes actually completing (they guarantee their own COMPLETE); pipeline latency (depends on LLM budget) |
| L3 Savant | Every change-set is schema-valid, signed, gated via OUT_OF_SCOPE, and observable in MC; no auto-apply path exists; the write-jail is structurally enforced | Change-set quality; operator adoption rate |

---

## 9. Cross-reference index (file:line → spec section)

| File:line | What | Spec section |
|---|---|---|
| `lib/mesh-collab.js:30` | `COLLAB_MODE` enum | §3 (session layer shared by all modes) |
| `lib/mesh-collab.js:54` | `createSession()` | §3.1/3.2/3.3 (architecture field added in 3.1) |
| `lib/mesh-collab.js:65` | `min_nodes` default (3 for circling) | §3.1 adversarial recruiting |
| `lib/mesh-collab.js:105` | `circling` block in session schema | §3.1 flow (role IDs) |
| `lib/mesh-collab.js:619` | `compileDirectedInput()` | §3.1 per-node directed input |
| `lib/mesh-collab.js:704` | `isCirclingStepComplete()` | §3.1 barriers |
| `lib/mesh-collab.js:727` | `advanceCirclingStep()` | §3.1 state machine |
| `lib/mesh-collab.js:791` | `recordArtifactFailure()` | §3.1 parse failure tracking |
| `lib/circling-parser.js:26` | `parseCirclingReflection()` | §3.1 parse contract |
| `bin/mesh-task-daemon.js:54` | `CIRCLING_STEP_TIMEOUT_MS` | §3.1 timeouts |
| `bin/mesh-task-daemon.js:754` | `handleCollabJoin()` | §3.1 recruiting + role assignment |
| `bin/mesh-task-daemon.js:872` | `handleCollabReflect()` | §3.1 reflection → barrier |
| `bin/mesh-task-daemon.js:1253` | `startCirclingStep()` | §3.1 step start + directed input |
| `bin/mesh-task-daemon.js:1393` | `completeCirclingSession()` | §3.1 finalization + gate |
| `bin/mesh-agent.js:779` | `buildCirclingPrompt()` | §3.1 prompt construction |
| `bin/mesh-agent.js:962` | parser import | §3.1 agent parse path |
| `bin/mesh-bridge.js:307` | `circling_step_started` handler | §3.1 kanban materialization |
| `bin/mesh-bridge.js:334` | `circling_gate` handler | §3.1 gate message |
| `lib/deploy-trigger-auth.mjs:58` | `signDeployTrigger()` | §5.1 envelope signing pattern |
| `lib/node-identity.mjs:76` | `getOrCreateIdentity()` | §2.3 node identity |
| `lib/node-identity.mjs:374` | `signEvent()` | §5.1/5.3 envelope + change-set signing |
| `bin/spawn-node.mjs:131` | `spawnNode()` | §2.2 logical node trees |
| `services/nats/nats-1.conf:16` | cluster block | §2.1 NATS cluster (step 1.1 hardens) |
