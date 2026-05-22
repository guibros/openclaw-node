# AUDIT_POST — Step 4.3: Implement subscriber (bin/memory-subscriber.mjs)

**Version:** v4.3-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create subscriber daemon with parseSharedSubject, evaluateIngestionPolicy, createSubscriber factory, CLI main | `bin/memory-subscriber.mjs:50` (parseSharedSubject), `:79` (evaluateIngestionPolicy), `:124` (createSubscriber) | yes | `grep -n 'export function parseSharedSubject' bin/memory-subscriber.mjs` → `50` |
| 2 | Tests: ~10 planned, 14 delivered | `test/memory-subscriber.test.mjs` (14 `it()` blocks) | yes | `grep -c 'it(' test/memory-subscriber.test.mjs` → `14` |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff (bin/memory-subscriber.mjs, test/memory-subscriber.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function parseSharedSubject' bin/memory-subscriber.mjs` | `50:export function parseSharedSubject(subject) {` |
| 2 | `grep -n 'export function evaluateIngestionPolicy' bin/memory-subscriber.mjs` | `79:export function evaluateIngestionPolicy(event, nodeId, parsed) {` |
| 3 | `grep -n 'export async function createSubscriber' bin/memory-subscriber.mjs` | `124:export async function createSubscriber(nc, nodeId, opts = {}) {` |
| 4 | `grep -n 'createBackoff.*memory-promoter' bin/memory-subscriber.mjs` | `24:import { createBackoff } from './memory-promoter.mjs';` |
| 5 | `grep -n 'source_type.*shared' bin/memory-subscriber.mjs` | `170:          source_type: 'shared',` |
| 6 | `grep -c 'it(' test/memory-subscriber.test.mjs` | `14` |

## §3 — Cross-references still valid

- `parseSharedSubject` exported from `bin/memory-subscriber.mjs:50` — imported by `test/memory-subscriber.test.mjs:4`. Zero stale references.
- `evaluateIngestionPolicy` exported from `bin/memory-subscriber.mjs:79` — imported by `test/memory-subscriber.test.mjs:5`. Zero stale references.
- `createSubscriber` exported from `bin/memory-subscriber.mjs:124` — not imported by tests (requires live NATS; tested via pure-function unit tests of its components). Not stale — intentionally deferred from test import.
- `createBackoff` imported from `bin/memory-promoter.mjs:171` in `bin/memory-subscriber.mjs:24` — function exists and is exported. Valid.
- `ensureSharedStream`, `SHARED_STREAM_NAME` imported from `lib/shared-event-stream.mjs` in `bin/memory-subscriber.mjs:23` — both exist at `:52` and `:23` respectively. Valid.
- No pre-existing symbols renamed or deleted.

## §4 — Findings

- [POSITIVE] `evaluateIngestionPolicy` is a pure function with no side effects, taking (event, nodeId, parsed) and returning {decision, reason}. Easy to test and compose.
- [POSITIVE] Self-originated event filtering (`promoted_from.node_id === nodeId`) prevents event loops — shared events published by this node are skipped on ingestion.
- [POSITIVE] `parseSharedSubject` covers all 7 SHARED_SUBJECTS patterns from shared-event-stream.mjs with category labels. Null/non-string inputs handled gracefully.
- [POSITIVE] `createBackoff` imported from promoter per carry-forward recommendation — zero code duplication.
- [POSITIVE] Provenance envelope `{ source_type: 'shared', source_node, source_event_id }` constructed for every ingested event, matching the provenance schema planned for Step 4.4.
- [POSITIVE] Subscriber mirrors promoter architecture: factory pattern, durable consumer, backoff resilience, graceful shutdown, stats tracking. Consistent codebase patterns.
- [POSITIVE] Degraded mode on shared stream unavailability — returns a no-op subscriber with backoff.recordFailure() already called, allowing the caller to retry. Does not crash.
- [POSITIVE] All 14 new tests pass. Total: 622 tests (545 pass, 77 fail). The 77 failures are unchanged from the v4.2 baseline (73 pre-existing + 4 flaky).

8 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 4.4

- Test baseline is now 622 tests (545 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added this step (planned ~10, delivered 14).
- `evaluateIngestionPolicy(event, nodeId, parsed)` from `bin/memory-subscriber.mjs` is available for import if other consumers need ingestion decisions.
- `parseSharedSubject(subject)` provides the category routing needed by Steps 4.4/4.5 to direct incoming events to the right local store tables.
- The subscriber's `onIngest(event, parsed, provenance)` callback is the hook point where Steps 4.4/4.5 wire actual store writes. Currently callback-only — no persistent projection yet.
- Provenance envelope shape `{ source_type, source_node, source_event_id }` matches the column schema planned for Step 4.4.
- `createBackoff` lives in `bin/memory-promoter.mjs` — both promoter and subscriber now import it. If a third consumer needs it, consider extracting to a shared lib module (out of scope for this step).
- Phase-4-correction streak: 0 (reset — test count underestimate: planned ~10, delivered 14).
- Phase-8-patch streak: 12 (Steps 2.1–4.3, zero patches).
