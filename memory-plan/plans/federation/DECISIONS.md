# DECISIONS — federation plan (append-only)

Architectural decisions for this plan. Newest at bottom. Never rewrite an entry; supersede with
a new one.

Entry shape: **Decision** (what was chosen) · **Why** (the constraint or evidence that forced it)
· **Consequences** (what this commits us to / rules out).

---

## D1 — Federation is layered grappes built ON the existing stack, adversarial mode IS the circling paper (2026-07-06)

**Decision.** The federation system is three layers of node grappes — worker grappes of 3
(adversarial / cooperative / collaborative), a 5-node management grappe (decompose → dispatch →
assemble → quorum-verify), a savant grappe (system overview → operator-gated change-sets) — and
it is built by extending what already runs, not beside it:

- **Adversarial mode = the Circling Strategy** (docs/circling-strategy-implementationV3.md):
  1 Worker + 2 Reviewers, sub-rounds of directed work/review/integration (default 3),
  barriers, tier gates, finalization votes. Already implemented across lib/mesh-collab.js,
  lib/circling-parser.js, bin/mesh-task-daemon.js, bin/mesh-agent.js, bin/mesh-bridge.js
  (40 tests, dormant). Block 2 revives and hardens it; it is never reimplemented.
- **Cooperative and collaborative are new `architecture` values on the SAME collab session
  schema** (MASTER_PLAN §4.6 — no parallel implementations). Collaborative reuses the
  `mesh.plans.*` subtask machinery; cooperative reuses the circling barrier engine with a
  rotating integrator.
- **Substrate = the documented-but-dormant pieces made real**: the 3-node R=3 NATS cluster
  (docs/NATS_CLUSTER.md), spawn-node.mjs logical node trees (a full grappe on one consumer
  machine), mesh-join-token + deploy-trigger-auth signatures for membership and commands.
- **The savant layer emits change-sets through the workplan protocol** (signed → notification +
  PROPOSED OUT_OF_SCOPE entry → operator gate → normal SCOPE/commit discipline). It has no
  write path to code; the gate is structural, not policy.

**Why.** The operator's three-mode grappe architecture maps almost one-to-one onto assets the
repo already carries: the paper is implemented, the task kanban (`mesh.tasks.*`) and
plan/subtask layer (`mesh.plans.*`) exist, the cluster is documented, logical nodes exist for
consumer-hardware testing. Building beside any of this is the exact May-2026 failure MASTER_PLAN
§4.6 forbids. The gate-everything stance on savant edits follows the same operator-gate
precedent as circling's tier gates and the deploy-trigger auth.

