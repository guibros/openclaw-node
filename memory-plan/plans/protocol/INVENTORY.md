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

## Block 2 — Conformance: every plan functionally wires every surface

Operator directive 2026-06-03: each plan must respect and functionally implement the six viewer
surfaces (master-plan, steps, automation, block, documents, history), the 9-phase protocol, and
extreme step atomization with Goal / Needs (pre-screen) / Feeds (post-use) / Verify (enforceable
test). Steps below use the four-field contract they introduce.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [x] | Conformance + step contracts written into PROTOCOL.md and the templates — closed 2026-06-03, §10/§11 live in all 4 silos |
| 2 | 2.2 | v2.2 | [x] | plan-lint.sh: enforceable conformance checker over the six surfaces + step contracts — closed 2026-06-03, graded all 4 silos truthfully (legacy CONFORMANT, others' gaps named) |
| 2 | 2.3 | v2.3 | [ ] | Lint wired into new-plan.sh (scaffold report) and plan-tick.sh preflight (conformance line) |
| 2 | 2.4 | v2.4 | [ ] | Protocol silo itself fully conformant: ROADMAP, REGISTRY, TICK_PROMPT, automation, shim — lint rc 0 |

> **2.1 — Goal:** the rules exist in one place: PROTOCOL.md gains §10 (six-surface conformance: what "functionally implements" each tab means) + §11 (the Goal/Needs/Feeds/Verify step contract); INVENTORY + TICK_PROMPT templates carry both.
> **Needs:** PROTOCOL.md §1/§6 (present, v1.1) · the viewer tab↔file map (verified live in Block 1) · redesign's LOOPS.md flow framing as lineage (connects-with/produces-for/WIN-FAIL).
> **Feeds:** 2.2 (the lint checks exactly these rules) · every future plan's INVENTORY/TICK_PROMPT via the templates.
> **Verify:** code — post-sync, `grep -l '## 10. ' plans/*/PROTOCOL.md` hits all 4 silos; `grep -c '**Needs:**' canonical/templates/INVENTORY.template.md` ≥ 1; `sync-canonical.sh --check` rc 0.
>
> **2.2 — Goal:** conformance is checkable by machine: one command grades any silo per surface (PASS/WARN/FAIL) and exits non-zero on a required failure.
> **Needs:** 2.1's §10/§11 (the spec the lint encodes) · the four real silos as test corpus (one complete, one blocked, one archived, one mid-conformance).
> **Feeds:** 2.3 (scaffolder + engine call it) · the operator (the conformance report is the review surface) · any future CI gate.
> **Verify:** runtime — `plan-lint.sh protocol` correctly FAILS pre-2.4 (missing ROADMAP/TICK_PROMPT/automation) and `plan-lint.sh redesign` reports its true mixed state; exit codes match the report.
>
> **2.3 — Goal:** conformance is unavoidable at the two birth/run moments: scaffold end prints the lint report (what to fill in), tick preflight prints the conformance line (what would block).
> **Needs:** 2.2's plan-lint.sh (exists, executable) · new-plan.sh + plan-tick.sh (Block 1).
> **Feeds:** every future `new-plan.sh` run · every tick preflight · 2.4 uses the wired report as its own evidence.
> **Verify:** runtime — scaffold a demo: lint report appears in scaffold output naming the unfilled contracts; `plan-tick.sh <demo> --preflight` includes the conformance line; demo removed.
>
> **2.4 — Goal:** the meta-plan passes its own law: protocol silo gains ROADMAP.md, COMPONENT_REGISTRY.md (probed), TICK_PROMPT.md (bindings filled), automation.json, protocol-tick.sh shim.
> **Needs:** 2.1–2.3 closed · templates (Block 1) · live runtime probes for the REGISTRY entries.
> **Feeds:** the viewer's six tabs for plan `protocol` (operator-visible) · the tick chain (plan becomes autonomously drivable for future base evolution) · the lint's first green run (the reference conformant silo).
> **Verify:** runtime + visual — `plan-lint.sh protocol` rc 0; viewer `/api/plans/protocol/{scope,registry,decisions,out-of-scope}` all `present:true`; Automation tab shows the shim resolvable (`tick_command_exists:true`).

---

**Block 1 done-evidence (historical — pre-contract format):**

> **1.1:** `workspace-bin/sync-canonical.sh --check` exits 0 AND `PROTOCOL.md` is byte-identical in `canonical/` and every `plans/*/` dir.
> **1.2:** `workspace-bin/plan-tick.sh <id> --preflight` correctly reports each silo's true state without invoking claude — redesign: next step 7.1 (the open DEFERRED row; deferral enforced at TICK_PROMPT layer) · repair: BLOCKED.md PRESENT → would exit · protocol: in-flight `-mid` · unknown id: FATAL rc=1. [Evidence wording corrected at close — see AUDIT_POST §4.]
> **1.3:** `new-plan.sh <demo>` produces a silo the live viewer (:7892) lists in its plan index with tabs rendering; `plan-tick.sh <demo> --preflight` names the demo's first step. Demo removed after evidence capture.
