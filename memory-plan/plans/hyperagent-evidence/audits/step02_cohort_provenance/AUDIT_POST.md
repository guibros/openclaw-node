# AUDIT_POST — step 0.2 CLOSED: cohort provenance (2026-07-21)

## Delivered
- **Store** (lib/hyperagent-store.mjs): 7 additive ha_telemetry columns (run_id,
  logical_task_id, session_id, execution_class, collaboration_mode, provider, model) via the
  #ensureColumn pattern + cohort index (run_id, execution_class). logTelemetry validates
  execution_class ∈ {real, mock, chaos, synthetic}; absent → NULL, read as 'unknown' and
  cohort-ineligible.
- **Producer** (bin/mesh-agent.js recordHyperagentTask — the single funnel behind all six write
  sites): mechanical derivation. execution_class: valid task.execution_class → 'shell' provider
  ⇒ mock → valid env OPENCLAW_EXECUTION_CLASS (3.5 feeder blanket) → 'real'. run_id from
  task/env; logical_task_id linkage chain (logical_task_id ?? parent_task_id ?? plan_id ??
  task_id); provider/model recomputed deterministically in the funnel (resolveProvider/
  resolveModel) instead of threading six sites; sessionId threaded at the collab-end site.
  OPENCLAW_STATE_DB override added at both store-open sites so tests drive the REAL funnel
  against scratch DBs. recordHyperagentTask + deriveExecutionClass exported for tests.
- **CLI read side**: `hyperagent telemetry` gains Class + Run columns ('unknown'/'-' defaults).

## Runtime evidence (all observed)
- Real-funnel scratch proof (integration test, REAL recordHyperagentTask, scratch DB via the
  override): one real-class + one mock-class write → separated by a single SQL predicate; the
  real row retains session_id/mode/run_id/provider; the mock subtask row's logical_task_id
  resolves to its plan_id; derivation unit-checked (chaos passthrough, shell⇒mock, default real).
- **Production migration observed live**: deployed CLI `status` touch → columns materialized
  additively; `SELECT COUNT, COALESCE(execution_class,'unknown') ... GROUP BY` → `1|unknown` —
  the historical row preserved, queryable, cohort-ineligible. No production rows written
  (ha_telemetry still 1).
- Suites: hyperagent-store + hyperagent-integration **46/0** (invalid-class throw, NULL
  semantics, round-trip, funnel proof); bin parse checks clean.

## Notes
Session interrupted mid-step by a quota cut (previous process exited); resumed with edits
intact — the store-test addition initially targeted a stale file shape (the parallel session's
withFreshStore rewrite) and was redone in that idiom.
