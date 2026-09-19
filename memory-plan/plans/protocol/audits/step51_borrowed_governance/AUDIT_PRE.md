# AUDIT_PRE — step 5.1 · Operating-base amendments borrowed from spec-kit

## §0 Re-orient

- Where am I: Block 5, step 5.1, opening a new block while 4.5 remains `[A]` (see Principle Deviations).
- Last step changed: 4.5 made the consolidation hard-cap overrun attributable by phase; its runtime proof is still the operator's.
- This step contributes: three named holes in the operating base closed in canonical text, each graded by `plan-lint.sh`.
- Serves the north star via: the base is what keeps every other plan honest; an unenforced base is the May-2026 failure mode with extra paperwork.
- Still the right next step? Yes — 4.5 cannot advance without the operator, and this silo's whole subject is the base itself.

## §1 Needs pre-screen

- Operator approval: received 2026-09-19 — "steal the good parts", chosen against a read-only comparison whose preview named `memory-plan/canonical/*` and a new INVENTORY row as the scope consequence.
- `github/spec-kit` readable: cloned shallow at `d4229c0` (2026-09-18), 584 files, `LICENSE` = MIT, Copyright GitHub, Inc. Read directly, not from recall.
- Amendment points exist: `canonical/PROTOCOL.md` §1.1/§3 phase table and `canonical/MASTER_PLAN.md` §4 confirmed present at the expected shape; `plan-lint.sh` surfaces 2 (steps) and 5 (documents) confirmed as the grading sites, with `$CANON` already in scope in that script (so no new dependency).
- Baseline lint recorded before any edit: protocol 15P/3W/2F, the two FAILs being `automation.json` and `tick-logs/` — gitignored host artifacts absent from any fresh clone, identical on untouched silos.

## Principle Deviations

| Principle | Why this step needs the deviation | Simpler alternative rejected because |
|---|---|---|
| PROTOCOL §3 Phase 9 — "STOP, one step per work unit" (two concurrent `[A]` rows: 4.5 and 5.1) | 4.5 is stalled on two things this session cannot supply: operator runtime evidence on the live host, and a dependency-lockfile fix outside its scope. Holding the base idle behind an operator-gated step would mean the base never gets amended. | Closing 4.5 first is not available — its Verify contract demands a real host cycle, and manufacturing that evidence is the cardinal failure this whole protocol exists to prevent. Deferring 5.1 until 4.5 closes was the alternative; rejected because the blocker has no date. |
| MASTER_PLAN §4.2 — "One scope per session" (a second open ` ```files ` block in the one active SCOPE.md) | The amendment touches canonical docs and the lint script, none of which are in 4.5's allow-list. A second labelled block keeps the two batches separately auditable and separately closable. | Replacing 4.5's block outright was rejected: 4.5 is in-flight, and revoking its write scope mid-step would leave it unable to respond to review. Exactly one SCOPE.md is active either way, and open allow-list entries went 20 → 29, still inside the lint's 40-entry hygiene threshold. |
| MASTER_PLAN §4.1 / §4.7 — runtime evidence, not tests, closes a step | This step's deliverable *is* governance text. There is no deployed representation of `canonical/PROTOCOL.md` in `~/.openclaw/workspace/` to probe, so "does the runtime do the new thing" has no referent beyond the lint verdict. | Inventing a host probe would produce a number that proves nothing about whether the amendment is correct. Instead the Verify contract names operator assent as the runtime evidence and says so explicitly, so the substitution is visible rather than silent. |

## §4 Risks

- Borrowing prose without a check reproduces spec-kit's own weakness: its `converge.md` *asks* the agent to read `.specify/extensions.yml` and honour mandatory hooks, and an agent that skips the read simply proceeds. Every amendment here must land as a graded check or it is decoration.
- A check with no teeth is worse than no check, because it reports PASS. Conversely a check that FAILs on closed history nags forever and gets ignored — both failure modes must be chosen against deliberately, per amendment, and written into the script's grading comment.
- Editing canonical docs fans into six silos via `sync-canonical.sh`; forgetting the sync leaves every silo FAILing `stale canonical copy` and the amendment only half-landed.
- The new §4 finding vocabulary uses ordinary English words (`missing`, `partial`). A lint check grepping for those words would false-positive on any audit prose; it must match the table structure instead.

## §6 File deltas

- `canonical/PROTOCOL.md`: new §1.1.1 (sync-impact header); Phase 1 row requires the deviations table; Phase 7 row requires typed + graded findings assessed against code; both rows name their shape template. Plus its own sync-impact header.
- `canonical/MASTER_PLAN.md`: new §4.11 (a deviation is written down or it doesn't happen); §4 preamble routes the bounded case to it. Plus its own sync-impact header.
- `canonical/templates/AUDIT_PRE.template.md`, `canonical/templates/AUDIT_POST.template.md`: new — the shapes the two phase rows now point at.
- `workspace-bin/plan-lint.sh`: audit-shape check (surface 2, WARN tier) + sync-impact header check (surface 5, FAIL on stale/malformed, WARN on absent); grading-tier comment extended.
- `memory-plan/plans/*/{MASTER_PLAN,PROTOCOL}.md`: mechanical `sync-canonical.sh` output, six silos.
- Plan ledger: ROADMAP Block 5, INVENTORY Block 5 + row 5.1 + §11 contract, DECISIONS D18, this audit pair, `VERSION`.

## Mid-Implementation Findings

- The check with teeth needed proving, not asserting. Backdated `canonical/PROTOCOL.md`'s header to `2020-01-01`, confirmed `[FAIL] documents 1 canonical doc(s) with a stale or malformed sync-impact header (§1.1.1)` with the precise reason (`header dated 2020-01-01 but doc last committed 2026-07-18`), then restored the date and re-confirmed PASS. Without this the FAIL branch would have shipped unexecuted.
- An adversarial re-read of the finished lint diff found the sync-header check weaker than its own comment claimed, in two ways, both fixed in this step rather than carried: (a) comparing the header date only against the doc's **last commit** catches a stale header one commit *late* — an edit made today against a header already dated the last commit's day passed, and would have failed only after landing; a second tier now requires an uncommitted edit to carry a header dated today, and the branch was proven by dating the header 2026-09-18 and observing `uncommitted edit present but header dated 2026-09-18, not today (2026-09-19)`. (b) The required fields were grepped across the whole file, so a doc whose *body* contained "Change:" would have satisfied the check; field matching is now scoped to the header block (line 1 through the first `-->`), which is where §1.1.1 puts it. Also made the missing-field message accumulate every missing field rather than reporting only the last.
- The audit-shape check PASSes once a single audit carries the typed table, so its message reports the ratio (`1/13 POST typed`) rather than a bare verdict. That is the honest reading of a landed-vs-adopted signal, and the WARN tier is documented as advisory in the script's grading comment — but it does mean the check answers "has the taxonomy landed", not "is every audit typed". Recorded as AUDIT_POST §4 F2.
- No `audits/step45_consolidation_performance/` directory exists, though `SCOPE.md` reserves the path and 4.5 has been `[A]` since 2026-09-14. Step 4.5 therefore has no AUDIT_PRE despite Phase 1 requiring one before production work. This is a finding against 4.5, not this step's to fix — recorded in this step's AUDIT_POST §4 as `contradicts` and raised to the operator, since retro-writing another step's Phase 1 doc after its code shipped would be manufacturing the record rather than keeping it.
