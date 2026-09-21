# SCOPE — openviking-adopt plan

**Status:** active
**Goal:** Land the four code recommendations of the 2026-09-21 OpenViking review as one operator-requested batch ("implement this"): path-scoped knowledge search (Block 1), per-directory L0/L1 summaries (Block 2), typed memory merge with read-before-write extraction (Block 3), and an OpenClaw context-engine plugin that injects the :7893 memory block natively (Block 4), plus the CLAUDE.md correction (Block 5). `package-lock.json` is in scope only because the plugin is an npm workspace (`packages/*`) and `npm ci` refuses a lockfile that does not list it. Code + container-verifiable tests land in this batch; each INVENTORY step closes only when its `runtime:` Verify is observed on the deployed node (MASTER_PLAN §4.1 — this batch does not close steps).
**Set at:** 2026-09-21 (operator: "implement this", after the OpenViking architecture/code review delivered in the same session)
**Expires:** 2026-09-28T00:00:00Z

```files 2026-09-21-openviking-adopt
lib/mcp-knowledge/core.mjs
lib/mcp-knowledge/server.mjs
lib/mcp-knowledge/directory-summaries.mjs
workspace-bin/knowledge-index-job.mjs
lib/extraction-schema.mjs
lib/extraction-prompt.mjs
lib/extraction-store.mjs
lib/memory-types.mjs
lib/pre-compression-flush.mjs
lib/memory-injector.mjs
lib/retrieval-pipeline.mjs
packages/openclaw-memory-context-engine/*
packages/openclaw-memory-context-engine/**/*
test/*
CLAUDE.md
README.md
memory-plan/plans/openviking-adopt/*
memory-plan/plans/openviking-adopt/**/*
workspace-bin/openviking-adopt-tick.sh
package-lock.json
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

**Hotfix 2026-09-21 (CI, PR #26):** the repo's own `npm audit --audit-level=high` gate went red on
both trees for sharp advisory GHSA-rgj7-g3m4-5g8c (libheif; fixed in sharp 0.35.4), published after
main's last green run; both lockfiles pinned 0.35.3 and this batch did not touch them. Ported fix:
root override `sharp ^0.35.4` + lockfile refresh, Mission Control lockfile `npm update sharp`.
No source change. Files below are in scope for that one commit only.

```files 2026-09-21-sharp-audit-hotfix
package.json
package-lock.json
mission-control/package.json
mission-control/package-lock.json
```
