# AUDIT_PRE — Step 9.3: Implement offerer (local retrieve → score → publish offer)

## §1 — Intent

Implement the broadcast offerer module (`lib/broadcast-offerer.mjs`) that subscribes to
`context.broadcast.>` events from peer nodes, retrieves locally relevant content via the
5-channel retrieval pipeline, scores it against a relevance threshold, optionally generates
an LLM-based relevance summary, and publishes `context.offer` events back to the shared stream.

The offerer runs inside the memory daemon process (reusing its NATS connection and databases).
It respects privacy markers (hard pre-filter on `private = 1` items) and gracefully degrades
when the LLM queue is busy (embedding-only summary fallback).

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.3 | v9.3 | [A] | Implement offerer (local retrieve → score → publish offer) |

## §3 — Design decisions (from prior carry-forwards)

From Step 9.2 `AUDIT_POST §6`:
- Test baseline: 932 tests (857 pass, 75 fail — 73 pre-existing + 2 flaky variance).
- `createBroadcaster(nc, nodeId, opts)` at `lib/broadcast-emitter.mjs:141`. Returns `{ maybeBroadcast, broadcastFromConsolidation, stop, stats }`.
- `inferIntensity(prompt)` exported — available for offerer's scoring if needed.
- `computeDedupKey(themes, entities)` exported — offerer can compare against received broadcast's `dedup_key`.
- Event published to subject `context.broadcast.<nodeId>` on shared stream. Validated against `ContextBroadcastSchema` before publish.
- Step 9.3 (offerer) subscribes to `context.broadcast.>` from any node except self, uses broadcast's themes/entities to seed local retrieval.

From RESUME.md §0 Block 9 frozen decisions:
- Offerer runs inside `memory-daemon.mjs` (reuses existing shared-stream connection).
- Routes through `ollama-queue.requestAnalysis()` for `generateRelevanceSummary()` — short timeout, falls back to embedding-only summary if Ollama busy.
- Relevance threshold: `RELEVANCE_THRESHOLD = 0.55` (RRF-combined score from 5-channel retrieval pipeline). Below threshold = silent.
- Top-K artifacts per offer: 3 (Miller-style cap).
- Privacy filter: hard pre-filter on `private = 1` items per Step 9.5 — these never enter retrieval results. (Note: `private` column doesn't exist yet — Step 9.5 adds it. The offerer queries with a WHERE clause that silently returns all rows if the column is absent, OR uses a try/catch on the privacy-aware query and falls back to the normal query. Design choice: use try/catch — forward-compatible with Step 9.5 without requiring migration here.)

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | `private` column doesn't exist yet (Step 9.5 adds it) | LOW | Privacy-aware query wrapped in try/catch with fallback to non-privacy query. Column absence = all items eligible (current behavior). |
| 2 | Shared stream may not be available | LOW | Reuse subscriber pattern from Step 4.3 — graceful degradation with backoff. |
| 3 | LLM queue busy during offer generation | LOW | `requestAnalysis()` already has built-in fallback mechanism. Use data-only summary when LLM unavailable. |
| 4 | Broadcast TTL expired before offer generated | LOW | Check `ttl_minutes` on received broadcast; skip if expired. |

## §5 — Deferrals

- Full privacy column migration deferred to Step 9.5.
- Reinforcement feedback from `context.accepted` events deferred to Step 9.4.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/broadcast-offerer.mjs` | NEW | Main offerer module. Exports `createOfferer(nc, nodeId, opts)` factory returning `{ start, stop, stats }`. `start()` subscribes to `context.broadcast.>` on the shared stream. On each broadcast: (a) skip self-originated, (b) check TTL expiry, (c) build query from themes+entities, (d) retrieve via 5-channel pipeline with privacy pre-filter, (e) filter by RELEVANCE_THRESHOLD 0.55, (f) take top-3, (g) generate relevance summary via LLM or fallback, (h) validate against `ContextOfferSchema`, (i) publish to `context.offer.<nodeId>`. Exports `RELEVANCE_THRESHOLD`, `MAX_ARTIFACTS_PER_OFFER`, `generateRelevanceSummary`, `buildOfferFromResults`. |
| 2 | `test/broadcast-offerer.test.mjs` | NEW | Tests for offerer: skip-self, TTL expiry skip, below-threshold silence, above-threshold offer publish, top-3 cap, LLM summary fallback to data-only, schema validation, privacy pre-filter behavior, stats tracking. ~10-15 `it()` blocks. |
