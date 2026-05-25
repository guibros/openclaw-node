# AUDIT_PRE — Step 9.1: Define broadcast/offer/accepted schemas in event-schemas package

## §1 — Intent

Add three new event schemas (`ContextBroadcastSchema`, `ContextOfferSchema`, `ContextAcceptedSchema`) to the `packages/event-schemas` workspace package. These schemas define the wire format for the cross-soul broadcast protocol (Phase 9). All three extend `EventEnvelopeSchema` with literal `event_type` discriminators and typed `data` payloads, following the exact pattern established by the 8 memory event schemas in Block 1.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.1 | v9.1 | [A] | Define broadcast/offer/accepted schemas in event-schemas package |

## §3 — Design decisions (consumed from prior step's AUDIT_POST §6 + RESUME.md §0)

- **Test baseline:** 893 tests (818 pass, 75 fail — 73 pre-existing + 2 flaky variance). From Step 8.2 AUDIT_POST §6.
- **Block 9 frozen decisions authored.** Transport is NATS shared stream `OPENCLAW_SHARED` (R=3). All three schemas live in `packages/event-schemas`.
- **Schema fields from RESUME.md §0 Block 9:**
  - `ContextBroadcastSchema.data`: `{ themes: string[], entities: string[], problem_class?: 'debug'|'design'|'research'|'implement', intensity: 'passive'|'interested'|'actively_seeking', ttl_minutes: number, dedup_key: string }`
  - `ContextOfferSchema.data`: `{ responding_to: uuid, offerer_node_id: string, artifacts: Array<{ artifact_ref, relevance_score, provenance, summary }>, expires_at: ISO timestamp }`
  - `ContextAcceptedSchema.data`: `{ responding_to: uuid (offer's event_id), accepted_artifacts: string[] (artifact_refs), feedback?: { useful: boolean, note?: string } }`
- **Directory layout:** follow existing `src/memory/` pattern → new `src/broadcast/` directory with per-schema files + barrel index.
- **Discriminated union:** new `BroadcastEventSchema` union (separate from `MemoryEventSchema`) for type safety. Both re-exported from package root.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Zod version mismatch (package uses zod@^3.23 vs root zod@4.x) | LOW | Existing pattern works; `toJsonSchema` already uses `as any` cast. Follow same convention. |
| TypeScript build may fail if tsconfig or dependencies are stale | LOW | Build step is in npm pretest hook; test run will catch. |
| `provenance` field in ContextOfferSchema.data.artifacts is underspecified in §0 | LOW | Use `z.object({ source_node: z.string(), source_type: z.string() })` — minimal provenance matching Block 4's pattern. |

## §5 — Deferrals

- Full `toJsonSchema()` update to cover broadcast schemas is cosmetic (existing function only covers MemoryEventSchema); defer to a future step if needed.
- Runtime validation integration (wiring schemas into promoter/subscriber) is Steps 9.2–9.4.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `packages/event-schemas/src/broadcast/context-broadcast.ts` | new | `ContextBroadcastSchema` extending `EventEnvelopeSchema` with `event_type: z.literal('context.broadcast')` and data payload per §3. Export schema + inferred type. |
| 2 | `packages/event-schemas/src/broadcast/context-offer.ts` | new | `ContextOfferSchema` extending `EventEnvelopeSchema` with `event_type: z.literal('context.offer')` and data payload per §3. Export schema + inferred type. |
| 3 | `packages/event-schemas/src/broadcast/context-accepted.ts` | new | `ContextAcceptedSchema` extending `EventEnvelopeSchema` with `event_type: z.literal('context.accepted')` and data payload per §3. Export schema + inferred type. |
| 4 | `packages/event-schemas/src/broadcast/index.ts` | new | Barrel re-export of all 3 broadcast schemas + types. |
| 5 | `packages/event-schemas/src/events.ts` | modify | Add `BroadcastEventSchema` discriminated union from 3 broadcast schemas. Export alongside existing `MemoryEventSchema`. |
| 6 | `packages/event-schemas/src/index.ts` | modify | Re-export broadcast schemas, types, and `BroadcastEventSchema` from package root. |
| 7 | `test/broadcast-schemas.test.mjs` | new | Tests: 3 schemas validate valid input, reject invalid input, discriminated union routes correctly, type inferences work. Target: ~8-10 `it()` blocks. |
