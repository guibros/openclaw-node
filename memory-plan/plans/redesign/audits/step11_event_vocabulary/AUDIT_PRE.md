# AUDIT_PRE — Step 1.1: Define memory.* event vocabulary in packages/event-schemas

## §0 Re-orient

- Where am I: Block 1 (L1 event log spine), step 1/5, 5/40 overall.
- Last step changed: 0.4 wired the daemon to local NATS, created `local-events-daedalus` stream. Block 0 COMPLETE.
- This step contributes: defines the schema vocabulary that steps 1.2–1.5 will emit at ingest/extract/inject/error boundaries.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy LLM-Wiki) — the event log is the substrate the watcher (D6) reads, enabling observability over every memory operation.
- Still the right next step? Yes — schemas must exist before producers can emit them.

## 1. Intent

Add 8 boundary-event Zod schemas to `packages/event-schemas/src/memory/`: `memory.ingested`, `memory.extracted`, `memory.retrieved`, `memory.injected`, `memory.synthesized`, `memory.decayed`, `memory.promoted`, `memory.error`. These are operation-boundary events (one per operation run, not per-entity), designed for the memory-watcher (Block 2) to consume.

The existing 8 schemas (`session_started`, `session_ended`, `turn_recorded`, `fact_extracted`, `concept_mentioned`, `snapshot_taken`, `compaction_triggered`, `artifact_attached`) remain — they serve MemoryBudget's dual-write. The new schemas are complementary: they describe what the daemon DID at each pipeline boundary, not what it found.

## 2. Design

Each new schema extends `EventEnvelopeSchema` (same pattern as existing schemas). Key data fields per schema:

- **memory.ingested**: session_id, source, messages_added, total_messages
- **memory.extracted**: session_id, entities_count, themes_count, mentions_count, decisions_count, model, duration_ms
- **memory.retrieved**: query_hash, channels_hit, results_count, duration_ms
- **memory.injected**: request_id, token_count, blocks_count, duration_ms
- **memory.synthesized**: trigger (session_end|interval|manual), artifacts_written[], duration_ms
- **memory.decayed**: entities_decayed, duration_ms
- **memory.promoted**: entities_promoted, duration_ms
- **memory.error**: boundary (ingest|extract|retrieve|inject|synthesize|decay|promote), error_code, error_message, session_id (optional)

All use `entity_type: 'memory'` (already in the envelope enum).

## 3. Carry-forwards from 0.4 AUDIT_POST

- Silent extraction Zod rejections + native worker crash at boot → captured in OUT_OF_SCOPE (2026-05-29). Not in scope for 1.1.

## 4. Risk register

- **Zod version mismatch**: the root `node_modules` has Zod 4.x while `event-schemas` targets 3.x. The existing `toJsonSchema()` already casts; new schemas follow the same pattern. Low risk.
- **discriminated union size**: adding 8 more members to `MemoryEventSchema` — Zod handles this fine.
- **TypeScript build**: the package uses a borrowed `tsc` from `mission-control/node_modules`. If unavailable, build fails. Mitigate: verify build in Phase 5.

## 5. File-delta outline

| Action | File |
|--------|------|
| CREATE | `packages/event-schemas/src/memory/{ingested,extracted,retrieved,injected,synthesized,decayed,promoted,error}.ts` |
| EDIT | `packages/event-schemas/src/memory/index.ts` — add 8 exports |
| EDIT | `packages/event-schemas/src/events.ts` — add 8 schemas to discriminated union |
| EDIT | `packages/event-schemas/src/index.ts` — add 8 re-exports |
| EDIT | `test/event-schemas.test.mjs` — add validation tests for all 8 new schemas |
