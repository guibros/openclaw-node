# OpenClaw Memory Plan — Step Inventory

The master list of all atomic steps for the memory infrastructure upgrade. Each row is one step
that runs through the 9-phase Framework cycle and produces exactly one commit at Phase 9.

**Status legend.** `[ ]` queued · `[A]` in-flight · `[x]` closed

**Versioning.** `v<block>.<step>`. Initial state is `v0.0` (no steps closed).
Each step bumps through `vX.Y-pre`, `vX.Y-mid`, then clean `vX.Y` at commit.

**Source.** Steps below are derived from [REFERENCE_PLAN.md](REFERENCE_PLAN.md).

---

## Block 0 — Stop the bleeding

Fix active bugs in the existing harness before adding complexity. See REFERENCE_PLAN.md §Phase 0.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [x] | Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test |

> **Step 0.1 closed.** `reload()` now fires after both daemon flush paths (pre-compression and end-of-session) and via an optional NATS subscription on `mesh.memory.compaction_completed`. One new test added. 6 positive audit findings, zero corrections.
| 0 | 0.2 | v0.2 | [x] | Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers) |

> **Step 0.2 closed.** Daemon state file renamed from `.companion-state.md` to `.daemon-state-${NODE_ID}.md` across all four readers (daemon, session-start hook, daily-log-writer, mission-control tasks route). Migration script added at `scripts/migrate-companion-state.mjs`. Function `readCompanionState` renamed to `readDaemonState`. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 0 | 0.3 | v0.3 | [x] | Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup) |

> **Step 0.3 closed.** Replaced parenthetical merge format `(updated: ...)` with supersedes-comment model `<!-- supersedes: <hash> -->` in `mergeFacts`. Added `cleanParentheticalChains` for legacy cleanup and `stripSupersedes` for clean similarity comparison. 5 new regression tests. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 0 | 0.4 | v0.4 | [x] | Include assistant-role messages in extraction + add speaker field + new patterns |

> **Step 0.4 closed.** Opened `extractFacts` role filter to include assistant messages alongside user messages. Added `stripSpeaker` helper and two assistant-voice pattern groups (`agent_action`, `finding`). Added `speaker` field on extracted facts. Updated `mergeFacts` to format MEMORY.md entries with `[user]`/`[assistant]` prefix and strip speaker tags during similarity comparison. 5 new tests. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 0 | 0.5 | v0.5 | [x] | Fix mid-word truncation via truncateAtWord helper |

> **Step 0.5 closed.** Added `truncateAtWord(text, maxLen)` helper to replace the hard `.slice(0, 120)` in `extractFacts`. The helper truncates at the last space before `maxLen`, with a 0.7 fallback threshold for long words. 4 new tests. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 0 | 0.6 | v0.6 | [x] | Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field) |

> **Step 0.6 closed.** Removed four dead artifacts: `.pre-compact-state.md` write from `pre-compact.sh`, `session-fingerprint.json` write infrastructure from `session-recap` (~80 lines: `extractFingerprint`, `writeFingerprint`, `FINGERPRINT_FILE` constant, and caller block), `frontend-activity` touch from `auto-checkpoint`, and the unused `confidence` field from `extractFacts` pattern objects and return shape. 1 new regression test. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 0 | 0.7 | v0.7 | [x] | Document state files (docs/STATE_FILES.md) |

> **Step 0.7 closed.** Created `docs/STATE_FILES.md` — comprehensive reference inventory of every runtime state file the memory infrastructure writes, organized by location (workspace, .tmp/, SQLite, config). Covers owner, format, lifetime, consumers for each file. Includes "Files removed in Block 0" section documenting the four artifacts deleted in Step 0.6. Documentation-only step, zero functional changes, zero new tests. 6 positive audit findings, zero corrections, zero Phase 8 patches. **Block 0 complete (7/7).**

## Block 1 — Schema & event foundations

Cross-cutting infrastructure shared with kanban: schema package, local event log, artifact store.
See REFERENCE_PLAN.md §Phase 1.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Create packages/event-schemas (zod envelope + memory event payloads + discriminated union) |

> **Step 1.1 closed.** Created the `packages/event-schemas` workspace package with Zod-based schemas. EventEnvelopeSchema defines the canonical event envelope (13 fields). Eight memory event payload schemas (session-started, session-ended, turn-recorded, fact-extracted, concept-mentioned, snapshot-taken, compaction-triggered, artifact-attached) extend the envelope with literal `event_type` discriminators and typed `data` payloads. MemoryEventSchema provides a discriminated union for runtime validation. toJsonSchema() generates JSON Schema for cross-language consumers. npm workspaces enabled at root with pretest build hook. 15 new tests. 6 positive findings, 1 Phase 8 patch (.gitignore for dist/).
| 1 | 1.2 | v1.2 | [x] | Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring) |

