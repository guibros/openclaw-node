# OpenClaw Memory Plan — Resume Doc

**Workplan status.** Block 0 in progress. Step 0.1 closed; Step 0.2 is next.
**Current version carrier.** `v0.1` (Step 0.1 closed).
**Streaks.** zero-Phase-4-correction: 1 of 1 · zero-Phase-8-patch: 1 of 1.
**Last commit on plan branch.** v0.1 — Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test.

A fresh worker reading only this file should be able to resume the workplan with no
conversational context. The Framework that governs how steps are executed is at
[FRAMEWORK.md](FRAMEWORK.md). The full implementation plan is at
[REFERENCE_PLAN.md](REFERENCE_PLAN.md). The step list is at [INVENTORY.md](INVENTORY.md).

---

## §0 — Block-level frozen decisions

These constraints apply to every step in the **current block** (Block 0) and are not
re-litigated per step. Each block transition will reset §0 with the block's own constraints.

### Working principles (apply to all blocks)

- **Local-first.** No phase may break local offline operation. Federation features are opt-in capabilities.
- **One commit per step.** No mid-step commits, no amends, no force-pushes. The Phase 9 commit is the only commit a tick produces.
- **Block on architectural choices.** If a step needs a decision not already captured in §0 or in the prior step's `AUDIT_POST §6` carry-forwards, write `BLOCKED.md` and stop. The autonomous worker does not improvise architecture.
- **Tests are a hard gate.** A red `npm test` at Phase 5 is a block trigger, not a "fix forward" cue.
- **Workspace files are out of repo.** `/Users/moltymac/.openclaw/workspace/` is the live runtime tree (MEMORY.md, .companion-state.md, memory/*). When a step touches a workspace file, the **change is documented in the audit doc** but the workspace file itself is not committed (it's not git-tracked). Plan ledgers committed to the repo describe what landed in the workspace.

### Block 0 frozen decisions

- **Scope.** Block 0 fixes already-known bugs in the current memory harness. No new abstractions, no new dependencies. If a step's audit-pre risk register surfaces a refactor temptation, the refactor is deferred to a later block.
- **Files in scope.** Block 0 touches only: `lib/memory-budget.mjs`, `lib/pre-compression-flush.mjs`, `workspace-bin/memory-daemon.mjs`, `workspace-bin/auto-checkpoint`, `workspace-bin/session-recap`, `.claude/hooks/pre-compact.sh`, `.claude/hooks/session-start.sh`, `workspace-bin/daily-log-writer.mjs`, `mission-control/src/app/api/tasks/route.ts`, `test/memory-budget.test.mjs`, `test/regression-bugs.test.js` (new tests as needed), `docs/STATE_FILES.md` (new), `scripts/migrate-companion-state.mjs` (new).
- **No new top-level dependencies.** Anything that touches `package.json` requires a separate block.
- **Workspace-file changes** for Block 0 are limited to renaming the daemon's own `.companion-state.md` → `.daemon-state-${NODE_ID}.md` (Step 0.2). The migration script is the only thing that touches workspace state at runtime.
- **`NODE_ID` source.** Derive from `process.env.OPENCLAW_NODE_ID` with fallback to `os.hostname()`. Document the fallback in the audit-pre.

### Carry-forward into Block 1 (Schema & event foundations)

- **Phase 2 scope must be revisited before Block 2 starts.** A prior repo analysis showed that `lib/mcp-knowledge/core.mjs` already implements sqlite-vec + embeddings via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1's first deliverable is a written re-scoping decision: extend mcp-knowledge to embed session JSONL turns, or add a parallel embedding stack in session-store. Block 2 cannot start without this decision recorded in `RESUME.md §0` for Block 2.
- **Zod is not yet a top-level dependency.** Block 1 adds it via the new `packages/event-schemas` workspace package, not as a root dependency.
- **NATS JetStream is already mesh-wired** ([lib/mesh-tasks.js](../lib/mesh-tasks.js), [lib/mesh-plans.js](../lib/mesh-plans.js), [lib/mesh-collab.js](../lib/mesh-collab.js)). Block 1 adds a NEW stream `local-events-${NODE_ID}` at R=1; existing buckets are untouched.

---

## §1 — Per-step close paragraphs

### Step 0.1 — Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

Closed at v0.1. `MemoryBudget.reload()` now fires after both daemon flush paths
(pre-compression at line 835, end-of-session at line 874) and via an optional NATS
subscription on `mesh.memory.compaction_completed` (line 1054). The NATS connection is
optional with graceful degradation — if NATS is unavailable, the daemon continues to work
locally. One new test added. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.2: the daemon now has an async shutdown handler
and an optional `natsConn` in `main()` scope.

---

## §N+1 — Progress tracker

```
Steps closed:               1 / 45
Current block:              0 (Stop the bleeding)
Steps closed in block:      1 / 7
Consecutive zero-Phase-4-correction streak:  1
Consecutive zero-Phase-8-patch streak:       1
Test baseline (npm test):   467 tests (394 pass, 73 fail pre-existing)
Last successful tick:       2026-05-20 (Step 0.1)
Last block file written:    (none)
```

---

## Next-tick checklist

The next scheduled tick should:

1. Run pre-flight (Framework §8).
2. Decode state: `VERSION` is `v0.1` (no suffix) → Start NEXT step at Phase 1.
3. Read `INVENTORY.md` → first `[ ]` row is Step 0.2.
4. Read `AUDIT_POST §6` from `memory-plan/audits/step01_reload_memory_budget/AUDIT_POST.md` for carry-forwards.
5. Execute Phases 1 → 4 → 5 → 7 → 8 → 8.5 → 9 for Step 0.2.
6. Commit. Stop.
