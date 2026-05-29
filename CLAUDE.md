# openclaw-nodedev — Agent Bootstrap

**Plans are siloed.** `memory-plan/MASTER_PLAN.md` is the ONE shared doc. Every other
plan doc lives inside a self-contained plan dir under `memory-plan/plans/<id>/`:
- [`memory-plan/plans/redesign/`](memory-plan/plans/redesign/) — the **active** plan (local-first memory redesign, Blocks 0–6).
- [`memory-plan/plans/legacy/`](memory-plan/plans/legacy/) — the **completed** 58-step framework plan (archive / reference).

**Read these BEFORE any tool use, in this order:**

1. [`memory-plan/MASTER_PLAN.md`](memory-plan/MASTER_PLAN.md) — north star architecture + non-negotiable working principles + done-contract. The shared doc that governs everything you do in this repo.
2. [`memory-plan/plans/redesign/MEMORY_REDESIGN.md`](memory-plan/plans/redesign/MEMORY_REDESIGN.md) — the local-first redesign roadmap (phases L0–G).
3. [`memory-plan/plans/redesign/COMPONENT_REGISTRY.md`](memory-plan/plans/redesign/COMPONENT_REGISTRY.md) — current state of every ~/.openclaw service. Reality, not aspiration.
4. [`memory-plan/plans/redesign/DECISIONS.md`](memory-plan/plans/redesign/DECISIONS.md) — append-only ledger of every architectural decision. The fastest way to absorb what was decided and why.
5. [`memory-plan/plans/redesign/WORKFLOW.md`](memory-plan/plans/redesign/WORKFLOW.md) + [`INVENTORY.md`](memory-plan/plans/redesign/INVENTORY.md) — the per-step 9-phase lifecycle (incl. the Re-Orient Loop) and the 40-step plan. The first `[ ]` row is the next action.
6. [`memory-plan/plans/redesign/SCOPE.md`](memory-plan/plans/redesign/SCOPE.md) — the active plan's work contract. If `Status` is not `active`, you MUST set scope with the operator before editing anything.
7. [`memory-plan/plans/redesign/OUT_OF_SCOPE.md`](memory-plan/plans/redesign/OUT_OF_SCOPE.md) — captured drift awaiting triage.

The most recent verified ground-truth audit is [`memory-plan/plans/legacy/AUDIT_2026-05-27.md`](memory-plan/plans/legacy/AUDIT_2026-05-27.md). Audits decay (MASTER_PLAN §4.9) — re-verify specific claims older than 14 days before acting on them. `git log --oneline -20` shows the recent committed work.

## Where we are / next action

As of 2026-05-28: plans are now siloed under `memory-plan/plans/` (`redesign/` active, `legacy/` archived), with only `MASTER_PLAN.md` shared at `memory-plan/`. The scope-check hook is per-plan; the workplan-viewer roots at `memory-plan/plans`. Block 0 of the redesign (deploy gap + local NATS) is steps 0.1–0.3 done; step 0.4 (daemon ↔ local NATS) is mid-flight.

**The next action is redesign step 0.4** — the daemon plist already carries `OPENCLAW_NATS` + `OPENCLAW_NODE_ID=daedalus` (backup `.bak-2026-05-28`); reload it (bootout+bootstrap), verify the `local-events-daedalus` stream + a test publish, and close Block 0. Runtime-heavy → run **interactively**. Set the redesign scope active per `plans/redesign/WORKFLOW.md §6` before editing.

## The forcing function

`.claude/settings.json` registers a PreToolUse hook (`.claude/hooks/scope-check.sh`) on `Edit | Write | MultiEdit | NotebookEdit`. The hook is **per-plan**: it scans every `memory-plan/plans/*/SCOPE.md`, keeps those whose `Status` is `active` and not past `Expires`, and unions their ` ```files ` blocks into the allow-list. It will **block you** if:

- no active scope exists (no `plans/*/SCOPE.md` with `Status: active`)
- the active scope's `Expires` timestamp has passed
- the file you're trying to edit is not in any active scope's ` ```files ` block

Keep exactly **one** scope active at a time (one-scope-per-session discipline). Always-writeable exceptions: every plan's own `SCOPE.md` and `OUT_OF_SCOPE.md` (so the operator can refresh scope, and so drift capture is never blocked). A scope carrying `**Override:** true` disables enforcement for that scope.

If the hook blocks you, **do not work around it**. Either:
- Update the relevant plan's `SCOPE.md` with the operator's approval, or
- Write your observation to that plan's `OUT_OF_SCOPE.md` and proceed with the original scope, or
- Stop.

## Why this exists

In May 2026, 5 review rounds + 22 commits in 24h produced ~0 production change because:
- Work happened outside the previous framework's step boundaries
- "Done" was treated as "committed" with no runtime verification
- Two parallel daemons got built next to each other
- Code-on-disk and runtime drifted 4+ days apart

This plan + hook + scope contract is the structural fix. Don't bypass it; it's bypass-proof by design (the hook is at the tool layer, not advisory).

## Pointers

- **OS / shell:** macOS, zsh
- **Primary runtime:** `~/.openclaw/workspace/` (separate from this repo — see MASTER_PLAN §4.1 about the deploy gap)
- **Operator email:** guillaumebrossard04@gmail.com
- **Date format:** Montreal time (UTC-5/UTC-4 DST), full date + time when timestamping

## When you write code

- Default to writing no comments. WHY when non-obvious, never WHAT (MASTER_PLAN §4.8).
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code.
- Don't introduce backwards-compatibility shims when you can just change the code.
- No half-finished implementations. Either finish per MASTER_PLAN §5 done-contract, or capture to OUT_OF_SCOPE.md, or revert.

## When you ask the operator something

- Use AskUserQuestion for choices, not free-form questions that the operator could answer just by reading what's in front of them.
- Spend up to a minute on read-only investigation first. Don't interrupt with a question that grep would answer.
