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
- [`memory-plan/plans/repair/`](memory-plan/plans/repair/) — chain repair. **COMPLETE at v7.8** (49/49 steps, all active blocks closed, suite 1550/0; scope idle).
- [`memory-plan/plans/protocol/`](memory-plan/plans/protocol/) — the meta-plan: the workplan operating base itself (canonical docs, generic engine, scaffolder).
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

The most recent verified ground-truth audit is [`memory-plan/plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md`](memory-plan/plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md) (six-agent review, every claim file:line- or runtime-verified). Audits decay (MASTER_PLAN §4.9) — re-verify specific claims older than 14 days before acting on them. `git log --oneline -20` shows the recent committed work.

## Where we are / next action

As of 2026-07-03: the **protocol base is live** (canonical docs synced, `new-plan.sh` scaffolds
viewer-valid silos, `plan-tick.sh <id>` drives any plan). Redesign is **complete at v6.5**; repair is
**complete at v7.8** (49/49 steps — the old "BLOCKED at v2.11" status was stale for a month). The June
workstream (hosted in the protocol silo) built the **node test+watch system**: `bin/node-acceptance.mjs`
(deploy gate) + `bin/node-watch.mjs` (WORKING/BROKEN/OFF/UNKNOWN watcher engine) + Mission Control
`/node-watch` page + launchd/systemd unit *files*. Runtime status is honest-UNKNOWN, not live: only one
manual one-shot run has ever been observed (2026-07-03, health 75%, 21 W / 5 B / 3 OFF / 2 U); the
continuous-mode units are NOT installed and currently cannot be (unrendered `${VAR}` placeholders +
install.sh never places node-watch.mjs at the unit exec path). Of the one-shot's findings, the 5 BROKEN
are real node findings; the 2 UNKNOWN are a watcher defect (30s timeout clamp on 120s LLM probes).

A first **deep review (2026-07-03)** drove P0/P1/P2 remediation on branch `feat/node-test-watch-system`.
A second **full deep review (2026-07-03 evening,
[`plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md`](memory-plan/plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md))**
verified that work (10 VERIFIED / 7 PARTIAL / 3 NOT-DONE) and found the runtime running pre-fix code
almost everywhere. Its remediation is now DONE: **P1 round 2** (SCOPE 2026-07-03g: C2 catch-up bypass
closed, acceptance-axis false-ACCEPT fixed, watch timeout clamp fixed, live-daemon flush serialization,
broadcast fail-loud, census widened, mesh-kv tests rewritten against production, **CI observed green**
4/4 jobs — first after 5+ reds), then **deploy day 2026-07-03/04**: branch merged to main (PR #5),
state.db migrated to v3 OBSERVED (0 dup groups, 337/337 decisions FTS-indexed, 0 count drift, backup
kept), daemon restarted on new code, the drifted MC hand-copy replaced with the repo tree (data/env
preserved, loopback-only), and the **continuous node-watch + scheduler-heartbeat launchd units are LIVE
for the first time** (5h+ soak observed; install.sh now renders+places them for fresh nodes;
health-watch report converted to a per-tick heartbeat). Live state (deep one-shot 2026-07-04T04:39Z):
**health 74%** — 20 W / 5 B / 4 OFF / 2 U. The 2 UNKNOWN are honest (Ollama gen/extract exceeding their
30s/120s budgets on this VM); the 5 BROKEN are real queued findings: (a) daemon Phase 2
(obsidian-sync + graph-cache refresh) has not fired since 2026-07-03 15:02 — caught by the watcher
overnight; (b) NATS client-connect TIMEOUT while the :8222 monitor answers (pre-existing); (c) MC
dev-mode cold-compile beats the 2.5s diagnostics probe (resolves when `next build` is fixed — 25 tsc
errors, queued). **Queued next:** Phase-2 daemon bug, NATS client auth/port, MC production build, then
the review's P2 batch (§5 of the audit: channel-4 privacy, cron double-fire, dry-run honesty,
formatHtml, staleness banner, health-watch vs node-watch retirement decision).

**Active scope:** `plans/protocol/SCOPE.md` (P0 remediation, expires 2026-07-10). The workplan-viewer
(:7892) shows all silos.

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
