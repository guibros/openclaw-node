# SCOPE — repair plan

**Status:** active
**Goal:** Block 7 chain (operator "go", 2026-06-11): 7.1 daemon plist env parity → 7.2 tick plist paths → 7.3 wiring-manifest for the LIVE daemon → 7.4 visible skips → 7.5 fixture validity → 7.6 zod alignment → 7.7 byte caps → 7.8 dead vocabulary (operator decision at the end).

```files
services/launchd/*
test/*
packages/event-schemas/*
workspace-bin/memory-daemon.mjs
lib/pre-compression-flush.mjs
lib/memory-inject-server.mjs
bin/consolidate.mjs
bin/memory-promoter.mjs
lib/memory-budget.mjs
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
