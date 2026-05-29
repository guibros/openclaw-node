# AUDIT_POST — Step 4.5: Always-ingest kanban events into tasks_observed

**Version:** v4.5-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/kanban-store.mjs` (new) — createKanbanStore factory with tasks_observed table, projectKanbanEvent full/summary, getObservedTasks, getTaskById, getStats | `lib/kanban-store.mjs:27` (createKanbanStore), `:41` (CREATE TABLE tasks_observed), `:96` (projectKanbanEvent), `:145` (getObservedTasks), `:176` (getTaskById), `:191` (getStats) | yes | `grep -n 'createKanbanStore' lib/kanban-store.mjs` → `27` |
| 2 | `test/kanban-store.test.mjs` (new) — ~8 tests | `test/kanban-store.test.mjs` (8 `it()` blocks) | yes | `grep -c 'it(' test/kanban-store.test.mjs` → `8` |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'createKanbanStore' lib/kanban-store.mjs` | `27:export function createKanbanStore(opts = {}) {` |
| 2 | `grep -n 'tasks_observed' lib/kanban-store.mjs` | `41:    CREATE TABLE IF NOT EXISTS tasks_observed (` |
| 3 | `grep -n 'projectKanbanEvent' lib/kanban-store.mjs` | `96:  function projectKanbanEvent(event, nodeId, provenance) {` |
| 4 | `grep -n 'source_type' lib/kanban-store.mjs` | `52:      source_type TEXT DEFAULT 'local',` |
| 5 | `grep -n 'is_owned' lib/kanban-store.mjs` | `50:      is_owned INTEGER NOT NULL DEFAULT 0,` |
| 6 | `grep -c 'it(' test/kanban-store.test.mjs` | `8` |

## §3 — Cross-references still valid

- `createKanbanStore` exported from `lib/kanban-store.mjs:27` — imported by `test/kanban-store.test.mjs:7`. Zero stale references.
- No pre-existing symbols renamed or deleted.
- No imports from other modules were changed.
- `better-sqlite3` imported consistently with the extraction-store pattern (default import).

## §4 — Findings

- [POSITIVE] Provenance columns (`source_type`, `source_node`, `source_event_id`) included in CREATE TABLE from the start — no migration needed (per Step 4.4 carry-forward).
- [POSITIVE] Full vs summary projection cleanly separated — owned tasks store all data fields including JSON blob; non-owned tasks store only task_id, owner, status for minimal context.
- [POSITIVE] `projectKanbanEvent` gracefully handles missing `owner` (defaults to null, `is_owned = 0`) and missing `data` (defaults to empty object).
- [POSITIVE] `getTaskById` returns latest event by `received_at DESC` — supports multiple events per task_id without upsert complexity.
- [POSITIVE] `getObservedTasks` supports three filter dimensions (ownedOnly, status, sourceType) with clean SQL builder pattern.
- [POSITIVE] All 8 new tests pass. Test count: 638 (561 pass, 77 fail — unchanged from baseline 77 failures).
- [POSITIVE] Module follows the same patterns as `lib/extraction-store.mjs`: factory function, WAL mode, prepared statements, close() method, dbPath getter.

7 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 4.6

- Test baseline is now 638 tests (561 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- `createKanbanStore` exported from `lib/kanban-store.mjs:27` — available for import by subscriber daemon wiring.
- `projectKanbanEvent(event, nodeId, provenance)` matches the subscriber's `onIngest(event, parsed, provenance)` callback signature — wiring is straightforward: `if (parsed.category === 'kanban') kanbanStore.projectKanbanEvent(event, nodeId, provenance)`.
- The subscriber's CLI `main()` currently only logs on ingest — connecting the kanban store requires importing `createKanbanStore`, initializing it, and passing a category-routing `onIngest` callback. This wiring is not part of Step 4.5 scope.
- `tasks_observed` table is in the same database (`~/.openclaw/state.db`) as the extraction store tables — no cross-DB joins needed for retrieval.
- Step 4.6 (conflict surfacing) needs to query `tasks_observed` alongside entities/themes/decisions for retrieval pipeline integration.
