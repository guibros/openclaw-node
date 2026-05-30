# AUDIT_PRE — Step 2.3: Store-health probes: row counts, last-write, WAL size, repo↔runtime drift

## §0 Re-orient

- Where am I: Block 2 (L2 watcher), step 3/6, 12/40 overall.
- Last step changed: 2.2 added `classifyStatus` to watcher records (ok/noop/error per event type).
- This step contributes: gives the watcher store-level observability — row counts, staleness, WAL size, drift — complementing the per-op event stream with periodic store health snapshots.
- Block serves the north star via: DESIGN_INPUTS §2 "one-hop observability" — the watcher is the lens (D6) that makes every later fix confirmable.
- Still the right next step? Yes — the watcher needs store-health data before the API endpoint (2.4) can serve it.

## 1. Intent

Add a `runStoreHealthProbes(opts)` function to `lib/memory-watcher.mjs` that opens each SQLite database readonly, queries row counts for key tables, checks WAL file sizes on disk, and verifies repo↔runtime symlink integrity. Wire it into the daemon on a periodic timer, writing results to `watcher.jsonl` as `op: 'health.probe'` records.

## 2. Design

### 2.1 `runStoreHealthProbes(opts)` — pure async function

Opens 3 databases readonly (`{ readonly: true }`, matching the pattern in `lib/health-check.mjs:146`):

**state.db** (`~/.openclaw/state.db`):
- Row counts: `sessions`, `messages`, `entities`, `themes`, `mentions`, `decisions`
- Last write: `MAX(start_time)` from sessions

**knowledge.db** (`~/.openclaw/workspace/.knowledge.db`):
- Row counts: `session_documents`, `session_chunks`
- Last indexed: `MAX(last_indexed)` from session_documents

**graph-cache.db** (`~/.openclaw/graph-cache.db`):
- Row counts: `concept_graph_nodes`, `concept_graph_edges`
- Last refresh: `last_refresh_at` from `graph_cache_meta`

**WAL sizes**: `fs.statSync(dbPath + '-wal').size` for each (0 if absent).

**Drift check**: `fs.lstatSync` + `fs.readlinkSync` on `~/.openclaw/workspace/lib` and `~/.openclaw/workspace/bin/memory-daemon.mjs` — true if symlink exists.

### 2.2 Output shape

```json
{
  "ts": "ISO-8601",
  "op": "health.probe",
  "status": "ok",
  "stores": {
    "state": { "sessions": N, "messages": N, "entities": N, "themes": N, "mentions": N, "decisions": N, "last_session": "ISO", "wal_bytes": N },
    "knowledge": { "session_documents": N, "session_chunks": N, "last_indexed": "ISO", "wal_bytes": N },
    "graph_cache": { "nodes": N, "edges": N, "last_refresh": "ISO", "wal_bytes": N }
  },
  "drift": { "lib_symlinked": bool, "daemon_symlinked": bool }
}
```

### 2.3 Daemon integration

- Import `runStoreHealthProbes` in the daemon
- After watcher init: run once immediately, then `setInterval` every 5 minutes
- Each probe result appended to watcher.jsonl
- Timer cleared on shutdown

### 2.4 Carry-forward consumption

From 2.2 AUDIT_POST §6: "Step 2.3 is independent of the watcher record format — it produces separate probe records or a separate output." Confirmed — using the same watcher.jsonl output but with a distinct `op: 'health.probe'` that doesn't overlap with event records.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| DB file missing (e.g., knowledge.db on a fresh install) | Try/catch per store; report `null` for missing stores |
| better-sqlite3 import fails (native module) | Dynamic import with catch, same pattern as health-check.mjs |
| WAL file absent (DB in journal mode or never written) | stat catch → `wal_bytes: 0` |
| Readonly open fails on locked DB | `busy_timeout` not needed for readonly; catch and report error |

## 4. File-delta outline

| File | Change |
|---|---|
| `lib/memory-watcher.mjs` | Add `runStoreHealthProbes(opts)` export |
| `test/memory-watcher.test.mjs` | Tests for probe output shape, per-store counts, WAL size, drift, missing-DB handling |
| `workspace-bin/memory-daemon.mjs` | Import + wire timer + initial run + shutdown cleanup |
