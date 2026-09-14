# SCOPE — flowsint-service plan

**Status:** idle
**Goal:** Durable plan authored 2026-09-14; no deployment, service, adapter, or runtime scope is open. The operator must explicitly open step 1.1 before execution.
**Set at:** 2026-09-14T13:28:36-04:00
**Expires:** no-expiry

```files
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and, when the batch
  ships, append the word `closed` to the fence (` ```files <label> closed `) — the hook prunes
  closed blocks, so finished work re-locks while the record stays. One open block per
  in-flight batch.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
