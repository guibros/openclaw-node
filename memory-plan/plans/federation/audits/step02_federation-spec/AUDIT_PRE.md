# AUDIT_PRE — Step 0.2 · FEDERATION_SPEC.md

## §0 Micro Re-Orient

- **Where:** Block 0 (Spec + ground truth), step 0.2 of 2, overall position 2 of 31 steps.
- **Last step (0.1):** rooted-caused the mesh crash-loops — one cause (stale `~/openclaw/` exec path), all 9 units class-C, triage in DECISIONS D5. No code touched.
- **This step:** produce FEDERATION_SPEC.md — the contract all subsequent steps design against.
- **North-star line:** three layers of grappes generalizing the circling paper; every layer has a runtime-observable protocol (ROADMAP block exits, MASTER_PLAN §5).
- **Still the right next step?** Yes — INVENTORY 1.1 through 5.5 all cite "FEDERATION_SPEC (0.2)" in their Needs.

## §1 Intent

Write `docs/FEDERATION_SPEC.md`: grappe model, three work architectures (adversarial/cooperative/collaborative), management and savant layer protocols, task/result/change-set envelope schemas, and layer contracts — each section grounded with file:line cross-references into the running stack. This is a pure documentation step; no production code is written.

## §2 Design (consuming carry-forwards)

Carry-forward from 0.1 AUDIT_POST §6:
- "FEDERATION_SPEC can state the substrate assumption plainly — daemons exec from the live install path; the `~/openclaw/` layout is dead." → §L0 Substrate will note the exec-path requirement.
- "No open question blocks 0.2." → confirmed.

Design choices:
- **Sections follow the three-layer diagram** in ROADMAP: L0 Substrate → L1 Worker (three modes) → L2 Management → L3 Savant.
- **Flow diagrams in ASCII** (same style as ROADMAP) — no external tooling; grep-verifiable.
- **Envelope schemas as annotated JS object shapes** so they're grep-verifiable AND readable without a JSON schema tool.
- **≥10 file:line cross-refs** using grep-confirmed line numbers (verified in this tick's read-only pass).
- **Change-set schema** (for step 5.2 Needs) defined in §L3 Savant.
- **Decomposition schema** (for step 4.1 Needs) defined in §L2 Management.
- **Mode-selection guidance** (for step 3.4 Needs) defined in §Mode selection.

## §3 Needs pre-screen

| Need | Exists? | Evidence |
|---|---|---|
| `docs/circling-strategy-implementationV3.md` | YES | read in this tick; 803 lines |
| Operator mode definitions (ROADMAP §work-architecture semantics) | YES | ROADMAP.md:43–50 |
| COMPONENT_REGISTRY probed baseline | YES | probed 2026-07-06; registry current |
| `lib/mesh-collab.js` (for cross-refs) | YES | read; COLLAB_MODE at :30 |
| `bin/mesh-task-daemon.js` (for cross-refs) | YES | read; handlers at lines 754, 872, 1253 |
| `lib/deploy-trigger-auth.mjs` (for envelope signing) | YES | read; signDeployTrigger at :58 |
| `lib/node-identity.mjs` (for identity) | YES | read; getOrCreateIdentity at :76 |
| `bin/spawn-node.mjs` (for logical nodes) | YES | read; spawnNode() at :131 |
| `services/nats/nats-1.conf` (for cluster) | YES | read; cluster block at :16 |

All Needs present. No BLOCK.

## §4 Risk register

- **Spec drift risk:** a spec written before implementations exist tends to diverge. Mitigated: cross-refs are to lines already written, not intended. Spec is normative for schemas and flow contracts; any divergence found during implementation becomes a DECISIONS entry, not a silent drift.
- **Scope creep:** temptation to define cooperative/collaborative message schemas in full detail before step 3.1. Decision: spec provides the flow diagram and `architecture` field anchor; exact message shapes are implementation artifacts of 3.2/3.3.
- **Verify modality:** the Verify is `code:` (grep-based) — fully headless, no BLOCK risk.

## §6 File-delta outline

| File | Delta |
|---|---|
| `docs/FEDERATION_SPEC.md` | CREATE — the spec (all sections) |
| `memory-plan/plans/federation/VERSION` | UPDATE: `v0.1` → `v0.2-pre` then `v0.2-mid` |
| `memory-plan/plans/federation/INVENTORY.md` | FLIP: `[ ]` → `[A]` on row 0.2 |

Post-verify additions (Phase 9):
| `memory-plan/plans/federation/VERSION` | `v0.2-mid` → `v0.2` |
| `memory-plan/plans/federation/INVENTORY.md` | `[A]` → `[x]` on row 0.2 |
| `memory-plan/plans/federation/SCOPE.md` | batch `step-0.2-federation-spec` → closed |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | add spec entry to Family 0 |
| `memory-plan/plans/federation/audits/step02_federation-spec/AUDIT_POST.md` | CREATE |