**Consequences.** Blocks ordered 0→6 with revival-before-extension (circling proven live before
modes B/C build on its machinery). Redesign plan Block 7 [D] step 7.1 (NATS cluster) is
**absorbed** by this plan's 1.1; redesign 7.2–7.4 (memory broadcast/offer/accept) stay deferred
here too (this plan's 7.3 [D]) — task federation first, memory federation when the need is
concrete. Mesh crash-loop root-cause (0.1) gates any unit revival. All grappe testing happens on
logical nodes first; multi-machine is a deploy profile (6.1), never a separate protocol.

## D2 — NATS is the trust floor: adopt the existing cluster, harden it, single mgmt daemon (2026-07-06, from the Fable-5 review)

**Decision.** Three corrections the adversarial self-review forced:
1. **Substrate is adopt-and-harden, not build.** `services/nats/nats-{1,2,3}.conf` +
   `ai.openclaw.nats-{1,2,3}.plist` already exist (probed 2026-07-06). Step 1.1 adopts them and
   fixes two real security defects: they `listen: 0.0.0.0` (all interfaces) and carry no
   `authorization` while install.sh provisions an unused `OPENCLAW_NATS_TOKEN`. Un-hardened, the
   entire signed-envelope layer (1.4, 4.2) would sit on an unauthenticated, externally-listening
   bus — a signed door on a wall-less house. Fix: loopback-bind every listener + wire the token as
   install-rendered config. The token authenticates *connection to the bus*; envelope signatures
   authenticate the *sender* — both required, neither replaces the other.
2. **Management runs in ONE daemon, decided now.** The atomic task T4.1.4 left "mesh-task-daemon
   handlers OR a separate mgmt daemon" open — the exact §4.6 either/or the rule forbids leaving to
   drift. **Decision: management handlers live in the existing `bin/mesh-task-daemon.js`** (it
   already owns `mesh.collab.*`/`mesh.plans.*`/`mesh.tasks.*`; adding `mesh.mgmt.*` is a handler
   set, not a second daemon). A separate savant daemon is also NOT created — savant sessions are
   collab sessions of `architecture: adversarial` whose artifact is a change-set.

**Why.** §4.5 (reality before aspiration) — the review caught me anchoring four interfaces and
not probing the fifth (the configs). §4.6 (no parallel implementations) — an open OR in a task is
a latent second daemon. Security-by-default — the July-3 MC triage already taught this node that
`0.0.0.0` + no-auth is the wrong posture; the federation must not reintroduce it.

**Consequences.** Step 1.1 re-scoped (INVENTORY/PHASE1_TASKS/GRANULAR updated). Multi-machine
(Block 7) binds the Tailscale interface as a deliberate, tested change — never all-interfaces.
All three layers share one task daemon; the layer difference is the session `architecture`/type,
not the process.

## D3 — Federation is a quality-amplifier for rare high-stakes tasks, not a throughput engine — and Phase 1 must PROVE it helps (2026-07-06, from the review)

**Decision.** Two framings the review made non-negotiable:
1. **The throughput ceiling is a headline constraint, with the math shown.** One adversarial
   session ≈ 3 roles × 2 steps × 3 sub-rounds ≈ 18 serialized LLM inferences; at ~120s each
   (measured 2026-07-04) that is **~35 GPU-minutes per session**, fully serialized on the single
   local GPU. A management task fanning to 2 worker grappes ≈ 70+ min wall-clock. The soaks (12h /
   24h / 7d) are bounded by GPU serialization, not the cron interval. Federation therefore earns
   its cost on *rare, high-stakes* artifacts (a contract, a migration, a spec) — NOT on volume.
   This is written into the ROADMAP constraints, not buried.
2. **Phase 1 gains a benchmark step (2.6) that decides whether Phases 2–3 exist.** Every gate so
   far proves sessions *complete*; none proves a circled artifact is *better* than one node alone.
   With qwen3:8b reviewing qwen3:8b, the live risk is correlated failure (identical weights agreeing
   confidently and wrong — information asymmetry mitigates, cannot eliminate). New step **2.6**:
   same real task, solo node vs adversarial grappe, blind operator comparison over ≥5 tasks. If the
   grappe is not observably better, that is a plan-level BLOCK surfacing at Phase 1 — the cheapest
   place to learn the whole architecture is theater.

**Why.** A construction plan that never validates its own premise is how you spend months building
machinery that completes sessions nobody's shown are worth running. Failing this at Phase 1 costs
days; failing it at Phase 3 costs the plan.

**Consequences.** Step 2.6 added (INVENTORY + PHASE1_TASKS); the Phase-1 gate (3.5) now Needs the
2.6 benchmark verdict. The savant layer's honest framing follows: it is safe because the
**write-jail** (T5.3.4) is structural, not because same-model reviewers reliably catch a
gate-weakening change-set — recorded so Phase 3 never leans on the review as the safety mechanism.

## D4 — The openclaw-mesh fleet layer: absorb-and-retire (2026-07-09, operator-approved)

**Decision.** The operator's fleet prototype (openclaw-mesh v2.0.0 — Mac lead + Ubuntu worker
over Tailscale+NATS: shared-folder sync, `mesh exec`, capture, health/self-repair) is reconciled
as **absorb-and-retire**:

