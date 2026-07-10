# PHASE 2 — Atomic task decomposition (the manager cluster)

Steps 4.1–4.6 broken into atomic tasks. Conventions + tiers as in
[PHASE1_TASKS.md](PHASE1_TASKS.md) / [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md).
Phase 2 depends on the Phase-1 gate (3.5): step 4.1's Needs cites that checklist.

---

## Block 4 — Management grappe (5 nodes)

### Step 4.1 — management session type + quorum decomposition
- **T4.1.1** Measure the box: spawn 5 more logical nodes, record RAM/CPU with 8 nodes + 3 NATS running → *spawn-node ×5; `vm_stat`/`ps`* · done-when: budget recorded in DECISIONS; if it doesn't fit, log the shared-process-agents fallback decision with the operator. [PROBE/decision]
- **T4.1.2** Form the management grappe `mg-one` (layer=management, 5 members, quorum=3) with stored roles coordinator/decomposer/assembler/verifierA/verifierB → *bin/openclaw-grappe.mjs form + registry* · done-when: manifest carries 5 role-tagged members. [runtime]
- **T4.1.3** `lib/mgmt-session.mjs` state machine `INTAKE→DECOMPOSING→DECOMP_VOTE→DISPATCHED→ASSEMBLING→VERIFY_VOTE→DELIVERED|GATED`, single-writer KV → *NEW lib/mgmt-session.mjs* · done-when: legal-transition function + KV persistence. [code]
- **T4.1.4** Intake handler: accept a complex task, create the session, assign roles from the manifest → *bin/mesh-task-daemon.js (mgmt handlers) or a mgmt daemon path* · done-when: `mesh.mgmt.create` → session in INTAKE. [code]
- **T4.1.5** Decomposition proposal: decomposer role produces `{subtasks:[{id,brief,preferred_mode,acceptance[]}],rationale}` → *mesh-agent mgmt prompt + mgmt-session store* · done-when: proposal artifact in KV. [code]
- **T4.1.6** Quorum vote: all 5 vote; ≥3 approve → DISPATCHED; <3 → one revision round (decomposer sees objections); 2nd fail → GATED → *lib/mgmt-session.mjs quorum + revision* · done-when: vote-counting on LIVE members, floor 3. [code]
- **T4.1.7** Unit: quorum arithmetic (3/5, 2/5+revision, dead-voter counting), transition legality → *NEW test/mgmt-session.test.mjs* · done-when: pass. [T1]
- **T4.1.8** Live: seeded task → decomposition proposal + 5 votes; ≥3 advances, a scripted 2/5 does NOT advance → *T3-M1/M2 partial* · done-when: both observed in KV. [runtime T3]

### Step 4.2 — signed dispatch + result deferral
- **T4.2.1** Coordinator turns approved subtasks into signed task envelopes (schema 0.2) → *lib/mgmt-session.mjs + signing from 1.4* · done-when: envelope published to `mesh.grappe.<id>.task`. [code]
- **T4.2.2** Worker-grappe intake: validate sig/nonce/deadline → create worker session in `preferred_mode` → *worker daemon (Blocks 2–3) + verify* · done-when: signed envelope creates a session; unsigned rejected. [code]
- **T4.2.3** Result envelope: worker publishes signed result on terminal state → `mesh.grappe.<id>.result` → *worker daemon* · done-when: result envelope references the worker session id + artifacts_ref. [code]
- **T4.2.4** Management correlation by `envelope_id`; first-terminal-result-wins rule, late/duplicate discarded (logged) → *lib/mgmt-session.mjs* · done-when: deterministic correlation, idempotent. [code]
- **T4.2.5** Unit: envelope correlation idempotency, unsigned/replayed rejection → *test/mgmt-session.test.mjs* · done-when: pass. [T1]
- **T4.2.6** Live: worker grappe rejects an unsigned envelope, executes a signed one, result lands in mgmt KV → *T3* · done-when: both observed. [runtime T3]

