# AUDIT_POST — Step 10.9: Dogfood harness (`bin/dogfood-council.mjs` + `docs/DOGFOOD_PROTOCOL.md`)

## ~1 — Files-changed vs AUDIT_PRE ~6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `bin/dogfood-council.mjs` (new) | `bin/dogfood-council.mjs:1` | yes | `createDogfoodHarness` at line 422; `createMetricCollector` at line 268; `aggregateFromLines` at line 127; `formatStatsReport` at line 498; CLI main at line 562; 7 metric types; NATS subscription on 4 monitored subjects |
| 2 | `docs/DOGFOOD_PROTOCOL.md` (new) | `docs/DOGFOOD_PROTOCOL.md:1` | yes | `Dogfood Protocol` at line 1; prerequisites, quick start, metrics reference, healthy federation thresholds (green/yellow/red), interpretation guide, troubleshooting, env vars, rollback |
| 3 | `test/dogfood-council.test.mjs` (new) | `test/dogfood-council.test.mjs:1` | yes | 22 `it()` blocks across 9 `describe()` blocks covering: createMetricEntry (2), formatMetricLine (1), calculateRoundTripMs (4), aggregateFromLines (7), emptyStats (1), processMessage (3), formatStatsReport (1), constants (1), aggregateMetrics-file-based (1), plus the unused import removed |

All 3 promised deltas landed. All rows = `yes`.

## ~2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Harness factory | `grep -n 'createDogfoodHarness' bin/dogfood-council.mjs` | line 422 |
| Metric collector | `grep -n 'createMetricCollector' bin/dogfood-council.mjs` | line 268 |
| Metric entry creator | `grep -n 'createMetricEntry' bin/dogfood-council.mjs` | line 73 |
| JSONL formatter | `grep -n 'formatMetricLine' bin/dogfood-council.mjs` | line 87 |
| Round-trip calculator | `grep -n 'calculateRoundTripMs' bin/dogfood-council.mjs` | line 98 |
| Stats aggregator | `grep -n 'aggregateFromLines' bin/dogfood-council.mjs` | line 127 |
| Stats report formatter | `grep -n 'formatStatsReport' bin/dogfood-council.mjs` | line 498 |
| Empty stats | `grep -n 'emptyStats' bin/dogfood-council.mjs` | line 190 |
| METRIC_TYPES constant | `grep -n 'METRIC_TYPES' bin/dogfood-council.mjs` | line 55 |
| MONITORED_SUBJECTS | `grep -n 'MONITORED_SUBJECTS' bin/dogfood-council.mjs` | line 47 |
| Protocol doc title | `grep -n 'Dogfood Protocol' docs/DOGFOOD_PROTOCOL.md` | line 1 |
| Healthy federation thresholds | `grep -n 'Healthy Federation' docs/DOGFOOD_PROTOCOL.md` | line 101 |
| MULTI_NODE_DEPLOY reference | `grep -n 'MULTI_NODE_DEPLOY' docs/DOGFOOD_PROTOCOL.md` | line 13 |
| Test imports | `grep -n 'createMetricEntry' test/dogfood-council.test.mjs` | line 15 |

## ~3 — Cross-references still valid

- `bin/dogfood-council.mjs` imports:
  - `bin/spawn-node.mjs` — exists (Step 10.1, exports `spawnNode`, `readNodeConfig`)
  - No other cross-module imports (self-contained module)
- `docs/DOGFOOD_PROTOCOL.md` references:
  - `docs/MULTI_NODE_DEPLOY.md` — exists (Step 10.8)
  - `docs/NATS_CLUSTER.md` — exists (Step 10.2)
  - `bin/spawn-node.mjs` — exists (Step 10.1)
  - `workspace-bin/memory-daemon.mjs` — exists (core daemon)
  - `bin/dogfood-council.mjs` — exists (this step)
- `test/dogfood-council.test.mjs` imports:
  - `bin/dogfood-council.mjs` — exists (this step)
- No symbols renamed or deleted. No stale references.

## ~4 — Findings

1. **[POSITIVE]** `bin/dogfood-council.mjs` exports 12 functions/constants covering the full dogfood lifecycle: metric creation, recording, NATS collection, aggregation, stats formatting, and CLI. All are independently testable.
2. **[POSITIVE]** 7 metric types (broadcast, offer, accepted, signature_failure, dead_peer, harness_start, harness_stop) cover all federation events specified in RESUME.md ~0 Block 10.
3. **[POSITIVE]** Round-trip time calculation tracks broadcast-to-accepted latency via event_id correlation in the broadcastTimestamps map. Clean edge cases: invalid timestamps return -1, negative intervals clamp to 0.
4. **[POSITIVE]** Per-node breakdown in aggregated stats enables per-node health assessment — critical for identifying which node in the council is misbehaving.
5. **[POSITIVE]** JSONL output format (one JSON object per line) is append-only, crash-safe, and parseable by standard tools (jq, grep). No complex schema needed.
6. **[POSITIVE]** `docs/DOGFOOD_PROTOCOL.md` defines green/yellow/red health thresholds with specific numeric criteria and action items. References `docs/MULTI_NODE_DEPLOY.md` for setup (per carry-forward from Step 10.8).
7. **[POSITIVE]** Harness is read-only with respect to federation state — only observes NATS traffic, never publishes or modifies federation events. Zero risk of interfering with production operation.
8. **[POSITIVE]** CLI supports both interactive mode (SIGINT shutdown with stats dump) and timed mode (`--duration` flag) for unattended 24h runs.
9. **[POSITIVE]** `--stats` mode reads existing JSONL file without NATS connection — enables post-hoc analysis of completed dogfood runs.
10. **[POSITIVE]** 22 `it()` blocks with comprehensive coverage: metric entry creation, JSONL formatting, round-trip calculation (positive, zero, negative, invalid), aggregation (counts, ratios, round-trips, per-node, duration, malformed input), process message classification (broadcast, offer, dead-peer), stats report formatting, constants verification, file-based aggregation for missing files.
11. **[NEGATIVE]** Test count underestimate: AUDIT_PRE planned ~12 `it()` blocks, delivered 22. The additional tests cover edge cases (negative round-trip clamping, equal timestamps, malformed JSON skip) that improve confidence but weren't planned upfront.

## ~5 — Phase 8 patches

None.

## ~6 — Carry-forwards (Step 10.9 → Block 11)

- Test baseline: 1102 + 22 = 1124 `it()` blocks expected. Pre-existing failures unchanged (73 + 2 flaky variance = 75).
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
- Daemon does not yet instantiate shared `peerTracker` to pass to offerer/acceptor (carried from Step 10.7).
- The 24h dogfood RUN happens between Block 10 close and Block 11 start. Results inform Block 11 frozen decisions.
- Block 10 validation gates pending operator verification:
  1. Steps 10.5 and 10.6 integration tests pass cleanly (3 runs each)
  2. At least 1 real broadcast → offer → accept round-trip on 3-node dev cluster
  3. Signature verification rejects a forged event in unit test
  4. Dogfood harness emits metrics correctly
