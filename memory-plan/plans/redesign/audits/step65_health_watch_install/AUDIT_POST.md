# AUDIT_POST — Step 6.5: Install health-watch; verify daemon KeepAlive respawn

**Closed:** 2026-06-01 (implemented by autonomous tick; runtime-verified + **2 bugs fixed** + closed by operator) · **Version:** v6.5 · **closes Block 6 + all local-first blocks (0–6)**

## Provenance

Tick wrote the health-watch plist + tests (1486/0), then **blocked at Phase 5b** (correctly): symlink, plist install, launchctl load, and daemon kill/restart are all outside its sandbox. Operator deployed and ran the live verification — which surfaced **two real bugs the tick's tests could not catch**, both now fixed.

## 1. Bugs found at runtime (the reason 6.5 must be live-verified)

**Bug 1 — health-watch restart-loop (`bin/health-watch.mjs`).** The interval timer was unconditionally `.unref()`'d, so run standalone as a launchd service the process exited right after the first tick and `KeepAlive` relaunched it (~every 30s; 4 restarts observed). Fix: `start({ keepAlive })` — the CLI passes `keepAlive:true` so the timer holds the event loop open; embedded callers keep the unref. Verified: a single standalone process logged 5 ticks over 7s and the launchd service shows 1 `starting` line (was looping).

**Bug 2 — daemon health false-negative (`lib/health-check.mjs`).** `checkDaemon` parsed `launchctl list <label>` as a *table* ("last line, first token"), but with a label argument launchctl returns a property-list *dict* whose last line is `};` — so it read `};` as the PID and reported a **running** daemon as "not running (no PID)". This is why health-watch logged `degraded: failing=[daemon]` while the daemon was alive (PID 31660). Fix: parse the `"PID" = <n>;` line (extracted as `parseLaunchctlPid`, now unit-tested). The existing test mocked `checkDaemon`, so the real parser had zero coverage — exactly how this reached runtime.

## 2. Done-evidence (runtime-observable)

INVENTORY criterion 6.5: *kill the daemon → launchd respawns healthy within the interval; no restart loop; watcher logs the transition.*

**MET.**
- **Daemon KeepAlive respawn:** killed `memory-daemon` (PID 43162) via `launchctl kickstart -k` → launchd respawned it (new PID 31660) within 15s; **stable for 30s+, no crash-loop** (`memory-daemon` plist has `KeepAlive=true`, `ThrottleInterval=10`).
- **health-watch installed + stable:** symlink + resolved plist (`/usr/local/bin/node`) installed to `~/Library/LaunchAgents/`, `plutil -lint` OK, loaded; after both fixes it runs as a single stable process.
- **Watcher logs the transition / healthy state:** `~/.openclaw/workspace/.tmp/health-watch.log` → `[health-watch] healthy`. Direct `runHealthCheck()` → all 6 components OK (daemon pid=31660, nats, ollama, embedder, sqlite, workspace_writable).
- Full suite **1488/0** (was 1486; +2 `parseLaunchctlPid` regression tests).

## 3. Macro Re-Orient (block boundary — Blocks 0–6 complete)

Block 6 (storage hardening) is closed: 6.1 sqlite-store helper, 6.2 route all sites, 6.3 schema versioning, 6.4 WAL checkpoint on shutdown, 6.5 health-watch + resilience. **All local-first blocks (0–6) are now complete** — the full pipeline (ingest → extract → synthesize → consolidate → digest → retrieve → inject) is built, observable via the event log + watcher, and self-healing via launchd KeepAlive + health-watch. Block 7 (federation/G) is DEFERRED per DECISIONS D4. Recommend a full end-to-end review pass before any Block 7 work.

## 4. Carry-forwards

- health-watch flags components via launchctl/HTTP probes; it never kills the memory-daemon (only rate-limited Ollama auto-restart). Safe to run unattended.
- `parseLaunchctlPid` is now the canonical launchctl-dict parser; reuse it if other checks parse launchctl output.
