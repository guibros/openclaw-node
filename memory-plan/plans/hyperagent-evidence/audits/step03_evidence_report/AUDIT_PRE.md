# AUDIT_PRE — step 0.3: honest evidence report (2026-07-21)

**Before code.** Contract: INVENTORY 0.3; IMPLEMENTATION_PLAN §5/0.3.

## Design
- Store method `cohortReport(runId)` (lib/hyperagent-store.mjs): pure SQL aggregation, one
  deterministic object. Sections: totals (rows / distinct sessions / distinct logical tasks);
  by_execution_class (real/mock/chaos/synthetic/unknown — unknown = NULL class); cohort
  (real-class only): per-domain, per-mode, per node/soul with distinct-logical-task counts,
  outcome distribution, reflection eligibility (rows-per-identity vs the ≥5 threshold),
  telemetry completeness (real rows missing session_id/provider/model), strategy_coverage
  (real rows carrying strategy_id — COVERAGE, never "hit rate"); failures split natural
  (real-class failures) vs induced (chaos-class failures).
- Determinism: no timestamps/randomness in output; fixed key structure; arrays sorted by key.
  Same DB snapshot + run_id ⇒ byte-identical JSON.
- CLI: `hyperagent report --run <id> [--json]` — JSON to stdout (the audit artifact); table
  summary otherwise.
- Tests: fixture with duplicated worker rows (same logical_task_id, 3 rows), mock rows, chaos
  failures → distinct-task count correct, exclusions right; determinism = two calls, identical
  strings.
- Runtime verify: scratch DB double-run byte-identical (diff); production read-only run shows
  `unknown:1`, cohort empty — no writes.

## Non-goals
No effectiveness metrics, no causal language, no MC wiring (1.2 consumes this later).
