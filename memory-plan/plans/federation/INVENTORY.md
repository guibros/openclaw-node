# federation — Step Inventory

Node federation: worker grappes (adversarial/cooperative/collaborative) → management grappe (5) → savant grappe.
Blocks per [ROADMAP.md](ROADMAP.md); the paper is docs/circling-strategy-implementationV3.md.

**One step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit**
(PROTOCOL §3). Done-evidence is runtime-observable (MASTER_PLAN §5), never just tests-green.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred (deliberate; never a next step, never blocks completion).
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — five columns, one row per step.

---

## Block 0 — Spec + ground truth

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [x] | Root-cause the 2026-07-03 mesh unit crash-loops (diagnosis only, no fixes) — closed 2026-07-09: single root cause (stale `~/openclaw/` exec path), all class-C, triage = D5 |
| 0 | 0.2 | v0.2 | [x] | FEDERATION_SPEC.md — grappe model, three modes, envelopes, layer contracts — closed 2026-07-10: 509 lines, 3 mode flows, 3 envelope schemas, 23 file:line cross-refs |

> **0.1 — Goal:** name the exact reason every dead/zombie unit stopped — the 11 user-domain `.disabled` plists AND the system-domain `com.openclaw.agent` (loaded, spawn-scheduled, workdir absent — D4) — before anything is revived.
> **Needs:** the `.disabled` plists in ~/Library/LaunchAgents; `launchctl print system/com.openclaw.agent` + /Library/LaunchDaemons; historical launchd logs / `log show`; bin/mesh-*.js sources.
> **Feeds:** the DECISIONS crash-loop triage entry (revive-vs-fix choice; appended at 0.1 close — "D2" is already taken); step 1.2's revival is blocked on this diagnosis.
> **Verify:** `code:` the DECISIONS triage entry cites the failing log excerpt + file:line of the fault path per unit (or "cause: NATS absent" with the connect-fail excerpt), covering both launchd domains.

> **0.2 — Goal:** the federation contract exists as one spec document generalizing the circling paper to all three layers.
> **Needs:** docs/circling-strategy-implementationV3.md; the operator's mode definitions (ROADMAP); COMPONENT_REGISTRY probed baseline.
> **Feeds:** every subsequent step's Phase-1 design; the savant change-set format (5.2) is defined here.
> **Verify:** `code:` docs/FEDERATION_SPEC.md exists; grep finds the three mode flow-diagrams, task/result envelope schemas, and ≥10 file:line cross-references into the existing stack.

## Block 1 — Substrate

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | NATS cluster configs hardened (loopback+token) + manifest/install wired + R=3 proven on scratch ports (non-destructive; live :4222 untouched) — absorbs redesign 7.1 [D] — closed 2026-07-10: loopback+token in all 3 confs, 3 plists in launchd/, manifest wired, install renders token+confs; scratch proof 10/10 PASS |
| 1 | 1.2 | v1.2 | [ ] | 3 spawned logical nodes heartbeating through the bus (mesh daemons revived per the 0.1 triage) |
| 1 | 1.3 | v1.3 | [ ] | Grappe manifest schema + KV registry + `openclaw-grappe` CLI (form/status/dissolve) |
| 1 | 1.4 | v1.4 | [ ] | Signed grappe membership — join tokens verified, unsigned join rejected |
| 1 | 1.5 | v1.5 | [ ] | ⛔ OPERATOR-GATED cutover: migrate live single-node :4222 → hardened R=3 cluster, zero data loss, retire single-node (D6) |

