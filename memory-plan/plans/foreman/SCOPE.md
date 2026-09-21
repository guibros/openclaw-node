# SCOPE — foreman plan

**Status:** done
**Closed at:** 2026-09-21 — Block 2 closed at v2.2 (steps 2.1 + 2.2, D2). Next: step 1.2 is the operator's deploy-and-observe step (`mesh deploy` on the lead after merging PR #27); open a scope for Block 3 after that.
**Set at:** 2026-09-21 (Block 2 — enforcement, steps 2.1 + 2.2, operator instruction "implement the thing": enforcement is the default, not a later gate)
**Expires:** 2026-09-28T00:00:00Z
**Closed at:** 2026-09-21 — step 1.1 closed at v1.1 (see audits/step11_shadow-supervision/AUDIT_POST.md). Next scope: step 1.2 is the operator's deploy-and-observe step; open it when the runtime tree carries this commit.
**Goal:** Step 1.1 — shadow-mode Foreman supervision over mesh workers: `lib/foreman/` (observation · assessment · policy · steering · assessor · supervisor) wired into `bin/mesh-agent.js` `runLLM`/`executeTask`; every decision recorded to a per-task JSONL timeline + `mesh.foreman.*` events, none enforced. Operator instruction 2026-09-21: "integrate the Foreman tech".
**Originally set at:** 2026-09-21 (step 1.1 batch, now closed)

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

```files ci-audit-sharp closed
# PR #27 CI red at `npm audit --audit-level=high` in both trees on sharp <0.35.4
# (GHSA-rgj7-g3m4-5g8c, libheif) — an advisory published after main's last green run,
# untouched by step 1.1's diff. Lockfile bumps only; ported into the PR so it goes green.
package.json
package-lock.json
mission-control/package.json
mission-control/package-lock.json
```

```files block-2-enforcement closed
lib/foreman/supervisor.mjs
lib/foreman/verifier.mjs
lib/foreman/index.mjs
lib/foreman/policy.mjs
bin/mesh-agent.js
test/foreman-supervisor.test.mjs
test/foreman-verifier.test.mjs
test/foreman-enforcement.test.mjs
docs/foreman.md
CLAUDE.md
memory-plan/plans/foreman/INVENTORY.md
memory-plan/plans/foreman/DECISIONS.md
memory-plan/plans/foreman/COMPONENT_REGISTRY.md
memory-plan/plans/foreman/ROADMAP.md
memory-plan/plans/foreman/VERSION
memory-plan/plans/foreman/audits/step21_enforce-stop-escalate/AUDIT_PRE.md
memory-plan/plans/foreman/audits/step21_enforce-stop-escalate/AUDIT_POST.md
memory-plan/plans/foreman/audits/step22_verifier-pass/AUDIT_PRE.md
memory-plan/plans/foreman/audits/step22_verifier-pass/AUDIT_POST.md
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
