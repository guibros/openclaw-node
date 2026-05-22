# AUDIT_PRE — Step 4.2: Implement promoter (bin/memory-promoter.mjs)

**Version:** v4.2-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement the promoter daemon that subscribes to the local event log, evaluates each event against the promotion policy (loaded from `config/promotion-policy.yaml` via `lib/promotion-policy.mjs`), and publishes eligible events to the shared JetStream cluster (`OPENCLAW_SHARED`). Includes exponential backoff on shared cluster unreachable, provenance tracking via `promoted_from` field, and subject-mapping logic from local event types to shared stream subjects.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.2 | v4.2 | [A] | Implement promoter (bin/memory-promoter.mjs) |

## §3 — Design decisions (from Step 4.1 AUDIT_POST §6)

- Test baseline is now 598 tests (521 pass, 77 fail — 73 pre-existing + 4 flaky). +11 tests added at Step 4.1 (planned ~6, delivered 11).
- `loadPromotionPolicy(configPath)` from `lib/promotion-policy.mjs` is ready for import by the promoter daemon. The promoter needs to call `loadPromotionPolicy()` at startup and implement `evaluatePromotionPolicy(event, policy)`.
- `validatePromotionPolicy(parsed)` is available for runtime re-validation if hot-reload is ever added.
- `POLICY_CATEGORIES` and `DEFAULT_POLICY_PATH` are exported constants for use by the promoter and subscriber.
- Phase-4-correction streak: 0 (reset — test count underestimate at Step 4.1).
- Phase-8-patch streak: 10 (Steps 2.1–4.1, zero patches).

Additional frozen decisions from RESUME.md §0 Block 4:
- Default privacy: DEFAULT-PRIVATE. Nothing auto-shares unless explicitly marked or meets strict threshold.
- Promotion policy (tighter than REFERENCE_PLAN): automatic kanban_events, explicit share_true, threshold concept_mention_count >= 10 and decision_confidence >= 0.95, manual_review everything_else.
- Health-check hook + exponential backoff on cluster unreachable is required.
- Single-node operation must work fully without the cluster.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | NATS consumer API mismatch (nats.js v2 vs v3 API differences) | MEDIUM | Use the same `createRequire`-based import pattern as `local-event-log.mjs`. Mock-based tests avoid live NATS dependency. |
| 2 | Shared cluster unreachable at startup | LOW | Promoter starts in degraded mode — processes events but queues promotions. Backoff handles recovery. |
| 3 | Event schema evolution — promoted events may have fields the subscriber doesn't expect | LOW | `promoted_from` is an additive field on the event envelope. Does not break MemoryEventSchema validation since it uses passthrough/strip for unknown fields. |

## §5 — Deferrals

- Hot-reload of promotion policy (watch config file for changes): deferred to a future step or never.
- Review queue persistence (writing `queue_for_review` events to a file or SQLite): deferred. Step 4.2 logs review-queued events but does not persist them.
- Consumer offset persistence across daemon restarts: NATS durable consumers handle this natively.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create promoter daemon with `evaluatePromotionPolicy(event, policy)` — pure function checking event against policy rules in priority order (automatic → explicit → threshold → manual_review). Returns `{ decision, category, reason }`. `mapToSharedSubject(event)` — maps local event types to shared stream subjects. `createBackoff(opts)` — exponential backoff controller (base 1s, max 60s, multiplier 2). `createPromoter(nc, nodeId, opts)` — factory creating consumer on local stream, evaluate→promote pipeline, shared cluster publishing with `promoted_from` provenance. `main()` CLI entry. | `bin/memory-promoter.mjs` | new |
| 2 | Tests: ~10 tests covering evaluatePromotionPolicy (6 cases: kanban→promote, share_true→promote, concept_count→promote, decision_confidence→promote, below_threshold→queue, unrelated→queue), mapToSharedSubject (3 cases: kanban, concept, fact), createBackoff (1 case: exponential+cap+reset). | `test/memory-promoter.test.mjs` | new |
