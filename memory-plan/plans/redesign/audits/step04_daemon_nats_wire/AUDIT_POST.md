# AUDIT_POST — Step 0.4: Daemon ↔ local NATS; create local-events stream (closes Block 0)

## 1. What was done

- Confirmed the daemon plist `~/Library/LaunchAgents/ai.openclaw.memory-daemon.plist` already carried `OPENCLAW_NATS=nats://127.0.0.1:4222` + `OPENCLAW_NODE_ID=daedalus` (Phase-4 env edit landed 2026-05-28; backup `.bak-2026-05-28` present). No plist edit needed this session.
- Found the daemon was **not loaded** (no `ai.openclaw.memory-daemon` in `launchctl list`; no process). `launchctl bootstrap gui/501 …/ai.openclaw.memory-daemon.plist` → loaded, PID 42661.
- Verified NATS connection, stream creation, federation-dormant, and a test publish (CLI `nats pub local.test.ping`).

## 2. Done-evidence (runtime-observable, all confirmed)

| Evidence | Result |
|---|---|
| Daemon resolves to local NATS + connects | boot log `NATS connected (reconnect: infinite, wait: 2000ms) — subscribed to mesh.memory.compaction_completed` ✓ |
| Local event-log stream created | `Local event log initialized (stream: local-events-daedalus)` ✓ |
| Stream present in JetStream | `nats stream ls` → `local-events-daedalus` (created 2026-05-29 18:27:21, subjects `local.>`) ✓ |
| Stream writable (test publish) | `nats pub local.test.ping` → "Published 24 bytes"; `stream info` → Messages 1, 69 B ✓ |
| Federation stays dormant (D4) without crashing | `Shared stream unavailable (replicas > 1 not supported in non-clustered mode) — continuing without federation stream` ✓ |
| Daemon stable post-boot | PID 42661 alive across repeated checks (>15s); stderr STABLE (not growing) ✓ |
| Node-id avoids dotted-hostname stream name | stream is `local-events-daedalus` (not `…-MoltyMacs-Virtual-Machine.local`) ✓ |

## 3. Done-evidence refinement (per AUDIT_PRE §4)

INVENTORY 0.4 said "`~/.openclaw/local-events/` exists." Stale: the event log is a **JetStream stream** (`local-events-daedalus`, store under `~/.openclaw/nats/jetstream/`), not a loose directory. Evidence substituted with the real observable state above per MASTER_PLAN §5.

## 4. Out-of-scope observed (captured, not fixed)

At boot the daemon stderr showed a one-time `libc++abi … mutex lock failed` native worker crash (+ `PID check failed … kill ESRCH` watchdog lines) and a Zod extraction-validation dump rejecting out-of-enum entity/relationship types. Main daemon survived; these are pre-existing behavior unrelated to 0.4's env wiring. Logged to `OUT_OF_SCOPE.md` (2026-05-29) → redesign Block 2 (silent-failure watcher) + step 3.4 (tolerant extraction).

## 5. Verdict

The daemon connects to the local NATS bus and its per-node event-log stream `local-events-daedalus` is **live and writable**, federation dormant, daemon stable. **Block 0 (L0 deploy gap + local NATS substrate) is complete.** Next: Block 1 (emit `memory.*` events at the ingest/extract/inject boundaries), inventory step 1.1.
