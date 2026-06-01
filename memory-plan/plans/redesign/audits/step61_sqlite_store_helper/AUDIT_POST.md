# AUDIT_POST — Step 6.1: Build lib/sqlite-store.mjs

**Closed:** 2026-06-01 · **Version:** v6.1

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE) | Actual | Match |
|---|---|---|
| CREATE `lib/sqlite-store.mjs` — shared open helper with WAL, foreign_keys, busy_timeout, integrity_check, user_version | `lib/sqlite-store.mjs`: 35 lines, exports `openStore`, `getVersion`, `setVersion` | ✓ |
| CREATE `test/sqlite-store.test.mjs` — pragma readback verification | `test/sqlite-store.test.mjs`: 11 tests covering all pragmas + edge cases | ✓ |

## 2. Greppable deltas

```
lib/sqlite-store.mjs         + (new) 35 lines — openStore(dbPath, opts), getVersion(db), setVersion(db, v)
test/sqlite-store.test.mjs   + (new) 97 lines — 11 test cases
```

## 3. Done-evidence (runtime-observable)

INVENTORY criterion 6.1: *opening a store via the helper sets all pragmas (PRAGMA readback).*

**MET.**

**Deployment:** `readlink ~/.openclaw/workspace/lib` → `/Users/moltymac/openclaw-nodedev/lib` (lib IS runtime via symlink from step 0.1). `ls -la ~/.openclaw/workspace/lib/sqlite-store.mjs` → file present (926 bytes).

**PRAGMA readback (via `npm test`, 1484/0):**
- `journal_mode` → `'wal'` ✓
- `foreign_keys` → `1` ✓
- `busy_timeout` → `5000` ✓
- `integrity_check` → `'ok'` ✓
- `user_version` → `0` (default), `setVersion(3)` → `getVersion` → `3` ✓

**Additional coverage:**
- Corrupt DB → throws with descriptive message ✓
- Readonly open → skips pragma writes, reads back existing WAL ✓
- Nested parent directory creation ✓
- `integrityCheck: false` opt-out ✓
- Version persists across DB close/reopen ✓

## 4. Design notes

The helper is deliberately minimal (35 lines, 3 exports, no class) per DESIGN_INPUTS §2 "one-hop, no bullshit." It does not:
- Wrap or subclass `Database` — returns the raw better-sqlite3 instance for full API compatibility.
- Manage connections/pools — callers own their lifecycle.
- Include migration logic — that's step 6.3.

The `integrityCheck` opt-out exists for large readonly databases (knowledge.db: 74MB) where the check would add seconds to cold-open. Default is `true` — fail-fast on corruption.

## 5. Carry-forward

- Step 6.2 will route all `new Database()` production sites through `openStore()`. 16+ sites identified (grep output in AUDIT_PRE). Test-only sites (`:memory:`) can remain raw.
- The `busy_timeout = 5000` value is conservative (5s). May need tuning once all sites use it and contention patterns become observable.
- No decision needed — this step is pure library work with no architectural choices.

## 6. Block position

Step 6.1 is the FIRST step of Block 6 (L6 health + storage hygiene). 4 remaining: 6.2 (route all sites), 6.3 (schema-version migration), 6.4 (WAL checkpoint on shutdown), 6.5 (health-watch + clean respawn). Opens Block 6.
