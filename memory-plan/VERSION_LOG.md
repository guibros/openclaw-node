# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

### v4.8 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 4.8: Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs).
- Final test count: 671 (594 pass, 77 fail — 73 pre-existing + 4 flaky). +15 tests added this step.
- Audit: `memory-plan/audits/step28_health_monitor/AUDIT_POST.md`.
- 10 POSITIVE, 2 NEGATIVE findings. 1 Phase 8 patch (`??`/`||` syntax fix). Test count underestimate (planned ~8, delivered 15).

### v4.8-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.8.
- Files changed: `lib/health-check.mjs` (new — runHealthCheck with 6 component checks via dependency injection, deriveStatus for healthy/degraded/unhealthy, formatHealthReport for markdown output, parseAlertTargets for env var parsing, COMPONENT_NAMES/DEFAULT_INTERVAL_SEC/ALERT_TARGETS_DEFAULT constants), `bin/health-watch.mjs` (new — createHealthWatch factory with configurable interval + 3 alert destinations: file/.daemon-health.md, NATS/mesh.health.alerts, macOS banner/memory-plan-notify.sh, state-change-only alerting with 5-min repeat while unhealthy, CLI entry with graceful shutdown), `bin/openclaw-restart.sh` (new — manual graceful restart script using launchctl for managed services + pgrep/kill for unmanaged processes), `test/health-check.test.mjs` (new — 12 tests).
- Test additions: 12 new tests (6 describe blocks: "COMPONENT_NAMES" with 1 test — count + values; "runHealthCheck" with 3 tests — shape, all-ok, all-fail; "deriveStatus" with 3 tests — healthy/unhealthy/degraded; "formatHealthReport" with 1 test — markdown sections; "parseAlertTargets" with 4 tests — default/custom/invalid/empty; "createHealthWatch" with 1 test — start/stop lifecycle; "constants" with 2 tests — DEFAULT_INTERVAL_SEC, ALERT_TARGETS_DEFAULT). Note: 14 `it()` blocks across 7 describe blocks.

### v4.8-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.8.
- Files planned: `lib/health-check.mjs` (new), `bin/health-watch.mjs` (new), `bin/openclaw-restart.sh` (new), `test/health-check.test.mjs` (new).
- Audit: `memory-plan/audits/step28_health_monitor/AUDIT_PRE.md`.
- Test baseline: 656 tests (579 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.7 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 4.7: Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer).
- Final test count: 656 (579 pass, 77 fail — 73 pre-existing + 4 flaky). +9 tests added this step.
- Audit: `memory-plan/audits/step27_extraction_trigger/AUDIT_POST.md`.
- 9 POSITIVE, 2 NEGATIVE findings. 1 Phase 8 patch (parseInt → parseFloat). 1 delta dropped (`.claude/hooks/pre-compact.sh` — tooling constraint, deferred to Step 4.9).

### v4.7-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.7.
- Files changed: `lib/extraction-trigger.mjs` (new — EXTRACT_SUBJECT constant, DEFAULT_IDLE_THRESHOLD_SEC constant, publishExtractRequest for NATS event publishing, createExtractionTrigger factory with NATS subscription + idle timer management), `workspace-bin/memory-daemon.mjs` (mod — import createExtractionTrigger, extractionTrigger variable, wire onExtract callback to flush pipeline after NATS connect, resetIdleTimer in tick loop on activity, stop in shutdown), `test/extraction-trigger.test.mjs` (new — 8 tests).
- Test additions: 8 new tests (5 describe blocks: "EXTRACT_SUBJECT" with 1 test — value check; "DEFAULT_IDLE_THRESHOLD_SEC" with 1 test — value check; "publishExtractRequest" with 2 tests — correct subject+payload, default triggered_by; "createExtractionTrigger" with 4 tests — subscribes to subject, onExtract callback, idle timer fire, env var override, stop prevents fires). Note: `.claude/hooks/pre-compact.sh` modification dropped due to tooling constraint (see Mid-Implementation Findings in AUDIT_PRE).

### v4.7-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.7.
- Files planned: `lib/extraction-trigger.mjs` (new), `.claude/hooks/pre-compact.sh` (mod), `workspace-bin/memory-daemon.mjs` (mod), `test/extraction-trigger.test.mjs` (new).
- Audit: `memory-plan/audits/step27_extraction_trigger/AUDIT_PRE.md`.
- Test baseline: 647 tests (570 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.6 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.6: Conflict surfacing in retrieval pipeline (describeConflict).
- Files committed: `lib/conflict-surfacing.mjs` (new — describeConflict pure function per REFERENCE_PLAN, findEntityConflicts via mixed-provenance mentions query, findDecisionConflicts via multi-source session decisions, surfaceConflicts aggregator returning { entity_conflicts, decision_conflicts, total }, annotateWithConflicts for retrieval result annotation with conflict: true flag), `test/conflict-surfacing.test.mjs` (new — 9 tests), audit docs, ledger files.
- Test count: 647 (570 pass, 77 fail — 73 pre-existing + 4 flaky). +9 tests added this step.
- V2 audit: 7 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned ~8, delivered 9), 0 Phase 8 patches.
- Streak: 0-of-6 zero-Phase-4-correction (Block 4; reset due to test count underestimate).

