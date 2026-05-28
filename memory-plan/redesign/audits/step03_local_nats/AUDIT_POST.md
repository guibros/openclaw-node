# AUDIT_POST — Step 0.3: Install local NATS (JetStream) as a launchd service

## 1. What was done

- `mkdir -p ~/.openclaw/nats/jetstream` (JetStream store dir).
- Wrote `~/.openclaw/nats/nats.conf`: loopback `127.0.0.1:4222`, monitor `127.0.0.1:8222`, `server_name openclaw-local`, `jetstream { store_dir … max_mem 128MB max_file 1GB }`. Validated with `nats-server -t` → "configuration file … is valid".
- Wrote `~/Library/LaunchAgents/ai.openclaw.nats.plist` (mirrors memory-daemon plist: KeepAlive, RunAtLoad, ThrottleInterval 10, logs → `~/.openclaw/nats/nats.{log,err}`). `plutil -lint` → OK.
- `launchctl bootstrap gui/501 …/ai.openclaw.nats.plist` — service loaded, PID 58563.

## 2. Done-evidence (runtime-observable, all confirmed)

| Evidence | Result |
|---|---|
| `nats-server` LISTENing on `127.0.0.1:4222` | `lsof` → `nats-server 58563 … TCP 127.0.0.1:4222 (LISTEN)` ✓ |
| Monitor port up | `127.0.0.1:8222 (LISTEN)` ✓ |
| JetStream enabled | `curl 127.0.0.1:8222/jsz` → stats (api level 3, max_memory 134217728, max_storage 1073741824, store_dir set) ✓; `/varz` shows `"jetstream": {...}` ✓ |
| launchd-managed, live PID | `launchctl list` → `58563  0  ai.openclaw.nats` ✓ |
| Survives `kickstart -k` | restarted to new PID 58591, status 0, listening again ✓ |
| Loopback-only (no off-box exposure) | only `127.0.0.1:4222`; no `0.0.0.0`/`*` bind ✓ |
| Clean boot log | "Took 918µs to start JetStream", "Listening for client connections on 127.0.0.1:4222", "Server is ready" ✓ |

(NATS logs to stderr by default → all INF lines land in `nats.err`; `nats.log` stays empty. Not an error.)

## 3. Notes

- `/jsz` reports the resolved store path as `…/nats/jetstream/jetstream` (NATS nests its storage tree one level under the configured `store_dir`). Inside our dir, harmless.
- No streams/consumers yet (`streams: 0`) — that's 0.4's job (daemon connects and creates `local-events-<nodeId>`).
- Remote mesh (`OPENCLAW_NATS=nats://100.91.131.61:4222` in `openclaw.env`) and all `mesh-*` launchd jobs left UNTOUCHED (D4 dormant). The local server is a separate loopback interface — no conflict.

## 4. Carry-forward to 0.4

- The daemon still resolves NATS to the remote mesh IP (via `openclaw.env`), so it still logs `NATS unavailable (TIMEOUT)`. 0.4 will set `OPENCLAW_NATS=nats://127.0.0.1:4222` in the **daemon's launchd plist** `EnvironmentVariables` (resolution step 1, highest priority) so the daemon uses the local server WITHOUT editing `openclaw.env` (keeps mission-control + mesh scripts pointed where they are). Then create the `local-events` stream and confirm a test publish.

## 5. Verdict

Local NATS message bus + JetStream event-log substrate is **live, loopback-only, and self-healing** under launchd. Block 0 remainder: 0.4 (daemon ↔ local NATS, create the stream).
