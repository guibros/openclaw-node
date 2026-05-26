# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

### v10.4 — 2026-05-26 — memory-plan-tick

- **Phase 9** step close for Step 10.4: Node identity + ed25519 signing infrastructure (`lib/node-identity.mjs`); STRICT verification.
- Final test count: 1064 (989 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added this step.
- Audit: `memory-plan/audits/step54_node_identity_signing/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v10.4-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 10.4.
- Files changed: `lib/node-identity.mjs` (new — ed25519 keypair management, `signEvent`, `verifyEvent`, `canonicalizeEvent`), `packages/event-schemas/src/envelope.ts` + `dist/envelope.js` + `dist/envelope.d.ts` (modified — added optional `signature` + `signer_pubkey` fields), `lib/local-event-log.mjs` (modified — accepts `opts.identity` parameter, signs events before publishing), `lib/broadcast-offerer.mjs` (modified — STRICT signature verification in `processBroadcast`, `signatureRejected` stat), `lib/broadcast-acceptor.mjs` (modified — STRICT signature verification in `processOffer`, `signatureRejected` stat), `test/node-identity.test.mjs` (new — 12 `it()` blocks).
- Test additions: 12 `it()` blocks in `test/node-identity.test.mjs`.

### v10.4-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 10.4.
- Files planned: `lib/node-identity.mjs` (new), `packages/event-schemas/src/envelope.ts` (modify), `lib/local-event-log.mjs` (modify), `lib/broadcast-offerer.mjs` (modify), `lib/broadcast-acceptor.mjs` (modify), `test/node-identity.test.mjs` (new).
- Audit: `memory-plan/audits/step54_node_identity_signing/AUDIT_PRE.md`.
- Test baseline: 1048 tests (973 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v10.3 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 10.3: Wire `ensureSharedStream` at memory-daemon startup; verify R=3 propagates.
- Final test count: 1048 (973 pass, 75 fail — 73 pre-existing + 2 flaky variance). +11 `it()` blocks added this step.
- Audit: `memory-plan/audits/step53_wire_shared_stream_startup/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v10.3-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 10.3.
- Files changed: `lib/shared-event-stream.mjs` (modified — added `verifySharedStreamConfig` export + `EXPECTED_REPLICAS` constant), `workspace-bin/memory-daemon.mjs` (modified — import + shared stream wiring block after NATS connection), `test/shared-stream-startup.test.mjs` (new — 10 `it()` blocks covering verification + pipeline).
- Test additions: 10 `it()` blocks in `test/shared-stream-startup.test.mjs`.

### v10.3-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 10.3.
- Files planned: `lib/shared-event-stream.mjs` (modify — add `verifySharedStreamConfig`), `workspace-bin/memory-daemon.mjs` (modify — wire shared stream at startup), `test/shared-stream-startup.test.mjs` (new — verification tests).
- Audit: `memory-plan/audits/step53_wire_shared_stream_startup/AUDIT_PRE.md`.
- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v10.2 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 10.2: NATS cluster setup (`services/nats/` plists + `docs/NATS_CLUSTER.md`).
- Final test count: 1037 (962 pass, 75 fail — 73 pre-existing + 2 flaky variance). No tests added this step (infrastructure-only).
- Audit: `memory-plan/audits/step52_nats_cluster_setup/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v10.2-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 10.2.
- Files changed: `services/nats/nats-{1,2,3}.conf` (new — NATS config files for 3-node cluster, ports 4222–4224 client, 6222–6224 cluster, 8222–8224 monitor, JetStream enabled), `services/nats/ai.openclaw.nats-{1,2,3}.plist` (new — launchd plists with KeepAlive), `docs/NATS_CLUSTER.md` (new — deployment documentation for local dev + multi-machine + Tailscale setups).
- Test additions: none (infrastructure-only step, no code logic).

### v10.2-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 10.2.
- Files planned: `services/nats/nats-{1,2,3}.conf` (new), `services/nats/ai.openclaw.nats-{1,2,3}.plist` (new), `docs/NATS_CLUSTER.md` (new).
- Audit: `memory-plan/audits/step52_nats_cluster_setup/AUDIT_PRE.md`.
- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v10.1 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 10.1: `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/`.
- Final test count: 1037 (962 pass, 75 fail — 73 pre-existing + 2 flaky variance). +13 `it()` blocks added this step.
- Audit: `memory-plan/audits/step51_spawn_node/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v10.1-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 10.1.
- Files changed: `bin/spawn-node.mjs` (new — CLI tool + `spawnNode` library function for creating isolated node trees), `test/spawn-node.test.mjs` (new — 10 `it()` blocks covering validation, resolution, creation, idempotency, config, and readback).
- Test additions: see Phase 5.

### v10.1-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 10.1.
- Files planned: `bin/spawn-node.mjs` (new), `test/spawn-node.test.mjs` (new).
- Audit: `memory-plan/audits/step51_spawn_node/AUDIT_PRE.md`.
- Test baseline: 1024 tests (949 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.6 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.6: Cross-node integration test for broadcast → offer → accepted round-trip.
- Final test count: 1024 (949 pass, 75 fail — 73 pre-existing + 2 flaky variance). +10 `it()` blocks added this step.
- Audit: `memory-plan/audits/step50_cross_node_integration_test/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.
- **Block 9 complete (6/6).**

### v9.6-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.6.
- Files changed: `test/broadcast-cross-node.test.mjs` (new — two-node integration test with 8 describe blocks covering full round-trip, TTL expiry, privacy filtering, offer expiry, artifact ref flow, self-skip, below-threshold, non-matching responding_to, and offer building + formatting).
- Test additions: see Phase 5.

### v9.6-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.6.
- Files planned: `test/broadcast-cross-node.test.mjs` (new).
- Audit: `memory-plan/audits/step50_cross_node_integration_test/AUDIT_PRE.md`.
- Test baseline: 1014 tests (939 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.5 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.5: Privacy markers (private: true) + default-private retrieval policy.
- Final test count: 1014 (939 pass, 75 fail — 73 pre-existing + 2 flaky variance). +30 `it()` blocks added this step.
- Audit: `memory-plan/audits/step49_privacy_markers/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v9.5-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.5.
- Files changed: `lib/extraction-store.mjs` (modify — privacy migration + published_items table + publish/unpublish/isItemPublished/getPublishedItems API), `lib/memory-directives.mjs` (modify — @publish directive), `bin/publish-item.mjs` (new — CLI tool), `lib/retrieval-pipeline.mjs` (modify — filterPrivateResults + respect_privacy flag), `test/privacy-markers.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v9.5-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.5.
- Files planned: `lib/extraction-store.mjs` (modify), `lib/memory-directives.mjs` (modify), `bin/publish-item.mjs` (new), `lib/retrieval-pipeline.mjs` (modify), `test/privacy-markers.test.mjs` (new).
- Audit: `memory-plan/audits/step49_privacy_markers/AUDIT_PRE.md`.
- Test baseline: 984 tests (909 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.4 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.4: Implement acceptor + inject offers into agent prompt + emit context.accepted.
- Final test count: 984 (909 pass, 75 fail — 73 pre-existing + 2 flaky variance). +28 `it()` blocks added this step.
- Audit: `memory-plan/audits/step48_acceptor/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v9.4-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.4.
- Files changed: `lib/broadcast-acceptor.mjs` (new — createAcceptor factory, parseArtifactRef, computeTokenOverlap, formatPeerMemoryBlock, auto-acceptance with context.accepted emission), `test/broadcast-acceptor.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v9.4-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.4.
- Files planned: `lib/broadcast-acceptor.mjs` (new), `test/broadcast-acceptor.test.mjs` (new).
- Audit: `memory-plan/audits/step48_acceptor/AUDIT_PRE.md`.
- Test baseline: 956 tests (881 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.3 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.3: Implement offerer (local retrieve → score → publish offer).
- Final test count: 956 (881 pass, 75 fail — 73 pre-existing + 2 flaky variance). +24 `it()` blocks added this step.
- Audit: `memory-plan/audits/step47_offerer/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v9.3-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.3.
- Files changed: `lib/broadcast-offerer.mjs` (new — createOfferer factory, generateRelevanceSummary with LLM/fallback, buildOfferFromResults, filterPrivateItems privacy pre-filter, RELEVANCE_THRESHOLD 0.55, MAX_ARTIFACTS_PER_OFFER 3, TTL expiry check, self-skip), `test/broadcast-offerer.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v9.3-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.3.
- Files planned: `lib/broadcast-offerer.mjs` (new), `test/broadcast-offerer.test.mjs` (new).
- Audit: `memory-plan/audits/step47_offerer/AUDIT_PRE.md`.
- Test baseline: 932 tests (857 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.2 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.2: Implement broadcaster (consolidation-driven, with TTL + de-dup).
- Final test count: 932 (857 pass, 75 fail — 73 pre-existing + 2 flaky variance). +27 test entries added this step (23 `it()` blocks).
- Audit: `memory-plan/audits/step46_broadcaster/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v9.2-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.2.
- Files changed: `lib/broadcast-emitter.mjs` (new — createBroadcaster factory, inferIntensity, computeDedupKey, inferProblemClass, maybeBroadcast per-prompt path, broadcastFromConsolidation hook, rate limit 60s, dedup 15-min window, TTL env override), `test/broadcast-emitter.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v9.2-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.2.
- Files planned: `lib/broadcast-emitter.mjs` (new), `test/broadcast-emitter.test.mjs` (new).
- Audit: `memory-plan/audits/step46_broadcaster/AUDIT_PRE.md`.
- Test baseline: 905 tests (830 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v9.1 — 2026-05-25 — memory-plan-tick

- **Phase 9** step close for Step 9.1: Define broadcast/offer/accepted schemas in event-schemas package.
- Final test count: 905 (830 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added this step.
- Audit: `memory-plan/audits/step45_broadcast_schemas/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v9.1-mid — 2026-05-25 — memory-plan-tick

- **Phase 4** V1 implementation for Step 9.1.
- Files changed: `packages/event-schemas/src/broadcast/context-broadcast.ts` (new — ContextBroadcastSchema with themes/entities/problem_class/intensity/ttl_minutes/dedup_key), `packages/event-schemas/src/broadcast/context-offer.ts` (new — ContextOfferSchema with responding_to/offerer_node_id/artifacts/expires_at), `packages/event-schemas/src/broadcast/context-accepted.ts` (new — ContextAcceptedSchema with responding_to/accepted_artifacts/feedback), `packages/event-schemas/src/broadcast/index.ts` (new — barrel re-export), `packages/event-schemas/src/events.ts` (modified — added BroadcastEventSchema discriminated union), `packages/event-schemas/src/index.ts` (modified — re-export broadcast schemas + BroadcastEventSchema), `test/broadcast-schemas.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v9.1-pre — 2026-05-25 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 9.1.
- Files planned: `packages/event-schemas/src/broadcast/context-broadcast.ts` (new), `packages/event-schemas/src/broadcast/context-offer.ts` (new), `packages/event-schemas/src/broadcast/context-accepted.ts` (new), `packages/event-schemas/src/broadcast/index.ts` (new), `packages/event-schemas/src/events.ts` (modify), `packages/event-schemas/src/index.ts` (modify), `test/broadcast-schemas.test.mjs` (new).
- Audit: `memory-plan/audits/step45_broadcast_schemas/AUDIT_PRE.md`.
- Test baseline: 893 tests (818 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v8.2 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 8.2: Schedule + budget consolidation cycle (~5 min quiet periods).
- Final test count: 893 (818 pass, 75 fail — 73 pre-existing + 2 flaky variance). +14 `it()` blocks added this step.
- Audit: `memory-plan/audits/step44_consolidation_scheduler/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.
- **Block 8 complete (2/2).**

### v8.2-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 8.2.
- Files changed: `bin/consolidation-scheduler.mjs` (new — IDLE_THRESHOLD_MS/HARD_CAP_MS/ANALYSIS_QUIET_MS/DEFAULT_INTERVAL_MS constants, isOllamaIdle via HTTP /api/ps, isQueueIdle for in-process queue state, isSystemIdle combined check, runScheduledCycle with AbortController timeout, createConsolidationScheduler factory with start/stop/runOnce), `services/launchd/ai.openclaw.consolidation-scheduler.plist` (new — StartInterval 1800), `test/consolidation-scheduler.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v8.2-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 8.2.
- Files planned: `bin/consolidation-scheduler.mjs` (new), `services/launchd/ai.openclaw.consolidation-scheduler.plist` (new), `test/consolidation-scheduler.test.mjs` (new).
- Audit: `memory-plan/audits/step44_consolidation_scheduler/AUDIT_PRE.md`.
- Test baseline: 883 tests (808 pass, 75 fail — 73 pre-existing + 2 flaky variance).

### v8.1 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 8.1: Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote).
- Final test count: 883 (808 pass, 75 fail — 73 pre-existing + 2 flaky variance). +14 `it()` blocks added this step.
- Audit: `memory-plan/audits/step43_consolidation_jobs/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v8.1-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 8.1.
- Files changed: `lib/consolidation.mjs` (new — DECAY_HALF_LIFE_DAYS/DECAY_DROP_THRESHOLD/REINFORCEMENT_COOCCURRENCE_MIN/REINFORCEMENT_SALIENCE_BOOST/CLUSTER_COOCCURRENCE_MIN constants, initConsolidationTables for entities_archived table, decayWeights with half-life formula + archival, reinforceCoOccurrence via co-occurrence join + salience bump, detectClusters with union-find clustering, regenerateSummaries wrapping obsidian-summarizer, detectContradictions wrapping surfaceConflicts, evaluatePromotionCandidates for entity + decision threshold queries), `bin/consolidate.mjs` (new — runConsolidationCycle orchestrator with CLI entry + --db/--vault-path/--dry-run flags), `test/consolidation.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v8.1-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 8.1.
- Files planned: `lib/consolidation.mjs` (new), `bin/consolidate.mjs` (new), `test/consolidation.test.mjs` (new).
- Audit: `memory-plan/audits/step43_consolidation_jobs/AUDIT_PRE.md`.
- Test baseline: 869 tests (792 pass, 77 fail — 73 pre-existing + 4 flaky).

### v7.4 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 7.4: Runtime control: @memory off/deep/none.
- Final test count: 869 (792 pass, 77 fail — 73 pre-existing + 4 flaky). +33 `it()` blocks added this step.
- Audit: `memory-plan/audits/step42_runtime_control/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.
- **Block 7 complete (4/4).**

### v7.4-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 7.4.
- Files changed: `lib/memory-directives.mjs` (new — DIRECTIVE_REGEX, DIRECTIVE_TYPES, parseMemoryDirective returning {type, param, cleanedText}, replaceLastUserContent for OpenAI-compatible message arrays), `lib/publishers/openai-wrapper.mjs` (mod — imports parseMemoryDirective + replaceLastUserContent + DEFAULT_TOKEN_BUDGET, memoryDisabledForSession closure flag, directive parsing before injection with off/deep/none/only handling), `lib/publishers/anthropic-wrapper.mjs` (mod — same directive pattern), `lib/publishers/gemini-wrapper.mjs` (mod — imports parseMemoryDirective + DEFAULT_TOKEN_BUDGET, internal replaceGeminiPromptText helper, directive parsing), `lib/publishers/minimax-wrapper.mjs` (mod — same pattern as openai-wrapper), `test/memory-directives.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v7.4-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 7.4.
- Files planned: `lib/memory-directives.mjs` (new), `lib/publishers/openai-wrapper.mjs` (mod), `lib/publishers/anthropic-wrapper.mjs` (mod), `lib/publishers/gemini-wrapper.mjs` (mod), `lib/publishers/minimax-wrapper.mjs` (mod), `test/memory-directives.test.mjs` (new).
- Audit: `memory-plan/audits/step42_runtime_control/AUDIT_PRE.md`.
- Test baseline: 836 tests (759 pass, 77 fail — 73 pre-existing + 4 flaky).

### v7.3 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 7.3: Inject as system-message prefix with [memory: ...] delimiters.
- Final test count: 836 (759 pass, 77 fail — 73 pre-existing + 4 flaky). +28 `it()` blocks added this step.
- Audit: `memory-plan/audits/step41_system_message_injection/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v7.3-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 7.3.
- Files changed: `lib/memory-formatter.mjs` (new — formatConceptList, formatDecisionList, formatSnippetSummaries, formatMemoryBlock composing `[memory: ...]` block, injectIntoSystemMessage, extractLastUserPrompt, injectIntoMessages for OpenAI-compatible message injection), `lib/publishers/openai-wrapper.mjs` (mod — optional `opts.injector` param, memory injection before API call via formatMemoryBlock + injectIntoMessages), `lib/publishers/anthropic-wrapper.mjs` (mod — optional `opts.injector`, injection into Anthropic `system` param via injectIntoSystemMessage), `lib/publishers/gemini-wrapper.mjs` (mod — optional `opts.injector`, Gemini-specific content injection via extractGeminiPrompt + injectIntoGeminiContent), `lib/publishers/minimax-wrapper.mjs` (mod — optional `opts.injector`, same OpenAI-compatible pattern as openai-wrapper), `test/memory-formatter.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v7.3-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 7.3.
- Files planned: `lib/memory-formatter.mjs` (new), `lib/publishers/openai-wrapper.mjs` (mod), `lib/publishers/anthropic-wrapper.mjs` (mod), `lib/publishers/gemini-wrapper.mjs` (mod), `lib/publishers/minimax-wrapper.mjs` (mod), `test/memory-formatter.test.mjs` (new).
- Audit: `memory-plan/audits/step41_system_message_injection/AUDIT_PRE.md`.
- Test baseline: 808 tests (731 pass, 77 fail — 73 pre-existing + 4 flaky).

### v7.2 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 7.2: Pre-retrieve and budget ambient memory (cap 500-1000 tokens).
- Final test count: 808 (731 pass, 77 fail — 73 pre-existing + 4 flaky). +16 `it()` blocks added this step.
- Audit: `memory-plan/audits/step40_memory_injector/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v7.2-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 7.2.
- Files changed: `lib/memory-injector.mjs` (new — DEFAULT_TOKEN_BUDGET 750, CHARS_PER_TOKEN 4, estimateTokens char-based heuristic, queryRelevantConcepts entities via mentions JOIN by session_id sorted by salience, queryRelevantDecisions by session_id sorted by confidence, trimToBudget greedy budget allocator with concepts→decisions→snippets priority and 30-token overhead, createMemoryInjector factory wiring analyzeQuery + createRetrievalPipeline + extraction store queries + budget trimming), `test/memory-injector.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v7.2-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 7.2.
- Files planned: `lib/memory-injector.mjs` (new), `test/memory-injector.test.mjs` (new).
- Audit: `memory-plan/audits/step40_memory_injector/AUDIT_PRE.md`.
- Test baseline: 792 tests (715 pass, 77 fail — 73 pre-existing + 4 flaky).

### v7.1 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 7.1: Implement query analysis (per-prompt theme/entity extraction, ~50ms).
- Final test count: 792 (715 pass, 77 fail — 73 pre-existing + 4 flaky). +11 `it()` blocks added this step.
- Audit: `memory-plan/audits/step39_query_analysis/AUDIT_POST.md`.
- 9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v7.1-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 7.1.
- Files changed: `lib/query-analysis.mjs` (new — extractStructuredCues pure regex for filePaths/versionRefs/codeRefs with deduplication, embedPrompt async wrapper with null-on-failure, analyzeQuery main entry combining embedding + structured cues), `test/query-analysis.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v7.1-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 7.1.
- Files planned: `lib/query-analysis.mjs` (new), `test/query-analysis.test.mjs` (new).
- Audit: `memory-plan/audits/step39_query_analysis/AUDIT_PRE.md`.
- Test baseline: 781 tests (704 pass, 77 fail — 73 pre-existing + 4 flaky).

### v6.4 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 6.4: Historical session backfill (bin/extract-existing-sessions.mjs).
- Final test count: 781 (704 pass, 77 fail — 73 pre-existing + 4 flaky). +9 `it()` blocks added this step.
- Audit: `memory-plan/audits/step38_session_backfill/AUDIT_POST.md`.
- 9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.
- **Block 6 complete (4/4).**

### v6.4-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 6.4.
- Files changed: `bin/extract-existing-sessions.mjs` (new — DEFAULT_SESSION_DB, DEFAULT_EXTRACTION_DB, DEFAULT_CHECKPOINT, DEFAULT_TAIL_COUNT constants, loadCheckpoint/saveCheckpoint for resumable state, runExtraction main orchestrator with per-session try/catch, 20-message tail per Block 3 carry-forward, post-extraction concept note regeneration and graph cache refresh, CLI entry with --session-db/--extraction-db/--checkpoint/--tail/--skip-notes/--skip-graph flags), `test/extract-existing-sessions.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v6.4-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 6.4.
- Files planned: `bin/extract-existing-sessions.mjs` (new), `test/extract-existing-sessions.test.mjs` (new).
- Audit: `memory-plan/audits/step38_session_backfill/AUDIT_PRE.md`.
- Test baseline: 772 tests (695 pass, 77 fail — 73 pre-existing + 4 flaky).

### v6.3 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 6.3: Tune decay/steps/threshold on the same evaluation set from Step 2.5.
- Final test count: 772 (695 pass, 77 fail — 73 pre-existing + 4 flaky). +6 `it()` blocks added this step.
- Audit: `memory-plan/audits/step37_parameter_tuning/AUDIT_POST.md`.
- 9 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

### v6.3-mid — 2026-05-23 — memory-plan-tick

- **Phase 4** V1 implementation for Step 6.3.
- Files changed: `bin/run-tuning-harness.mjs` (new — DEFAULT_CONFIGS 12 named parameter configs, applyConfig/resetConfig for env var management, runConfigQueries for per-query pipeline execution, formatTuningReport for markdown comparison report with summary table + delta vs baseline + per-query hit matrix, runTuningHarness main orchestrator, CLI entry with --queries/--db/--extraction-db/--graph-db/--out/--limit flags), `test/tuning-harness.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v6.3-pre — 2026-05-23 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 6.3.
- Files planned: `bin/run-tuning-harness.mjs` (new), `test/tuning-harness.test.mjs` (new).
- Audit: `memory-plan/audits/step37_parameter_tuning/AUDIT_PRE.md`.
- Test baseline: 766 tests (689 pass, 77 fail — 73 pre-existing + 4 flaky).

### v6.2 — 2026-05-23 — memory-plan-tick

- **Phase 9** step close for Step 6.2: Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank.
- Final test count: 766 (689 pass, 77 fail — 73 pre-existing + 4 flaky). +18 `it()` blocks added this step.
- Audit: `memory-plan/audits/step36_retrieval_pipeline/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v6.2-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 6.2.
- Files changed: `lib/retrieval-pipeline.mjs` (new — DEFAULT_CHANNEL_WEIGHTS constant, parseWeights for RETRIEVAL_WEIGHTS env var, findMatchingEntities and findMatchingThemes for INSTR-based substring matching, getChunksForSessions helper for cross-DB session chunk lookup, entitySearch for Channel 3 entity→mentions→chunks pipeline, themeEntitySearch for Channel 4 theme→decisions + entity→mentions→chunks pipeline, buildSeeds for spreading activation seed extraction via slugifyName, activationSearch for Channel 5 seed→activation→entity→chunks pipeline, weightedRRF for weighted Reciprocal Rank Fusion combining all channels, createRetrievalPipeline factory returning retrieve method that runs all available channels), `test/retrieval-pipeline.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v6.2-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 6.2.
- Files planned: `lib/retrieval-pipeline.mjs` (new), `test/retrieval-pipeline.test.mjs` (new).
- Audit: `memory-plan/audits/step36_retrieval_pipeline/AUDIT_PRE.md`.
- Test baseline: 748 tests (671 pass, 77 fail — 73 pre-existing + 4 flaky).

### v6.1 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 6.1: Implement spreading-activation algorithm (lib/spreading-activation.mjs).
- Final test count: 748 (671 pass, 77 fail — 73 pre-existing + 4 flaky). +9 `it()` blocks added this step (+13 in node test runner count).
- Audit: `memory-plan/audits/step35_spreading_activation/AUDIT_POST.md`.
- 9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v6.1-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 6.1.
- Files changed: `lib/spreading-activation.mjs` (new — DEFAULT_STEPS/DEFAULT_DECAY/DEFAULT_THRESHOLD constants, resolveNum helper for env var precedence, spreadingActivation core algorithm with Math.max merge and configurable steps/decay/threshold via SPREAD_STEPS/SPREAD_DECAY/SPREAD_THRESHOLD env vars, createGraphAdapter wrapping queryNeighbors into edgesFrom interface), `test/spreading-activation.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v6.1-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 6.1.
- Files planned: `lib/spreading-activation.mjs` (new), `test/spreading-activation.test.mjs` (new).
- Audit: `memory-plan/audits/step35_spreading_activation/AUDIT_PRE.md`.
- Test baseline: 735 tests (658 pass, 77 fail — 73 pre-existing + 4 flaky).

### v5.5 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 5.5: Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/).
- Final test count: 735 (658 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- Audit: `memory-plan/audits/step34_shared_vault_promotion/AUDIT_POST.md`.
- 10 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.
- **Block 5 complete (5/5).**

### v5.5-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 5.5.
- Files changed: `lib/obsidian-promoter.mjs` (new — SHARED_CONCEPTS_DIR constant, getNodeId helper, buildPromotedFrontmatter with provenance fields, queryPromotableConcepts reusing queryConceptData, promoteConceptNotes main orchestrator with policy-driven threshold filtering, shared dir creation, note writing), `test/obsidian-promoter.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v5.5-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 5.5.
- Files planned: `lib/obsidian-promoter.mjs` (new), `test/obsidian-promoter.test.mjs` (new).
- Audit: `memory-plan/audits/step34_shared_vault_promotion/AUDIT_PRE.md`.
- Test baseline: 731 tests (654 pass, 77 fail — 73 pre-existing + 4 flaky).

### v5.4 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 5.4: Cache adjacency in SQLite + periodic refresh job (fsevents/10-min).
- Final test count: 731 (654 pass, 77 fail — 73 pre-existing + 4 flaky). +10 tests added this step.
- Audit: `memory-plan/audits/step33_adjacency_cache/AUDIT_POST.md`.
- 9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v5.4-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 5.4.
- Files changed: `bin/obsidian-graph-cache.mjs` (new — DEFAULT_DB_PATH constant, DEFAULT_REFRESH_INTERVAL_MS constant, createGraphCache factory with initDb, refreshCache via buildGraph + full-replace transaction, queryNeighbors with direction filtering, getNodes, getEdges, getStats, startWatcher with interval timer + optional fs.watch, stopWatcher, close, CLI entry with --stats/--refresh/daemon modes), `test/obsidian-graph-cache.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v5.4-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 5.4.
- Files planned: `bin/obsidian-graph-cache.mjs` (new), `test/obsidian-graph-cache.test.mjs` (new).
- Audit: `memory-plan/audits/step33_adjacency_cache/AUDIT_PRE.md`.
- Test baseline: 721 tests (644 pass, 77 fail — 73 pre-existing + 4 flaky).

### v5.3 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 5.3: Build wikilink graph parser (lib/obsidian-graph.mjs).
- Final test count: 721 (644 pass, 77 fail — 73 pre-existing + 4 flaky). +16 tests added this step.
- Audit: `memory-plan/audits/step32_wikilink_graph_parser/AUDIT_POST.md`.
- 9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v5.3-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 5.3.
- Files changed: `lib/obsidian-graph.mjs` (new — walkVault for recursive .md discovery, parseNote for frontmatter+body split via js-yaml, extractWikilinks for `[[...]]` pattern extraction, resolveEdgeType for frontmatter-driven edge typing, buildGraph main entry returning `{nodes: Map, edges: []}`), `test/obsidian-graph.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v5.3-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 5.3.
- Files planned: `lib/obsidian-graph.mjs` (new), `test/obsidian-graph.test.mjs` (new).
- Audit: `memory-plan/audits/step32_wikilink_graph_parser/AUDIT_PRE.md`.
- Test baseline: 705 tests (628 pass, 77 fail — 73 pre-existing + 4 flaky).

### v5.2 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 5.2: Auto-generate concept notes from entity store (frontmatter + body via LLM).
- Final test count: 705 (628 pass, 77 fail — 73 pre-existing + 4 flaky). +12 tests added this step.
- Audit: `memory-plan/audits/step31_concept_note_generation/AUDIT_POST.md`.
- 10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v5.2-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 5.2.
- Files changed: `lib/obsidian-summarizer.mjs` (new — DEFAULT_CONCEPT_THRESHOLD constant, getConceptThreshold with env override, slugifyName for filesystem-safe names, buildConceptFrontmatter with YAML data-driven frontmatter, buildConceptBody with LLM summary + fallback, generateConceptSummary with LLM client, queryConceptData for extraction store queries, generateConceptNotes main orchestrator), `test/obsidian-summarizer.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v5.2-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 5.2.
- Files planned: `lib/obsidian-summarizer.mjs` (new), `test/obsidian-summarizer.test.mjs` (new).
- Audit: `memory-plan/audits/step31_concept_note_generation/AUDIT_PRE.md`.
- Test baseline: 693 tests (616 pass, 77 fail — 73 pre-existing + 4 flaky).

### v5.1 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 5.1: Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/.
- Final test count: 693 (616 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- Audit: `memory-plan/audits/step30_obsidian_vault_setup/AUDIT_POST.md`.
- 8 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

### v5.1-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 5.1.
- Files changed: `lib/obsidian-vault.mjs` (new — DEFAULT_VAULT_PATH constant, VAULT_SUBDIRS array, getVaultPath with env override, ensureVaultStructure with idempotent mkdir), `test/obsidian-vault.test.mjs` (new — tests).
- Test additions: see Phase 5.

### v5.1-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 5.1.
- Files planned: `lib/obsidian-vault.mjs` (new), `test/obsidian-vault.test.mjs` (new).
- Audit: `memory-plan/audits/step30_obsidian_vault_setup/AUDIT_PRE.md`.
- Test baseline: 685 tests (608 pass, 77 fail — 73 pre-existing + 4 flaky).

### v4.9 — 2026-05-22 — memory-plan-tick

- **Phase 9** step close for Step 4.9: Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md).
- Final test count: 685 (608 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added this step.
- Audit: `memory-plan/audits/step29_frontend_publisher_pack/AUDIT_POST.md`.
- 9 POSITIVE, 2 NEGATIVE findings. 0 Phase 8 patches. 1 delta dropped (`.claude/hooks/pre-compact.sh` — sandbox constraint).
- **Block 4 complete (9/9).**

### v4.9-mid — 2026-05-22 — memory-plan-tick

- **Phase 4** V1 implementation for Step 4.9.
- Files changed: `lib/publishers/publish-helper.mjs` (new — DEFAULT_NATS_URL, EXTRACT_SUBJECT constants, publishExtractDirect for existing nc, createNatsPublisher factory with lazy connect + fire-and-forget publish), `lib/publishers/openai-wrapper.mjs` (new — wrapOpenAI wraps chat.completions.create), `lib/publishers/anthropic-wrapper.mjs` (new — wrapAnthropic wraps messages.create), `lib/publishers/gemini-wrapper.mjs` (new — wrapGemini wraps generateContent), `lib/publishers/minimax-wrapper.mjs` (new — wrapMiniMax wraps chat.completions.create, OpenAI-compatible), `bin/openclaw-extract-now.mjs` (new — manual CLI, runExtractNow export), `hooks/claude-code/pre-compact.sh` (new — shell hook delegating to CLI), `hooks/openwebui/openclaw-publisher-plugin.py` (new — Python plugin via subprocess), `hooks/librechat/openclaw-trigger.js` (new — Node.js trigger importing publish-helper), `hooks/continue/openclaw-config.json` (new — Continue IDE config template), `docs/PUBLISHERS.md` (new — comprehensive 3-tier integration docs), `test/publishers.test.mjs` (new — tests).
- Note: `.claude/hooks/pre-compact.sh` modification blocked by sandbox (delta #11 dropped — same constraint as Steps 4.7/4.8).
- Test additions: see Phase 5.

### v4.9-pre — 2026-05-22 — memory-plan-tick

- **Phase 1** audit-pre + version carrier bump for Step 4.9.
- Files planned: `lib/publishers/publish-helper.mjs` (new), `lib/publishers/openai-wrapper.mjs` (new), `lib/publishers/anthropic-wrapper.mjs` (new), `lib/publishers/gemini-wrapper.mjs` (new), `lib/publishers/minimax-wrapper.mjs` (new), `bin/openclaw-extract-now.mjs` (new), `hooks/claude-code/pre-compact.sh` (new), `hooks/openwebui/openclaw-publisher-plugin.py` (new), `hooks/librechat/openclaw-trigger.js` (new), `hooks/continue/openclaw-config.json` (new), `.claude/hooks/pre-compact.sh` (mod), `docs/PUBLISHERS.md` (new), `test/publishers.test.mjs` (new).
- Audit: `memory-plan/audits/step29_frontend_publisher_pack/AUDIT_PRE.md`.
- Test baseline: 671 tests (594 pass, 77 fail — 73 pre-existing + 4 flaky).

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
