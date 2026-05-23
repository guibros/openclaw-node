# AUDIT_PRE — Step 6.1: Implement spreading-activation algorithm (lib/spreading-activation.mjs)

**Version:** v6.1-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement the spreading activation algorithm as a pure, testable module. This is the core
associative retrieval primitive that propagates activation from seed nodes through the concept
graph, enabling context-aware memory recall. The algorithm operates on the adjacency cache
built in Step 5.4 (`concept_graph_nodes` + `concept_graph_edges` tables).

Per Block 6 §0, the algorithm uses `Math.max` merge (not sum) to prevent hub domination,
with configurable parameters (steps, decay, threshold) defaulting to the REFERENCE_PLAN §6.1
values. Tests use synthetic graphs — the math is provable independent of real data.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [A] | Implement spreading-activation algorithm (lib/spreading-activation.mjs) |

## §3 — Design decisions (consumed from prior carry-forwards)

From Step 5.5 AUDIT_POST §6:
- Test baseline: 735 tests (658 pass, 77 fail — 73 pre-existing + 4 flaky).
- Block 6 depends on adjacency cache from Step 5.4 — `concept_graph_nodes` and `concept_graph_edges` queryable via `createGraphCache()` from `bin/obsidian-graph-cache.mjs:72`.
- Block 5 validation gate (50 nodes/100 edges) explicitly waived in Block 6 §0.

From Block 6 §0 frozen decisions:
- Algorithm parameters: steps=3, decay=0.7, threshold=0.1.
- Activation uses `Math.max` at each target (not sum) — prevents hub domination.
- All defaults configurable via env: `SPREAD_STEPS`, `SPREAD_DECAY`, `SPREAD_THRESHOLD`.
- Tests use synthetic graphs (math provable independent of real data).

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Graph adapter interface mismatch with Step 5.4 cache | LOW | Algorithm takes generic `edgesFrom(nodeId)` interface; adapter maps `queryNeighbors` |
| Env var parsing edge cases (e.g., `SPREAD_DECAY=0`) | LOW | Use `Number()` with explicit `!= null` check, not `||` which swallows 0 |

No HIGH-severity risks.

## §5 — Deferrals

- Wiring to 5-channel retrieval pipeline → Step 6.2.
- Parameter tuning → Step 6.3.
- Historical backfill → Step 6.4.
- Edge weighting beyond default 1.0 → future tuning.

## §6 — Phase 4 implementation outline

| # | File | Action | Detail |
|---|------|--------|--------|
| 1 | `lib/spreading-activation.mjs` | new | Export `DEFAULT_STEPS` (3), `DEFAULT_DECAY` (0.7), `DEFAULT_THRESHOLD` (0.1) constants. Export `spreadingActivation(seeds, graph, opts)` — core algorithm: accepts seeds as Map/object of `{nodeId: activation}`, graph object with `edgesFrom(nodeId) → [{target, weight}]`, opts `{steps, decay, threshold}` with env var fallbacks via `SPREAD_STEPS`/`SPREAD_DECAY`/`SPREAD_THRESHOLD`. Propagates activation through graph for `steps` iterations, applying `decay` multiplier per hop, merging with `Math.max`. Returns sorted `[[nodeId, activation]]` array filtered by `threshold`. Export `createGraphAdapter(graphCache)` — thin adapter wrapping `queryNeighbors('outgoing')` into `edgesFrom` interface for Step 6.2 consumption. ~50 lines. |
| 2 | `test/spreading-activation.test.mjs` | new | ~6 tests with synthetic graphs: linear chain decay, hub activation, threshold filtering, Math.max merge (diamond graph), empty graph, constants export, createGraphAdapter interface. |
