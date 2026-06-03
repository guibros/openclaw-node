# DECISIONS — protocol plan (append-only)

Architectural decisions for the workplan operating system itself. Newest at bottom. Never rewrite an entry; supersede with a new one.

---

## D1 — The protocol base is canonical-synced docs + instantiated templates + one generic engine (2026-06-03)

**Decision.** The reusable base every plan iteration inherits has three tiers:

1. **Synced** (identical in every silo, authored in `memory-plan/canonical/`, propagated by `sync-canonical.sh`): `MASTER_PLAN.md`, `COWORK_MODEL.md`, `PROTOCOL.md`, `FRAMEWORK_CANONICAL.md`, `BLOCK_TEMPLATE.md`. These are the rules; they must never drift per plan.
2. **Instantiated** (copied once from `canonical/templates/` by `new-plan.sh`, then owned by the plan): `INVENTORY.md`, `ROADMAP.md`, `SCOPE.md`, `OUT_OF_SCOPE.md`, `DECISIONS.md`, `COMPONENT_REGISTRY.md`, `TICK_PROMPT.md`, `automation.json`, `VERSION`. These are the plan's working state; they must diverge per plan.
3. **Engine** (shared executable, never copied): `workspace-bin/plan-tick.sh <id>`, fronted per plan by a generated two-line shim `workspace-bin/<id>-tick.sh` because the viewer and launchd invoke the tick command with no argv.

**Why.** The silo restructure standardized every per-plan path (`<plan>/INVENTORY.md`, `<plan>/VERSION`, `<plan>/audits/`, ...), which collapses most of FRAMEWORK's placeholder table into convention. What remained plan-specific before (tick scripts, prompt files, workflow docs) was being hand-copied and accumulating stale paths — COWORK_MODEL §5 already flags the legacy tick scripts as dead automation. One synced rulebook + one parameterized engine ends that class of drift.

**Consequences.** `legacy/` and `redesign/` keep their historical `FRAMEWORK.md`/`WORKFLOW.md` copies as the record of how those plans ran; `PROTOCOL.md` governs new plans. Their `BLOCK_TEMPLATE.md` copies are overwritten by the canonical generalized one (canonical-doc semantics).

## D2 — VERSION_LOG is retired; git log is the per-bump ledger (2026-06-03)

**Decision.** The standard silo carries no `VERSION_LOG.md`. The redesign plan already ran without one: one commit per step on `main` means `git log` IS the append-only step ledger, and `audits/` carries the per-step narrative. `FRAMEWORK_CANONICAL.md` still describes VERSION_LOG for non-git contexts; in this repo it is satisfied by the commit log.

**Why.** A second hand-maintained ledger duplicating git history was pure bookkeeping overhead and a drift source in the legacy plan.