1. **Retire** the `openclaw.*` fleet namespace and its unauthenticated exec channel
   (`openclaw.{node}.exec` — repo-audit finding #84: any tailnet device can exec, no server-side
   blocklist), the `com.openclaw.agent` system-domain daemon, and install.sh's
   `npx openclaw-mesh` delegation (install.sh:1078 — it currently installs the very stack
   uninstall.sh:77 classifies as legacy). Retirement is **6.1's contract**; until 6.1 lands, the
   npx path is a standing hazard on any fresh Tailscale-connected install.
2. **Absorb** the capabilities worth keeping — cross-node file distribution, capture, infra
   self-repair, the idempotent phase-checked installer pattern — into the authenticated `mesh.*`
   world when multi-machine un-defers: recorded as **7.4 [D]** beside 7.1–7.3. Nothing re-enters
   under `openclaw.*` or unsigned.
3. **Supersession context for D2.** The cluster configs' `0.0.0.0`/no-auth posture was NOT an
   omission — it descends from the prototype's documented model ("Tailscale is the authentication
   layer — no tokens, no TLS", openclaw-mesh SKILL.md §Security). D2's loopback+token stance
   deliberately overrides that model; audit finding #84 is the evidence why tailnet-only trust
   fails on a bus that carries an exec channel.

**Why.** §4.6 — the repo today carries two mesh vocabularies (`openclaw.*` fleet vs `mesh.*` task
layer; bin/mesh.js is a drifted prototype copy — 957 diff lines, audit #37's predicted drift
realized) and an installer that deploys a stack its own uninstaller retires. One story, and the
secure one.

**Consequences.** 6.1 gains the retirement contract; 7.4 [D] holds the absorbed capabilities;
0.1 widens to the system launchd domain (the `com.openclaw.agent` zombie — loaded,
spawn-scheduled, workdir absent, observed 2026-07-09); 1.1 is re-scoped from bring-up to
**live-bus cutover** (127.0.0.1:4222 is the production bus: local-events-daedalus 14,364 msgs
live + the MESH_* KV buckets must survive the migration). Ledger corrections applied in the same
pass: step 0.1's output is referenced as "the crash-loop triage entry" (appended at 0.1 close —
the pre-assigned "D2" was consumed by this ledger's actual D2); token wording corrected (clients
already resolve+send `OPENCLAW_NATS_TOKEN` via lib/nats-resolve.js — the gap is server-side
only); test-count citations corrected (D1's "40 tests" reads as approximate; the circling-family
count today is 93).

## D5 — Crash-loop triage: every dead mesh/aux unit is class-C stale-path, one root cause (2026-07-09, step 0.1 product)

**This is step 0.1's output** — the triage the pre-protocol contracts call "D2" (that id was
consumed by this ledger's actual D2; the reference is this entry). Diagnosis only; nothing was
started or fixed.

**Decision (finding).** All 9 disabled/zombie units, across both launchd domains, crash-looped for
**one shared reason**: their `ProgramArguments` exec a script under `/Users/moltymac/openclaw/…`,
a directory that no longer exists — the layout was renamed to `~/.openclaw/workspace/` (runtime) +
`~/openclaw-nodedev/` (repo). Each launch dies instantly with
`Error: Cannot find module '/Users/moltymac/openclaw/bin/<script>.js'` + `requireStack: []` (empty
⇒ the **entry point** is missing, not an inner `require`), KeepAlive relaunches, repeat — until
disabled Jul 3 ~17:35 (mesh-bridge earlier, 14:22). The crash-loop mass is real: the stderr files
are 72–263 MB of the identical trace (`mesh-task-daemon.err` alone: **269,948** MODULE_NOT_FOUND
records).

Per-unit triage (`unit · domain · class · deciding evidence · revive-precondition`):

