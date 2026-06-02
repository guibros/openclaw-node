# AUDIT_PRE — Step 1.1: Tick re-entrancy guard (R3)

## §0 Re-orient

- Where am I: Block 1 (stop data corruption), step 1/8, 1/48 overall. First repair step.
- Last step changed: nothing yet — inventory v2 just landed (plan bootstrap).
- This step contributes: closes the structural race that lets duplicate flush/import/synthesis run concurrently — the amplifier behind R4's duplicate extraction and the MEMORY.md write races.
- Block serves the north star via: MASTER_PLAN §3.1 daemon correctness — the knowledge graph's numbers must measure memory, not scheduler accidents, before the D7 vault renders them.
- Still the right next step? Yes — smallest fix in the block, prerequisite for trusting any cycle-cadence verification in 1.2/1.3.

## Intent

`workspace-bin/memory-daemon.mjs:1566` runs `setInterval(async () => { await tick(); }, pollMs=30000)` with no in-flight guard. Ticks measurably exceed 30s (LLM extraction 30-40s+, Phase 0 bootstrap minutes). Overlapping ticks re-read stale throttle state from disk and re-trigger the same work concurrently (FINDINGS R3).

## Design decisions

- **Reuse `lib/concurrency-guard.mjs`** (`createConcurrencyGuard`) — the standardized fix for exactly this bug shape (its own header cites F-P215/F-Q406 siblings: consolidation-scheduler + obsidian-graph-cache already use it). No new mechanism.
- Wrap `tick` once: `const guardedTick = createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000, log })`. maxAgeMs=30min force-clear covers the worst legitimate tick (LLM extraction chain + concept summaries) while preventing a wedged tick from locking the daemon forever (the guard's F-Q306 semantics).
- Call sites: the immediate boot `await tick()` and the interval body both route through `guardedTick`. The interval logs `tick skipped (in-flight)` when the guard returns `{skipped:true}` — the Proof's observable.
- `tick()` already catches its own errors; the guard's `finally` clears in-flight state regardless.

## Risk register

- Restarting the daemon to deploy rides the known-unfenced shutdown (R15, step 4.1) — same exposure as every Block 0-6 restart; accepted.
- maxAgeMs force-clear could theoretically allow overlap after a 30-min wedged tick — intended trade (deadlock recovery > strict exclusion), same posture as the graph-cache usage.

## File-delta outline

- `workspace-bin/memory-daemon.mjs`: +1 import; wrap tick; route 2 call sites; skip log line.
- `test/daemon-tick-guard.test.mjs` (new): behavioral test (overlapping guarded calls → second skips, first's work not duplicated) + wiring assertions on the daemon source (imports the guard, interval awaits the guarded fn, skip log present — first test to defend workspace-bin/memory-daemon.mjs; full manifest defense stays step 7.3).

## Done-evidence contract (INVENTORY 1.1 Proof)

Induced >30s tick → `tick skipped (in-flight)` in daemon log; watcher shows no interleaved Phase-2 ops; regression test asserts the skip. Induction plan: restart daemon — the immediate boot tick (Phase 0 bootstrap, historically minutes) overlaps the first 30s interval fire. Fallback if boot is fast: trigger activity in a watched source so an interval-synthesis LLM tick runs long.