> **1.1 — Goal:** the 3-node cluster configs are hardened (loopback-bind + token-auth, D2), wired into the service manifest + install render path, and proven to form R=3 with quorum on a **scratch port-set that never touches the live :4222 bus** (the cutover is the separate gated step 1.5 — D6).
> **Needs:** the pre-existing `services/nats/nats-{1,2,3}.conf` + `ai.openclaw.nats-{1,2,3}.plist` (probed present 2026-07-06); nats-server binary; `OPENCLAW_NATS_TOKEN` (install.sh provisions it; clients already resolve+send it via lib/nats-resolve.js — gap is server-side only); a free scratch port-set (e.g. 4322-4324/6322-6324/8322-8324) for the non-destructive proof.
> **Feeds:** 1.5 cutover reuses the hardened configs on the real ports; the token+loopback hardening is the trust floor 1.4/4.2 signatures stand on.
> **Verify:** `code:` no `0.0.0.0` listener in any config; `authorization { token }` present in all three; three units in service-manifest role `both` + install renders them. `runtime:` a **scratch** 3-node cluster on the alt ports reports cluster.name + a test stream at R=3 (3 replicas) + quorum survival (kill one → still writable 2/3) + token refused-without/accepted-with — then torn down, with live :4222 confirmed still up (PID + msg-count unchanged). NO live-bus mutation this step.

> **1.2 — Goal:** three isolated logical nodes (spawn-node.mjs trees) run mesh agents heartbeating through the NATS bus on :4222.
> **Needs:** a running NATS on :4222 (the existing single-node bus pre-cutover — it has JetStream; or the R=3 cluster once 1.5 lands — either works); bin/spawn-node.mjs; the 0.1 triage (crash-loop cause fixed or avoided); bin/mesh-agent.js + mesh-health-publisher. **NOTE (chain-safety):** this step STARTS live daemons — reversible via unit stop, but it changes running state; kept chain-able (unlike 1.5).
> **Feeds:** 1.3 registry entries; Block 2 sessions run on these nodes.
> **Verify:** `runtime:` `mesh.health` (or equivalent) shows 3 distinct node-ids with fresh heartbeats < 60s old, observed for 10+ min without a crash-loop (launchctl/ps stable).

> **1.3 — Goal:** grappes exist as first-class registry objects with a CLI.
> **Needs:** 1.2 live nodes; JetStream KV; grappe schema locked in FEDERATION_SPEC (0.2).
> **Feeds:** management dispatch (4.2) addresses grappes by registry id; MC page (6.2) lists them.
> **Verify:** `runtime:` `openclaw-grappe form --id wg-alpha --mode adversarial --members alpha,bravo,charlie` writes the KV manifest; `openclaw-grappe status` renders the grappe with 3 live members.

> **1.4 — Goal:** grappe membership is cryptographically gated.
> **Needs:** 1.3 registry; lib/deploy-trigger-auth.mjs signature pattern; bin/mesh-join-token.js.
> **Feeds:** 4.2 signed task envelopes reuse the same verification; savant change-set signing (5.3).
> **Verify:** `runtime:` a join with a valid token lands in the manifest; a forged/unsigned join is rejected with a logged reason — both observed.

> **1.5 — Goal:** ⛔ **OPERATOR-GATED.** The live single-node bus (:4222 — production JetStream: local-events-daedalus 14k+ msgs + MESH_*/grappe-registry KV) is migrated onto the hardened R=3 cluster with zero data loss, and the single-node unit retired — the one production migration, done deliberately with the operator.
> **Needs:** 1.1 (hardened configs proven on scratch ports); a backup/restore migration run **with the operator present**; the operator's explicit go. **This step is HARD-GATED — a headless tick MUST BLOCK here** (D6 / the 2026-07-09 interlock finding: a capable tick otherwise designs and executes the migration unattended).
> **Feeds:** R=3 resilience for every downstream grappe; retires the last single-node dependency; 1.2's agents reconnect to the same :4222 endpoint post-cutover.
> **Verify:** `visual:` the OPERATOR confirms the cutover end-to-end — `nats stream backup` every stream + KV → cluster up on real ports (4222-4224) → restore → message counts match the pre-migration baseline → clients reconnected → single-node unit retired (§4.6). The `visual:` modality **forces a headless BLOCK**; the chain cannot self-close this step.

