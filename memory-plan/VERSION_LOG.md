# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

### v0.3 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.3: Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup).
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 472 (399 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 3-of-3 zero-Phase-4-correction.

### v0.3-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.3.
- Files changed: `lib/pre-compression-flush.mjs` (added `crypto` import, `stripSupersedes`, `cleanParentheticalChains`; rewrote `mergeFacts` merge path to supersedes-comment model), `test/memory-budget.test.mjs` (+5 tests in new `mergeFacts parenthetical regression` describe block).
- Test additions: 5 new tests (10-merge regression, nested chain cleanup, supersedes presence, stripSupersedes, no-chain passthrough).

### v0.3-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.3.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step03_merge_facts_parenthetical/AUDIT_PRE.md`.
- Test baseline: 467 tests (394 pass, 73 fail — pre-existing).

### v0.2 — 2026-05-20 — memory-plan-tick

- **Phase 9** close for Step 0.2: Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers).
- Files committed: `workspace-bin/memory-daemon.mjs`, `.claude/hooks/session-start.sh`, `workspace-bin/daily-log-writer.mjs`, `mission-control/src/app/api/tasks/route.ts`, `scripts/migrate-companion-state.mjs` (new), audit docs, ledger files.
- Test count: 467 (394 pass, 73 fail — pre-existing). No new tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 2-of-2 zero-Phase-4-correction.

### v0.2-mid — 2026-05-20 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.2.
- Files changed: `workspace-bin/memory-daemon.mjs` (NODE_ID + daemon-state path), `.claude/hooks/session-start.sh` (daemon-state path), `workspace-bin/daily-log-writer.mjs` (os import + NODE_ID + daemon-state path), `mission-control/src/app/api/tasks/route.ts` (os import + NODE_ID + readDaemonState rename + path), `scripts/migrate-companion-state.mjs` (new).
- Deltas #1 and #2 were pre-applied by prior tick + operator; deltas #3, #4, #5 applied this tick.

### v0.2-pre — 2026-05-20 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.2.
- Files planned: `workspace-bin/memory-daemon.mjs`, `.claude/hooks/session-start.sh`, `workspace-bin/daily-log-writer.mjs`, `mission-control/src/app/api/tasks/route.ts`, `scripts/migrate-companion-state.mjs` (new).
- Audit: `memory-plan/audits/step02_companion_state_collision/AUDIT_PRE.md`.
- Test baseline: 467 tests (394 pass, 73 fail — pre-existing).

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
