# OpenClaw Memory Plan — Resume Doc

**Workplan status.** Block 2 closed; Block 3 awaits operator Gulf 1 evaluation + frozen decisions.
**Current version carrier.** `v2.5` (Step 2.5 closed; Block 2 complete 5 of 5).
**Streaks.** zero-Phase-4-correction: 0 of 5 (Block 2) · zero-Phase-8-patch: 5 of 5 (Block 2).
**Last commit on plan branch.** v2.5 — Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate.

A fresh worker reading only this file should be able to resume the workplan with no
conversational context. The Framework that governs how steps are executed is at
[FRAMEWORK.md](FRAMEWORK.md). The full implementation plan is at
[REFERENCE_PLAN.md](REFERENCE_PLAN.md). The step list is at [INVENTORY.md](INVENTORY.md).

---

## §0 — Block-level frozen decisions

These constraints apply to every step in the **current block** and are not
re-litigated per step. Each block transition resets §0 with the block's own constraints.

### Working principles (apply to all blocks)

- **Local-first.** No phase may break local offline operation. Federation features are opt-in capabilities.
- **One commit per step.** No mid-step commits, no amends, no force-pushes. The Phase 9 commit is the only commit a tick produces.
- **Block on architectural choices.** If a step needs a decision not already captured in §0 or in the prior step's `AUDIT_POST §6` carry-forwards, write `BLOCKED.md` and stop. The autonomous worker does not improvise architecture.
- **Tests are a hard gate.** A red `npm test` at Phase 5 is a block trigger, not a "fix forward" cue.
- **Workspace files are out of repo.** `/Users/moltymac/.openclaw/workspace/` is the live runtime tree (MEMORY.md, .companion-state.md, memory/*). When a step touches a workspace file, the **change is documented in the audit doc** but the workspace file itself is not committed (it's not git-tracked). Plan ledgers committed to the repo describe what landed in the workspace.

### Block 1 frozen decisions (CLOSED — preserved for reference)

Block 1 completed 2026-05-21. All 4 steps (v1.1–v1.4) closed. See `memory-plan/audits/BLOCK_1_COMPLETE.md`.

### Block 2 frozen decisions

Authored 2026-05-21 by operator (interactive viewer session).

**Validation gate (REFERENCE_PLAN §1 "Validation") — skipped, not honored.** REFERENCE_PLAN calls for one week of dual-write shadow mode before Block 2 starts. Skipping is deliberate: the dual-write is genuinely shadow-only (existing MEMORY.md + session-store writes are unchanged; the local event log is additive), so the risk of breakage is bounded. The semantic-search Gulf-1 evaluation in Step 2.5 is the more valuable signal anyway. **Record:** if validation reveals event-log issues later, fix forward — do not roll back Block 2.

**Step 2.1 sqlite-vec stack scoping — extend `lib/mcp-knowledge/core.mjs`.** It already implements sqlite-vec + `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1 adds session-JSONL-turn embedding to this existing stack. **One embedding stack, two data sources** (markdown files + session messages). No Ollama install, no BGE-M3, no parallel vec table in session-store. This contradicts REFERENCE_PLAN §2.1's literal "install Ollama, pull bge-m3" instructions and is intentional — the plan was written before the operator confirmed mcp-knowledge was already wired.

**Block 2 hard scope — Phase 2 only (Steps 2.1–2.5).** Steps 2.1–2.4 implement extend-mcp-knowledge + hybrid search (FTS5 + semantic via reciprocal rank fusion). Step 2.5 is the manual evaluation against 20–30 real historical queries — the **major decision gate** for the entire memory plan. **Block 3 (LLM extraction) does NOT begin until Step 2.5's evaluation results are scored AND the operator authors Block 3 frozen decisions here.** If hybrid retrieval is no-better-or-worse than FTS5 on real data, the plan terminates at Block 2.

**Embedding model — ~~Xenova/all-MiniLM-L6-v2 (384-dim)~~ → AMENDED 2026-05-22 → Xenova/bge-m3 (1024-dim, multilingual).** Upgrade rationale: nodes deploy worldwide and must handle non-English content; MiniLM is English-only and benchmarks ~10 points lower on retrieval (MTEB ~41 vs BGE-M3 ~58). Latency trade-off (~200-300ms/query vs ~10ms) is acceptable for interactive use. Switch performed as an operator chore commit at the Block 2 → Block 3 boundary (tree clean, Block 2 closed). Steps required:
- `lib/mcp-knowledge/core.mjs`: `MODEL_NAME` and `EMBEDDING_DIM` constants updated.
- `test/embed-benchmark.test.mjs`: frozen-decision assertions + latency threshold updated (500ms target vs 100ms).
- `~/.openclaw/workspace/.knowledge.db` wiped; `~/.openclaw/.embed-migration-checkpoint.json` cleared; `bin/embed-existing-sessions.mjs` re-run in background (~1-3 hours for 225 sessions).
- Live MCP knowledge daemon experiences ~1-3h window of empty semantic results while re-embed runs; markdown indexer will repopulate on its next scheduled scan.

**Test baseline for Block 2:** the existing 73 pre-existing failures are still expected to fail; do not chase them. Step 2.1 begins from the v1.4 commit (`2511c75`) baseline.

### Block 3 frozen decisions

Authored 2026-05-22 by operator. Gulf-1 outcome: skip-formal-scoring; structural result already decisive — FTS5 returned 2/125 hits (broken on natural-language queries due to AND-on-tokens), semantic returned 125/125 with on-target snippets. Proceed to Block 3 (LLM extraction).

**Extraction LLM — Qwen3.5-27B-Instruct via `mlx-lm`** (Apple Silicon native; ~3-5 tokens/sec on M4 for structured-output JSON). Already in the operator's stack. No Ollama. No cloud APIs. No fallback to a smaller model unless mlx-lm setup proves blocking, in which case Ollama runtime is acceptable; the model choice (Qwen3.5-27B) is fixed.

**Block 3 hard scope — Phase 3 only (Steps 3.1–3.4).** No bundling of Phase 4 (federation). Steps:
- **Step 3.1** — Set up Qwen3.5-27B via `mlx-lm`; benchmark structured-output extraction latency on a 40-turn tail (target: total ≤30 sec, acceptable end-of-session work).
- **Step 3.2** — Design extraction prompt + Zod schema (`ExtractionResult`) covering entities, themes, actions, decisions, friction_signals, relationships. Prompt template in `lib/extraction-prompt.mjs`; schema in `lib/extraction-schema.mjs`.
- **Step 3.3** — Wire into the daemon. Replace `pre-compression-flush.mjs:extractFacts` (regex) with `extractStructured(tailMessages)` (LLM call). New SQLite tables: `entities`, `themes`, `mentions`, `decisions`. MEMORY.md generated from these tables, not raw regex fragments. **Feature flag `USE_LLM_EXTRACTION` defaults true; setting it false restores the regex extractor** for emergency rollback.
- **Step 3.4** — Manual validation: pick 10 recent sessions, run both extractors, manually compare MEMORY.md output quality (semantic coherence, fragment count, signal/noise).

**Validation gate before Block 4:** Step 3.4 must produce a written assessment in `memory-plan/eval/block-3-validation.md` showing LLM extraction is visibly better than regex on real sessions. If it's not better, prompt iteration is required before Block 4 begins; if it's persistently worse, Block 3 work is reverted via the feature flag and the plan continues with regex extraction (Block 4 doesn't depend on LLM extraction).

**Test baseline carrying into Block 3:** post-BGE-M3-upgrade, the embed-benchmark test will run on bge-m3 (1024-dim). Expected baseline: 559 tests with the same 73 pre-existing failures. After Step 3.1, +3-5 tests added for Qwen setup verification.

**Carry-forward to Block 4:** federation primitives (promoter, subscriber, JetStream cluster activation) do NOT depend on LLM extraction; they only need the local event log substrate from Block 1 to be working. If Step 3.4 hits problems, Block 4 can start in parallel.

### Carry-forward from Block 0 + Block 1

- **Phase 2 scope must be revisited before Block 2 starts.** `lib/mcp-knowledge/core.mjs` already implements sqlite-vec + embeddings via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1's first deliverable is a written re-scoping decision.
- **Zod** is a workspace package dependency (`packages/event-schemas`), not a root dependency.
- **NATS JetStream** has local stream `local-events-${NODE_ID}` (R=1) and shared stream config `OPENCLAW_SHARED` (R=3, idle).
- **`docs/ARCHITECTURE.md`** has stale references to `frontend-activity` and `session-fingerprint.json`.
- **COMPANION variable name** in `daily-log-writer.mjs:34` is cosmetic.
- **Test fixture `confidence`** in `test/memory-budget.test.mjs` — harmless extra property.
- **`pre-compact.sh`** is a no-op stub awaiting Block 4 rewiring.
- **`docs/STATE_FILES.md`** should be updated to document `~/.openclaw/artifacts/` directory and shared stream.
- **`lib/artifacts.mjs`** has no caller wiring; peer NATS RPC is Block 4.
- **`ensureSharedStream`** has no caller wiring; promoter/subscriber are Block 4.
- **`npm install`** may still be blocked. No new dependencies since Block 1.
- **NATS cluster** must have ≥3 nodes for R=3 to succeed (infrastructure prerequisite).

---

## §1 — Per-step close paragraphs

### Step 0.1 — Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

Closed at v0.1. `MemoryBudget.reload()` now fires after both daemon flush paths
(pre-compression at line 835, end-of-session at line 874) and via an optional NATS
subscription on `mesh.memory.compaction_completed` (line 1054). The NATS connection is
optional with graceful degradation — if NATS is unavailable, the daemon continues to work
locally. One new test added. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.2: the daemon now has an async shutdown handler
and an optional `natsConn` in `main()` scope.

### Step 0.2 — Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers)

Closed at v0.2. Daemon state file renamed from `.companion-state.md` to
`.daemon-state-${NODE_ID}.md` across all four readers: `memory-daemon.mjs` (line 526),
`session-start.sh` (line 33), `daily-log-writer.mjs` (line 34), and
`mission-control/src/app/api/tasks/route.ts` (line 23). Function `readCompanionState`
renamed to `readDaemonState`. Migration script `scripts/migrate-companion-state.mjs`
added — idempotent, detects daemon-written files via `## Session Status` / `last_flush`
markers. `NODE_ID` derived consistently as `process.env.OPENCLAW_NODE_ID || os.hostname()`
across all JS/TS files and `${OPENCLAW_NODE_ID:-$(hostname)}` in shell. 6 positive audit
findings, zero Phase 4 corrections, zero Phase 8 patches. Carry-forwards to Step 0.3:
`COMPANION` variable name retained in daily-log-writer (cosmetic, deferred); session-start.sh
sandbox restriction requires operator pre-apply for Step 0.6; test baseline unchanged at 467.

### Step 0.3 — Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup)

Closed at v0.3. Replaced the parenthetical merge format `(updated: ...)` in `mergeFacts`
with a supersedes-comment model: merged entries now write the NEW fact verbatim plus an
invisible `<!-- supersedes: <8-char-sha256> -->` HTML comment. Added
`cleanParentheticalChains(content)` to strip legacy chains (keeps only the innermost/most
recent segment). Added `stripSupersedes(text)` for clean similarity comparison. 5 new
regression tests cover 10-merge accumulation, nested chain cleanup, supersedes presence,
comment stripping, and no-chain passthrough. `crypto` import added (Node.js built-in, no
new dependency). 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.4: test baseline now 472 (399 pass, 73 fail pre-existing);
`extractFacts` still filters `role === 'user'` only; `confidence` field still unused;
`crypto` import shifts line numbers in `pre-compression-flush.mjs`.

### Step 0.4 — Include assistant-role messages in extraction + add speaker field + new patterns

Closed at v0.4. Opened `extractFacts` role filter to include assistant messages
alongside user messages (line 166). Added `stripSpeaker(text)` helper (line 203) to
remove `[user]`/`[assistant]` prefix before similarity comparison. Added two
assistant-voice pattern groups: `agent_action` (line 160) for intent declarations
(`I'll`, `I'm going to`, etc.) and `finding` (line 162) for observations (`I found`,
`I noticed`, etc.). Added `speaker: msg.role` field on all extracted fact objects
(line 180). Updated `mergeFacts` to format entries with `[speaker]` prefix and strip
speaker tags during similarity comparison and hash computation. 5 new tests cover
assistant inclusion, speaker field, pattern matching, tool exclusion, and speaker tag
formatting. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.5: test baseline now 477 (404 pass, 73 fail pre-existing);
`confidence` field still unused (deferred to Step 0.6); `stripSpeaker` exported at
line 203; speaker tags formatted as `[user]`/`[assistant]` in MEMORY.md entries;
`agent_action` and `finding` categories are new (no downstream consumer filters by
category yet).

### Step 0.5 — Fix mid-word truncation via truncateAtWord helper

Closed at v0.5. Added `truncateAtWord(text, maxLen)` helper at
`lib/pre-compression-flush.mjs:212` to replace the hard `.slice(0, 120)` in
`extractFacts` (line 173). The helper truncates at the last space before `maxLen`,
with a 0.7 fallback threshold that avoids absurdly short results when a single word
is very long (falls back to hard slice if `lastSpace < maxLen * 0.7`). 4 new tests
cover short-text passthrough, word-boundary truncation, long-word fallback, and
exact-length passthrough. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.6: test baseline now 481 (408 pass, 73
fail pre-existing); `confidence` field still unused (Step 0.6 deletes it);
`truncateAtWord` exported at line 212; `cleanParentheticalChains` shifted to line 222.

### Step 0.6 — Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field)

Closed at v0.6. Removed four dead artifacts that were written but never read by any
in-repo consumer. (1) `.claude/hooks/pre-compact.sh`: removed `STATE_FILE` variable and
the entire `.pre-compact-state.md` write block; hook retained as no-op stub for future
Block 4 rewiring. (2) `workspace-bin/session-recap`: deleted `FINGERPRINT_FILE` constant,
`extractFingerprint` function (~60 lines), `writeFingerprint` function (~12 lines), and
the fingerprint caller block in `main()`. (3) `workspace-bin/auto-checkpoint`: deleted
`ACTIVITY_FILE` variable and `touch "$ACTIVITY_FILE"`. (4) `lib/pre-compression-flush.mjs`:
removed `confidence` property from all 7 pattern objects, from the loop destructuring, from
the fact push, and from both JSDoc annotations. `extractFacts` return shape is now
`{ fact, category, speaker }`. 1 new regression test asserts `confidence` is absent from
returned fact objects. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8
patches. Carry-forwards to Step 0.7: test baseline now 482 (409 pass, 73 fail pre-existing);
`docs/ARCHITECTURE.md` has stale references to `frontend-activity` and
`session-fingerprint.json` (out of Block 0 scope, defer or address if Step 0.7's
`docs/STATE_FILES.md` work opens the door); `pre-compact.sh` is a no-op stub; test
fixture data still passes `confidence` in some `mergeFacts` calls (harmless, cosmetic).

### Step 0.7 — Document state files (docs/STATE_FILES.md)

Closed at v0.7. Created `docs/STATE_FILES.md` — comprehensive reference inventory of
every runtime state file the memory infrastructure writes. Organized by location:
workspace runtime files (`~/.openclaw/workspace/`), daemon internal state (`.tmp/`),
SQLite databases (`~/.openclaw/`), and configuration files (`~/.openclaw/config/`).
Each entry documents owner process, format, lifetime, and consumers. Includes a
"Files removed in Block 0" section tracking the four artifacts deleted in Step 0.6.
Documentation-only step: zero functional code changes, zero new tests. 6 positive
audit findings, zero Phase 4 corrections, zero Phase 8 patches. **Block 0 complete
(7/7).**

### Step 1.1 — Create packages/event-schemas (zod envelope + memory event payloads + discriminated union)

Closed at v1.1. Created the `packages/event-schemas` workspace package — the foundational
schema layer for the event-sourced memory infrastructure. EventEnvelopeSchema defines the
13-field canonical event envelope (event_id, event_type, event_version, entity_id,
entity_type, timestamp, causation_id, correlation_id, actor, node_id, idempotency_key).
Eight memory event payload schemas extend the envelope with literal `event_type`
discriminators and typed `data` payloads: session-started, session-ended, turn-recorded,
fact-extracted, concept-mentioned, snapshot-taken, compaction-triggered, artifact-attached.
MemoryEventSchema provides a `z.discriminatedUnion` for runtime validation by event_type.
`toJsonSchema()` generates JSON Schema for cross-language consumers. npm workspaces enabled
at root (`"workspaces": ["packages/*"]`) with a `pretest` script that builds workspace
packages before tests. 15 new tests. 6 positive audit findings, 1 Phase 8 patch
(`.gitignore` for `packages/*/dist/`). Carry-forwards to Step 1.2: test baseline now 497;
`npm install` was blocked during this tick — event-schemas build script uses
mission-control's tsc (workaround), `toJsonSchema` has an `as any` cast for Zod 4/3
type mismatch — both resolve when workspace deps are properly installed; event-schemas
package exports are ready for import by `lib/local-event-log.mjs`.

### Step 1.2 — Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring)

Closed at v1.2. Created `lib/local-event-log.mjs` — the per-node event log substrate backed
by NATS JetStream. `createLocalEventLog(nc, nodeId)` ensures a JetStream stream
`local-events-${NODE_ID}` exists (R=1, file storage, `local.>` subject filter) and returns
a `publishLocal(event)` method that validates against `MemoryEventSchema` and publishes with
`idempotency_key` as `msgID` for dedup. `buildMemoryEvent()` helper constructs
envelope-conformant events with auto-generated `event_id`, `timestamp`, and `idempotency_key`.
Dual-write wired into `MemoryBudget` at three sites: `startSession()` publishes
`memory.session_started`, `endSession()` publishes `memory.session_ended`, `addEntry()`
publishes `memory.fact_extracted`. All publishing is fire-and-forget via `#publishEvent()`
private helper — errors are caught silently to ensure the event log never disrupts the
primary MEMORY.md write path (shadow mode). The daemon initializes the event log after NATS
connection and passes it as `eventLog` option to `createBudget`. 9 new tests cover event
construction, schema validation, dual-write integration, and error isolation. 6 positive
audit findings, 0 Phase 8 patches. Phase-4-correction streak reset to 0 (test count
underestimated in AUDIT_PRE: planned 7, delivered 9). Carry-forwards to Step 1.3: test
baseline now 506; `createLocalEventLog` and `buildMemoryEvent` are available for use by
the artifact store; MemoryBudget accepts `eventLog` and `nodeId` options.

### Step 1.3 — Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/)

Closed at v1.3. Created `lib/artifacts.mjs` — the content-addressed artifact store under
`~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>` with `.meta.json` sidecars. Four exported
functions: `putArtifact(bytes, opts)` computes SHA-256, writes to sharded path, writes
`.meta.json` sidecar with `{ ref, size, mime_type, filename, created_at, encoding }`, returns
`{ ref, size, path }`. Idempotent: existing file → skip write. `getArtifact(ref)` reads bytes
from local path, throws on miss (peer NATS RPC deferred to Block 4). `hasArtifact(ref)` returns
boolean. `validateArtifact(ref)` re-hashes stored bytes and compares to ref. No new dependencies
(Node.js built-ins: `node:crypto`, `node:fs/promises`, `node:path`, `node:os`). Configurable
base directory via `OPENCLAW_ARTIFACTS_DIR` env var or `baseDir` parameter. 6 new tests cover
roundtrip, existence check, integrity validation, tamper detection, idempotency, and sidecar
fields. 6 positive audit findings, 0 Phase 8 patches. Carry-forwards to Step 1.4: test baseline
now 512; `lib/artifacts.mjs` is standalone with no caller wiring; peer NATS RPC and event
publishing for artifacts deferred; `docs/STATE_FILES.md` update for artifacts directory deferred.

### Step 1.4 — Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4)

Closed at v1.4. Created `lib/shared-event-stream.mjs` — the shared JetStream stream
configuration module. Exports `ensureSharedStream(nc)` which creates/verifies the
`OPENCLAW_SHARED` stream with R=3 replication, File storage, and 7 federation subject
patterns (`kanban.events.>`, `lessons.shared.>`, `concepts.shared.>`,
`context.broadcast.>`, `context.offer.>`, `context.accepted.>`, `artifacts.shared.>`).
Exports `inspectSharedStream(nc)` for operational verification returning `{ config, state }`.
Exports `SHARED_STREAM_NAME` and `SHARED_SUBJECTS` constants. Infrastructure preparation
only — stream sits idle until Block 4 wires promoter/subscriber processes. 16 new tests
with mock NATS connection cover constants, stream creation, idempotency, storage type,
and inspection. 6 positive audit findings, 1 negative finding (`StorageType.File` value
assumption — numeric 2 vs actual string 'file'), 0 Phase 8 patches. Phase-4-correction
streak reset to 0. **Block 1 complete (4/4).**

### Step 2.1 — Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test

Closed at v2.1. Extended `lib/mcp-knowledge/core.mjs` with session-turn embedding capability.
Three deliverables landed: (1) Scope review documented in AUDIT_PRE §3 — decision is to extend
mcp-knowledge with parallel session tables (`session_documents`, `session_chunks`,
`session_chunk_vectors`) rather than mixing into existing document tables. One embedding stack,
two data sources. (2) sqlite-vec verified working — already loaded in mcp-knowledge via
`sqlite-vec` package. (3) Integration smoke test — 7 new tests prove session turns can be
embedded, stored, and searched alongside markdown chunks. New exports: `chunkSessionTurns(turns)`
for turn-aligned chunking with role prefix, `indexSessionTurns(db, sessionId, sourcePath, turns)`
for idempotent content-hash-based indexing, `searchSessions(db, query, limit)` for semantic search
over session chunks. `getStats()` updated to include `session_documents` and `session_chunks`
counts. `createKnowledgeEngine()` exposes `searchSessions` and `indexSessionTurns` methods.
6 positive audit findings, 1 negative (test count underestimate: planned 6, delivered 7),
0 Phase 8 patches.

### Step 2.2 — Choose embedding model + benchmark on real session data (latency target <100ms/turn)

Closed at v2.2. Confirmed Xenova/all-MiniLM-L6-v2 (384-dim) as the embedding model per
Block 2 frozen decisions (no Ollama, no BGE-M3 — overrides REFERENCE_PLAN §2.2). Benchmark
validates the model meets the <100ms/turn latency target by a wide margin (~5ms/turn on M4
after warm-up). 5 new tests in `test/embed-benchmark.test.mjs` across 2 describe blocks:
"embedding model identity" (3 tests: model name matches frozen decision, dimension is 384,
output is L2-normalized) and "embedding latency benchmark" (2 tests: per-turn mean <100ms on
50 synthetic turns, batch of 100 turns <10s). Synthetic turns model real session patterns
(NATS config, code review, architecture discussion, debugging, artifact store, spreading
activation). 6 positive audit findings, 0 negative, 0 Phase 8 patches.

### Step 2.3 — Chunk and embed existing sessions (resumable migration with checkpoint file)

Closed at v2.3. Created `bin/embed-existing-sessions.mjs` — a standalone resumable migration
script that reads all sessions from the session-store DB (`~/.openclaw/state.db`) and indexes
their embeddings into the mcp-knowledge database via the existing `indexSessionTurns()`
infrastructure. The script opens the session store read-only (`{ readonly: true }` flag in
better-sqlite3), iterates all sessions, queries their messages, forms turns arrays, and calls
`indexSessionTurns()` for each. Checkpoint file at `~/.openclaw/.embed-migration-checkpoint.json`
tracks completed session IDs after each session for crash resumability. SIGINT handler enables
graceful mid-migration shutdown. Session source path uses synthetic URI format
`session-store://<session-id>`. `indexSessionTurns()` idempotency (content-hash check) provides
a second layer of dedup. 5 new tests in `test/embed-existing-sessions.test.mjs`: migrate 2
sessions, idempotent re-run, checkpoint file verification, empty session store, zero-message
session skip. 6 positive audit findings, 0 negative, 0 Phase 8 patches.

### Step 2.4 — Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags

Closed at v2.4. Extended `lib/mcp-knowledge/core.mjs` with three search modes: FTS5 keyword
search (`searchSessionsFts` at line 712), Reciprocal Rank Fusion combiner (`reciprocalRankFusion`
at line 768), and hybrid search (`hybridSearchSessions` at line 804) which fuses FTS5 + semantic
via RRF. Added `session_chunks_fts` FTS5 virtual table with external content mode
(`content='session_chunks', content_rowid='id'`) and sync triggers (AFTER INSERT, AFTER DELETE)
in `initDatabase()`. One-time FTS5 rebuild for pre-existing data via `session_fts_built` meta key.
Updated `searchSessions()` to include `chunk_id` field for RRF deduplication keying. Updated
`createKnowledgeEngine()` to expose `searchSessionsFts` and `hybridSearchSessions` methods.
Created `bin/session-search.mjs` CLI tool with `--semantic`/`--hybrid`/`--fts` flags (default:
hybrid), `--limit N`, `--db PATH` options. Uses `node:util` parseArgs (zero external dependencies).
7 new tests in `test/hybrid-search.test.mjs`: RRF merge+boost, RRF empty input, RRF single set,
FTS5 keyword hit, FTS5 no-match, hybrid combined results, hybrid ranking. 7 positive audit
findings, 0 negative, 0 Phase 8 patches.

### Step 2.5 — Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate

Closed at v2.5. Created `bin/run-gulf1-eval.mjs` — the Gulf 1 evaluation runner that queries
all three search modes (FTS5, semantic, hybrid) against a curated query set and produces a
structured markdown results document with scoring columns for manual operator review. Exports
`parseQuerySet`, `runEvaluation`, `formatResults`, `aggregateScores`, and `checkDatabaseReadiness`.
Created `memory-plan/eval/gulf1-queries.json` with 25 queries across 8 categories (architecture,
memory-lifecycle, architecture-decision, semantic-layer, extraction, infrastructure, search,
federation). Each query has `id`, `query`, `category`, and `expected_topic` fields. The results
document includes per-query tables showing top-5 results from each mode with empty 0-2 scoring
columns, plus an aggregate scores section and a go/no-go decision checklist. Operator must run
the evaluation against live databases and score results before Block 3 can begin. 7 new tests in
`test/gulf1-eval.test.mjs`: parseQuerySet valid/invalid/missing-field, runEvaluation 3-mode
structured results, empty database handling, formatResults markdown output, checkDatabaseReadiness
counts. 6 positive audit findings, 1 negative (test count underestimate: planned 5, delivered 7),
0 Phase 8 patches. **Block 2 complete (5/5).**

---

## §N+1 — Progress tracker

```
Steps closed:               16 / 45
Current block:              Block 2 closed — Local semantic layer (5 of 5 steps closed)
Steps closed in block:      5 / 5
Consecutive zero-Phase-4-correction streak:  0 (reset in Step 2.5)
Consecutive zero-Phase-8-patch streak:       5
Test baseline (npm test):   559 tests (486 pass, 73 fail pre-existing)
Last successful tick:       2026-05-21 (Step 2.5)
Last block file written:    memory-plan/audits/BLOCK_2_COMPLETE.md
```

---

## Next-tick checklist

The next scheduled tick should:

1. Run pre-flight (Framework §8).
2. Decode state: `VERSION` is `v2.5` (no suffix) → Start NEXT step at Phase 1.
3. Read `INVENTORY.md` → first `[ ]` row is Step 3.1.
4. **STOP.** Block 3 frozen decisions have NOT been authored in §0 yet.
5. The operator must first:
   a. Run `bin/embed-existing-sessions.mjs` to populate session embeddings.
   b. Run `bin/run-gulf1-eval.mjs` to generate `memory-plan/eval/gulf1-results.md`.
   c. Manually score results (0-2 per result) and make the go/no-go decision.
   d. If proceeding, author Block 3 frozen decisions in RESUME.md §0.
6. Until Block 3 frozen decisions are authored, the next tick should write `BLOCKED.md`
   with reason: "Block 3 frozen decisions not yet authored; Gulf 1 evaluation pending."
