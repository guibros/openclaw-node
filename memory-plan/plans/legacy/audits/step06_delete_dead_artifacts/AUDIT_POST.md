# AUDIT_POST — Step 0.6: Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field)

**Version:** v0.6-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | pre-compact.sh: remove STATE_FILE + dead write block | `.claude/hooks/pre-compact.sh:10` | yes | `grep -n 'Dead write' .claude/hooks/pre-compact.sh` → line 10; `grep -n 'STATE_FILE' .claude/hooks/pre-compact.sh` → no matches |
| 2 | session-recap: delete FINGERPRINT_FILE, extractFingerprint, writeFingerprint, fingerprint caller | `workspace-bin/session-recap` (lines removed) | yes | `grep -n 'FINGERPRINT_FILE\|extractFingerprint\|writeFingerprint' workspace-bin/session-recap` → no matches |
| 3 | auto-checkpoint: delete ACTIVITY_FILE + touch | `workspace-bin/auto-checkpoint` (lines removed) | yes | `grep -n 'ACTIVITY_FILE\|frontend-activity' workspace-bin/auto-checkpoint` → no matches |
| 4 | pre-compression-flush: remove confidence from patterns, destructuring, fact push, JSDoc | `lib/pre-compression-flush.mjs:142,150-162,169,180,276` | yes | `grep -n 'confidence' lib/pre-compression-flush.mjs` → no matches |
| 5 | test: add 1 regression test for no confidence property | `test/memory-budget.test.mjs:430` | yes | `grep -n 'confidence removal' test/memory-budget.test.mjs` → line 430 |

All 5 rows landed = yes. 5 non-audit non-ledger files in staged diff = 5 unique files changed.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'Dead write' .claude/hooks/pre-compact.sh` | `10:# Dead write to .pre-compact-state.md removed (Step 0.6).` |
| 1b | `grep -n 'STATE_FILE' .claude/hooks/pre-compact.sh` | (no matches — removed) |
| 2 | `grep -n 'FINGERPRINT_FILE\|extractFingerprint\|writeFingerprint' workspace-bin/session-recap` | (no matches — removed) |
| 3 | `grep -n 'ACTIVITY_FILE\|frontend-activity' workspace-bin/auto-checkpoint` | (no matches — removed) |
| 4 | `grep -n 'confidence' lib/pre-compression-flush.mjs` | (no matches — removed) |
| 5 | `grep -n 'confidence removal' test/memory-budget.test.mjs` | `430:describe('extractFacts confidence removal', () => {` |

## §3 — Cross-references still valid

- `STATE_FILE` / `.pre-compact-state.md` — removed from `pre-compact.sh`. Only remaining references are in `memory-plan/` docs (expected) and one comment in `pre-compact.sh:10` documenting the removal. No stale code refs.
- `FINGERPRINT_FILE` / `extractFingerprint` / `writeFingerprint` / `session-fingerprint.json` — removed from `session-recap`. Only remaining references in `memory-plan/` docs and `docs/ARCHITECTURE.md` (lines 287, 487). `docs/ARCHITECTURE.md` is outside Block 0 scope — carry-forward.
- `ACTIVITY_FILE` / `frontend-activity` — removed from `auto-checkpoint`. Only remaining references in `memory-plan/` docs and `docs/ARCHITECTURE.md` (lines 81, 83). Same carry-forward.
- `confidence` — removed from all pattern objects, destructuring, fact push, and JSDoc in `pre-compression-flush.mjs`. The word `confidence` still appears in some test fixture data passed to `mergeFacts` (e.g., line 284, 388, 389 in test file) as extra properties on test objects — these are harmless (JS destructuring ignores extra keys) and are part of tests that verify `mergeFacts` behavior, not `confidence` behavior. No stale code refs.
- `extractFacts` — still defined at `lib/pre-compression-flush.mjs:144`, called from `runFlush` at line 367, imported in test at line 16. Return shape updated: `{ fact, category, speaker }` (was `{ fact, category, confidence, speaker }`). No other callers reference `confidence` from the return value.
- `mergeFacts` — JSDoc at line 276 updated to `{ fact, category, speaker }`. Destructuring at line 286 unchanged (`{ fact, category, speaker }`). No stale refs.

## §4 — Findings

- [POSITIVE] All four dead artifacts cleanly removed with zero downstream breakage. The grep searches confirm no in-repo consumer existed for any of them.
- [POSITIVE] The `confidence` field was set in patterns but never read by any consumer (`mergeFacts` destructured `{ fact, category, speaker }` and ignored `confidence`). Removal is safe and simplifies the extraction API.
- [POSITIVE] `pre-compact.sh` retained as an empty hook with the `WORKSPACE` variable, correctly preserving the hook attachment point for future Phase 4 (Block 4) rewiring.
- [POSITIVE] The fingerprint deletion in `session-recap` removed ~80 lines of dead code (functions + constants + caller block). The main recap functionality is fully intact.
- [POSITIVE] The new regression test directly asserts `'confidence' in f === false`, providing a hard gate against accidental re-introduction.
- [POSITIVE] Zero mid-implementation findings. All 5 deltas landed exactly as specified in AUDIT_PRE §6.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.7

- Test baseline is now 482 tests (409 pass, 73 fail — pre-existing). +1 test from this step.
- `docs/ARCHITECTURE.md` has stale references to `frontend-activity` (lines 81, 83) and `session-fingerprint.json` (lines 287, 487). Step 0.7 creates `docs/STATE_FILES.md` — it may be appropriate to also update `docs/ARCHITECTURE.md` at that time, or defer to a later block if `docs/ARCHITECTURE.md` is out of scope.
- `pre-compact.sh` is now a no-op stub (shebang + WORKSPACE var + exit 0). It will be rewired in Block 4.
- `extractFacts` return shape is now `{ fact, category, speaker }` — no `confidence`. Any future consumer of `extractFacts` should use this shape.
- Test fixture data in `test/memory-budget.test.mjs` still passes `confidence` as an extra property in some `mergeFacts` calls (lines 284, 315, 388, 389). Harmless but cosmetically inconsistent — defer cleanup to a later block or leave as-is.
