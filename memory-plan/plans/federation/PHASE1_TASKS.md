# PHASE 1 — Atomic task decomposition (the basic cluster)

Every INVENTORY step (0.1–3.5) broken into atomic implementation tasks. A **task** is one
concrete action with a single observable done-when; a **step** is the commit-grain unit (one
9-phase cycle, PROTOCOL §3) whose Phase-4 work is the task list below it. Tiers per
[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) §T1–T7.

Task id = `T<step>.<n>`. Format: **action** → *touches* · done-when (observable) · [tier].
`NEW` = create, `EDIT` = modify existing, `PROBE` = observe-only.

---

## Block 0 — Spec + ground truth

### Step 0.1 — crash-loop root-cause (diagnosis only)
- **T0.1.1** Enumerate the disabled mesh units and their exec paths → *`ls ~/Library/LaunchAgents/*.disabled`, read each plist's ProgramArguments* · done-when: a table {unit → script → last-exit-code} recorded in AUDIT_PRE. [PROBE]
- **T0.1.2** Pull each unit's crash window from the system log → *`log show --predicate 'process CONTAINS "mesh"' --start 2026-07-03`; per-unit stderr `.log` tails* · done-when: the actual failing line captured per unit. [PROBE]
- **T0.1.3** Classify each failure: (a) NATS-dependency loop, (b) code fault, (c) stale-config fault → *cross-ref the log excerpt against the source line* · done-when: every unit has one class + evidence. [PROBE]
- **T0.1.4** Write **DECISIONS D2**: per-unit verdict + excerpt + the revive-precondition (what must be true/fixed before it starts) → *DECISIONS.md* · done-when: D2 committed; no class (b)/(c) unit may be started in Phase 1 until its fix lands. [code]

### Step 0.2 — FEDERATION_SPEC.md
- **T0.2.1** Grappe model + lifecycle prose (FORMING→ACTIVE→DEGRADED→DISSOLVED) → *NEW docs/FEDERATION_SPEC.md* · done-when: states + transitions defined. [code]
- **T0.2.2** Grappe manifest schema `{v,id,layer,mode,members[],quorum,status,formed_at}` (JSON, versioned) → *FEDERATION_SPEC §schemas* · done-when: schema block present with field types. [code]
- **T0.2.3** Task + result envelope schemas (incl. `nonce`, `issued_at`, `sig`, `preferred_mode`) → *FEDERATION_SPEC §schemas* · done-when: both schemas present. [code]
- **T0.2.4** Change-set schema (locked here, used in Phase 3) → *FEDERATION_SPEC §schemas* · done-when: `{level,rationale,edit,expected_evidence,...}` present. [code]
- **T0.2.5** Subject map extending `mesh.*` (`mesh.grappe.<id>.{task,result}`, `mesh.grappe.registry.*`, management/savant subjects reserved) → *FEDERATION_SPEC §subjects* · done-when: every subject this plan uses is listed with its message shape. [code]
- **T0.2.6** Signing scheme section (ed25519, trusted-keys registry, nonce + issued_at replay window) referencing lib/deploy-trigger-auth.mjs → *FEDERATION_SPEC §security* · done-when: the verify algorithm is specified. [code]
- **T0.2.7** The three mode flow-diagrams at paper fidelity (who-sees-what per barrier) → *FEDERATION_SPEC §modes* · done-when: adversarial/cooperative/collaborative each have a step diagram. [code]
- **T0.2.8** Layer-contract section (worker→mgmt result semantics; mgmt→savant telemetry; savant→operator change-set) → *FEDERATION_SPEC §contracts* · done-when: ≥10 file:line cross-refs into the existing stack. [code]

## Block 1 — Substrate

