# ROADMAP — federation plan

## NORTH STAR (operator, pinned 2026-07-12 — D10; governs every reading of this document)

openclaw-node exists to: **(1)** establish the LOCAL HARNESS — memory + everything a node
needs — optimized locally for an **agnostic OpenClaw** (the node's agent, whatever LLM
frontend drives it); **(2)** **wire that OpenClaw to another OpenClaw — same setup, different
machine**; **(3)** elaborate **grappes/clusters of OpenClaws** on distinct working protocols
(adversarial / cooperative / collaborative); **(4)** build a **management cluster node** above
them for meta managerial task cognition.

**The unit of federation is a full OpenClaw node** — the frontend-agnostic agent PLUS its
local harness — one per machine, joined by signed membership. The single-machine rig
(spawn-node trees + mesh-agents wrapping a raw local model) is a **protocol scaffold** for
cheap choreography proofs, NOT the production worker. The local model (qwen tier) is the
harness's infrastructure organ — extraction, embeddings, probes — never the definition of a
grappe member's mind. Wherever this document binds worker roles to `LLM_MODEL` (constraint 3
below) or equates nodes with spawn-node trees (L0), read those as **scaffold configuration,
not architecture**.

> **HARD REQUIREMENT (D11 — operator, 2026-07-13):** the grappe/cluster project is **NOT to be used
> for anything less than a local OpenClaw driven by an advanced LLM.** A grappe member's mind is an
> **advanced LLM** (Claude / GPT / Kimi / DeepSeek-class), never the local qwen model. qwen is the
> harness's extraction / embedding / probe organ only. The single-box qwen mesh-agent scaffold is
> **retired as a worker**; no capability may be run, benchmarked, deployed, or claimed on a
> sub-OpenClaw worker. Steps 2.1–2.4 proved the choreography mechanism only, never worker quality.

**Goal:** the node federation system — worker **grappes** (bundles of 3 nodes) running three work
architectures, deferring results to a 5-node **management grappe** that decomposes, dispatches and
assembles complex tasks, overseen by a **savant grappe** that observes the whole system and emits
concrete, operator-gated structural edits.
**Created:** 2026-07-06 (operator-directed).

**The paper:** [docs/circling-strategy-implementationV3.md](../../../docs/circling-strategy-implementationV3.md)
— the Circling Strategy: 1 Worker + 2 Reviewers, sub-rounds of directed work → review →
integration (default `max_subrounds: 3`), information asymmetry against groupthink, per-step
barriers, tier gates, finalization votes (`converged | blocked`). It is IMPLEMENTED
(lib/mesh-collab.js, lib/circling-parser.js, mesh-task-daemon orchestration, mesh-agent
execution, mesh-bridge kanban; 93 circling-family tests) and DORMANT (mesh units `.disabled` since the
2026-07-03 crash-loop triage). This plan's adversarial mode is a revival + hardening, not a build.

## The three layers

```
                    ┌─────────────────────────────────────┐
  L3  SAVANT        │ savant grappe (3, adversarial over   │  observes everything (telemetry,
      GRAPPE        │ proposals)                           │  ledgers, session outcomes)
                    └──────────────┬──────────────────────┘  emits CHANGE-SETS: concrete edits
                                   │ operator-gated change-sets targeted at a level; NEVER
                                   ▼ auto-applied
                    ┌─────────────────────────────────────┐
  L2  MANAGEMENT    │ management grappe (5): intake →      │  complex task in; decomposition
      GRAPPE        │ decompose → dispatch → monitor →     │  quorum 3/5; commands worker
                    │ assemble → verify (quorum) → deliver │  grappes; assembles results
                    └──────┬───────────┬───────────┬──────┘
                           │           │           │   signed task envelopes down,
                           ▼           ▼           ▼   result envelopes up
                    ┌──────────┐ ┌──────────┐ ┌──────────┐
  L1  WORKER        │ grappe A │ │ grappe B │ │ grappe C │   each = 3 nodes, one mode:
      GRAPPES       │ adversar.│ │ cooperat.│ │ collab.  │   · adversarial — circling (paper)
                    └──────────┘ └──────────┘ └──────────┘   · cooperative — co-author, rotate
                                                             · collaborative — split subtasks
  L0  SUBSTRATE      NATS 3-node cluster (R=3 JetStream) · grappe registry/manifests (KV) ·
                     signed membership + commands (deploy-trigger-auth pattern) · logical
                     nodes via spawn-node.mjs (a full grappe fits on ONE consumer machine)
```

