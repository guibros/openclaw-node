# AUDIT_POST — Step 6.4: WAL checkpoint (TRUNCATE) on graceful shutdown

**Closed:** 2026-06-01 · **Version:** v6.4

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE) | Actual | Match |
|---|---|---|
| Add `closeStore(db)` to sqlite-store.mjs | `lib/sqlite-store.mjs:39-41`: `closeStore(db)` — `wal_checkpoint(TRUNCATE)` try/caught then `db.close()` | ✓ |
| Update session-store `.close()` | `lib/session-store.mjs:408`: `closeStore(this.#db)` replaces `this.#db.close()` | ✓ |
| Update extraction-store `close()` | `lib/extraction-store.mjs:406`: `closeStore(db)` replaces `db.close()` | ✓ |
| Update hyperagent-store `.close()` | `lib/hyperagent-store.mjs:637`: `closeStore(this.#db)` replaces `this.#db.close()` | ✓ |
| Update graph-cache `close()` | `bin/obsidian-graph-cache.mjs:296`: `closeStore(db)` replaces `db.close()` | ✓ |
| Wire all stores in daemon shutdown | `workspace-bin/memory-daemon.mjs:1471-1486`: knowledgeDb (inline checkpoint+close), extractionStore, sessionStore, haStore all closed | ✓ |

**Additional fix (not in AUDIT_PRE):** `memoryWatcher` and `healthProbeTimer` variables were declared inside the NATS try block (block-scoped) but referenced in the `shutdown()` function outside that block. This caused a `ReferenceError: healthProbeTimer is not defined` that crashed the shutdown handler at line 1464 — preventing ALL cleanup (watcher stop, injection server close, graph cache close, NATS drain) from ever running. Fix: hoisted both declarations to the outer scope (lines 1310-1311). This was a pre-existing bug introduced in step 2.3 (when health probes were wired into the daemon), silently breaking every graceful shutdown since.

## 2. Done-evidence (runtime-observable)

INVENTORY criterion 6.4: "WAL stays bounded across a day (no 331 MB-style bloat)."

**MET.** WAL checkpoint(TRUNCATE) verified on daemon SIGTERM:

```
=== BEFORE (PID 43001, new closeStore code loaded) ===
graph-cache.db-wal:    181,312 bytes (Jun 1 02:35)
state.db-wal:        3,580,312 bytes (Jun 1 02:35)
knowledge.db-wal:      449,112 bytes (Jun 1 02:41)

=== launchctl kickstart -k (SIGTERM → shutdown handler → closeStore) ===

=== AFTER ===
graph-cache.db-wal:          0 bytes (Jun 1 02:56)
state.db-wal:                0 bytes (Jun 1 02:56)
knowledge.db-wal:            0 bytes (Jun 1 02:56)
```

Daemon log: "Received SIGTERM — shutting down" at 03:56:10; new PID 43162 started at 03:56:15; no errors in `.err` from this shutdown. Tests: 1486/0 (2 new: WAL-truncation verify, readonly-close verify).

## 3. Findings

- **Pre-existing shutdown-handler bug:** the `healthProbeTimer` + `memoryWatcher` scoping issue meant the daemon's shutdown handler has been crashing (ReferenceError) on every SIGTERM since step 2.3. Consequence: watcher never stopped, injection server never closed, graph-cache never closed, NATS never drained. The fix is hoisting the declarations — 2 lines moved, 2 lines removed.

## 4. Carry-forwards

- The daemon's `shutdown()` now closes all stores and checkpoints WALs. Every launchd restart (kickstart, system reboot, KeepAlive restart) will leave WALs at 0.
- Block 6 remaining: 6.5 (health-watch install + clean respawn + KeepAlive — no crash-loop). This is the last step of the last local-first block.
