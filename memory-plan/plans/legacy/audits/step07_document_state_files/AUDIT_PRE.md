# AUDIT_PRE — Step 0.7: Document state files (docs/STATE_FILES.md)

**Version:** v0.7-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Create `docs/STATE_FILES.md` — a reference document listing every file the memory
infrastructure writes at runtime, with owner, format, lifetime, and consumers.
This is documentation only; no functional code changes, no test additions.

Step 0.7 is the last step of Block 0. After Phase 9 close, the block-close
ceremony (Framework §7) runs.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.7 | v0.7 | [A] | Document state files (docs/STATE_FILES.md) |

## §3 — Design decisions (consumed from Step 0.6 AUDIT_POST §6)

- Test baseline is 482 tests (409 pass, 73 fail — pre-existing). No new tests expected this step (documentation only).
- `docs/ARCHITECTURE.md` has stale references to `frontend-activity` and `session-fingerprint.json`. **Decision: defer** — `docs/ARCHITECTURE.md` is NOT in Block 0's file scope per RESUME.md §0. The `STATE_FILES.md` doc will note the deletions; ARCHITECTURE.md cleanup is a carry-forward to Block 1.
- `pre-compact.sh` is a no-op stub. Documented as such.
- `extractFacts` return shape is `{ fact, category, speaker }` — documented.
- Cosmetic `confidence` in test fixtures — deferred, documented as carry-forward.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Missing a state file in the inventory | LOW | Cross-referenced via grep across all writers in daemon, hooks, and libs. Review against `docs/ARCHITECTURE.md` existing list. |
| Accidentally touching functional code | LOW | Step produces exactly one new file (`docs/STATE_FILES.md`). No edits to existing source. |

## §5 — Deferrals

- `docs/ARCHITECTURE.md` stale refs to deleted artifacts → deferred to Block 1 or later.
- COMPANION variable name in `daily-log-writer.mjs` → cosmetic, deferred.
- Test fixture `confidence` cleanup → cosmetic, deferred.

## §6 — Phase 4 implementation outline

| # | File | Delta |
|---|------|-------|
| 1 | `docs/STATE_FILES.md` (new) | Create comprehensive state file inventory documenting every runtime file the memory infrastructure writes: path, owner process, format, lifetime, consumers. Organized by location (`~/.openclaw/workspace/`, `~/.openclaw/`, `.tmp/`). Includes files deleted in Block 0 (marked as removed). |
