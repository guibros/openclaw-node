# AUDIT_PRE — step 1.2: read-only MC evidence page (2026-07-21)

**Before merge.** Contract: INVENTORY 1.2. Built by a confined subagent (no git, MC-only,
GET-only, readonly DB handles, eslint 0/0 preserved); orchestrator verifies, deploys via
RUNBOOK_MC_DEPLOY, and runs the live checks. The `visual:` clause (operator legibility) stays
OPEN at close-time — the step holds [A] until the operator confirms the page.

## Plan
- src/lib/hyperagent-read.ts: readonly data layer over ha_* (env override for fixture tests);
  overview / reflections / proposals / per-run report; COVERAGE language only.
- GET /api/hyperagent + GET /api/hyperagent/report?run= — no mutation routes.
- /hyperagent page: status cards, class table (unknown = cohort-ineligible), reflections with
  24h-window flags, proposals with status + "CLI-only approval" note, run-report lookup.
- Drop the dead mismatched hyperagentProposals drizzle stub (grep-verified unreferenced).
- Verify: agent gates (tsc/eslint 0-0/vitest/build) + orchestrator: route-inventory grep
  (GET-only), readonly assertion in tests, deploy + live 200 on /hyperagent + /api/hyperagent,
  auth middleware still gating mutations (the new GETs pass through), seeded-disposable-db render
  covered by the fixture tests; notification click-through lands on the live page.
