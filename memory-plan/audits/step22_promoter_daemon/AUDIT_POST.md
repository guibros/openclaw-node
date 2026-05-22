# AUDIT_POST — Step 4.2: Implement promoter (bin/memory-promoter.mjs)

**Version:** v4.2-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create promoter daemon with evaluatePromotionPolicy, mapToSharedSubject, createBackoff, createPromoter, CLI main | `bin/memory-promoter.mjs:67` (evaluatePromotionPolicy), `:137` (mapToSharedSubject), `:171` (createBackoff), `:221` (createPromoter) | yes | `grep -n 'export function evaluatePromotionPolicy' bin/memory-promoter.mjs` → `67` |
| 2 | Tests: ~10 planned, 10 delivered | `test/memory-promoter.test.mjs` (10 `it()` blocks) | yes | `grep -c 'it(' test/memory-promoter.test.mjs` → `10` |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff (bin/memory-promoter.mjs, test/memory-promoter.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function evaluatePromotionPolicy' bin/memory-promoter.mjs` | `67:export function evaluatePromotionPolicy(event, policy) {` |
| 2 | `grep -n 'export function mapToSharedSubject' bin/memory-promoter.mjs` | `137:export function mapToSharedSubject(event) {` |
| 3 | `grep -n 'export function createBackoff' bin/memory-promoter.mjs` | `171:export function createBackoff(opts = {}) {` |
| 4 | `grep -n 'export async function createPromoter' bin/memory-promoter.mjs` | `221:export async function createPromoter(nc, nodeId, opts = {}) {` |
| 5 | `grep -n 'promoted_from' bin/memory-promoter.mjs` | `296:          promoted_from: {` |
| 6 | `grep -c 'it(' test/memory-promoter.test.mjs` | `10` |

## §3 — Cross-references still valid

- `evaluatePromotionPolicy` exported from `bin/memory-promoter.mjs:67` — imported by `test/memory-promoter.test.mjs:10`. Zero stale references.
- `mapToSharedSubject` exported from `bin/memory-promoter.mjs:137` — imported by `test/memory-promoter.test.mjs:11`. Zero stale references.
- `createBackoff` exported from `bin/memory-promoter.mjs:171` — imported by `test/memory-promoter.test.mjs:12`. Zero stale references.
- `createPromoter` exported from `bin/memory-promoter.mjs:221` — not imported by tests (mock NATS would be needed for integration test; tested via pure-function unit tests of its components). Not a stale reference — intentionally deferred from test import.
- Import `loadPromotionPolicy` from `lib/promotion-policy.mjs` in `bin/memory-promoter.mjs:5` — function exists at `lib/promotion-policy.mjs:113`. Valid.
- Import `ensureSharedStream`, `SHARED_STREAM_NAME` from `lib/shared-event-stream.mjs` in `bin/memory-promoter.mjs:6` — functions exist at `lib/shared-event-stream.mjs:52` and `:23`. Valid.
- No pre-existing symbols renamed or deleted.

## §4 — Findings

- [POSITIVE] `evaluatePromotionPolicy` is a pure function with no side effects — easy to test and reason about. Checks rules in documented priority order (automatic → explicit → threshold → manual_review).
- [POSITIVE] Provenance tracking via `promoted_from: { node_id, local_event_id }` ensures every shared event traces back to its origin. Uses `crypto.randomUUID()` for the new shared event ID.
- [POSITIVE] Exponential backoff controller is a clean, testable state machine with `recordFailure()`, `reset()`, `getDelay()`, and `failures` getter. Base 1s → max 60s with multiplier 2.
- [POSITIVE] `createPromoter` handles shared cluster unavailability gracefully — starts in degraded mode, retries on subsequent messages, uses backoff delays. Single-node operation works fully without the cluster per Block 4 frozen decisions.
- [POSITIVE] Subject mapping correctly routes kanban events to `kanban.events.>`, concept events to `concepts.shared.>`, and fact/lesson events to `lessons.shared.>` — all matching SHARED_SUBJECTS in shared-event-stream.mjs.
- [POSITIVE] CLI entry point includes graceful shutdown (SIGINT/SIGTERM handlers), drain NATS connection, and stats logging.
- [POSITIVE] All 10 new tests pass. Total: 608 tests (531 pass, 77 fail). The 77 failures are unchanged from the v4.1 baseline (73 pre-existing + 4 flaky).

7 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 4.3

- Test baseline is now 608 tests (531 pass, 77 fail — 73 pre-existing + 4 flaky). +10 tests added this step (planned ~10, delivered 10).
- `evaluatePromotionPolicy(event, policy)` from `bin/memory-promoter.mjs` is available for import by the subscriber daemon if needed for ingestion policy evaluation. The subscriber (`bin/memory-subscriber.mjs`) needs its own `evaluateIngestionPolicy` but may share some logic.
- `createPromoter(nc, nodeId, opts)` is the factory the daemon uses — it handles NATS consumer setup, backoff, and event processing. The subscriber will follow a similar pattern but subscribe to the shared stream instead of the local stream.
- `mapToSharedSubject(event)` establishes the subject-mapping convention: kanban → `kanban.events.*`, concept → `concepts.shared.*`, fact → `lessons.shared.*`. The subscriber must parse these same subjects to route incoming events to local stores.
- `createBackoff(opts)` is a reusable backoff controller. The subscriber should import and reuse it rather than duplicating.
- Phase-4-correction streak: 1 (test count matched: planned ~10, delivered 10).
- Phase-8-patch streak: 11 (Steps 2.1–4.2, zero patches).
