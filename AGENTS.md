# openclaw-nodedev — Agent Bootstrap

**Plans are siloed, and the protocol base is shared.** The shared sources live in
[`memory-plan/canonical/`](memory-plan/canonical/): five synced docs (`MASTER_PLAN.md`,
`PROTOCOL.md`, `FRAMEWORK_CANONICAL.md`, `COWORK_MODEL.md`, `BLOCK_TEMPLATE.md`) copied into
every plan silo by `workspace-bin/sync-canonical.sh`, plus [`templates/`](memory-plan/canonical/templates/),
which `workspace-bin/new-plan.sh <id> ["goal"]` instantiates into a new viewer-valid silo.
`workspace-bin/plan-tick.sh <id>` is the one generic chain engine; per-plan `<id>-tick.sh` shims
front it (the viewer/launchd invoke tick commands argv-less). Every plan doc lives inside a
self-contained plan dir under `memory-plan/plans/<id>/`:
- [`memory-plan/plans/redesign/`](memory-plan/plans/redesign/) — local-first memory redesign. **COMPLETE at v6.5** (Blocks 0–6 delivered; Block 7 federation DEFERRED per its DECISIONS D4).
- [`memory-plan/plans/repair/`](memory-plan/plans/repair/) — chain repair. **COMPLETE at v7.8** (49/49 steps, all active blocks closed; scope idle). Suite as of 2026-09-06: 1920 root / 118 Mission Control, green in CI.
- [`memory-plan/plans/protocol/`](memory-plan/plans/protocol/) — the meta-plan: the workplan operating base itself (canonical docs, generic engine, scaffolder).
- [`memory-plan/plans/federation/`](memory-plan/plans/federation/) — worker/management/savant grappes. **BLOCKED at v2.6** (D15: premise benchmark failed) and, per **D16** (2026-08-05), consensus gating is dead — federation is a deterministic pipeline. Management has not started.
- [`memory-plan/plans/hyperagent-evidence/`](memory-plan/plans/hyperagent-evidence/) — human-gated strategy evidence loop. **SUBSTRATE LIVE, COHORT NOT STARTED at v2.0**.
- [`memory-plan/plans/legacy/`](memory-plan/plans/legacy/) — the **completed** 58-step framework plan (archive / reference).

**Read these BEFORE any tool use, in this order:**

1. [`memory-plan/canonical/MASTER_PLAN.md`](memory-plan/canonical/MASTER_PLAN.md) — north star architecture + non-negotiable working principles + done-contract. The shared doc that governs everything you do in this repo (a synced copy sits in every plan silo).
2. [`memory-plan/canonical/PROTOCOL.md`](memory-plan/canonical/PROTOCOL.md) — **the plan-silo operating base**: silo anatomy, the per-step 9-phase lifecycle, version carriers, the Re-Orient Loop, the viewer + tick-chain contracts, and how a new plan iteration is instantiated.

Then the per-plan documents of the silo you are working in — every silo carries the same standard manifest (PROTOCOL §1):

