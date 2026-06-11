# SCOPE — repair plan

**Status:** idle
**Goal:** Block 3 chain CLOSED 3.1–3.3 at v3.3 (audit + queue ownership + cross-process introspection, all runtime-proved; suite 1526/0). 3.4 DEFINED (R43+R42+R44-docs) — awaiting operator scope confirmation (the docs-vs-build choice on the tier selector). Closing 3.4 closes Block 3 → macro Re-Orient → Block 4.
**Set at:** 2026-06-10 (Montreal)
**Expires:** no-expiry

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