## Block 2 — Worker mode A: adversarial (circling revival)

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | Live end-to-end circling session on the grappe with a mock LLM |
| 2 | 2.2 | v2.2 | [ ] | Paper gap 14.1 — adaptive convergence (unanimous converged ⇒ early finalization) |
| 2 | 2.3 | v2.3 | [ ] | Paper gap 14.2 — parse-failure retry ×3 before degradation |
| 2 | 2.4 | v2.4 | [ ] | First real adversarial run: small production task via qwen3:8b to a converged vote |
| 2 | 2.5 | v2.5 | [D] | Paper gap 14.3 — reviewer Step-2 dual output (deferred: +20% token cost, v2 enhancement) |
| 2 | 2.6 | v2.6 | [ ] | PREMISE BENCHMARK: adversarial grappe vs solo node, blind operator comparison (does circling actually help?) |

> **2.1 — Goal:** the paper's full session lifecycle is observed live (the 93 circling-family unit tests never ran one).
> **Needs:** Block 1 substrate; lib/mesh-collab.js + bin/mesh-task-daemon.js + bin/mesh-agent.js + bin/mesh-bridge.js; a mock-LLM mode for mesh-agent (env or flag; check what tests use).
> **Feeds:** 2.2-2.4 build on a proven baseline; cooperative/collaborative (Block 3) inherit the machinery.
> **Verify:** `runtime:` one session from `mesh.collab.create` to COMPLETE: 3 roles assigned, ≥1 full sub-round (both barriers held 3/3), finalization votes recorded, artifacts readable in KV; kanban trail visible.

> **2.2 — Goal:** a session that converges early finalizes early instead of burning remaining sub-rounds.
> **Needs:** 2.1 baseline; lib/mesh-collab.js advanceCirclingStep (paper §14.1).
> **Feeds:** token budget on consumer hardware (ROADMAP constraint 3); 2.4 uses it live.
> **Verify:** `code:` new unit tests (unanimous converged after step 2 ⇒ finalization) · `runtime:` a mock session scripted to converge in SR1 observed finalizing after SR1.

> **2.3 — Goal:** a node whose output fails parsing is retried up to 3× before being degraded.
> **Needs:** 2.1 baseline; daemon reflect handler + failure tracking (paper §14.2).
> **Feeds:** real-LLM reliability for 2.4 (local models fail delimiters more than cloud ones).
> **Verify:** `code:` unit test: 2 failures then success ⇒ barrier satisfied, no degradation; 3 failures ⇒ degraded + CRITICAL log · `runtime:` mock session with an injected double-failure observed completing.

> **2.4 — Goal:** the first production adversarial grappe run completes on the local LLM.
> **Needs:** 2.1-2.3; ollama with LLM_MODEL (qwen3:8b); a real small task chosen with the operator; an idle-enough window (single GPU).
> **Feeds:** Block 4 dispatches to this proven mode; DECISIONS records observed round timings/token cost as the planning baseline.
> **Verify:** `runtime:` session COMPLETE with a converged vote on real LLM output; artifacts non-trivial (operator spot-check `visual:`); wall-clock + per-step timings recorded in the audit.

> **2.6 — Goal:** prove the premise — a circled artifact is observably better than one node alone, or BLOCK the plan here (DECISIONS D3).
> **Needs:** 2.4 (real adversarial runs work); a solo-node baseline path (single agent, same task, same model); ≥5 real tasks chosen with the operator; a blind-comparison protocol.
> **Feeds:** the Phase-1 gate (3.5 Needs this verdict); the go/no-go on Phases 2–3. A fail is a plan-level BLOCK, not a step failure.
> **Verify:** `visual:` operator blind-scores grappe-vs-solo output on ≥5 tasks (which is which hidden); `runtime:` the grappe wins a clear majority on a pre-agreed quality rubric — else write BLOCKED.md citing the premise miss. Also record the GPU-cost delta (D3: ~35 GPU-min/grappe-session vs ~2min solo) so the quality gain is weighed against the cost.

