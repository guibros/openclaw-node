# AUDIT_PRE — Step 6.3: Schema-version migration for the existing populated stores

**Version:** v6.2 → v6.3
**Date:** 2026-06-01

## §0 Re-orient

- Where am I: Block 6 (L6 health+storage), step 3/5, 33/36 overall.
- Last step changed: 6.2 routed all 19 production `new Database()` sites through `openStore()`.
- This step contributes: stamps user_version on every database file so future migrations are version-gated.
- Block serves the north star via: DESIGN_INPUTS §5 scars — "the redesign must self-monitor and manage its own storage."
- Still the right next step? Yes — the mechanism exists (getVersion/setVersion from 6.1); this step uses it.

## 1. Intent

Every populated SQLite store (`state.db`, `.knowledge.db`, `graph-cache.db`) must report a `user_version > 0` after its init function runs. This establishes the baseline for future version-gated migrations (e.g., adding columns guarded by `if version < N` rather than per-column pragma inspection).

## 2. Design

Three database files, four schema-owner modules:

| DB file | Schema owner module | Target version |
|---|---|---|
| `~/.openclaw/state.db` | `lib/session-store.mjs` + `lib/extraction-store.mjs` | 1 |
| `~/.openclaw/workspace/.knowledge.db` | `lib/mcp-knowledge/core.mjs` | 1 |
| `~/.openclaw/graph-cache.db` | `bin/obsidian-graph-cache.mjs` | 1 |

For state.db (shared by multiple modules): both session-store and extraction-store stamp version 1. The `if (getVersion(db) < 1)` guard means only the first opener writes; subsequent openers see version already at 1 and skip. Kanban-store and hyperagent-store also open state.db but don't own schema migrations — they benefit from the version stamp set by the primary owners.

Pattern in each module:
```js
import { getVersion, setVersion } from './sqlite-store.mjs';
// ... at end of migration DDL:
if (getVersion(db) < 1) setVersion(db, 1);
```

No architectural decision needed. The mechanism (getVersion/setVersion) was delivered in 6.1. This step activates it.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| Setting user_version on a populated DB corrupts data | user_version is a no-op pragma that writes to the SQLite header byte 60. No table/row impact. |
| Multiple modules stamping same DB race-condition | All opens are synchronous (single-threaded daemon). First open stamps; others skip via guard. |
| A module not yet opened leaves a DB unversioned | Verification after daemon restart + Phase 2 cycle confirms all three DBs versioned. |

## 4. File-delta outline

| File | Change |
|---|---|
| `lib/session-store.mjs` | Add getVersion/setVersion import; stamp at end of #runMigrations() |
| `lib/extraction-store.mjs` | Add getVersion/setVersion import; stamp at end of migration block |
| `lib/mcp-knowledge/core.mjs` | Add getVersion/setVersion import; stamp at end of initDatabase() |
| `bin/obsidian-graph-cache.mjs` | Add getVersion/setVersion import; stamp at end of initDb() |

## 5. Carry-forwards consumed (from 6.2 AUDIT_POST §5)

- "5 CJS files remain with raw `new Database()`" — not relevant to this step (those DBs are mission-control.db, out-of-scope).
- "busy_timeout now universally applied" — no action needed here.
- "opts.db DI pattern bypasses openStore" — these callers (tests) don't need version stamping; their DBs are ephemeral.