**Work-architecture semantics (operator definition, 2026-07-06):**
- **adversarial** — 2 nodes critique and review the work of 1 node over the paper's sub-round
  protocol. Best for: high-stakes single artifacts (contracts, migrations, specs).
- **cooperative** — the 3 nodes work together on each task: every round all three propose, one
  integrates, the integrator rotates. Best for: exploratory tasks with no natural single owner.
- **collaborative** — the task is divided into subtasks worked individually, then merged. Best
  for: decomposable work (N files, N documents, N probes). Reuses the `mesh.plans.*` subtask
  machinery.

## Non-negotiable constraints (MASTER_PLAN §3.2 + this plan)

1. **Consumer hardware.** One grappe (3 logical nodes, spawn-node.mjs trees) + the NATS cluster
   must run on a single MacBook/mid-range box. Multi-machine is the same protocol over the
   Tailscale mesh — never a different code path.
2. **Local-first.** A node outside any grappe keeps full single-node function. Federation is
   additive.
3. **A grappe member is a full local OpenClaw with an ADVANCED LLM — never a raw local model (D11, HEADLINE constraint).**
   The unit of federation is the node's OpenClaw agent (a Claude / GPT / Kimi / DeepSeek-class
   frontend) plus its local harness — one per machine. The local model (qwen tier) is the harness's
   extraction / embedding / probe organ **ONLY**; it is **NEVER** a grappe worker, reviewer, or
   manager. **The grappe/cluster protocol MUST NOT be run, benchmarked, deployed, or claimed with
   anything less than a local OpenClaw driven by an advanced LLM.** The single-box qwen mesh-agent
   rig used in 2.1–2.4 was a choreography **scaffold** and is retired as a worker (D11). Budget-
   awareness stays a headline concern, but it is set by each node's advanced LLM (workers run one
   per machine), not by a shared local GPU. Because same-model reviewers can share failure modes,
   **step 2.6 benchmarks a grappe-of-OpenClaws vs a solo OpenClaw and can BLOCK the whole plan at
   Phase 1** if circling doesn't observably beat one node.
4. **No parallel implementations (§4.6).** Adversarial mode = the existing circling stack.
   Cooperative/collaborative extend `mesh-collab.js` sessions with an `architecture` field —
   same state layer, same daemon, same agent runner, same bridge.
5. **Savant edits are proposals.** The savant layer produces change-sets in the workplan
   protocol's own format (scope-addendum proposal + patch); an operator gate stands between
   proposal and apply, always. A savant cannot self-modify the gate.
6. **Honesty invariants carry over.** Every layer's health is node-watch-probed (never WORKING
   without an observed signal); every grappe event worth operator attention rides the
   notification ledger.

## Block 0 — Spec + ground truth (the paper becomes the contract)

- **Intent:** codify FEDERATION_SPEC.md — grappe model, the three modes' message flows, task
  and result envelopes, layer contracts — the circling paper generalized to all three layers.
  Root-cause the 2026-07-03 mesh crash-loops BEFORE any revival (reviving a crash-looper
  without diagnosis is the May-2026 failure pattern).
- **Exit criterion (runtime-observable):** spec exists and cross-references reality
  (file:line); crash-loop cause named in DECISIONS with the failing log excerpt.
- **Unblocks:** every other block.

## Block 1 — Substrate: cluster, logical nodes, grappe identity

- **Intent:** the floor the grappes stand on. 3-node NATS cluster live in local-dev mode
  (absorbs redesign Block 7 step 7.1 [D]); 3 spawned logical nodes heartbeating through it;
  grappe manifest schema + KV registry + `openclaw-grappe` CLI (form/status/dissolve); signed
  membership (mesh-join-token + deploy-trigger-auth signature pattern).
- **Exit criterion:** `openclaw-grappe status` shows one registered worker grappe of 3 live
  logical nodes on this machine, an R=3 stream replicated across the cluster, and an unsigned
  join observed-rejected.
- **Unblocks:** Blocks 2–6.

## Block 2 — Worker mode A: adversarial (circling revival)

- **Intent:** prove the paper live, then land the real thing. The mechanism (barriers, adaptive
  convergence 14.1, parse-retry 14.2) is proven on the mock/qwen **scaffold** (2.1–2.3). **2.4 makes
  the grappe worker the node's full OpenClaw** (advanced-LLM frontend + local harness, D11-guarded)
  and runs the first real adversarial session through it.
- **Exit criterion:** one observed real adversarial session run by **OpenClaw advanced-LLM workers**
  (not the scaffold) — artifacts in KV, kanban trail, barriers held, a converged finalization vote.
  (Paper gap 14.3 reviewer dual-output → deferred [D].)
