# One-click stack launcher

`openclaw-stack` brings the whole node up (or reports it, or takes it down) in one move —
and ships as a double-clickable icon.

```sh
openclaw-stack up        # start everything installed + companion-bridge, probe, popup
openclaw-stack status    # truth table only (exit 1 if anything is DOWN)
openclaw-stack down      # stop every openclaw unit + the bridge child
```

**Icon:** macOS gets `~/Applications/OpenClaw Stack.app` (claw icon, Dock-able; built by
install.sh via `services/launcher/build-launcher-app.sh`). Linux gets an app-menu entry
(`services/launcher/openclaw-stack.desktop` → `~/.local/share/applications/`). Either one runs
`up` headless; the result arrives as a ledgered notification (click-through to Mission Control
`/diagnostics`), and details land in `~/.openclaw/logs/stack-launcher.log`.

**What it starts — discovery, not a hardcoded list:** every installed `ai.openclaw.*` launchd
plist (macOS) / `openclaw-*` systemd user unit (Linux). Unloaded units are bootstrapped;
KeepAlive daemons that lost their process are kickstarted; running services are left alone.
`companion-bridge` (external repo, no service unit) is spawned detached when its repo exists
and :8787 is closed (`OPENCLAW_BRIDGE_DIR` overrides the default location).

**What it refuses to start:** units parked as `.plist.disabled` (the 2026-07-03 crash-loop
triage: mesh-*, lane-watchdog, deploy-listener, log-rotate). They are REPORTED as DISABLED —
re-enabling one is an operator decision, not a launcher side effect.

**Statuses:** `LIVE` (pid and, where applicable, open port: nats 4222 · mission-control 3000 ·
workplan-viewer 7892 · memory-daemon 7893 · companion-bridge 8787) · `LOADED` (periodic unit
between runs — healthy) · `DOWN` (loaded but not answering) · `OFF` (not loaded) ·
`DISABLED` · `ABSENT`.
