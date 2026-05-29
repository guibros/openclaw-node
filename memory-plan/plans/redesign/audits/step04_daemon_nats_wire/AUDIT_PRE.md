# AUDIT_PRE — Step 0.4: Daemon ↔ local NATS; create local-events stream (closes Block 0)

## §0 Re-orient (micro)

- **Where am I:** Block 0 (L0 deploy gap + NATS), step 4/4, 4/36 overall. Last step of Block 0.
- **Last step changed:** 0.3 stood up a local single-node NATS (JetStream, loopback) under launchd (`ai.openclaw.nats`, PID 58591). No streams yet.
- **This step contributes:** points the daemon at the local NATS and lets it create its per-node event-log stream `local-events-daedalus` (the D3 substrate the L2 watcher consumes). After this, memory operations can publish to a real local event log.
- **Block serves the north star via:** MEMORY_REDESIGN L0 done-evidence — "daemon connects; a memory event observed in local-events-<NODE_ID>."
- **Still the right next step?** Yes. INVENTORY first `[ ]` is 0.4. Closes Block 0.

## 1. Intent

Add `OPENCLAW_NATS=nats://127.0.0.1:4222` and `OPENCLAW_NODE_ID=daedalus` to the memory daemon's launchd plist `EnvironmentVariables`, reload the service (bootout + bootstrap, required to pick up env changes), and verify: NATS connected, `local-events-daedalus` stream created, a test publish lands. Scope: daemon env wiring + reload + verification only.

## 2. Pre-flight risk verification (read-only, all cleared)

| Risk | Finding | Verdict |
|---|---|---|
| Stream name with dotted hostname rejected | `NODE_ID` defaults to `os.hostname()` = `MoltyMacs-Virtual-Machine.local`; `local-events-<id>` would contain dots (illegal NATS stream name). Mitigated by `OPENCLAW_NODE_ID=daedalus`. | CLEARED (mitigated) |
| R=3 shared stream creation crashes daemon (process.exit(1)) | On single node, `ensureSharedStream` → `streams.add({num_replicas:3})` is rejected → throws → caught by daemon try/catch → "Shared stream unavailable — continuing". `inspectSharedStream`/`verifySharedStreamConfig` (the exit path) only run if add SUCCEEDS, which can't on one node. | CLEARED |
| kickstart won't pick up new env vars | true — env changes need plist reload. Using `bootout` + `bootstrap`, not kickstart. | CLEARED (method chosen) |
| openclaw.env collateral (mission-control/mesh repoint) | `OPENCLAW_NATS` set in the daemon plist only (resolution step 1, highest priority); `openclaw.env` untouched → other consumers keep remote config. | CLEARED |
| nats CLI can't reach local server | `nats --server nats://127.0.0.1:4222 stream ls` → "No Streams defined" (reachable, clean). | CLEARED |
| Daemon won't boot under new env | new-bin+new-lib already proven clean at 0.2; only adding two env vars. | CLEARED |

## 3. Risk register (residual)

| Risk | Likelihood | Mitigation |
|---|---|---|
| `daedalus` node-id change orphans `.daemon-state-MoltyMacs-Virtual-Machine.local.md` | Low | file regenerates from active-tasks.md each poll (~5ms); old one is inert text, can be deleted later |
| Stream created but test publish schema-rejected | Low | CLI publish to `local.>` bypasses daemon's Zod (NATS accepts any subject under stream); proves stream writability. Daemon-originated validated events come later. |
| Daemon crash-loop after reload | Low | bootout+bootstrap; verify PID stable >10s; rollback = restore plist.bak + reload |

## 4. Done-evidence refinement (vs INVENTORY)

INVENTORY 0.4 says "`~/.openclaw/local-events/` exists." That path is stale — the event log is a **JetStream stream** (`local-events-daedalus`) stored under `~/.openclaw/nats/jetstream/`, not a loose directory. Substitute per MASTER_PLAN §5 with the real observable state:
- boot log: `NATS connected …` + `Local event log initialized (stream: local-events-daedalus)`
- `nats stream ls` lists `local-events-daedalus`
- test publish → `stream info` messages ≥ 1
- `Shared stream unavailable … continuing` confirms federation stays dormant (D4) without crashing.

## 5. File-delta outline

**Filesystem (Bash, not gated):**
- `cp ~/Library/LaunchAgents/ai.openclaw.memory-daemon.plist{,.bak-2026-05-28}`
- rewrite plist `EnvironmentVariables` (+OPENCLAW_NATS, +OPENCLAW_NODE_ID); `plutil -lint`
- `launchctl bootout gui/501/ai.openclaw.memory-daemon` ; `launchctl bootstrap gui/501 …plist`
- `nats --server nats://127.0.0.1:4222 stream ls / info / pub` (verify)

**Repo paperwork (gated, in SCOPE):**
- this `AUDIT_PRE.md` + `AUDIT_POST.md`
- `INVENTORY.md` — flip 0.4 `[ ]` → `[x]`; Block 0 complete; next → 1.x
- `COMPONENT_REGISTRY.md` — 7.1 NATS (stream created), Family 1.7 local event log (live)
- `DECISIONS.md` — 0.4 close + Block 0 macro re-orient + node-id + done-evidence refinement
