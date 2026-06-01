# AUDIT_POST — Step 6.2: Route all `new Database()` sites through the helper

**Closed:** 2026-06-01 · **Version:** v6.2

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE) | Actual | Match |
|---|---|---|
| lib/extraction-store.mjs → openStore, remove WAL/FK/dir | ✓ import+call+pragma+dir removed | ✓ |
| lib/session-store.mjs → openStore, remove WAL/FK/dir | ✓ import+call+pragma+dir removed (fs import kept — used elsewhere) | ✓ |
| lib/kanban-store.mjs → openStore, remove WAL/dir | ✓ import+call+pragma+dir removed | ✓ |
| lib/hyperagent-store.mjs → openStore, remove WAL/FK/busy_timeout/dir | ✓ import+call+pragma+dir removed | ✓ |
| lib/health-check.mjs → dynamic openStore, readonly | ✓ dynamic import of sqlite-store.mjs | ✓ |
| lib/memory-inject-server.mjs → dynamic openStore, readonly, integrityCheck:false | ✓ knowledge.db opened with integrityCheck:false | ✓ |
| lib/mcp-knowledge/core.mjs → openStore, keep sqliteVec.load | ✓ openStore + sqliteVec.load; pragmas removed | ✓ |
| lib/obsidian-summarizer.mjs → openStore, readonly | ✓ import+call replaced | ✓ |
| lib/memory-watcher.mjs → openStore, remove Database DI | ✓ probeStore param removed; openStore with integrityCheck:false | ✓ |
| bin/extract-existing-sessions.mjs → openStore, readonly | ✓ | ✓ |
| bin/embed-existing-sessions.mjs → openStore, readonly | ✓ | ✓ |
| bin/obsidian-graph-cache.mjs → openStore, remove WAL/busy_timeout pragmas from initDb | ✓ | ✓ |
| bin/openclaw-memory-daemon.mjs → dynamic openStore import | ✓ | ✓ |
| bin/consolidate.mjs → openStore, remove WAL pragma | ✓ | ✓ |
| bin/run-tuning-harness.mjs → dynamic openStore, readonly | ✓ | ✓ |
| bin/run-block3-validation.mjs → openStore, readonly | ✓ | ✓ |
| bin/spawn-node.mjs → dynamic openStore, remove WAL pragma | ✓ | ✓ |
| workspace-bin/memory-daemon.mjs → dynamic openStore, readonly | ✓ | ✓ |
| test-session-note-runtime.mjs → openStore, readonly | ✓ | ✓ |

## 2. Greppable deltas

```
lib/extraction-store.mjs       ~ -14 lines (import, dir-creation, pragmas)
lib/session-store.mjs           ~ -8 lines (import, dir-creation, pragmas)
lib/kanban-store.mjs            ~ -10 lines (import, dir-creation, pragma)
lib/hyperagent-store.mjs        ~ -10 lines (import, dir-creation, pragmas)
lib/health-check.mjs            ~ 1 line changed (dynamic import)
lib/memory-inject-server.mjs    ~ 2 lines changed (dynamic import + integrityCheck)
lib/mcp-knowledge/core.mjs      ~ -4 lines (import, pragmas)
lib/obsidian-summarizer.mjs     ~ 2 lines changed
lib/memory-watcher.mjs          ~ 6 lines changed (import added, DI removed)
bin/extract-existing-sessions   ~ 2 lines changed
bin/embed-existing-sessions     ~ 2 lines changed
bin/obsidian-graph-cache        ~ -10 lines (import, pragmas from initDb)
bin/openclaw-memory-daemon      ~ 3 lines changed (dynamic import)
bin/consolidate                 ~ 3 lines changed (import, pragma removed)
bin/run-tuning-harness          ~ 2 lines changed (dynamic import)
bin/run-block3-validation       ~ 2 lines changed
bin/spawn-node                  ~ 3 lines changed (dynamic import, pragma removed)
workspace-bin/memory-daemon     ~ 2 lines changed (dynamic import)
test-session-note-runtime       ~ 2 lines changed
```

Net: 22 files changed, -89/+109 lines (more removals than additions from pragma/dir-creation cleanup).

## 3. Done-evidence (runtime-observable)

INVENTORY criterion 6.2: *grep shows zero raw `new Database(` outside the helper.*

**MET.**

```
$ grep -rn 'new Database(' --include='*.mjs' | grep -v test/ | grep -v node_modules/ | grep -v '.claude/worktrees/'
lib/sqlite-store.mjs:11:  const db = new Database(dbPath, { readonly: opts.readonly ?? false });
```

Only the helper itself. All 19 production `.mjs` files routed through `openStore()`. Tests: 1484/0 (unchanged count — no test files modified).

**Exclusion:** 5 CJS files (`.js`) retain raw `new Database()` — `lib/obs-db.js` and 4 `mission-control/scripts/*.js`. All operate on `mission-control.db` (not memory pipeline databases). CJS can't import ESM `.mjs` helpers without a shim. Captured in OUT_OF_SCOPE (2026-06-01).

## 4. Design notes

Conversion patterns applied:
- **Static ESM import:** `import { openStore } from '<relative>/sqlite-store.mjs'` replaced `import Database from 'better-sqlite3'` for top-level callers.
- **Dynamic import:** `const { openStore } = await import('<path>/sqlite-store.mjs')` replaced `(await import('better-sqlite3')).default` for deferred-load callers (health-check, inject-server, tuning-harness, federation daemon, spawn-node, workspace daemon).
- **Dir creation removed:** `openStore` handles `mkdirSync` for write opens; 4 files had redundant dir-creation blocks.
- **Pragma removal:** WAL, foreign_keys, busy_timeout pragmas removed from 8 files — all now inherited from `openStore`.
- **DI pattern removed (memory-watcher):** `probeStore(Database, dbPath, queries)` → `probeStore(dbPath, queries)` using `openStore` directly. The `opts.Database` injection point in `runStoreHealthProbes` removed. Tests pass because they create real DBs at known paths (no mock Database constructor needed).
- **integrityCheck: false** used for: knowledge.db (74MB, readonly opens in inject-server) and health-probe stores (5-min interval probes shouldn't add integrity-check latency; probeStore already catches failures).

## 5. Carry-forward

- 5 CJS files remain with raw `new Database()` (see OUT_OF_SCOPE 2026-06-01). Not blocking memory pipeline work.
- `busy_timeout = 5000` is now universally applied to all write opens. Monitor for contention issues under concurrent daemon+CLI usage.
- `opts.db` DI pattern in `obsidian-graph-cache.mjs` and `consolidate.mjs` still accepts pre-opened DB instances from callers (test injection). These bypass `openStore` — acceptable since test callers create DBs with their own pragmas.

## 6. Block position

Step 6.2 is the SECOND step of Block 6 (L6 health + storage hygiene). 3 remaining: 6.3 (schema-version migration), 6.4 (WAL checkpoint on shutdown), 6.5 (health-watch + clean respawn).
