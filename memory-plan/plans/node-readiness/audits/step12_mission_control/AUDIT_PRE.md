# Step 1.2 — restore Mission Control

## 0. Micro re-orient
Gateway startup passed the stronger adversarial gate.
Mission Control still exits 127 because dependencies are absent.
Its copied source predates merged authentication and safe-path changes.
This step restores the existing dashboard from the tested main revision.
It supports MASTER_PLAN 3.1 and the operator's monitoring/control goal.

## 1. Intent
Existing launchd Mission Control service serves current source with authentication intact.

## 2. Design / Needs
Current main cbae56be97aa0f6d4faf9fedd444dad119885d9a has passed 125 MC tests and a production build with isolated HOME/workspace/DB/bus. Live target is a physical directory, no node_modules, existing .next. 169 tracked source files match main, 19 differ and 5 are missing. DB contains 537 tasks; zero dispatchable or due timed tasks. Preserve operator env and all data.

## 3. Risk and rollback
Back up SQLite using the online backup API, validate restored backup with integrity_check and task counts; retain source/build/env privately. Unload only MC and its scheduler heartbeat during replacement. Back up existing source before copying tracked MC files from the immutable source; preserve nontracked files and data. Install exact locked dependencies and deploy the tested build. If validation fails, keep failed service stopped and restore prior files from backup; prior exit-127 state is explicitly unhealthy. Do not alter NATS, memory stores, task statuses, authentication policy or tokens.

## 4. Verify
Source tracked files hash-match the pinned revision. Production build and 125 MC tests pass. Restored backup integrity_check is ok and has 537 tasks. Existing service starts on loopback 3000, UI with existing cookie auth and authenticated /api/system/health return 200, anonymous API GET and POST return 401. DB task count unchanged. Verify after one deliberate restart and repeat after >=60s. Restart scheduler heartbeat only after zero dispatch candidates is reconfirmed; observe its existing authenticated helper.

## 5. Adversarial review
Claude required current API authentication before revival; source deploy follows that requirement. Send sanitized source identity, backup counts, test/build results and HTTP matrix for review before merge.

## 6. File deltas
- This silo's inventory/version/registry/audit evidence for step 1.2.
- Runtime MC tracked source files, package-locked dependencies and .next build from current main; existing env/data preserved.
- Temporary launchd unload/bootstrap of the existing MC and scheduler heartbeat services, with original definitions retained.
- workspace-bin/mc-health.mjs and a focused CLI regression test: recovery must restart the existing managed service, never kill a port occupant or spawn next dev. Deploy this helper before restoring MC.
No installer code or parallel service is introduced. Installer skip-existing-build/dependency defects remain 2.2.

## Preflight refinement before source deployment
Claude identified mc-health's unmanaged development-server recovery, which can replace the restored service. The existing startup outcome requires repairing that recovery path, with a fake-service CLI test before deployment. Accepted design: launchctl kickstart on macOS, systemctl --user restart on Linux; command failure is reported, never bypassed with an unmanaged server.

Read-only preflight confirmed all 537 board IDs match DB; status, approval, trigger and execution fields have zero differences; recurring-done count is zero. The general deletion-by-absence bug is tracked for dashboard reconciliation, not folded into this restore.

Separate containment: plan viewer stopped 2026-09-27 after independent control-endpoint review; restoration requires its own authentication repair. Detailed reproduction is kept private.


## Rehearsal findings before live start
The service PATH resolves Node 22.22.0 / ABI 127, whereas the interactive shell uses Node 24.13.0 / ABI 137. Reinstall MC native dependencies and rebuild under the service environment before acceptance. A private-database startup rehearsal exposed a separate startup defect: SQLite returns `{quick_check: "ok"}`, but getDb reads `integrity_check`, falsely triggering REINDEX on every healthy database. Correct the result key, add a real SQLite startup regression, and repeat the private rehearsal before the live start.

The recovery helper will also decline auth/config errors or a missing token, require three consecutive 5xx responses, and limit explicit restart attempts to one per 15 minutes. Transient 5xx recovery, 401/403, missing token, cooldown and service-command failure are regression cases. Viewer definition is preserved outside LaunchAgents and persistently disabled; MC disabled during replacement.

## Final service ownership decision
D6 removes automatic MC restarts from memory maintenance. Process crash recovery remains with launchd/systemd; explicit mc-health --restart is an operator action. This eliminates the automatic restart loop during startup or a DB failure. DB startup uses SQLite's simple quick_check result and fails closed on a failed check; no automatic REINDEX in either startup or corrupt-index cleanup. Failed initialization closes its handle and cannot become a cached usable database. Test healthy startup and simulated real check failures against a real SQLite fixture. Runtime maintenance receives only the corresponding health-function patch, preserving its local completion-truth/authenticated-mutation changes.

## Attribution refinement
The preserved maintenance mutation helper originates in local commit 88be4f2. Bring that exact behavior and its behavioral tests into this PR, together with current-main GET authentication, so the runtime file has a committed source rather than remaining a third untracked variant. All local-only non-maintenance changes remain untouched. Cache only confirmed integrity/corruption failures until restart, avoiding repeated scans of a damaged file; temporary failures retry after their cause clears. The fail-closed guarantee covers Mission Control's own handle; tracer writers remain a separate #104-family concern for persisted-state work.

## Second independent review
Claude found the missing graph-stat GET token and overbroad error caching at e73b284. D7 resolves both. The real SQLite lock test waits through SQLITE_BUSY, releases the writer, then initializes successfully without process restart. The maintenance HTTP fixture exercises all seven authenticated requests and a rejected cycle; no production resources are used. All 129 MC tests and 19 focused helper tests pass. Final-source deployment and a new observation window remain required. The earlier e73b284 window passed 602.97 seconds with unchanged PID/run count, healthy responses, 537 tasks and 4 MB WAL; this is evidence for that revision only.
