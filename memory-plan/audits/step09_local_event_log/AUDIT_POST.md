# AUDIT_POST — Step 1.2: Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring)

**Version:** v1.2-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/local-event-log.mjs` (new): createLocalEventLog factory, publishLocal, buildMemoryEvent helper | `lib/local-event-log.mjs:33` (createLocalEventLog), `:94` (buildMemoryEvent) | yes | `grep -n 'export.*function createLocalEventLog' lib/local-event-log.mjs` → line 33 |
| 2 | `lib/memory-budget.mjs` (mod): #eventLog/#sessionId/#nodeId private fields, #publishEvent helper, dual-write in startSession/endSession/addEntry | `lib/memory-budget.mjs:39` (#eventLog), `:72` (startSession sessionId), `:82` (startSession publishEvent), `:127` (endSession publishEvent), `:188` (addEntry publishEvent), `:237` (#publishEvent) | yes | `grep -n '#eventLog' lib/memory-budget.mjs` → lines 39, 54, 238 |
| 3 | `workspace-bin/memory-daemon.mjs` (mod): import createLocalEventLog, init local event log after NATS, pass eventLog+nodeId to createBudget | `workspace-bin/memory-daemon.mjs:44` (import), `:355` (pass to createBudget), `:1072` (init eventLog) | yes | `grep -n 'createLocalEventLog' workspace-bin/memory-daemon.mjs` → lines 44, 1072 |
| 4 | `test/local-event-log.test.mjs` (new): tests for buildMemoryEvent and dual-write integration | `test/local-event-log.test.mjs:1` (9 tests across 2 describe blocks) | yes | `grep -n 'buildMemoryEvent' test/local-event-log.test.mjs` → line 15 |

All 4 rows landed = yes. 4 non-audit non-ledger files in planned diff = 4 unique files changed.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export.*function createLocalEventLog' lib/local-event-log.mjs` | `33:export async function createLocalEventLog(nc, nodeId) {` |
| 2 | `grep -n 'export function buildMemoryEvent' lib/local-event-log.mjs` | `94:export function buildMemoryEvent(eventType, entityId, entityType, data, nodeId, opts = {}) {` |
| 3 | `grep -n '#eventLog' lib/memory-budget.mjs` | `39:  #eventLog = null;       // optional local event log for dual-write` |
| 4 | `grep -n '#publishEvent' lib/memory-budget.mjs` | `237:  #publishEvent(eventType, data) {` |
| 5 | `grep -n '#sessionId' lib/memory-budget.mjs` | `40:  #sessionId = null;      // UUID generated per session for event entity_id` |
| 6 | `grep -n 'createLocalEventLog' workspace-bin/memory-daemon.mjs` | `44:import { createLocalEventLog } from '../lib/local-event-log.mjs';` |
| 7 | `grep -n 'localEventLog' workspace-bin/memory-daemon.mjs` | `349:let localEventLog = null;` |
| 8 | `grep -n 'eventLog.*nodeId' workspace-bin/memory-daemon.mjs` | `355:    eventLog: localEventLog,` |
| 9 | `grep -n 'buildMemoryEvent' test/local-event-log.test.mjs` | `15:import { buildMemoryEvent } from '../lib/local-event-log.mjs';` |

## §3 — Cross-references still valid

- `createLocalEventLog` is defined in `lib/local-event-log.mjs:33` and imported by `workspace-bin/memory-daemon.mjs:44` and `test/local-event-log.test.mjs:15`. No other references exist. No stale imports.
- `buildMemoryEvent` is defined in `lib/local-event-log.mjs:94` and imported by `test/local-event-log.test.mjs:15`. The MemoryBudget `#publishEvent` method inlines its own event construction instead of importing `buildMemoryEvent` (avoids ESM import issues in a sync method). No duplication concern — the two implementations serve different callers.
- `#eventLog`, `#sessionId`, `#nodeId` are private fields in `MemoryBudget` — invisible outside the class. No external references needed.
- `localEventLog` is a module-scoped variable in `memory-daemon.mjs:349`, referenced at lines 355 and 1072. No leakage.
- Event-schemas imports (`MemoryEventSchema`, `SessionStartedSchema`, etc.) are resolved from `../packages/event-schemas/dist/index.js` — same path as the Step 1.1 test. The `pretest` script builds the package before tests.
- The `crypto` import added to `memory-budget.mjs:24` uses Node.js built-in — no new dependency.
- Zero stale references found in codebase-wide search for `publishLocal`, `buildMemoryEvent`, `createLocalEventLog`.

## §4 — Findings

- [POSITIVE] All 4 planned file deltas landed exactly as specified in AUDIT_PRE §6. Zero deviations.
- [POSITIVE] The dual-write pattern is fully fire-and-forget: `#publishEvent` wraps all logic in try/catch, and `publishLocal` calls use `.catch(() => {})`. Event log failures are invisible to the caller. This matches the shadow-mode requirement.
- [POSITIVE] 9 new tests all pass. Coverage includes: event construction validation (4 tests against real Zod schemas), MemoryBudget integration (3 tests with mock eventLog), baseline compatibility (1 test without eventLog), and error isolation (1 test with throwing publishLocal).
- [POSITIVE] The `createLocalEventLog` function uses `jsm.streams.info()` with a fallback to `jsm.streams.add()` for idempotent stream creation. The stream is created with R=1, file storage, and `local.>` subject filter — matching the RESUME.md frozen decisions exactly.
- [POSITIVE] `MemoryBudget.startSession()` generates a `crypto.randomUUID()` as `#sessionId`, used as `entity_id` across all session-scoped events. This provides correlation without requiring the caller to pass a session ID.
- [POSITIVE] The daemon wiring follows the existing pattern: NATS connection is optional, and the local event log init is wrapped in its own try/catch with a descriptive log message. If NATS or JetStream is unavailable, the daemon continues without dual-write.
- [NEGATIVE] AUDIT_PRE §6 listed "7 tests" for delta #4 but the implementation has 9 tests (4 buildMemoryEvent + 5 MemoryBudget dual-write). This is a mid-implementation correction (test count was underestimated in planning). The actual count is better — more coverage. This breaks the zero-Phase-4-correction streak.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None. The NEGATIVE finding (test count underestimate) is a planning accuracy issue, not a code correctness issue. No code changes needed.

## §6 — Carry-forwards to Step 1.3

- Test baseline is now 506 tests (433 pass, 73 fail pre-existing). +9 tests added this step. (Note: the node test runner's per-indent-level counting may report 499 individual tests depending on grep pattern; the accurate count is 497 baseline + 9 new = 506 total test assertions.)
- `npm install` may still be blocked. The event-schemas build workaround (mission-control tsc path) continues to work. The `createLocalEventLog` function dynamically imports from `../packages/event-schemas/dist/index.js` — this resolves correctly as long as `pretest` has run.
- The `createLocalEventLog` function is available for use by the daemon but only activates when NATS is connected. Local-only operation continues to work without any event log.
- `buildMemoryEvent` is available as a standalone helper for constructing envelope-conformant events. Step 1.3 (artifact store) may use it for `memory.artifact_attached` events.
- `MemoryBudget` now accepts `eventLog` and `nodeId` options. Any caller that doesn't pass these options gets the existing behavior unchanged.
- `docs/ARCHITECTURE.md` stale references remain (out of scope).
- `docs/STATE_FILES.md` should be updated to mention the local event log stream data (deferred).
- COMPANION var name, test fixture `confidence`, `pre-compact.sh` stub — unchanged.
- The zero-Phase-4-correction streak for Block 1 resets to 0 due to the test count underestimate (AUDIT_PRE said 7, actual is 9).
