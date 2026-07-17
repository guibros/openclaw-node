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

## D3 — Conformance is law, machine-graded, with grandfathering (2026-06-03)

**Decision.** Operator directive: every plan must *functionally implement* the six viewer
surfaces (master-plan, steps, automation, block, documents, history), the 9-phase protocol, and
extreme step atomization via a four-field contract — **Goal** (one outcome), **Needs**
(pre-screen, verified Phase 1, missing → BLOCK), **Feeds** (named consumer, recorded Phase 9),
**Verify** (enforceable test tagged `runtime:`/`code:`/`visual:`, executed Phase 5; visual-only
→ headless ticks BLOCK). Encoded as PROTOCOL §10/§11; graded by `plan-lint.sh` (PASS/WARN/FAIL,
rc 0 = conformant); surfaced unavoidably at scaffold end and every tick preflight.

**Why.** "Gracefully degrades when missing" had let silos ship half-wired surfaces; and
done-evidence lines alone didn't force pre-screening (Needs) or downstream accountability
(Feeds). Rules without a checker are advisory (MASTER_PLAN §6: forcing functions, not
willpower).

**Consequences.** Open INVENTORY rows without contracts FAIL; closed pre-contract rows are
grandfathered as WARN. Historical naming variance (ROADMAP under another name, D-heading shapes,
audit-dir naming) grades WARN, never FAIL. Repair's 29 open rows need contract retrofit before
its chain resumes — repair-plan work, surfaced by the lint, not done here.

## D4 — Scope batches are first-class: labeled ```files blocks with a `closed` lifecycle (2026-07-04)

**Decision.** The unit of scope is the operator-directed batch, not the calendar. Each batch gets
its own labeled ` ```files <label> ` block in the plan's SCOPE.md; when the batch ships, the word
`closed` is appended to the fence and the hook prunes that block from the allow-list. The 2026-07-04
planner deep review found the alternative — one ever-growing union — had reached 349 lines /
12 addenda / ~110 permanently-writeable files: the hook's designed failure mode (silent expansion)
performed openly. plan-lint now grades the drift directly (open-entry count, active-scope age,
Runtime-Evidence trailers in recent commits, VERSION-vs-git-activity).

**Consequences.** Finished work re-locks without losing its record. One open block per in-flight
batch is the discipline. The always-writeable SCOPE.md remains the trusted-agent hole it always
was — convention plus the new lint visibility, not enforcement.

## D5 — `[D]` DEFERRED is a first-class step state (2026-07-04)

**Decision.** INVENTORY rows may be `[D]`: deliberately postponed. Deferred rows are never a next
step (tick engine ignores them), never block plan completion (viewer excludes them from
total_steps), and need no §11 contract (lint treats them like grandfathered-closed). Redesign's
four Block-7 federation rows are the first users — the plan now grades CONFORMANT instead of
failing lint for work it explicitly chose not to do (its DECISIONS D4).

**Consequences.** Deferral is machine-distinguishable from unfinished. Reopening a deferred step
is a one-character flip `[D]`→`[ ]` plus writing its §11 contract.

## D6 — The per-plan tick engines are retired; plan-tick.sh is the only engine (2026-07-04)

**Decision.** Per MASTER_PLAN §4.6, `memory-plan-tick.sh` (165 legacy ticks) and the 207-line
`redesign-tick.sh` copy (32 ticks) are replaced by two-line shims over the generic
`plan-tick.sh`; their orphaned `com.openclaw.*` plists are renamed `.disabled`. Plist naming is
standardized on `ai.openclaw.<id>-tick` (docs, templates, viewer defaults, automation.json).
plan-tick.sh no longer counts untracked files as tree-dirt (a concurrent session's new files
must not trip the stall-block) and derives paths from $HOME, not a hardcoded operator.

**Consequences.** One engine to maintain; the chain remains deliberately unloaded for every plan
(loading is an explicit operator decision, viewer Automation tab). D3's repair note ("29 open
rows need contract retrofit") is superseded: repair closed 49/49 on 2026-06-11; its remaining
lint FAILs are the missing automation surfaces of a dormant, complete plan.

## D7 — The concept-summary budget is spent frontier-first, and prose is monotonic (2026-07-16)

**Decision.** `generateConceptNotes` no longer slices the blind top-N-by-mention_count. Candidates
are tiered — 0: no note on disk (coverage first, mention-ordered) · 1: note carries the placeholder ·
2: note has prose (refresh) — and within tiers 1/2 ordered by a boundary score ported from the
AgriciDaniel/claude-obsidian comparison (operator "go", 2026-07-16):
`(out_degree − in_degree) × exp(−age_days/30)` over the vault wikilink graph
(`computeBoundaryDegrees` in lib/obsidian-graph.mjs). Two hardening rules ride along: an existing
LLM summary is preserved when this cycle's LLM returns null (prose never regresses to the
placeholder), and byte-identical rewrites are skipped (`unchanged` in the result).

**Why.** The top-N slice had two structural failures observed live: rank N+1 never got a note
(starvation — the tail was invisible forever), and the same hubs re-rolled the LLM dice every cycle
so one busy-Ollama cycle wiped prose a previous cycle had paid for (Arcane: `last_seen 2026-06-02`,
still placeholder on 2026-07-16 despite daily rewrites). The boundary score sends the scarce
summary budget to recently-active notes that link out more than the graph links back — the growing
edge — instead of to whatever is merely most mentioned.

**Consequences.** Repair 2.9 slug ownership is resolved by mention order *before* prioritization
(colliders can't flip note ownership); repair 2.7 `opts.names` targeting still bypasses nothing —
it filters candidates, then the same tiering orders them. Unchanged-skip spares cloud-sync churn
and no-op graph-cache invalidations. The same batch quoted the decision/session frontmatter
wikilink arrays (the concept writer's 2026-07-04 YAML fix, propagated) — Obsidian/Dataview can now
read `related:`/`concepts:`, and `flattenRelated` in buildGraph is legacy-only from this date.
