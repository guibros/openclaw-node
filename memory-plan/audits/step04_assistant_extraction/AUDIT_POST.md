# AUDIT_POST — Step 0.4: Include assistant-role messages in extraction + add speaker field + new patterns

**Version:** v0.4-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | pre-compression-flush: `stripSpeaker` helper | `lib/pre-compression-flush.mjs:203` | yes | `grep -n 'stripSpeaker' lib/pre-compression-flush.mjs` → lines 203, 281, 295 |
| 2 | pre-compression-flush: two assistant-voice pattern groups (agent_action, finding) | `lib/pre-compression-flush.mjs:160-162` | yes | `grep -n 'agent_action\|finding' lib/pre-compression-flush.mjs` → lines 160, 161, 162 |
| 3 | pre-compression-flush: role filter change (`user` + `assistant`) | `lib/pre-compression-flush.mjs:166` | yes | `grep -n "msg.role !== 'user' && msg.role !== 'assistant'" lib/pre-compression-flush.mjs` → line 166 |
| 4 | pre-compression-flush: `speaker: msg.role` on fact objects | `lib/pre-compression-flush.mjs:180` | yes | `grep -n 'speaker:' lib/pre-compression-flush.mjs` → line 180 |
| 5 | pre-compression-flush: mergeFacts formats with `[speaker]` prefix + strips during comparison | `lib/pre-compression-flush.mjs:275,281,295,296,306,314` | yes | `grep -n 'speakerTag' lib/pre-compression-flush.mjs` → lines 275, 296, 306, 314 |
| 6 | memory-budget.test: `extractFacts assistant extraction` describe block (+5 tests) | `test/memory-budget.test.mjs:338` | yes | `grep -n 'extractFacts assistant' test/memory-budget.test.mjs` → line 338 |

All 6 rows landed = yes. 2 non-audit non-ledger files in staged diff = 2 unique files changed (deltas 1-5 are same file).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'stripSpeaker' lib/pre-compression-flush.mjs` | `203:export function stripSpeaker(text) {` |
| 2 | `grep -n 'agent_action' lib/pre-compression-flush.mjs` | `160:    { re: /(?:I'll|I'm going to|I will|let me)\s+(.{10,80})/i, category: 'agent_action', confidence: 70 },` |
| 3 | `grep -n "msg.role !== 'user' && msg.role !== 'assistant'" lib/pre-compression-flush.mjs` | `166:    if (msg.role !== 'user' && msg.role !== 'assistant') continue;` |
| 4 | `grep -n 'speaker:' lib/pre-compression-flush.mjs` | `180:        facts.push({ fact: factText, category, confidence, speaker: msg.role });` |
| 5 | `grep -n 'speakerTag' lib/pre-compression-flush.mjs` | `275:    const speakerTag = speaker ? \`[\${speaker}] \` : '';` |
| 6 | `grep -n 'extractFacts assistant' test/memory-budget.test.mjs` | `338:describe('extractFacts assistant extraction', () => {` |

## §3 — Cross-references still valid

- `extractFacts` — 3 call sites: definition at `lib/pre-compression-flush.mjs:156`, called from `runFlush` at line 354, tests at `test/memory-budget.test.mjs:338+`. All valid.
- `stripSpeaker` — 3 references: definition at line 203, similarity comparison at line 281, hash computation at line 295. Also imported in test file at line 16. All valid.
- `mergeFacts` — called at line 366 from `runFlush` (no change to call signature — `speaker` field is optional, existing callers without it get `speakerTag = ''`). Tests at line 277+ and 370+. All valid.
- `stripSupersedes` — still used at lines 281, 295 (now combined with `stripSpeaker`). No stale refs.
- Old role filter `msg.role !== 'user'` — searched codebase for this exact string. Zero references remain (replaced with dual-role check). No stale refs.
- `bigramSimilarity` — still used at line 281, now operating on `stripSpeaker(stripSupersedes(entry.text))`. No stale refs.

## §4 — Findings

- [POSITIVE] The role filter change is backward-compatible: existing callers of `extractFacts` get the same behavior for user messages plus new facts from assistant messages. The `speaker` field is additive.
- [POSITIVE] `stripSpeaker` parallels `stripSupersedes` in design — both are pure text transforms that clean metadata before similarity comparison. The composition `stripSpeaker(stripSupersedes(text))` correctly strips both layers.
- [POSITIVE] The `speakerTag` is computed once per fact in `mergeFacts` and used consistently for both new appends and merge replacements. Budget calculation includes `speakerTag.length`.
- [POSITIVE] Assistant-voice patterns are conservative: `agent_action` requires 10-80 char captures after intent verbs, `finding` requires 10-80 char captures after observation verbs. Neither will match raw code blocks or tool output.
- [POSITIVE] The `speaker` field defaults to empty string formatting when absent (`speakerTag = speaker ? \`[\${speaker}] \` : ''`), so existing callers of `mergeFacts` without speaker-tagged facts work unchanged.
- [POSITIVE] 5 new tests cover all critical paths: role inclusion, speaker field presence, pattern matching, tool exclusion, and mergeFacts formatting.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.5

- Test baseline is now 477 tests (404 pass, 73 fail — pre-existing). +5 tests from this step.
- The `confidence` field returned by `extractFacts` is still unused — deferred to Step 0.6 (delete dead artifacts).
- `stripSpeaker` is now exported from `pre-compression-flush.mjs`. Step 0.5 edits to the same file should be aware of the function at line 203.
- Speaker tags in MEMORY.md are formatted as `[user] fact` or `[assistant] fact`. Any future rendering or parsing of MEMORY.md should account for these prefixes.
- The `agent_action` and `finding` pattern categories are new. If downstream consumers filter by category, they may need updating. Currently no consumer filters by category (only `fact` text is used).
- Step 0.5 will add `truncateAtWord` helper — it should be placed near the other helpers (after `stripSpeaker`, before `cleanParentheticalChains`).
