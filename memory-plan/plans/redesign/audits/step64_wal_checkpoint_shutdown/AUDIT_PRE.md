# AUDIT_PRE — Step 6.4: WAL checkpoint (TRUNCATE) on graceful shutdown

## §0 Re-orient

- Where am I: Block 6 (L6 health + storage hygiene), step 4/5, 35/40 overall.
- Last step changed: 6.3 stamped `user_version=1` on all 4 store modules (idempotent, post-migration).
- This step contributes: ensures WAL files stay bounded by checkpointing on daemon shutdown — the 331 MB WAL bloat scar (DESIGN_INPUTS §5).
- Block serves the north star via: DESIGN_INPUTS §5 ("Health-checked, no crash-loops … WAL checkpointing, busy_timeout, integrity checks").
- Still the right next step? Yes — WAL checkpoint is the final storage-hygiene fix before health-watch.

## 1. Intent

Add a `closeStore(db)` helper to `lib/sqlite-store.mjs` that runs `PRAGMA wal_checkpoint(TRUNCATE)` then `db.close()`. Wire all daemon databases to use it in the graceful-shutdown handler. Currently the daemon's `shutdown()` only closes `_graphCache`; it does not close sessionStore, extractionStore, haStore, or knowledgeDb — and none of the close paths checkpoint the WAL.

## 2. Design

**2.1 `lib/sqlite-store.mjs`** — add `closeStore(db)`:
```
export function closeStore(db) {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  db.close();
}
```
Try/catch on checkpoint because a readonly or already-closed DB would throw; the close must still happen.

**2.2 Store modules** — update each `.close()` to checkpoint before closing:
- `lib/session-store.mjs` — import `closeStore`, replace `this.#db.close()` with `closeStore(this.#db)`
- `lib/extraction-store.mjs` — import `closeStore`, replace `db.close()` with `closeStore(db)`
- `lib/hyperagent-store.mjs` — import `closeStore`, replace `this.#db.close()` with `closeStore(this.#db)`
- `bin/obsidian-graph-cache.mjs` — import `closeStore`, replace `db.close()` with `closeStore(db)`

**2.3 `workspace-bin/memory-daemon.mjs`** — extend `shutdown()` to close all stores:
- After existing `_graphCache.close()`: close `_knowledgeDb`, `_extractionStore`, `_sessionStore`, `_haStore`
- Order: graph-cache (already present) → knowledgeDb (raw db, `closeStore()`) → extractionStore (`.close()`) → sessionStore (`.close()`) → haStore (`.close()`)
- Each guarded with `if (store) try/catch` matching the existing pattern.

## 3. Risk register

- **Double-close on state.db:** sessionStore and extractionStore both open separate handles to state.db. Closing both is safe — they are independent connections. The first checkpoint(TRUNCATE) will merge the WAL; the second will be a no-op (WAL already empty).
- **Checkpoint blocks writers:** TRUNCATE mode acquires an exclusive lock. Fine on shutdown — no writers remain.
- **Readonly DBs:** `closeStore` try-catches the pragma so readonly handles (if any) don't throw.

## 4. File-delta outline

| File | Change |
|------|--------|
| `lib/sqlite-store.mjs` | +`closeStore(db)` export (~4 lines) |
| `lib/session-store.mjs` | import `closeStore`; 1-line change in `.close()` |
| `lib/extraction-store.mjs` | import `closeStore`; 1-line change in `close()` |
| `lib/hyperagent-store.mjs` | import `closeStore`; 1-line change in `.close()` |
| `bin/obsidian-graph-cache.mjs` | import `closeStore`; 1-line change in `close()` |
| `workspace-bin/memory-daemon.mjs` | +4 close calls in `shutdown()` (~12 lines) |

## 5. Carry-forwards consumed

From step 6.3 AUDIT_POST §3: "All populated stores are now schema-versioned at 1; future schema changes bump the number." — no action needed for 6.4; this is informational context.
