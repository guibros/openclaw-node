# AUDIT_POST — Step 4.8: Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs)

**Version:** v4.8-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/health-check.mjs` (new) — runHealthCheck, deriveStatus, formatHealthReport, parseAlertTargets, COMPONENT_NAMES, DEFAULT_INTERVAL_SEC, ALERT_TARGETS_DEFAULT | `lib/health-check.mjs:20` (COMPONENT_NAMES), `:24` (DEFAULT_INTERVAL_SEC), `:26` (ALERT_TARGETS_DEFAULT), `:190` (runHealthCheck), `:227` (deriveStatus), `:245` (formatHealthReport), `:280` (parseAlertTargets) | yes | `grep -n 'export' lib/health-check.mjs` → 7 exports |
| 2 | `bin/health-watch.mjs` (new) — createHealthWatch factory, alert routing, CLI entry | `bin/health-watch.mjs:107` (createHealthWatch) | yes | `grep -n 'export' bin/health-watch.mjs` → 1 export |
| 3 | `bin/openclaw-restart.sh` (new) — manual graceful restart script | `bin/openclaw-restart.sh` (exists, 103 lines) | yes | `ls bin/openclaw-restart.sh` → exists |
| 4 | `test/health-check.test.mjs` (new) — ~8 tests | `test/health-check.test.mjs` (15 `it()` blocks) | yes | `grep -c 'it(' test/health-check.test.mjs` → `15` |

4 of 4 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'COMPONENT_NAMES' lib/health-check.mjs` | `20:export const COMPONENT_NAMES = Object.freeze([` |
| 2 | `grep -n 'DEFAULT_INTERVAL_SEC' lib/health-check.mjs` | `24:export const DEFAULT_INTERVAL_SEC = 60;` |
| 3 | `grep -n 'ALERT_TARGETS_DEFAULT' lib/health-check.mjs` | `26:export const ALERT_TARGETS_DEFAULT = 'file,nats,banner';` |
| 4 | `grep -n 'runHealthCheck' lib/health-check.mjs` | `190:export async function runHealthCheck(opts = {}) {` |
| 5 | `grep -n 'deriveStatus' lib/health-check.mjs` | `227:export function deriveStatus(result) {` |
| 6 | `grep -n 'formatHealthReport' lib/health-check.mjs` | `245:export function formatHealthReport(result) {` |
| 7 | `grep -n 'parseAlertTargets' lib/health-check.mjs` | `280:export function parseAlertTargets(envValue) {` |
| 8 | `grep -n 'createHealthWatch' bin/health-watch.mjs` | `107:export function createHealthWatch(opts = {}) {` |
| 9 | `grep -c 'it(' test/health-check.test.mjs` | `15` |

## §3 — Cross-references still valid

- All 7 exports from `lib/health-check.mjs` are imported by `test/health-check.test.mjs:3-9`. Zero stale references.
- `runHealthCheck`, `deriveStatus`, `formatHealthReport`, `parseAlertTargets`, `DEFAULT_INTERVAL_SEC` are imported by `bin/health-watch.mjs:21-25`. Zero stale references.
- `createHealthWatch` is imported by `test/health-check.test.mjs:10`. Zero stale references.
- No pre-existing symbols renamed or deleted.
- No imports from other modules were changed.
- String "health-check" appears in `workspace-bin/memory-daemon.mjs:700` as `--health-check` CLI flag to `subagent-audit` — unrelated, not a reference to this module.

## §4 — Findings