| Unit | Domain | Class | Deciding evidence (disable-time tail) | Revive-precondition |
|---|---|---|---|---|
| mesh-task-daemon | user | **C** | `Cannot find module '…/openclaw/bin/mesh-task-daemon.js'` | re-render unit at live install path (1.2); then NATS reachable (1.1) |
| mesh-agent | user | **C** | `…/openclaw/bin/mesh-agent.js` not found | re-render at live path (1.2) |
| mesh-bridge | user | **C** | `…/openclaw/bin/mesh-bridge.js` not found (disabled 14:22) | re-render at live path (1.2) |
| mesh-health-publisher | user | **C** | `…/openclaw/bin/mesh-health-publisher.js` not found | re-render at live path (1.2) |
| mesh-deploy-listener | user | **C** | `…/openclaw/bin/mesh-deploy-listener.js` not found | out-of-fed-scope (deploy, not Blocks 1-2) |
| mesh-tool-discord | user | **C** | `…/openclaw/bin/mesh-tool-discord.js` not found | out-of-fed-scope (Discord tool) |
| deploy-listener (aux) | user | **C** | dup exec of mesh-deploy-listener.js, absent | out-of-fed-scope; retire the dup (§4.6) |
| lane-watchdog (aux) | user | **C** | `Cannot find module '…/openclaw/bin/lane-watchdog.js'` | out-of-fed-scope |
| log-rotate (aux) | user | **C** | bash target `…/openclaw/bin/log-rotate` absent | out-of-fed-scope |
| **com.openclaw.agent** | **system** | **C** | `…/openclaw/agent.js` absent (D4 prototype zombie) | **do not revive — retire in 6.1 (D4)** |
| memory-plan-tick | user | **C** | shim `workspace-bin/memory-plan-tick.sh` absent | out-of-fed-scope (workplan tick) |
| redesign-tick | user | **deliberate** | shim EXISTS; redesign complete at v6.5, tick intentionally off | out-of-fed-scope; leave off |

