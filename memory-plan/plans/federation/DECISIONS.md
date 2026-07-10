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
