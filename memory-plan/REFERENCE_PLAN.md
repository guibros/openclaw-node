# OpenClaw Memory Infrastructure — Definitive Implementation Plan

The consolidated implementation plan for the memory infrastructure upgrade, incorporating everything from the prior analyses: the harness review, the upgrade strategy, the local-first federation model, the event-sourced foundation, the shared schema package, and the broadcast protocol.

This supersedes prior phase plans. Steps are operational — file paths, package names, commands, validation procedures, rollback procedures. The plan is structured so any phase can stop the work without leaving the system worse than before.

---

## Scope and principles

**Scope:** the memory infrastructure across all OpenClaw nodes. Includes per-node local memory (the five-store architecture), the shared federation layer for cross-soul coordination, the cross-cutting schema and artifact infrastructure, and the broadcast protocol for context-driven peer contribution.

**Out of scope:** kanban-side work (covered in its own implementation plan). However, several phases here build infrastructure that the kanban work consumes — those phases are marked as `[shared with kanban]` where applicable.

### Working principles

1. **Close Gulf 1 before automating.** Every phase validates against real session data before declaring success. Manual evaluation precedes any threshold tuning.
2. **Local-first, federation-second.** The local node must work fully offline at every phase. Federation features are opt-in capabilities, never preconditions for basic operation.
3. **Phases are independently shippable.** Each delivers value alone. Stopping after any phase leaves a working system, not a half-finished one.
4. **Phases are independently revertible.** Feature flags, parallel running, shadow-mode validation. No phase is irreversible.
5. **Shared infrastructure built once.** Schema package, artifact store, event-log substrate — all shared with the kanban work, built one time.
6. **Defer what needs production data.** Tuning, threshold setting, policy parameters — all deferred until real data shapes them.

### What's different from prior plans

| Prior plan | Updated plan |
|---|---|
| Five-store memory globally | Five-store memory **per node** |
| Single canonical event log | **Two-layer**: per-node local log + shared federation log |
| RAG over centralized store | **Local-first retrieval**, federated in tiers |
| Event sourcing as future state | **Foundational primitive**, built in Phase 1 |
| Schema centralization as a refactor | **Foundational** — Phase 1, shared with kanban |
| No cross-soul context protocol | **Broadcast protocol** (Phase 9) |
| 8-12 weeks total | **~14-20 weeks if all phases land**, but value lands early |

### Phase summary

| # | Phase | Goal | Effort | Local/Shared | Gates next? |
|---|---|---|---|---|---|
| 0 | Stop the bleeding | Fix active bugs in existing harness | 1 week | Local | No |
| 1 | Schema & event foundations | Schema package, local log, artifact store | 2-3 weeks | Both | Yes |
| 2 | Local semantic layer | sqlite-vec, embeddings, hybrid search | 2 weeks | Local | **Major gate** |
| 3 | LLM-driven extraction | Replace regex with structured-output LLM | 1-2 weeks | Local | Yes |
| 4 | Federation primitives | Promoter, subscriber, provenance, policy | 2-3 weeks | Both | Yes |
| 5 | Thematic substrate | Per-node Obsidian, wikilink graph, adjacency | 2-3 weeks | Both | Yes |
| 6 | Spreading activation | The associative retrieval algorithm | 1-2 weeks | Local | Yes |
| 7 | Proactive injection | Per-turn ambient memory in prompts | 1 week | Local | Yes |
| 8 | Consolidation cycle | Decay, reinforcement, clustering, summaries | 1-2 weeks | Local | Yes |
| 9 | Broadcast protocol | context.broadcast/offer/accepted | 1-2 weeks | Both | — |

Phases 0-3 are ~6-8 weeks and deliver the bulk of the practical value. Phases 4-9 add cross-node collaboration and richer retrieval, each independently justified.

---

## Target architecture (where we're heading)

```
                          SHARED FEDERATION LAYER
                          NATS JetStream cluster (R=3)
                          ──────────────────────────
                          kanban.events.>            ← coordination
                          lessons.shared.>           ← cross-soul learning
                          concepts.shared.>          ← graph promotion
                          context.broadcast/offer/>  ← request/offer protocol
                          artifacts.shared.>         ← by-hash refs
                                ▲       │
                                │       │
                          ┌─────┴───────▼─────┐
                          │ promoter │ subscr │  ← bridge processes per node
                          └─────┬───────┬─────┘
                                │       │
   PER NODE  ──────────────────────────────────────────
                                │       │
   ┌─────────────────────────────────────────────────┐
   │  LOCAL EVENT LOG    ~/.openclaw/local-events/    │
   │  (sovereign, durable, offline-safe)             │
   └─────────────────────┬───────────────────────────┘
                         │ projections (single-writer each)
            ┌────────────┼──────────────────────┐
            ▼            ▼                       ▼
   ┌──────────────┐ ┌──────────┐  ┌────────────────────┐
   │ Episodic     │ │ Semantic │  │ Working memory     │
   │ SQLite+FTS5  │ │ sqlite-  │  │ MEMORY.md (frozen) │
   │ (turns,      │ │ vec      │  │                    │
   │  sessions)   │ │ (embeds) │  │                    │
   └──────────────┘ └──────────┘  └────────────────────┘

   ┌──────────────┐ ┌──────────────────┐ ┌────────────┐
   │ Entity store │ │ Thematic graph   │ │ Procedural │
   │ SQLite       │ │ Obsidian vault   │ │ lessons.md │
   │ + sqlite-vec │ │ + adjacency      │ │            │
   │              │ │ cache (SQLite)   │ │            │
   └──────────────┘ └──────────────────┘ └────────────┘

   ┌──────────────────────────────────────────────────┐
   │ Local artifact store  ~/.openclaw/artifacts/     │
   │ sha256/<prefix>/<hash> + .meta.json sidecars     │
   └──────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────┐
   │ Local retrieval pipeline (5-channel)             │
   │   1. FTS5 keyword  →  2. vector  →  3. entity   │
   │   4. theme seed    →  5. spreading activation   │
   │   →  rerank  →  context assembly                 │
   └─────────────────────┬────────────────────────────┘
                         │
                         ▼
              LOCAL AGENT (Claude/Daedalus/etc.)
              Reads merged context, acts, learns
```