> **Step 1.2 closed.** Created `lib/local-event-log.mjs` — the per-node event log substrate backed by NATS JetStream (R=1, file storage, `local.>` subjects). `createLocalEventLog(nc, nodeId)` ensures the stream exists and returns a `publishLocal(event)` method that validates against `MemoryEventSchema` and publishes with `idempotency_key` as msgID. `buildMemoryEvent()` helper constructs envelope-conformant events. Dual-write wired into `MemoryBudget`: `startSession` → `memory.session_started`, `endSession` → `memory.session_ended`, `addEntry` → `memory.fact_extracted`. All publishing is fire-and-forget (shadow mode). Daemon initializes the event log after NATS connection and passes it to `createBudget`. 9 new tests. 6 positive findings, 0 Phase 8 patches.
| 1 | 1.3 | v1.3 | [x] | Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/) |

> **Step 1.3 closed.** Created `lib/artifacts.mjs` — the content-addressed artifact store under `~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>` with `.meta.json` sidecars. Exports `putArtifact` (SHA-256, sharded write, idempotent), `getArtifact` (local read, throws on miss), `hasArtifact` (boolean existence check), `validateArtifact` (re-hash integrity check). No new dependencies (Node.js built-ins only). 6 new tests. 6 positive findings, 0 Phase 8 patches.
| 1 | 1.4 | v1.4 | [x] | Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4) |

> **Step 1.4 closed.** Created `lib/shared-event-stream.mjs` — the shared JetStream stream configuration module. Exports `ensureSharedStream(nc)` which creates/verifies the `OPENCLAW_SHARED` stream with R=3 replication, File storage, and 7 federation subject patterns (kanban.events, lessons.shared, concepts.shared, context.broadcast, context.offer, context.accepted, artifacts.shared). Exports `inspectSharedStream(nc)` for operational verification. Infrastructure preparation only — stream sits idle until Block 4 wires promoter/subscriber. 16 new tests with mock NATS connection. 6 positive findings, 1 negative finding (StorageType assertion fix), 0 Phase 8 patches. **Block 1 complete (4/4).**

## Block 2 — Local semantic layer

Major gate. Add semantic retrieval; validate against real queries (Gulf 1 close).
See REFERENCE_PLAN.md §Phase 2. **NOTE:** scope must be revisited before starting — `lib/mcp-knowledge/`
already implements sqlite-vec + embeddings against the workspace. Step 2.1 begins with a scope review
gate per RESUME.md §0.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [x] | Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test |
| 2 | 2.2 | v2.2 | [x] | Choose embedding model + benchmark on real session data (latency target <100ms/turn) |

> **Step 2.2 closed.** Confirmed Xenova/all-MiniLM-L6-v2 (384-dim) as the embedding model per Block 2 frozen decisions. Benchmark proves <100ms/turn latency target met by wide margin (~5ms/turn on M4). 5 new tests validate model identity (name, dimension, normalization) and latency (mean on 50 turns, batch of 100 turns). 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 2 | 2.3 | v2.3 | [x] | Chunk and embed existing sessions (resumable migration with checkpoint file) |

> **Step 2.3 closed.** Created `bin/embed-existing-sessions.mjs` — a standalone resumable migration script that reads all sessions from the session-store DB (`~/.openclaw/state.db`), extracts their messages as turns, and indexes embeddings into the mcp-knowledge database via `indexSessionTurns()`. Checkpoint file (`~/.openclaw/.embed-migration-checkpoint.json`) tracks progress per session for crash resumability. Script opens session store read-only, handles SIGINT for graceful shutdown. 5 new tests. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 2 | 2.4 | v2.4 | [x] | Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags |

> **Step 2.4 closed.** Extended `lib/mcp-knowledge/core.mjs` with FTS5 full-text search (`session_chunks_fts` virtual table with external content triggers), `searchSessionsFts()` for BM25-ranked keyword search, `reciprocalRankFusion()` for combining multiple ranked result sets, and `hybridSearchSessions()` which fuses FTS5 + semantic via RRF. Updated `searchSessions()` to include `chunk_id` for RRF keying. Created `bin/session-search.mjs` CLI tool with `--semantic`/`--hybrid`/`--fts` flags (default: hybrid). 7 new tests. 7 positive audit findings, zero corrections, zero Phase 8 patches.
| 2 | 2.5 | v2.5 | [x] | Manual evaluation against 20-30 real queries; spreadsheet of results; **Gulf 1 gate** |

> **Step 2.5 closed.** Created `bin/run-gulf1-eval.mjs` — the Gulf 1 evaluation runner that queries all three search modes (FTS5, semantic, hybrid) against a curated 25-query set and produces a structured markdown results document with scoring columns for manual operator review. Created `memory-plan/eval/gulf1-queries.json` with 25 queries across 8 categories (architecture, memory-lifecycle, architecture-decision, semantic-layer, extraction, infrastructure, search, federation). The evaluation tool exports `parseQuerySet`, `runEvaluation`, `formatResults`, `aggregateScores`, and `checkDatabaseReadiness` for programmatic use. Operator must run the evaluation against live databases and score results to make the go/no-go decision for Block 3. 7 new tests. 6 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches. **Block 2 complete (5/5).**

