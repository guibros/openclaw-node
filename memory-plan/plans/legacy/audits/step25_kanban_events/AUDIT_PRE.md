# AUDIT_PRE — Step 4.5: Always-ingest kanban events into tasks_observed

**Version:** v4.5-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Create the `tasks_observed` projection table and kanban store module so that every kanban
event received via the subscriber is persisted locally with provenance. Tasks owned by
this node get full projection (all data fields stored); tasks owned by other nodes get
summary projection (id, owner, status only — no detailed data blob). This gives the
local agent visibility into the shared kanban state for context-aware task coordination.

## §2 — Inventory excerpt

```
| 4 | 4.5 | v4.5 | [A] | Always-ingest kanban events into tasks_observed |
```

## §3 — Design decisions (consumed from Step 4.4 AUDIT_POST §6)

- Test baseline is 630 tests (553 pass, 77 fail — 73 pre-existing + 4 flaky).
- `PROVENANCE_LOCAL` exported from `lib/extraction-store.mjs:24` — available for reuse.
- `storeExtractionResult(sessionId, result, provenance)` accepts provenance as 3rd arg.
  The subscriber's `onIngest` callback can pass `{ source_type: 'shared', source_node, source_event_id }` directly.
- Provenance indexes ready for retrieval queries.
- `tasks_observed` table should include provenance columns from the start — no migration needed.
- `generateMemoryContent()` does not yet filter by source_type; deferred to Step 4.6.

### Additional design decisions from RESUME.md §0:

- **Always-ingest kanban events** — unconditional (Block 4 frozen decisions).
- Subscriber already accepts kanban events in `evaluateIngestionPolicy` (Step 4.3).
- Kanban events identified by `entity_type === 'task'` or `event_type.startsWith('kanban.')` (from promoter).
- `tasks_observed` table uses same database as extraction store (`~/.openclaw/state.db`).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Event data shape unknown — kanban events have no formal Zod schema in event-schemas package | LOW | Use flexible JSON blob storage for `data_json` column; structured fields (`task_id`, `owner`, `status`, `title`) extracted when present, with graceful defaults when missing. |
| 2 | Multiple events for same task_id could create duplicate rows | LOW | Use INSERT (not UPSERT) — every event is a projection row capturing the event, not a mutable task state. `getTaskById` returns latest by `received_at`. |

## §5 — Deferrals

- Wiring the kanban store into the subscriber's `onIngest` callback in the daemon CLI is deferred — the store module and test are the deliverables; actual subscriber wiring will happen when the daemon is updated (Step 4.7+ or a subsequent wiring step). The subscriber's `main()` already has the `onIngest` hook; connecting it to the kanban store is a one-line change that the operator can do or that a later step will wire.
- No: actually, looking at the scope more carefully, the step description says "Always-ingest kanban events into tasks_observed" — this implies the wiring. But the subscriber already has `onIngest` as a callback pattern. The store module IS the deliverable; the subscriber's CLI main can be updated to show how to wire it.

**Revised:** The store module + tests are the primary deliverables. The subscriber CLI's `onIngest` callback is NOT modified in this step — the store provides the `projectKanbanEvent` API that any subscriber wiring can call. Actual daemon integration is a wiring concern for the operator or a later step.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/kanban-store.mjs` | new | `createKanbanStore(opts)` factory: opens SQLite DB, creates `tasks_observed` table (with provenance columns from the start), returns `{ projectKanbanEvent, getObservedTasks, getTaskById, getStats, close }`. Full projection for owned tasks, summary for others. |
| 2 | `test/kanban-store.test.mjs` | new | ~8 tests: table creation, full projection (owned), summary projection (non-owned), provenance columns exist, getObservedTasks filtering, getTaskById latest event, getStats counts, event without owner field. |
