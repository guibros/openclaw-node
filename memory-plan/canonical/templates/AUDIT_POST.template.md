# AUDIT_POST.template — the Phase 7 doc for a step

**Canonical template.** Instantiated to
`memory-plan/plans/<id>/audits/stepNN_<slug>/AUDIT_POST.md` at Phase 7, before the Phase 8.5 gate
and the Phase 9 commit. PROTOCOL.md §3 governs when it is written; this file governs its shape.

§7 is present only on the step that closes a block (PROTOCOL.md §5.2 Macro Re-Orient).

---

```markdown
# AUDIT_POST — step <NN> · <step title from INVENTORY.md>

## §1 Promised vs landed

<!-- One row per §6 delta from AUDIT_PRE. Every row reads `yes` or the step is not done — there is
     no "mostly". A `no` row means Phase 9 does not happen. -->

| Promised (AUDIT_PRE §6) | Landed | Where |
|---|---|---|
| <delta> | yes / no | <path:line or command> |

## §2 Greppable deltas

<!-- The command a reviewer runs to see the change, and its first hit. Not a description of the
     change — the proof another person can re-run. -->

| Command | First hit |
|---|---|
| `grep -n '<pattern>' <path>` | `<output line>` |

## §3 Cross-references still valid

- <doc//section that pointed at what this step changed>: <still true / updated here>

## §4 Findings

<!-- Every finding carries a TYPE and a SEVERITY. The type is what kind of gap it is; the severity
     is how much it matters. A finding without both is not reviewable.

     TYPES:
       missing      — required work is absent from the code entirely
       partial      — the work exists but does not yet satisfy the contract
       contradicts  — the code conflicts with a stated principle, DECISION, or this step's intent
       unrequested  — the code contains work no step asked for (surfaced for awareness; this
                      section never deletes code, it produces a carry-forward to justify or remove)

     SEVERITIES:
       CRITICAL — violates a MASTER_PLAN §4 non-negotiable, or a missing/contradicts gap that
                  defeats this step's Verify contract
       HIGH     — missing or partial on this step's own Goal or its Feeds landing
       MEDIUM   — partial on a secondary delta, or unrequested work with unclear justification
       LOW      — polish, or low-risk unrequested work

     Assess the CODE, not the ledger: a row marked `[x]` in INVENTORY.md, a green suite, and a
     commit that says "done" are all completion CLAIMS, and completion claims are not evidence
     (MASTER_PLAN §4.1, §4.7). Re-verify against what is on disk and what the runtime does.

     A CRITICAL finding is not a carry-forward. It is fixed in this step or the step BLOCKS. -->

| ID | Type | Severity | Traces to | Evidence | Remaining work |
|---|---|---|---|---|---|
| F1 | missing / partial / contradicts / unrequested | CRITICAL / HIGH / MEDIUM / LOW | <§11 Need, Verify clause, principle, or DECISION> | <what was observed, where> | <what would close it, or `none — closed here`> |

Counts: `missing` <n> · `partial` <n> · `contradicts` <n> · `unrequested` <n> ·
CRITICAL <n> · HIGH <n> · MEDIUM <n> · LOW <n>

`[POSITIVE]` — <what this step confirmed works, with the evidence>

## §5 Phase-8 patches

<!-- Almost always "none". A patch here is a correction discovered by writing §1-§4, applied in
     Phase 8 before the commit. An architectural choice that was not pre-decided is a BLOCK plus a
     proposed DECISIONS entry, never a patch. -->

- none

## §6 Carry-forwards

<!-- What the next step inherits. Each one names its governing contract so it cannot be quietly
     reinterpreted later; an open finding from §4 arrives here with its type intact. -->

1. <carry-forward — and the contract or finding it descends from>

## §7 Macro re-orient (block close only)

- Block <N> delivered: <one line>
- What the next block assumes that is now true: <one line>
- What is still aspiration: <one line — named, not implied>
```
