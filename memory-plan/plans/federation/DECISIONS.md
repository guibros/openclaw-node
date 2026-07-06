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
