# AUDIT_PRE — Step 6.2: Route all `new Database()` sites through the helper

## §0 Re-orient

- Where am I: Block 6 (L6 health + storage hygiene), step 2/5, 33/40 overall.
- Last step changed: 6.1 built `lib/sqlite-store.mjs` — the shared open helper with WAL + foreign_keys + busy_timeout + integrity_check + user_version.
- This step contributes: routes every production `new Database()` call through `openStore()`, so all stores get consistent pragmas. The mechanical bulk that makes 6.1 matter.
- Block serves the north star via: DESIGN_INPUTS §5 scars — every store gets busy_timeout (prevents SQLITE_BUSY), WAL (concurrent read), integrity_check (detect corruption), and user_version (enables 6.3 migration).
- Still the right next step? Yes — the helper exists (6.1); routing all sites through it is the natural next step before 6.3 (migration) can rely on universal `user_version`.

## 1. Intent

Replace every `new Database(...)` call in production code (non-test) with `openStore(...)` from `lib/sqlite-store.mjs`. Remove redundant manual pragma setting and directory creation that `openStore` now handles.

Per 6.1 carry-forward: test-only sites (`:memory:` and test/ directory) can remain raw.

## 2. Design

Each conversion follows a mechanical pattern:

**For files with `import Database from 'better-sqlite3'`:**
- Replace with `import { openStore } from '<relative-path>/sqlite-store.mjs'`
- Replace `new Database(path)` → `openStore(path)`
- Replace `new Database(path, { readonly: true })` → `openStore(path, { readonly: true })`
- Remove `Database` import if no longer needed
- Remove manual `db.pragma('journal_mode = WAL')`, `db.pragma('foreign_keys = ON')`, `db.pragma('busy_timeout = ...')` that openStore now handles
- Remove manual `fs.mkdirSync(dir, { recursive: true })` dir creation that openStore now handles

**For files with dynamic `import('better-sqlite3')`:**
- Replace with `const { openStore } = await import('<path>/sqlite-store.mjs')`

**For files using `createRequire` to get `Database`:**
- Add static ESM import of `openStore` at the top; use it instead of `require('better-sqlite3')`

**Special cases:**
- `lib/mcp-knowledge/core.mjs`: needs `sqliteVec.load(db)` after open — `openStore` returns the raw db, so `sqliteVec.load(openStore(path))` works. Pass `integrityCheck: false` (74MB knowledge.db).
- `lib/memory-watcher.mjs` `probeStore()`: takes `Database` as DI parameter. Replace with `openStore` import; pass `{ readonly: true, integrityCheck: false }` since probes must not add latency to the 5-min health check cycle and already catch/return-null on failure.
- `bin/openclaw-memory-daemon.mjs` (the inert federation daemon): convert anyway for grep-clean compliance; this file is slated for deletion (MASTER_PLAN §4.6) but currently in the repo.

## 3. Risk register

- **Risk:** Converting a DI-parameterized call (memory-watcher `probeStore`) removes test injectability. Mitigation: the test already creates real DBs at known paths and passes those paths; it doesn't mock the Database constructor.
- **Risk:** integrity_check on large readonly databases (knowledge.db) adds cold-open latency. Mitigation: pass `integrityCheck: false` for known-large readonly opens.
- **Risk:** Changing imports breaks module resolution. Mitigation: npm test after conversion verifies all imports resolve.

## 4. File-delta outline

19 files total (production code only; test/ files unmodified):

| File | Change |
|------|--------|
| `lib/extraction-store.mjs` | `new Database` → `openStore`; remove manual WAL/FK pragmas + dir creation |
| `lib/session-store.mjs` | `new Database` → `openStore`; remove manual WAL/FK pragmas + dir creation |
| `lib/kanban-store.mjs` | `new Database` → `openStore`; remove manual WAL pragma + dir creation |
| `lib/hyperagent-store.mjs` | `new Database` → `openStore`; remove manual WAL/FK/busy_timeout pragmas + dir creation |
| `lib/health-check.mjs` | dynamic import → `openStore`; readonly |
| `lib/memory-inject-server.mjs` | dynamic import → `openStore`; readonly, integrityCheck: false |
| `lib/mcp-knowledge/core.mjs` | `new Database` → `openStore`; remove manual WAL/FK pragmas; keep sqliteVec.load |
| `lib/obsidian-summarizer.mjs` | `new Database` → `openStore`; readonly |
| `lib/memory-watcher.mjs` | remove Database DI; use `openStore` directly; readonly, integrityCheck: false |
| `bin/extract-existing-sessions.mjs` | `new Database` → `openStore`; readonly |
| `bin/embed-existing-sessions.mjs` | `new Database` → `openStore`; readonly |
| `bin/obsidian-graph-cache.mjs` | `new Database` → `openStore`; remove manual WAL/busy_timeout pragmas |
| `bin/openclaw-memory-daemon.mjs` | require → `openStore` import; remove raw Database |
| `bin/consolidate.mjs` | `new Database` → `openStore`; remove manual WAL pragma |
| `bin/run-tuning-harness.mjs` | dynamic import → `openStore`; readonly |
| `bin/run-block3-validation.mjs` | `new Database` → `openStore`; readonly |
| `bin/spawn-node.mjs` | require → `openStore` import; remove manual WAL pragma |
| `workspace-bin/memory-daemon.mjs` | require → `openStore` import; readonly |
| `test-session-note-runtime.mjs` | `new Database` → `openStore`; readonly |

## 5. Carry-forwards consumed (from 6.1 AUDIT_POST §5)

- "16+ sites identified" → confirmed 22 call sites across 19 files (see §4).
- "Test-only sites (`:memory:`) can remain raw" → test/ files excluded.
- "busy_timeout = 5000 value is conservative" → accepted as-is; tuning is a later concern.
