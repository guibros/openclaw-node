# AUDIT_POST — Step 0.2: Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers)

**Version:** v0.2-mid
**Date:** 2026-05-20
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | daemon: NODE_ID constant + daemon-state path in runPhase1StatusSync | `workspace-bin/memory-daemon.mjs:521,526` | yes | `grep -n 'daemon-state' workspace-bin/memory-daemon.mjs` → lines 521, 526 |
| 2 | session-start.sh: STATE variable to daemon-state path | `.claude/hooks/session-start.sh:33` | yes | `grep -n 'daemon-state' .claude/hooks/session-start.sh` → line 33 |
| 3 | daily-log-writer: os import + NODE_ID + COMPANION path | `workspace-bin/daily-log-writer.mjs:26,30,34` | yes | `grep -n 'NODE_ID' workspace-bin/daily-log-writer.mjs` → line 30; `grep -n 'daemon-state' workspace-bin/daily-log-writer.mjs` → line 34 |
| 4 | route.ts: os import + NODE_ID + readDaemonState rename + path | `mission-control/src/app/api/tasks/route.ts:15,16,22,23,65` | yes | `grep -n 'readDaemonState' mission-control/src/app/api/tasks/route.ts` → lines 22, 65; `grep -n 'NODE_ID' mission-control/src/app/api/tasks/route.ts` → line 16 |
| 5 | migration script (new file) | `scripts/migrate-companion-state.mjs:1-70` | yes | `grep -n 'isDaemonFile' scripts/migrate-companion-state.mjs` → line 35; `grep -n 'renameSync' scripts/migrate-companion-state.mjs` → line 69 |

All 5 rows landed = yes. 5 rows = 5 non-audit non-ledger files in staged diff.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'daemon-state' workspace-bin/memory-daemon.mjs` | `521:// Updates .daemon-state-${NODE_ID}.md from active-tasks.md (~5ms)` |
| 2 | `grep -n 'daemon-state' .claude/hooks/session-start.sh` | `33:STATE="${WORKSPACE}/.daemon-state-${_NODE_ID}.md"` |
| 3 | `grep -n 'daemon-state' workspace-bin/daily-log-writer.mjs` | `34:const COMPANION = path.join(WORKSPACE, \`.daemon-state-${NODE_ID}.md\`);` |
| 4 | `grep -n 'readDaemonState' mission-control/src/app/api/tasks/route.ts` | `22:function readDaemonState(): { title: string; nextAction: string } \| null {` |
| 5 | `grep -n 'isDaemonFile' scripts/migrate-companion-state.mjs` | `35:function isDaemonFile(content) {` |

## §3 — Cross-references still valid

- `readCompanionState` — zero references remaining in codebase. Searched `readCompanionState` across `*.{ts,tsx,mjs,js}` — no hits. Clean rename.
- `.companion-state.md` — remaining references are all documented deferrals per AUDIT_PRE §5:
  - `.claude/hooks/pre-compact.sh:35,37` — reads companion-bridge's file (valid, deferred to Step 0.6).
  - `install.sh:717,718,730` — creates companion-bridge's file (valid, not daemon's).
  - `workspace-bin/memory-maintenance.mjs:35,232` — companion freshness check on companion-bridge's file (valid, deferred).
  - `workspace-bin/obsidian-sync.mjs:361` — scans root-level files (peripheral, companion-bridge's file still exists).
  - `scripts/migrate-companion-state.mjs:5,30` — the migration script itself legitimately references the old path.
- `NODE_ID` derivation pattern (`process.env.OPENCLAW_NODE_ID || os.hostname()`) is consistent across all three JS/TS files. Shell equivalent (`${OPENCLAW_NODE_ID:-$(hostname)}`) is consistent in session-start.sh.
- No symbols renamed or deleted beyond `readCompanionState` → `readDaemonState`.

## §4 — Findings

- [POSITIVE] NODE_ID derivation is identical across all four files: `process.env.OPENCLAW_NODE_ID || os.hostname()` (JS/TS), `${OPENCLAW_NODE_ID:-$(hostname)}` (shell). Consistent pattern.
- [POSITIVE] Migration script is idempotent — checks target existence, source existence, and daemon markers before acting. Safe to run multiple times.
- [POSITIVE] Migration script uses `isDaemonFile()` heuristic (`## Session Status` / `last_flush`) to distinguish daemon-written files from companion-bridge files. Prevents accidental rename of companion-bridge's file.
- [POSITIVE] The `COMPANION` variable name in daily-log-writer.mjs was retained (only the path changed). This minimizes diff churn while achieving the rename.
- [POSITIVE] JSDoc and inline comments updated in route.ts to reflect new function name and file path.
- [POSITIVE] Deltas #1 and #2 were pre-applied (prior tick + operator intervention) and verified via grep before proceeding — no re-edit attempted on sandbox-restricted `.claude/hooks/session-start.sh`.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 0.3

- The `COMPANION` variable name in `daily-log-writer.mjs` still says "COMPANION" but now points to `.daemon-state-${NODE_ID}.md`. A cosmetic rename to `DAEMON_STATE` could be done but is not required — deferred.
- `.claude/hooks/session-start.sh` is sandbox-restricted for autonomous ticks. Step 0.6 (which touches `pre-compact.sh`) will need the same operator pre-apply workaround documented in AUDIT_PRE mid-implementation findings.
- Test baseline remains 467 tests (394 pass, 73 fail — pre-existing). No new tests added this step.
- `workspace-bin/memory-daemon.mjs` now has a `NODE_ID` constant (line area ~55) used by `runPhase1StatusSync`. Step 0.3 (mergeFacts) does not interact with state file paths, so no collision expected.