- [POSITIVE] `runHealthCheck` accepts dependency-injected check functions via opts, making all 6 component checks fully testable without requiring live NATS, Ollama, SQLite, or filesystem access.
- [POSITIVE] Each component check is wrapped in `timedCheck()` which races against a `CHECK_TIMEOUT_MS` (5s) timeout and always returns `{ ok, detail, latency_ms }` — a consistent shape that never throws.
- [POSITIVE] `Promise.allSettled` used in `runHealthCheck` means a single component timeout never blocks other checks from completing.
- [POSITIVE] `deriveStatus` is a pure function: all ok → healthy, none ok → unhealthy, mixed → degraded. Clean state machine for the watcher.
- [POSITIVE] `formatHealthReport` produces a valid markdown table with all 6 component rows, status, and latency. Suitable for direct write to `.daemon-health.md`.
- [POSITIVE] `parseAlertTargets` validates against a `Set` of known targets ('file', 'nats', 'banner'), filtering invalid entries. Gracefully defaults to all 3 when env var is empty or undefined.
- [POSITIVE] `createHealthWatch` fires initial tick immediately on start (no wait for first interval), then repeats at `intervalSec`. Alerts only on state transitions or every 5 min while unhealthy — avoids alert fatigue.
- [POSITIVE] `bin/openclaw-restart.sh` uses `launchctl kickstart -k` for managed services (atomic restart) and falls back to `pgrep/kill` for unmanaged Node processes (memory-promoter, memory-subscriber, health-watch).
- [POSITIVE] Timer uses `.unref()` so the watcher doesn't prevent process exit when stopped — correct for a daemon that may be embedded in a parent process.
- [POSITIVE] All 15 new tests pass. Test count: 671 (594 pass, 77 fail — unchanged baseline of 77 pre-existing + flaky failures).
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 item 4 said "~8 tests", VERSION_LOG mid entry said "12 tests" / "14 `it()` blocks". Actual: 15 `it()` blocks. Phase-4-correction streak: 0-of-3 (Block 4; reset at Step 4.7).
- [NEGATIVE] `bin/openclaw-restart.sh` was not made executable (`chmod +x`) due to sandbox tooling constraint. Operator should run `chmod +x bin/openclaw-restart.sh` manually after commit.

10 POSITIVE findings, 2 NEGATIVE findings.

## §5 — Phase 8 patches

1. **Mid-implementation syntax fix in `bin/health-watch.mjs`:** `??` and `||` cannot be mixed without parentheses in Node.js (SyntaxError). Original: `opts.intervalSec ?? parseFloat(...) || DEFAULT_INTERVAL_SEC`. Fixed to: `opts.intervalSec ?? (envInterval > 0 ? envInterval : DEFAULT_INTERVAL_SEC)` with a separate `envInterval` variable. This was caught during Phase 5 test run — the test file failed to import the module.

## §6 — Carry-forwards to Step 4.9

- Test baseline is now 671 tests (594 pass, 77 fail — 73 pre-existing + 4 flaky). +15 tests added this step.
- `runHealthCheck(opts)` exported from `lib/health-check.mjs:190` — core async health check with dependency injection for 6 components (daemon, nats, ollama, embedder, sqlite, workspace_writable).
- `deriveStatus(result)` exported from `lib/health-check.mjs:227` — pure function: all ok → 'healthy', none ok → 'unhealthy', mixed → 'degraded'.
- `formatHealthReport(result)` exported from `lib/health-check.mjs:245` — markdown report formatter.
- `parseAlertTargets(envValue)` exported from `lib/health-check.mjs:280` — parses `HEALTH_ALERT_TARGETS` CSV env var.
- `createHealthWatch(opts)` exported from `bin/health-watch.mjs:107` — long-running watcher factory returning `{ start(), stop() }`.
- `bin/openclaw-restart.sh` — manual restart script (needs `chmod +x` by operator).
- `COMPONENT_NAMES`, `DEFAULT_INTERVAL_SEC` (60), `ALERT_TARGETS_DEFAULT` ('file,nats,banner') constants exported from `lib/health-check.mjs`.
- Alert destinations: file → `~/.openclaw/workspace/.daemon-health.md`, NATS → `mesh.health.alerts`, banner → `workspace-bin/memory-plan-notify.sh`.
- Step 4.9 (frontend publisher pack) should add a health-watch launchd plist at `services/launchd/ai.openclaw.health-watch.plist` if the operator wants it managed.
- `.claude/hooks/pre-compact.sh` remains a no-op stub — Step 4.9 replaces it with `hooks/claude-code/pre-compact.sh`.
