# SCOPE — repair plan

**Status:** active
**Goal:** Block 3 chain (operator "go for step 3", 2026-06-10): 3.1 audit CLOSED at v3.1; now 3.2 — queue wait-timeout abandons only its OWN job + stale-pending removal (R11, spec in LLM_INFRA §3) → 3.3 — cross-process queue introspection (R12). Proofs per INVENTORY v2.
**Set at:** 2026-06-10 (Montreal)
**Expires:** 2026-06-11T12:00:00Z

```files
lib/ollama-queue.mjs
lib/llm-client.mjs
lib/health-check.mjs
bin/health-watch.mjs
workspace-bin/memory-daemon.mjs
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
