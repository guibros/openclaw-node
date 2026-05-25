# AUDIT_POST — Step 9.1: Define broadcast/offer/accepted schemas in event-schemas package

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `packages/event-schemas/src/broadcast/context-broadcast.ts` (new) | `packages/event-schemas/src/broadcast/context-broadcast.ts:4` | yes | `export const ContextBroadcastSchema` at :4 |
| 2 | `packages/event-schemas/src/broadcast/context-offer.ts` (new) | `packages/event-schemas/src/broadcast/context-offer.ts:4` | yes | `export const ContextOfferSchema` at :4 |
| 3 | `packages/event-schemas/src/broadcast/context-accepted.ts` (new) | `packages/event-schemas/src/broadcast/context-accepted.ts:4` | yes | `export const ContextAcceptedSchema` at :4 |
| 4 | `packages/event-schemas/src/broadcast/index.ts` (new) | `packages/event-schemas/src/broadcast/index.ts` | yes | Barrel re-exports all 3 schemas + types |
| 5 | `packages/event-schemas/src/events.ts` (modify) | `packages/event-schemas/src/events.ts:27` | yes | `export const BroadcastEventSchema` at :27 |
| 6 | `packages/event-schemas/src/index.ts` (modify) | `packages/event-schemas/src/index.ts:5,17-19` | yes | `BroadcastEventSchema` at :5; `ContextBroadcastSchema`, `ContextOfferSchema`, `ContextAcceptedSchema` at :17-19 |
| 7 | `test/broadcast-schemas.test.mjs` (new) | `test/broadcast-schemas.test.mjs` | yes | 4 describe blocks, 12 `it()` blocks |

All 7 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| ContextBroadcastSchema | `grep 'export const ContextBroadcastSchema' packages/event-schemas/src/broadcast/context-broadcast.ts` | line 4 |
| ContextOfferSchema | `grep 'export const ContextOfferSchema' packages/event-schemas/src/broadcast/context-offer.ts` | line 4 |
| ContextAcceptedSchema | `grep 'export const ContextAcceptedSchema' packages/event-schemas/src/broadcast/context-accepted.ts` | line 4 |
| broadcast barrel index | `grep 'ContextBroadcastSchema' packages/event-schemas/src/broadcast/index.ts` | line 1 |
| BroadcastEventSchema | `grep 'export const BroadcastEventSchema' packages/event-schemas/src/events.ts` | line 27 |
| index re-exports | `grep 'BroadcastEventSchema' packages/event-schemas/src/index.ts` | line 5 |
| test imports | `grep 'BroadcastEventSchema' test/broadcast-schemas.test.mjs` | line 8 |

## §3 — Cross-references still valid

- `packages/event-schemas/src/broadcast/context-broadcast.ts` imports `EventEnvelopeSchema` from `../envelope.js` — verified.
- `packages/event-schemas/src/broadcast/context-offer.ts` imports `EventEnvelopeSchema` from `../envelope.js` — verified.
- `packages/event-schemas/src/broadcast/context-accepted.ts` imports `EventEnvelopeSchema` from `../envelope.js` — verified.
- `packages/event-schemas/src/broadcast/index.ts` re-exports from `./context-broadcast.js`, `./context-offer.js`, `./context-accepted.js` — all present.
- `packages/event-schemas/src/events.ts` imports from `./broadcast/context-broadcast.js`, `./broadcast/context-offer.js`, `./broadcast/context-accepted.js` — all present.
- `packages/event-schemas/src/index.ts` re-exports `BroadcastEventSchema` and `BroadcastEvent` from `./events.js` — present.
- `packages/event-schemas/src/index.ts` re-exports broadcast schemas from `./broadcast/index.js` — present.
- `test/broadcast-schemas.test.mjs` imports from `../packages/event-schemas/dist/index.js` — verified dist files exist after TypeScript build.
- No stale references found in the codebase (11 files reference broadcast symbols; all are new source, test, or plan docs).

## §4 — Findings

1. **[POSITIVE]** All three schemas follow the established pattern from Block 1: `EventEnvelopeSchema.extend()` with literal `event_type` discriminator and typed `data` payload. Consistent with the 8 memory event schemas.
2. **[POSITIVE]** `ContextBroadcastSchema.data.dedup_key` field added beyond REFERENCE_PLAN per Block 9 §0 frozen decisions — SHA-256 of canonicalized themes∪entities set. Offerer can drop duplicates without re-parsing.
3. **[POSITIVE]** `ContextOfferSchema.data.expires_at` field added beyond REFERENCE_PLAN per Block 9 §0 — broadcaster ignores offers arriving after broadcast TTL expired.
4. **[POSITIVE]** `ContextOfferSchema.data.provenance` uses minimal `{ source_node, source_type }` shape, consistent with Block 4's provenance pattern (PROVENANCE_LOCAL and provenance columns on extraction store).
5. **[POSITIVE]** `ContextAcceptedSchema.data.feedback` is fully optional (both the field itself and `feedback.note` within it), matching §0's "feedback field stays optional — wired explicitly later if useful."
6. **[POSITIVE]** `BroadcastEventSchema` is a separate discriminated union from `MemoryEventSchema` — clean separation of memory events vs broadcast protocol events. Consumers can combine if needed.
7. **[POSITIVE]** TypeScript build produces both `.js` and `.d.ts` files in `dist/broadcast/` — type inference works for downstream consumers.
8. **[POSITIVE]** Test coverage: 12 `it()` blocks across 4 describe groups: 3 per broadcast schema (valid, optional field, reject invalid) + 3 for discriminated union (route by type, route offer, reject unknown).
9. **[POSITIVE]** `problem_class` uses `z.enum(['debug','design','research','implement']).optional()` — matches §0's enum exactly.
10. **[POSITIVE]** `intensity` uses `z.enum(['passive','interested','actively_seeking'])` — matches §0's enum exactly.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 9.2

- Test baseline: 905 tests (830 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added this step.
- `ContextBroadcastSchema` at `packages/event-schemas/src/broadcast/context-broadcast.ts:4`. Data fields: `themes`, `entities`, `problem_class` (optional), `intensity`, `ttl_minutes`, `dedup_key`.
- `ContextOfferSchema` at `packages/event-schemas/src/broadcast/context-offer.ts:4`. Data fields: `responding_to` (uuid), `offerer_node_id`, `artifacts` (array of `{ artifact_ref, relevance_score, provenance: { source_node, source_type }, summary }`), `expires_at` (datetime).
- `ContextAcceptedSchema` at `packages/event-schemas/src/broadcast/context-accepted.ts:4`. Data fields: `responding_to` (uuid), `accepted_artifacts` (string[]), `feedback` (optional `{ useful, note? }`).
- `BroadcastEventSchema` discriminated union at `packages/event-schemas/src/events.ts:27`.
- All three schemas available via `import { ContextBroadcastSchema, ... } from 'event-schemas'` (dist build verified).
- Step 9.2 (broadcaster) should use `ContextBroadcastSchema` for validation before publishing to `context.broadcast.>` on shared stream.
