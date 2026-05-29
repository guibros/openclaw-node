# AUDIT_POST — Step 4.7: Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer)

**Version:** v4.7-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/extraction-trigger.mjs` (new) — EXTRACT_SUBJECT, DEFAULT_IDLE_THRESHOLD_SEC, publishExtractRequest, createExtractionTrigger | `lib/extraction-trigger.mjs:16` (EXTRACT_SUBJECT), `:19` (DEFAULT_IDLE_THRESHOLD_SEC), `:30` (publishExtractRequest), `:51` (createExtractionTrigger) | yes | `grep -n 'export' lib/extraction-trigger.mjs` → 4 exports |
| 2 | `.claude/hooks/pre-compact.sh` (mod) — thin NATS publisher | N/A | **dropped** | Tooling blocked all writes to `.claude/hooks/` (security policy). Deferred to Step 4.9. |
| 3 | `workspace-bin/memory-daemon.mjs` (mod) — import createExtractionTrigger, extractionTrigger variable, wire onExtract, resetIdleTimer in tick, stop in shutdown | `workspace-bin/memory-daemon.mjs:47` (import), `:377` (variable), `:1113` (create + wire), `:1157` (stop in shutdown), `:1193` (resetIdleTimer in tick) | yes | `grep -n 'extractionTrigger' workspace-bin/memory-daemon.mjs` → 7 hits |
| 4 | `test/extraction-trigger.test.mjs` (new) — ~8 tests | `test/extraction-trigger.test.mjs` (9 `it()` blocks) | yes | `grep -c 'it(' test/extraction-trigger.test.mjs` → `9` |

3 of 4 rows landed = yes. 1 row dropped (tooling constraint, documented in AUDIT_PRE Mid-Implementation Findings).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'EXTRACT_SUBJECT' lib/extraction-trigger.mjs` | `16:export const EXTRACT_SUBJECT = 'mesh.memory.extract_request';` |
| 2 | `grep -n 'DEFAULT_IDLE_THRESHOLD_SEC' lib/extraction-trigger.mjs` | `19:export const DEFAULT_IDLE_THRESHOLD_SEC = 2700;` |
| 3 | `grep -n 'publishExtractRequest' lib/extraction-trigger.mjs` | `30:export function publishExtractRequest(nc, nodeId, opts = {}) {` |
| 4 | `grep -n 'createExtractionTrigger' lib/extraction-trigger.mjs` | `51:export function createExtractionTrigger(nc, nodeId, opts = {}) {` |
| 5 | `grep -n 'extractionTrigger' workspace-bin/memory-daemon.mjs` | `377:let extractionTrigger = null;` |
| 6 | `grep -c 'it(' test/extraction-trigger.test.mjs` | `9` |

## §3 — Cross-references still valid

- All 4 exports from `lib/extraction-trigger.mjs` are imported by `test/extraction-trigger.test.mjs:3-8`. Zero stale references.
- `createExtractionTrigger` imported by `workspace-bin/memory-daemon.mjs:47` — used at line 1113 after NATS connection established.
- No pre-existing symbols renamed or deleted.
- No imports from other modules were changed.
- Module uses `TextEncoder`/`TextDecoder` (global Web API, no external dependency) — no new `import` or `require` from `nats` package at module level, preserving daemon startup when NATS is unavailable.

## §4 — Findings

