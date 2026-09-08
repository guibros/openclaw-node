# SCOPE — integrations plan

**Status:** active
**Goal:** Step 1.1 — web-fetch `--markdown`: inject the Defuddle full bundle into the rendered page and print a provenance header plus Markdown, falling back to innerText under a word floor. (Block 0 docs batch closed 2026-09-08.)
**Set at:** 2026-09-08
**Expires:** 2026-09-15T23:59:00Z

```files block0 closed
memory-plan/plans/integrations/ROADMAP.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/TICK_PROMPT.md
memory-plan/plans/integrations/automation.json
```

```files step11
workspace-bin/web-fetch.mjs
package.json
package-lock.json
config/harness-rules.json
test/web-fetch-markdown.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step11_web_fetch_markdown/*
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
