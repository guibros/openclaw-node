# spec-kit vs. the plan-silo protocol — gap analysis

**Date:** 2026-09-14, 12:45 EDT (Montreal)
**Subject:** [`github/spec-kit`](https://github.com/github/spec-kit) @ `fd490fa` (read 2026-09-14)
**Against:** `memory-plan/canonical/PROTOCOL.md`, `MASTER_PLAN.md`, `.claude/hooks/scope-check.sh`
**Status:** reference material. This document changes no protocol doc, opens no adoption work,
and is not a decision. It exists so that a future decision is made from evidence rather than from
the README.

**Audit decay (MASTER_PLAN §4.9):** claims about spec-kit are pinned to commit `fd490fa`. Claims
about this repo were verified on 2026-09-14 against the working tree. Re-verify after 14 days.


> **Note added 2026-09-14, later the same day.** After this was written, the operator removed the
> scope contract entirely — `scope-check.sh`, every `SCOPE.md`, and the governing prose (protocol
> DECISIONS D11). Several arguments below lean on that gate existing, chiefly §2's "our enforcement
> lives outside the model's control" and §6's reason not to run `specify init`. Those now overstate
> the enforcement this repo has: what survives is the `Runtime-Evidence:` commit trailer, the
> commit/push validators, and `plan-lint.sh`. The comparison of *methods* — the clarification
> taxonomy, Success Criteria, the coverage matrix, the `converge` gap types — is unaffected, and
> §4.2's point that a marker could be enforced by `grep` is now a claim about `plan-lint.sh` alone.

---

## 1. What spec-kit is

An open-source toolkit from GitHub implementing **Spec-Driven Development**: the specification is
the artifact you maintain, and code is what gets regenerated from it. You install a Python CLI
(`uv tool install specify-cli`), run `specify init <project> --integration claude`, and it writes a
`.specify/` directory of templates plus a set of slash commands into your agent's command
directory.

The workflow is a fixed chain of prompt files, each one a markdown document the agent executes:

| Command | Template it fills | Output |
|---|---|---|
| `/speckit.constitution` | `constitution-template.md` | `.specify/memory/constitution.md` |
| `/speckit.specify` | `spec-template.md` | `specs/NNN-name/spec.md` |
| `/speckit.clarify` | — (pure interrogation loop) | edits `spec.md` in place |
| `/speckit.plan` | `plan-template.md` | `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |
| `/speckit.tasks` | `tasks-template.md` | `tasks.md` |
| `/speckit.analyze` | — (read-only) | a consistency report, no writes |
| `/speckit.implement` | — | code |
| `/speckit.converge` | — (append-only) | new tasks for whatever the code still doesn't satisfy |

Everything above is markdown. The Python CLI does scaffolding, template resolution, branch
creation and bundling; it does not police the workflow. **The methodology is carried entirely by
prompt text.**

---

## 2. The structural claim

The two systems are not competitors along their full length. They are two halves of one pipeline,
and each is strong exactly where the other is absent.

```
  fuzzy intent ──────► spec ──► plan ──► task list ──► implementation ──► evidence ──► shipped
  └───────────── spec-kit lives here ─────────────┘
                                       └────────── memory-plan lives here ──────────┘
                                       ▲
                                  they meet at the step list
                                  (tasks.md  ≈  INVENTORY.md)
```

- Everything **left** of that line, we do informally. `PROTOCOL.md` §9 says: write `ROADMAP.md`
  ("what phases, in what order, why"), then decompose `INVENTORY.md` "to atomic grain" — and calls
  this explicitly *"the part no scaffolder can do."* There is no method, no template, and no
  machine check for the transition from an operator sentence to a contract-bearing step list.
- Everything **right** of that line, spec-kit does informally. Its gates are checkboxes in a
  template that the same model that wrote the artifact then ticks about its own output. Nothing in
  spec-kit can stop a write, refuse a commit, or refuse a close.

**The asymmetry that matters:** our enforcement lives outside the model's control
(`.claude/hooks/scope-check.sh` is a `PreToolUse` hook that exits 2; `.claude/hooks/validate-commit.sh`
refuses a commit with no `Runtime-Evidence:` trailer; `workspace-bin/plan-lint.sh` machine-grades
six viewer surfaces). Spec-kit's enforcement is a sentence in a prompt that says **MUST**.

That is not a criticism of spec-kit's design — it targets 30+ agent surfaces and cannot assume a
hook layer. It is the reason we should not read its gates as gates.

---

## 3. Artifact-by-artifact mapping

| spec-kit | our equivalent | verdict |
|---|---|---|
| `constitution.md` (9 articles) | `MASTER_PLAN.md` + `PROTOCOL.md` | **ours is stronger** — theirs is opinionated defaults (library-first, CLI-mandate, ≤3 projects) that contradict this repo's actual shape |
| `spec.md` — user stories, FR-###, SC-### | *nothing* | **their gap-filler** — this is the real find |
| `[NEEDS CLARIFICATION: …]` markers | `BLOCKED.md` (stop-the-world) or `OUT_OF_SCOPE.md` (defer) | **theirs fills a hole** — we have no in-place "hole in this design" state |
| `plan.md` + `research.md` + `contracts/` | `AUDIT_PRE.md` (intent, design, risk register, §6 file-delta outline) | **comparable**; ours is per-step, theirs per-feature |
| `tasks.md` — `[ID] [P?] [Story] Description` | `INVENTORY.md` rows + §11 `Goal/Needs/Feeds/Verify` | **ours is substantially stronger** |
| `analyze` coverage matrix | *nothing* | **their gap-filler** — mechanically portable |
| `converge` gap types | `AUDIT_POST.md` §1 promised-vs-landed | **theirs has a category we lack** |
| Phase -1 gates (checklists) | §8.5 Deep Review Gate (six conditions) | same shape, same weakness — both self-attested |
| `implement` | Phases 4–5 + the `Runtime-Evidence:` trailer | **ours is stronger** — theirs has no evidence contract at all |

### 3.1 Where our step contract beats theirs outright

A spec-kit task is a sentence with a file path:

```
- [ ] T010 [P] [US1] Contract test for [endpoint] in tests/contract/test_[name].py
```

An INVENTORY row carries a four-field contract enforced at three different phases
(`PROTOCOL.md` §11):

```
> **X.Y — Goal:**  one sentence, one outcome.       → atomicity probe; "and" means split
> **Needs:**  what must already exist                → verified in Phase 1; missing ⇒ BLOCK
> **Feeds:**  where the result is consumed           → recorded in Phase 9; unconsumed ⇒ dead work
> **Verify:** runtime: / code: / visual: + threshold → executed in Phase 5; unobservable ⇒ unclosable
```

`Feeds` has no spec-kit counterpart at all, and it is the field that makes dead work structurally
impossible to enter the plan. Keep it.

---

## 4. What to steal — ranked

### 4.1 The clarification taxonomy *(highest value)*

`templates/commands/clarify.md` step 3 defines a 10-category ambiguity scan, each marked
**Clear / Partial / Missing**:

> Functional Scope & Behavior · Domain & Data Model · Interaction & UX Flow · Non-Functional
> Quality Attributes · Integration & External Dependencies · Edge Cases & Failure Handling ·
> Constraints & Tradeoffs · Terminology & Consistency · Completion Signals · Misc / Placeholders

Then a strictly-bounded interrogation: **at most 5 questions total**, selected by
`Impact × Uncertainty`, asked **one at a time**, each with a recommended default, and each answer
written straight back into the spec under `## Clarifications / ### Session YYYY-MM-DD` before the
next question is asked.

We have nothing here. Our CLAUDE.md says *"use AskUserQuestion for choices, not free-form
questions"* and *"spend up to a minute on read-only investigation first"* — good instincts, no
method. The 5-question cap is the part worth copying deliberately: it forces triage instead of an
interrogation, and it makes the deferred residue explicit rather than forgotten.

**Shape of the import:** a `TICK_PROMPT`-style executable prompt in the protocol silo that turns an
operator sentence into ROADMAP blocks + INVENTORY rows, running this taxonomy first. Not a new
document tree.

### 4.2 `[NEEDS CLARIFICATION: …]` as a third state

Today an in-flight step has exactly two escapes for a design hole: `BLOCKED.md` (halts the chain,
needs an operator) or `OUT_OF_SCOPE.md` (defers out of band). There is no marker for *"this hole
must be filled before Phase 4, and it is not worth stopping the world."*

An inline, greppable `[NEEDS CLARIFICATION: auth method — token / nkey / mTLS?]` in `AUDIT_PRE.md`,
plus a `plan-lint.sh` rule that **FAILs** a `vX.Y-pre` → `vX.Y-mid` transition while any marker
remains, would give us the state *and* — unlike spec-kit — actually enforce it. Their checklist
says "no markers remain"; ours could be a `grep` in the Deep Review Gate.

### 4.3 Success Criteria separated from requirements, preregistered

`spec-template.md` splits **Functional Requirements** (FR-###: "System MUST …") from
**Success Criteria** (SC-###: measurable, technology-agnostic outcomes), and `analyze` deliberately
excludes post-launch business KPIs from the buildable set.

Our `Verify:` line fuses both jobs — it names the probe *and* the threshold, per step. That is right
at step grain and missing at **block** grain. The federation premise benchmark is the case in point:
D3's "≥4-of-5" bar existed, but the five-dimension scoring, the cost ceiling, and what counted as a
delivered pair were argued into shape around the runs rather than preregistered as an SC-### block
with the ROADMAP block. A block-level Success Criteria section is the artifact that was missing —
and `hyperagent-evidence`'s pending 2.1 preregistration manifest is exactly the same need,
already named in the plan.

### 4.4 The `analyze` coverage matrix — free mechanical win

`analyze` builds a requirement-key → has-task? → task-IDs table and reports **Coverage %**.

`PROTOCOL.md` §2 already asserts the invariant — *"a step with no roadmap basis shouldn't exist"* —
and **nothing checks it**. A `plan-lint.sh` surface that maps each ROADMAP block exit criterion to
≥1 INVENTORY row and each row back to a block would turn an assertion into a graded surface, in the
same PASS/WARN/FAIL vocabulary §10 already uses.

### 4.5 `converge`'s gap-type vocabulary — one missing category

`converge` classifies every gap as `missing` / `partial` / `contradicts` / **`unrequested`**.

Our `AUDIT_POST.md` §1 is a promised-vs-landed ledger where every row must read `yes`. It answers
"did we build what we said" and is structurally blind to "**did we build something nobody asked
for**". That blind spot has a name in this repo's history: *"Two parallel daemons got built next to
each other"* (CLAUDE.md, "Why this exists"). Adding `unrequested` as a category to AUDIT_POST §1 is
close to free and targets a failure mode we have actually suffered.

### 4.6 Independent-test framing, one level up

`spec-template.md` requires every user story to be independently testable — *"if you implement just
ONE of them, you should still have a viable MVP."*

Our atomicity test is the same instinct at **step** grain (§11: one independently-verifiable runtime
outcome). At **block** grain we have "each block's exit criterion" (§9) and no test that a block is
independently deliverable. Blocks are where this plan's scope creep has actually happened.

---

## 5. What to reject, and why

1. **The constitution as a governance layer.** It duplicates MASTER_PLAN + PROTOCOL with weaker
   force, and its concrete articles are wrong for this repo: "Library-First" and "CLI Interface
   Mandate" don't describe a NATS mesh with daemons and a Mission Control web app, and "Maximum 3
   projects" is already violated by design. Two north stars is the failure, not the fix.

2. **`specs/NNN-feature/` as a second tree.** We have `memory-plan/plans/<id>/`. A second home for
   "what we intend to build" is the drift generator CLAUDE.md exists to prevent.

3. **Branch-per-feature.** `scripts/bash/create-new-feature.sh` derives a semantic branch and
   switches to it. This repo commits **one step per commit on `main`** and treats `git log` as the
   append-only step ledger (protocol DECISIONS D2, which is why there is no `VERSION_LOG.md`).
   Importing spec-kit's branching would dismantle that ledger.

4. **Test-optionality.** `tasks-template.md` states: *"Tests are OPTIONAL - only include them if
   explicitly requested in the feature specification"* — while the constitution's Article III calls
   TDD *"NON-NEGOTIABLE"*. The templates and the constitution contradict each other, and in
   practice the template is what the agent reads. Our Phase 5 requires the suite green at baseline
   **and** the step's `Verify:` contract executed. Do not import the weaker bar.

5. **More self-attested checklists.** Every spec-kit gate is a box the authoring model ticks about
   its own output. We already have one of these (§8.5 Deep Review Gate) and should be honest that
   it is our softest gate, not add four more like it. Import spec-kit's *content* (the taxonomy,
   the coverage matrix, the gap types) into things that can be `grep`-ed, not its ceremony.

---

## 6. Why not just run `specify init`

Not because of file collisions — there are almost none. `.claude/commands/` does not exist in this
repo today, so the `/speckit.*` commands would land cleanly. The reason is governance:

- `specify init` assumes **it** owns the "what are we building" layer. That layer is physically
  gated here by `scope-check.sh`, which allows a write only if the path appears in an open
  ` ```files ` block of a `Status: active`, unexpired `SCOPE.md`.
- So an agent running `/speckit.implement` hits **exit 2** on its first write, with a message about
  a `SCOPE.md` that spec-kit has never heard of. The two systems have two different answers to
  "may I write this file", and only one of them is enforced.
- They also have two different answers to "is this done". Ours: a `Runtime-Evidence:` trailer, a
  green suite, and a `Feeds` landing recorded in Phase 9. Theirs: `converge` reports no remaining
  findings. An agent holding both will satisfy the cheaper one.

Two parallel governance systems with two done-contracts is precisely the May 2026 failure mode
CLAUDE.md was written to prevent. The import path is **content into our silo**, never a second tree
beside it.

---

## 7. Where spec-kit is genuinely ahead of us

Worth stating plainly, since the rest of this document favours our side:

- **Its tooling is tested.** `tests/` carries 100+ files covering the CLI, the bundler, template
  resolution, path traversal, and workflow overlays. Our governance tooling — `scope-check.sh`,
  `plan-lint.sh`, `plan-tick.sh`, the git hooks — is covered by a handful of cases in
  `test/gate-mutation.test.mjs` and `test/plan-protocol.test.mjs`. The gate that blocks every write
  in this repo had eight tests before today.
- **Its method is executable.** `/speckit.clarify` is a prompt file an agent *runs*. Our equivalent
  method lives as prose in `PROTOCOL.md` that a session is expected to have internalised. Prose
  that is never executed decays silently — which is the same class of failure as an expired scope
  reporting itself as a missing one.
- **It ships to 30+ agents** with a versioned workflow schema (`workflows/speckit/workflow.yml`),
  extension hooks, and air-gapped install. We have one surface and one operator.

---

## 8. If this becomes work

It would be a protocol-plan block, not an install. Roughly:

| Step | Deliverable | `Verify:` shape |
|---|---|---|
| 1 | Block-level **Success Criteria** section added to `ROADMAP.template.md` + `PROTOCOL.md` §9 | `code:` — `plan-lint.sh` FAILs a block with no SC rows |
| 2 | `[NEEDS CLARIFICATION]` as a Phase-1 state, cleared before `-mid` | `code:` — Deep Review Gate greps AUDIT_PRE; marker ⇒ FAIL |
| 3 | ROADMAP↔INVENTORY coverage matrix as a seventh graded surface | `code:` — `plan-lint.sh <id>` reports Coverage % |
| 4 | `unrequested` added to the AUDIT_POST §1 vocabulary | `code:` — template + one worked audit |
| 5 | An executable intake prompt carrying the clarification taxonomy | `visual:` — operator runs it on a real fuzzy request, gets a valid silo |

Steps 1–4 are mechanical and cheap. Step 5 is the one with actual value and actual risk, and should
not start before 1–4 exist to receive its output.

**Nothing above is approved.** `OUT_OF_SCOPE.md` is where any of it goes if it is not opened as a
scope.
