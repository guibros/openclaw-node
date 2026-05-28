# SCOPE — Today's Work Contract

**Status:** done
**Goal:** Redesign step 0.3 — install a local single-node NATS server with JetStream
enabled, bound to loopback (`127.0.0.1:4222`), running as a launchd service
(`ai.openclaw.nats`) so it survives restarts. Does NOT wire the daemon to it
(that is 0.4) and does NOT touch the remote mesh config or the `mesh-*` services
(D4: federation stays dormant).
**Set at:** 2026-05-28
**Expires:** 2026-05-29T08:00:00Z

> Step 0.3 per `redesign/INVENTORY.md` (Block 0). The nats.conf + launchd plist
> are created in standard runtime locations via Bash (mv/ln/heredoc — not gated).
> The files below are the step's paperwork: AUDIT_PRE/POST, inventory flip,
> registry status, decisions log.

## Done-evidence (runtime-observable, MASTER_PLAN §5)

- `lsof -nP -iTCP:4222 -sTCP:LISTEN` shows `nats-server` LISTENing on `127.0.0.1:4222`.
- JetStream enabled: `curl -s 127.0.0.1:8222/jsz` returns JetStream stats (config OK),
  OR `nats account info` reports JetStream available.
- Service is launchd-managed: `launchctl list | grep ai.openclaw.nats` shows it loaded
  with a live PID; survives `launchctl kickstart -k` (comes back on its own).
- Loopback-only: not reachable off-box (bound to 127.0.0.1, not 0.0.0.0) — no mesh exposure.

## Plan (shown before each runs)

1. `mkdir -p ~/.openclaw/nats/jetstream` (JetStream store dir).
2. Write `~/.openclaw/nats/nats.conf` (heredoc): host 127.0.0.1, port 4222,
   http monitor 127.0.0.1:8222, `jetstream { store_dir … max_file 2GB }`.
3. Write `~/Library/LaunchAgents/ai.openclaw.nats.plist` (heredoc), mirroring the
   memory-daemon plist: ProgramArguments = `nats-server -c …/nats.conf`,
   KeepAlive, RunAtLoad, ThrottleInterval 10, logs → `~/.openclaw/nats/nats.{log,err}`.
4. `launchctl bootstrap gui/$(id -u) …/ai.openclaw.nats.plist`; capture PID.
5. Verify: lsof :4222, JetStream stats, survives kickstart.

Rollback: `launchctl bootout gui/$(id -u)/ai.openclaw.nats`; `rm` the plist; the
JetStream store dir can be left (empty) or removed. Nothing else is touched.

```files
memory-plan/redesign/audits/step03_local_nats/**
memory-plan/redesign/INVENTORY.md
memory-plan/COMPONENT_REGISTRY.md
memory-plan/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
  `idle` / `done` / anything else → the hook blocks (forces a fresh scope).
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. Refresh before continuing.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
