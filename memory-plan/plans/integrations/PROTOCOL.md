# PROTOCOL — The Plan-Silo Operating Base

**Canonical doc.** Authored in `memory-plan/canonical/`, recopied into every plan by
`workspace-bin/sync-canonical.sh`. Applies to all plans equally.

**What this is.** The complete, plan-agnostic contract for how a plan runs in this repo: what a
silo contains, how a step executes (the 9 phases), how the viewer renders it, how the autonomous
tick chain drives it, and how a new plan iteration is instantiated. It is the **silo-resolved
binding** of `FRAMEWORK_CANONICAL.md` (the portable theory doc): the silo restructure standardized
every per-plan path, so the framework's placeholder table collapses into the conventions below.

**Precedence.** `MASTER_PLAN.md` (principles, done-contract) governs this doc. This doc governs
every plan created after 2026-06-03. The `legacy/` and `redesign/` silos keep their own
`FRAMEWORK.md` / `WORKFLOW.md` copies as the historical record of how those plans ran; where they
differ from this doc, they are history, not authority.

---

## 1. Silo anatomy — the standard manifest

A **plan** is any immediate subdirectory of `memory-plan/plans/` containing `INVENTORY.md` +
`VERSION` (the viewer's discovery rule). A full silo carries three tiers of files:

### 1.1 Synced — the rules (identical in every silo; never edit a plan's copy)

| File | Role |
|---|---|
| `MASTER_PLAN.md` | North star + non-negotiable principles + the §5 done-contract |
| `PROTOCOL.md` | This doc — the operating base |
| `FRAMEWORK_CANONICAL.md` | The portable 9-phase framework (theory + rationale) |
| `COWORK_MODEL.md` | What this system is: a local cowork-style chained agent pipeline |
| `BLOCK_TEMPLATE.md` | The shape a `BLOCKED.md` must take |

Authored in `memory-plan/canonical/`; `sync-canonical.sh` propagates. Editing a silo's copy is
drift — the next sync erases it. Change the canonical source instead.

### 1.2 Instantiated — the working state (scaffolded once by `new-plan.sh`, then plan-owned)

| File | Role | Required? |
|---|---|---|
| `INVENTORY.md` | The step list: blocks × atomic steps, status `[ ]` open · `[A]` in-flight · `[x]` closed · `[D]` deferred (deliberate; never a next step, never blocks completion, no §11 contract required), per-step done-evidence | **yes** (discovery) |
| `VERSION` | Single-line carrier `vX.Y[-pre|-mid]` | **yes** (discovery) |
| `SCOPE.md` | The per-step work contract the scope hook enforces | yes |
| `OUT_OF_SCOPE.md` | Drift capture, always-writeable | yes |
| `DECISIONS.md` | Append-only architectural ledger | yes |
| `ROADMAP.md` | The plan's phases/blocks and why — what INVENTORY decomposes | yes |
| `COMPONENT_REGISTRY.md` | Current runtime state of what the plan touches | recommended |
| `TICK_PROMPT.md` | The prompt piped into headless `claude` per tick | tick-only |
| `automation.json` | Tick scheduling config (plist label, interval, command) | tick-only |

### 1.3 Generated — produced by running the plan (never scaffolded with content)

`audits/stepNN_<slug>/AUDIT_PRE.md` + `AUDIT_POST.md` (per step) · `tick-logs/` (per tick:
`<ts>.log` pretty, `<ts>.jsonl` raw, `current.log` symlink) · `BLOCKED.md` (only while blocked;
operator deletes to resume).

There is **no `VERSION_LOG.md`** in the standard silo: one commit per step on `main` makes
`git log` the append-only step ledger (protocol plan DECISIONS D2).

## 2. The five layers (top governs bottom)

```
GOVERNANCE   MASTER_PLAN + PROTOCOL (+ plan-local taste docs, e.g. DESIGN_INPUTS)
  ROADMAP      <plan>/ROADMAP.md — the blocks and why
    STEP LIST    <plan>/INVENTORY.md — atomic steps; one step = one 9-phase = one commit
      EXECUTION    the 9 phases + SCOPE.md + .claude/hooks/scope-check.sh
        TRUTH        COMPONENT_REGISTRY + DECISIONS + audits/ + the viewer (:7892)
```

The chain from intent to shipped, every arrow auditable:

```
ROADMAP block → INVENTORY step → SCOPE.md contract (hook gates) → 9-phase execution
  → VERIFY incl. runtime evidence → REGISTRY/DECISIONS updated → one commit → viewer shows it
```

A step with no roadmap basis shouldn't exist; a commit with no closed step means the protocol
was bypassed.

## 3. The per-step lifecycle (the 9 phases, silo-resolved)

| Phase | Action |
|---|---|
| Pre-flight | Pick the first `[ ]`/`[A]` row. Tree clean (or dirty matching an in-flight `-pre`/`-mid`). `BLOCKED.md` present → stop. Read MASTER_PLAN + the step's ROADMAP block + prior step's AUDIT_POST §6. |
| Scope | Open/refresh `<plan>/SCOPE.md`: Status active, goal = this step, ` ```files ` = this step's deltas, future Expires. The hook now physically gates edits. |
| 1 · §0 | **Micro Re-Orient** — ≤6 lines, first thing in AUDIT_PRE (§5.1 below). |
| 1 | `AUDIT_PRE.md` in `audits/stepNN_<slug>/`: intent, design (consume prior carry-forwards), risk register, §6 file-delta outline. **Pre-screen: verify every Need in the step's §11 contract exists; missing → BLOCK.** Write `vX.Y-pre` to `VERSION`. Flip the row `[ ]`→`[A]`. No production work yet. |
| 4 | Implement every §6 delta — nothing else. Surprises append to AUDIT_PRE `## Mid-Implementation Findings` and/or `OUT_OF_SCOPE.md`, never silent expansion. Then write `vX.Y-mid` to `VERSION`. |
| 5 | **Verify** = (a) tests green at baseline (`npm test` here), AND (b) the step's **Verify contract** (§11) executed exactly as written — `runtime:` probe / `code:` check / `visual:` operator confirmation (headless → BLOCK naming it). Cannot observe → BLOCK, never fake-close. |
| 7 | `AUDIT_POST.md`: §1 promised-vs-landed ledger (every row `yes` or the step isn't done), §2 greppable deltas (command + first hit), §3 cross-refs still valid, §4 findings `[POSITIVE]/[NEGATIVE]`, §5 Phase-8 patches (almost always none), §6 carry-forwards to the next step. |
| 8 | Apply §5 patches. An architectural choice not pre-decided in DECISIONS/carry-forwards → BLOCK + propose a DECISIONS entry. |
| 8.5 | **Deep Review Gate** — all six or BLOCK: ① VERSION is exactly `vX.Y-mid` ② every §6 delta greppable ③ staged diff = §6 deltas + ledger files, nothing more ④ tests green ⑤ INVENTORY/audit docs consistent ⑥ **runtime evidence captured and real**. |
| 9 | One commit (format §3.1). Flip the row `[A]`→`[x]` with a one-line close note. `VERSION` → clean `vX.Y`. Update COMPONENT_REGISTRY. **Record the Feeds landing (§11): where the output lives, which consumer reaches it.** SCOPE Status → done. Log any DECISIONS. **STOP — one step per work unit.** |
| Block close | If this step closed a block: **Macro Re-Orient** (§5.2) before the next block's first step. |

### 3.1 Commit format

```
vX.Y — <step description verbatim from INVENTORY.md>

Phase 4: <one-sentence delta>.
Runtime-Evidence: <the observed proof — command + result>.
V2 audit: <N> POSITIVE, <M> Phase 8 patches.
```

The `Runtime-Evidence:` trailer is mandatory (MASTER_PLAN §5). No observable evidence → no
commit → BLOCK. Ticks add `Authored-By: <plan>-tick`; no amends, no force-push, no remote push.

## 4. Version carriers

`VERSION` holds exactly one of: `vX.Y` (step X.Y closed — next tick starts the following step at
Phase 1) · `vX.Y-pre` (Phase 1 done — resume at Phase 4) · `vX.Y-mid` (Phases 1+4+5 done — resume
at Phase 7). Initial state `v0.0`. The suffix is the cold-pickup resume pointer: any worker
(human, tick, new session) reads VERSION + INVENTORY and knows exactly where the plan stands.

## 5. The Re-Orient Loop

Structure against attention drift: the deeper the dig, the more often you surface.

### 5.1 Micro — every step (the floor)

First block of every AUDIT_PRE, ≤6 lines: where am I (block/step/overall) · what the last step
changed · what THIS step contributes to the block · which north-star line the block serves ·
"still the right next step?" (no → BLOCK + re-plan). Can't fill it in → you don't know where you
are; stop and re-read the plan.

### 5.2 Macro — every block close (the ceiling)

Before the next block's first step: re-read MASTER_PLAN principles (+ plan taste docs) · update
COMPONENT_REGISTRY with **runtime probes** (ps/curl/sql/log), not memory · re-survey the remaining
INVENTORY (atomicity, order — split/re-order if the block taught better) · drift check (anything
landed outside a step? OUT_OF_SCOPE items worth promoting?) · log course-corrections in DECISIONS.

### 5.3 The tripwire

If Phase 4 sprawls into many sub-actions or ≥2 mid-implementation findings, the step was not
atomic. Stop, re-orient, split the step, re-plan. Don't push through a step that quietly became
three.

## 6. The viewer contract (workplan-viewer :7892)

`workspace-bin/workplan-viewer.mjs`, default port 7892 (`WORKPLAN_VIEWER_PORT`), roots at
`memory-plan/plans` (`WORKPLAN_ROOTS`, colon-separated). **Discovery:** immediate subdirs of a
root containing `INVENTORY.md` + `VERSION`; rescan every 60s. **Fully siloed:** every tab resolves
from the plan's own dir; the viewer never reaches outside `<root>/<id>/`.

| Tab | Reads | Shows |
|---|---|---|
| Master Plan | `SCOPE.md` · `COMPONENT_REGISTRY.md` · `DECISIONS.md` · `OUT_OF_SCOPE.md` | The governance dashboard: current contract, runtime truth, choices, deferred drift |
| Steps | `INVENTORY.md` · `audits/*/AUDIT_{PRE,POST}.md` | The checklist: per-step status + audit links |
| Live | SSE tail of `tick-logs/current.log` | The current tick's pretty output, live |
| Progress | SSE of `tick-logs/<ts>.jsonl` | The current tick's structured activity (tool calls, messages) |
| Automation | `automation.json` + launchd state | Load/unload/kickstart/run-once + params |
| Block | `BLOCKED.md` (when present) | What stopped the chain + the **External action** needed |
| Documents | every `*.md` in the plan dir | Raw doc browser |
| History | `tick-logs/*.log` · audits | Past ticks and closes |

Missing docs degrade gracefully (`present:false` → "No X found in this plan") — a minimal silo
(INVENTORY + VERSION) renders without errors. Live/Progress are fed **only by tick runs**;
interactive sessions don't write tick-logs, so empty ≠ broken.

**The viewer is the re-orient surface** (§5): micro = glance at Master Plan tab + inventory
progress before digging; macro = study it before opening a block.

## 7. The tick-chain contract (autonomous mode)

One generic engine drives any plan: `workspace-bin/plan-tick.sh <plan-id>`. Because the viewer
and launchd invoke the tick command with **no argv**, each plan fronts the engine with a generated
two-line shim `workspace-bin/<id>-tick.sh` (`exec plan-tick.sh <id>`), which is what
`automation.json.tick_command` points at. One tick = exactly one step (or a BLOCK):

```
launchd (ai.openclaw.<id>-tick, interval from automation.json) fires <id>-tick.sh
  └─ guards: BLOCKED.md present → exit · dirty tree on clean VERSION → write stall-BLOCKED + exit
            · single-tick lock (stale-reaped >60min) · no [ ]/[A] rows → plan complete, exit
  └─ invoke: cat <plan>/TICK_PROMPT.md | claude --print --permission-mode acceptEdits
  └─ record: tick-logs/<ts>.{log,jsonl} + current.log symlink + one digest line
  └─ outcome: VERSION advanced → step closed · BLOCKED.md written → exit 2, operator clears
```

`--preflight` reports the next step and guard state without invoking claude. **Blocking is
success; fake-closing is the cardinal failure** — the TICK_PROMPT's runtime-evidence gate is what
makes autonomous ticks safe to leave running. A new plan's tick plist starts **unloaded**:
enabling the chain is an explicit operator decision per plan (viewer Automation tab or
`launchctl`).

## 8. The scope hook (write-time enforcement)

`.claude/hooks/scope-check.sh` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) scans every
`memory-plan/plans/*/SCOPE.md`, keeps those with `Status: active` and unexpired `Expires`, and
unions their **open** ` ```files ` blocks into the allow-list. A fence may carry a label and a
lifecycle word — ` ```files <label> closed ` — and closed blocks are pruned: a shipped batch
re-locks its files while the record stays. One open block per in-flight batch. Blocked when:
no active scope · expired · file not in any open block. Always-writeable: every plan's own
`SCOPE.md` + `OUT_OF_SCOPE.md`.
`**Override:** true` on a scope disables enforcement (operator escape). Keep **one** scope active
at a time. If blocked: update SCOPE.md with the operator, or capture to OUT_OF_SCOPE.md and stay
on the original scope, or stop. Never work around it.

## 9. Starting a new plan iteration

```
workspace-bin/new-plan.sh <id> ["one-line goal"]
```

Scaffolds `memory-plan/plans/<id>/` from `canonical/templates/` (tier-1.2 files with `{{PLAN_ID}}`
/`{{GOAL}}`/`{{DATE}}` bound), creates `audits/` + `tick-logs/`, sets `VERSION` to `v0.0`, writes
the `<id>-tick.sh` shim, and runs `sync-canonical.sh` (tier-1.1 docs land). The result is
viewer-discoverable immediately and tick-runnable once you fill in the plan.

Then, before the first step runs (the part no scaffolder can do):

1. **ROADMAP.md** — write the blocks: what phases, in what order, why; each block's exit criterion.
2. **INVENTORY.md** — decompose to atomic grain. Apply the atomicity test to every step: exactly
   one independently-verifiable runtime outcome; needs "and" → split. Every step gets
   **done-evidence** that is runtime-observable, written next to the table.
3. **TICK_PROMPT.md** — fill the `{{...}}` bindings (test command, runtime deploy target, plan
   specifics in required reading).
4. **COMPONENT_REGISTRY.md** — record the verified current state of what the plan will touch
   (reality first: probe, don't assume).
5. **DECISIONS.md** — log D1: why this plan exists and the approach chosen.
6. Set the first step's scope in `SCOPE.md` with the operator, and either work it interactively
   or load the tick plist (Automation tab) to hand it to the chain.

Retiring a plan: set SCOPE Status idle with a close note, leave the silo in place — it is the
complete, portable record of the run (the cowork-bundle property, COWORK_MODEL §2).

## 10. Surface conformance — what "functionally implements" means

Every plan must functionally wire all six file-backed viewer surfaces — populated and parseable,
not merely "missing docs degrade gracefully". The functional bar per surface:

| Surface (tab) | Files | Functional bar |
|---|---|---|
| **master-plan** | `SCOPE.md` · `COMPONENT_REGISTRY.md` · `DECISIONS.md` · `OUT_OF_SCOPE.md` | SCOPE parses (Status/Goal/Expires + ` ```files `); REGISTRY has ≥1 probed, dated row; DECISIONS has ≥ D1; the tab alone answers: what's the contract, what runs, what was chosen, what's deferred. |
| **steps** | `INVENTORY.md` · `audits/stepNN_<slug>/` | Rows in the load-bearing 5-column format; every **open** row carries the §11 contract; every `[A]` step has `AUDIT_PRE.md`, every `[x]` step has `AUDIT_PRE.md`+`AUDIT_POST.md`. |
| **automation** | `automation.json` · `TICK_PROMPT.md` · the `<id>-tick.sh` shim | Valid JSON with the standard keys; `tick_command` exists and is executable; TICK_PROMPT present — and `<FILL` bindings resolved before the chain is enabled. |
| **block** | `BLOCKED.md` (conditional) | Absent (chain runnable), or matching the BLOCK_TEMPLATE shape with **External action:** naming the operator's single concrete move. |
| **documents** | the five synced canonical docs · `ROADMAP.md` | Canonical copies byte-identical with `canonical/` (sync `--check` clean for this silo); ROADMAP present with every block carrying intent + exit criterion. |
| **history** | `tick-logs/` · `VERSION` | Dir exists (ticks write `<ts>.log`/`.jsonl` + `current.log`); VERSION coheres with INVENTORY — `v0.0`, or `vX.Y[-pre|-mid]` pointing at a real row. |

Conformance is **machine-graded** by `workspace-bin/plan-lint.sh <id>`: PASS / WARN / FAIL per
surface, exit 0 only with zero FAILs. Closed (`[x]`) rows predating the §11 contract grade WARN
(grandfathered); open rows without contracts FAIL. The lint runs at scaffold end (new-plan.sh)
and in every tick preflight, so non-conformance is visible at both birth and run time.

## 11. The step contract — extreme atomization

Every **open** INVENTORY row carries a four-field contract in the notes under its table:

```
> **X.Y — Goal:** one sentence, one outcome.
> **Needs:** pre-screen — everything that must already exist (files, services, data, locked decisions).
> **Feeds:** post-use — where this result is consumed (later step / component / viewer surface / operator workflow).
> **Verify:** the enforceable test, tagged by modality — runtime: / code: / visual: — with its WIN threshold.
```

How each field is enforced across the phases (§3):

- **Goal** — the atomicity probe. Needs an "and" between two independently-testable outcomes →
  split the step before opening it.
- **Needs** — verified in **Phase 1** before any design: each Need is checked to exist (file
  present, service up, decision logged). A missing Need → BLOCK naming it; never "build it on
  the way" (that's a hidden second step).
- **Feeds** — checked at **Phase 9**: AUDIT_POST records where the output landed and which
  consumer can now reach it. An output nothing consumes is dead work — if Feeds can't be named
  at planning time, the step doesn't enter the inventory.
- **Verify** — executed in **Phase 5** exactly as written. `runtime:` = probe/command + observed
  threshold; `code:` = test/grep; `visual:` = operator-confirmable UI state — a headless tick
  must BLOCK on visual-only verification, citing it as the **External action:**. The Verify line
  is the step's done-contract instance (MASTER_PLAN §5): unobservable → unclosable.

Atomicity tightened: if **Goal** needs "and" → split. If **Needs** spans two unrelated systems →
split. If **Verify** proves two independent outcomes → split. (Two modalities proving ONE
outcome is fine.) Lineage: redesign's `LOOPS.md` flow framing — connects-with · purpose ·
produces-for · WIN/FAIL — generalized here for every plan.
