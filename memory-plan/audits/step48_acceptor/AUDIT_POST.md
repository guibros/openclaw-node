# AUDIT_POST — Step 9.4: Implement acceptor + inject offers into agent prompt + emit context.accepted

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/broadcast-acceptor.mjs` (new) | `lib/broadcast-acceptor.mjs:136` | yes | `export function createAcceptor` at :136 |
| 2 | `test/broadcast-acceptor.test.mjs` (new) | `test/broadcast-acceptor.test.mjs:13` | yes | 7 describe blocks, 28 `it()` blocks |

All 2 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| createAcceptor factory | `grep 'export function createAcceptor' lib/broadcast-acceptor.mjs` | line 136 |
| parseArtifactRef | `grep 'export function parseArtifactRef' lib/broadcast-acceptor.mjs` | line 48 |
| computeTokenOverlap | `grep 'export function computeTokenOverlap' lib/broadcast-acceptor.mjs` | line 66 |
| formatPeerMemoryBlock | `grep 'export function formatPeerMemoryBlock' lib/broadcast-acceptor.mjs` | line 98 |
| TOKEN_OVERLAP_THRESHOLD constant | `grep 'export const TOKEN_OVERLAP_THRESHOLD' lib/broadcast-acceptor.mjs` | line 32 |
| MAX_PENDING_OFFERS constant | `grep 'export const MAX_PENDING_OFFERS' lib/broadcast-acceptor.mjs` | line 35 |
| test imports | `grep 'broadcast-acceptor' test/broadcast-acceptor.test.mjs` | line 13 |

## §3 — Cross-references still valid

- `lib/broadcast-acceptor.mjs` dynamically imports `../packages/event-schemas/dist/index.js` at :291 — verified dist exists with `ContextAcceptedSchema` export (same pattern as broadcast-offerer.mjs and broadcast-emitter.mjs).
- `lib/broadcast-acceptor.mjs` requires `nats` at :297 (via `createRequire`) — package available in node_modules (same pattern as broadcast-offerer.mjs).
- `test/broadcast-acceptor.test.mjs` imports from `../lib/broadcast-acceptor.mjs` — all 6 exported names verified (TOKEN_OVERLAP_THRESHOLD, MAX_PENDING_OFFERS, parseArtifactRef, computeTokenOverlap, formatPeerMemoryBlock, createAcceptor).
- `context.accepted.>` subject already in `lib/shared-event-stream.mjs:36` SHARED_SUBJECTS array.
- `bin/memory-subscriber.mjs:40` already maps `context.accepted.` prefix to `accepted` category (Block 4.3 carry-forward; no modification needed).
- No stale references found. No symbols renamed or deleted from other files.

## §4 — Findings

1. **[POSITIVE]** `createAcceptor` follows the factory pattern established in Block 4 and Steps 9.2-9.3 (`createBroadcaster`, `createOfferer`). Returns `{ start, stop, stats, getPendingOffers, getTopOffer, checkAcceptance, _processOffer }` — consistent API shape with `_processOffer` exposed for direct testing.
2. **[POSITIVE]** Own-broadcast matching uses dependency-injected `ownBroadcastIds` (Set or getter function) — decoupled from broadcaster internals. Daemon wires the broadcaster's emitted ID set at init time.
3. **[POSITIVE]** TTL expiry check uses the offer's `expires_at` field directly (ISO timestamp comparison), consistent with the offerer's `buildOfferFromResults` which sets `expires_at = now + expiryMinutes`.
4. **[POSITIVE]** Pending offer queue is capped at MAX_PENDING_OFFERS (10) with FIFO eviction — prevents unbounded memory growth on busy networks.
5. **[POSITIVE]** `computeTokenOverlap` uses Unicode-aware tokenization (`\p{P}` in regex split) and case-insensitive comparison. Filters single-char tokens to reduce false positives from punctuation residue.
6. **[POSITIVE]** `formatPeerMemoryBlock` produces the `[peer-memory: ...]` delimited block format per §0 frozen decisions. Human-readable labels use parsed artifact refs (`session <id>`) with relevance scores.
7. **[POSITIVE]** Schema validation against `ContextAcceptedSchema` before publish catches malformed events early. Failure logs but doesn't crash — graceful degradation (same pattern as offerer/broadcaster).
8. **[POSITIVE]** `checkAcceptance` iterates all pending offers and accepts the first to exceed the threshold. Accepted offer is removed from pending and its ID added to `acceptedIds` to prevent double-acceptance.
9. **[POSITIVE]** Causation chain preserved: `causation_id` on the accepted event = the offer's `event_id`. `responding_to` in data = same. Proper event tracing from broadcast → offer → accepted.
10. **[POSITIVE]** All 28 new tests pass. Test count delta +28 (28 `it()` blocks). No pre-existing tests broken. Failure count matches baseline (75 = 73 pre-existing + 2 flaky).

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 9.5

- Test baseline: 984 tests (909 pass, 75 fail — 73 pre-existing + 2 flaky variance). +28 `it()` blocks added this step.
- `createAcceptor(nc, nodeId, opts)` at `lib/broadcast-acceptor.mjs:136`. Returns `{ start, stop, stats, getPendingOffers, getTopOffer, checkAcceptance, _processOffer }`.
- `getTopOffer()` returns formatted `[peer-memory: ...]` block string — ready for companion-bridge injection path. Daemon wires: after local `[memory: ...]` block is computed, append `acceptor.getTopOffer()`.
- `checkAcceptance(prompt)` should be called after every user prompt lands. Daemon integration: invoke in the per-prompt path after injection (fire-and-forget acceptance check).
- `ownBroadcastIds` must be shared between broadcaster and acceptor instances. Daemon creates a shared `Set` that the broadcaster appends to on each emit, and the acceptor reads from.
- `parseArtifactRef` exports the `session:<id>:chunk:<id>` parser — Step 9.5 may use this for privacy-aware filtering of specific artifact refs.
- Step 9.5 adds `private INTEGER DEFAULT 1` column to entities/decisions/themes tables. The offerer's `filterPrivateItems` already handles this forward-compatibly. The acceptor does not query the extraction store directly — it operates purely on offers received over NATS.
