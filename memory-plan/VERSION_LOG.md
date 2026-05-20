# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

### v0.1 — 2026-05-20 — memory-plan-tick

- **Phase 9** close for Step 0.1: Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test.
- Files committed: `workspace-bin/memory-daemon.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 467 (394 pass, 73 fail — pre-existing). +1 test added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 1-of-1 zero-Phase-4-correction.

### v0.1-mid — 2026-05-20 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.1.
- Files changed: `workspace-bin/memory-daemon.mjs` (reload wiring + NATS sub), `test/memory-budget.test.mjs` (+1 test).
- Test additions: 1 new test ("reload after external write updates getRendered in mid-session").

### v0.1-pre — 2026-05-20 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.1.
- Files planned: `workspace-bin/memory-daemon.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step01_reload_memory_budget/AUDIT_PRE.md`.
- Test baseline: 466 tests (393 pass, 73 fail — pre-existing failures).

## NEXT VERSIONS

Step 0.1 is queued. The first three entries to appear above this divider will be:

- `v0.1-pre`  — Phase 1 audit-pre + version carrier bump
- `v0.1-mid`  — Phase 4 V1 implementation + version carrier bump
- `v0.1`      — Phase 9 close, ledger updates, single commit

(Earlier entries scroll downward as the plan progresses.)
