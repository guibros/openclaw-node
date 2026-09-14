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

## D8 — Governance recovery uses one protocol step and reopens unmet evidence contracts (2026-08-02)

**Decision.** The expired protocol, federation, and HyperAgent scopes are retired and replaced by
one narrow protocol step, 3.1. Scope transcripts are not permanent allow-lists: shipped history
lives in git/audits, while unfinished work lives in INVENTORY. The live execution frontier is
federation 2.6 at `v2.6-pre`, followed by 3.5; HyperAgent is idle at v2.0 pending operator-gated
2.1. Federation 6.2 and 6.3 remain unfinished side gates.

**Why.** Three files advertised `Status: active` after their expiries, federation exposed 85 stale
allow-list entries, and VERSION `v6.3` could steer a cold pickup past the unmet 2.6 evidence contract.
Public docs still described retired HyperAgent prompt rules and July runtime state. A control plane
that cannot identify the next executable gate is not enforcing the system it describes.

**Consequences.** Runtime repair is a separate future scope. This governance step records but does
not fix consolidation liveness, NATS event-auth, the invalid local-event stream name, nested native
dependencies, watcher honesty gaps, heartbeat auth, or worker startup. No management work starts
before 2.6 and 3.5 close. Every future batch opens one fresh labeled scope block with a bounded expiry.

## D9 — Runtime repair uses authoritative activity/process signals and one dependency tree (2026-08-02)

**Decision.** The runtime-repair block is split into four independently closable steps. Queue
activity comes from the memory daemon's fresh exported queue snapshot, never Ollama model residency.
Local event stream names are derived through one canonical helper, and standalone NATS clients use
the existing token resolver. Native dependencies resolve from one parent install; nested
`mcp-knowledge/node_modules` trees are forbidden in source and deployed copies. Watcher service
health requires fresh work evidence and/or a real PID, not an old file or loaded launchd label.
Mission Control mutations retain bearer authentication; the heartbeat becomes an authenticated
client instead of weakening middleware.

**Why.** All four old signals were mechanically false on the live node: `OLLAMA_KEEP_ALIVE=24h`
made `/api/ps` look permanently busy; a dotted hostname generated an illegal stream name; two Sharp
copies loaded incompatible libvips dylibs and terminated the watcher; an 18-day gateway JSONL and
PID-less launchd labels graded WORKING; unauthenticated curl received 401 forever. These are signal
ownership defects, not threshold-tuning problems.

**Consequences.** Each step must deploy and observe its corrected signal before closing. No auth
exemption, watcher downgrade, dependency duplication, or retrospective health claim is accepted.
Federation 2.6 remains blocked until Block 4 closes.

## D10 — An expired scope is a named state, not a silent absence (2026-09-14)

**Decision.** `scope-check.sh` classifies each `SCOPE.md` into five states — `override`, `active`,
`expired`, `malformed`, `inactive` — instead of the previous binary "usable / empty". The three
denying states stay denying: an expired scope still exits 2 and the allow-list is unchanged. What
changes is the verdict the operator reads. When every scope is denied but at least one carries
`**Status:** active`, the hook reports `scope EXPIRED`, names the lapsed plan file, echoes its
`Expires` verbatim with an elapsed clause, and lists the three real remedies — including the fact
that `**Override:** true` is evaluated only inside a live window and so will not lift the block.
A `**Expires:**` that is neither `no-expiry` nor ISO-8601 UTC is reported as unparseable rather
than being silently read as expired.

**Why.** The two conditions "no plan is active" and "a plan is active but its window closed" had
the same representation (an empty return from `scope_active_state`) and therefore the same message:
`no active scope`. That message is false in the second case, and false in the precise way that costs
the most time — it tells an operator to go set a `Status` they can see is already set, so they look
for a parser bug, a path bug, or a broken hook instead of a date. It has now cost three incidents:
federation (2026-08-24, window closed 2026-08-09, the header left reading `active`), repair
(2026-08-26, caught two weeks later with CLAUDE.md still claiming no scope was active), and protocol
(`Expires: 2026-09-10`, found 2026-09-14 — four days in which every `Edit`/`Write` in the repo was
refused). Three occurrences of one diagnostic defect is the defect, not the bookkeeping around it.

**Consequences.** The fix is diagnostic only; no write that was refused before is permitted now, and
`test/gate-mutation.test.mjs` pins both halves — that an expired scope still exits 2, and that its
headline is not the old misdiagnosis. Those tests run the hook out of a throwaway repo tree (a copy
of the script under `<tmp>/.claude/hooks/` roots `REPO_ROOT` at `<tmp>` via `$0/../..`) rather than
introducing an environment variable to redirect the scope directory: a settable scope path would be
a fail-open on the repo's only mechanically enforced write gate. The deeper exposure this incident
names is not fixed here — nothing *notices* an expiry until a write is attempted, and CLAUDE.md's
prose about which scope is active is maintained by hand and was wrong in all three cases. A
scheduled or tick-time freshness check, and a CLAUDE.md governance line generated rather than
written, are captured as open items, not done.

## D11 — The scope contract is removed; D10 is moot (2026-09-14)

**Decision.** The per-file write gate is gone: `.claude/hooks/scope-check.sh`, its `PreToolUse`
registration in `.claude/settings.json`, all six `memory-plan/plans/*/SCOPE.md` files, the
`SCOPE.template.md` scaffold, the `plan-lint.sh` master-plan SCOPE checks and scope-hygiene grades,
the viewer's `parseScope`/`/scope` route and "Current Scope" card, the "set scope before editing"
section in every `TICK_PROMPT.md`, and the governing prose in `MASTER_PLAN.md` §4.2/§6.2,
`PROTOCOL.md` §8, `COWORK_MODEL.md` and both bootstrap docs. D10 — shipped three hours earlier,
making an expired scope report itself as expired rather than as absent — is superseded: the thing
it improved no longer exists.

**Why.** Operator instruction, 2026-09-14, unambiguous and repeated. The mechanism's record
supports it: in roughly two months it latched the entire repo shut three times (federation
2026-08-24, repair 2026-08-26, protocol 2026-09-10, the last for four days), each time because a
date passed rather than because anyone did anything wrong, and there is no recorded instance of it
stopping a bad write. It also could not see Bash writes at all — `sed -i`, `tee`, redirects — which
`CLAUDE.md` acknowledged as "a known hole, not permission", so the discipline was already carried by
convention for a large share of edits while the cost fell entirely on the tools that played by the
rules.

**Consequences.** Nothing gates writes now. The `OUT_OF_SCOPE.md` files stay — they hold real
captured drift and remain the place to record something noticed but not acted on. The 9-phase
lifecycle, the `Runtime-Evidence:` commit trailer, `plan-lint.sh`'s remaining surfaces, and the
commit/push validators are untouched: the parts of the discipline that never depended on a
permission slip. What is genuinely lost is the one mechanical check on step boundaries; §4.2 of
MASTER_PLAN now asks for that as convention. If it needs to come back, it should come back as
something that cannot latch — advisory, or keyed to the step actually in flight rather than to a
wall-clock deadline.