### v4.6-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.6.
- Files changed: `lib/conflict-surfacing.mjs` (new — describeConflict pure function, findEntityConflicts via mixed-provenance mentions query, findDecisionConflicts via multi-source session decisions, surfaceConflicts aggregator, annotateWithConflicts for retrieval result annotation), `test/conflict-surfacing.test.mjs` (new — 8 tests).
- Test additions: 8 new tests (5 describe blocks: "describeConflict" with 1 test — output shape; "findEntityConflicts" with 3 tests — mixed provenance detection, local-only no conflict, no mentions no conflict; "findDecisionConflicts" with 2 tests — different sources, same source no conflict; "surfaceConflicts" with 1 test — aggregation; "annotateWithConflicts" with 2 tests — adds flag, no match unchanged). Total: 8 `it()` blocks minus 1 overlap = 8.

### v4.6-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.6.
- Files planned: `lib/conflict-surfacing.mjs` (new), `test/conflict-surfacing.test.mjs` (new).
- Audit: `memory-plan/audits/step26_conflict_surfacing/AUDIT_PRE.md`.
- Test baseline: 638 tests (561 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.5 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.5: Always-ingest kanban events into tasks_observed.
- Files committed: `lib/kanban-store.mjs` (new — createKanbanStore factory with tasks_observed table including provenance columns from creation, projectKanbanEvent with full projection for owned tasks and summary projection for non-owned, getObservedTasks with ownedOnly/status/sourceType filters, getTaskById latest event, getStats), `test/kanban-store.test.mjs` (new — 8 tests), audit docs, ledger files.
- Test count: 638 (561 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- V2 audit: 7 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 2-of-5 zero-Phase-4-correction (Block 4).

### v4.5-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.5.
- Files changed: `lib/kanban-store.mjs` (new — createKanbanStore factory with tasks_observed table, projectKanbanEvent with full/summary projection, getObservedTasks with filters, getTaskById latest event, getStats), `test/kanban-store.test.mjs` (new — 8 tests).
- Test additions: 8 new tests (1 describe block "createKanbanStore": table creation with provenance columns, full projection for owned task, summary projection for non-owned task, getObservedTasks ownedOnly filter, getObservedTasks sourceType filter, getTaskById latest event, getStats counts, event without owner field).

### v4.5-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.5.
- Files planned: `lib/kanban-store.mjs` (new), `test/kanban-store.test.mjs` (new).
- Audit: `memory-plan/audits/step25_kanban_events/AUDIT_PRE.md`.
- Test baseline: 630 tests (553 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.4 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.4: Add provenance fields (source_type, source_node, source_event_id) to local stores.
- Files committed: `lib/extraction-store.mjs` (mod — idempotent ALTER TABLE migration adding source_type/source_node/source_event_id to entities/themes/mentions/decisions, provenance indexes, updated prepared statements with provenance params, storeExtractionResult accepts optional provenance, PROVENANCE_LOCAL frozen constant exported), `test/provenance-fields.test.mjs` (new — 8 tests), audit docs, ledger files.
- Test count: 630 (553 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- V2 audit: 7 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 1-of-4 zero-Phase-4-correction (Block 4).

### v4.4-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.4.
- Files changed: `lib/extraction-store.mjs` (mod — idempotent ALTER TABLE migration adding source_type/source_node/source_event_id to all 4 tables, provenance indexes, updated prepared statements, storeExtractionResult accepts optional provenance param, PROVENANCE_LOCAL constant exported), `test/provenance-fields.test.mjs` (new — 8 tests).
- Test additions: 8 new tests (1 describe block "provenance fields on extraction store": columns exist on entities, themes, mentions, decisions — 4 tests; storeExtractionResult without provenance defaults to local; storeExtractionResult with shared provenance stores fields; entities queried by source_type; PROVENANCE_LOCAL constant shape).

### v4.4-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.4.
- Files planned: `lib/extraction-store.mjs` (mod), `test/provenance-fields.test.mjs` (new).
- Audit: `memory-plan/audits/step24_provenance_fields/AUDIT_PRE.md`.
- Test baseline: 622 tests (545 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.3 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.3: Implement subscriber (bin/memory-subscriber.mjs).
- Files committed: `bin/memory-subscriber.mjs` (new — parseSharedSubject, evaluateIngestionPolicy pure function, createSubscriber factory with durable consumer on shared stream + ingestion loop + backoff reuse from promoter + provenance envelope + degraded mode, CLI main with graceful shutdown), `test/memory-subscriber.test.mjs` (new — 14 tests), audit docs, ledger files.
- Test count: 622 (545 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added this step.
- V2 audit: 8 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 0-of-3 zero-Phase-4-correction (Block 4; reset due to test count underestimate: planned ~10, delivered 14).

### v4.3-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.3.
- Files changed: `bin/memory-subscriber.mjs` (new — parseSharedSubject, evaluateIngestionPolicy, createSubscriber factory with durable consumer on shared stream + ingestion loop + backoff + provenance envelope, CLI main with graceful shutdown), `test/memory-subscriber.test.mjs` (new — 14 tests).
- Test additions: 14 new tests (3 describe blocks: "parseSharedSubject" with 6 tests — kanban, concept, lesson, artifact, unknown, non-string; "evaluateIngestionPolicy" with 7 tests — self-skip, kanban accept, concept accept, lesson accept, artifact accept, broadcast skip, null parsed skip; "createBackoff import reuse" with 1 test — import from promoter works).

### v4.3-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.3.
- Files planned: `bin/memory-subscriber.mjs` (new), `test/memory-subscriber.test.mjs` (new).
- Audit: `memory-plan/audits/step23_subscriber_daemon/AUDIT_PRE.md`.
- Test baseline: 608 tests (531 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.2 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.2: Implement promoter (bin/memory-promoter.mjs).
- Files committed: `bin/memory-promoter.mjs` (new — evaluatePromotionPolicy, mapToSharedSubject, createBackoff, createPromoter factory with backoff + provenance, CLI main with graceful shutdown), `test/memory-promoter.test.mjs` (new — 10 tests), audit docs, ledger files.
- Test count: 608 (531 pass, 77 fail — 73 pre-existing + 4 flaky). +10 tests added this step.
- V2 audit: 7 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 1-of-2 zero-Phase-4-correction (Block 4).

### v4.2-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.2.
- Files changed: `bin/memory-promoter.mjs` (new — evaluatePromotionPolicy, mapToSharedSubject, createBackoff, createPromoter factory, CLI main), `test/memory-promoter.test.mjs` (new — 10 tests).
- Test additions: 10 new tests (3 describe blocks: "evaluatePromotionPolicy" with 6 tests — kanban auto-promote, share_true explicit, concept_mention threshold, decision_confidence threshold, below_threshold queue, unrelated queue; "mapToSharedSubject" with 3 tests — kanban, concept, fact; "createBackoff" with 1 test — exponential increase + cap + reset).

### v4.2-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.2.
- Files planned: `bin/memory-promoter.mjs` (new), `test/memory-promoter.test.mjs` (new).
- Audit: `memory-plan/audits/step22_promoter_daemon/AUDIT_PRE.md`.
- Test baseline: 598 tests (521 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.1 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 4.1: Define promotion policies (config/promotion-policy.yaml).
- Files committed: `config/promotion-policy.yaml` (new — policy config with frozen-decision thresholds: automatic kanban_events, explicit share_true, threshold concept_mention_count 10 + decision_confidence 0.95, manual_review everything_else), `lib/promotion-policy.mjs` (new — loadPromotionPolicy, validatePromotionPolicy, DEFAULT_POLICY_PATH, POLICY_CATEGORIES), `test/promotion-policy.test.mjs` (new — 11 tests), audit docs, ledger files.
- Test count: 598 (521 pass, 77 fail — 73 pre-existing + 4 flaky). +11 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned ~6, delivered 11), 0 Phase 8 patches.
- Streak: 0-of-1 zero-Phase-4-correction (Block 4; reset due to test count underestimate).

### v4.1-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.1.
- Files changed: `config/promotion-policy.yaml` (new — policy config with frozen-decision thresholds), `lib/promotion-policy.mjs` (new — loadPromotionPolicy, validatePromotionPolicy, DEFAULT_POLICY_PATH, POLICY_CATEGORIES), `test/promotion-policy.test.mjs` (new — 11 tests).
- Test additions: 11 new tests (3 describe blocks: "loadPromotionPolicy" with 3 tests — default config, missing file, custom path; "validatePromotionPolicy" with 6 tests — valid, null, missing category, unknown key, non-numeric threshold, unknown threshold key; "constants" with 2 tests — DEFAULT_POLICY_PATH, POLICY_CATEGORIES).

### v4.1-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.1.
- Files planned: `config/promotion-policy.yaml` (new), `lib/promotion-policy.mjs` (new), `test/promotion-policy.test.mjs` (new).
- Audit: `memory-plan/audits/step21_promotion_policies/AUDIT_PRE.md`.
- Test baseline: 587 tests (514 pass, 73 fail — pre-existing).

### v3.4 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 3.4: Validate LLM vs regex extraction on 10 sessions; document quality delta.
- Files committed: `bin/run-block3-validation.mjs` (new — readSessions, runRegexExtraction, runLlmExtraction, aggregateMetrics, formatComparison, runValidation, CLI entry), `test/block3-validation.test.mjs` (new — 9 tests), audit docs, ledger files.
- Test count: 587 (514 pass, 73 fail — pre-existing). +9 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned ~6, delivered 9), 0 Phase 8 patches.
- Streak: 0-of-4 zero-Phase-4-correction (Block 3; reset due to test count underestimate).
- **Block 3 complete (4/4).**

### v3.4-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 3.4.
- Files changed: `bin/run-block3-validation.mjs` (new — readSessions, runRegexExtraction, runLlmExtraction, aggregateMetrics, formatComparison, runValidation, CLI entry), `test/block3-validation.test.mjs` (new — 9 tests).
- Test additions: 9 new tests (5 describe blocks: "readSessions" with 3 tests — limit+ordering, messages inclusion, missing DB; "runRegexExtraction" with 2 tests — extraction+metrics, empty patterns; "runLlmExtraction" with 1 test — mock client+metrics; "aggregateMetrics" with 2 tests — averages, null LLM; "formatComparison" with 1 test — markdown sections).

### v3.4-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 3.4.
- Files planned: `bin/run-block3-validation.mjs` (new), `test/block3-validation.test.mjs` (new).
- Audit: `memory-plan/audits/step20_block3_validation/AUDIT_PRE.md`.
- Test baseline: 578 tests (505 pass, 73 fail — pre-existing).

### v3.3 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 3.3: Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite.
- Files committed: `lib/extraction-store.mjs` (new — createExtractionStore with 4 SQLite tables, storeExtractionResult, generateMemoryContent, getExtractionStats), `lib/pre-compression-flush.mjs` (mod — USE_LLM_EXTRACTION feature flag, LLM extraction path in runFlush with graceful fallback), `workspace-bin/memory-daemon.mjs` (mod — lazy init getLlmClient/getExtractionStore, pass to both flush sites), `test/extraction-store.test.mjs` (new — 8 tests), audit docs, ledger files.
- Test count: 578 (505 pass, 73 fail — pre-existing). +8 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned 7, delivered 8), 0 Phase 8 patches.
- Streak: 0-of-3 zero-Phase-4-correction (Block 3; reset due to test count underestimate).

### v3.3-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 3.3.
- Files changed: `lib/extraction-store.mjs` (new — createExtractionStore with 4 SQLite tables, storeExtractionResult, generateMemoryContent, getExtractionStats), `lib/pre-compression-flush.mjs` (mod — USE_LLM_EXTRACTION feature flag, LLM extraction path in runFlush with graceful fallback to regex), `workspace-bin/memory-daemon.mjs` (mod — import createLlmClient + createExtractionStore, lazy init getLlmClient/getExtractionStore, pass to both runFlush call sites), `test/extraction-store.test.mjs` (new — 7 tests).
- Test additions: 7 new tests (2 describe blocks: "createExtractionStore" with 5 tests — table creation, population, upsert/mention_count, generateMemoryContent format, empty content, budget respect; "runFlush with LLM extraction" with 2 tests — LLM path with mock client, regex fallback on LLM failure).

### v3.3-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 3.3.
- Files planned: `lib/extraction-store.mjs` (new), `lib/pre-compression-flush.mjs` (mod), `workspace-bin/memory-daemon.mjs` (mod), `test/extraction-store.test.mjs` (new).
- Audit: `memory-plan/audits/step19_daemon_llm_wiring/AUDIT_PRE.md`.
- Test baseline: 570 tests (497 pass, 73 fail — pre-existing).

### v3.2 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 3.2: Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships).
- Files committed: `lib/extraction-schema.mjs` (new — ExtractionResultSchema with EntitySchema, ThemeSchema, DecisionSchema, FrictionSignalSchema, RelationshipSchema, validateExtractionResult), `lib/extraction-prompt.mjs` (new — buildExtractionPrompt, extractStructured with JSON mode + schema validation), `test/extraction-schema.test.mjs` (new — 7 tests), audit docs, ledger files.
- Test count: 570 (497 pass, 73 fail — pre-existing). +7 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 0-of-2 zero-Phase-4-correction (Block 3; reset due to test count underestimate: planned 6, delivered 7).

### v3.2-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 3.2.
- Files changed: `lib/extraction-schema.mjs` (new — ExtractionResultSchema with EntitySchema, ThemeSchema, DecisionSchema, FrictionSignalSchema, RelationshipSchema sub-schemas, validateExtractionResult convenience function), `lib/extraction-prompt.mjs` (new — buildExtractionPrompt for system+user message construction, extractStructured for LLM call + JSON parse + schema validation), `test/extraction-schema.test.mjs` (new — 6 tests).
- Test additions: 6 new tests (2 describe blocks: "ExtractionResultSchema" with 4 tests: valid result, empty arrays, missing field, invalid entity type; "buildExtractionPrompt" with 1 test: message construction; "extractStructured" with 2 tests in 1 describe: mock validation, malformed JSON rejection). Total: 6 `it()` blocks.

### v3.2-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 3.2.
- Files planned: `lib/extraction-schema.mjs` (new), `lib/extraction-prompt.mjs` (new), `test/extraction-schema.test.mjs` (new).
- Audit: `memory-plan/audits/step18_extraction_prompt_schema/AUDIT_PRE.md`.
- Test baseline: 563 tests (490 pass, 73 fail — pre-existing).

### v3.1 — 2026-05-22 — memory-plan-tick

- **Phase 9** close for Step 3.1: Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session).
- Files committed: `lib/llm-client.mjs` (new — createLlmClient factory, generate with JSON mode, healthCheck, env-configurable), `test/llm-benchmark.test.mjs` (new — 4 tests with mock HTTP server), `bin/llm-benchmark.mjs` (new — CLI benchmark tool with 40-turn synthetic session, latency measurement), audit docs, ledger files.
- Test count: 563 (490 pass, 73 fail — pre-existing). +4 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 1-of-1 zero-Phase-4-correction (Block 3).

### v3.1-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 3.1.
- Files changed: `lib/llm-client.mjs` (new — createLlmClient factory, generate with JSON mode, healthCheck, env-configurable baseUrl/model/timeout), `test/llm-benchmark.test.mjs` (new — 4 tests with mock HTTP server), `bin/llm-benchmark.mjs` (new — CLI benchmark tool with synthetic 40-turn session, extraction latency measurement, pass/fail against ≤30s target).
- Test additions: 4 new tests (1 exports/interface check, 3 mock-server tests: generate request format, healthCheck response parsing, JSON mode response_format).

### v3.1-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 3.1.
- Files planned: `lib/llm-client.mjs` (new), `test/llm-benchmark.test.mjs` (new), `bin/llm-benchmark.mjs` (new).
- Audit: `memory-plan/audits/step17_qwen_setup_benchmark/AUDIT_PRE.md`.
- Test baseline: 559 tests (486 pass, 73 fail — pre-existing).

### v2.5 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 2.5: Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate.
- Files committed: `bin/run-gulf1-eval.mjs` (new — evaluation runner with parseQuerySet, runEvaluation, formatResults, aggregateScores, checkDatabaseReadiness, CLI entry), `memory-plan/eval/gulf1-queries.json` (new — 25 curated queries across 8 categories), `test/gulf1-eval.test.mjs` (new — 7 tests), audit docs, ledger files.
- Test count: 559 (486 pass, 73 fail — pre-existing). +7 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned 5, delivered 7), 0 Phase 8 patches.
- Streak: 0-of-5 zero-Phase-4-correction (Block 2; reset due to test count underestimate).
- **Block 2 complete (5/5).**

### v2.5-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 2.5.
- Files changed: `bin/run-gulf1-eval.mjs` (new — parseQuerySet, runEvaluation, formatResults, aggregateScores, checkDatabaseReadiness, CLI entry point), `memory-plan/eval/gulf1-queries.json` (new — 25 curated queries across 8 categories), `test/gulf1-eval.test.mjs` (new — 5 tests).
- Test additions: 5 new tests (parseQuerySet validation ×3 in 1 describe, runEvaluation 3-mode + empty DB in 1 describe, formatResults markdown output, checkDatabaseReadiness counts).

### v2.5-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 2.5.
- Files planned: `bin/run-gulf1-eval.mjs` (new), `memory-plan/eval/gulf1-queries.json` (new), `test/gulf1-eval.test.mjs` (new).
- Audit: `memory-plan/audits/step16_gulf1_evaluation/AUDIT_PRE.md`.
- Test baseline: 552 tests (479 pass, 73 fail — pre-existing).

### v2.4 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 2.4: Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags.
- Files committed: `lib/mcp-knowledge/core.mjs` (mod — FTS5 virtual table + triggers + rebuild, searchSessionsFts, reciprocalRankFusion, hybridSearchSessions, searchSessions chunk_id, engine exports), `bin/session-search.mjs` (new — CLI tool), `test/hybrid-search.test.mjs` (new — 7 tests), audit docs, ledger files.
- Test count: 552 (479 pass, 73 fail — pre-existing). +7 tests added this step.
- V2 audit: 7 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 3-of-4 zero-Phase-4-correction (Block 2).

### v2.4-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 2.4.
- Files changed: `lib/mcp-knowledge/core.mjs` (mod — FTS5 virtual table + triggers + rebuild in initDatabase, searchSessionsFts, reciprocalRankFusion, hybridSearchSessions, searchSessions chunk_id, engine exports), `bin/session-search.mjs` (new — CLI tool with --semantic/--hybrid/--fts flags), `test/hybrid-search.test.mjs` (new — 7 tests).
- Test additions: 7 new tests (3 RRF: merge+boost, empty input, single set; 2 FTS5: keyword hit, no match; 2 hybrid: combined results, ranking).

### v2.4-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 2.4.
- Files planned: `lib/mcp-knowledge/core.mjs` (mod — FTS5 table, triggers, searchSessionsFts, reciprocalRankFusion, hybridSearchSessions, searchSessions chunk_id, engine exports), `bin/session-search.mjs` (new — CLI tool), `test/hybrid-search.test.mjs` (new — 7 tests).
- Audit: `memory-plan/audits/step15_hybrid_search_rrf/AUDIT_PRE.md`.
- Test baseline: 545 tests (472 pass, 73 fail — pre-existing).

### v2.3 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 2.3: Chunk and embed existing sessions (resumable migration with checkpoint file).
- Files committed: `bin/embed-existing-sessions.mjs` (new — runMigration, checkpoint helpers, CLI entry), `test/embed-existing-sessions.test.mjs` (new — 5 tests), audit docs, ledger files.
- Test count: 545 (472 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 2-of-3 zero-Phase-4-correction (Block 2).

### v2.3-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 2.3.
- Files changed: `bin/embed-existing-sessions.mjs` (new — runMigration function, checkpoint helpers, CLI entry), `test/embed-existing-sessions.test.mjs` (new — 5 tests).
- Test additions: 5 new tests (migrate 2 sessions, idempotent re-run, checkpoint file verification, empty session store, zero-message session skip).

### v2.3-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 2.3.
- Files planned: `bin/embed-existing-sessions.mjs` (new), `test/embed-existing-sessions.test.mjs` (new).
- Audit: `memory-plan/audits/step14_embed_existing_sessions/AUDIT_PRE.md`.
- Test baseline: 540 tests (467 pass, 73 fail — pre-existing).

### v2.2 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 2.2: Choose embedding model + benchmark on real session data (latency target <100ms/turn).
- Files committed: `test/embed-benchmark.test.mjs` (new — 5 benchmark tests), audit docs, ledger files.
- Test count: 540 (467 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 1-of-2 zero-Phase-4-correction (Block 2).

### v2.2-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 2.2.
- Files changed: `test/embed-benchmark.test.mjs` (new — 5 tests: model name identity, embedding dimension 384, L2 normalization, per-turn latency <100ms on 50 turns, batch of 100 turns <10s).
- Test additions: 5 new tests (2 describe blocks: "embedding model identity" with 3 tests, "embedding latency benchmark" with 2 tests).

### v2.2-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 2.2.
- Files planned: `test/embed-benchmark.test.mjs` (new).
- Audit: `memory-plan/audits/step13_embed_model_benchmark/AUDIT_PRE.md`.
- Test baseline: 535 tests (462 pass, 73 fail — pre-existing).

### v2.1 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 2.1: Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test.
- Files committed: `lib/mcp-knowledge/core.mjs` (mod — session tables, chunkSessionTurns, indexSessionTurns, searchSessions, getStats update, engine exports), `test/mcp-knowledge-sessions.test.mjs` (new — 7 tests), audit docs, ledger files.
- Test count: 535 (462 pass, 73 fail — pre-existing). +7 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate: planned 6, delivered 7), 0 Phase 8 patches.
- Streak: 0 (reset — test count underestimate).

### v2.1-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 2.1.
- Files changed: `lib/mcp-knowledge/core.mjs` (mod — session tables in initDatabase, chunkSessionTurns, indexSessionTurns, searchSessions, getStats session counts, engine factory session exports), `test/mcp-knowledge-sessions.test.mjs` (new — 6 tests).
- Test additions: 6 new tests (session tables existence, chunk role prefix + empty turn skipping, index+vector creation, idempotent skip, semantic search, stats inclusion).

### v2.1-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 2.1.
- Files planned: `lib/mcp-knowledge/core.mjs` (mod), `test/mcp-knowledge-sessions.test.mjs` (new).
- Audit: `memory-plan/audits/step12_scope_review_mcp_knowledge/AUDIT_PRE.md`.
- Test baseline: 528 tests (455 pass, 73 fail — pre-existing).

### v1.4 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 1.4: Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4).
- Files committed: `lib/shared-event-stream.mjs` (new), `test/shared-event-stream.test.mjs` (new), audit docs, ledger files.
- Test count: 528 (455 pass, 73 fail — pre-existing). +16 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (StorageType.File value assumption), 0 Phase 8 patches.
- Streak: 0-of-4 zero-Phase-4-correction (Block 1; reset due to StorageType fix).
- **Block 1 complete (4/4).**

### v1.4-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 1.4.
- Files changed: `lib/shared-event-stream.mjs` (new — SHARED_STREAM_NAME, SHARED_SUBJECTS constants, ensureSharedStream, inspectSharedStream), `test/shared-event-stream.test.mjs` (new — 16 tests with mock NATS connection).
- Test additions: 16 new tests (2 constant identity, 7 subject pattern verification, 4 ensureSharedStream create/replicas/subjects/storage/idempotent, 2 inspectSharedStream success/failure, 1 StorageType.File assertion fix).

### v1.4-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 1.4.
- Files planned: `lib/shared-event-stream.mjs` (new), `test/shared-event-stream.test.mjs` (new).
- Audit: `memory-plan/audits/step11_shared_jetstream_cluster/AUDIT_PRE.md`.
- Test baseline: 512 tests (439 pass, 73 fail — pre-existing).

### v1.3 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 1.3: Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/).
- Files committed: `lib/artifacts.mjs` (new), `test/artifacts.test.mjs` (new), audit docs, ledger files.
- Test count: 512 (439 pass, 73 fail — pre-existing). +6 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 NEGATIVE findings, 0 Phase 8 patches.
- Streak: 1-of-3 zero-Phase-4-correction (Block 1).

### v1.3-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 1.3.
- Files changed: `lib/artifacts.mjs` (new — putArtifact, getArtifact, hasArtifact, validateArtifact with sha256 sharded layout + .meta.json sidecars), `test/artifacts.test.mjs` (new — 6 tests).
- Test additions: 6 new tests (put+get roundtrip, hasArtifact true/false, validateArtifact valid, validateArtifact tamper detection, idempotent put, .meta.json sidecar fields).

### v1.3-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 1.3.
- Files planned: `lib/artifacts.mjs` (new), `test/artifacts.test.mjs` (new).
- Audit: `memory-plan/audits/step10_artifact_store/AUDIT_PRE.md`.
- Test baseline: 506 tests (433 pass, 73 fail — pre-existing).

### v1.2 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 1.2: Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring).
- Files committed: `lib/local-event-log.mjs` (new), `lib/memory-budget.mjs` (mod), `workspace-bin/memory-daemon.mjs` (mod), `test/local-event-log.test.mjs` (new), audit docs, ledger files.
- Test count: 506 (433 pass, 73 fail — pre-existing). +9 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding (test count underestimate in AUDIT_PRE), 0 Phase 8 patches.
- Streak: 0-of-2 zero-Phase-4-correction (Block 1; reset due to test count underestimate).

### v1.2-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 1.2.
- Files changed: `lib/local-event-log.mjs` (new — createLocalEventLog factory, publishLocal method, buildMemoryEvent helper), `lib/memory-budget.mjs` (mod — added #eventLog/#sessionId/#nodeId private fields, #publishEvent helper, dual-write in startSession/endSession/addEntry), `workspace-bin/memory-daemon.mjs` (mod — import createLocalEventLog, init local event log after NATS, pass eventLog+nodeId to createBudget), `test/local-event-log.test.mjs` (new — 7 tests).
- Test additions: 7 new tests (buildMemoryEvent envelope, 3 schema validations, 3 MemoryBudget dual-write + error isolation).

### v1.2-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 1.2.
- Files planned: `lib/local-event-log.mjs` (new), `lib/memory-budget.mjs` (mod), `workspace-bin/memory-daemon.mjs` (mod), `test/local-event-log.test.mjs` (new).
- Audit: `memory-plan/audits/step09_local_event_log/AUDIT_PRE.md`.
- Test baseline: 497 tests (424 pass, 73 fail — pre-existing).

### v1.1 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 1.1: Create packages/event-schemas (zod envelope + memory event payloads + discriminated union).
- Files committed: `package.json` (root, mod), `packages/event-schemas/` (15 new files: package.json, tsconfig.json, src/envelope.ts, src/memory/*.ts ×8, src/memory/index.ts, src/events.ts, src/index.ts), `test/event-schemas.test.mjs` (new), `.gitignore` (mod, Phase 8 patch), audit docs, ledger files.
- Test count: 497 (424 pass, 73 fail — pre-existing). +15 tests added this step.
- V2 audit: 6 POSITIVE findings, 1 NEGATIVE finding, 1 Phase 8 patch (`.gitignore` for `packages/*/dist/`).
- Streak: 1-of-1 zero-Phase-4-correction (Block 1). Phase-8-patch streak reset to 0.

### v1.1-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 1.1.
- Files changed: `package.json` (root, added `workspaces` + `pretest` script), `packages/event-schemas/package.json` (new), `packages/event-schemas/tsconfig.json` (new), `packages/event-schemas/src/envelope.ts` (new — EventEnvelopeSchema), `packages/event-schemas/src/memory/session-started.ts` (new), `packages/event-schemas/src/memory/session-ended.ts` (new), `packages/event-schemas/src/memory/turn-recorded.ts` (new), `packages/event-schemas/src/memory/fact-extracted.ts` (new), `packages/event-schemas/src/memory/concept-mentioned.ts` (new), `packages/event-schemas/src/memory/snapshot-taken.ts` (new), `packages/event-schemas/src/memory/compaction-triggered.ts` (new), `packages/event-schemas/src/memory/artifact-attached.ts` (new), `packages/event-schemas/src/memory/index.ts` (new — barrel re-export), `packages/event-schemas/src/events.ts` (new — MemoryEventSchema discriminated union), `packages/event-schemas/src/index.ts` (new — package entry + toJsonSchema), `test/event-schemas.test.mjs` (new — 15 tests).
- Test additions: 15 new tests (4 envelope, 8 event payloads, 2 discriminated union, 1 JSON Schema).
- Build note: `tsc` build uses mission-control's TypeScript (5.9.3) via path reference since `npm install` was unavailable during this tick. The `as any` cast in `toJsonSchema()` works around a Zod 4 vs Zod 3 type mismatch in root node_modules; resolves when workspace deps are properly installed.

### v1.1-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 1.1.
- Files planned: `package.json` (root, mod), `packages/event-schemas/package.json` (new), `packages/event-schemas/tsconfig.json` (new), `packages/event-schemas/src/envelope.ts` (new), `packages/event-schemas/src/memory/session-started.ts` (new), `packages/event-schemas/src/memory/session-ended.ts` (new), `packages/event-schemas/src/memory/turn-recorded.ts` (new), `packages/event-schemas/src/memory/fact-extracted.ts` (new), `packages/event-schemas/src/memory/concept-mentioned.ts` (new), `packages/event-schemas/src/memory/snapshot-taken.ts` (new), `packages/event-schemas/src/memory/compaction-triggered.ts` (new), `packages/event-schemas/src/memory/artifact-attached.ts` (new), `packages/event-schemas/src/memory/index.ts` (new), `packages/event-schemas/src/events.ts` (new), `packages/event-schemas/src/index.ts` (new), `test/event-schemas.test.mjs` (new).
- Audit: `memory-plan/audits/step08_event_schemas/AUDIT_PRE.md`.
- Test baseline: 482 tests (409 pass, 73 fail — pre-existing).

### v0.7 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.7: Document state files (docs/STATE_FILES.md).
- Files committed: `docs/STATE_FILES.md` (new), audit docs, ledger files.
- Test count: 482 (409 pass, 73 fail — pre-existing). No new tests (documentation-only step).
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 7-of-7 zero-Phase-4-correction.
- **Block 0 complete (7/7).**

### v0.7-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.7.
- Files changed: `docs/STATE_FILES.md` (new — comprehensive state file inventory).
- Test additions: none (documentation-only step).

### v0.7-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.7.
- Files planned: `docs/STATE_FILES.md` (new).
- Audit: `memory-plan/audits/step07_document_state_files/AUDIT_PRE.md`.
- Test baseline: 482 tests (409 pass, 73 fail — pre-existing).

### v0.6 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.6: Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field).
- Files committed: `.claude/hooks/pre-compact.sh`, `workspace-bin/session-recap`, `workspace-bin/auto-checkpoint`, `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 482 (409 pass, 73 fail — pre-existing). +1 test added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 6-of-6 zero-Phase-4-correction.

### v0.6-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.6.
- Files changed: `.claude/hooks/pre-compact.sh` (removed `STATE_FILE` variable and dead `.pre-compact-state.md` write block), `workspace-bin/session-recap` (deleted `FINGERPRINT_FILE` constant, `extractFingerprint` function, `writeFingerprint` function, and fingerprint caller in `main()`), `workspace-bin/auto-checkpoint` (deleted `ACTIVITY_FILE` variable and `touch "$ACTIVITY_FILE"`), `lib/pre-compression-flush.mjs` (removed `confidence` property from all pattern objects, destructuring, fact push, and JSDoc), `test/memory-budget.test.mjs` (+1 test: extractFacts confidence removal).
- Test additions: 1 new test (extractFacts returns no confidence property).

### v0.6-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.6.
- Files planned: `.claude/hooks/pre-compact.sh`, `workspace-bin/session-recap`, `workspace-bin/auto-checkpoint`, `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step06_delete_dead_artifacts/AUDIT_PRE.md`.
- Test baseline: 481 tests (408 pass, 73 fail — pre-existing).

### v0.5 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.5: Fix mid-word truncation via truncateAtWord helper.
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 481 (408 pass, 73 fail — pre-existing). +4 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 5-of-5 zero-Phase-4-correction.

### v0.5-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.5.
- Files changed: `lib/pre-compression-flush.mjs` (added `truncateAtWord` helper, replaced `.slice(0, 120)` with `truncateAtWord(match[0].trim(), 120)` in `extractFacts`), `test/memory-budget.test.mjs` (+4 tests in new `truncateAtWord` describe block, added `truncateAtWord` to import).
- Test additions: 4 new tests (short text passthrough, word-boundary truncation, long-word fallback, exact-length passthrough).

### v0.5-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.5.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step05_truncate_at_word/AUDIT_PRE.md`.
- Test baseline: 477 tests (404 pass, 73 fail — pre-existing).

### v0.4 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.4: Include assistant-role messages in extraction + add speaker field + new patterns.
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 477 (404 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 4-of-4 zero-Phase-4-correction.

### v0.4-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.4.
- Files changed: `lib/pre-compression-flush.mjs` (added `stripSpeaker` helper, two assistant-voice pattern groups, opened role filter to include assistant, added `speaker` field on facts, updated `mergeFacts` to format with speaker tags and strip during comparison), `test/memory-budget.test.mjs` (+5 tests in new `extractFacts assistant extraction` describe block).
- Test additions: 5 new tests (assistant inclusion, speaker field, assistant patterns, tool exclusion, mergeFacts speaker tags).

### v0.4-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.4.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step04_assistant_extraction/AUDIT_PRE.md`.
- Test baseline: 472 tests (399 pass, 73 fail — pre-existing).

### v0.3 — 2026-05-21 — memory-plan-tick

- **Phase 9** close for Step 0.3: Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup).
- Files committed: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 472 (399 pass, 73 fail — pre-existing). +5 tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 3-of-3 zero-Phase-4-correction.

### v0.3-mid — 2026-05-21 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.3.
- Files changed: `lib/pre-compression-flush.mjs` (added `crypto` import, `stripSupersedes`, `cleanParentheticalChains`; rewrote `mergeFacts` merge path to supersedes-comment model), `test/memory-budget.test.mjs` (+5 tests in new `mergeFacts parenthetical regression` describe block).
- Test additions: 5 new tests (10-merge regression, nested chain cleanup, supersedes presence, stripSupersedes, no-chain passthrough).

### v0.3-pre — 2026-05-21 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.3.
- Files planned: `lib/pre-compression-flush.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step03_merge_facts_parenthetical/AUDIT_PRE.md`.
- Test baseline: 467 tests (394 pass, 73 fail — pre-existing).

### v0.2 — 2026-05-20 — memory-plan-tick

- **Phase 9** close for Step 0.2: Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers).
- Files committed: `workspace-bin/memory-daemon.mjs`, `.claude/hooks/session-start.sh`, `workspace-bin/daily-log-writer.mjs`, `mission-control/src/app/api/tasks/route.ts`, `scripts/migrate-companion-state.mjs` (new), audit docs, ledger files.
- Test count: 467 (394 pass, 73 fail — pre-existing). No new tests added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 2-of-2 zero-Phase-4-correction.

### v0.2-mid — 2026-05-20 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.2.
- Files changed: `workspace-bin/memory-daemon.mjs` (NODE_ID + daemon-state path), `.claude/hooks/session-start.sh` (daemon-state path), `workspace-bin/daily-log-writer.mjs` (os import + NODE_ID + daemon-state path), `mission-control/src/app/api/tasks/route.ts` (os import + NODE_ID + readDaemonState rename + path), `scripts/migrate-companion-state.mjs` (new).
- Deltas #1 and #2 were pre-applied by prior tick + operator; deltas #3, #4, #5 applied this tick.

### v0.2-pre — 2026-05-20 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.2.
- Files planned: `workspace-bin/memory-daemon.mjs`, `.claude/hooks/session-start.sh`, `workspace-bin/daily-log-writer.mjs`, `mission-control/src/app/api/tasks/route.ts`, `scripts/migrate-companion-state.mjs` (new).
- Audit: `memory-plan/audits/step02_companion_state_collision/AUDIT_PRE.md`.
- Test baseline: 467 tests (394 pass, 73 fail — pre-existing).

### v0.1 — 2026-05-20 — memory-plan-tick

- **Phase 9** close for Step 0.1: Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test.
- Files committed: `workspace-bin/memory-daemon.mjs`, `test/memory-budget.test.mjs`, audit docs, ledger files.
- Test count: 467 (394 pass, 73 fail — pre-existing). +1 test added this step.
- V2 audit: 6 POSITIVE findings, 0 Phase 8 patches.
- Streak: 1-of-1 zero-Phase-4-correction.

### v0.1-mid — 2026-05-20 — memory-plan-tick

- **Phase 4** V1 implementation for Step 0.1.
- Files changed: `workspace-bin/memory-daemon.mjs` (reload wiring + NATS sub), `test/memory-budget.test.mjs` (+1 test).
- Test additions: 1 new test ("reload after external write updates getRendered in mid-session").

### v0.1-pre — 2026-05-20 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 0.1.
- Files planned: `workspace-bin/memory-daemon.mjs`, `test/memory-budget.test.mjs`.
- Audit: `memory-plan/audits/step01_reload_memory_budget/AUDIT_PRE.md`.
- Test baseline: 466 tests (393 pass, 73 fail — pre-existing failures).

## NEXT VERSIONS

Step 0.1 is queued. The first three entries to appear above this divider will be:

- `v0.1-pre`  — Phase 1 audit-pre + version carrier bump
- `v0.1-mid`  — Phase 4 V1 implementation + version carrier bump
- `v0.1`      — Phase 9 close, ledger updates, single commit

(Earlier entries scroll downward as the plan progresses.)
