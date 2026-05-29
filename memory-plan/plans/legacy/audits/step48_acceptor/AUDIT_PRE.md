# AUDIT_PRE — Step 9.4: Implement acceptor + inject offers into agent prompt + emit context.accepted

## §1 — Intent

Implement the acceptor module (`lib/broadcast-acceptor.mjs`) that:
1. Subscribes to `context.offer.>` on the shared NATS JetStream stream
2. Filters to offers that are responses to broadcasts this node emitted (`responding_to` matches own broadcast event_id)
3. Scores incoming offers against the current session's recent context (last 5 turns)
4. Surfaces the top-1 offer as a `[peer-memory: ...]` injection block (prepended after the local `[memory: ...]` block in the companion-bridge injection path)
5. Auto-emits `context.accepted` when the user's next prompt exhibits token overlap ≥ 0.3 with the offer's summary

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.4 | v9.4 | [A] | Implement acceptor + inject offers into agent prompt + emit context.accepted |

## §3 — Design decisions (from Step 9.3 AUDIT_POST §6)

- Test baseline: 956 tests (881 pass, 75 fail — 73 pre-existing + 2 flaky variance).
- `createOfferer(nc, nodeId, opts)` at `lib/broadcast-offerer.mjs:214`. Returns `{ start, stop, stats, _processBroadcast }`.
- Offer published to subject `context.offer.<nodeId>` on shared stream. Validated against `ContextOfferSchema` before publish.
- `buildOfferFromResults` sets `causation_id` to broadcast's `event_id` and `data.responding_to` to same value.
- Artifact refs use format `session:<session_id>:chunk:<chunk_id>` — acceptor needs to parse this.
- `filterPrivateItems` is forward-compatible with Step 9.5's `private` column.
- `generateRelevanceSummary` accepts injectable `requestAnalysis` dependency.
- Step 9.4 (acceptor) subscribes to `context.offer.>` for offers where `responding_to` matches a broadcast this node emitted.

Block 9 §0 frozen decisions:
- Top 1 offer surfaces via companion-bridge injection path as `[peer-memory: ...]` block
- Auto-emit `context.accepted` when token overlap ≥ 0.3 with offer summary
- Feedback field stays optional

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| NATS shared stream unavailable | LOW | Graceful degradation — acceptor runs in degraded no-op mode with backoff (same pattern as offerer) |
| Token overlap heuristic produces false positives | LOW | Threshold at 0.3 is conservative; false acceptances are low-cost (just metadata) |
| Offer arrives after session ends | LOW | Pending offers have TTL from the original offer's `expires_at`; expired offers are purged |

## §5 — Deferrals

- Full feedback loop (useful: true/false + free-text note) wired explicitly in a later step if useful.
- Reinforcement learning from acceptance rates — future optimization, not this step.

## §6 — Phase 4 implementation outline

1. **`lib/broadcast-acceptor.mjs` (new)** — the acceptor module:
   - `TOKEN_OVERLAP_THRESHOLD` constant (0.3, env override via `ACCEPTOR_TOKEN_OVERLAP`)
   - `MAX_PENDING_OFFERS` constant (10, oldest evicted)
   - `parseArtifactRef(ref)` — parse `session:<id>:chunk:<id>` format → `{ sessionId, chunkId }`
   - `computeTokenOverlap(promptText, summaryText)` — tokenize both (lowercase, split on whitespace/punct), compute |intersection| / |summaryTokens|, return ratio
   - `formatPeerMemoryBlock(offer)` — format top offer's artifacts/summaries into `[peer-memory: ...]` delimited block
   - `createAcceptor(nc, nodeId, opts)` factory:
     - `opts.log`, `opts.ownBroadcastIds` (Set or function), `opts.overlapThreshold`
     - Internal state: `pendingOffers[]` (offers awaiting acceptance check), `acceptedIds` Set
     - `_processOffer(offerData)` — validate responding_to ∈ own broadcasts, check TTL expiry, push to pending
     - `getPendingOffers()` — return current pending (for injection path)
     - `getTopOffer()` — return best offer (highest combined relevance) for injection
     - `checkAcceptance(prompt)` — compute token overlap against each pending offer's summaries; if ≥ threshold, emit `context.accepted` and remove from pending
     - `start()` — subscribe to `context.offer.>` on shared stream
     - `stop()` — unsubscribe
     - Returns `{ start, stop, stats, getPendingOffers, getTopOffer, checkAcceptance, _processOffer }`

2. **`test/broadcast-acceptor.test.mjs` (new)** — tests:
   - Constants verification (TOKEN_OVERLAP_THRESHOLD, MAX_PENDING_OFFERS)
   - `parseArtifactRef` — happy path, malformed, edge cases
   - `computeTokenOverlap` — exact match, partial, zero, empty
   - `formatPeerMemoryBlock` — single artifact, multiple artifacts, empty
   - `createAcceptor._processOffer` — self-offer skip, non-matching broadcast, valid offer accepted into pending, TTL expiry
   - `createAcceptor.getTopOffer` — returns highest-scored pending
   - `createAcceptor.checkAcceptance` — overlap above/below threshold, context.accepted emission
   - Estimated: ~20-24 `it()` blocks
