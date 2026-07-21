# AUDIT_PRE — step 0.2: cohort provenance (2026-07-20)

**Before code.** Contract: INVENTORY 0.2; IMPLEMENTATION_PLAN §5/0.2.

## Probed reality
- ALL telemetry flows through ONE funnel: `recordHyperagentTask` (bin/mesh-agent.js:271), six
  call sites (D11-decline 1166; solo/collab success+failure 1420/1580/1630/1665/1858) —
  provenance added in the helper covers every path.
- Worker identity available at the sites: `resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER)` →
  provider name + model resolution (lib/llm-providers, MOCK_PROVIDERS={'shell'} module-local, but
  the provider NAME is what we store — 'shell' check is enough).
- Subtask linkage: plans carry parent_task_id/plan_id; tasks carry plan_id →
  logical_task_id = task.logical_task_id ?? task.parent_task_id ?? task.plan_id ?? task.task_id.
- Session id: discovered in the collab flow after claim; threaded to the helper where in scope.
- Store: #ensureColumn additive-migration pattern exists (parallel session's hardening).

## Design
1. **Store** (lib/hyperagent-store.mjs): 7 additive columns on ha_telemetry — run_id,
   logical_task_id, session_id, execution_class, collaboration_mode, provider, model.
   logTelemetry validates execution_class ∈ {real, mock, chaos, synthetic} (invalid → throw;
   absent → NULL, which queries read as 'unknown' — historical rows stay queryable and
   cohort-ineligible).
2. **Producer** (recordHyperagentTask): mechanical derivation —
   execution_class: task.execution_class (validated) → 'shell' provider ⇒ 'mock' →
   env OPENCLAW_EXECUTION_CLASS (validated; the 3.5 chaos feeder's blanket) → 'real'.
   run_id: task.run_id ?? env OPENCLAW_HA_RUN_ID ?? null. logical_task_id per linkage chain.
   collaboration_mode: task.collaboration?.mode ?? null. provider/model + session_id threaded
   from call sites where in scope (extras param, backward-compatible).
3. **CLI**: `hyperagent telemetry` output gains the class/run columns (read side stays honest).
4. **Tests**: validation throw; migration preserves prior rows; real-vs-mock separable by one
   SQL query without meta_notes; unknown-class semantics.
5. **Runtime verify**: scratch DB — two writes through the REAL helper path (one real-class, one
   mock-class) separated by SQL; production ha_telemetry untouched (still 1 row).
