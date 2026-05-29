# AUDIT_PRE — Step 0.6: Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field)

**Version:** v0.6-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Remove four dead artifacts that are written by the existing memory harness but have no in-repo consumer. This is cleanup: every deletion targets a write path whose output is never read by any code in the repo.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.6 | v0.6 | [A] | Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field) |

## §3 — Design decisions (consumed from Step 0.5 AUDIT_POST §6)

- Test baseline is now 481 tests (408 pass, 73 fail — pre-existing). +4 tests from Step 0.5.
- `truncateAtWord` is exported from `pre-compression-flush.mjs` at line 212. Edits to the same file should be aware of this function and shifted line numbers.
- The `confidence` field returned by `extractFacts` is still unused — this step deletes it.
- `stripSpeaker` at line 203, `cleanParentheticalChains` at line 222 (shifted +10 lines from `truncateAtWord` insertion).
- All other helpers (`stripSupersedes`, `bigramSimilarity`) remain at their prior relative positions.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Removing `touch "$ACTIVITY_FILE"` could break daemon activity detection | LOW | Searched repo: `frontend-activity` is only touched/written in `auto-checkpoint` line 25 and defined at line 19. No reader in the repo. The daemon comment at line 8-10 confirms the daemon handles lifecycle independently. |
| 2 | Removing `writeFingerprint` call could break downstream consumers | LOW | `FINGERPRINT_FILE` writes to `~/.openclaw/workspace/.tmp/session-fingerprint.json`. Searched repo: only `session-recap` references `session-fingerprint`. No other file reads it. |
| 3 | Removing `.pre-compact-state.md` write could break recovery after compaction | LOW | Searched repo: `.pre-compact-state.md` is only written by `pre-compact.sh`. No reader. The REFERENCE_PLAN confirms "the hook itself can stay — it will be rewired in Phase 4." |
| 4 | Removing `confidence` from extractFacts return type could break callers | LOW | Searched repo: `confidence` is set in pattern objects and pushed into fact objects at line 180. `mergeFacts` (the only consumer of extractFacts output) never reads `confidence`. No other caller reads it. |

No HIGH-severity risks.

## §5 — Deferrals

- `pre-compact.sh` will be rewired in Phase 4 (Block 4) per REFERENCE_PLAN. This step only guts the dead write; the hook file remains.
- The `extractFingerprint` logic in `session-recap` is deleted entirely (function + constant + caller). If session fingerprinting is wanted later, it will be rebuilt from scratch in a later block.

## §6 — Phase 4 implementation outline

| # | File | Delta |
|---|------|-------|
| 1 | `.claude/hooks/pre-compact.sh` | Remove `STATE_FILE` variable (line 9), the entire `{ ... } > "$STATE_FILE"` block (lines 11-41). Keep shebang, header comment, `set -euo pipefail`, `WORKSPACE` variable (may be needed for future rewiring), and `exit 0`. |
| 2 | `workspace-bin/session-recap` | Delete `FINGERPRINT_FILE` constant (line 281), `extractFingerprint` function (lines 283-343), `writeFingerprint` function (lines 346-357), and the fingerprint caller block at end of `main()` (lines 446-450). |
| 3 | `workspace-bin/auto-checkpoint` | Delete `ACTIVITY_FILE` variable (line 19) and `touch "$ACTIVITY_FILE"` (line 25). |
| 4 | `lib/pre-compression-flush.mjs` | Remove `confidence` property from all pattern objects (lines 150-162), remove `confidence` from destructuring at line 169, remove `confidence` from the fact object pushed at line 180, update JSDoc at lines 142 and 276 to remove `confidence` from the described return shape. |
| 5 | `test/memory-budget.test.mjs` | Add 1 regression test: verify `extractFacts` return objects do NOT have a `confidence` property. |
