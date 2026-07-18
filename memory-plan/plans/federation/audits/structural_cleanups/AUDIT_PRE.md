# AUDIT_PRE — structural cleanups (reviewer optimizations, operator "go for all, deploy agents")

**Written:** 2026-07-18, before the work. Four independent cleanups, none behavioral bugs — shape
debt from the deployment review.

## Plan + execution model

Orchestrated with parallel subagents on DISJOINT file surfaces; the orchestrator does all git
operations (agents are forbidden git) and verifies each result before staging.

1. **`.mcp.json` hardcoded operator paths** (inline, done first — 5 min): absolute
   `/Users/moltymac/...` paths replaced with `${HOME}` expansion (Claude Code's documented env
   expansion for mcpServers) — portable with zero install-time generation.
2. **Fonts** (agent A, mission-control/ only): `next/font/google` → the `geist` npm package so
   `next build` never fetches Google. Verify: tsc 0, eslint 0 errors, build exit 0 with NO
   fonts.googleapis/gstatic fetch in the log, vitest 82/82.
3. **Daemon consolidation** (agent B, bin/ + workspace-bin/ + tests + services):
   `bin/openclaw-memory-daemon.mjs` (dormant federation variant, no unit, never run) folds into the
   ONE live daemon as `initFederationSubsystems()` gated by `OPENCLAW_FEDERATION=1` (default OFF —
   dormant by design), then the file is deleted. Wiring-manifest rows repointed. Verify: manifest
   + adjacent suites green; live daemon redeployed + restarted with a clean boot and NO federation
   lines (gate off); a 20s manual run WITH the env shows the federation init firing; memory axis
   honest.
4. **Installer split** (agent C, wave 2 — after A/B land so install.sh is stable): `install.sh`
   (~2,000 lines) split into sourced modules under `scripts/install/` (render / system-deps /
   services / verify), with `install.sh` becoming the thin orchestrator that sources them. Contract:
   behavior-identical (`--dry-run` output comparable before/after), `bash -n` on every module,
   full `--dry-run` runs clean.

## Rules of engagement
- Agents: no git, no service restarts except where the brief says (daemon redeploy is agent B's
  verify step), stop-and-report on scope-hook blocks.
- Orchestrator: stages/commits per cleanup with evidence, pushes, watches CI (the new lint gate is
  live — MC changes must hold 0 errors).
