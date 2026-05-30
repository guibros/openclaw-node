# SCOPE — redesign plan

**Status:** done
**Goal:** Step 1.5 — Emit memory.error on caught failures across the wired boundaries. Add emitErrorEvent helper in daemon; wire at all 6 daemon catch blocks (3 ingest, 3 extract) and the inject server HTTP 500 catch. After restart, inducing a failure at a wired boundary produces a memory.error event in local-events-daedalus.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
workspace-bin/memory-daemon.mjs
lib/memory-inject-server.mjs
test/event-schemas.test.mjs
memory-plan/plans/redesign/audits/step15_emit_error/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step15_emit_error/AUDIT_POST.md
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
