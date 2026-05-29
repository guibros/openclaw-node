# AUDIT_PRE — Step 4.6: Conflict surfacing in retrieval pipeline (describeConflict)

**Version:** v4.6-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement conflict surfacing for the retrieval pipeline. When local and shared knowledge disagree on a concept (same entity name, different type or context), the retrieval pipeline surfaces both versions with provenance metadata and a `conflict: true` flag. The agent sees the disagreement and decides per-conflict. No auto-merge.

Per RESUME §0 Block 4 frozen decisions: "Conflict resolution — surface, don't auto-merge. When local and shared disagree on a concept, retrieval returns both with provenance; agent decides per-conflict."

Per REFERENCE_PLAN §4.6: `describeConflict(localConcept, sharedConcept)` returns `{ local_definition, shared_definition, last_local_mention, last_shared_mention }`. The retrieval pipeline returns the conflict description alongside the content.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.6 | v4.6 | [A] | Conflict surfacing in retrieval pipeline (describeConflict) |

## §3 — Design decisions (consumed from Step 4.5 AUDIT_POST §6)

- Test baseline is now 638 tests (561 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added in Step 4.5.
- `createKanbanStore` exported from `lib/kanban-store.mjs:27` — available for import by subscriber daemon wiring.
- `projectKanbanEvent(event, nodeId, provenance)` matches the subscriber's `onIngest(event, parsed, provenance)` callback signature.
- `tasks_observed` table is in the same database (`~/.openclaw/state.db`) as the extraction store tables — no cross-DB joins needed for retrieval.
- Step 4.6 needs to query `tasks_observed` alongside entities/themes/decisions for retrieval pipeline integration.

Design approach for this step:
- New module `lib/conflict-surfacing.mjs` — pure-function conflict detection and description.
- `describeConflict(localItem, sharedItem)` — per REFERENCE_PLAN, returns `{ local_definition, shared_definition, last_local_mention, last_shared_mention, entity_name, conflict_type }`.
- `findEntityConflicts(db)` — queries entities that have mentions from both `source_type='local'` AND `source_type='shared'` via the mentions table. When the entity type changed across sources (detected by latest mention provenance vs entity's original provenance), flags as type conflict.
- `findDecisionConflicts(db)` — queries decisions on the same topic (fuzzy: same session_id or overlapping text) from different sources.
- `surfaceConflicts(db)` — top-level function returning all detected conflicts formatted for the retrieval pipeline.
- `annotateWithConflicts(retrievalResults, conflicts)` — adds `conflict: true` flag + conflict description to matching retrieval results.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Entity UNIQUE constraint means type conflicts can't persist in entity row (upsert overwrites) | MEDIUM | Detect conflicts via mentions table: entities with mentions from both source types indicate shared/local overlap. Type conflicts detected by comparing entity source_type (first sighter) vs latest mention source. |
| No shared data exists yet in test environment | LOW | Tests use in-memory SQLite with synthetic data from both local and shared provenance. |
| Retrieval pipeline integration point unclear | LOW | This step creates the conflict surfacing API. Wiring into the active retrieval pipeline (e.g. `generateMemoryContent`) is integration work — this step exports the functions; actual pipeline integration is via the returned API. |

## §5 — Deferrals

- Wiring subscriber's `onIngest` callback to route to kanban store / extraction store — deferred to daemon integration (not this step's scope).
- Full retrieval pipeline rewrite incorporating conflict surfacing into ambient memory injection — Block 6/7 work.
- Cross-entity conflict detection (e.g. "Daedalus" means different things on different nodes) requires richer entity metadata — deferred to Block 5 (Obsidian graph).

## §6 — Phase 4 implementation outline

| # | File | Delta | Type |
|---|------|-------|------|
| 1 | `lib/conflict-surfacing.mjs` | New module — `describeConflict(localItem, sharedItem)` pure function, `findEntityConflicts(db)` queries entities with mixed-provenance mentions, `findDecisionConflicts(db)` queries decisions from different sources, `surfaceConflicts(db)` top-level conflict discovery, `annotateWithConflicts(results, conflicts)` adds conflict flags to retrieval results | new |
| 2 | `test/conflict-surfacing.test.mjs` | ~8 tests: describeConflict output shape, findEntityConflicts with mixed provenance, findEntityConflicts with single source (no conflict), findDecisionConflicts with shared vs local, findDecisionConflicts with no conflicts, surfaceConflicts aggregation, annotateWithConflicts adds flag, annotateWithConflicts no matching conflict | new |