## Block 3 — Worker modes B + C

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | `architecture` field on collab sessions + daemon dispatch by mode (adversarial default) |
| 3 | 3.2 | v3.2 | [ ] | Cooperative protocol: propose-all / integrate-one / rotate-integrator rounds, live run |
| 3 | 3.3 | v3.3 | [ ] | Collaborative protocol: decompose → per-node subtasks → parallel work → merge + merge-review, live run |
| 3 | 3.4 | v3.4 | [ ] | Mode-selection guidance in FEDERATION_SPEC + task-envelope `preferred_mode` honored |
| 3 | 3.5 | v3.5 | [ ] | PHASE-1 GATE: worker-cluster operational testing program (T3 matrix, 8-cell chaos, ≥12h soak, T7 acceptance) |

> **3.1 — Goal:** one session schema carries all three architectures without forking the stack (§4.6).
> **Needs:** 2.1 proven baseline; lib/mesh-collab.js session schema (`circling` field precedent); FEDERATION_SPEC mode flows.
> **Feeds:** 3.2/3.3 implement against the dispatch seam; management (4.2) sets the field.
> **Verify:** `code:` schema + dispatch unit tests (unknown mode rejected; adversarial default preserved — the existing circling suites, 93 tests, still green) · `runtime:` a created session shows `architecture` in KV.

> **3.2 — Goal:** three nodes co-author one artifact with a rotating integrator, live.
> **Needs:** 3.1 seam; circling barrier machinery; integrator-rotation state (who integrates round N).
> **Feeds:** management mode choice for exploratory tasks (3.4, 4.2).
> **Verify:** `runtime:` mock-LLM cooperative session: 3 rounds observed, integrator differs each round (KV state), final artifact assembled from all three nodes' proposals; barriers 3/3 each round.

> **3.3 — Goal:** a task splits into per-node subtasks executed in parallel and merged, live.
> **Needs:** 3.1 seam; `mesh.plans.*` subtask machinery (create/subtask.update); a merge step + merge-review step in the session flow.
> **Feeds:** management decomposition (4.1) maps naturally onto this mode for decomposable work.
> **Verify:** `runtime:` mock-LLM collaborative session: 3 subtasks assigned to 3 distinct node-ids, worked concurrently (overlapping timestamps), merge artifact produced, merge-review vote recorded.

> **3.4 — Goal:** mode choice is a contract, not folklore — the spec says which task shapes get which mode and the envelope carries it.
> **Needs:** 3.1-3.3 all three modes live; FEDERATION_SPEC (0.2).
> **Feeds:** management decomposer (4.1) applies the guidance mechanically.
> **Verify:** `code:` spec section exists with the decision table; envelope schema has `preferred_mode`; dispatch honors it (unit test) · `runtime:` a session created with each of the three values lands in the matching protocol.