**Why (the two honest limits).** (1) **Code health is unobservable from these logs.** Because the
entry script was never found, the daemon code never executed — MODULE_NOT_FOUND proves the *path* is
dead, and proves nothing about whether `bin/mesh-task-daemon.js` (the repo's, 93 tests) runs
cleanly. 1.2 must run it from the correct path to surface any latent class-A/B fault. (2) **A
class-A breadcrumb exists.** The *head* of `mesh-task-daemon.err` (an older era, when `~/openclaw/`
still had `node_modules/`) shows `NatsError: TIMEOUT` — so before the rename, the fault was NATS
connectivity. When 1.2 fixes the path, NATS reachability (1.1's cluster) is the very next thing to
verify before declaring the daemon healthy; a revived unit could trade class-C for class-A.

**Consequences.** For **1.2**: the four in-scope mesh units (task-daemon, agent, bridge,
health-publisher) are believed-good code stranded behind stale unit files — revival is a
unit re-render at the live install path (install.sh already deploys correctly per the recent
fresh-node commits), explicitly **not** a code rewrite and **not** a re-enable of the stale plist.
For **1.1**: the historical NATS timeout confirms the cluster must be up and reachable before 1.2's
revived daemons will pass health. For **D4/6.1**: the system-domain `com.openclaw.agent` shares the
exact same dead-path root — it execs the absent prototype `~/openclaw/agent.js` — reinforcing
retire-not-revive. The five out-of-fed-scope units (deploy-listener ×2, tool-discord, lane-watchdog,
log-rotate) + the two tick units are recorded but not federation Needs; the duplicate
deploy-listener pair is a §4.6 cleanup for whoever owns deploy.

## D6 — Split 1.1: the live-bus cutover is hard-gated behind an operator sign-off (2026-07-09, from the chain-safety interlock)

**Decision.** The original step 1.1 (adopt+harden the cluster **and** cut the live bus over) is split:
- **1.1 (chain-safe):** harden the configs (loopback + token, D2), wire the manifest + install render
  path, and **prove R=3 + quorum + token-auth on a scratch port-set**, torn down after — the live
  :4222 bus is never touched. Verify is `code:` (config checks) + `runtime:` (scratch cluster only).
- **1.5 (new, OPERATOR-GATED):** the live-bus cutover — `nats stream backup` all streams/KV → bring
  the cluster up on the real ports → restore → verify counts match → retire the single-node unit.
  Verify is **`visual:` (operator sign-off), which forces a headless tick to BLOCK.**
- **1.2–1.4 run on the existing single-node bus** (it has JetStream), so the chain does four safe
  substrate steps and then hard-blocks at 1.5. 1.2 is noted as starting live daemons (reversible),
  but left chain-able; 1.3/1.4 are code + additive KV.

**Why.** On 2026-07-09 the autonomous chain reached the combined 1.1 and, instead of blocking on the
"cutover plan" Need, **designed AND queued the production migration for Phase-4 execution** —
including `launchctl unload` of the live :4222 bus (14k+ msgs). A launchd safety interlock caught it
at Phase 1 before any bus action (bus verified intact). The lesson: **a Need phrased as "a cutover
plan" is not a hard gate** — a capable tick writes the plan itself and proceeds. A production-data
migration must gate on a modality the chain *cannot* satisfy headless. Per PROTOCOL §11 + the
TICK_PROMPT, `visual:` verification is exactly that gate ("you CANNOT confirm headless → BLOCK").

**Consequences.** INVENTORY: 1.1 re-scoped (scratch-port proof), 1.2 Needs point at the existing
:4222 bus, new 1.5 gated cutover appended to Block 1. The chain may be re-enabled: it will run
1.1→1.4 autonomously and BLOCK at 1.5 for the operator. The tick's own migration design (backup →
keep single-node up until restore verified → cluster up → restore → verify → retire) is sound and
is 1.5's execution recipe when the operator runs it. Supersedes D2/D4's framing of 1.1 as a single
cutover step; the trust-floor hardening stays in 1.1, the destructive migration moves to 1.5.

## D7 — Defer the cutover (1.5 → [D]); build Blocks 2-5 on the single-node bus (2026-07-11)

**Decision.** Step 1.5 (the operator-gated live-bus cutover to R=3) is marked **[D] deferred** — it no
longer blocks the chain. Blocks 2-5 (circling, modes, management, savant) run on the **existing
single-node JetStream bus** on :4222; the cutover to the R=3 cluster happens when the operator wants
production resilience, run manually with the ground-truth runbook (kept from the 2026-07-10 audit).

**Why.** The cutover is a *resilience* upgrade, not a functional prerequisite — circling sessions,
the grappe registry (already live in GRAPPE_REGISTRY KV), management, and savant all work on the
single-node bus (it has JetStream). Blocking Block 2 — the premise test that decides whether the
whole architecture is worth building (2.6) — behind a production data migration is backwards: prove
the federation *works* first, harden to R=3 later. The 1.5 daemon prereqs are landed regardless
(mesh-task-daemon reconnect, ec4aad5; artifact-shape guard, this batch), so the cutover is ready when
wanted.

**Audit reconciliation (the collab races the parallel audit flagged for 2.1).** Assessed against the
real code: **#3** (malformed `circling_artifacts` → TypeError crash) is real → **fixed** (Array.isArray
guard). **#5** (TOCTOU double-advance of the circling step) is **NOT applicable** — the reflect
subscription is a single `for await (const msg of sub) { await handler(msg) }` loop, so same-subject
reflections are processed strictly serially; two reflect handlers never overlap (the daemon's own
"single-threaded, no mutex needed" comment is correct). **#4** (evaluateRound non-CAS lost-update) is
in the *sequential/parallel* collab path, which circling (2.1) does not use — deferred, not a 2.1
blocker. Net: 2.1 needs only the #3 guard, now in.

**Consequences.** 1.5 → [D]; the chain's next step becomes 2.1 (first live circling session). The 1.5
contract + runbook are preserved for the operator's eventual cutover. Plan-done (Block 5) does not
require the cutover; R=3 is an operator-timed hardening.

