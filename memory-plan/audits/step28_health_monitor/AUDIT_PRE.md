# AUDIT_PRE — Step 4.8: Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs)

**Version:** v4.8-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement per-component health checking and a long-running health watcher daemon for the
OpenClaw memory infrastructure. The health check module probes 6 runtime dependencies
(daemon, nats, ollama, embedder, sqlite, workspace_writable) and reports per-component
status. The health watcher runs at 60-second intervals, tracks aggregate health state
transitions, and routes alerts to three configurable destinations (file, NATS, macOS banner).
A manual restart script provides graceful restart of all memory daemons.

## §2 — Inventory excerpt

```
| 4 | 4.8 | v4.8 | [ ] | Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs) |
```

## §3 — Design decisions (consumed from Step 4.7 AUDIT_POST §6)

Carry-forwards from Step 4.7:
- Test baseline is now 656 tests (579 pass, 77 fail — 73 pre-existing + 4 flaky).
- `EXTRACT_SUBJECT` exported from `lib/extraction-trigger.mjs:16`.
- `DEFAULT_IDLE_THRESHOLD_SEC` exported from `lib/extraction-trigger.mjs:19`.
- `publishExtractRequest(nc, nodeId, opts)` exported from `lib/extraction-trigger.mjs:30`.
- `createExtractionTrigger(nc, nodeId, opts)` exported from `lib/extraction-trigger.mjs:51`.
- Daemon wiring at `workspace-bin/memory-daemon.mjs:1113`.
- `.claude/hooks/pre-compact.sh` remains a no-op stub — deferred to Step 4.9.

Frozen decisions from RESUME.md §0 (Block 4):
- `runHealthCheck()` → `{daemon, nats, ollama, embedder, sqlite, workspace_writable}` per-component.
- `bin/health-watch.mjs` — 60s interval long-running watcher.
- Alert destinations: file (`.daemon-health.md`), NATS (`mesh.health.alerts`), macOS banner via `memory-plan-notify.sh`.
- `HEALTH_ALERT_TARGETS` env var (CSV of `file`, `nats`, `banner`) controls destinations.
- launchd plist already has `KeepAlive=true` + `ThrottleInterval=10` (verified at `services/launchd/ai.openclaw.memory-daemon.plist`).
- `bin/openclaw-restart.sh` for manual graceful restart.

Pre-existing infrastructure leveraged:
- `lib/llm-client.mjs` health check pattern: HTTP GET `/api/tags` with 5s timeout → `{ ok, model, models, error }`.
- `workspace-bin/memory-plan-notify.sh` for macOS banner notifications (already supports closed/blocked/test modes).
- `bin/mesh-health-publisher.js` publishes to `MESH_NODE_HEALTH` KV bucket every 15s — this step adds daemon-specific health to a separate subject.
- `mission-control/src/app/api/system/health/route.ts` — existing MC health endpoint with WAL auto-checkpoint.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Health checks introduce latency / block daemon tick loop | LOW | Health watcher is a separate process (bin/health-watch.mjs), not integrated into memory-daemon tick. Each component check has its own timeout (2-5s). |
| 2 | Embedding model load for health check is slow (~5-10s first time) | LOW | Embedder check uses a lightweight probe (import check + cached state) rather than a full model load. On first run, reports `unknown` rather than blocking. |
| 3 | NATS unavailable causes health check to hang | LOW | 5s timeout per component check. All checks use Promise.race with per-component timeouts. |
| 4 | Shell-out to osascript for banner notifications may fail on non-macOS | LOW | Banner alert gracefully degrades — checks `process.platform === 'darwin'` before shelling out. Non-macOS platforms skip banner destination silently. |

## §5 — Deferrals

- Integration of health-watch alerts into the daemon's own status file (`.daemon-state-${NODE_ID}.md`) — not needed for basic monitoring.
- Health-watch auto-restart of degraded services — Step 4.8 only monitors and alerts; auto-restart is manual via `openclaw-restart.sh`. Future work if needed.
- Health-watch metrics accumulation (uptime percentage, MTTR) — out of scope; the health watcher tracks current state only.

## §6 — Phase 4 implementation outline

| # | File | Action | Delta |
|---|------|--------|-------|
| 1 | `lib/health-check.mjs` | new | Core health check module. Exports: `runHealthCheck(opts)` async function returning `{ daemon, nats, ollama, embedder, sqlite, workspace_writable }` where each value is `{ ok: boolean, detail: string, latency_ms: number }`. `formatHealthReport(result)` returns markdown string for `.daemon-health.md`. `parseAlertTargets(envValue)` parses `HEALTH_ALERT_TARGETS` CSV env var (defaults to `'file,nats,banner'`). `deriveStatus(result)` returns `'healthy'`/`'degraded'`/`'unhealthy'` from component results. `COMPONENT_NAMES` constant array. `DEFAULT_INTERVAL_SEC` (60). `ALERT_TARGETS_DEFAULT` (`'file,nats,banner'`). Component checks: daemon (launchctl list on macOS, process.kill(pid,0) fallback), nats (connect with 5s timeout), ollama (HTTP GET `/api/tags` with 5s timeout), embedder (dynamic import + pipeline cache check), sqlite (open state.db + `SELECT 1`), workspace_writable (write temp file + cleanup). |
| 2 | `bin/health-watch.mjs` | new | Long-running health watcher daemon. Exports: `createHealthWatch(opts)` factory returning `{ start(), stop() }`. Runs `runHealthCheck()` at `DEFAULT_INTERVAL_SEC` (60s, configurable via `HEALTH_WATCH_INTERVAL_SEC`). Tracks previous state for change detection. Alert routing to 3 destinations: (a) file — writes `~/.openclaw/workspace/.daemon-health.md`, (b) nats — publishes JSON to `mesh.health.alerts`, (c) banner — shells out to `memory-plan-notify.sh`. Alerts fire only on state transitions (healthy→degraded, degraded→unhealthy, etc.) or every 5 minutes while unhealthy. CLI entry with SIGINT/SIGTERM graceful shutdown. |
| 3 | `bin/openclaw-restart.sh` | new | Manual graceful restart script. Sends SIGTERM to memory-daemon, memory-promoter, memory-subscriber, health-watch PIDs (discovered via `launchctl list` on macOS or `pgrep -f` fallback). Waits 10s for graceful shutdown. Re-launches via `launchctl kickstart -k` for each service. Prints status report. |
| 4 | `test/health-check.test.mjs` | new | ~8 tests: (1) runHealthCheck returns shape with 6 component keys; (2) each component value has { ok, detail, latency_ms } shape; (3) formatHealthReport produces markdown with all component sections; (4) parseAlertTargets with default value returns 3 targets; (5) parseAlertTargets with custom CSV; (6) parseAlertTargets with empty string returns default; (7) deriveStatus all-ok → healthy, some-fail → degraded, all-fail → unhealthy; (8) createHealthWatch start/stop lifecycle. |
