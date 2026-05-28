# AUDIT_PRE — Step 0.3: Install local NATS (JetStream) as a launchd service

## §0 Re-orient (micro)

- **Where am I:** Block 0 (L0 deploy gap + NATS), step 3/4, 3/36 overall.
- **Last step changed:** 0.2 symlinked the daemon binary → repo + restarted; code half of the deploy gap is closed. Daemon currently logs `NATS unavailable (TIMEOUT)` because the only configured NATS is the remote mesh (`nats://100.91.131.61:4222`, Tailscale, down).
- **This step contributes:** stands up a LOCAL NATS server (JetStream, loopback) as a launchd service. It is the substrate for the per-node event log (D3) the watcher (L2) will read. Does NOT wire the daemon (0.4) and does NOT touch the remote mesh (D4 dormant).
- **Block serves the north star via:** MEMORY_REDESIGN L0 — "Start a local NATS server with JetStream (single-node for local; the 3-node cluster is a G-phase concern)."
- **Still the right next step?** Yes. INVENTORY first `[ ]` is 0.3. Operator chose "Local NATS (follow plan)" over reusing the remote mesh.

## 1. Intent

Run `nats-server` (homebrew v2.12.6) with a JetStream-enabled config bound to `127.0.0.1:4222` (monitor `127.0.0.1:8222`), managed by a launchd service `ai.openclaw.nats` (KeepAlive, RunAtLoad), so a local message bus exists and survives restarts. Scope: install + run + verify only. No daemon wiring, no mesh changes.

## 2. Key context discovered

- **What "you already have NATS" actually is:** a *remote* mesh server at `nats://100.91.131.61:4222` (Ubuntu worker, Tailscale), set in `~/.openclaw/openclaw.env` as `OPENCLAW_NATS`. Currently unreachable → the daemon's TIMEOUT. This is the federation layer D4 keeps dormant — NOT the local server 0.3 needs.
- **URL resolution chain** ([lib/nats-resolve.js](../../../../lib/nats-resolve.js)): env var → `openclaw.env` → `~/openclaw/.mesh-config` → `nats://127.0.0.1:4222` fallback. Because `openclaw.env` sets the remote IP, it wins. Pointing the daemon at the new local server (0.4) will be done via the daemon's **launchd `OPENCLAW_NATS` env var** (resolution step 1, highest priority) — the resolver's own comment names launchd as the intended override. This leaves `openclaw.env` (and thus mission-control + mesh scripts) untouched.
- **Pre-existing mesh launchd jobs** (`mesh-agent`, `mesh-bridge`, `mesh-health-publisher`, `mesh-task-daemon`, …) stay untouched. Out of scope for 0.3.

## 3. Pre-flight risk verification (read-only, all cleared)

| Risk | Finding | Verdict |
|---|---|---|
| nats-server missing / wrong version | `/opt/homebrew/bin/nats-server` v2.12.6 present | CLEARED |
| Port 4222/8222 already taken | `lsof` shows both free (no local NATS running) | CLEARED |
| Config typo bricks the service (crash-loop) | nats-server supports `-t` (test config and exit) — validate before load | CLEARED (mitigated) |
| Binding exposes NATS off-box | config binds `host: 127.0.0.1` (loopback), not `0.0.0.0` — unreachable off-machine | CLEARED |
| Collides with remote mesh | local is loopback-only; remote is a Tailscale IP — different interfaces, no conflict | CLEARED |
| Stale dir from prior attempt | `~/.openclaw/nats` does not exist — clean slate | CLEARED |

## 4. Risk register (residual)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Disk pressure — volume at 94% (12 GiB free) | Medium | cap JetStream `max_file: 1GB`, `max_mem: 128MB`; event log is tiny (R=1, small JSON). Monitor; revisit limits later. |
| launchd job crash-loops on bad config | Low | `nats-server -t -c nats.conf` dry-run BEFORE bootstrap; ThrottleInterval 10; rollback = bootout + rm plist |
| No auth on local NATS | Low (loopback-only) | acceptable for 127.0.0.1; token can be added later if any non-loopback bind is ever introduced |

## 5. Done-evidence (runtime-observable)

- `lsof -nP -iTCP:4222 -sTCP:LISTEN` → `nats-server` on `127.0.0.1:4222`.
- `curl -s 127.0.0.1:8222/jsz` returns JetStream stats (JetStream enabled).
- `launchctl list | grep ai.openclaw.nats` → loaded with live PID; survives `kickstart -k`.
- Loopback-only confirmed (no `*:4222`, only `127.0.0.1:4222`).

## 6. File-delta outline

**Filesystem (Bash, not gated):**
- `mkdir -p ~/.openclaw/nats/jetstream`
- write `~/.openclaw/nats/nats.conf`
- write `~/Library/LaunchAgents/ai.openclaw.nats.plist`
- `nats-server -t -c ~/.openclaw/nats/nats.conf` (validate)
- `launchctl bootstrap gui/501 ~/Library/LaunchAgents/ai.openclaw.nats.plist`

**Repo paperwork (gated, in SCOPE):**
- this `AUDIT_PRE.md` + `AUDIT_POST.md`
- `INVENTORY.md` — flip 0.3 `[ ]` → `[x]`, next → 0.4
- `COMPONENT_REGISTRY.md` — add local NATS service entry (or update mesh/NATS family)
- `DECISIONS.md` — 0.3 close: local NATS loopback + the remote-mesh-vs-local finding + launchd-env override plan for 0.4

## 7. Open question for operator (config-as-code)

The existing `ai.openclaw.*` plists are hand-managed in `~/Library/LaunchAgents` (not repo-tracked). The deploy-gap discipline (Family 8) is about the daemon code, not every config. For 0.3 I will create `nats.conf` + the plist directly in standard locations (consistent with existing services). Whether to later repo-track + symlink these configs is a candidate for OUT_OF_SCOPE, not a 0.3 blocker.