## Block 3 — LLM-driven extraction

Replace regex extraction with structured-output LLM. See REFERENCE_PLAN.md §Phase 3.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [x] | Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session) |

> **Step 3.1 closed.** Created `lib/llm-client.mjs` — LLM client module for local Qwen3.5-27B-Instruct via mlx-lm server's OpenAI-compatible API. Exports `createLlmClient({ baseUrl, model, timeout })` returning `{ generate(messages, opts), healthCheck() }`. Supports JSON mode for structured output. Fully configurable via environment variables. Created `bin/llm-benchmark.mjs` — CLI benchmark tool with 40-turn synthetic session and latency measurement against ≤30s target. 4 new tests with mock HTTP server. 6 positive audit findings, zero corrections, zero Phase 8 patches.
| 3 | 3.2 | v3.2 | [x] | Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships) |

> **Step 3.2 closed.** Created `lib/extraction-schema.mjs` — ExtractionResultSchema via Zod v4 covering 6 extraction categories: entities (name/type/salience), themes (label/hierarchy), actions (enum of 6 activity types), decisions (decision/rationale/confidence), friction_signals (signal/severity), relationships (source/target/type). Created `lib/extraction-prompt.mjs` — `buildExtractionPrompt(messages)` formats session tail into system+user prompt with schema description and extraction rules; `extractStructured(client, messages)` calls LLM with JSON mode, parses response, validates against schema. 7 new tests with mock clients. 6 positive audit findings, zero Phase 8 patches. Phase-4-correction streak reset (test count: planned 6, delivered 7).
| 3 | 3.3 | v3.3 | [x] | Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite |

> **Step 3.3 closed.** Created `lib/extraction-store.mjs` — `createExtractionStore` with 4 SQLite tables (entities, themes, mentions, decisions), `storeExtractionResult` for atomic upsert from LLM extraction results, `generateMemoryContent` for structured MEMORY.md generation from accumulated data. Modified `lib/pre-compression-flush.mjs` — added `USE_LLM_EXTRACTION` feature flag (defaults true, `'false'` restores regex), extended `runFlush` with LLM extraction path and graceful fallback to regex on failure. Modified `workspace-bin/memory-daemon.mjs` — lazy init of LLM client + extraction store, passed to both flush call sites. 8 new tests with mock LLM clients and temp databases. 6 positive audit findings, 1 negative (test count: planned 7, delivered 8), zero Phase 8 patches. Phase-4-correction streak reset.
| 3 | 3.4 | v3.4 | [x] | Validate LLM vs regex extraction on 10 sessions; document quality delta |

> **Step 3.4 closed.** Created `bin/run-block3-validation.mjs` — CLI validation tool that reads sessions from the session store, runs both the regex extractor (`extractFacts` + `mergeFacts`) and the LLM extractor (`extractStructured` + `generateMemoryContent` via temp in-memory extraction store) on each, and produces a structured markdown comparison document with per-session scoring tables and a go/no-go decision checklist. Handles LLM unavailability gracefully (runs regex-only with empty LLM columns). 9 new tests with mock DB and mock LLM client. 6 positive audit findings, 1 negative (test count: planned ~6, delivered 9), zero Phase 8 patches. Phase-4-correction streak reset. **Block 3 complete (4/4).**

## Block 4 — Federation primitives

Promoter, subscriber, provenance, policy. See REFERENCE_PLAN.md §Phase 4.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [x] | Define promotion policies (config/promotion-policy.yaml) |

> **Step 4.1 closed.** Created `config/promotion-policy.yaml` with operator-specified thresholds (tighter than REFERENCE_PLAN): automatic kanban_events, explicit share_true, threshold concept_mention_count 10 + decision_confidence 0.95, manual_review everything_else. Created `lib/promotion-policy.mjs` with `loadPromotionPolicy(configPath)` loader, `validatePromotionPolicy(parsed)` validator, `DEFAULT_POLICY_PATH` and `POLICY_CATEGORIES` constants. Uses `js-yaml` (existing dependency). 11 new tests. 6 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 4 | 4.2 | v4.2 | [x] | Implement promoter (bin/memory-promoter.mjs) |

