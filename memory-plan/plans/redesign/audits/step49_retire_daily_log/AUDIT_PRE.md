# AUDIT_PRE — Step 4.9: Retire the lossy hourly daily-log writer

## §0 Re-orient

- Where am I: Block 4 (L4 synthesis/wiki), step 9/9, 28/36 overall.
- Last step changed: 4.8 — deterministic daily/weekly digest from vault notes (the replacement).
- This step contributes: retires the old lossy writer, completing the synthesis layer.
- Block serves the north star via: DESIGN_INPUTS §4 — "did we produce a readable, accurate synthesis?"
- Still the right next step? Yes — the replacement (vault digest) is live; the old writer is now dead weight producing noise.

## 1. Intent

Remove the hourly daily-log writer (`daily-log-writer.mjs`) from the daemon's execution path and clean up the archival/daily-file-creation in `memory-maintenance.mjs` that supported it. The old writer (OUT_OF_SCOPE 2026-05-27) produces truncated, repeated hourly snapshots — the exact failure the redesign replaces with structured vault synthesis.

## 2. Design

Three changes:
1. **`workspace-bin/memory-daemon.mjs`** — delete the daily-log-writer invocation block (lines ~860–872) and the `throttle.lastDailyLogHour` tracking.
2. **`workspace-bin/memory-maintenance.mjs`** — delete `checkArchival()` (daily-log archival, check 1) and `checkDailyFile()` (ensures today's daily file exists, check 8) + their calls from `runMaintenance()`. The remaining 11 checks (predictions, stale tasks, MEMORY.md freshness, companion, clawvault, MC, timestamps, errors, consolidation, graph, shared-lessons) are independent and stay.
3. **`workspace-bin/daily-log-writer.mjs`** — delete the file entirely (MASTER_PLAN: "if something is unused, delete it completely").

No new code. Pure removal.

## 3. Risk register

- **LOW:** Existing daily logs in `~/.openclaw/workspace/memory/` remain on disk (not deleted). They become static history. The mission-control parser (`daily-log.ts`) can still read old files; it just won't see new ones.
- **LOW:** Removing `checkDailyFile()` means maintenance no longer pre-creates `memory/YYYY-MM-DD.md`. This is intentional — the vault digest in `~/.openclaw/obsidian-local/daily/` replaces it.
- **LOW:** Removing `checkArchival()` means old daily logs >30 days won't be auto-archived. Acceptable — no new daily logs are being written, so the archive cycle has nothing to do.

## 4. File-delta outline

| File | Delta |
|---|---|
| `workspace-bin/memory-daemon.mjs` | Delete lines ~860–872 (daily-log-writer invocation) |
| `workspace-bin/memory-maintenance.mjs` | Delete `checkArchival()` (lines ~90–146), `checkDailyFile()` (lines ~354–368), their calls in `runMaintenance()` |
| `workspace-bin/daily-log-writer.mjs` | Delete file |