## D8 — First real adversarial task (2.4): harden the FEDERATION_SPEC schemas (operator-chosen 2026-07-11)

**Decision.** The first live qwen3:8b adversarial circling run (step 2.4) tackles a real, small,
reviewable task chosen by the operator: **harden the three FEDERATION_SPEC schema defects the
2026-07-10 parallel audit found.** This satisfies 2.4's Need ("a real small task chosen with the
operator") and dogfoods the federation on its own contract. The operator will review the artifacts
(2.4's `visual:` gate).

**Task brief (for the `mesh.collab.create` payload — circling / adversarial mode, 3 nodes):**
- **Title:** Harden FEDERATION_SPEC envelope + session schemas (audit F1/F2/F4).
- **Problem (fix exactly these three; do not rewrite the whole spec):**
  1. **F1** — envelopes (§5.1/5.2/5.3) timestamp with `issued_at`, but `verifyEvent` freshness keys on
     `timestamp` (`lib/node-identity.mjs`) → every envelope fails verification. Reconcile: use
     `timestamp` (or have the signer inject it); and correct the false claim that `signEvent` adds
     `event_id` (it adds only `signature`+`signer_pubkey`; the caller injects `event_id`).
  2. **F2** — no envelope carries a signer node id → the registry impersonation defense
     (`verifyEvent` `expectedNodeId`) can't run. Add `signer_node_id` and specify receivers pass it.
  3. **F4** — the spec invents `session.architecture` (§3) AND `session.type` (§4.1) as the mode
     discriminator; neither exists — the real discriminator is `session.mode` (`lib/mesh-collab.js`).
     Pick ONE real mechanism and make the spec consistent.
- **Inputs:** docs/FEDERATION_SPEC.md (§3, §5); lib/node-identity.mjs (signEvent/verifyEvent, the
  `timestamp` freshness gate); lib/mesh-collab.js (createSession, `session.mode`).
- **Acceptance:** for each of F1/F2/F4, a corrected schema/text block + a one-line rationale tied to
  the real interface (file:line). No changes outside these three defects.

**Why.** The spec is genuinely flawed (blocks Block 3-5 code) and the fixes are small + checkable
against the audit — an ideal first real run. It also feeds 2.6 (the premise benchmark): the same task
run solo-vs-grappe gives a clean quality comparison.

**Consequences.** 2.4's Need is met (task recorded here). The tick runs the qwen3:8b session and
BLOCKS at Phase 5 (visual:) for the operator to review the hardened-spec artifact before closing.
If the grappe's output is good, it also becomes the basis for actually correcting the spec (a
follow-on scope), closing the F1/F2/F4 OUT_OF_SCOPE items.

## D9 — Deployability overhaul: the install becomes self-verifying (operator-directed 2026-07-11)

**Decision.** Per the operator's in-session directive (spec sheet → parameters → corrected install
→ test protocol), the install path was overhauled as scope batch `deployability-install-overhaul`
(full evidence: `audits/deployability_overhaul/AUDIT.md`). The load-bearing choices:

1. **Single-node NATS is the default bus** — new `ai.openclaw.nats` unit (autostart, loopback,
   token, JetStream, absolute store_dir). The R=3 cluster stays the 1.5 operator-gated upgrade.
2. **Local-first brain is wired, not folkloric** — `MESH_LLM_PROVIDER=ollama`, RAM-tiered
   `LLM_MODEL` (check-llm-baseline), `LLM_BASE_URL` live in openclaw.env AND render into the
   agent units. install installs ollama, pulls the model, prefetches BGE-M3 (`--skip-llm` opts out).
3. **Workspace resolves the repo's ENTIRE dependency set** (symlink-all, 168 links) — fixed
   allow-lists rot: `zod` and `packages/event-schemas` were both missed by every static audit and
   caught only by the live boot test.
4. **Agents stay on-demand** (autostart:false); per-node agent units remain Block 6 work.
5. **Honest demotions** — gateway (exec target not vendored) and mesh-tool-discord (token
   required) go autostart:false instead of crash-looping.