The local agent sees ONE coherent memory — its own. The federation layer is reached through bridges (`promoter` writes outward, `subscriber` reads inward). Local sovereignty preserved at every layer.

---

## Phase 0 — Stop the bleeding

### Goal

Fix the active bugs identified in the harness review before adding complexity. The current system has known issues that will compound if upgraded over.

### Prerequisites

None. This is the first phase.

### Steps

**0.1 — Wire `MemoryBudget.reload()`**

The function exists at `lib/memory-budget.mjs:92` with tests, no caller. Add invocation:

1. In `memory-daemon.mjs`, after the `runFlush` call at line 822 and line 856, append `await memoryBudget.reload();`.
2. Add a NATS subscription on `mesh.memory.compaction_completed` that also triggers `reload()`. Future compaction signals (from companion-bridge, for example) flow through this subject.
3. Write a test in `test/memory-budget.test.mjs` that calls `reload()` after an external file change and verifies the new content is rendered.

**Validation:** start a session, manually modify `MEMORY.md`, trigger a flush, verify `getRendered()` returns updated content.

**Rollback:** revert the daemon changes; `reload()` returns to unwired state.

**0.2 — Resolve `.companion-state.md` collision**

Companion-bridge writes this file with a different schema than openclaw-node. Per-node sovereignty means each node should own its own file under a node-namespaced path.

1. Move openclaw-node's writes to `~/.openclaw/workspace/.daemon-state-${NODE_ID}.md`. Update `memory-daemon.mjs:525` and the related Phase 1 status sync.
2. Update readers: `session-start.sh` (line 32, the cat command), `daily-log-writer.mjs:96`, `mission-control/src/app/api/tasks/route.ts:19-46` (the `__LIVE_SESSION__` synthesis).
3. Add migration script `scripts/migrate-companion-state.mjs` that detects old `.companion-state.md` written by openclaw-node and renames it on first run.
4. Companion-bridge continues to use `.companion-state.md` for its own purposes; no collision because the names diverge.

**Validation:** run both daemon and companion-bridge, verify each writes to its own file, verify the `__LIVE_SESSION__` card pulls from the daemon's file.

**Rollback:** restore filename, revert readers.

**0.3 — Fix `mergeFacts` parenthetical chain**

In `pre-compression-flush.mjs:248`, the merge format `"<old> (updated: <new>)"` accumulates indefinitely. Replace with a clean "supersedes" model:

