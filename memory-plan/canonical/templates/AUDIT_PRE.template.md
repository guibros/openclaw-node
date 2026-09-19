# AUDIT_PRE.template — the Phase 1 doc for a step

**Canonical template.** Instantiated by hand (or by `new-plan.sh`) to
`memory-plan/plans/<id>/audits/stepNN_<slug>/AUDIT_PRE.md` at the start of Phase 1, before any
production work. PROTOCOL.md §3 governs when it is written; this file governs its shape.

Section numbers are inherited from the framework's phase numbering and are deliberately
non-contiguous (§0, §1, §4, §6). Do not renumber them to look tidy — cross-references in older
audits point at these numbers. Sections with no number (`Principle Deviations`,
`Mid-Implementation Findings`) are appended as the step runs.

---

```markdown
# AUDIT_PRE — step <NN> · <step title from INVENTORY.md>

## §0 Re-orient

<!-- PROTOCOL.md §5. Five lines, answered honestly. If the last answer is "no", BLOCK. -->

- Where am I: <block, step, what immediately preceded it>
- Last step changed: <one line>
- This step contributes: <one line — the single observable delta>
- Serves the north star via: <one line tracing to MASTER_PLAN>
- Still the right next step? <yes + why · or no → stop and re-plan>

## §1 Needs pre-screen

<!-- Every Need in this step's §11 contract, verified to EXIST right now. Not "should exist" —
     checked. A missing Need is a BLOCK, not a risk to manage. -->

- <Need>: <how it was verified, with the observed value>
- <Need>: <...>

## Principle Deviations

<!-- Fill ONLY if this step must deviate from a MASTER_PLAN §4 non-negotiable. An empty table is
     the normal case and is left in place as evidence the question was asked.

     A deviation recorded here is APPROVED and bounded. It is not drift, so it does not belong in
     OUT_OF_SCOPE.md; and it is not silent, so it does not get to happen without this row. If the
     principle itself is wrong, that is a MASTER_PLAN amendment (§4.10) and a DECISIONS entry —
     not a row here. Never widen a principle by reinterpreting it in this table. -->

| Principle | Why this step needs the deviation | Simpler alternative rejected because |
|---|---|---|
| <e.g. §4.6 no parallel implementations> | <the concrete need> | <why the simpler path does not work> |

## §4 Risks

<!-- What could make this step wrong, not what could make it slow. Each risk names the failure
     mode, so Phase 5 can check for it. -->

- <risk — and the failure mode it produces>

## §6 File deltas

<!-- The outline Phase 4 is allowed to implement, and nothing else. Phase 8.5 gate ② greps every
     one of these; gate ③ refuses a staged diff containing anything not listed here. -->

- <area>: <delta>

## Mid-Implementation Findings

<!-- Appended during Phase 4 when reality disagrees with the plan. A surprise lands here (and/or
     in OUT_OF_SCOPE.md) with its justification. Silent scope growth is the thing this section
     exists to make impossible. -->

- <finding, and why handling it here is required rather than scope growth>
```
