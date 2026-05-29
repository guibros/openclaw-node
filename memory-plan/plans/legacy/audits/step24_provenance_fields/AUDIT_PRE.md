# AUDIT_PRE — Step 4.4: Add provenance fields (source_type, source_node, source_event_id) to local stores

**Version:** v4.4-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Add provenance columns (`source_type`, `source_node`, `source_event_id`) to all four extraction store tables (`entities`, `themes`, `mentions`, `decisions`) so that content ingested from the shared cluster can be distinguished from locally-generated content. Local-only content keeps `source_type = 'local'` (column default). Ingested-from-shared content carries the source node ID and event ID for full traceability.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.4 | v4.4 | [A] | Add provenance fields (source_type, source_node, source_event_id) to local stores |

## §3 — Design decisions (from prior step AUDIT_POST §6)

- Test baseline is now 622 tests (545 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added in Step 4.3.
- `evaluateIngestionPolicy(event, nodeId, parsed)` from `bin/memory-subscriber.mjs` is available for import if other consumers need ingestion decisions.
- `parseSharedSubject(subject)` provides the category routing needed by Steps 4.4/4.5 to direct incoming events to the right local store tables.
- The subscriber's `onIngest(event, parsed, provenance)` callback is the hook point where Steps 4.4/4.5 wire actual store writes. Currently callback-only — no persistent projection yet.
- Provenance envelope shape `{ source_type, source_node, source_event_id }` matches the column schema planned for Step 4.4.
- `createBackoff` lives in `bin/memory-promoter.mjs` — both promoter and subscriber now import it.

**Block 4 §0 frozen decisions applied:**
- Provenance fields on all local stores: `source_type` (`local` / `shared`), `source_node`, `source_event_id`.
- Default privacy: DEFAULT-PRIVATE. Local content keeps `source_type = 'local'`.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | ALTER TABLE on existing database with data | LOW | SQLite ALTER TABLE ADD COLUMN is safe, non-destructive, and the DEFAULT clause fills existing rows. Idempotent via column-existence check. |
| 2 | Prepared statement changes break existing callers | LOW | Default values for provenance params in `storeExtractionResult` — existing callers pass no provenance and get `source_type='local'` automatically. |
| 3 | Index on source_type adds write overhead | LOW | Negligible for an append-mostly workload. Worth it for retrieval filtering. |

## §5 — Deferrals

- Wiring the subscriber's `onIngest` callback to actually call `storeExtractionResult` with provenance — that's Step 4.5's work.
- Retrieval filtering/ranking by source — that's Step 4.6 (conflict surfacing).
- `generateMemoryContent` does not yet filter by source_type; that's deferred to retrieval pipeline work.

## §6 — Phase 4 implementation outline

| # | File | Delta |
|---|------|-------|
| 1 | `lib/extraction-store.mjs` (mod) | Add idempotent ALTER TABLE migration for `source_type TEXT DEFAULT 'local'`, `source_node TEXT`, `source_event_id TEXT` on all 4 tables. Add `CREATE INDEX IF NOT EXISTS idx_entities_source_type`, `idx_themes_source_type`, `idx_mentions_source_type`, `idx_decisions_source_type`. Update `storeExtractionResult` signature to accept optional `provenance` parameter `{ source_type, source_node, source_event_id }`. Update `upsertEntity`, `upsertTheme`, `insertMention`, `insertDecision` prepared statements to write provenance columns. Add `storeSharedExtractionResult(sessionId, result, provenance)` convenience wrapper. Export `PROVENANCE_LOCAL` constant. |
| 2 | `test/provenance-fields.test.mjs` (new) | ~8 tests: provenance columns exist on all 4 tables, storeExtractionResult without provenance defaults to local, storeExtractionResult with provenance stores shared, entities query by source_type, decisions query by source_type, themes query by source_type, mentions carry provenance, PROVENANCE_LOCAL constant value. |
