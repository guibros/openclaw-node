# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

### v0.6 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.6: Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field).
- Files committed: `.claude/hooks/pre-compact.sh`, `workspace-bin/session-recap`, `workspace-bin/auto-checkpoint`, `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 482 (409 pass, 73 fail — pre-existing). +1 test added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 6-of-6 zero-Phase-4-correction.

### v0.6-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.6.
- Files changed: `.claude/hooks/pre-compact.sh` (removed `STATE_FILE` variable and dead `.pre-compact-state.md` write block), `workspace-bin/session-recap` (deleted `FINGERPRINT_FILE` constant, `extractFingerprint` function, `writeFingerprint` function, and fingerprint caller in `main()`), `workspace-bin/auto-checkpoint` (deleted `ACTIVITY_FILE` variable and `touch "$ACTIVITY_FILE"`), `lib/pre-compression-flush.mjs` (removed `confidence` property from all pattern objects, destructuring, fact push, and JSDoc), `test/memory-budget.test.mjs` (+1 test: extractFacts confidence removal).
- Test additions: 1 new test (extractFacts returns no confidence property).

### v0.6-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.6.
- Files planned: `.claude/hooks/pre-compact.sh`, `workspace-bin/session-recap`, `workspace-bin/auto-checkpoint`, `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step06_delete_dead_artifacts/AUDIT_PRE.md`.
- Test baseline: 481 tests (408 pass, 73 fail — pre-existing).

### v0.5 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.5: Fix mid-word truncation via truncateAtWord helper.
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 481 (408 pass, 73 fail — pre-existing). +4 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 5-of-5 zero-Phase-4-correction.

### v0.5-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.5.
- Files changed: `lib/pre-compression-flush.mjs` (added `truncateAtWord` helper, replaced `.slice(0, 120)` with `truncateAtWord(match[0].trim(), 120)` in `extractFacts`), `test/memory-budget.test.mjs` (+4 tests in new `truncateAtWord` describe block, added `truncateAtWord` to import).
- Test additions: 4 new tests (short text passthrough, word-boundary truncation, long-word fallback, exact-length passthrough).

### v0.5-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.5.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step05_truncate_at_word/AUDIT_PRE.md`.
- Test baseline: 477 tests (404 pass, 73 fail — pre-existing).

### v0.4 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.4: Include assistant-role messages in extraction + add speaker field + new patterns.
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 477 (404 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 4-of-4 zero-Phase-4-correction.

### v0.4-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.4.
- Files changed: `lib/pre-compression-flush.mjs` (added `stripSpeaker` helper, two assistant-voice pattern groups, opened role filter to include assistant, added `speaker` field on facts, updated `mergeFacts` to format with speaker tags and strip during comparison), `test/memory-budget.test.mjs` (+5 tests in new `extractFacts assistant extraction` describe block).
- Test additions: 5 new tests (assistant inclusion, speaker field, assistant patterns, tool exclusion, mergeFacts speaker tags).

### v0.4-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.4.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step04_assistant_extraction/AUDIT_PRE.md`.
- Test baseline: 472 tests (399 pass, 73 fail — pre-existing).

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