> **3.5 — Goal:** the worker cluster is operationally PROVEN — Phase 1 closes only through this gate (IMPLEMENTATION_PHASES §1.C).
> **Needs:** steps 0.1–3.4 closed; **the 2.6 premise-benchmark verdict PASSED** (a failed benchmark BLOCKs the plan before this gate — D3); CI census (Block 6 slice) landed; fed.* worker probes + `grappe` notification source live; a soak feeder script.
> **Feeds:** Phase 2 entry (step 4.1's Needs cites this checklist); management planning constants (timings from the matrix).
> **Verify:** `runtime:` all 6 T3 cells + all 8 chaos cells observed with KV/ledger evidence; ≥12h soak report clean (0 hung sessions, 0 crash-loops, flat memory); CI green incl. federation census · `visual:` operator watches one live session end-to-end and signs the T7 checklist in AUDIT_POST.

## Block 4 — Management grappe (5 nodes)

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | Management session type: intake → decomposition proposal → 3/5 quorum approval |
| 4 | 4.2 | v4.2 | [ ] | Signed dispatch to worker grappes + result envelopes back (defer-to-management flow) |
| 4 | 4.3 | v4.3 | [ ] | Assembly + verification: 2 verifier roles review, 3/5 quorum accepts, operator gate on reject |
| 4 | 4.4 | v4.4 | [ ] | Failure handling: worker-grappe timeout/death ⇒ reassignment, observed with injected failure |
| 4 | 4.5 | v4.5 | [ ] | End-to-end: 2-subtask complex task through the full management lifecycle, live |
| 4 | 4.6 | v4.6 | [ ] | PHASE-2 GATE: manager-cluster operational testing program (quorum/chaos matrix, ≥24h soak, fleet join, T7 acceptance) |

> **4.1 — Goal:** a 5-node management grappe accepts a complex task and quorum-approves a decomposition.
> **Needs:** Block 1 substrate (a second grappe of 5 logical nodes); stored role identities pattern (paper); decomposition schema in FEDERATION_SPEC.
> **Feeds:** 4.2 dispatches the approved decomposition; MC page (6.2) shows the vote.
> **Verify:** `runtime:` intake of a seeded task produces a decomposition proposal + 5 votes in KV with ≥3 approvals before state advances; a scripted 2/5 approval observed NOT advancing.

> **4.2 — Goal:** approved subtasks reach worker grappes as signed envelopes and results flow back.
> **Needs:** 4.1; 1.4 signing; grappe registry (1.3) for addressing; worker modes live (Blocks 2-3).
> **Feeds:** 4.3 assembly consumes result envelopes; the operator's "defer their result to a management grappe" contract.
> **Verify:** `runtime:` a worker grappe observed rejecting an unsigned envelope and executing a signed one; result envelope lands in the management session KV referencing the worker session id.

> **4.3 — Goal:** assembled results pass adversarial verification and quorum before delivery.
> **Needs:** 4.2 results; assembler + verifier roles; gate machinery (mesh-bridge tier-gate precedent).
> **Feeds:** the delivered artifact (operator-visible); savant telemetry (5.1) reads accept/reject outcomes.
> **Verify:** `runtime:` verifiers' reviews + 5 votes recorded; ≥3 accept ⇒ delivered state; a scripted verifier reject ⇒ operator gate raised (kanban + ledgered notification), observed both paths.

> **4.4 — Goal:** a dying worker grappe never silently kills a complex task.
> **Needs:** 4.2 dispatch; heartbeats (1.2); reassignment policy in spec (retry same grappe vs next grappe).
> **Feeds:** 4.5 end-to-end resilience; node-watch fed.* probes (6.3) surface the event.
> **Verify:** `runtime:` mid-session kill of a worker grappe's nodes ⇒ management observes timeout, reassigns the subtask to another grappe, task still completes; the failure fires a ledgered notification.

> **4.5 — Goal:** the operator's full L2 contract observed once, end to end.
> **Needs:** 4.1-4.4; two worker grappes formed; a real 2-subtask task chosen with the operator.
> **Feeds:** Block 5 (this run's telemetry is the savant's first meal); DECISIONS records timings.
> **Verify:** `runtime:` one complex task: intake → quorum decomposition → signed dispatch to 2 grappes (different modes) → assembly → quorum accept → delivered; every state transition present in KV; `visual:` operator reviews the assembled artifact.

> **4.6 — Goal:** the manager cluster is operationally PROVEN — Phase 2 closes only through this gate (IMPLEMENTATION_PHASES §2.B).
> **Needs:** 3.5 Phase-1 gate closed; steps 4.1–4.5 closed; fleet join-by-token (6.1 slice) + MC management view + fed.mgmt.* probes landed; RAM budget for 8 logical nodes measured.
> **Feeds:** Phase 3 entry (step 5.1's Needs cites this checklist); savant telemetry richness.
> **Verify:** `runtime:` T3 cells M1–M4 + chaos cells X1–X6 observed (incl. coordinator succession + reassignment); ≥24h mixed-mode soak clean with one scheduled injection absorbed; a clean spawned tree joined a grappe by token · `visual:` operator exercises an MC gate approval for real and signs the T7 checklist.

## Block 5 — Savant grappe

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | Telemetry substrate: federation-wide feed (watch snapshots, ledger, session outcomes, digests) |
| 5 | 5.2 | v5.2 | [ ] | Change-set artifact: savant adversarial session producing {level, rationale, edit, evidence} |
| 5 | 5.3 | v5.3 | [ ] | Proposal pipeline: signed change-set → notification + PROPOSED OUT_OF_SCOPE entry → operator gate |
| 5 | 5.4 | v5.4 | [ ] | First savant cycle over ≥7 days of real telemetry: ≥1 gated change-set per level, zero auto-applies |
| 5 | 5.5 | v5.5 | [ ] | PHASE-3 GATE: savant-cluster operational testing program (gate-security chaos, 7-day soak, closed improvement loop, T7) |

> **5.1 — Goal:** the savant sees the whole system through one queryable feed.
> **Needs:** node-watch JSON snapshots; notifications ledger; session KV; tick digests; a collector (JetStream consumer or periodic scrape — decide in Phase 1, log in DECISIONS).
> **Feeds:** 5.2 sessions read this feed as their task input.
> **Verify:** `runtime:` feed query returns entries from ≥4 source types with federation-wide node coverage; freshness ≤ one collection interval, observed.

> **5.2 — Goal:** a savant grappe (3 nodes, adversarial protocol) produces a schema-valid change-set as its work artifact.
> **Needs:** 5.1 feed; Block 2 adversarial machinery; change-set schema in FEDERATION_SPEC (0.2).
> **Feeds:** 5.3 pipeline; the operator's "concrete edits implementable on the different levels" contract.
> **Verify:** `runtime:` one savant session over seeded telemetry yields a change-set that validates against the schema AND names a concrete edit (patch hunk or scope-addendum text) with expected evidence; reviewers' critiques recorded.

> **5.3 — Goal:** change-sets reach the operator through the workplan protocol — never the codebase directly.
> **Needs:** 5.2 artifacts; 1.4 signing; OUT_OF_SCOPE always-writeable convention; openclaw-notify.
> **Feeds:** operator decision loop; approved edits enter normal SCOPE/commit discipline.
> **Verify:** `runtime:` a change-set lands as a ledgered notification (click-through to MC) + a PROPOSED entry in the target plan's OUT_OF_SCOPE.md with valid signature; `code:` no apply path exists that skips the gate (grep + test asserting the pipeline has no write access outside OUT_OF_SCOPE).

> **5.4 — Goal:** the savant layer proves useful on reality, not seeds.
> **Needs:** 5.1-5.3; ≥7 days of real federation telemetry (Blocks 2-4 running in the interim).
> **Feeds:** the operator's improvement loop; plan-done criterion (ROADMAP).
> **Verify:** `runtime:` ≥1 change-set per level (substrate/worker/management/policy) reached the gate; audit lists each with the operator's verdict; zero write events outside the gate path, checked.

> **5.5 — Goal:** the savant cluster is operationally PROVEN and the whole plan closes — Phase 3's gate (IMPLEMENTATION_PHASES §3.B).
> **Needs:** 4.6 Phase-2 gate closed; steps 5.1–5.4 closed; fed.savant.* probes + MC change-set review view landed.
> **Feeds:** plan-done (ROADMAP); the standing self-improvement loop the operator keeps.
> **Verify:** `runtime:` gate-security cells G1–G5 observed (write-jail throw, unsigned/tampered refusal, self-referential flag, rate limit); 7-day soak: all emissions schema-valid + cited + gated, zero writes outside OUT_OF_SCOPE (fs-audit) · `visual:` operator confirms one approved change-set was implemented through normal scope discipline and its expected_evidence probe observed true — the closed loop.

## Block 6 — Ops: fleet, surfaces, watch

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | install.sh federation profile: fresh node can join a grappe by token |
| 6 | 6.2 | v6.2 | [ ] | MC federation page: grappes, sessions, rounds, votes, gates — live views |
| 6 | 6.3 | v6.3 | [ ] | node-watch `fed.*` probe family + grappe/management/savant notification sources |
| 6 | 6.4 | v6.4 | [ ] | Federation test census in CI (nats-binary-gated) + NODE_ACCEPTANCE federation axis |

> **6.1 — Goal:** federation is deployable, not hand-built: a fresh install can join an existing grappe — and the legacy fleet path is retired (D4: no `npx openclaw-mesh` delegation, no `openclaw.*` exec channel, no com.openclaw.agent).
> **Needs:** Blocks 1-4 stable interfaces; install.sh service machinery; join tokens (1.4); D4.
> **Feeds:** the fleet story (MULTI_NODE_DEPLOY.md updated); operator adds real machines later; 7.4 [D] absorbs the prototype's capabilities when multi-machine un-defers.
> **Verify:** `runtime:` a clean spawned tree + install-rendered config joins grappe wg-alpha via token and appears in `openclaw-grappe status` as a live member; `code:` install.sh carries no npx openclaw-mesh path; a fresh install produces no com.openclaw.agent unit and no `openclaw.*` exec subscriber.

> **6.2 — Goal:** the operator can watch federation happen without reading KV by hand.
> **Needs:** session/registry KV shapes stable (Blocks 1-5); MC conventions (node-watch page precedent).
> **Feeds:** gates resolved from a browser; savant change-sets reviewed on-screen.
> **Verify:** `visual:` operator confirms a live session's rounds/votes render and a gate can be approved from the page · `runtime:` page + API 200 with real session data.

> **6.3 — Goal:** federation health is honest and its events reach the desktop.
> **Needs:** NODE_WATCH_SPEC honesty rules; openclaw-notify sources; probes for cluster quorum, grappe heartbeats, session liveness.
> **Feeds:** the same watch/notify loop every other subsystem lives in.
> **Verify:** `runtime:` `node-watch --axis federation` grades the live system (UNKNOWN where unobservable, never green); a killed grappe member flips a probe and fires a ledgered popup, observed.

> **6.4 — Goal:** federation code is CI-guarded on runners with no NATS, honestly.
> **Needs:** census pattern (test/mesh-skip-census precedent); federation test suites from Blocks 1-5.
> **Feeds:** the repo's green-CI deployability contract.
> **Verify:** `code:` CI run: nats absent ⇒ visible census skip with filenames; nats present ⇒ suites run; `runtime:` one observed green CI including the federation census.

## Block 7 — DEFERRED

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [D] | (DEFERRED) WAN/multi-site federation beyond the Tailscale mesh |
| 7 | 7.2 | v7.2 | [D] | (DEFERRED) Heterogeneous LLM-per-role assignment (e.g. reviewer on a bigger model) |
| 7 | 7.3 | v7.3 | [D] | (DEFERRED) Cross-grappe memory federation (redesign Block 7 broadcast/offer/accept content) |
| 7 | 7.4 | v7.4 | [D] | (DEFERRED) Fleet ops absorbed from the openclaw-mesh prototype — file distribution, capture, infra self-repair — under authenticated `mesh.*` (D4) |

> **7.4 — Goal:** the prototype's genuinely useful fleet capabilities re-enter under the authenticated namespace when real multi-machine work un-defers (with 7.1).
> **Needs:** 7.1 WAN/Tailscale substrate; D4 retirement done (6.1); signed envelopes (1.4/4.2) as the transport contract.
> **Feeds:** the multi-machine operator story (capture / file distribution / infra repair across real nodes).
> **Verify:** `runtime:` each absorbed capability observed working under `mesh.*` with a signed envelope; no `openclaw.*` subject in use anywhere.
