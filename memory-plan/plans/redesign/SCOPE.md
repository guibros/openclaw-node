# SCOPE — redesign plan

**Status:** done
**Goal:** Step 3.2 — Stop dropping tool_result / tool-call entries in the gateway transcript adapter. Remove `tool_result` from GATEWAY_SKIP_TYPES (dead code, wrong intent). Handle `toolCall` content blocks in the gateway adapter so assistant messages with only tool calls are not silently dropped. Map `toolResult` role entries properly. Done when tool messages are present in state.db for a session that had them.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
lib/transcript-parser.mjs
test/transcript-parser.test.mjs
memory-plan/plans/redesign/audits/step32_tool_entries/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step32_tool_entries/AUDIT_POST.md
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
