# AUDIT_PRE — Step 0.5: Fix mid-word truncation via truncateAtWord helper

**Version:** v0.5-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Replace the hard `.slice(0, 120)` in `extractFacts` (line 173 of `lib/pre-compression-flush.mjs`)
with a word-boundary-aware `truncateAtWord(text, maxLen)` helper. The current code can cut words
mid-syllable, producing broken fact entries in MEMORY.md like `"switching to the new authenticati"`.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.5 | v0.5 | [A] | Fix mid-word truncation via truncateAtWord helper |

## §3 — Design decisions (consumed from Step 0.4 AUDIT_POST §6)

- Test baseline is 477 tests (404 pass, 73 fail — pre-existing). +5 tests from Step 0.4.
- The `confidence` field returned by `extractFacts` is still unused — deferred to Step 0.6.
- `stripSpeaker` is exported from `pre-compression-flush.mjs` at line 203. New helper placement should be aware of this.
- Speaker tags in MEMORY.md are formatted as `[user] fact` or `[assistant] fact`.
- The `agent_action` and `finding` pattern categories are new. No downstream consumer filters by category.
- `truncateAtWord` should be placed after `stripSpeaker` (line 205) and before `cleanParentheticalChains` (line 212), per carry-forward guidance.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| `truncateAtWord` returns shorter strings than before, changing dedup hashes | LOW | The 0.7 threshold prevents absurdly short truncations. Existing MEMORY.md entries are not re-truncated — only new extractions use the helper. Dedup compares new facts against existing entries, so shorter new facts may score differently, but this is strictly better (cleaner text). |
| Edge case: text with no spaces at all (e.g. a long URL) | LOW | The 0.7 fallback threshold means if `lastSpace` is too early (< 70% of maxLen), we fall back to hard slice. URLs are captured by dedicated patterns with their own 80-char limit, so 120-char truncation rarely applies to them. |

No HIGH-severity risks.

## §5 — Deferrals

- None. This is a self-contained text utility change.

## §6 — Phase 4 implementation outline

| # | File | Delta description |
|---|------|-------------------|
| 1 | `lib/pre-compression-flush.mjs` | Add `truncateAtWord(text, maxLen)` helper function after `stripSpeaker` (line 205) and before `cleanParentheticalChains` (line 212). Export it. |
| 2 | `lib/pre-compression-flush.mjs` | Replace `match[0].trim().slice(0, 120)` at line 173 with `truncateAtWord(match[0].trim(), 120)`. |
| 3 | `test/memory-budget.test.mjs` | Add `truncateAtWord` to import statement. Add `describe('truncateAtWord')` block with tests: short text passthrough, word-boundary truncation, long-word fallback, exact-length passthrough. |
