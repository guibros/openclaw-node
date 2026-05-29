# SCOPE — redesign plan

**Status:** done
**Goal:** STEP 0.4 — Daemon ↔ local NATS; create the `local-events-daedalus` JetStream
stream (closes Block 0). Point the memory daemon at `nats://127.0.0.1:4222` with
`OPENCLAW_NODE_ID=daedalus`, reload the service (bootout + bootstrap), and verify the
node event-log stream exists and is writable. Daemon env wiring + reload + verification
+ step paperwork only. Driven **interactively** (runtime-heavy step).
**Set at:** 2026-05-29
**Expires:** 2026-05-30T23:59:00Z

Done-evidence (per AUDIT_PRE §4): boot log `NATS connected …` +
`Local event log initialized (stream: local-events-daedalus)`; `nats stream ls` lists
`local-events-daedalus`; test publish → `stream info` messages ≥ 1; `Shared stream
unavailable … continuing` (federation dormant, no crash).

Filesystem actions (daemon plist edit, `launchctl bootout/bootstrap`, `nats` CLI) are
Bash — not gated. The gated repo paperwork is the `files` block below.

```files
memory-plan/plans/redesign/audits/step04_daemon_nats_wire/*
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
memory-plan/plans/redesign/VERSION
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