> **Step 4.2 closed.** Created `bin/memory-promoter.mjs` — the promoter daemon that subscribes to the local event log, evaluates each event against the promotion policy, and publishes eligible events to the shared cluster with `promoted_from` provenance tracking. Exports `evaluatePromotionPolicy(event, policy)` for pure policy evaluation (automatic kanban → promote, explicit share_true → promote, threshold concept_mention_count/decision_confidence → promote, default → queue_for_review), `mapToSharedSubject(event)` for local-to-shared subject mapping, `createBackoff(opts)` for exponential backoff (1s→60s, multiplier 2), and `createPromoter(nc, nodeId, opts)` factory that wires JetStream consumer + evaluate→promote pipeline with cluster health resilience. 10 new tests. 7 positive audit findings, zero corrections, zero Phase 8 patches.
| 4 | 4.3 | v4.3 | [x] | Implement subscriber (bin/memory-subscriber.mjs) |

> **Step 4.3 closed.** Created `bin/memory-subscriber.mjs` — the subscriber daemon that subscribes to the shared NATS JetStream cluster (OPENCLAW_SHARED), evaluates each incoming event via `evaluateIngestionPolicy` (pure function: skip self-originated, accept kanban/concept/lesson/artifact, defer broadcast/offer/accepted to Block 9), parses shared subjects via `parseSharedSubject` (7 category mappings), and projects accepted events with provenance envelope `{ source_type, source_node, source_event_id }` via `onIngest` callback hook. Reuses `createBackoff` from promoter (zero duplication). Handles shared stream unavailability gracefully (degraded no-op subscriber with backoff). CLI entry with SIGINT/SIGTERM graceful shutdown. 14 new tests. 8 positive audit findings, zero corrections, zero Phase 8 patches.
| 4 | 4.4 | v4.4 | [x] | Add provenance fields (source_type, source_node, source_event_id) to local stores |

> **Step 4.4 closed.** Added provenance columns (`source_type`, `source_node`, `source_event_id`) to all 4 extraction store tables (`entities`, `themes`, `mentions`, `decisions`) via idempotent ALTER TABLE migration. Provenance indexes for retrieval filtering. `storeExtractionResult` accepts optional provenance parameter — existing callers unaffected (defaults to `PROVENANCE_LOCAL`). `PROVENANCE_LOCAL` frozen constant exported. 8 new tests. 7 positive audit findings, zero corrections, zero Phase 8 patches.
| 4 | 4.5 | v4.5 | [x] | Always-ingest kanban events into tasks_observed |

> **Step 4.5 closed.** Created `lib/kanban-store.mjs` with `createKanbanStore` factory — `tasks_observed` table with provenance columns from creation (no migration needed). `projectKanbanEvent` provides full projection for owned tasks (all data fields + JSON blob) and summary projection for non-owned tasks (task_id, owner, status only). Query API: `getObservedTasks` with ownedOnly/status/sourceType filters, `getTaskById` returning latest event, `getStats` for counts. 8 new tests. 7 positive audit findings, zero corrections, zero Phase 8 patches.
| 4 | 4.6 | v4.6 | [x] | Conflict surfacing in retrieval pipeline (describeConflict) |

> **Step 4.6 closed.** Created `lib/conflict-surfacing.mjs` with 5 exports: `describeConflict` pure function (per REFERENCE_PLAN — returns `{ local_definition, shared_definition, last_local_mention, last_shared_mention }`), `findEntityConflicts(db)` queries entities with mixed-provenance mentions from both local and shared sources, `findDecisionConflicts(db)` queries decisions from different source types in the same session, `surfaceConflicts(db)` aggregates all conflicts into `{ entity_conflicts, decision_conflicts, total }`, `annotateWithConflicts(results, conflicts)` adds `conflict: true` flag + detail to matching retrieval results. All functions take `db` parameter (dependency injection). 9 new tests. 7 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 4 | 4.7 | v4.7 | [X] | Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer) |
| 4 | 4.8 | v4.8 | [x] | Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs) |

> **Step 4.8 closed.** Created `lib/health-check.mjs` with 7 exports: `runHealthCheck(opts)` async function with dependency-injected 6-component checks (daemon/nats/ollama/embedder/sqlite/workspace_writable), each returning `{ ok, detail, latency_ms }` with 5s timeout. `deriveStatus(result)` pure function (all ok→healthy, none→unhealthy, mixed→degraded). `formatHealthReport(result)` markdown table formatter. `parseAlertTargets(envValue)` CSV parser for `HEALTH_ALERT_TARGETS` env var. `COMPONENT_NAMES`, `DEFAULT_INTERVAL_SEC` (60), `ALERT_TARGETS_DEFAULT` ('file,nats,banner') constants. Created `bin/health-watch.mjs` with `createHealthWatch(opts)` factory — 60s interval, state-change-only alerting to file/.daemon-health.md + NATS/mesh.health.alerts + macOS banner, 5-min repeat while unhealthy. Created `bin/openclaw-restart.sh` — manual restart via launchctl kickstart + pgrep/kill fallback. 15 new tests. 10 positive audit findings, 2 negative (test count underestimate, chmod blocked), 1 Phase 8 patch (syntax fix).
| 4 | 4.9 | v4.9 | [x] | Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md) |