1. When merging (similarity 0.7-0.9), write the NEW fact verbatim and append a `<!-- supersedes-event-id: <id> -->` HTML comment.
2. When trimming under budget pressure, the comment is skipped (it's invisible to the prompt) so size doesn't grow.
3. Old chained entries get cleaned by a one-time migration: regex-strip `(updated: …)` chains, keep only the last segment.

**Validation:** create a test that runs mergeFacts 10 times on similar facts, verify the output stays clean.

**Rollback:** restore the old append format.

**0.4 — Include assistant-role messages in extraction**

`pre-compression-flush.mjs:148` filters `role === 'user'` only. Half the signal is invisible.

1. Change the filter to `role === 'user' || role === 'assistant'`.
2. Adjust extraction patterns: agent statements like "I'll switch to X" and "the API is at Y" need their own regex patterns (currently the patterns assume user voice).
3. Add a `speaker` field on each extracted fact so MEMORY.md entries note whether the user or agent declared the fact. Useful when an agent's wrong assertion needs auditing later.

**Validation:** rerun extraction on 10 recent real sessions, manually compare quality of extracted facts before/after.

**0.5 — Fix mid-word truncation**

`pre-compression-flush.mjs:175` slices to 120 chars without respecting word boundaries.

1. Replace `factText.slice(0, 120)` with `truncateAtWord(factText, 120)`:
   ```javascript
   function truncateAtWord(text, maxLen) {
     if (text.length <= maxLen) return text;
     const truncated = text.slice(0, maxLen);
     const lastSpace = truncated.lastIndexOf(' ');
     return lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated;
   }
   ```
2. The 0.7 threshold avoids absurdly short truncations when a word is unusually long.

**0.6 — Delete dead artifacts**

Files written by openclaw-node with no in-repo consumer:

1. Delete the write to `.pre-compact-state.md` in `pre-compact.sh` (the hook itself can stay — it will be rewired in Phase 4).
2. Delete the write to `.tmp/session-fingerprint.json` in `session-recap` (the fingerprint logic can stay as a development tool but doesn't need persistence).
3. Delete the touch of `.tmp/frontend-activity` in `auto-checkpoint` (the daemon's comment explicitly says touchfiles are unused).
4. Delete the `confidence` field from `extractFacts` return — it's computed but never consumed.

**Validation:** run a full session cycle, verify nothing breaks. None of these files have consumers, so deletion is safe.

**0.7 — Document state files**

Create `docs/STATE_FILES.md` listing every file the memory infrastructure writes, its owner, format, lifetime, and consumers. This is reference documentation that has no functional effect but prevents future "what is this file?" archaeology.

### Deliverables

- Fixed harness with no known active bugs
- Clean code paths (dead writes removed)
- State file inventory documented

### Validation

Run a 1-hour real session end to end. Verify:
- MEMORY.md compaction triggers correctly
- Extracted facts are readable (no truncation, no parenthetical chains)
- The daemon writes only to its namespaced state file
- No "dead file" warnings in logs

### Effort: 1 week

---

## Phase 1 — Schema & event foundations

### Goal

Build the cross-cutting infrastructure that both memory and kanban will use: the schema package, the local event log per node, and the content-addressed artifact store. This phase is **shared with the kanban work**.

### Prerequisites

Phase 0 complete. No active bugs in the existing memory paths.

### Steps

**1.1 — Create the schema package**

1. Add a workspace: `packages/event-schemas/`.
2. `pnpm init -y` inside it, add dependencies: `zod`, `zod-to-json-schema`.
3. Create the envelope schema in `packages/event-schemas/src/envelope.ts`:
   ```typescript
   import { z } from 'zod';
   export const EventEnvelopeSchema = z.object({
     event_id: z.string().uuid(),
     event_type: z.string(),
     event_version: z.number().int().positive().default(1),
     entity_id: z.string(),
     entity_type: z.enum(['task','plan','collab','circling','session','memory','system']),
     timestamp: z.string().datetime(),
     causation_id: z.string().uuid().nullable().default(null),
     correlation_id: z.string().uuid().nullable().default(null),
     actor: z.object({
       type: z.enum(['user','agent','system']),
       id: z.string(),
     }),
     node_id: z.string(),
     idempotency_key: z.string(),
   });
   ```
4. Create memory event payload schemas in `packages/event-schemas/src/memory/`:
   - `session-started.ts`, `session-ended.ts`, `turn-recorded.ts`, `fact-extracted.ts`, `concept-mentioned.ts`, `snapshot-taken.ts`, `compaction-triggered.ts`, `artifact-attached.ts`
   - Each is a `z.object()` with its specific payload + the envelope via `EventEnvelopeSchema.extend({ event_type: z.literal('memory.x'), data: ... })`.
5. Create the discriminated union: `packages/event-schemas/src/events.ts` exports `MemoryEventSchema = z.discriminatedUnion('event_type', [...])`.
6. Export TypeScript types via `z.infer<>`.
7. Export JSON Schema generation function for cross-language consumers.

**1.2 — Create the local event log substrate**

Per-node sovereignty means the local log is durable on local disk. Use NATS JetStream with no replication (R=1) as the local log:

1. Add a JetStream stream config: `local-events-${NODE_ID}` with `R=1`, file storage, no replication.
2. Store the stream's data in `~/.openclaw/local-events/`.
3. Create `lib/local-event-log.mjs` with a clean publish/subscribe API:
   ```javascript
   export async function publishLocal(event) {
     const validated = MemoryEventSchema.parse(event);
     const subject = `local.${event.entity_type}.events.${event.entity_id}.${event.event_type}`;
     return await jsm.publish(subject, JSON.stringify(validated), {
       msgID: event.idempotency_key,
     });
   }
   ```
4. Replace existing implicit "memory state changes" with explicit publishLocal calls. The first three to wire in:
   - `MemoryBudget.startSession` → publish `memory.session_started`
   - `MemoryBudget.endSession` → publish `memory.session_ended`
   - `MemoryBudget.addEntry` → publish `memory.fact_extracted`

This is **dual-write** at first — the existing files (MEMORY.md, session-store DB) continue to be written, AND the events get logged. This is shadow mode.

**1.3 — Create the content-addressed artifact store**

1. Create directory structure: `~/.openclaw/artifacts/sha256/<2-char>/<2-char>/<full-hash>`.
2. Implement `lib/artifacts.mjs` with three functions:
   ```javascript
   export async function putArtifact(bytes, { mime_type, filename }) { ... }
   export async function getArtifact(ref) { ... }
   export async function hasArtifact(ref) { ... }
   ```
3. `putArtifact` computes SHA-256, writes the bytes to the sharded path, writes a `.meta.json` sidecar with `{ ref, size, mime_type, filename, created_at, encoding }`.
4. `getArtifact` reads from local; if missing, sends NATS RPC `artifacts.fetch.<hash>` to peer nodes (Phase 4 wires the peer responder; until then, local-only).
5. Add a `validateArtifact(ref)` function that re-hashes bytes and confirms the stored hash matches. Surfaces tampering.

**1.4 — Configure the shared JetStream cluster (preparation only)**

For the federation layer, configure the cluster but don't make it authoritative yet:

1. Configure JetStream clustering across the three mesh nodes (moltymac, Ubuntu VM, macOS VM).
2. Create the shared stream `OPENCLAW_SHARED` with R=3 across the mesh nodes, file storage, subject filter: `kanban.events.>, lessons.shared.>, concepts.shared.>, context.broadcast.>, context.offer.>, context.accepted.>, artifacts.shared.>`.
3. Verify the cluster runs healthy under normal load.

This phase only **prepares** the shared layer. No memory data flows into it until Phase 4.

### Deliverables

- `packages/event-schemas` published as an internal workspace package
- Local event log running on each node (R=1, file-backed)
- Memory state changes dual-written to existing files AND the local log
- Content-addressed artifact store with local read/write
- Shared JetStream cluster configured (idle, ready for Phase 4)

### Validation

1. Memory events accumulate in the local log during a real session.
2. Replay the log through a stub projection and verify the resulting state matches the live MEMORY.md.
3. Put + get an artifact, verify hash integrity.

**Critical:** until the validation passes for a full week of dual-writing, do not proceed to Phase 2. This is the first Gulf 1 close.

### Rollback

Disable the `publishLocal` calls via a feature flag (`MEMORY_EVENT_LOG_ENABLED=false`). The existing files continue to work as before. The local log just stops accumulating.

### Effort: 2-3 weeks

---

## Phase 2 — Local semantic layer

### Goal

Add semantic retrieval over existing JSONL conversations. **This is the major decision gate** — if semantic search doesn't meaningfully improve real retrieval on real session data, the rest of the plan (which builds on semantic infrastructure) isn't justified.

### Prerequisites

Phase 1 complete. Local event log is dual-writing for at least one week of real session activity.

### Steps

**2.1 — Install sqlite-vec**

1. Add `sqlite-vec` to the project dependencies. Verify it loads cleanly on the M4 (the lead node).
2. Add the extension to the existing session-store SQLite database. The store now has both FTS5 and vec capabilities side by side.

**2.2 — Choose and install the embedding model**

1. Install Ollama on each node if not already present.
2. `ollama pull bge-m3` (1024-dim, multilingual) or `ollama pull nomic-embed-text-v1.5` (768-dim, English-only, faster). Default recommendation: BGE-M3.
3. Benchmark on real session data: embed 100 turns, measure latency. Target <100ms/turn.

**2.3 — Chunk and embed existing sessions**

1. Write a one-time migration `bin/embed-existing-sessions.mjs`:
   ```
   For each session in session_store:
     For each "semantic unit" in the session:  # turn-aligned, not fixed-size
       Embed the text via Ollama
       Insert into a new vec_chunks table:
         (session_id, turn_index, embedding, text, metadata)
   ```
2. Semantic units are: a single turn, OR a tool-call group (tool call + its result), OR a code block.
3. Track progress in a checkpoint file so the migration is resumable.
4. For 10K-50K turns of existing data (rough estimate), this runs ~30 minutes per node.

**2.4 — Implement semantic search alongside FTS5**

1. Extend `lib/session-store.mjs` with a `semanticSearch(query, k)` function:
   ```javascript
   const queryEmbedding = await embed(query);
   const results = await db.all(`
     SELECT session_id, turn_index, text, vec_distance_cosine(embedding, ?) AS distance
     FROM vec_chunks
     ORDER BY distance ASC
     LIMIT ?
   `, [queryEmbedding, k]);
   ```
2. Add a `hybridSearch(query, k)` function that calls both FTS5 and semantic, combines via reciprocal rank fusion (RRF), returns top-k.
3. Expose via the existing CLI: `session-search --semantic "query"`, `session-search --hybrid "query"`.

**2.5 — Manual evaluation against real queries**

This is the Gulf 1 close. The whole point of this phase.

1. Compile a list of 20-30 real historical queries that have been or should be retrievable. Sources: actual past conversations, task descriptions referencing past sessions, "where did we discuss X" questions.
2. Run each query through three retrievers:
   - FTS5 only (current behavior)
   - Semantic only (new)
   - Hybrid (FTS5 + semantic via RRF)
3. For each query, manually score each retriever's top-5 results: did they surface the right session, and the right part of it?
4. Compile results in a spreadsheet. Aggregate scores per retriever.

### Deliverables

- sqlite-vec extension installed
- BGE-M3 or nomic-embed-text running locally on each node
- Existing sessions embedded
- `semanticSearch` and `hybridSearch` functions
- CLI tool updated with `--semantic` and `--hybrid` flags
- Spreadsheet with manual evaluation results

### Validation — the major gate

Look at the spreadsheet. Honest assessment:
- If hybrid is clearly better than FTS5 on most queries → proceed to Phase 3.
- If hybrid is marginally better → consider whether the rest of the plan is justified.
- If hybrid is no better or worse → **stop the plan**. The semantic infrastructure isn't paying off; the rest of the phases (which depend on it) won't either. The architectural ambition was wrong on real data.

This is the moment where "close Gulf 1 first" matters most. If the gate fails, the conversation is "what did we expect that wasn't true, and what should we do instead." Not "let's add more sophistication."

### Rollback

The sqlite-vec extension and embeddings are additive — they don't break the existing FTS5 path. If the gate fails, the new code paths can be left in place (unused) or removed cleanly.

### Effort: 2 weeks

---

## Phase 3 — LLM-driven extraction

### Goal

Replace the heuristic regex extraction in `pre-compression-flush.mjs:extractFacts` with structured-output LLM extraction. The semantic infrastructure from Phase 2 means extracted facts can be embedded and linked.

### Prerequisites

Phase 2 complete. Hybrid retrieval shows meaningful improvement on real queries.

### Steps

**3.1 — Set up Qwen3.5-27B locally**

1. Verify Qwen3.5-27B is installed on the M4 via mlx-lm or Ollama. (Per the user's memory it's already in the stack.)
2. Benchmark inference latency: structured-output extraction on a 40-turn session should take ~10-30 seconds total. Acceptable for end-of-session work.

**3.2 — Design the extraction prompt and schema**

Create `lib/extraction-schema.mjs` with the Zod schema for extracted content:

```typescript
const ExtractionResult = z.object({
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(['person','project','technology','file','concept','company']),
    salience: z.number().min(0).max(1),
  })),
  themes: z.array(z.object({
    label: z.string(),
    hierarchy: z.array(z.string()),  // ['infra', 'messaging', 'nats']
  })),
  actions: z.array(z.enum(['debugging','designing','planning','implementing','reviewing','researching'])),
  decisions: z.array(z.object({
    decision: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  friction_signals: z.array(z.object({
    signal: z.string(),
    severity: z.enum(['low','medium','high']),
  })),
  relationships: z.array(z.object({
    source: z.string(),
    target: z.string(),
    type: z.enum(['depends_on','contradicts','instance_of','causes','follows']),
  })),
});
```

The prompt template lives in `lib/extraction-prompt.mjs`. Includes session tail, system instructions, schema description, examples.

**3.3 — Wire into the daemon**

1. Replace the regex `extractFacts` in `pre-compression-flush.mjs` with an LLM call: `await extractStructured(tailMessages)`.
2. Output goes to new entity/theme tables in the local SQLite (alongside the existing message-level FTS5):
   - `entities(id, name, type, canonical_name, first_seen, last_seen, mention_count, embedding)`
   - `themes(id, label, hierarchy_path, parent_id, first_seen, last_seen, mention_count)`
   - `mentions(entity_id, session_id, turn_index, salience)`
   - `decisions(id, session_id, decision, rationale, confidence)`
3. MEMORY.md content is generated from the entity/theme/decision tables, not from raw extracted text. The format becomes structured: "Recent decisions: …", "Active entities: …", etc.
4. The old regex extractor stays in place behind a feature flag (`USE_LLM_EXTRACTION=false`) for emergency fallback.

**3.4 — Validation against the old extractor**

1. Pick 10 recent sessions.
2. Run both extractors on each (regex and LLM).
3. Manually compare: which produced more useful MEMORY.md content, with fewer fragments and more semantic coherence?

### Deliverables

- Qwen3.5-27B integrated into the daemon
- Structured extraction with Zod schema validation
- New entity/theme/decision/mention tables in SQLite
- MEMORY.md generated from structured data, not raw regex matches
- Feature flag for fallback

### Validation

LLM extraction visibly better than regex on real sessions. If it's not, the extraction prompt needs work — iterate before declaring the phase done.

### Effort: 1-2 weeks

---

## Phase 4 — Federation primitives

### Goal

Formalize the local/shared boundary. Build the `promoter` and `subscriber` processes that bridge between local sovereignty and shared federation. Until this phase, the shared JetStream cluster (Phase 1) has been idle.

### Prerequisites

Phase 3 complete. Local memory has structured entities/themes/decisions worth promoting.

### Steps

**4.1 — Define promotion policies**

Create `config/promotion-policy.yaml`:

```yaml
# What to promote from local → shared
automatic:
  - kanban_events  # tasks the local agent participates in
explicit:
  - lesson_marked_share  # entities/decisions with share:true
threshold:
  - concept_mention_count: 5  # local concepts seen 5+ times become candidates
  - decision_confidence: 0.9  # high-confidence decisions auto-promote
manual_review:
  - everything_else  # queued for human review before sharing
```

**4.2 — Implement the promoter**

Create `bin/memory-promoter.mjs`:

```javascript
// Subscribes to the local event log
// For each new event, checks promotion policy
// If eligible, publishes a corresponding event to the shared cluster
// The shared event references the local event ID for provenance

async function onLocalEvent(localEvent) {
  const policy = await evaluatePromotionPolicy(localEvent);
  if (policy.decision === 'skip') return;
  if (policy.decision === 'queue_for_review') {
    await queueForReview(localEvent);
    return;
  }
  
  const sharedEvent = {
    ...localEvent,
    event_id: uuid(),  // new ID for the shared event
    promoted_from: {
      node_id: NODE_ID,
      local_event_id: localEvent.event_id,
    },
  };
  
  await sharedLog.publish(sharedEvent);
}
```

**4.3 — Implement the subscriber**

Create `bin/memory-subscriber.mjs`:

```javascript
// Subscribes to relevant subjects on the shared cluster
// For each shared event, decides whether to project into local memory

async function onSharedEvent(sharedEvent) {
  if (sharedEvent.promoted_from?.node_id === NODE_ID) return;  // not my own
  
  const policy = await evaluateIngestionPolicy(sharedEvent);
  if (policy.decision === 'skip') return;
  
  // Project into local stores with provenance
  const localProjection = {
    ...sharedEvent,
    source: {
      type: 'shared',
      original_event_id: sharedEvent.event_id,
      from_node: sharedEvent.promoted_from?.node_id || 'unknown',
    },
  };
  
  await projectToLocalStores(localProjection);
}
```

**4.4 — Add provenance to all local stores**

Every table that can receive shared content gets a `source` field:

```sql
ALTER TABLE entities ADD COLUMN source_type TEXT DEFAULT 'local';
ALTER TABLE entities ADD COLUMN source_node TEXT;
ALTER TABLE entities ADD COLUMN source_event_id TEXT;
```

Local-only content keeps `source_type = 'local'`. Ingested-from-shared content has the source filled in. Retrieval can filter or rank by source.

**4.5 — Always-ingest the kanban events**

Per the user's clarification: the local node always needs to know what's happening in the shared kanban. The subscriber's ingestion policy treats `kanban.events.>` as unconditional:

1. Subscribe to all `kanban.events.>` subjects.
2. Project every task event into a local `tasks_observed` table.
3. Tasks where `owner === NODE_ID` get full projection (the agent will work on them).
4. Tasks where `owner !== NODE_ID` get summary projection (the agent knows they exist for context).

**4.6 — Conflict surfacing**

When local and shared knowledge disagree (e.g., a concept means different things), don't auto-merge. Surface it during retrieval:

```javascript
function describeConflict(localConcept, sharedConcept) {
  return {
    local_definition: localConcept.summary,
    shared_definition: sharedConcept.summary,
    last_local_mention: localConcept.last_seen,
    last_shared_mention: sharedConcept.last_seen,
  };
}
```

The retrieval pipeline returns the conflict description alongside the content. The agent sees that there's disagreement and can address it.

### Deliverables

- Promoter process running on each node, publishing to the shared cluster
- Subscriber process running on each node, ingesting relevant shared events
- Provenance tracking in every local store
- Kanban events always ingested into local memory
- Conflict surfacing in retrieval

### Validation

1. Promote a concept from node A.
2. Verify it appears in shared cluster.
3. Verify node B's subscriber ingests it into local stores with correct provenance.
4. Verify retrieval on node B surfaces both local and shared knowledge with source attribution.

### Rollback

Disable the promoter and subscriber via feature flags. Local memory continues to work without federation. Already-promoted content stays in the shared cluster as historical record.

### Effort: 2-3 weeks

---

## Phase 5 — Thematic substrate

### Goal

Build the per-node Obsidian-based thematic graph. The graph IS the filesystem — wikilinks as edges, tags as themes, daily notes as temporal index.

### Prerequisites

Phase 4 complete. Federation primitives in place. Entity/theme extraction running for at least 2 weeks of real data.

### Steps

**5.1 — Set up per-node vault**

Create `~/.openclaw/obsidian-local/` on each node:

```
~/.openclaw/obsidian-local/
├── concepts/         # one note per entity/concept
├── decisions/        # one note per significant decision
├── sessions/         # one note per session
├── memory/           # daily logs (now local-only per the federation model)
└── themes/           # high-level thematic indexes
```

This is separate from the shared `projects/arcane-vault` which becomes the federation surface for cross-soul knowledge.

**5.2 — Auto-generate concept notes from entity store**

For each entity with `mention_count >= THRESHOLD` (start at 5):

1. Create `concepts/<entity-name>.md` with frontmatter:
   ```yaml
   ---
   type: concept
   created: 2026-05-13
   last_seen: 2026-05-18T14:30
   mention_count: 47
   themes: [infra/messaging, mesh-coordination]
   related: [[Mesh Coordination]], [[The CAS Bug]]
   ---
   ```
2. The body is auto-generated from the most-mentioned sessions:
   ```markdown
   # NATS JetStream
   
   Brief summary auto-generated via LLM from related sessions.
   
   ## Decisions
   - [[2026-02-15 — Use NATS over RabbitMQ]]
   
   ## Recent activity
   - [[sessions/2026-05-13 — debugging-cas-failure]]
   ```
3. Re-generate periodically during the consolidation cycle (Phase 8).

**5.3 — Build the wikilink graph parser**

Create `lib/obsidian-graph.mjs`:

```javascript
export async function buildGraph(vaultPath) {
  const notes = await walkVault(vaultPath);
  const nodes = new Map();
  const edges = [];
  
  for (const note of notes) {
    const { frontmatter, body } = parseMarkdown(note);
    nodes.set(note.id, { label: note.title, ...frontmatter });
    
    const wikilinks = [...body.matchAll(/\[\[([^\]]+)\]\]/g)];
    for (const [, target] of wikilinks) {
      edges.push({ source: note.id, target, type: 'mentions' });
    }
  }
  
  return { nodes, edges };
}
```

**5.4 — Cache the adjacency in SQLite**

For fast queries during spreading activation:

```sql
CREATE TABLE concept_graph_nodes (id, label, last_activated_at, weight);
CREATE TABLE concept_graph_edges (source_id, target_id, edge_type, weight);
CREATE INDEX idx_edges_source ON concept_graph_edges(source_id);
CREATE INDEX idx_edges_target ON concept_graph_edges(target_id);
```

A periodic job (every 10 min, or on filesystem change via fsevents) refreshes the cache from the vault.

**5.5 — Promote selected concepts to the shared vault**

Concepts that cross the promotion threshold (Phase 4 policy) generate equivalent notes in `projects/arcane-vault/concepts-shared/`. These notes have explicit `source_node` frontmatter for provenance.

### Deliverables

- Per-node Obsidian vault populated with concept/decision/session notes
- Wikilink graph parser
- Adjacency cache in SQLite
- Shared vault receiving promoted concepts

### Validation

1. Open the local Obsidian vault, verify concept notes are populated correctly.
2. Query the adjacency cache, verify edges match the wikilinks in notes.
3. Verify the shared vault has promoted-only content with provenance.

### Effort: 2-3 weeks

---

## Phase 6 — Spreading activation

### Goal

Implement the associative retrieval algorithm. This is what makes retrieval feel "associative" rather than literal.

### Prerequisites

Phase 5 complete. Thematic graph populated and adjacency cached.

### Steps

**6.1 — Implement the algorithm**

Create `lib/spreading-activation.mjs` (~50 lines):

```javascript
export function spreadingActivation(seeds, graph, opts = {}) {
  const { steps = 3, decay = 0.7, threshold = 0.1 } = opts;
  let activation = new Map(Object.entries(seeds));
  
  for (let step = 0; step < steps; step++) {
    const newActivation = new Map();
    
    for (const [nodeId, a] of activation) {
      const edges = graph.edgesFrom(nodeId);
      for (const edge of edges) {
        const contribution = a * edge.weight * decay;
        const prev = newActivation.get(edge.target) || 0;
        newActivation.set(edge.target, Math.max(prev, contribution));
      }
    }
    
    for (const [nodeId, a] of newActivation) {
      const prev = activation.get(nodeId) || 0;
      activation.set(nodeId, Math.max(prev, a));
    }
  }
  
  return Array.from(activation.entries())
    .filter(([_, a]) => a >= threshold)
    .sort((a, b) => b[1] - a[1]);
}
```

**6.2 — Wire into the retrieval pipeline**

The new 5-channel retrieval pipeline:

```javascript
async function retrieve(query, opts = {}) {
  // Channel 1: FTS5 keyword
  const keywordHits = await ftsSearch(query, 10);
  
  // Channel 2: vector similarity
  const semanticHits = await semanticSearch(query, 10);
  
  // Channel 3: entity exact match
  const entityHits = await entitySearch(query, 10);
  
  // Channel 4: thematic seed (entities + themes from query)
  const themesInQuery = await extractThemesFromQuery(query);
  const seeds = Object.fromEntries(themesInQuery.map(t => [t, 1.0]));
  
  // Channel 5: spreading activation from seeds
  const activated = spreadingActivation(seeds, graph, { steps: 3, decay: 0.7 });
  
  // Combine via reciprocal rank fusion
  const combined = reciprocalRankFusion([
    keywordHits, semanticHits, entityHits, activated.slice(0, 20)
  ]);
  
  // Rerank with BGE-reranker-v2-m3
  const reranked = await rerank(query, combined.slice(0, 50));
  
  return reranked.slice(0, opts.k || 10);
}
```

**6.3 — Tune parameters on real queries**

Run the same evaluation set from Phase 2 against the full 5-channel pipeline. Tune `decay`, `steps`, `threshold`.

### Deliverables

- Spreading activation algorithm
- 5-channel retrieval pipeline with reranking
- Tuned parameters

### Effort: 1-2 weeks

---

## Phase 7 — Proactive injection

### Goal

Memory comes "to mind" automatically without explicit invocation. Every prompt gets a small ambient context.

### Prerequisites

Phase 6 complete. Retrieval pipeline solid on real queries.

### Steps

**7.1 — Implement query analysis**

For each incoming user message, extract themes/entities (small LLM call, ~50ms):

```javascript
async function analyzePrompt(prompt) {
  return await structuredExtract(prompt, QueryAnalysisSchema);
}
```

**7.2 — Pre-retrieve relevant memory**

Before the prompt goes to the main LLM, run the retrieval pipeline on the extracted seeds. Cap at ~500-1000 tokens.

**7.3 — Inject as system message prefix**

```
[memory: recent relevant context]
Active concepts in this conversation: NATS, Mesh Coordination
Recent decisions: 
- 2026-02-15: Decided to use NATS over RabbitMQ (high confidence)
Related sessions: [session summaries]
[end memory]

<user prompt here>
```

**7.4 — Runtime control**

`@memory off` disables for a turn. `@memory deep` increases the budget. `@memory none` is a hard off for the session.

### Effort: 1 week

---

## Phase 8 — Consolidation cycle

### Goal

The "sleep" analog. Periodic offline processing that maintains graph health.

### Prerequisites

Phase 7 complete.

### Steps

**8.1 — Implement consolidation jobs**

Run during quiet periods (extending the daemon's existing Phase 2 throttled work):

1. Embed new content (sessions, concepts) since last consolidation
2. Extract entities/themes from new sessions
3. Update concept notes
4. Refresh adjacency cache
5. Decay weights on un-mentioned concepts
6. Reinforce frequently co-occurring pairs
7. Detect clusters needing theme notes
8. Regenerate summaries for high-change concepts
9. Detect contradictions
10. Evaluate promotion candidates (federation)

**8.2 — Schedule and budget**

Each job has a budget. Total consolidation per cycle: ~5 minutes during quiet periods. Skip if the system is busy.

### Effort: 1-2 weeks

---

## Phase 9 — Broadcast protocol

### Goal

Cross-soul collaboration via request/offer protocol. Nodes emit themes of interest; peers contribute relevant artifacts.

### Prerequisites

Phase 8 complete. Consolidation running, local retrieval solid, federation primitives mature.

### Steps

**9.1 — Define the broadcast schemas**

Add to the schema package:

```typescript
const ContextBroadcastSchema = z.object({
  ...EventEnvelopeSchema.shape,
  event_type: z.literal('context.broadcast'),
  data: z.object({
    themes: z.array(z.string()),
    entities: z.array(z.string()),
    problem_class: z.enum(['debug','design','research','implement']).optional(),
    intensity: z.enum(['passive','interested','actively_seeking']),
    ttl_minutes: z.number(),
  }),
});

const ContextOfferSchema = z.object({
  ...EventEnvelopeSchema.shape,
  event_type: z.literal('context.offer'),
  data: z.object({
    responding_to: z.string().uuid(),  // broadcast event_id
    artifacts: z.array(z.object({
      artifact_ref: z.string(),
      relevance_score: z.number(),
      provenance: z.object({...}),
      summary: z.string(),
    })),
  }),
});

const ContextAcceptedSchema = z.object({...});
```

**9.2 — Implement the broadcaster**

Runs as part of consolidation:

```javascript
async function maybeBroadcast(session) {
  const themes = await extractActiveThemes(session.recentEvents);
  if (themes.length < 2) return;
  if (await recentlyBroadcast(themes, session.id)) return;
  
  const intensity = inferIntensity(session);
  if (intensity === 'none') return;
  
  await sharedLog.publish('context.broadcast', {
    themes,
    entities: extractEntities(session.recentEvents),
    intensity,
    ttl_minutes: 60,
  });
}
```

**9.3 — Implement the offerer**

```javascript
async function considerOffering(broadcast) {
  if (broadcast.broadcaster_node_id === NODE_ID) return;
  
  const results = await localRetrieve({
    themes: broadcast.themes,
    entities: broadcast.entities,
    k: 10,
  });
  
  const relevant = results.filter(r => r.score > RELEVANCE_THRESHOLD);
  if (relevant.length === 0) return;
  
  const offers = await Promise.all(relevant.map(async r => ({
    artifact_ref: r.artifactRef,
    relevance_score: r.score,
    summary: await generateRelevanceSummary(broadcast, r),
  })));
  
  await sharedLog.publish('context.offer', {
    responding_to: broadcast.event_id,
    artifacts: offers,
  });
}
```

**9.4 — Implement the acceptor**

The broadcaster's subscriber receives offers, scores them in local context, presents top N to the agent (via injection in next prompt's background context).

Acceptance generates a `context.accepted` event, which feeds back into the offerer's reinforcement.

**9.5 — Privacy boundaries**

Add `private: true` markers on local memory items. The offerer's retrieval respects these — private items are never offered. Default-private is the safer starting policy.

### Deliverables

- Broadcast/offer/accept protocol implemented
- Per-node broadcaster running during sessions
- Per-node offerer responding to peer broadcasts
- Privacy markers respected

### Validation

1. Run a session on node A involving themes node B knows about.
2. Verify broadcast emitted, offer received from B, agent on A sees the offer.
3. Verify accepted offers are tracked.

### Effort: 1-2 weeks

---

## Cross-phase concerns

### Testing strategy

Each phase ships with tests:
- Phase 0: regression tests on existing harness
- Phase 1: schema package has unit tests; local log has integration tests
- Phase 2: hybrid search has eval-based tests (the spreadsheet)
- Phase 3: extraction has per-prompt fixture tests
- Phase 4: federation has cross-process integration tests
- Phase 5-8: retrieval quality has eval-based tests
- Phase 9: broadcast/offer protocol has end-to-end tests

Aggregate: a `test/integration/full-flow.test.mjs` that exercises a complete session from start to consolidation.

### Rollback strategy

Every phase has explicit rollback:
- Feature flags for dual-running paths
- Idempotent migrations (re-runnable)
- Database migrations are additive (add columns/tables; don't drop until validation passes for weeks)
- Federation processes can be disabled without affecting local operation

### Monitoring

Each phase adds metrics:
- Phase 1: events/sec local log, artifact store size
- Phase 2: embedding latency, search latency
- Phase 3: extraction latency, validation error rate
- Phase 4: promotion rate, ingestion rate, conflict count
- Phase 5: graph size (nodes, edges), update latency
- Phase 6: retrieval latency, channel hit rates
- Phase 7: injection token usage, retrieval-to-response time
- Phase 8: consolidation duration, jobs/cycle
- Phase 9: broadcast rate, offer-to-acceptance ratio

### Decision gates summary

| Gate | After phase | Question | Stop if |
|---|---|---|---|
| 1 | 1 | Does the local log accumulate correctly? | Schema/log infrastructure is broken |
| 2 | 2 | **Does semantic search meaningfully improve retrieval?** | **No on real data** |
| 3 | 3 | Does LLM extraction produce better MEMORY.md? | No visible quality improvement |
| 4 | 4 | Does federation work without breaking local? | Local sovereignty compromised |
| 5 | 6 | Does spreading activation surface useful associations? | Just noise |
| 6 | 7 | Does proactive injection improve responses? | Pollutes context without value |
| 7 | 9 | Do broadcasts produce useful offers? | Silent or noisy |

The most important gate is #2. If semantic search doesn't help on real data, almost everything downstream falls apart. Spend real time on that evaluation.

---

## What success looks like

After all phases:

- Each node runs an autonomous five-store memory infrastructure (episodic, semantic, entity, thematic, procedural)
- The local agent has access to associative retrieval over its own history
- Memory comes "to mind" via proactive injection without explicit invocation
- The federation layer carries kanban events, shared lessons, shared concepts, and broadcast/offer interactions
- Each node can work fully offline; federation is opt-in value-add
- Cross-soul collaboration happens via the request/offer broadcast protocol
- Every shared element has provenance back to its origin node
- Every local element knows whether it came from local experience or shared ingestion

The local agent is a sovereign actor with continuous memory, capable of contributing to and benefiting from the cluster's collective knowledge — without ever being subordinated to a central authority.

---

## Effort summary

| Phase | Effort |
|---|---|
| 0 — Stop the bleeding | 1 week |
| 1 — Schema & event foundations | 2-3 weeks |
| 2 — Local semantic layer | 2 weeks |
| 3 — LLM-driven extraction | 1-2 weeks |
| 4 — Federation primitives | 2-3 weeks |
| 5 — Thematic substrate | 2-3 weeks |
| 6 — Spreading activation | 1-2 weeks |
| 7 — Proactive injection | 1 week |
| 8 — Consolidation cycle | 1-2 weeks |
| 9 — Broadcast protocol | 1-2 weeks |
| **Total** | **14-20 weeks** |

**Phases 0-3 (~6-8 weeks)** deliver the bulk of practical value — fixed harness, semantic retrieval, LLM extraction. Phases 4-9 add the cross-node collaboration and richer associative behavior, each independently justified.

If the gate at Phase 2 fails, the plan terminates there. ~3-4 weeks of work, definitive answer on whether the architectural ambition was right.

---

*Definitive implementation plan, superseding `memory-harness-upgrade-strategy.md` and `openclaw-local-first-federation.md`. Companion to the kanban implementation plan (separate document).*
