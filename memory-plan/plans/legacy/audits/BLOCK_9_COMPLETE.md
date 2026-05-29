# Block 9 Complete — Broadcast Protocol

**Block:** 9
**Steps:** 9.1–9.6 (6 steps)
**Status:** All 6 steps closed.
**Date closed:** 2026-05-25

## Exit-gate criteria

- Step 9.1: Broadcast/offer/accepted schemas defined in event-schemas package. 12 tests.
- Step 9.2: Broadcaster (consolidation-driven, with TTL + de-dup). 23 tests.
- Step 9.3: Offerer (local retrieve → score → publish offer). 24 tests.
- Step 9.4: Acceptor (inject offers into agent prompt + emit context.accepted). 28 tests.
- Step 9.5: Privacy markers (private: true) + default-private retrieval policy. 30 tests.
- Step 9.6: Cross-node integration test for broadcast → offer → accepted round-trip. 10 tests.

Total tests added in Block 9: ~127 `it()` blocks.

## Files touched cumulatively (Block 9)

### New files
- `packages/event-schemas/src/broadcast/context-broadcast.ts`
- `packages/event-schemas/src/broadcast/context-offer.ts`
- `packages/event-schemas/src/broadcast/context-accepted.ts`
- `packages/event-schemas/src/broadcast/index.ts`
- `lib/broadcast-emitter.mjs` — createBroadcaster factory
- `lib/broadcast-offerer.mjs` — createOfferer factory
- `lib/broadcast-acceptor.mjs` — createAcceptor factory
- `bin/publish-item.mjs` — CLI privacy management tool
- `test/broadcast-schemas.test.mjs`
- `test/broadcast-emitter.test.mjs`
- `test/broadcast-offerer.test.mjs`
- `test/broadcast-acceptor.test.mjs`
- `test/privacy-markers.test.mjs`
- `test/broadcast-cross-node.test.mjs` — deterministic cross-node integration test

### Modified files
- `packages/event-schemas/src/index.ts` (re-exports broadcast schemas)
- `lib/extraction-store.mjs` — privacy migration (private column + published_items table + API)
- `lib/memory-directives.mjs` — @publish directive
- `lib/retrieval-pipeline.mjs` — respect_privacy flag + filterPrivateResults

## Carry-forwards into Block 10

- `@publish` directive is parsed but not wired into the SDK wrappers' per-prompt path. The CLI (`bin/publish-item.mjs`) is the primary mechanism. Wiring the directive into the daemon requires an operator chore commit.
- The offerer's `filterPrivateItems` is now active — all entities default to private. Operators must use `bin/publish-item.mjs` to make items shareable.
- `respect_privacy: true` is the default. Local injection should pass `false` to allow users to see their own private memory.
- Block 10 frozen decisions must be authored by the operator before the next tick.
- Item F (workspace deploy script) still queued from Block 8.

## Streaks

- Zero-Phase-4-correction: 6-of-6 (entire Block 9 clean)
- Zero-Phase-8-patch: 26 (Block 5 all 5 + Block 6 all 4 + Block 7 all 4 + Block 8 both 2 + 1 from Block 4 + Steps 9.1–9.6)