> **Step 4.9 closed.** Created `lib/publishers/publish-helper.mjs` — shared NATS publish utility with `publishExtractDirect` for direct publishing and `createNatsPublisher` factory with lazy connection. Four SDK wrappers (`openai-wrapper.mjs`, `anthropic-wrapper.mjs`, `gemini-wrapper.mjs`, `minimax-wrapper.mjs`) each wrapping the primary API method to fire extraction events post-response. `bin/openclaw-extract-now.mjs` manual CLI tool. Tier 1 hooks: `hooks/claude-code/pre-compact.sh` (shell), `hooks/openwebui/openclaw-publisher-plugin.py` (Python subprocess), `hooks/librechat/openclaw-trigger.js` (Node.js), `hooks/continue/openclaw-config.json` (config template). `docs/PUBLISHERS.md` comprehensive 3-tier documentation. 14 new tests. 9 positive audit findings, 2 negative (test count underestimate, sandbox block on `.claude/hooks`), zero Phase 8 patches. **Block 4 complete (9/9).**

## Block 5 — Thematic substrate

Per-node Obsidian vault + wikilink graph + adjacency cache. See REFERENCE_PLAN.md §Phase 5.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [x] | Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/ |

> **Step 5.1 closed.** Created `lib/obsidian-vault.mjs` — per-node Obsidian vault setup module with `DEFAULT_VAULT_PATH` (resolves `~/.openclaw/obsidian-local/` via `os.homedir()` + `path.join()`), `VAULT_SUBDIRS` (`['concepts', 'decisions', 'sessions', 'themes', 'daily']`), `getVaultPath(opts)` with `OBSIDIAN_VAULT_PATH` env override, and `ensureVaultStructure(vaultPath)` for idempotent directory creation. No external dependencies (Node.js built-ins only). 8 new tests. 8 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 5 | 5.2 | v5.2 | [x] | Auto-generate concept notes from entity store (frontmatter + body via LLM) |

> **Step 5.2 closed.** Created `lib/obsidian-summarizer.mjs` — concept note auto-generation from extraction store. Exports `DEFAULT_CONCEPT_THRESHOLD` (5), `getConceptThreshold` with env override, `slugifyName` for filesystem-safe filenames, `buildConceptFrontmatter` with data-driven YAML (type, entity_type, created, last_seen, mention_count, salience, related wikilinks), `buildConceptBody` with LLM summary + data-only fallback, `generateConceptSummary` via Ollama/Qwen3 with `/no_think` directive, `queryConceptData` for extraction store queries (entities + co-mentions + decisions), `generateConceptNotes` main orchestrator. 12 new tests. 10 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 5 | 5.3 | v5.3 | [x] | Build wikilink graph parser (lib/obsidian-graph.mjs) |

> **Step 5.3 closed.** Created `lib/obsidian-graph.mjs` — the wikilink graph parser module. Exports `walkVault(vaultPath)` for recursive `.md` file discovery with `{filePath, relativePath, id, subdirectory}` descriptors, `parseNote(content)` for frontmatter+body splitting via `js-yaml`, `extractWikilinks(text)` for `[[target]]` and `[[target|display]]` pattern extraction, and `buildGraph(vaultPath)` returning `{nodes: Map<id, {label, subdirectory, ...frontmatter}>, edges: [{source, target, type}]}`. Edge typing from frontmatter `edge_types` mapping supports `derived_from`, `contradicts`, `instance_of`; defaults to `mentions`. Deduplicates edges from body and frontmatter `related` field. 16 new tests. 9 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 5 | 5.4 | v5.4 | [x] | Cache adjacency in SQLite + periodic refresh job (fsevents/10-min) |

> **Step 5.4 closed.** Created `bin/obsidian-graph-cache.mjs` — the adjacency cache module. `createGraphCache(opts)` factory returns a queryable API surface: `refreshCache()` calls `buildGraph(vaultPath)` and projects nodes/edges into SQLite tables `concept_graph_nodes` and `concept_graph_edges` via full-replace transaction. `queryNeighbors(nodeId, { direction })` supports outgoing/incoming/both queries for spreading activation. `getNodes()`, `getEdges()`, `getStats()` for inspection. `startWatcher()` sets up 10-min interval timer + optional `fs.watch` recursive watcher with 2s debounce. CLI entry with `--stats`/`--refresh`/daemon modes. 10 new tests. 9 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 5 | 5.5 | v5.5 | [x] | Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/) |

