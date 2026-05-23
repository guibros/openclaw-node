# AUDIT_PRE — Step 5.4: Cache adjacency in SQLite + periodic refresh job (fsevents/10-min)

**Version:** v5.4-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Cache the wikilink graph from `buildGraph(vaultPath)` into SQLite tables
`concept_graph_nodes` and `concept_graph_edges` for fast spreading-activation
queries (Block 6 dependency). Provide a refresh daemon (`bin/obsidian-graph-cache.mjs`)
that re-caches on a 10-minute interval or on filesystem change. Expose a
queryable library API so Block 6 can import the cache directly (not just CLI).

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.4 | v5.4 | [A] | Cache adjacency in SQLite + periodic refresh job (fsevents/10-min) |

## §3 — Design decisions (consumed from prior AUDIT_POST §6)

- Test baseline is 721 tests (644 pass, 77 fail — 73 pre-existing + 4 flaky).
- `buildGraph(vaultPath)` from `lib/obsidian-graph.mjs:119` returns
  `{nodes: Map<id, {label, subdirectory, ...frontmatter}>, edges: [{source, target, type}]}`.
  This is the primary input.
- Edge types `derived_from`, `contradicts`, `instance_of` are supported via the
  `edge_types` frontmatter mapping — the cache must preserve the `type` field.
- The graph currently only has concept notes (from Step 5.2). Decision, session,
  and theme notes will be populated by future steps or the consolidation cycle
  (Block 8).
- Per Block 5 §0: tables are `concept_graph_nodes(id, label, last_activated_at, weight)`
  and `concept_graph_edges(source_id, target_id, edge_type, weight)`. Indexed both
  directions. Refresh cadence: every 10 min OR on filesystem change via
  fsevents/inotify.
- Per RESUME §0 carry-forward to Block 6: "Block 5 must ensure the cache is
  queryable via library API (not just CLI)."

## §4 — Risk register

- **LOW** — fsevents is macOS-only. Linux uses inotify. Cross-platform fs watching
  adds dependency complexity. Mitigation: use Node.js built-in `fs.watch` (recursive
  option supported on macOS; limited on Linux but 10-min timer is the reliable
  fallback). No new dependency needed.
- **LOW** — Full cache replacement on every refresh could be slow on very large
  graphs. Mitigation: use a transaction (BEGIN/DELETE/INSERT/COMMIT); SQLite
  handles this efficiently for thousands of rows.

## §5 — Deferrals

- fsevents/chokidar as a native dependency — deferred. Using Node.js built-in
  `fs.watch` with `{ recursive: true }` for macOS; 10-min timer is the reliable
  cross-platform fallback.
- Incremental cache updates (diff-based refresh) — deferred. Full replacement is
  simpler and sufficient for expected graph sizes (hundreds to low thousands of
  nodes).

## §6 — Phase 4 implementation outline

| # | File | Change | Description |
|---|------|--------|-------------|
| 1 | `bin/obsidian-graph-cache.mjs` | new | Exports: `createGraphCache(opts)` factory returning `{ refreshCache(), queryNeighbors(nodeId, opts), getNodes(), getEdges(), getStats(), close() }`. `initDb()` creates tables + indexes. `refreshCache()` calls `buildGraph(vaultPath)` and projects into tables via full-replace transaction. `queryNeighbors(nodeId)` returns adjacent edges + neighbor nodes for spreading activation. `getStats()` returns `{ nodeCount, edgeCount, lastRefreshAt }`. `startWatcher(vaultPath, intervalMs)` sets up 10-min interval timer + optional `fs.watch` recursive watcher. `stopWatcher()` clears resources. CLI entry: `--stats` prints stats and exits, `--refresh` does single refresh and exits, default runs as long-running daemon with periodic refresh. |
| 2 | `test/obsidian-graph-cache.test.mjs` | new | ~8 tests: table creation, cache population from mock vault, queryNeighbors returns correct edges, getStats counts, refresh replaces stale data, edge type preservation, weight defaults to 1.0, empty vault produces empty cache. |
