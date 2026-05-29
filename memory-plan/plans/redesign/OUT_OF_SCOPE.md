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

## 2026-05-29 — Canonical-sync pre-commit hook lives only in local `.git/hooks/`

- **Observed while:** automating the canonical→plan-silo propagation per operator request.
- **Area:** `.git/hooks/pre-commit` (calls `workspace-bin/sync-canonical.sh` + re-stages plan copies) vs the installer-managed delegation pattern (`.claude/hooks/validate-commit.sh`).
- **Problem:** the auto-sync block was added to `.git/hooks/pre-commit`, which is **not version-controlled** and not installed by the openclaw-node installer. The sync *logic* is durable (lives in `sync-canonical.sh`), but the *trigger* is local-only — a fresh clone or an installer re-run drops it, and the silos can drift again silently.
- **Why it matters:** exactly the invisible-state problem this effort fights. The drift-proofing is only as durable as a single untracked file.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** whoever owns the installer. Durable fix: move the canonical-sync call into the version-controlled `.claude/hooks/validate-commit.sh` (consistent with the existing delegate pattern) or have the installer write the hook block.

---
