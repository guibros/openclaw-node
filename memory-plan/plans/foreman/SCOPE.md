# SCOPE — foreman plan

**Status:** active
**Closed at:** 2026-09-26 — batch `audit-remediation-2026-09-26` code-complete on branch `claude/determined-chaplygin-2f5965` (PR to `main`); no step closed: 1.2 stays `[ ]`, 2.1/2.2 stay `[A]` until their `runtime:` Verify is observed on the operator's node (audits/remediation_2026-09-26/AUDIT.md §6). Review fixes on that PR re-open this block under the same approval.

Reopened 2026-09-27 on operator instruction ('fix the must-fix items on the PR branches') for PR #32's review must-fixes only.
**Set at:** 2026-09-26 17:30 America/Montreal — batch `audit-remediation-2026-09-26`, operator-approved in session: remediate the five defects the 2026-09-26 audit verified on main (no-metric completion inverted · first-match verdict parser · writable verifier · single-sample STOP · supervisor leak + idle ceiling) and make enforcement opt-in. Operator rulings: STOP hysteresis in; a no-metric `shell` task completes on its exit code when enforcing (no verifier can take its prompt).
**Expires:** 2026-09-30T00:00:00Z
**Goal:** Shadow by default (`MESH_FOREMAN_ENFORCE=1` enforces; the knob is rendered into the mesh-agent launchd/systemd units); when enforcing, a no-metric attempt completes only on exactly one well-formed `FOREMAN_VERDICT: PASS` from a verifier that left the worktree unchanged; the supervisor is closed on every exit path and idle decisions neither poll nor count toward the ceiling; STOP needs K consecutive stuck assessments on an unchanged tree. Steps 2.1/2.2 re-opened to `[A]` (their runtime Verify never ran). Code + tests only — runtime evidence is the operator's node (step 1.2, then 2.1/2.2 Verify).

**History:** Block 2 batch closed 2026-09-21 at v2.2 (steps 2.1 + 2.2, D2 — enforcement as default); re-opened by this batch. Step 1.1 batch closed 2026-09-21 at v1.1 (see audits/step11_shadow-supervision/AUDIT_POST.md).

```files review-fixes-2026-09-27
bin/mesh-agent.js
lib/foreman/supervisor.mjs
lib/foreman/observation.mjs
bin/openclaw-node-init.js
```

```files audit-remediation-2026-09-26 closed
lib/foreman/supervisor.mjs
lib/foreman/policy.mjs
lib/foreman/verifier.mjs
lib/foreman/observation.mjs
lib/foreman/index.mjs
# shell provider gains acceptsPrompt=false (no verifier can take its prompt)
lib/llm-providers.js
bin/mesh-agent.js
# the unit templates carry ${MESH_FOREMAN_ENFORCE}; both renderers must know it
bin/openclaw-node-init.js
scripts/install/services.sh
services/launchd/ai.openclaw.mesh-agent.plist
services/systemd/openclaw-mesh-agent.service
openclaw.env.example
test/foreman-*.test.mjs
test/node-init-render.test.mjs
docs/foreman.md
CLAUDE.md
memory-plan/plans/foreman/INVENTORY.md
memory-plan/plans/foreman/ROADMAP.md
memory-plan/plans/foreman/DECISIONS.md
memory-plan/plans/foreman/COMPONENT_REGISTRY.md
memory-plan/plans/foreman/VERSION
memory-plan/plans/foreman/audits/remediation_2026-09-26/*
```

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