> **Step 5.5 closed.** Created `lib/obsidian-promoter.mjs` — the shared vault promotion module. Exports `SHARED_CONCEPTS_DIR` (resolves to `<repo>/projects/arcane-vault/concepts-shared/`), `getNodeId()` (env or hostname), `buildPromotedFrontmatter()` with standard concept fields plus provenance (source_node, original_path, promoted_at), `queryPromotableConcepts()` reusing `queryConceptData` from obsidian-summarizer, and `promoteConceptNotes()` main orchestrator loading promotion policy, filtering by `concept_mention_count >= 10` threshold, writing promoted notes with provenance frontmatter. 8 new tests. 10 positive audit findings, zero Phase 8 patches. **Block 5 complete (5/5).**

## Block 6 — Spreading activation

Associative retrieval algorithm + 5-channel pipeline. See REFERENCE_PLAN.md §Phase 6.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [x] | Implement spreading-activation algorithm (lib/spreading-activation.mjs) |

> **Step 6.1 closed.** Created `lib/spreading-activation.mjs` — pure spreading activation algorithm module. Exports `spreadingActivation(seeds, graph, opts)` with configurable steps/decay/threshold (env overrides via SPREAD_STEPS/SPREAD_DECAY/SPREAD_THRESHOLD), Math.max merge to prevent hub domination, and generic `edgesFrom` graph interface. Exports `createGraphAdapter(graphCache)` to bridge Step 5.4's adjacency cache. Constants: DEFAULT_STEPS (3), DEFAULT_DECAY (0.7), DEFAULT_THRESHOLD (0.1). 9 new tests with synthetic graphs covering linear chain, hub, diamond merge, threshold filtering, edge weights, Map seeds, and adapter interface. 9 positive audit findings, zero Phase 8 patches.
| 6 | 6.2 | v6.2 | [x] | Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank |

> **Step 6.2 closed.** Created `lib/retrieval-pipeline.mjs` — the 5-channel retrieval pipeline module. Channel 1: FTS5 keyword via `searchSessionsFts`. Channel 2: vector/semantic via `searchSessions`. Channel 3: entity exact match via `findMatchingEntities` → mentions → session chunks. Channel 4: theme/entity seed via `findMatchingThemes` + decision text search → session chunks. Channel 5: spreading activation via `buildSeeds` + `createGraphAdapter` + `spreadingActivation` → activated nodes → entity reverse lookup → session chunks. Combined via `weightedRRF` with per-channel weights (`DEFAULT_CHANNEL_WEIGHTS`, configurable via `RETRIEVAL_WEIGHTS` env var). Factory `createRetrievalPipeline({ knowledgeDb, extractionDb, graphCache })` returns `{ retrieve(query, opts) }` with graceful degradation when databases are absent. 18 new tests. 10 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 6 | 6.3 | v6.3 | [x] | Tune decay/steps/threshold on the same evaluation set from Step 2.5 |

> **Step 6.3 closed.** Created `bin/run-tuning-harness.mjs` — CLI parameter tuning harness that runs the 25-query Gulf-1 evaluation set through `createRetrievalPipeline` with 12 named parameter configurations (varying spreading activation decay/steps/threshold and channel weights). Exports `DEFAULT_CONFIGS` (12 configs), `applyConfig`/`resetConfig` for env var management, `runConfigQueries` for per-query execution, `formatTuningReport` for markdown comparison (summary table, delta vs baseline, per-query hit matrix), and `runTuningHarness` orchestrator. Reuses `parseQuerySet` from Step 2.5 and `createRetrievalPipeline` from Step 6.2. 6 new tests. 9 positive audit findings, zero corrections, zero Phase 8 patches.
| 6 | 6.4 | v6.4 | [x] | Historical session backfill (bin/extract-existing-sessions.mjs) |

> **Step 6.4 closed.** Created `bin/extract-existing-sessions.mjs` — resumable LLM extraction backfill script that reads all sessions from `~/.openclaw/state.db`, runs `extractStructured()` on the last 20 messages of each session (reduced from 40 per Block 3 carry-forward to avoid LLM timeout), stores results in the extraction store (entities, themes, mentions, decisions) via `storeExtractionResult()`. Checkpoint file at `~/.openclaw/.extract-migration-checkpoint.json` tracks completed and failed session IDs for crash resumability. SIGINT handling for graceful shutdown. Per-session try/catch ensures individual LLM failures don't abort the entire run. Post-extraction hooks: optional concept note regeneration (`generateConceptNotes`) and graph cache refresh (`createGraphCache().refreshCache()`). CLI supports `--session-db`, `--extraction-db`, `--checkpoint`, `--tail`, `--skip-notes`, `--skip-graph` flags. 9 new tests. 9 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches. **Block 6 complete (4/4).**

## Block 7 — Proactive injection

Per-turn ambient memory in prompts. See REFERENCE_PLAN.md §Phase 7.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [x] | Implement query analysis (per-prompt theme/entity extraction, ~50ms) |

