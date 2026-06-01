# AUDIT_PRE — Step 6.1: Build lib/sqlite-store.mjs

## §0 Re-orient

- Where am I: Block 6 (L6 health + storage hygiene), step 1/5, 32/40 overall.
- Last step changed: 5.3 fixed 2 bugs (knowledgeDb not passed to inject server + privacy filter blocking local results) — all 5 retrieval channels now return non-empty results. Block 5 COMPLETE.
- This step contributes: the shared SQLite open helper that all DB sites will route through (step 6.2), providing WAL + foreign_keys + busy_timeout + integrity_check + user_version as default pragmas. Foundation for all Block 6 hygiene.
- Block serves the north star via: DESIGN_INPUTS §5 scars — "the 331 MB WAL bloat" + "crash-loop 13,834×" + "no schema versioning anywhere". Operational robustness for unattended local-first operation.
- Still the right next step? Yes — the helper must exist before 6.2 routes all sites through it.

## 1. Intent

Build `lib/sqlite-store.mjs` — a minimal shared helper that opens a better-sqlite3 Database with all required pragmas:
- `journal_mode = WAL` (concurrent readers)
- `foreign_keys = ON` (referential integrity)
- `busy_timeout = 5000` (prevent SQLITE_BUSY under contention)
- `integrity_check` on first open (detect corruption early)
- `user_version` get/set (schema versioning foundation for 6.3)

Export a single function (`openStore(dbPath, opts)`) that returns a configured `Database` instance.

## 2. Design

```js
import Database from 'better-sqlite3';

export function openStore(dbPath, opts = {}) {
  const db = new Database(dbPath, { readonly: opts.readonly ?? false });
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  if (opts.integrityCheck !== false) {
    const result = db.pragma('integrity_check');
    if (result[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(result)}`);
    }
  }
  return db;
}

export function getVersion(db) {
  return db.pragma('user_version', { simple: true });
}

export function setVersion(db, version) {
  db.pragma(`user_version = ${Number(version)}`);
}
```

Minimal, no class — matches the "one-hop" taste (DESIGN_INPUTS §2). No more than needed for 6.1.

## 3. Risk register

- **Risk:** `integrity_check` on a 74MB knowledge.db might be slow (~seconds). Mitigation: the check is opt-out (`integrityCheck: false`).
- **Risk:** readonly databases can't set WAL/foreign_keys pragmas (they're already set on disk or irrelevant). Mitigation: skip pragma writes for readonly opens.

## 4. File-delta outline

| File | Action |
|------|--------|
| `lib/sqlite-store.mjs` | CREATE — the helper |
| `test/sqlite-store.test.mjs` | CREATE — pragma readback verification |

## 5. Carry-forwards consumed (from 5.3 AUDIT_POST §6)

- LLM analysis timeout → not relevant to this step (OUT_OF_SCOPE)
- healthProbeTimer ReferenceError → not relevant to this step (OUT_OF_SCOPE)
- lib/ stale copies → the helper lands via symlink (lib/ IS the runtime tree); no drift concern
