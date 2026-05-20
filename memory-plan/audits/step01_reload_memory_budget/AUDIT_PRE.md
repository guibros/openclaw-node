# AUDIT_PRE — Step 0.1: Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

**Version:** v0.1-pre
**Date:** 2026-05-20
**Author:** memory-plan-tick

---

## §1 — Intent

Wire the existing `MemoryBudget.reload()` method (lib/memory-budget.mjs:92) into the
daemon's flush paths so that after a `runFlush` modifies MEMORY.md on disk, the frozen
in-memory snapshot is refreshed. Currently `reload()` has tests but zero callers — the
frozen snapshot goes stale after every flush.

Additionally, add an optional NATS subscription on `mesh.memory.compaction_completed` so
that external compaction signals (e.g. from companion-bridge) also trigger a reload. The
NATS connection is optional: if NATS is unavailable, the daemon continues to work locally
(local-first principle).

Finally, add a test that validates the flush→reload→getRendered pattern.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [A] | Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test |

## §3 — Design decisions consumed

No prior step's AUDIT_POST §6 — this is the first step.

Block 0 frozen decisions from RESUME.md §0 apply:
- Files in scope include `workspace-bin/memory-daemon.mjs` and `test/memory-budget.test.mjs`
- No new top-level dependencies
- `NODE_ID` from `process.env.OPENCLAW_NODE_ID` with fallback to `os.hostname()`
- Local-first: NATS is optional/graceful-degradation

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | NATS dependency makes daemon fail to start offline | MEDIUM | Try/catch NATS connect; log warning, continue without subscription. Already mitigated by design. |
| 2 | Calling reload() after flush when budget not yet initialized | LOW | Guard with `if (memoryBudget)` — consistent with existing pattern at line 892. |
| 3 | NATS `nats` package is CJS, daemon is ESM | LOW | Already handled — daemon uses `createRequire` for `tracer` and can use it for `nats` and `nats-resolve`. |

No HIGH-severity risks.

## §5 — Deferrals

- Full NATS-driven event sourcing (Phase 1 scope) deferred to Block 1.
- The NATS subscription here is a minimal bridge — one subject, one handler.

## §6 — Phase 4 implementation outline

| # | File | Delta | Grep proof |
|---|------|-------|------------|
| 1 | `workspace-bin/memory-daemon.mjs` | After first `runFlush` (line ~833): add `memoryBudget.reload()` call + log | `grep -n 'memoryBudget.reload' workspace-bin/memory-daemon.mjs` |
| 2 | `workspace-bin/memory-daemon.mjs` | After second `runFlush` (line ~869): add `memoryBudget.reload()` call + log | same grep as #1 (two hits expected) |
| 3 | `workspace-bin/memory-daemon.mjs` | Add optional NATS connect + subscribe `mesh.memory.compaction_completed` → `memoryBudget.reload()` in `main()` after daemon starts | `grep -n 'mesh.memory.compaction_completed' workspace-bin/memory-daemon.mjs` |
| 4 | `test/memory-budget.test.mjs` | Add test: "reload after external write updates getRendered in mid-session" (flush→reload scenario with char count validation) | `grep -n 'reload after external write' test/memory-budget.test.mjs` |
