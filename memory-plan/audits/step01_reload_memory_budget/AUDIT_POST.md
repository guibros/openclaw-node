# AUDIT_POST — Step 0.1: Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

**Version:** v0.1-mid
**Date:** 2026-05-20
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | daemon: reload() after both runFlush sites + NATS subscribe `mesh.memory.compaction_completed` | `workspace-bin/memory-daemon.mjs:835,874,1049-1063` | yes | `grep -n 'memoryBudget.reload' workspace-bin/memory-daemon.mjs` → lines 835, 874, 1058; `grep -n 'mesh.memory.compaction_completed' workspace-bin/memory-daemon.mjs` → lines 1054, 1059, 1063 |
| 2 | test: reload after external write updates getRendered in mid-session | `test/memory-budget.test.mjs:238-265` | yes | `grep -n 'reload after external write' test/memory-budget.test.mjs` → lines 238, 239 |

All 2 rows landed = yes. 2 rows = 2 non-audit non-ledger files in staged diff.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1+2 | `grep -n 'memoryBudget.reload' workspace-bin/memory-daemon.mjs` | `835:              memoryBudget.reload();` |
| 3 | `grep -n 'mesh.memory.compaction_completed' workspace-bin/memory-daemon.mjs` | `1054:    const sub = natsConn.subscribe('mesh.memory.compaction_completed');` |
| 4 | `grep -n 'reload after external write' test/memory-budget.test.mjs` | `238:describe('reload after external write', () => {` |

## §3 — Cross-references still valid

- `MemoryBudget` class unchanged — only new call sites added.
- `reload()` method at `lib/memory-budget.mjs:92` unchanged.
- `createBudget` import in daemon at line 42 unchanged.
- No symbols renamed or deleted. Searched `import.*memory-budget` across repo — only 2 hits (daemon, test), both valid.
- Module-level `memoryBudget` variable at daemon line 345 referenced by new code at lines 835, 874, 1058 — consistent with existing guard pattern at line 892.

## §4 — Findings

- [POSITIVE] The first runFlush site (pre-compression) now guards reload with `result.added > 0 || result.merged > 0` — avoids unnecessary reload when flush found nothing actionable.
- [POSITIVE] The second runFlush site (end-of-session) applies the same guard.
- [POSITIVE] NATS connection is fully optional with try/catch and graceful degradation log message — local-first principle upheld.
- [POSITIVE] NATS subscription async iterator wrapped in `.catch(() => {})` to prevent unhandled rejection when connection drains.
- [POSITIVE] Shutdown handler drains NATS connection before exit — clean resource cleanup.
- [POSITIVE] New test covers the exact flush→reload→getRendered pattern including event emission verification.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.2

- The daemon now has an optional NATS connection (`natsConn`) scoped to `main()`. Step 0.2's `.companion-state.md` rename does not interact with this connection — no collision expected.
- The `shutdown` handler in `main()` is now `async` due to `natsConn.drain()`. Step 0.2 should be aware that the shutdown function signature changed if it modifies shutdown behavior.
- Test baseline is now 467 tests, 394 pass, 73 fail (pre-existing).
