# SCOPE — redesign plan

**Status:** done
**Goal:** Step 1.4 — Emit memory.retrieved + memory.injected in the inject server. Wire event emission in the /memory/inject HTTP handler: memory.retrieved after retrieval completes (query_hash/channels_hit/results_count/duration_ms), memory.injected after the full response is ready (request_id/token_count/blocks_count/duration_ms). Pass localEventLog + NODE_ID from daemon into startInjectionServer. After restart, a /memory/inject request produces both events in local-events-daedalus.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
lib/memory-inject-server.mjs
workspace-bin/memory-daemon.mjs
test/event-schemas.test.mjs
memory-plan/plans/redesign/audits/step14_emit_retrieved_injected/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step14_emit_retrieved_injected/AUDIT_POST.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
