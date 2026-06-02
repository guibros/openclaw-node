# AUDIT_POST — Step 1.1: Tick re-entrancy guard (R3)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `workspace-bin/memory-daemon.mjs` | ✓ | +1 import (`createConcurrencyGuard`), tick wrapped (`maxAgeMs: 30min`, daemon `log`), both call sites routed (`await guardedTick()` ×2), skip log line in interval. 2 hunks, +6/-2 lines. |
| `test/daemon-tick-guard.test.mjs` (new) | ✓ | 5 tests: behavioral single-flight (overlap → skip, body runs once, re-runs after release) + 4 wiring assertions on daemon source (import present, guard wrap with force-clear, zero bare `await tick()`, skip-log observable present). First test file defending `workspace-bin/memory-daemon.mjs`. |

No unplanned files. No scope expansion.

## Greppable deltas

- `createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000, log })` — memory-daemon.mjs
- `tick skipped (in-flight)` — memory-daemon.mjs (the runtime observable)

## Verification (Phase 5)

- **Tests:** 1493/1493 pass, 0 fail (1488 baseline + 5 new). One transient `embed-benchmark` mean-latency flake under machine load on the first full run; clean on re-run, unrelated.
- **Runtime (the Proof):** daemon restarted onto the symlinked repo code (PID 9102, boot clean, all subsystems up). Induced a long tick by planting a 4-message gateway-format session (`repair-11-verify.jsonl`, precedent: `test-1-5`/`step44-verify`): `ENDED → BOOT` at 15:36:54, single tick ran Phase 0 bootstrap + Phase 2 continuously; the interval fire at **15:37:24** logged `tick skipped (in-flight)` instead of starting a concurrent tick. Log shows zero interleaved Phase-0/Phase-2 sequences. Watcher recorded `memory.ingested` for `repair-11-verify` (`status:ok`, `messages_added:4`) through the guarded tick. PID stable, no new `.err` class.

## Findings

1. `memory-maintenance failed: exit 1` inside Phase 0 bootstrap (15:37:01), while Phase 2's `memory-maintenance` succeeded seconds later — pre-existing, captured to OUT_OF_SCOPE.md (not this step's scope).
2. Boot-restored ENDED state makes natural ticks short; runtime induction required planting session activity. Worth remembering for 1.2-1.4 verification (same induction recipe works).

## Carry-forwards

- The verification session `repair-11-verify` now lives in state.db (4 messages) — harmless test data, same class as prior verification sessions; available as a known fixture for 1.4's dedup proof (flush it twice).
- Skip-line frequency is also a free observability signal: recurring skips in steady state = chronically long ticks (relevant when 3.1 measures LLM latencies).
