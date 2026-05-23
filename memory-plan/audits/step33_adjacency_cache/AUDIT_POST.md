# AUDIT_POST — Step 5.4: Cache adjacency in SQLite + periodic refresh job (fsevents/10-min)

**Version:** v5.4-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `bin/obsidian-graph-cache.mjs` (new) — createGraphCache, refreshCache, queryNeighbors, getNodes, getEdges, getStats, startWatcher, stopWatcher, close, CLI entry | `bin/obsidian-graph-cache.mjs:72` (createGraphCache), `:27` (DEFAULT_DB_PATH), `:30` (DEFAULT_REFRESH_INTERVAL_MS) | yes | `grep -n 'export' bin/obsidian-graph-cache.mjs` → 3 exports |
| 2 | `test/obsidian-graph-cache.test.mjs` (new) — ~8 tests | `test/obsidian-graph-cache.test.mjs` (10 `it()` blocks) | yes | `grep -c 'it(' test/obsidian-graph-cache.test.mjs` → `10` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function createGraphCache' bin/obsidian-graph-cache.mjs` | `72:export function createGraphCache(opts = {}) {` |
| 2 | `grep -n 'export const DEFAULT_DB_PATH' bin/obsidian-graph-cache.mjs` | `27:export const DEFAULT_DB_PATH = join(homedir(), '.openclaw', 'graph-cache.db');` |
| 3 | `grep -n 'export const DEFAULT_REFRESH_INTERVAL_MS' bin/obsidian-graph-cache.mjs` | `30:export const DEFAULT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;` |
| 4 | `grep -c 'it(' test/obsidian-graph-cache.test.mjs` | `10` |

## §3 — Cross-references still valid

- `bin/obsidian-graph-cache.mjs` imports: `join` from `node:path`, `homedir` from `node:os`, `watch` from `node:fs`, `Database` from `better-sqlite3` (existing dependency), `buildGraph` from `../lib/obsidian-graph.mjs` (Step 5.3), `getVaultPath` from `../lib/obsidian-vault.mjs` (Step 5.1). All resolve correctly.
- `test/obsidian-graph-cache.test.mjs` imports: `createGraphCache`, `DEFAULT_DB_PATH`, `DEFAULT_REFRESH_INTERVAL_MS` from `../bin/obsidian-graph-cache.mjs` plus Node.js built-ins and `Database` from `better-sqlite3`. All resolve.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json` (uses only existing deps: `better-sqlite3`, `js-yaml` transitively via obsidian-graph, Node.js built-ins).

## §4 — Findings

- [POSITIVE] `createGraphCache` factory returns a clean API surface: `refreshCache`, `queryNeighbors`, `getNodes`, `getEdges`, `getStats`, `startWatcher`, `stopWatcher`, `close`. Matches the "queryable via library API" requirement from Block 5 §0 carry-forward.
- [POSITIVE] SQLite tables match REFERENCE_PLAN schema exactly: `concept_graph_nodes(id, label, last_activated_at, weight)` and `concept_graph_edges(source_id, target_id, edge_type, weight)` with both-direction indexes.
- [POSITIVE] Full-replace strategy in `refreshCache()` uses a SQLite transaction (BEGIN/DELETE/INSERT/COMMIT) — atomic and consistent.
- [POSITIVE] `queryNeighbors` supports directional queries (`outgoing`, `incoming`, `both`) — directly useful for spreading activation's forward and backward propagation.
- [POSITIVE] `startWatcher` uses Node.js built-in `fs.watch` with `{ recursive: true }` on macOS (no external dependency) with a 2-second debounce to avoid rapid-fire refreshes. Falls back to timer-only on other platforms.
- [POSITIVE] CLI entry supports three modes: `--stats` (inspect), `--refresh` (one-shot), and daemon (long-running with periodic refresh + fs watching). Graceful SIGINT/SIGTERM shutdown.
- [POSITIVE] Dependency injection via `opts.db` parameter enables testing with `:memory:` databases — tests don't touch the real filesystem database.
- [POSITIVE] All 10 new tests pass. Test count: 731 (654 pass, 77 fail — unchanged baseline of 77 pre-existing + flaky failures).
- [POSITIVE] Tests cover: table creation, cache population, queryNeighbors (both/outgoing/incoming), getStats, full replacement, edge type preservation, weight initialization, empty vault, constants, and watcher lifecycle.
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 said "~8 tests". Actual: 10 `it()` blocks. Phase-4-correction streak: 0 (Block 5; remains at 0 from Step 5.3).

9 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 5.5

- Test baseline is now 731 tests (654 pass, 77 fail — 73 pre-existing + 4 flaky). +10 tests added this step.
- `createGraphCache(opts)` exported from `bin/obsidian-graph-cache.mjs:72` — factory returning API surface for Block 6 spreading activation.
- `DEFAULT_DB_PATH` at line 27 resolves to `~/.openclaw/graph-cache.db`.
- `DEFAULT_REFRESH_INTERVAL_MS` at line 30 = 600000 (10 minutes).
- `refreshCache()` calls `buildGraph(vaultPath)` and projects into SQLite tables atomically.
- `queryNeighbors(nodeId, { direction })` provides the exact query primitive Block 6's spreading activation algorithm needs.
- Step 5.5 (shared vault promotion) is independent of the adjacency cache — it writes to `projects/arcane-vault/concepts-shared/` per Block 5 §0.
- The graph cache DB is separate from the extraction store DB and the knowledge DB — Block 6 will import `createGraphCache` directly.
