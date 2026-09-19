# AUDIT_POST — step 5.1 · Operating-base amendments borrowed from spec-kit

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Landed | Where |
|---|---|---|
| PROTOCOL §1.1.1 sync-impact header | yes | `canonical/PROTOCOL.md` §1.1.1 |
| PROTOCOL Phase 1 row requires the deviations table | yes | `canonical/PROTOCOL.md` §3 phase table, row `1` |
| PROTOCOL Phase 7 row requires typed + graded findings | yes | `canonical/PROTOCOL.md` §3 phase table, row `7` |
| Both phase rows name their shape template | yes | same two rows |
| MASTER_PLAN §4.11 + §4 preamble routing | yes | `canonical/MASTER_PLAN.md` §4.11, §4 preamble |
| `AUDIT_PRE.template.md` | yes | `canonical/templates/AUDIT_PRE.template.md` |
| `AUDIT_POST.template.md` | yes | `canonical/templates/AUDIT_POST.template.md` |
| plan-lint audit-shape check (surface 2, WARN tier) | yes | `plan-lint.sh`, after the audit-coverage block |
| plan-lint sync-header check (surface 5, FAIL/WARN tiers) | yes | `plan-lint.sh`, after the canonical-staleness loop — two staleness tiers (last-commit and uncommitted-edit), fields scoped to the header block |
| Grading-tier comment extended | yes | `plan-lint.sh` header comment |
| Sync to six silos | yes | `sync-canonical.sh` → 12 files; `--check` rc 0 |
| Plan ledger (ROADMAP, INVENTORY, DECISIONS, audits) | yes | Block 5 / row 5.1 / D18 / this pair |

## §2 Greppable deltas

| Command | First hit |
|---|---|
| `grep -n '1.1.1 Sync-impact header' memory-plan/canonical/PROTOCOL.md` | `#### 1.1.1 Sync-impact header — required on every canonical edit` |
| `grep -n '4.11 A deviation is written down' memory-plan/canonical/MASTER_PLAN.md` | `### 4.11 A deviation is written down or it doesn't happen` |
| `grep -rn 'Type | Severity' memory-plan/canonical/templates/AUDIT_POST.template.md` | the §4 findings table header |
| `grep -n 'sync-impact header' workspace-bin/plan-lint.sh` | the surface-5 check block |
| `workspace-bin/sync-canonical.sh --check` | `all plan copies up to date` |

## §3 Cross-references still valid

- `PROTOCOL.md` §3 Phase 8.5 gate ⑥ ("runtime evidence captured and real"): still true, and now visibly strained for a docs-only step — §4 F3 records the substitution rather than hiding it.
- `plan-lint.sh` grading-tier header comment: updated in this edit to describe both new tiers, so the script still documents its own grandfathering policy.
- `CLAUDE.md` / `AGENTS.md` bootstrap reading order: unchanged — both already route the reader to the canonical docs, which now carry the new sections.

## §4 Findings

| ID | Type | Severity | Traces to | Evidence | Remaining work |
|---|---|---|---|---|---|
| F1 | contradicts | HIGH | PROTOCOL §3 Phase 1 ("`AUDIT_PRE.md` … No production work yet") | No `audits/step45_consolidation_performance/` directory exists, though `SCOPE.md` has reserved the path since 2026-09-14 and row 4.5 has been `[A]` since. Step 4.5's code shipped in PR #19 with no Phase 1 doc. | Operator's call. Not fixed here: retro-writing another step's AUDIT_PRE after its code shipped would manufacture the record, which is the failure this base exists to prevent. Raised in chat. |
| F2 | partial | MEDIUM | This step's own Goal ("`plan-lint.sh` grades all three") | The audit-shape check is WARN-only, so a new audit that skips the typed table is reported, not refused. Two of three amendments have FAIL teeth (sync-header staleness/malformation); the third does not. | A FAIL tier once no pre-taxonomy audit remains open, or a `plan-tick.sh` close-gate. Carried forward. |
| F3 | partial | MEDIUM | MASTER_PLAN §4.1 / §4.7 | Runtime evidence for this step is operator assent, not a host probe — recorded in the AUDIT_PRE deviations table and in the §11 Verify contract. `VERSION` also stays at `v4.4`: the carrier is single-valued and 4.5 owns the next number, so moving it to `v5.1-mid` would make 4.5's eventual close read as a regression. | Both resolve when 4.5 closes and the carrier is free. Carried forward. |
| F4 | partial | LOW | PROTOCOL §1.1.1 | Three of five canonical docs (`FRAMEWORK_CANONICAL.md`, `COWORK_MODEL.md`, `BLOCK_TEMPLATE.md`) carry no sync-impact header, so §1.1.1 is enforced on 2 of 5 docs today. Deliberate: the rule binds the next edit, and back-filling headers for edits nobody reviewed would be fabricated provenance. | None — resolves naturally as each doc is next edited. |

Counts: `missing` 0 · `partial` 3 · `contradicts` 1 · `unrequested` 0 · CRITICAL 0 · HIGH 1 · MEDIUM 2 · LOW 1

`[POSITIVE]` — both sync-header FAIL branches were executed, not assumed. Backdating `canonical/PROTOCOL.md`'s header to `2020-01-01` produced `[FAIL] … stale or malformed sync-impact header (§1.1.1)` naming the reason (`header dated 2020-01-01 but doc last committed 2026-07-18`). Dating it `2026-09-18` — newer than the last commit, so the first tier stays quiet — produced the second tier's reason (`uncommitted edit present but header dated 2026-09-18, not today (2026-09-19)`). Both restored to PASS afterwards, `sync-canonical.sh --check` rc 0, `bash -n plan-lint.sh` clean.

`[POSITIVE]` — the baseline this step measures itself against was verified rather than recalled: `git stash push -u` to pristine HEAD, `plan-lint.sh protocol --summary` → `15P/3W/2F`, then `git stash pop`. The post-change verdict is `17P/4W/2F` — two new PASSes and one new WARN, with the FAIL count unchanged at the two known gitignored-artifact failures (`automation.json`, `tick-logs/`). The arithmetic had already predicted this, which is exactly why measuring it was worth the two commands.

`[POSITIVE]` — both new templates were instantiated by this audit pair rather than shipped untested; the §4 table above is the taxonomy's first real use, and it immediately surfaced F1, a defect in already-shipped work that the old binary `[POSITIVE]`/`[NEGATIVE]` vocabulary had no slot for.

## §5 Phase-8 patches

- none

## §6 Carry-forwards

1. **F1 — step 4.5 has no AUDIT_PRE.** Operator decides: accept the gap on the record, or block 4.5's close until a Phase 1 doc is written honestly (dated now, stating it was written after the fact).
2. **F2 — the audit-shape check has no teeth.** Promote to FAIL once no pre-taxonomy audit is open, or move the gate into `plan-tick.sh`'s close refusal, which already refuses a close on a red suite or a missing `Runtime-Evidence:` trailer.
3. **F3 — the version carrier is contested.** When 4.5 closes, `VERSION` goes to `v4.5`, then `v5.1` needs its own close; sequence them rather than letting the carrier skip.
4. **A `converge`-style repo-vs-plan gap assessor was considered and rejected here** (a build, not an amendment; overlaps AUDIT_POST §6). If it is ever wanted, spec-kit's `templates/commands/converge.md` is the reference, and its append-only constraint is the part worth copying.

## §7 Macro re-orient (block close only)

Not applicable — Block 5 opens with this step and is not closed by it.