> **Step 7.1 closed.** Created `lib/query-analysis.mjs` — per-prompt analysis module using embedding-based approach (BGE-M3, not LLM call) plus regex fallback for structured cues. Exports `analyzeQuery(prompt, opts)` returning `{ rawQuery, embedding, structuredCues }`, `extractStructuredCues(text)` for pure regex extraction of file paths, version/step refs, and backtick code identifiers with deduplication, and `embedPrompt(prompt, embedFn)` async wrapper with null-on-failure graceful degradation. Dynamic import of mcp-knowledge for lazy embedder loading. 11 new tests. 9 positive audit findings, 1 negative (test count underestimate: planned ~6, delivered 11), zero Phase 8 patches.
| 7 | 7.2 | v7.2 | [x] | Pre-retrieve and budget ambient memory (cap 500-1000 tokens) |
| 7 | 7.3 | v7.3 | [x] | Inject as system-message prefix with [memory: ...] delimiters |

> **Step 7.3 closed.** Created `lib/memory-formatter.mjs` — memory formatting module with 7 exports: `formatConceptList` (comma-separated "Name (type)" list), `formatDecisionList` (bullet list with date + confidence), `formatSnippetSummaries` (session-deduped snippet references), `formatMemoryBlock` (composes full `[memory: ...]` block per Block 7 §0 format; empty string when all arrays empty), `injectIntoSystemMessage` (prepends to system content), `extractLastUserPrompt` (scans messages array for last user text), `injectIntoMessages` (OpenAI-compatible message injection). Modified all 4 SDK wrappers (`openai-wrapper.mjs`, `anthropic-wrapper.mjs`, `gemini-wrapper.mjs`, `minimax-wrapper.mjs`) to accept optional `opts.injector` — when provided, pre-retrieves memory via injector and injects formatted block before API call; injection failures caught silently. 28 new tests. 10 positive audit findings, 1 negative (test count discrepancy), zero Phase 8 patches.
| 7 | 7.4 | v7.4 | [x] | Runtime control: @memory off/deep/none |

> **Step 7.4 closed.** Created `lib/memory-directives.mjs` — runtime control directive parser with `DIRECTIVE_REGEX` (case-insensitive pattern matching `@memory off/deep/none/only:<theme>`), `DIRECTIVE_TYPES` Set constant, `parseMemoryDirective(text)` returning `{ type, param, cleanedText }`, and `replaceLastUserContent(messages, newContent)` for non-mutating message replacement. Modified all 4 SDK wrappers (`openai-wrapper.mjs`, `anthropic-wrapper.mjs`, `gemini-wrapper.mjs`, `minimax-wrapper.mjs`) to parse directives before injection: `off` skips injection for the current turn, `deep` doubles the token budget via `DEFAULT_TOKEN_BUDGET * 2`, `none` sets a `memoryDisabledForSession` closure flag that persists across calls, `only:<theme>` uses the theme as the retrieval query. Directives are stripped from user prompt text before the LLM API call. Gemini wrapper includes internal `replaceGeminiPromptText` helper for format-specific text replacement. 33 new tests. 10 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches. **Block 7 complete (4/4).**

## Block 8 — Consolidation cycle

Decay, reinforcement, clustering, summaries. See REFERENCE_PLAN.md §Phase 8.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 8 | 8.1 | v8.1 | [x] | Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote) |

> **Step 8.1 closed.** Created `lib/consolidation.mjs` — consolidation jobs library with 5 constants and 7 exported functions: `initConsolidationTables` (entities_archived table), `decayWeights` (salience half-life 14d + archival below 0.05), `reinforceCoOccurrence` (co-occurrence join ≥3 sessions → bump salience + mention_count), `detectClusters` (union-find clustering ≥5 co-occurrences → theme candidates), `regenerateSummaries` (wraps obsidian-summarizer with graceful degradation), `detectContradictions` (wraps surfaceConflicts from conflict-surfacing.mjs), `evaluatePromotionCandidates` (entity mention ≥10 + decision confidence ≥0.95 per Block 4 policy). Created `bin/consolidate.mjs` — CLI orchestrator with `runConsolidationCycle` running all jobs in sequence. 14 new tests. 10 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
| 8 | 8.2 | v8.2 | [x] | Schedule + budget consolidation cycle (~5 min quiet periods) |

> **Step 8.2 closed.** Created `bin/consolidation-scheduler.mjs` — consolidation scheduler module with dual idle detection (in-process `ollama-queue.getState()` + Ollama HTTP `/api/ps`), 5-minute hard cap via AbortController timeout, and `createConsolidationScheduler` factory with `start`/`stop`/`runOnce`. Exports 4 constants (`IDLE_THRESHOLD_MS`, `HARD_CAP_MS`, `ANALYSIS_QUIET_MS`, `DEFAULT_INTERVAL_MS`) and 5 functions (`isOllamaIdle`, `isQueueIdle`, `isSystemIdle`, `runScheduledCycle`, `createConsolidationScheduler`). CLI supports single-shot (launchd) and `--daemon` modes. Created `services/launchd/ai.openclaw.consolidation-scheduler.plist` with `StartInterval` 1800 (30 min). 14 new tests. 10 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches. **Block 8 complete (2/2).**

