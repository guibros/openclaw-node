# AUDIT_PRE — Step 9.2: Implement broadcaster (consolidation-driven, with TTL + de-dup)

## §1 — Intent

Implement `lib/broadcast-emitter.mjs` — the broadcaster module that publishes `context.broadcast` events to the shared NATS stream. The broadcaster fires on two paths: (1) per-prompt when query-analysis detects ≥3 themes, and (2) at end of every consolidation cycle. Rate-limited to 1 broadcast per 60 sec per session. De-duplication via `dedup_key` (SHA-256 of canonicalized themes∪entities) with a 15-min suppression window. Intensity inferred from prompt text patterns. TTL defaults to 60 min, configurable via `OPENCLAW_BROADCAST_TTL_MIN`.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.2 | v9.2 | [A] | Implement broadcaster (consolidation-driven, with TTL + de-dup) |

## §3 — Design decisions (from Step 9.1 AUDIT_POST §6)

- Test baseline: 905 tests (830 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added in Step 9.1.
- `ContextBroadcastSchema` at `packages/event-schemas/src/broadcast/context-broadcast.ts:4`. Data fields: `themes`, `entities`, `problem_class` (optional), `intensity`, `ttl_minutes`, `dedup_key`.
- `ContextOfferSchema` at `packages/event-schemas/src/broadcast/context-offer.ts:4`.
- `ContextAcceptedSchema` at `packages/event-schemas/src/broadcast/context-accepted.ts:4`.
- `BroadcastEventSchema` discriminated union at `packages/event-schemas/src/events.ts:27`.
- All three schemas available via `import { ContextBroadcastSchema, ... } from 'event-schemas'`.
- Step 9.2 (broadcaster) should use `ContextBroadcastSchema` for validation before publishing to `context.broadcast.>` on shared stream.

Block 9 §0 frozen decisions for broadcaster:
- File: `lib/broadcast-emitter.mjs`
- Wired into both `consolidation-scheduler.mjs` (Block 8.2) AND `memory-daemon.mjs` per-prompt path
- Fires on every user turn where query-analysis detects ≥3 themes
- Also fires at end of every consolidation cycle
- Per-session cap: 1 broadcast per 60 sec (rate limit)
- Dedup window: 15 min — same `dedup_key` within 15 min is suppressed
- TTL default: `ttl_minutes: 60`, override via `OPENCLAW_BROADCAST_TTL_MIN`
- Intensity inference from prompt text: question/stuck/blocked → `actively_seeking`; exploration verbs → `interested`; declarative → `passive`
- Skip broadcast if `passive` AND theme set unchanged from prior 5 turns

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| NATS shared stream unavailable | LOW | Graceful degradation with backoff (same pattern as memory-promoter). Fire-and-forget. |
| Query analysis returns no llmAnalysis (embedding-only mode) | LOW | Fall back to extracting themes from structured cues + raw query tokens. Theme count ≥3 gate prevents noisy broadcasts when no rich analysis is available. |
| Race condition on dedup map in daemon process | LOW | Single-threaded Node.js — Map operations are atomic within a tick. TTL expiry via periodic sweep. |

## §5 — Deferrals

- Wiring the broadcaster into `memory-daemon.mjs` and `consolidation-scheduler.mjs` call sites is deferred to caller awareness — this step exports the library only. Callers will use `createBroadcaster()` factory + `maybeBroadcast()`. Integration test in Step 9.6 will prove the wiring.
- `problem_class` inference from query analysis is basic (keyword-based); advanced NLU classification deferred.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/broadcast-emitter.mjs` | new | Core broadcaster module: `createBroadcaster(nc, nodeId, opts)` factory, `inferIntensity(prompt)` pure function, `computeDedupKey(themes, entities)` SHA-256, `maybeBroadcast(prompt, analysis, opts)` main entry, `broadcastFromConsolidation(themes, entities)` consolidation hook. Rate limit (60s per session), dedup (15-min window), TTL (env-configurable). Publishes to `context.broadcast.<nodeId>` on shared stream. |
| 2 | `test/broadcast-emitter.test.mjs` | new | Tests: inferIntensity (4 cases), computeDedupKey (determinism + canonical sort), rate limiting (suppression within 60s), dedup window (suppression within 15 min), maybeBroadcast integration (themes≥3 fires, <3 skips), consolidation path, TTL env override, passive+unchanged skip. Target: ~12 tests. |
