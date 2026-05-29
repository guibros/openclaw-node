# AUDIT_POST — Step 0.3: Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup)

**Version:** v0.3-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | pre-compression-flush: `stripSupersedes` helper | `lib/pre-compression-flush.mjs:191` | yes | `grep -n 'stripSupersedes' lib/pre-compression-flush.mjs` → lines 191, 268, 282 |
| 2 | pre-compression-flush: `cleanParentheticalChains` function | `lib/pre-compression-flush.mjs:200` | yes | `grep -n 'cleanParentheticalChains' lib/pre-compression-flush.mjs` → lines 200, 258 |
| 3 | pre-compression-flush: `mergeFacts()` rewrite (supersedes-comment model + cleanup call + similarity adjustment) | `lib/pre-compression-flush.mjs:256-289` | yes | `grep -n 'supersedes:' lib/pre-compression-flush.mjs` → lines 188, 192, 283 |
| 4 | memory-budget.test: `mergeFacts parenthetical regression` describe block (+5 tests) | `test/memory-budget.test.mjs:277` | yes | `grep -n 'mergeFacts parenthetical' test/memory-budget.test.mjs` → line 277 |

All 4 rows landed = yes. 2 non-audit non-ledger files in staged diff = 2 unique files changed (deltas 1-3 are same file).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'stripSupersedes' lib/pre-compression-flush.mjs` | `191:export function stripSupersedes(text) {` |
| 2 | `grep -n 'cleanParentheticalChains' lib/pre-compression-flush.mjs` | `200:export function cleanParentheticalChains(content) {` |
| 3 | `grep -n 'supersedes:' lib/pre-compression-flush.mjs` | `283:      const replacement = \`${fact} <!-- supersedes: ${oldHash} -->\`;` |
| 4 | `grep -n 'mergeFacts parenthetical' test/memory-budget.test.mjs` | `277:describe('mergeFacts parenthetical regression', () => {` |

## §3 — Cross-references still valid

- `(updated:` — searched entire codebase for `(updated:` in source files. Zero references in source code. The only references are this audit doc. The old merge format is fully removed.
- `mergeFacts` — 3 call sites: `lib/pre-compression-flush.mjs:256` (definition), `lib/pre-compression-flush.mjs:316` (called from `runFlush`), `test/memory-budget.test.mjs:277+` (tests). All valid.
- `bigramSimilarity` — still used in `mergeFacts` at line 268. No stale refs.
- `crypto` import — new import at line 20, consumed at line 282. No stale.

## §4 — Findings

- [POSITIVE] The supersedes-comment model produces fixed-size overhead (~35 chars) per merge regardless of merge count. The old parenthetical model grew linearly with each merge.
- [POSITIVE] `cleanParentheticalChains` correctly strips nested chains: `original (updated: newer (updated: newest))` → `newest`. The innermost (most recent) fact survives.
- [POSITIVE] `stripSupersedes` is used in both similarity comparison (line 268) and hash computation (line 282), ensuring the HTML comment never pollutes the dedup logic.
- [POSITIVE] The working entry list (`entries`) is updated in-place after each merge (lines 286-287), so subsequent merges in the same `mergeFacts` call see the updated text. This prevents stale comparisons.
- [POSITIVE] The `crypto` import uses Node.js built-in — no new dependency. Consistent with Block 0 frozen decision "no new top-level dependencies."
- [POSITIVE] 5 new tests cover the core scenarios: 10-merge regression, nested chain cleanup, supersedes presence, stripSupersedes utility, and no-chain passthrough.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.4

- Test baseline is now 472 tests (399 pass, 73 fail — pre-existing). +5 tests from this step.
- The `confidence` field returned by `extractFacts` is still unused — deferred to Step 0.6 (delete dead artifacts).
- `extractFacts` still filters `role === 'user'` only. Step 0.4 will change this to include assistant messages + add speaker field.
- The `crypto` import in `pre-compression-flush.mjs` is now at line 20. Step 0.4 edits to the same file should be aware of the shifted line numbers.
- `cleanParentheticalChains` runs on every `mergeFacts` call. This is idempotent and low-cost, but if performance becomes a concern (unlikely — MEMORY.md is small), it could be gated behind a flag. Deferred.
