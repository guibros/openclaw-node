# Block 0 Complete — Stop the bleeding

**Closed at:** v0.7 (2026-05-21)
**Steps:** 7 of 7 closed (0.1 through 0.7)
**Author:** memory-plan-tick

---

## Exit-gate criteria

- All 7 steps closed with zero Phase 4 corrections (7-of-7 streak).
- All 7 steps closed with zero Phase 8 patches (7-of-7 streak).
- Test baseline: 482 tests (409 pass, 73 fail — pre-existing). +16 tests added across Block 0.
- `npm test` passes at baseline on every step.
- Deep Review Gate passed on every step (5/5 checks × 7 steps = 35 checks, 0 failures).

## Files touched cumulatively (Block 0)

| File | Steps | Nature |
|------|-------|--------|
| `workspace-bin/memory-daemon.mjs` | 0.1, 0.2 | Wired reload(), renamed daemon-state, NATS sub |
| `lib/pre-compression-flush.mjs` | 0.3, 0.4, 0.5, 0.6 | mergeFacts supersedes model, assistant extraction, truncateAtWord, confidence removal |
| `lib/memory-budget.mjs` | — | Not directly edited (consumed by daemon) |
| `.claude/hooks/pre-compact.sh` | 0.6 | Dead write removed, retained as no-op stub |
| `.claude/hooks/session-start.sh` | 0.2 | Daemon-state path updated |
| `workspace-bin/session-recap` | 0.6 | Fingerprint dead code removed (~80 lines) |
| `workspace-bin/auto-checkpoint` | 0.6 | frontend-activity touch removed |
| `workspace-bin/daily-log-writer.mjs` | 0.2 | os import + NODE_ID + daemon-state path |
| `mission-control/src/app/api/tasks/route.ts` | 0.2 | os import + NODE_ID + readDaemonState |
| `scripts/migrate-companion-state.mjs` | 0.2 | New migration script |
| `test/memory-budget.test.mjs` | 0.1, 0.3, 0.4, 0.5, 0.6 | +16 tests total |
| `docs/STATE_FILES.md` | 0.7 | New reference documentation |

## Carry-forwards into Block 1

- **Test baseline:** 482 tests (409 pass, 73 fail — pre-existing).
- **`docs/ARCHITECTURE.md`** has stale references to `frontend-activity` (lines 81, 83) and `session-fingerprint.json` (lines 287, 487). Should be updated when convenient.
- **COMPANION variable name** in `daily-log-writer.mjs:34` is cosmetic (reads `.daemon-state-${NODE_ID}.md` but variable is named `COMPANION`). Not functionally broken.
- **Test fixture `confidence`** in `test/memory-budget.test.mjs` (lines 284, 315, 388, 389) — harmless extra property on test objects. Cosmetic cleanup.
- **`pre-compact.sh`** is a no-op stub awaiting Block 4 rewiring.
- **`docs/STATE_FILES.md`** should be updated as Block 1 adds new state files.
- **Phase 2 scope review** is required before Block 2 starts (per RESUME.md §0).
- **Zod** enters as a dependency via Block 1's `packages/event-schemas` workspace package.