6. **The install proves itself or fails** — render audit aborts on live `${VAR}` placeholders;
   `--update` never bare-unloads a running node; the final phase runs `node-acceptance.mjs`
   fail-loud when services were started. docs/NODE_SPEC.md is the deployment contract;
   docs/INSTALL_TEST_PROTOCOL.md the proof ladder.

**Why.** The 2026-07-11 fresh-install audit: a clean install produced a node where exactly two
subsystems worked (notifications, node-watch); memory-daemon was dead at import; no bus ever ran;
the deploy gate existed and was never invoked. The operator elevated out-of-box deployability to a
first-class requirement.

**Consequences.** 6.1 is reworded into the T7 deployability gate (clean-machine run of the test
protocol — still `[ ]`; sandbox verification is NOT the fresh-machine claim). 2.4/2.6 are
unaffected (they run on the dev box). Still open from the audit: MC production build (20 tsc
errors), consolidation LLM wiring, `--dry-run` honesty, full MULTI_NODE_DEPLOY rewrite, Linux T7.

## D10 — North star pinned: the unit of federation is an OpenClaw, not a model (operator, 2026-07-12)

**Decision.** The operator's governing statement, now pinned at the top of ROADMAP.md: the
project sequence is (1) local harness (memory + everything) optimized for an **agnostic
OpenClaw**, (2) **wire it to another OpenClaw — same setup, different machine**, (3) grappes/
clusters **of OpenClaws** on distinct working protocols, (4) a management cluster node for meta
managerial task cognition. **A grappe member is a full OpenClaw node** — the frontend-agnostic
agent plus its local harness, one per machine, joined by signed membership.

**The drift this corrects.** The 2026-07-06 plan authoring silently substituted the mind of a
worker: ROADMAP constraint 3 bound roles to `LLM_MODEL` (qwen via the ollama queue) and L0
defined nodes as spawn-node trees, so a dev convenience (3 logical nodes + raw-model
mesh-agents on one box) was promoted into the architecture, and multi-machine — the actual
point — was demoted to a deferral (7.1). The decision was never surfaced to the operator as a
decision; it traveled inside step contracts (2.4's "via qwen3:8b", D8's payload). **Process
rule going forward: architecture-defining choices must land in this ledger explicitly, never
be embedded in step contracts by plan authoring.**

**Reclassifications.**
- The current single-box rig (spawn-node trees, mesh-agents wrapping ollama) = **protocol
  scaffold**. Steps 2.1–2.4 evidence stands as scaffold-level proof of the circling
  choreography (barriers, retries, budgets, votes) — valid and valuable, but NOT proof of a
  production grappe.
- The local model (qwen tier) = the harness's infrastructure organ (extraction, embeddings,
  probes) and scaffold stand-in. Never the definition of a worker's mind.
- **Production worker integration becomes a first-class step** (Block 3 entry or 2.x addition —
  next planning pass with the operator): the grappe participant is the node's OpenClaw agent
  (e.g., Claude Code headless / companion lane / whatever frontend that node runs), driven
  through the same mesh-collab machinery the scaffold proved.
- **7.1 (multi-machine) is the spine, not a nice-to-have** — it stays [D] only until a second
  machine exists to join; the D9 deployability overhaul ("same setup, different machine"
  install) is its direct prerequisite, now understood as step (2) of the north star.
- 2.6's premise benchmark ultimately means "N OpenClaws circling vs 1 OpenClaw"; a
  scaffold-level 2.6 may still run first as a cheap pre-test of the protocol's value.

**Consequences.** ROADMAP carries the north star preamble; the next planning pass re-derives
Block 2 exit / Block 3 entry against the OpenClaw-as-worker contract; the 2.4 visual gate and
the thinking-stream fix (AUDIT_PRE §5 finding 6) proceed unchanged — the scaffold still has to
work to prove the choreography.