3. `plans/<id>/ROADMAP.md` (redesign's is `MEMORY_REDESIGN.md`) — the plan's blocks and why.
4. [`plans/<id>/COMPONENT_REGISTRY.md`](memory-plan/plans/redesign/COMPONENT_REGISTRY.md) — current runtime state of what the plan touches. Reality, not aspiration.
5. [`plans/<id>/DECISIONS.md`](memory-plan/plans/redesign/DECISIONS.md) — append-only ledger of every architectural decision. The fastest way to absorb what was decided and why.
6. [`plans/<id>/INVENTORY.md`](memory-plan/plans/redesign/INVENTORY.md) — the atomic step list. The first `[ ]` row is the plan's next action. (Pre-protocol plans also carry their historical `WORKFLOW.md`/`FRAMEWORK.md` — for them, those govern; PROTOCOL.md governs plans created after 2026-06-03.)
7. [`plans/<id>/SCOPE.md`](memory-plan/plans/redesign/SCOPE.md) — the plan's work contract. If no plan's `SCOPE.md` has `Status: active`, you MUST set scope with the operator before editing anything.
8. [`plans/<id>/OUT_OF_SCOPE.md`](memory-plan/plans/redesign/OUT_OF_SCOPE.md) — captured drift awaiting triage.

The current ground-truth reconciliation is protocol step 3.1 under
[`memory-plan/plans/protocol/audits/step31_governance_recovery/`](memory-plan/plans/protocol/audits/step31_governance_recovery/).
Audits decay (MASTER_PLAN §4.9) — re-verify specific claims older than 14 days before acting on them.
`git log --oneline -20` shows the recent committed work.

## Where we are / next action

**As of 2026-09-06 (remediation, PR #6):** a repo-wide adversarial + lifecycle review
(`ADVERSARIAL_REVIEW_2026-09-06.md`) and its plan (`REMEDIATION_PLAN_2026-09-06.md`) landed with
Phases 0–3 implemented: secrets file perms, the foreign `npx openclaw-mesh` step removed, the three
RCE sinks closed, signed operator actions + ownership checks on the mesh bus, Mission Control
requiring its session token on every `/api` method, and the governance gates made mechanical (git
hooks via `npm prepare`, force-push refused, the tick refuses a close without a Runtime-Evidence
trailer or with a red suite, scope-check hardened). CI has been green since that PR; before it,
Tests had failed on `main` on every run from #158 (2026-08-02) to #165. Runtime evidence for the
remediation (deploy to `~/.openclaw`, restart, observe) is still the operator's step.

As of 2026-08-02, the protocol base is live; redesign is complete at v6.5 and repair at v7.8.
Federation is **not** at management: step 2.6 is reopened at `v2.6-pre` because its five-task
premise contract was not met. The July one-task blind win remains qualified evidence. Step 3.5
is in-flight but blocked on 2.6; 6.2 and 6.3 retain their visual/runtime gates. Block 4 has not started.

HyperAgent's mechanical substrate and read-only MC page are live, but the production store has
1 telemetry row and no strategies, reflections, or proposals. The next step is operator-gated 2.1
preregistration. Companion I1-I5 is design-only and not required to preregister the mesh-primary stratum.

Fresh runtime probes: R=3 NATS quorum, memory daemon, Mission Control, mesh-task-daemon, mesh bridge,
node-watch, and workplan viewer are live. `mesh-agent`, gateway, and companion bridge were down at the
probe. Federation watch = 2 WORKING / 1 OFF / 1 UNKNOWN. This is substrate, not worker-cluster proof.

Queued runtime repair is specific: consolidation has one hard-cap failure then 359 false-busy skips
because `/api/ps` reports a loaded model, not active inference; NATS auth separately blocks event
emission; scheduler heartbeat exits 22/HTTP 401; dotted hostnames break local stream names; the nested
`lib/mcp-knowledge` tree loads Sharp 0.34.5 beside root Sharp 0.35.3 and has unresolved audit findings;
watcher freshness/running-state gaps remain. Do not claim the August daily note proved consolidation.

**Scope after v3.1:** no plan scope is active. The next operator-approved scope is the bounded
runtime-repair batch described above; federation execution remains locked until that repair lands.

## The forcing function

**Only Claude Code enforces the write gate.** `.claude/settings.json` registers `.claude/hooks/scope-check.sh` as a PreToolUse hook on `Edit | Write | MultiEdit | NotebookEdit`. There is **no** `.codex/` hook shipped — `.codex/` is gitignored and does not exist in the tree (an earlier version of this file claimed otherwise). A Codex or other non-Claude session has no mechanical write gate: treat the scope contract as binding by convention, and know that `git commit` / `git push` are still validated for every tool through the git hooks (`config/git-hooks`, installed by `npm prepare` via `core.hooksPath`). The hook is **per-plan**: it scans every `memory-plan/plans/*/SCOPE.md`, keeps those whose `Status` is `active` and not past `Expires`, and unions their ` ```files ` blocks into the allow-list. It will **block you** if:

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

This plan + hook + scope contract is the structural fix. Don't bypass it. It is enforced at the tool
layer for `Edit | Write | MultiEdit | NotebookEdit`; Bash file writes (`sed -i`, `tee`, redirects) are
NOT gated — that is a known hole, not permission. Treat the scope contract as binding for every write,
whatever tool performs it.

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
