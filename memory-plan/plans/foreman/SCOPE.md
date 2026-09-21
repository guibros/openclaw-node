# SCOPE — foreman plan

**Status:** done
**Closed at:** 2026-09-21 — step 1.1 closed at v1.1 (see audits/step11_shadow-supervision/AUDIT_POST.md). Next scope: step 1.2 is the operator's deploy-and-observe step; open it when the runtime tree carries this commit.
**Goal:** Step 1.1 — shadow-mode Foreman supervision over mesh workers: `lib/foreman/` (observation · assessment · policy · steering · assessor · supervisor) wired into `bin/mesh-agent.js` `runLLM`/`executeTask`; every decision recorded to a per-task JSONL timeline + `mesh.foreman.*` events, none enforced. Operator instruction 2026-09-21: "integrate the Foreman tech".
**Set at:** 2026-09-21
**Expires:** 2026-10-05T00:00:00Z

```files step-1.1 closed
lib/foreman/index.mjs
lib/foreman/assessment.mjs
lib/foreman/policy.mjs
lib/foreman/steering.mjs
lib/foreman/observation.mjs
lib/foreman/assessor.mjs
lib/foreman/supervisor.mjs
bin/mesh-agent.js
test/foreman-assessment.test.mjs
test/foreman-policy.test.mjs
test/foreman-observation.test.mjs
test/foreman-assessor.test.mjs
test/foreman-supervisor.test.mjs
docs/foreman.md
memory-plan/plans/foreman/ROADMAP.md
memory-plan/plans/foreman/INVENTORY.md
memory-plan/plans/foreman/DECISIONS.md
memory-plan/plans/foreman/COMPONENT_REGISTRY.md
memory-plan/plans/foreman/TICK_PROMPT.md
memory-plan/plans/foreman/VERSION
memory-plan/plans/foreman/audits/step11_shadow-supervision/AUDIT_PRE.md
memory-plan/plans/foreman/audits/step11_shadow-supervision/AUDIT_POST.md
CLAUDE.md
# scaffolded by workspace-bin/new-plan.sh (PROTOCOL §9); automation.json points at it
workspace-bin/foreman-tick.sh
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
