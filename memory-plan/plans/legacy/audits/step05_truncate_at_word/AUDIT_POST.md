# AUDIT_POST — Step 0.5: Fix mid-word truncation via truncateAtWord helper

**Version:** v0.5-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | pre-compression-flush: `truncateAtWord` helper after `stripSpeaker` | `lib/pre-compression-flush.mjs:212` | yes | `grep -n 'truncateAtWord' lib/pre-compression-flush.mjs` → lines 173, 212 |
| 2 | pre-compression-flush: replace `.slice(0, 120)` with `truncateAtWord` call | `lib/pre-compression-flush.mjs:173` | yes | `grep -n 'truncateAtWord(match' lib/pre-compression-flush.mjs` → line 173; `grep -n '\.slice(0, 120)' lib/pre-compression-flush.mjs` → no matches |
| 3 | memory-budget.test: `truncateAtWord` describe block (+4 tests) | `test/memory-budget.test.mjs:398` | yes | `grep -n 'truncateAtWord' test/memory-budget.test.mjs` → lines 16, 398, 401, 406, 419, 426 |

All 3 rows landed = yes. 2 non-audit non-ledger files in staged diff = 2 unique files changed (deltas 1-2 are same file).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'truncateAtWord' lib/pre-compression-flush.mjs` | `173:        const factText = truncateAtWord(match[0].trim(), 120);` |
| 2 | `grep -n '\.slice(0, 120)' lib/pre-compression-flush.mjs` | (no matches — old pattern removed) |
| 3 | `grep -n "describe('truncateAtWord" test/memory-budget.test.mjs` | `398:describe('truncateAtWord', () => {` |

## §3 — Cross-references still valid

- `truncateAtWord` — 2 references in source: definition at `lib/pre-compression-flush.mjs:212`, call site at line 173. Imported in test at line 16, used in 4 tests. All valid.
- `extractFacts` — still defined at line 144, called from `runFlush` at line 355, tests at line 338+. The change at line 173 is internal to `extractFacts`. Call signature unchanged. All valid.
- `stripSpeaker` — still at line 203 (shifted from original position due to insertion of `truncateAtWord` after it at line 212). No stale refs.
- `cleanParentheticalChains` — still present (shifted to line 222 from original 212 due to insertion). No stale refs.
- Searched for `.slice(0, 120)` across codebase — zero references remain. No stale pattern.

## §4 — Findings

- [POSITIVE] `truncateAtWord` follows the same pure-function pattern as `stripSpeaker` and `stripSupersedes`: no side effects, text in → text out. Consistent style with existing helpers.
- [POSITIVE] The 0.7 threshold correctly handles the URL/long-word edge case. For a 120-char max, the fallback triggers when the last space is before position 84. This means URLs (typically captured by the 80-char URL pattern) will hard-slice only if they exceed 120 chars, which is rare.
- [POSITIVE] Existing callers of `extractFacts` see no API change — the return type is the same, only the content of the `fact` field is cleaner (word-aligned instead of mid-word cut).
- [POSITIVE] 4 new tests cover all branches: passthrough (short text), word-boundary (normal case), hard-slice fallback (long word), and exact-length boundary.
- [POSITIVE] The function is exported, making it available for future callers (e.g., if `mergeFacts` or other text formatting needs word-aligned truncation).
- [POSITIVE] Zero mid-implementation findings. All three deltas landed exactly as specified in AUDIT_PRE §6.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.6

- Test baseline is now 481 tests (408 pass, 73 fail — pre-existing). +4 tests from this step.
- `truncateAtWord` is exported from `pre-compression-flush.mjs` at line 212. Step 0.6 edits to the same file should be aware of this function and the shifted line numbers.
- The `confidence` field returned by `extractFacts` is still unused — Step 0.6 will delete it (per its inventory description: "Delete dead artifacts ... confidence field").
- `stripSpeaker` has shifted to line 203 (unchanged), `cleanParentheticalChains` to line 222 (shifted +10 lines from `truncateAtWord` insertion).
- All other helpers (`stripSupersedes`, `bigramSimilarity`) remain at their prior relative positions.