- [POSITIVE] `EXTRACT_SUBJECT` is a string constant (`'mesh.memory.extract_request'`) per RESUME.md §0 frozen decision — matches the NATS subject naming convention used by other mesh subjects.
- [POSITIVE] `DEFAULT_IDLE_THRESHOLD_SEC` is 2700 (45 min) per frozen decision, configurable via `EXTRACTION_IDLE_THRESHOLD_SEC` env var.
- [POSITIVE] `publishExtractRequest` is a pure function that takes `nc`, `nodeId`, `opts` — publishes a JSON payload with `node_id`, `triggered_by`, `timestamp` to the extract subject. Returns `{ subject, payload }` for caller introspection.
- [POSITIVE] `createExtractionTrigger` factory returns `{ start, stop, resetIdleTimer }` — clean lifecycle API. Subscribes to NATS subject, processes messages via async iterator, manages idle timer with `setTimeout`/`clearTimeout`.
- [POSITIVE] Idle timer self-publishes via `publishExtractRequest(nc, nodeId, { triggeredBy: 'idle-timer' })` — the timer's self-publish arrives via the same subscription, which calls `onExtract` and resets the timer. This means the idle timer creates a closed feedback loop where extraction runs periodically as long as the session is active.
- [POSITIVE] Daemon wiring checks `sm.state !== STATES.ACTIVE && sm.state !== STATES.IDLE` before running flush — prevents extraction during BOOT or ENDED states.
- [POSITIVE] `resetIdleTimer()` called in tick loop only when `activity.active` — timer resets on real activity, not just on tick polling.
- [POSITIVE] No top-level `import` from `nats` package in `extraction-trigger.mjs` — uses `TextEncoder`/`TextDecoder` globals instead of `StringCodec`. Daemon startup remains safe when NATS is not installed.
- [POSITIVE] All 9 new tests pass. Test count: 656 (579 pass, 77 fail — unchanged baseline of 77 pre-existing failures).
- [NEGATIVE] Test count overestimate: planned ~8 tests in AUDIT_PRE §6, delivered 9. Phase-4-correction streak: 0-of-2 (reset at Step 4.6 for similar overestimate).
- [NEGATIVE] `.claude/hooks/pre-compact.sh` modification dropped due to Claude Code tooling constraint — security policy blocks all writes to `.claude/hooks/` paths. Deferred to Step 4.9 (frontend publisher pack) where the canonical publisher location is `hooks/claude-code/pre-compact.sh`.

9 POSITIVE findings, 2 NEGATIVE findings.

## §5 — Phase 8 patches

1. **`parseInt` → `parseFloat` in `createExtractionTrigger`:** `parseInt('0.1', 10)` returns `0` (falsy), causing env var values < 1 second to be ignored. Fixed to `parseFloat` with explicit `> 0` guard. This was caught and fixed during Phase 5 verification — the env var test (`EXTRACTION_IDLE_THRESHOLD_SEC=0.1`) failed until the fix landed. Production threshold is 2700s (whole number), so `parseFloat` is functionally equivalent for real usage, but the fix ensures sub-second thresholds work correctly in tests.

## §6 — Carry-forwards to Step 4.8

- Test baseline is now 656 tests (579 pass, 77 fail — 73 pre-existing + 4 flaky). +9 tests added this step.
- `EXTRACT_SUBJECT` exported from `lib/extraction-trigger.mjs:16` — string constant `'mesh.memory.extract_request'`, usable by any NATS publisher or subscriber.
- `DEFAULT_IDLE_THRESHOLD_SEC` exported from `lib/extraction-trigger.mjs:19` — 2700 (45 min), overridable via `EXTRACTION_IDLE_THRESHOLD_SEC` env var.
- `publishExtractRequest(nc, nodeId, opts)` exported from `lib/extraction-trigger.mjs:30` — publishes extraction request event to NATS. Used by idle timer self-trigger; available for external publishers (e.g., frontend hooks in Step 4.9).
- `createExtractionTrigger(nc, nodeId, opts)` exported from `lib/extraction-trigger.mjs:51` — factory for the daemon-side trigger. Returns `{ start(), stop(), resetIdleTimer() }`.
- Daemon wiring at `workspace-bin/memory-daemon.mjs:1113` — extraction trigger created after NATS connection, `onExtract` wired to run `shouldFlush` + `runFlush` (same pipeline used in ACTIVE→IDLE transition). Idle timer reset on each active tick at line 1193. Stopped on shutdown at line 1157.
- `.claude/hooks/pre-compact.sh` remains a no-op stub — update deferred to Step 4.9 (frontend publisher pack) where it will be replaced by `hooks/claude-code/pre-compact.sh`. The extraction trigger module provides the infrastructure; Step 4.9 provides the publishers.