- **Unblocks:** Block 3 (modes B/C reuse the proven machinery + the OpenClaw-worker contract), Block 4.

## Block 3 — Worker modes B + C: cooperative, collaborative

- **Intent:** the other two operator-defined architectures on the same stack: `architecture`
  field on collab sessions + daemon dispatch by mode. Cooperative = propose-all / integrate-one
  / rotate-integrator rounds. Collaborative = decompose → `mesh.plans` subtasks per node →
  parallel execution → merge + merge-review. Mode-selection guidance added to the spec.
- **Exit criterion:** one observed live session per mode on the same grappe, artifacts + state
  machine per spec.
- **Unblocks:** Block 4 (management chooses among all three modes).

## Block 4 — Management grappe (5 nodes)

- **Intent:** the layer that owns complex tasks. Management session type: intake →
  decomposition (decomposer role proposes, 3/5 quorum approves) → dispatch signed task
  envelopes to worker grappes → monitor (heartbeats, timeouts, reassignment on grappe failure)
  → assemble → verification (2 verifier roles, 3/5 quorum accepts) → deliver or escalate to the
  operator gate. Stored role identities (coordinator, decomposer, assembler, verifier ×2), the
  paper's pattern at N=5.
- **Exit criterion:** observed run — a 2-subtask complex task enters the 5-node management
  grappe (logical), is dispatched to a worker grappe, results assembled, quorum-accepted,
  delivered; one injected worker-grappe failure handled by reassignment.
- **Unblocks:** Block 5 (management outcomes are the savant's richest signal).

## Block 5 — Savant grappe

- **Intent:** the overview layer. Telemetry substrate (node-watch snapshots, notification
  ledger, session KV outcomes, tick digests, across the federation) consumed by a 3-node
  adversarial grappe whose work artifact is a **change-set**: {level: substrate | worker |
  management | policy, rationale, concrete edit (patch or scope-addendum text), expected
  evidence}. Pipeline: change-set → signed → notification + PROPOSED entry in the target
  plan's OUT_OF_SCOPE.md → operator gate → (approved) applied through normal scope/commit
  discipline. Zero auto-apply, structurally.
- **Exit criterion:** savant reviews ≥7 days of real telemetry and emits ≥1 implementable
  change-set per level, each carried end-to-end to the operator gate; zero auto-applies
  observed.
- **Unblocks:** terminal (with Block 6).

## Block 6 — Ops: fleet, surfaces, watch

- **Intent:** make it deployable, visible and honest. install.sh federation profile (grappe
  config rendering, spawned-node units); MC federation page (grappes, sessions, rounds, votes,
  gates); node-watch `fed.*` probe family (cluster quorum, grappe heartbeats, session liveness
  — honest UNKNOWN when unobservable); notification sources `grappe`/`management`/`savant`
  (gates + failures popup with click-through to MC).
- **Exit criterion:** a fresh node install joins a grappe by token; MC shows a live session;
  node-watch grades federation health; a gate fires a ledgered popup.
- **Unblocks:** terminal.

## Block 7 — DEFERRED [D]

WAN/multi-site federation beyond the Tailscale mesh; heterogeneous LLM-per-role assignment;
cross-grappe memory federation (the original redesign Block 7 broadcast/offer/accept content
exchange — revisit once grappes are live and the memory-exchange need is concrete).

## Order & what plan-done means

Execution is grouped into **three operator-set phases**, each ending in an operational gate step
— the full elaboration (deliverable detail, schemas, T1–T7 test tiers, chaos matrices, soak
criteria, acceptance checklists) lives in [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md):

- **Phase 1 — the basic cluster** = Blocks 0–3, gated by step **3.5** (worker-cluster testing
  program). Block-6 slices landed here: CI census, worker probes, `grappe` notifications.
- **Phase 2 — the manager cluster** = Block 4, gated by step **4.6** (manager-cluster testing
  program). Block-6 slices: fleet join-by-token, MC management view, `fed.mgmt.*` probes.
- **Phase 3 — the savant cluster** = Block 5, gated by step **5.5** (savant-cluster testing
  program + gate security). Block-6 slices: savant probes, MC change-set review — Block 6
  fully closes with Phase 3.

Block order within the ledger stays 0 → 1 → 2 → 3 → 4 → 5 → 6. A complex task submitted to the management grappe on this machine is
decomposed, dispatched to worker grappes in the mode the task shape calls for, executed through
observed sessions, assembled, quorum-verified and delivered — while the savant grappe, watching,
produces at least one structural improvement that survives its own adversarial review and the
operator gate. Every arrow runtime-observed, per MASTER_PLAN §5.
