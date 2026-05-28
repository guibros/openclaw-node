# Workflow — From Master Plan to Shipped Code

**Date:** 2026-05-28. This is the connective tissue: how an intent becomes a deployed, observed change. It marries the new discipline layer (MASTER_PLAN + scope-hook + runtime-evidence) with the old 9-phase execution rigor (FRAMEWORK.md) so neither is bypassed.

If you only read one thing before working a redesign step: read this, then the step's row in `INVENTORY.md`, then open a SCOPE.md for it.

---

## 1. The five layers (top governs bottom)

```
┌─ LAYER 1 — GOVERNANCE ────────────────────────────────────────────────────┐
│ ../MASTER_PLAN.md   principles · done-contract (runtime evidence) · forbidden│
│ ../DESIGN_INPUTS.md the taste check (Karpathy LLM-Wiki · one-hop · no bullshit)│
└───────────────────────────────────────┬───────────────────────────────────┘
                                         │ constrains
┌─ LAYER 2 — ROADMAP ─────────────────────▼──────────────────────────────────┐
│ ../MEMORY_REDESIGN.md   phases L0..G (the "blocks") · derived from ../DECISIONS│
└───────────────────────────────────────┬───────────────────────────────────┘
                                         │ decomposes into
┌─ LAYER 3 — STEP LIST ───────────────────▼──────────────────────────────────┐
│ redesign/INVENTORY.md   atomic steps vX.Y · one step = one 9-phase = one commit│
└───────────────────────────────────────┬───────────────────────────────────┘
                                         │ executed by
┌─ LAYER 4 — EXECUTION ───────────────────▼──────────────────────────────────┐
│ ../FRAMEWORK.md (the 9 phases) + ../SCOPE.md + .claude/hooks/scope-check.sh   │
│ each step: AUDIT_PRE → implement → VERIFY(tests + runtime) → AUDIT_POST →     │
│            Deep Review Gate (+runtime-evidence) → commit                      │
└───────────────────────────────────────┬───────────────────────────────────┘
                                         │ reflected in
┌─ LAYER 5 — TRUTH & OBSERVABILITY ───────▼──────────────────────────────────┐
│ ../COMPONENT_REGISTRY.md (current state) · ../DECISIONS.md (choices) ·        │
│ workplan-viewer :7892 (renders inventory + audits + Master Plan tab) ·        │
│ the memory-watcher (Block 2 — once built, watches the system it tracks)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. The chain — how a decision becomes shipped code

```
DESIGN_INPUTS (intent)
   → DECISIONS (locked choice)
      → MEMORY_REDESIGN (which phase/block)
         → INVENTORY (which atomic step)
            → SCOPE.md (today's contract: this step's files + done-evidence; hook now gates)
               → 9-phase execution (FRAMEWORK)
                  → VERIFY includes runtime evidence (deploy + restart + observe)
                     → COMPONENT_REGISTRY updated (component moves toward LIVE)
                        → one commit (the step closes)
                           → viewer shows it closed; next step unblocks
