# AUDIT_PRE — Step 0.2: Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers)

**Version:** v0.2-pre
**Date:** 2026-05-20
**Author:** memory-plan-tick

---

## §1 — Intent

Rename the daemon's state file from `.companion-state.md` to `.daemon-state-${NODE_ID}.md` to resolve the collision with companion-bridge, which writes the same filename with a different schema. Update all daemon-state readers to consume the new path. Add a one-time migration script for the rename.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.2 | v0.2 | [A] | Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers) |

## §3 — Design decisions (consumed from Step 0.1 AUDIT_POST §6)

- The daemon now has an optional NATS connection (`natsConn`) scoped to `main()`. Step 0.2's rename does not interact with this connection — no collision expected.
- The `shutdown` handler in `main()` is now `async` due to `natsConn.drain()`. This step does not modify shutdown behavior.
- Test baseline is now 467 tests, 394 pass, 73 fail (pre-existing).

**Additional frozen decisions from RESUME.md §0:**
- `NODE_ID` source: `process.env.OPENCLAW_NODE_ID` with fallback to `os.hostname()`. In shell scripts: `${OPENCLAW_NODE_ID:-$(hostname)}`.
- Workspace-file changes for Block 0 are limited to renaming the daemon's `.companion-state.md` → `.daemon-state-${NODE_ID}.md`. The migration script is the only thing that touches workspace state at runtime.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Readers deployed before daemon → they look for a file that doesn't exist yet | LOW | Migration script runs first. All readers already have `existsSync` guards — graceful no-op on missing file. |
| 2 | `os.hostname()` returns different values across reboots or in containers | LOW | Documented fallback. `OPENCLAW_NODE_ID` env var is the stable source; hostname is best-effort. |
| 3 | mission-control TypeScript needs `os` import | LOW | Standard Node.js built-in; no new dependency added to package.json. |
| 4 | `.companion-state.md` still read by `memory-maintenance.mjs` and `pre-compact.sh` | LOW | Both are NOT in this step's scope per REFERENCE_PLAN. Companion-bridge continues to write `.companion-state.md`, so those readers still have a valid file. Carry-forward noted. |

## §5 — Deferrals

- `memory-maintenance.mjs` companion freshness check (line 227) still reads `.companion-state.md`. Now tracks companion-bridge's file, which is valid. If daemon-state freshness is needed, that's a future step.
- `pre-compact.sh` (line 35) still reads `.companion-state.md`. Same rationale — dumps companion-bridge's state.
- Docs (`ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `MEMORY_SPEC.md`, etc.) still reference `.companion-state.md`. Updated in Step 0.7 (document state files).
- `install.sh` still creates `.companion-state.md`. Correct — it creates companion-bridge's file. Daemon creates its own on first run.

## §6 — Phase 4 implementation outline

| # | File | Delta |
|---|------|-------|
| 1 | `workspace-bin/memory-daemon.mjs` | Add `NODE_ID` constant (~line 55 area, after `os` import). Change `companion` path in `runPhase1StatusSync` (line 525) from `.companion-state.md` to `.daemon-state-${NODE_ID}.md`. Update comment at line 520. |
| 2 | `.claude/hooks/session-start.sh` | Change `STATE` variable (line 32) from `.companion-state.md` to `.daemon-state-${OPENCLAW_NODE_ID:-$(hostname)}.md`. Update comment. |
| 3 | `workspace-bin/daily-log-writer.mjs` | Add `os` import + `NODE_ID` derivation. Change `COMPANION` constant (line 32) from `.companion-state.md` to `.daemon-state-${NODE_ID}.md`. |
| 4 | `mission-control/src/app/api/tasks/route.ts` | Add `os` import + `NODE_ID` derivation. Change `statePath` in `readCompanionState` (line 20) from `.companion-state.md` to `.daemon-state-${NODE_ID}.md`. Rename function `readCompanionState` → `readDaemonState`. Update JSDoc and call site. |
| 5 | `scripts/migrate-companion-state.mjs` | **New file.** Detects old `.companion-state.md` written by daemon (presence of `## Session Status` / `last_flush` markers), renames to `.daemon-state-${NODE_ID}.md` if daemon-state file doesn't already exist. Idempotent — safe to run multiple times. |

---

## Mid-Implementation Findings

**2026-05-20 — Sandbox restriction on `.claude/hooks/session-start.sh`**

The headless tick worker hit a hard sandbox restriction on `.claude/hooks/session-start.sh`
(Edit, Write, sed, and python all rejected). The worker wrote BLOCKED.md per framework
protocol. Operator (interactive Claude session) applied the §6 delta #2 edit manually
and verified via:

  grep -n 'daemon-state' /Users/moltymac/openclaw-nodedev/.claude/hooks/session-start.sh

Resume protocol: when this step is re-attempted at v0.2-pre, the worker should grep-verify
that delta #2 is already present in the working tree and SKIP re-edit. Do not re-attempt
the Edit/Write — it will fail and re-block. The remaining §6 deltas (#3 daily-log-writer,
#4 route.ts, #5 migration script) are in non-protected paths and should proceed normally.

**Follow-up for future steps:** Step 0.6 will need similar treatment for
`.claude/hooks/pre-compact.sh`. Operator will pre-apply the edit (or grant the autonomous
tick explicit permission via `.claude/settings.json` allow-list) before that tick runs.
