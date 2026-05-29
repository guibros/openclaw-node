# AUDIT_PRE — Step 10.9: Dogfood harness (`bin/dogfood-council.mjs` + `docs/DOGFOOD_PROTOCOL.md`)

## ~1 — Intent

Implement the dogfood harness for the OpenClaw federation layer. This is the final step of Block 10 — Federation validation in the real world. The harness spawns (or accepts configs for) 3 nodes, subscribes to federation NATS subjects, and captures metrics (broadcast emit rate, offer-to-acceptance ratio, average round-trip time, signature failures, dead-peer events) to a JSONL file. Companion documentation explains how to interpret the metrics and defines "healthy federation" thresholds.

The 24h dogfood RUN happens between Block 10 close and Block 11 start — results inform Block 11 frozen decisions.

## ~2 — Inventory excerpt

```
| 10 | 10.9 | v10.9 | [ ] | Dogfood harness (`bin/dogfood-council.mjs` + `docs/DOGFOOD_PROTOCOL.md`) |
```

## ~3 — Design decisions (consumed from Step 10.8 AUDIT_POST ~6)

- Test baseline: 1102 tests (1027 pass, 75 fail — 73 pre-existing + 2 flaky variance). 0 tests added last step.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
- Daemon does not yet instantiate shared `peerTracker` to pass to offerer/acceptor (offerer/acceptor are separate processes).
- `docs/MULTI_NODE_DEPLOY.md` should be referenced by the dogfood harness for operator setup instructions.

Block 10 frozen decisions (RESUME.md ~0):
- Dogfood IN the block as a harness step. The actual 24h dogfood RUN happens between Block 10 close and Block 11 start.
- `bin/dogfood-council.mjs` spawns 3 nodes locally (or accepts 3 remote node configs).
- Captures metrics to `~/.openclaw/dogfood-metrics.jsonl`.
- Metrics: broadcast emit rate, offer-to-acceptance ratio, average round-trip time, signature failures, dead-peer events.
- `docs/DOGFOOD_PROTOCOL.md` documents interpretation + "healthy federation" definition.

## ~4 — Risk register

| Risk | Severity | Pre-resolved? |
|------|----------|---------------|
| NATS server not available for test | LOW | Yes — tests use mock infrastructure, not real NATS |
| spawn-node requires better-sqlite3 native dep | LOW | Yes — spawn-node handles unavailability with placeholder |
| Metrics JSONL path collision with concurrent harnesses | LOW | Yes — path configurable via `--metrics-path` CLI flag |
| No architectural decisions needed beyond ~0 scope | N/A | All decisions frozen in RESUME.md Block 10 ~0 |

## ~5 — Deferrals

- Actual 24h dogfood run — happens between Block 10 close and Block 11 start (operator-paced).
- `@publish` directive wiring — carries forward (originated Step 9.5).
- event-schemas tsc rebuild — carries forward (originated Step 10.4).
- Shared peerTracker instantiation in daemon — carries forward.

## ~6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `bin/dogfood-council.mjs` | new | Dogfood harness CLI + library: `createDogfoodHarness(opts)` factory with `start()`/`stop()`/`getStats()`. Spawns 3 nodes via `spawnNode` or reads remote configs. Subscribes to NATS `context.broadcast.>`, `context.offer.>`, `context.accepted.>` subjects for metric capture. Records broadcast emit count, offer count, acceptance count, round-trip times, signature failures, dead-peer events. Writes JSONL to `~/.openclaw/dogfood-metrics.jsonl`. CLI with `--node-ids`/`--nats-url`/`--metrics-path`/`--duration`/`--stats` flags. |
| 2 | `docs/DOGFOOD_PROTOCOL.md` | new | Dogfood protocol documentation: prerequisites, setup instructions (references `docs/MULTI_NODE_DEPLOY.md`), how to run the harness, metrics reference table, "healthy federation" thresholds, interpreting results, troubleshooting, and rollback. |
| 3 | `test/dogfood-council.test.mjs` | new | ~12 `it()` blocks covering: metric recording (broadcast/offer/accepted counts), round-trip time calculation, signature failure tracking, dead-peer event tracking, JSONL output format, stats aggregation, node spawning integration, CLI argument parsing, duration timeout, empty metrics handling, concurrent metric writes, metric flush on stop. |