```

Every arrow is auditable. If a step exists with no DECISIONS/REGISTRY basis, it shouldn't be in the inventory. If a commit exists with no closed step, the framework was bypassed.

## 3. The per-step lifecycle (old 9-phase + new discipline, merged)

For each `INVENTORY.md` step, in order. **Bold = added by the new discipline on top of the old FRAMEWORK.**

| Phase | Action | Source |
|---|---|---|
| Pre-flight | Pick next `[ ]` step. Clean tree. Read MASTER_PLAN + the step's MEMORY_REDESIGN phase + prior step's AUDIT_POST §6. | FRAMEWORK §8 |
| **Scope** | **Open/refresh `../SCOPE.md`: goal = this step; files = this step's deltas; runtime-evidence = this step's done-evidence. The hook now physically blocks edits outside the file set.** | **MASTER_PLAN §6** |
| 1 | **AUDIT_PRE** — intent, design decisions (consume carry-forwards), risk register, file-delta outline. | FRAMEWORK |
| 4 | Implement every §6 delta. No scope creep — surprises go to `../OUT_OF_SCOPE.md`, not silent expansion. | FRAMEWORK + **MASTER_PLAN §4.3** |
| 5 | **VERIFY = (a) tests green at baseline [old] + (b) RUNTIME EVIDENCE [new]: deploy to `~/.openclaw/workspace/`, restart the service, observe the new behavior in logs / the watcher / a DB query / an HTTP probe.** | FRAMEWORK + **MASTER_PLAN §4.1, §5** |
| 7 | **AUDIT_POST** — files-vs-plan ledger, greppable deltas, cross-refs, findings, carry-forwards. | FRAMEWORK |
| 8 | Corrections (usually none). Architectural choice needed → BLOCK + log in DECISIONS. | FRAMEWORK |
| 8.5 | **DEEP REVIEW GATE — the 5 checks [old] + a 6th: runtime evidence cited.** Any fail → BLOCK, no commit. | FRAMEWORK + **new** |
| 9 | Commit (one). Flip INVENTORY `[A]`→`[x]`. **Update COMPONENT_REGISTRY (component status). Set SCOPE status=done. Log any DECISIONS.** | FRAMEWORK + **new** |

One commit per step. No mid-step commits, no amends, no force-push (FRAMEWORK §4). After the commit, STOP — one step per work unit.

## 4. What's different from the old framework (why this isn't just FRAMEWORK.md v2)

The old framework closed 59 steps with zero gate failures — and produced ~0 working production change, because "done" meant "committed + tests green," and the runtime was never updated. The five additions fix exactly that:

1. **Done = runtime-observable** (Phase 5b + Gate check 6). A step that compiles and passes tests but doesn't change the running system is NOT done.
2. **Scope contract + hook** physically gates each step's files. No drift, no "while I'm here."
3. **No parallel implementations / no work outside the inventory** (MASTER_PLAN §4.6, §4.10). The thing that produced the dead `bin/openclaw-memory-daemon.mjs` is forbidden.
4. **COMPONENT_REGISTRY is living truth**, updated per step — so "what actually runs" is never a mystery again.
5. **DESIGN_INPUTS taste check** — a step that fails the Karpathy-wiki intent or the one-hop bar needs an explicit DECISIONS entry before it's built.

## 5. The viewer's role

The workplan-viewer (:7892) makes the whole chain visible:
- **Legacy tabs** (Live / Steps / Documents / History) render this plan's `INVENTORY.md` + the per-step `audits/` exactly as they did for the old framework.
- **Master Plan tab** (built 2026-05-27) renders `../SCOPE.md` + `../COMPONENT_REGISTRY.md` + `../DECISIONS.md` + `../OUT_OF_SCOPE.md`.
- Once **Block 2 (memory-watcher)** ships, the system being tracked also reports its own live operations — the viewer shows the plan, the watcher shows the running reality.

One glance = where we are (version), what's next (first `[ ]` step), what's broken (registry badges), what we decided (decisions), what's deferred (out-of-scope).

## 6. Starting a step (the checklist)

```
[ ] git tree clean; on main
[ ] read ../MASTER_PLAN.md + this step's phase in ../MEMORY_REDESIGN.md
[ ] open ../SCOPE.md: goal=step, files=deltas, evidence=step's done-evidence, status=active
[ ] Phase 1 AUDIT_PRE in redesign/audits/stepNN_<slug>/
[ ] Phase 4 implement (only files in SCOPE; surprises → OUT_OF_SCOPE)
[ ] Phase 5 tests green + DEPLOY + RESTART + OBSERVE (capture the evidence)
[ ] Phase 7 AUDIT_POST
[ ] Phase 8 corrections (or BLOCK)
[ ] Phase 8.5 Deep Review Gate (5 checks + runtime-evidence)
[ ] Phase 9 commit + flip INVENTORY + update REGISTRY + SCOPE done + log DECISIONS
[ ] STOP
```