### Step 4.3 — assembly + verification quorum
- **T4.3.1** Assembler merges result artifacts into the delivery artifact + provenance note (what came from where) → *lib/mgmt-session.mjs + mesh-agent assembler prompt* · done-when: delivery artifact + provenance in KV. [code]
- **T4.3.2** VerifierA/B independent review against intake acceptance criteria (directed input: intake + assembly, NOT each other's review) → *input compilation + mesh-agent verifier prompt* · done-when: two independent reviews stored. [code]
- **T4.3.3** Verify quorum: 5 votes, ≥3 accept → DELIVERED (+ `success` ledger); any reject with <3 → GATED with both reviews attached → *lib/mgmt-session.mjs* · done-when: both paths implemented. [code]
- **T4.3.4** Unit: verify-quorum boundaries, gate payload completeness → *test/mgmt-session.test.mjs* · done-when: pass. [T1]
- **T4.3.5** Live: verifiers' reviews + 5 votes recorded; ≥3 accept → delivered; a scripted verifier-reject → operator gate (kanban + notification) → *T3-M3* · done-when: both observed. [runtime T3]

### Step 4.4 — failure handling
- **T4.4.1** Per-dispatch deadline timers (in-memory + cron-sweep rehydration — the proven pattern) → *lib/mgmt-session.mjs + daemon sweep* · done-when: a missed deadline fires after a daemon restart too. [code]
- **T4.4.2** Reassignment policy: missed deadline or grappe DEGRADED→DEAD → reassign to another registered worker grappe; re-queue with backoff if none; max 2 then GATED → *lib/mgmt-session.mjs* · done-when: policy boundaries (0/1/2/gate) coded. [code]
- **T4.4.3** Coordinator succession: mgmt grappe is 3/5-quorate for role succession — on coordinator death a new coordinator is elected → *FEDERATION_SPEC succession rule + lib/mgmt-session.mjs* · done-when: succession implemented (used by chaos X2). [code]
- **T4.4.4** Every reassignment/succession fires a `warn`/`management` ledgered notification → *openclaw-notify* · done-when: event → popup. [code]
- **T4.4.5** Unit: reassignment boundaries, succession election, late-result-after-reassignment discarded → *test/mgmt-session.test.mjs* · done-when: pass. [T1]
- **T4.4.6** Live: mid-session kill of a worker grappe → mgmt observes timeout, reassigns, task still completes → *T3/T5-X1* · done-when: observed + notification. [runtime T5]

### Step 4.5 — end-to-end proof
- **T4.5.1** Choose a real 2-subtask complex task with the operator; subtasks shaped for two different modes → *AskUserQuestion* · done-when: task brief written. [visual]
- **T4.5.2** Form two worker grappes (e.g. wg-alpha adversarial, wg-bravo collaborative) → *openclaw-grappe form ×2* · done-when: both LIVE in registry. [runtime]
- **T4.5.3** Run the full lifecycle intake→quorum decomp→signed dispatch→assembly→quorum accept→delivered → *live run* · done-when: every state transition present in KV. [runtime T3]
- **T4.5.4** Inject one mid-run worker-grappe kill; confirm reassignment absorbs it → *T5* · done-when: task still delivered. [runtime T5]
- **T4.5.5** Operator reviews the assembled artifact → *visual* · done-when: operator confirms. [visual T7]

### Step 4.6 — PHASE-2 GATE (manager-cluster operational testing)
- **T4.6.1** Land fleet join-by-token (6.1): a clean spawned tree + install-rendered config joins wg-bravo via token → *install.sh federation profile + grappe join* · done-when: the new member appears in `openclaw-grappe status`. [runtime 6.1]
- **T4.6.2** Land the MC management view (sessions, votes, gates actionable) → *mission-control/src/app/federation* · done-when: page + API 200 with real session data; a gate approvable from the browser. [runtime/visual 6.2]
- **T4.6.3** Land `fed.mgmt.*` probes + `management` notification source → *lib/node-watch.mjs, openclaw-notify* · done-when: probes grade the mgmt grappe; a mgmt gate fires a popup. [runtime 6.3]
- **T4.6.4** Run + record T2 integration paths (happy/revision/gated/verifier-reject/duplicate-result/late-after-reassignment) → *NEW test/mgmt-integration.test.mjs (ephemeral NATS, scripted worker grappes)* · done-when: all pass. [T2]
- **T4.6.5** Run + record T3 cells M1–M4 → *live runs* · done-when: observed. [T3]
- **T4.6.6** Run + record chaos X1–X6 (worker kill/reassign, coordinator succession, forged + replayed envelope, mgmt restart mid-vote, NATS follower kill during dispatch) → *T5* · done-when: all observed. [T5]
- **T4.6.7** ≥24h soak: complex task every 2h mixed modes, one scheduled injection midway → *feeder script* · done-when: every task terminal, reassignment counter matches injections, ledger tells the story. [T6]
- **T4.6.8** T7 acceptance: operator exercises a real MC gate approval; RAM budget for 8 nodes recorded sustainable (or fallback logged); sign the checklist → *visual* · done-when: Phase-2 checklist signed. [T7]
