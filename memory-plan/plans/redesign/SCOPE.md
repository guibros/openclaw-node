# SCOPE — redesign plan

**Status:** done
**Goal:** Step 1.3 — Emit memory.extracted at the extract boundary. Wire `publishLocal(buildMemoryEvent('memory.extracted', ...))` after every successful LLM extraction in the daemon's 3 flush call sites (ACTIVE→IDLE, IDLE→ENDED, NATS-triggered). After restart, triggering an extraction produces a `memory.extracted` event in `local-events-daedalus` with session_id/entities_count/themes_count/mentions_count/decisions_count/model/duration_ms.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
workspace-bin/memory-daemon.mjs
lib/pre-compression-flush.mjs
test/event-schemas.test.mjs
memory-plan/plans/redesign/audits/step13_emit_extracted/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step13_emit_extracted/AUDIT_POST.md
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
