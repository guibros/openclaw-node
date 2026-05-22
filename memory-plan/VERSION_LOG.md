# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

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
