# AUDIT_PRE — Step 6.5: Install health-watch; verify clean respawn + KeepAlive (no crash-loop)

**Version target:** v6.5 · **Block:** 6 (L6 health + storage hygiene) · **Date:** 2026-06-01

## §0 Re-orient

- Where am I: Block 6 (L6 health), step 5/5, 36/36 overall (last local-first step).
- Last step changed: v6.4 — WAL checkpoint(TRUNCATE) on graceful shutdown; fixed pre-existing scoping bug in shutdown handler.
- This step contributes: makes the daemon self-monitoring via an external health-watch service and proves the KeepAlive/respawn path is clean (no crash-loop regression from the 13,834× scar).
- Block serves the north star via: DESIGN_INPUTS §5 "Health-checked, no crash-loops" + MASTER_PLAN §5 runtime-observable done-contract.
- Still the right next step? Yes — all code/storage hygiene is done (6.1–6.4); the last step is proving the system self-monitors and recovers cleanly. Closes Block 6.

## 1. Intent

Install the existing `bin/health-watch.mjs` as a launchd-managed service (`ai.openclaw.health-watch`). Then verify the daemon's KeepAlive path: kill → respawn within ThrottleInterval → no crash-loop → health-watch reports healthy.

## 2. Design

- **Plist:** `services/launchd/ai.openclaw.health-watch.plist` — KeepAlive, RunAtLoad, ThrottleInterval=30 (wider than daemon's 10s to avoid the health-watch itself becoming a crash-loop nuisance). Env: HOME, PATH, TZ, OPENCLAW_WORKSPACE, OPENCLAW_NATS, OPENCLAW_NODE_ID, HEALTH_WATCH_INTERVAL_SEC=60.
- **Deploy:** symlink `~/.openclaw/workspace/bin/health-watch.mjs` → repo `bin/health-watch.mjs`; resolve plist variables and install to `~/Library/LaunchAgents/`.
- **Verify:** (a) `launchctl list ai.openclaw.health-watch` shows PID; (b) kill daemon via `launchctl kickstart -k` → new PID within 15s; (c) wait 60s → health-watch log shows `healthy`; (d) daemon PID stable (no second restart = no crash-loop).
- **Carry-forward from 6.4:** shutdown handler now cleans all WALs — no regressions expected from a clean kill/restart cycle.

## 3. Risk register

| Risk | Mitigation |
|------|-----------|
| health-watch imports `lib/health-check.mjs` which imports `lib/sqlite-store.mjs` — needs `better-sqlite3` in PATH | PATH in plist includes workspace .npm-global/bin + homebrew; `better-sqlite3` is a native addon resolved via the workspace `node_modules/` |
| health-watch polls daemon via launchctl — could fail silently in some macOS states | `timedCheck` wrapper with 5s timeout; failure = `ok:false`, visible in log |
| ThrottleInterval mismatch could cause launchd to throttle healthy starts | Using 30s (conservative); daemon uses 10s — no conflict |

## 4. File-delta outline

| File | Change |
|------|--------|
| `services/launchd/ai.openclaw.health-watch.plist` | CREATE — launchd plist for health-watch |
