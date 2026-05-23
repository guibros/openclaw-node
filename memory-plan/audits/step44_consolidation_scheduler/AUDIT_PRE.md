# AUDIT_PRE — Step 8.2: Schedule + budget consolidation cycle (~5 min quiet periods)

## §1 — Intent

Implement a consolidation scheduler that triggers `runConsolidationCycle` during quiet periods. Launchd fires the scheduler every 30 minutes. The scheduler checks whether the LLM (Ollama) is idle before running a cycle. A hard cap of 5 minutes prevents the consolidation from dominating system resources.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 8 | 8.2 | v8.2 | [A] | Schedule + budget consolidation cycle (~5 min quiet periods) |

## §3 — Design decisions (from Step 8.1 AUDIT_POST §6)

- Test baseline: 883 tests (808 pass, 75 fail — 73 pre-existing + 2 flaky variance). +14 `it()` blocks added in step 8.1.
- `lib/consolidation.mjs` exports all 7 consolidation functions (decayWeights, reinforceCoOccurrence, detectClusters, regenerateSummaries, detectContradictions, evaluatePromotionCandidates, initConsolidationTables).
- `bin/consolidate.mjs` exports `runConsolidationCycle` at :44. CLI entry with `--db`/`--vault-path`/`--dry-run`.
- `entities_archived` table: same columns as `entities` plus `archived_at TEXT NOT NULL`.
- Step 8.2 needs: `runConsolidationCycle` from `bin/consolidate.mjs`, integration with `ollama-queue.getState()` for busy detection, launchd plist at 30-min cadence, 5-min hard cap per cycle.

From RESUME.md §0 Block 8 frozen decisions:
- New `bin/consolidation-scheduler.mjs` run by launchd at 30-min cadence.
- Triggers a cycle when: no extraction in queue for ≥5 minutes AND no analysis in the last 60 seconds (read via `ollama-queue.getState()`).
- Skip if queue is busy.
- Hard cap ~5 minutes per cycle.
- All consolidation work routes through `ollama-queue.requestExtraction()` (same priority as session extraction — long-running, waits for quiet periods).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | `ollama-queue.getState()` is process-local singleton state — a standalone launchd process gets a fresh empty queue | LOW | Dual idle detection: in-process uses `getState()` directly; standalone uses Ollama HTTP API (`/api/ps`) to check for active model inference. Both paths share `isSystemIdle()`. |
| 2 | 5-min hard cap may kill long regenerateSummaries LLM calls mid-flight | LOW | AbortController-based timeout wraps the entire cycle. `runConsolidationCycle` already handles errors gracefully per step 8.1. Partial work is fine — next cycle picks up remaining. |
| 3 | Launchd plist template uses `${VAR}` placeholders (same as other plists) — not directly loadable | LOW | Existing pattern across all plists in `services/launchd/`. Operators resolve at install time. |

## §5 — Deferrals

- None. This is the last step of Block 8; all consolidation features land here.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `bin/consolidation-scheduler.mjs` | new | Consolidation scheduler module. Exports: `IDLE_THRESHOLD_MS` (5 min), `HARD_CAP_MS` (5 min), `ANALYSIS_QUIET_MS` (60s), `isOllamaIdle(baseUrl)` (HTTP check via `/api/ps`), `isQueueIdle(getStateFn)` (in-process queue check for extraction idle ≥5 min and analysis idle ≥60s), `isSystemIdle(opts)` (combined check: in-process queue if available, else Ollama HTTP), `runScheduledCycle(opts)` (run `runConsolidationCycle` with 5-min AbortController timeout), `createConsolidationScheduler(opts)` (factory returning `{ start, stop, runOnce }` with configurable interval). CLI entry for launchd: single-shot mode (check idle → run cycle → exit). |
| 2 | `services/launchd/ai.openclaw.consolidation-scheduler.plist` | new | Launchd plist with `StartInterval` 1800 (30 min). Not `KeepAlive` — runs once per interval. Logs to `${OPENCLAW_WORKSPACE}/.tmp/consolidation-scheduler.{log,err}`. |
| 3 | `test/consolidation-scheduler.test.mjs` | new | Tests for idle detection, timeout enforcement, scheduler factory, single-shot CLI logic. ~8-10 `it()` blocks. |