### Step 1.1 — 3-node NATS cluster (R=3): ADOPT + HARDEN
**Reality (2026-07-06 review):** `services/nats/nats-{1,2,3}.conf` + `ai.openclaw.nats-{1,2,3}.plist`
ALREADY EXIST — the cluster is scaffolded, not to be authored. But the existing configs `listen:
0.0.0.0` (all interfaces) and carry no `authorization` while install.sh provisions an unused
`OPENCLAW_NATS_TOKEN`. This step adopts + hardens; granular in [GRANULAR_PHASE1.md](GRANULAR_PHASE1.md).
- **T1.1.1** Bind every listener loopback (`0.0.0.0`→`127.0.0.1`, client+cluster+monitor) in all three configs → *services/nats/nats-{1,2,3}.conf* · done-when: no all-interfaces listener remains; `nats-server -c … -t` OK. [code]
- **T1.1.2** Add `authorization { token }` (+ cluster-route auth) as install-rendered templates so the token stays out of git → *services/nats/nats-*.conf, install.sh config generator* · done-when: connect without the token refused, with it accepted. [runtime]
- **T1.1.3** Confirm the three plists exec the real `services/nats/nats-N.conf` path + are in service-manifest role `both`; retire any legacy single-node `ai.openclaw.nats.plist` (§4.6) → *services/* · done-when: three units, one config family. [code]
- **T1.1.4** Bring the cluster up + JetStream budget decision (256MB×3 vs 64MB×3) logged → *launchctl bootstrap; DECISIONS* · done-when: all three `:822x/varz` report `cluster.name=openclaw-cluster` with 2 peers. [runtime T3]
- **T1.1.5** R=3 replication probe → *probe script: stream R=3, read replica count* · done-when: 3 current replicas. [runtime T3]
- **T1.1.6** Quorum-survival probe → *kill node-2, publish, restart* · done-when: writable at 2/3; recovers to 3/3. [chaos C2 preview]

### Step 1.2 — logical nodes heartbeating
- **T1.2.1** Spawn three trees → *`spawn-node.mjs --id alpha|bravo|charlie`* · done-when: `~/.openclaw-{alpha,bravo,charlie}/` exist with own state.db/config. [runtime]
- **T1.2.2** Apply D2 revive-preconditions to mesh-agent + health-publisher (fix class-(b)/(c) faults found in 0.1) → *bin/mesh-agent.js, bin/mesh-health-publisher.js as D2 dictates* · done-when: the specific fault no longer reproduces. [code]
- **T1.2.3** Generate per-node agent units (label `ai.openclaw.node-<id>-agent`, round-robin the 3 cluster URLs, OFF by default) → *services/ templates + a render step in the grappe CLI or install* · done-when: units exist, start cleanly. [code]
- **T1.2.4** Start the three agents, observe heartbeats → *start units; subscribe `mesh.health`* · done-when: 3 distinct node-ids publish heartbeats <60s fresh. [runtime T3]
- **T1.2.5** 10-minute stability soak → *leave running, watch launchctl restart counters* · done-when: 0 restarts, heartbeats unbroken 10+ min. [T6 mini]

### Step 1.3 — grappe registry + CLI
- **T1.3.1** `lib/grappe-registry.mjs`: manifest validate + KV read/write (`grappe-registry` bucket, key `g.<id>`) → *NEW lib/grappe-registry.mjs* · done-when: form/get/list/delete functions with schema validation. [code]
- **T1.3.2** Member liveness resolver (heartbeat age → LIVE/DEGRADED/DEAD, node-watch vocabulary) → *lib/grappe-registry.mjs* · done-when: pure function tested against fixture heartbeats. [T1]
- **T1.3.3** `bin/openclaw-grappe.mjs` `form` subcommand (writes manifest, signs member records) → *NEW bin/openclaw-grappe.mjs* · done-when: `form --id wg-alpha --mode adversarial --members alpha,bravo,charlie` writes a valid manifest. [runtime]
- **T1.3.4** `status` subcommand (render grappe + per-member verdict) → *bin/openclaw-grappe.mjs* · done-when: `status` shows wg-alpha 3/3 LIVE. [runtime T3]
- **T1.3.5** `dissolve` subcommand (mark DISSOLVED, stop member units) → *bin/openclaw-grappe.mjs* · done-when: `dissolve wg-alpha` flips status, `status` reflects it. [runtime]
- **T1.3.6** Register the bin in package.json + install.sh → *package.json, install.sh* · done-when: `openclaw-grappe` on PATH after install. [code]

### Step 1.4 — signed membership
- **T1.4.1** Extend `mesh-join-token` to bind grappe-id + expiry → *bin/mesh-join-token.js* · done-when: token carries {grappe_id, exp, sig}. [code]
- **T1.4.2** `join --token` subcommand verifying signature + expiry before writing the member record → *bin/openclaw-grappe.mjs + lib/grappe-registry.mjs* · done-when: valid token → member added. [runtime T3]
- **T1.4.3** Reject path: unsigned/expired/forged join → *registry verify* · done-when: rejected with logged reason + `block` ledgered notification. [runtime C6 preview]
- **T1.4.4** Unit coverage: mint→verify→expiry→forgery → *NEW test/grappe-membership.test.mjs* · done-when: all four assertions pass. [T1]

## Block 2 — Worker mode A: adversarial (circling revival)

### Step 2.1 — circling revived live
- **T2.1.1** Establish a process-level mock-LLM seam for mesh-agent (reuse the 44-test seam; if it's in-test-only, add `MESH_AGENT_MOCK=1` reading scripted responses) → *bin/mesh-agent.js* · done-when: an agent process returns scripted artifacts without a real LLM call. [code]
- **T2.1.2** Revive mesh-task-daemon + mesh-bridge on the operator node per D2 → *start units, apply any D2 fix* · done-when: daemon connects to the cluster, subscribes the `mesh.collab.*` subjects, no crash-loop. [runtime]
- **T2.1.3** Drive one full session create→recruit→SR loop→finalization → *`mesh.collab.create` with 3 members, mock agents* · done-when: session reaches COMPLETE. [runtime T3-L1]
- **T2.1.4** Evidence capture: read back every state transition + artifacts from KV → *KV dump script* · done-when: role assignments, both barriers per SR (3/3), votes, artifacts quoted in AUDIT_POST. [runtime]
- **T2.1.5** Kanban trail check → *mesh-bridge materialization* · done-when: the session's cards appear with correct states. [visual/runtime]

### Step 2.2 — adaptive convergence (paper §14.1)
- **T2.2.1** In `advanceCirclingStep`, after step-2 barrier: if all live nodes' latest vote == converged → jump to finalization → *lib/mesh-collab.js* · done-when: branch added, existing 44 tests still green. [code]
- **T2.2.2** Unit tests: unanimous-converged-after-SR1 finalizes; mixed votes continue → *test/collab-circling.test.js (extend)* · done-when: both pass. [T1]
- **T2.2.3** Live proof: mock session scripted to converge in SR1 → *T3 run* · done-when: observed finalizing after SR1, not running all 3. [runtime T3-L2]

### Step 2.3 — parse-failure retry ×3 (paper §14.2)
- **T2.3.1** Reflect handler: on parse-fail with `failCount<3`, re-publish directed input to that node, don't count toward barrier → *bin/mesh-task-daemon.js* · done-when: retry path implemented. [code]
- **T2.3.2** 3rd-failure path unchanged (degrade + CRITICAL log) → *daemon* · done-when: boundary correct. [code]
- **T2.3.3** Unit tests: 2-fail-then-succeed satisfies barrier; 3-fail degrades → *test/daemon-circling-handlers.test.js (extend)* · done-when: both pass. [T1]
- **T2.3.4** Live proof: mock session with injected double-failure completes un-degraded → *T3 run* · done-when: observed. [runtime T3]

### Step 2.4 — first real adversarial run
- **T2.4.1** Choose the task with the operator (small, real, useful) → *AskUserQuestion / session note* · done-when: task brief written to the session. [visual]
- **T2.4.2** Bind agents to qwen3:8b via the ollama queue → *mesh-agent LLM config* · done-when: agents call the real model. [code]
- **T2.4.3** Run the session, measure per-step wall-times → *live run* · done-when: COMPLETE with a converged vote on real output. [runtime T4]
- **T2.4.4** Operator spot-check artifacts are non-trivial → *visual* · done-when: operator confirms usefulness. [visual T7]
- **T2.4.5** Record timings/subround/token metrics as Phase-2 planning constants → *DECISIONS / audit* · done-when: metrics logged. [code]

### Step 2.6 — PREMISE BENCHMARK (does circling actually help?)
- **T2.6.1** Solo-node baseline path: one agent, same task, same qwen3:8b, no reviewers → *a `--solo` create mode or a direct single-agent call* · done-when: solo produces an artifact for the same brief. [code]
- **T2.6.2** Pick ≥5 real tasks with the operator spanning the intended use (a doc harden, a small spec, a review) → *AskUserQuestion* · done-when: task set fixed. [visual]
- **T2.6.3** Run each task both ways (solo + adversarial grappe); strip identifying markers → *runs + anonymizer* · done-when: 10 artifacts, provenance hidden. [runtime T4]
- **T2.6.4** Operator blind-scores each pair on a pre-agreed rubric (correctness, completeness, catches-a-real-flaw) → *visual* · done-when: scores recorded, which-is-which revealed after. [T7]
- **T2.6.5** Verdict + cost: grappe wins a clear majority → PASS (Phase 1 may proceed); else write BLOCKED.md citing the premise miss. Record the GPU-cost delta (~35 min vs ~2 min) alongside → *DECISIONS/audit* · done-when: PASS-or-BLOCK decision committed. [decision]

## Block 3 — Worker modes B + C

### Step 3.1 — `architecture` dispatch seam
- **T3.1.1** Add `architecture: 'adversarial'|'cooperative'|'collaborative'` to the session schema (adversarial default; existing `circling` field becomes adversarial-mode config) → *lib/mesh-collab.js* · done-when: schema carries the field, migration-safe (old sessions default adversarial). [code]
- **T3.1.2** Per-mode strategy table at the daemon's single advance point (no forked daemons, §4.6) → *bin/mesh-task-daemon.js* · done-when: dispatch routes by `architecture`; unknown value rejected. [code]
- **T3.1.3** Unit + regression: schema/dispatch tests pass; the 44 existing circling tests stay green → *test/* · done-when: green. [T1]
- **T3.1.4** Live: a created session shows `architecture` in KV → *runtime* · done-when: observed. [runtime]

### Step 3.2 — cooperative mode
- **T3.2.1** Round machinery: [all-3-propose barrier 3/3] → [integrator merges, barrier 1/1] → rotate integrator (stored order) → *lib/mesh-collab.js* · done-when: state functions for the cooperative round. [code]
- **T3.2.2** Directed-input rule: proposers see merged artifact + prior proposals; integrator sees all (no asymmetry — operator's definition) → *lib/mesh-collab.js compile-input* · done-when: input-compilation branch per role. [code]
- **T3.2.3** Prompt construction for propose vs integrate → *bin/mesh-agent.js buildCooperativePrompt* · done-when: two prompt shapes. [code]
- **T3.2.4** Unit: rotation order, barrier counts, merge provenance → *NEW test/cooperative.test.js* · done-when: pass. [T1]
- **T3.2.5** Live: 3-round mock session, integrator differs each round, final artifact draws from all 3 → *T3 run* · done-when: observed in KV. [runtime T3-L4]

### Step 3.3 — collaborative mode
- **T3.3.1** Session opens with a decomposition artifact; register subtasks via `mesh.plans.*` → *lib/mesh-collab.js + mesh-task-daemon plans integration* · done-when: N subtasks created from the decomposition. [code]
- **T3.3.2** Assign one subtask per node; nodes work in parallel (per-subtask artifacts, no cross-barrier until merge) → *daemon dispatch* · done-when: 3 subtasks assigned to 3 node-ids. [code]
- **T3.3.3** Merge step (assembler = largest-subtask node, stored) + one merge-review barrier (other two vote) → *lib/mesh-collab.js* · done-when: merge + merge-review states. [code]
- **T3.3.4** Per-subtask timeout (not per-session) → *daemon timers* · done-when: a stalled subtask times out independently. [code]
- **T3.3.5** Unit: assignment, parallel-artifact isolation, merge-review quorum → *NEW test/collaborative.test.js* · done-when: pass. [T1]
- **T3.3.6** Live: 3 subtasks concurrent (overlapping timestamps), merge produced, 2 merge-review votes → *T3 run* · done-when: observed. [runtime T3-L5]

### Step 3.4 — mode-selection contract
- **T3.4.1** Decision table in FEDERATION_SPEC (single high-stakes→adversarial; exploratory→cooperative; decomposable→collaborative; default adversarial) → *docs/FEDERATION_SPEC.md* · done-when: table present. [code]
- **T3.4.2** `preferred_mode` honored at session creation; unknown → rejected → *daemon* · done-when: unit test each value routes correctly. [T1]
- **T3.4.3** Live: a session created with each of the 3 values lands in the matching protocol → *runtime* · done-when: observed 3×. [runtime T3-L6]

### Step 3.5 — PHASE-1 GATE (worker-cluster operational testing)
- **T3.5.1** Land the CI federation census (nats-binary-gated, visible skips) → *.github/workflows/test.yml, test/helpers census* · done-when: CI green with a visible skip when nats absent. [T1/CI 6.4]
- **T3.5.2** Land worker `fed.*` probes (`fed.cluster.quorum`, `fed.grappe.<id>.members`, `fed.session.liveness`) → *lib/node-watch.mjs* · done-when: `node-watch --axis federation` grades them honestly. [runtime 6.3]
- **T3.5.3** Land the `grappe` notification source (gate raised / session failed / member dead) → *the daemon + openclaw-notify* · done-when: an event fires a ledgered click-through popup. [runtime 6.3]
- **T3.5.4** Run + record the 6-cell T3 live matrix (L1–L6) → *live runs, KV/ledger evidence* · done-when: all 6 observed, quoted. [runtime T3]
- **T3.5.5** Run + record the 8-cell chaos matrix (C1–C8) → *failure injection* · done-when: all 8 observed with required behavior. [T5]
- **T3.5.6** ≥12h soak: cron feeder every 20 min cycling modes; witnesses = snapshots + ledger + KV census → *NEW test/soak or a feeder script* · done-when: 0 hung / 0 crash-loop / flat memory report. [T6]
- **T3.5.7** T7 acceptance: operator watches one live session end-to-end; sign the checklist in AUDIT_POST → *visual* · done-when: 5-point Phase-1 checklist signed. [T7]
