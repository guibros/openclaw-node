# Protocol Plan — Step Inventory

The meta-plan: the workplan operating system itself, made a versioned, instantiable base.
Goal: any future plan iteration starts from one command and inherits the full machinery —
canonical governance docs, the 9-phase step protocol, the viewer integration, the tick chain —
instead of hand-copying files from the previous plan.

**One step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit**
(see `PROTOCOL.md` once step 1.1 lands; until then, `plans/redesign/WORKFLOW.md` §3).
Done-evidence must be runtime-observable (MASTER_PLAN §5).

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`, carrier starts at `v0.0`.

---

## Block 1 — The protocol base

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Canonical protocol docs: PROTOCOL.md + FRAMEWORK_CANONICAL hoist + BLOCK_TEMPLATE generalization, synced into every silo — closed 2026-06-03, synced to 4 silos incl. previously-unmapped `repair/` |
| 1 | 1.2 | v1.2 | [x] | Generic chain engine plan-tick.sh: plan-id parameterized, per-plan shim convention, no per-plan copies — closed 2026-06-03, preflight verified live against all 4 silo states |
| 1 | 1.3 | v1.3 | [x] | Template set + new-plan.sh scaffolder: one command yields a viewer-valid silo; CLAUDE.md pointers updated — closed 2026-06-03, demo silo scaffolded → viewer-listed in 5s → tick-preflight OK → removed. Closes Block 1 (macro re-orient in AUDIT_POST §7) |

> **1.1:** `workspace-bin/sync-canonical.sh --check` exits 0 AND `PROTOCOL.md` is byte-identical in `canonical/` and every `plans/*/` dir.
> **1.2:** `workspace-bin/plan-tick.sh <id> --preflight` correctly reports each silo's true state without invoking claude — redesign: next step 7.1 (the open DEFERRED row; deferral enforced at TICK_PROMPT layer) · repair: BLOCKED.md PRESENT → would exit · protocol: in-flight `-mid` · unknown id: FATAL rc=1. [Evidence wording corrected at close — see AUDIT_POST §4.]
> **1.3:** `new-plan.sh <demo>` produces a silo the live viewer (:7892) lists in its plan index with tabs rendering; `plan-tick.sh <demo> --preflight` names the demo's first step. Demo removed after evidence capture.
