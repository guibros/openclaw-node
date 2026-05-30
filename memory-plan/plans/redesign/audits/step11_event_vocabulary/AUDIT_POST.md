# AUDIT_POST — Step 1.1: Define memory.* event vocabulary in packages/event-schemas

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §5) | Actual | Match |
|---|---|---|
| CREATE `packages/event-schemas/src/memory/{ingested,extracted,retrieved,injected,synthesized,decayed,promoted,error}.ts` | 8 files created | ✓ |
| EDIT `packages/event-schemas/src/memory/index.ts` — 8 exports added | Done | ✓ |
| EDIT `packages/event-schemas/src/events.ts` — 8 imports + 8 union members | Done | ✓ |
| EDIT `packages/event-schemas/src/index.ts` — 8 re-exports | Done | ✓ |
| EDIT `test/event-schemas.test.mjs` — validation tests for all 8 | Done — 10 new test cases in "Boundary event schemas (Block 1 vocabulary)" suite | ✓ |

No unplanned files touched. TypeScript build succeeded (no errors). `dist/` regenerated.

## 2. Greppable deltas

```
packages/event-schemas/src/memory/ingested.ts    — MemoryIngestedSchema   (memory.ingested)
packages/event-schemas/src/memory/extracted.ts   — MemoryExtractedSchema  (memory.extracted)
packages/event-schemas/src/memory/retrieved.ts   — MemoryRetrievedSchema  (memory.retrieved)
packages/event-schemas/src/memory/injected.ts    — MemoryInjectedSchema   (memory.injected)
packages/event-schemas/src/memory/synthesized.ts — MemorySynthesizedSchema(memory.synthesized)
packages/event-schemas/src/memory/decayed.ts     — MemoryDecayedSchema    (memory.decayed)
packages/event-schemas/src/memory/promoted.ts    — MemoryPromotedSchema   (memory.promoted)
packages/event-schemas/src/memory/error.ts       — MemoryErrorSchema      (memory.error)
```

All extend `EventEnvelopeSchema` with `entity_type: 'memory'`. All use `z.literal('memory.<name>')` as the discriminant. `MemoryEventSchema` discriminated union now has 16 members (8 old + 8 new).

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests: all 8 schemas validate | `npm test`: 1376 pass / 0 fail. `Boundary event schemas (Block 1 vocabulary)` suite: all ✔ including discriminated-union routing for all 8. |
| Round-trip publish/read against live stream | `nats pub local.memory.events.sess-roundtrip-1_1.memory.ingested '<472B JSON>'` → Published 472 bytes. `nats stream get local-events-daedalus 2` → full JSON back, all fields intact. Stream messages: 1 → 2. |

## 4. Cross-refs

- Existing schemas (`session_started`, `session_ended`, etc.) untouched — backward compatible.
- `buildMemoryEvent()` in `lib/local-event-log.mjs` already produces events that pass the new schemas (same envelope pattern).
- Steps 1.2–1.5 will wire producers at each boundary to emit these events.

## 5. Findings

None. Step was cleanly atomic — 8 schema files + wiring + tests + round-trip, no mid-implementation surprises.

## 6. Carry-forwards for step 1.2

- The `memory.ingested` schema is ready. Step 1.2 wires `publishLocal(buildMemoryEvent('memory.ingested', ...))` at the ingest boundary in the daemon.
- The existing 8 schemas with no producers (turn_recorded, concept_mentioned, snapshot_taken, artifact_attached, compaction_triggered) remain — their fate is a separate decision (REGISTRY 1.7 gap), not in scope for Block 1.
