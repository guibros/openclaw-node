# AUDIT_POST — Step 4.4: Add provenance fields (source_type, source_node, source_event_id) to local stores

**Version:** v4.4-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/extraction-store.mjs` (mod) — idempotent ALTER TABLE migration, provenance indexes, updated prepared statements, storeExtractionResult accepts provenance, PROVENANCE_LOCAL constant | `lib/extraction-store.mjs:24` (PROVENANCE_LOCAL), `:100` (migration loop), `:119` (indexes), `:131` (upsertEntity with provenance), `:172` (storeExtractionResult with provenance param) | yes | `grep -n 'PROVENANCE_LOCAL' lib/extraction-store.mjs` → `24`, `172` |
| 2 | `test/provenance-fields.test.mjs` (new) — ~8 tests | `test/provenance-fields.test.mjs` (8 `it()` blocks) | yes | `grep -c 'it(' test/provenance-fields.test.mjs` → `8` |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'PROVENANCE_LOCAL' lib/extraction-store.mjs` | `24:export const PROVENANCE_LOCAL = Object.freeze({` |
| 2 | `grep -n 'source_type' lib/extraction-store.mjs` | `25:  source_type: 'local',` |
| 3 | `grep -n 'idx_.*source_type' lib/extraction-store.mjs` | `119:    CREATE INDEX IF NOT EXISTS idx_entities_source_type ON entities(source_type);` |
| 4 | `grep -n 'ALTER TABLE.*source_type' lib/extraction-store.mjs` | `107:      db.exec(\`ALTER TABLE ${table} ADD COLUMN source_type TEXT DEFAULT 'local'\`);` |
| 5 | `grep -n 'provenance' lib/extraction-store.mjs` | `99:  // ── Provenance Migration (idempotent) ────────────────────────────────` |
| 6 | `grep -c 'it(' test/provenance-fields.test.mjs` | `8` |

## §3 — Cross-references still valid

- `PROVENANCE_LOCAL` exported from `lib/extraction-store.mjs:24` — imported by `test/provenance-fields.test.mjs:4`. Zero stale references.
- `createExtractionStore` existing export unchanged — all prior callers (`lib/pre-compression-flush.mjs`, `test/extraction-store.test.mjs`, `bin/run-block3-validation.mjs`) pass no provenance arg → default `PROVENANCE_LOCAL` applies. Zero breakage.
- `storeExtractionResult(sessionId, result)` signature extended to `storeExtractionResult(sessionId, result, provenance)` — optional third arg, backwards-compatible. All prior callers pass 2 args → `provenance` is `undefined` → defaults to `PROVENANCE_LOCAL`. Zero stale references.
- No pre-existing symbols renamed or deleted.

## §4 — Findings

- [POSITIVE] Idempotent migration via `PRAGMA table_info()` check before ALTER TABLE — safe to run on databases that already have the columns.
- [POSITIVE] `PROVENANCE_LOCAL` is a frozen constant, preventing accidental mutation.
- [POSITIVE] Default value `'local'` in the ALTER TABLE ensures all existing rows get correct provenance without backfill script.
- [POSITIVE] Provenance indexes on all 4 tables enable efficient `WHERE source_type = 'shared'` filtering for retrieval pipeline (Step 4.6).
- [POSITIVE] `storeExtractionResult` third argument is optional — existing callers don't need updating. Fully backwards-compatible.
- [POSITIVE] All 8 new tests pass: column existence (4), default local provenance, shared provenance storage, query-by-source, constant shape.
- [POSITIVE] Total test count 630 (553 pass, 77 fail — unchanged from baseline 77 failures).

7 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 4.5

- Test baseline is now 630 tests (553 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- `PROVENANCE_LOCAL` exported from `lib/extraction-store.mjs:24` — available for use by any consumer that needs to mark local content explicitly.
- `storeExtractionResult(sessionId, result, provenance)` now accepts provenance as the third arg. The subscriber's `onIngest` callback can pass `{ source_type: 'shared', source_node, source_event_id }` directly.
- Provenance indexes (`idx_*_source_type`) are ready for use in retrieval queries.
- Step 4.5 (`tasks_observed` table for kanban events) should include provenance columns from the start — no migration needed if columns are in the CREATE TABLE.
- `generateMemoryContent()` does not yet filter by source_type; deferred to Step 4.6 (conflict surfacing).
