# openclaw-nodedev — Agent Bootstrap

**Read these BEFORE any tool use, in this order:**

1. [`memory-plan/MASTER_PLAN.md`](memory-plan/MASTER_PLAN.md) — north star architecture + non-negotiable working principles + done-contract. The doc that governs everything you do in this repo.
2. [`memory-plan/COMPONENT_REGISTRY.md`](memory-plan/COMPONENT_REGISTRY.md) — current state of every ~/.openclaw service. Reality, not aspiration.
3. [`memory-plan/DECISIONS.md`](memory-plan/DECISIONS.md) — append-only ledger of every architectural decision. This is the fastest way to absorb what was decided and why.
4. [`memory-plan/MEMORY_REDESIGN.md`](memory-plan/MEMORY_REDESIGN.md) — the local-first redesign roadmap (phases L0–G).
5. [`memory-plan/redesign/WORKFLOW.md`](memory-plan/redesign/WORKFLOW.md) + [`redesign/INVENTORY.md`](memory-plan/redesign/INVENTORY.md) — the per-step 9-phase lifecycle (incl. the Re-Orient Loop) and the 40-step plan. The first `[ ]` row is the next action.
6. [`memory-plan/SCOPE.md`](memory-plan/SCOPE.md) — today's work contract. If absent or `Status` is not `active`, you MUST set scope with the operator before editing anything.
7. [`memory-plan/OUT_OF_SCOPE.md`](memory-plan/OUT_OF_SCOPE.md) — captured drift awaiting triage.

The most recent verified ground-truth audit is [`memory-plan/AUDIT_2026-05-27.md`](memory-plan/AUDIT_2026-05-27.md). Audits decay (MASTER_PLAN §4.9) — re-verify specific claims older than 14 days before acting on them. `git log --oneline -20` shows the recent committed work.

## Where we are / next action

As of 2026-05-28: the working-discipline layer (MASTER_PLAN + scope-check hook + COMPONENT_REGISTRY + DECISIONS), the redesign plan (MEMORY_REDESIGN + redesign/ 40-step inventory + the 9-phase WORKFLOW + the re-orient loop), the workplan-viewer (Master Plan tab + transition notifications), and the redesign-tick automation (built, BLOCK-not-fake, NOT auto-loaded) are all committed. **No code in the actual memory pipeline has been changed yet.**

**The next action is redesign step 0.1** (close the deploy gap: symlink runtime→repo, start NATS). It is intentionally to be run **interactively** (runtime-heavy; see DECISIONS 2026-05-28 redesign-tick entry). There is no active scope — set one per `redesign/WORKFLOW.md §6` before editing.

## The forcing function

`.claude/settings.json` registers a PreToolUse hook (`.claude/hooks/scope-check.sh`) on `Edit | Write | MultiEdit | NotebookEdit`. The hook will **block you** if:

- `memory-plan/SCOPE.md` doesn't exist
- Its `Status` is not `active`
- Its `Expires` timestamp has passed
- The file you're trying to edit is not in its ` ```files ` block

Always-writeable exceptions: `memory-plan/OUT_OF_SCOPE.md` (the agnostic-spec capture mechanism — MASTER_PLAN §4.3 addendum) and `memory-plan/SCOPE.md` itself (so the operator can refresh scope without first blocking themselves).

If the hook blocks you, **do not work around it**. Either:
- Update `SCOPE.md` with the operator's approval, or
- Write your observation to `memory-plan/OUT_OF_SCOPE.md` and proceed with the original scope, or
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
