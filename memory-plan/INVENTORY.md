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
| 1 | 1.2 | v1.2 | [ ] | Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring) |
| 1 | 1.3 | v1.3 | [ ] | Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/) |
| 1 | 1.4 | v1.4 | [ ] | Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4) |

## Block 2 — Local semantic layer

Major gate. Add semantic retrieval; validate against real queries (Gulf 1 close).
See REFERENCE_PLAN.md §Phase 2. **NOTE:** scope must be revisited before starting — `lib/mcp-knowledge/`
already implements sqlite-vec + embeddings against the workspace. Step 2.1 begins with a scope review
gate per RESUME.md §0.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test |
| 2 | 2.2 | v2.2 | [ ] | Choose embedding model + benchmark on real session data (latency target <100ms/turn) |
| 2 | 2.3 | v2.3 | [ ] | Chunk and embed existing sessions (resumable migration with checkpoint file) |
| 2 | 2.4 | v2.4 | [ ] | Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags |
| 2 | 2.5 | v2.5 | [ ] | Manual evaluation against 20-30 real queries; spreadsheet of results; **Gulf 1 gate** |

## Block 3 — LLM-driven extraction

Replace regex extraction with structured-output LLM. See REFERENCE_PLAN.md §Phase 3.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session) |
| 3 | 3.2 | v3.2 | [ ] | Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships) |
| 3 | 3.3 | v3.3 | [ ] | Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite |
| 3 | 3.4 | v3.4 | [ ] | Validate LLM vs regex extraction on 10 sessions; document quality delta |

## Block 4 — Federation primitives

Promoter, subscriber, provenance, policy. See REFERENCE_PLAN.md §Phase 4.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | Define promotion policies (config/promotion-policy.yaml) |
| 4 | 4.2 | v4.2 | [ ] | Implement promoter (bin/memory-promoter.mjs) |
| 4 | 4.3 | v4.3 | [ ] | Implement subscriber (bin/memory-subscriber.mjs) |
| 4 | 4.4 | v4.4 | [ ] | Add provenance fields (source_type, source_node, source_event_id) to local stores |
| 4 | 4.5 | v4.5 | [ ] | Always-ingest kanban events into tasks_observed |
| 4 | 4.6 | v4.6 | [ ] | Conflict surfacing in retrieval pipeline (describeConflict) |

## Block 5 — Thematic substrate

Per-node Obsidian vault + wikilink graph + adjacency cache. See REFERENCE_PLAN.md §Phase 5.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/ |
| 5 | 5.2 | v5.2 | [ ] | Auto-generate concept notes from entity store (frontmatter + body via LLM) |
| 5 | 5.3 | v5.3 | [ ] | Build wikilink graph parser (lib/obsidian-graph.mjs) |
| 5 | 5.4 | v5.4 | [ ] | Cache adjacency in SQLite + periodic refresh job (fsevents/10-min) |
| 5 | 5.5 | v5.5 | [ ] | Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/) |

## Block 6 — Spreading activation

Associative retrieval algorithm + 5-channel pipeline. See REFERENCE_PLAN.md §Phase 6.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | Implement spreading-activation algorithm (lib/spreading-activation.mjs) |
| 6 | 6.2 | v6.2 | [ ] | Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank |
| 6 | 6.3 | v6.3 | [ ] | Tune decay/steps/threshold on the same evaluation set from Step 2.5 |

## Block 7 — Proactive injection

Per-turn ambient memory in prompts. See REFERENCE_PLAN.md §Phase 7.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [ ] | Implement query analysis (per-prompt theme/entity extraction, ~50ms) |
| 7 | 7.2 | v7.2 | [ ] | Pre-retrieve and budget ambient memory (cap 500-1000 tokens) |
| 7 | 7.3 | v7.3 | [ ] | Inject as system-message prefix with [memory: ...] delimiters |
| 7 | 7.4 | v7.4 | [ ] | Runtime control: @memory off/deep/none |

## Block 8 — Consolidation cycle

Decay, reinforcement, clustering, summaries. See REFERENCE_PLAN.md §Phase 8.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 8 | 8.1 | v8.1 | [ ] | Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote) |
| 8 | 8.2 | v8.2 | [ ] | Schedule + budget consolidation cycle (~5 min quiet periods) |

## Block 9 — Broadcast protocol

context.broadcast/offer/accepted. See REFERENCE_PLAN.md §Phase 9.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.1 | v9.1 | [ ] | Define broadcast/offer/accepted schemas in event-schemas package |
| 9 | 9.2 | v9.2 | [ ] | Implement broadcaster (consolidation-driven, with TTL + de-dup) |
| 9 | 9.3 | v9.3 | [ ] | Implement offerer (local retrieve → score → publish offer) |
| 9 | 9.4 | v9.4 | [ ] | Implement acceptor + inject offers into agent prompt + emit context.accepted |
| 9 | 9.5 | v9.5 | [ ] | Privacy markers (private: true) + default-private retrieval policy |

---

## Totals

| Block | Steps | Cumulative |
|-------|-------|------------|
| 0 | 7 | 7 |
| 1 | 4 | 11 |
| 2 | 5 | 16 |
| 3 | 4 | 20 |
| 4 | 6 | 26 |
| 5 | 5 | 31 |
| 6 | 3 | 34 |
| 7 | 4 | 38 |
| 8 | 2 | 40 |
| 9 | 5 | 45 |

**45 atomic steps total** across 10 blocks. Per the framework, each block ends with a
`BLOCK_<N>_COMPLETE.md` sentinel doc + a top-level milestone marker.
