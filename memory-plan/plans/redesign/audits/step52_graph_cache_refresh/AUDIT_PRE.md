# AUDIT_PRE — Step 5.2: Construct graphCache in the daemon + refresh it on the synthesis cadence

**Version:** v5.1 → v5.2 · **Block:** 5 (L5 retrieval freshness) · **Author:** redesign-tick

## §0 Re-orient

- Where am I: Block 5 (L5 retrieval freshness), step 2/3, 30/36 overall.
- Last step changed: 5.1 — daemon Phase 2 incrementally indexes new sessions into knowledge.db (channel 2 freshness).
- This step contributes: wires graph-cache.db refresh into the daemon so channel 5 (spreading activation) operates on fresh wikilink data from the vault.
- Block serves the north star via: MASTER_PLAN §3.1 "5 channels (FTS, vec, entity, theme, spreading-activation); RRF fuse" — channel 5 needs a fresh graph-cache to return results.
- Still the right next step? Yes — knowledge.db (channel 2) is now fresh; graph-cache (channel 5) is the remaining stale retrieval dependency before the integration checkpoint (5.3).

## 1. Intent

Wire graph-cache.db periodic refresh into the memory daemon's Phase 2 throttled work. The `bin/obsidian-graph-cache.mjs` module already has `createGraphCache()` with `refreshCache()` and `startWatcher()` — it just isn't called from the daemon. The inject server creates its own read-only graphCache instance (via `resolveDeps()`) which will see refreshed data through WAL since both connections hit the same SQLite file.

## 2. Design

**Approach:** Add a lazy `getGraphCache()` initializer to the daemon (same pattern as `getKnowledgeDb()`). Add `lastGraphCacheRefresh: 0` to the throttle state. In Phase 2, add a refresh task on the synthesis cadence (30 min, `config.intervals.maintenanceMs`). Place it AFTER Stage 2 (Obsidian sync) so the refresh picks up any vault notes written during Stage 1 synthesis and Stage 2 obsidian sync. On shutdown, close the graphCache instance.

No event emission — graph-cache refresh is not a boundary event in the 1.1 vocabulary. Just a log line.

**Why not share the instance with the inject server?** Both the daemon's graphCache and the inject server's graphCache open the same `~/.openclaw/graph-cache.db` with WAL mode. The daemon writes (refreshCache full-replace transaction); the inject server only reads (queryNeighbors). WAL allows concurrent readers and committed writes are immediately visible to other connections. No instance-sharing needed.

**Why 30 min and not 10 min?** The step says "refresh on the synthesis cadence" — synthesis runs every 30 min (D2). Vault content changes at synthesis time, so aligning graph-cache refresh to the same cadence captures the new wikilinks. 10-min would work but wastes CPU scanning unchanged vault files.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| `buildGraph()` slow on large vault | Current vault is <200 files; buildGraph scans wikilinks in-memory. If slow, the concurrency guard + catch prevents daemon stall. |
| Concurrent write conflict with inject server | Inject server only reads. WAL + busy_timeout prevent SQLITE_BUSY. |
| graphCache init fails (missing sqlite-vec or similar) | Lazy init with try/catch, same pattern as getKnowledgeDb(). Failure logged and skipped. |

## 4. File-delta outline

| File | Change |
|---|---|
| `workspace-bin/memory-daemon.mjs` | Import `createGraphCache`. Add lazy `getGraphCache()`. Add `lastGraphCacheRefresh: 0` to throttle state. Add Phase 2 refresh task after Obsidian sync (30 min cadence). Close graphCache on shutdown. |

No new files. No schema changes. No test files — this is daemon wiring, verified by runtime evidence.