## Block 9 — Broadcast protocol

context.broadcast/offer/accepted. See REFERENCE_PLAN.md §Phase 9.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.1 | v9.1 | [x] | Define broadcast/offer/accepted schemas in event-schemas package |

> **Step 9.1 closed.** Added three broadcast protocol schemas (`ContextBroadcastSchema`, `ContextOfferSchema`, `ContextAcceptedSchema`) to `packages/event-schemas` as a new `src/broadcast/` directory, following the same `EventEnvelopeSchema.extend()` pattern as Block 1's memory event schemas. `BroadcastEventSchema` discriminated union provides type-safe routing by `event_type` literal. All schemas match RESUME.md §0 Block 9 frozen decisions field-for-field: broadcast has `dedup_key`, offer has `expires_at` + `provenance`, accepted has optional `feedback`. 12 new tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.
| 9 | 9.2 | v9.2 | [x] | Implement broadcaster (consolidation-driven, with TTL + de-dup) |

> **Step 9.2 closed.** Created `lib/broadcast-emitter.mjs` — the context broadcaster module. Exports `createBroadcaster(nc, nodeId, opts)` factory returning `{ maybeBroadcast, broadcastFromConsolidation, stop, stats }`. `inferIntensity(prompt)` pure function classifies prompts as `actively_seeking`/`interested`/`passive` via pattern matching. `computeDedupKey(themes, entities)` produces deterministic SHA-256 from canonicalized theme∪entity set. `inferProblemClass(prompt)` maps to schema enum. Per-prompt path gates on ≥3 themes, 60s rate limit, 15-min dedup window, and passive+unchanged skip. Consolidation path bypasses rate limit but respects dedup. Validates against `ContextBroadcastSchema` before publishing to `context.broadcast.<nodeId>`. 23 new tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.
| 9 | 9.3 | v9.3 | [x] | Implement offerer (local retrieve → score → publish offer) |

> **Step 9.3 closed.** Created `lib/broadcast-offerer.mjs` — the context offerer module. Exports `createOfferer(nc, nodeId, opts)` factory returning `{ start, stop, stats, _processBroadcast }`. Subscribes to `context.broadcast.>` on the shared stream, skips self-originated and TTL-expired broadcasts, retrieves locally relevant content via the 5-channel retrieval pipeline, filters by `RELEVANCE_THRESHOLD` (0.55), caps at `MAX_ARTIFACTS_PER_OFFER` (3), generates relevance summaries via LLM with data-only fallback, validates against `ContextOfferSchema`, and publishes to `context.offer.<nodeId>`. Privacy pre-filter via `filterPrivateItems` forward-compatible with Step 9.5's `private` column migration. 24 new tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.
| 9 | 9.4 | v9.4 | [x] | Implement acceptor + inject offers into agent prompt + emit context.accepted |

> **Step 9.4 closed.** Created `lib/broadcast-acceptor.mjs` — the context acceptor module. Exports `createAcceptor(nc, nodeId, opts)` factory returning `{ start, stop, stats, getPendingOffers, getTopOffer, checkAcceptance, _processOffer }`. Subscribes to `context.offer.>` on the shared stream, filters to offers where `responding_to` matches this node's own broadcast IDs, checks TTL expiry via `expires_at`, queues valid offers in a capped pending list (MAX_PENDING_OFFERS=10). `getTopOffer()` returns formatted `[peer-memory: ...]` block for injection. `checkAcceptance(prompt)` computes token overlap (TOKEN_OVERLAP_THRESHOLD=0.3) between user prompt and offer summaries; on match, emits `context.accepted` with artifact refs and causation chain. `parseArtifactRef` parses `session:<id>:chunk:<id>` format. `computeTokenOverlap` uses Unicode-aware tokenization. 28 new tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.
| 9 | 9.5 | v9.5 | [ ] | Privacy markers (private: true) + default-private retrieval policy |

---

## Totals

| Block | Steps | Cumulative |
|-------|-------|------------|
| 0 | 7 | 7 |
| 1 | 4 | 11 |
| 2 | 5 | 16 |
| 3 | 4 | 20 |
| 4 | 9 | 29 |
| 5 | 5 | 34 |
| 6 | 4 | 38 |
| 7 | 4 | 42 |
| 8 | 2 | 44 |
| 9 | 5 | 49 |

**49 atomic steps total** across 10 blocks (updated from 48 after Block 6 expanded from 3 to 4 steps per frozen decisions — Step 6.4 historical session backfill added by operator). Per the framework, each block ends with a
`BLOCK_<N>_COMPLETE.md` sentinel doc + a top-level milestone marker.
