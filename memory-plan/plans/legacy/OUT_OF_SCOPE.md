# Out of Scope — Captured Observations

Things observed while doing other work that deserve attention later. **Agnostic specifications only** (MASTER_PLAN §4.3): WHAT was observed + WHY it matters, never HOW to fix. Reviewed at scope-closing checkpoints — each item gets promoted to SCOPE.md, escalated to INVENTORY.md, archived as won't-fix, or deferred.

This file is always-writeable (the PreToolUse hook exempts it).

---

## 2026-05-27 — Workspace daily logs + monthly summaries are lossy auto-digests

- **Observed while:** reading the "old memory-plan" corpus (`~/.openclaw/workspace/memory/`).
- **Area:** the daemon's session-recap / daily-log writer + the monthly-summary archiver (whatever produces `memory/YYYY-MM-DD.md` and `archive/YYYY-MM-summary.md`).
- **Problem:** the human-readable memory output captures that conversations happened but loses their content. Three compounding defects: (1) every message truncated to ~150 chars; (2) the same conversation snapshot is re-emitted every hour (00:00, 01:00, 02:00 … identical) so a day's log is one buffer repeated ~18×; (3) monthly summaries concatenate the daily logs and inherit all the repetition; (4) the `## Files Modified` block is identical stale boilerplate on every entry (same 5-file list regardless of what changed).
- **Why it matters:** this is the memory system's primary *readable* surface. Volume without signal. It directly undercuts the whole point of the memory infrastructure (recall + synthesis). Likely a top-tier target for the redesign, not a quick patch.
- **Severity guess:** HIGH (it's the user-facing output of the thing being redesigned).
- **Who-touches-next:** memory redesign (see `DESIGN_INPUTS.md`). Tie to the "Karpathy LLM Wiki synthesize layer" intent.

## 2026-05-27 — Component-registry multi-DB rows render no status badge in the viewer

- **Observed while:** building the Master Plan tab in `workplan-viewer.mjs`.
- **Area:** `parseRegistry` in the viewer + the `### 6.1 Databases on disk` entry in `COMPONENT_REGISTRY.md`, which is a table of 7 DBs rather than a single `| **Status** |` row.
- **Problem:** the parser finds no single status for that component, so the badge renders "?". Accurate (there's no one status for "all databases") but visually ambiguous.
- **Why it matters:** minor UX wart; could mislead a glance at the dashboard.
- **Severity guess:** LOW (cosmetic).
- **Who-touches-next:** whoever next touches the viewer or the registry format. Could give 6.1 a roll-up status or split it per-DB.

## 2026-05-28 — Viewer's redesign-plan detection isn't durable across relaunch

- **Observed while:** wiring memory-plan/redesign into the workplan-viewer.
- **Area:** how the viewer is launched + its ROOTS resolution (`workplan-viewer.mjs` reads `WORKPLAN_ROOTS`, defaults to cwd only).
- **Problem:** the redesign plan is only detected because the viewer was manually relaunched with `WORKPLAN_ROOTS=repo:repo/memory-plan`. The viewer has no launchd plist; a future manual restart without that env var drops the redesign plan (the legacy plan survives because it's an immediate subdir of the repo root). The setting lives only in the running process.
- **Why it matters:** the redesign plan silently disappears from the dashboard on restart — exactly the kind of invisible-state problem this whole effort is fighting.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** whoever next touches the viewer. Options: add `memory-plan` to the viewer's default ROOTS, or give the viewer a launch script / plist that sets the env. (Viewer code is out of the current scope's files.)
- **Update 2026-05-28 (plans/ restructure):** the default ROOTS now resolves to `<cwd>/memory-plan/plans`, so a bare relaunch discovers both siloed plans without any env var. The *no-launchd-plist* half remains (still a bare `node` process) — a relaunch still requires a human.
- **RESOLVED 2026-05-29 (infra remaster):** the viewer now runs under launchd as `ai.openclaw.workplan-viewer` (plist `~/Library/LaunchAgents/ai.openclaw.workplan-viewer.plist`, `RunAtLoad`+`KeepAlive`, WorkingDirectory = repo root). It survives reboot/crash unattended; ROOTS resolves from the working dir with no env var. Both halves closed.

## 2026-05-28 — Legacy plan's tick automation references pre-restructure paths

- **Observed while:** the `plans/` restructure (moving the legacy 58-step plan into `memory-plan/plans/legacy/`).
- **Area:** `plans/legacy/automation.json` (`stdout_path`/`stderr_path` → `memory-plan/tick-logs/…`), plus `workspace-bin/memory-plan-tick.sh` and `memory-plan-timeline.sh`, which hardcode the old top-level `memory-plan/{tick-logs,audits}` paths.
- **Problem:** after the move those paths no longer exist (the legacy plan's `tick-logs/` + `audits/` are now under `plans/legacy/`). The legacy tick scripts would write/read the wrong location if ever run.
- **Why it matters:** LOW — the legacy plan is complete (58/58) and its launchd automation is unloaded and will not run again. Left unfixed deliberately: a partial fix (log paths only) without rewiring the scripts would be misleading, and a full rewire of dead automation is pure scope creep. The active (redesign) plan's automation paths WERE corrected in this restructure.
- **Severity guess:** LOW (dead automation on an archived plan).
- **Who-touches-next:** anyone resurrecting the legacy plan's automation, or a future cleanup pass that deletes it outright.

---
