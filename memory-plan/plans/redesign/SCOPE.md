# SCOPE — redesign plan

**Status:** done
**Goal:** Step 1.1 — Define memory.* event vocabulary in packages/event-schemas. Add 8 boundary-event schemas (ingested, extracted, retrieved, injected, synthesized, decayed, promoted, error) to the existing event-schemas package. Unit tests validate all schemas. One round-trip publish/read against the live NATS stream succeeds.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
packages/event-schemas/src/memory/ingested.ts
packages/event-schemas/src/memory/extracted.ts
packages/event-schemas/src/memory/retrieved.ts
packages/event-schemas/src/memory/injected.ts
packages/event-schemas/src/memory/synthesized.ts
packages/event-schemas/src/memory/decayed.ts
packages/event-schemas/src/memory/promoted.ts
packages/event-schemas/src/memory/error.ts
packages/event-schemas/src/memory/index.ts
packages/event-schemas/src/events.ts
packages/event-schemas/src/index.ts
test/event-schemas.test.mjs
memory-plan/plans/redesign/audits/step11_event_vocabulary/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step11_event_vocabulary/AUDIT_POST.md
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
