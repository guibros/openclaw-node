# AUDIT_PRE — Step 4.3: Implement subscriber (bin/memory-subscriber.mjs)

**Version:** v4.3-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement the subscriber daemon (`bin/memory-subscriber.mjs`) that subscribes to
relevant subjects on the shared NATS JetStream cluster (OPENCLAW_SHARED), evaluates
each incoming event against an ingestion policy, filters out self-originated events,
and projects accepted events to local stores with provenance tracking. Mirrors the
promoter's architecture (health-check + exponential backoff, graceful shutdown) but
operates in the reverse direction: shared → local.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.3 | v4.3 | [A] | Implement subscriber (bin/memory-subscriber.mjs) |

## §3 — Design decisions (consumed from prior step's AUDIT_POST §6)

- Test baseline is 608 tests (531 pass, 77 fail — 73 pre-existing + 4 flaky).
- `createBackoff(opts)` from `bin/memory-promoter.mjs` is reusable — import and reuse
  it in the subscriber rather than duplicating.
- `mapToSharedSubject(event)` establishes subject-mapping convention: kanban →
  `kanban.events.*`, concept → `concepts.shared.*`, fact → `lessons.shared.*`. The
  subscriber must parse these same subjects to route incoming events.
- Phase-4-correction streak: 1 (target: 2).
- Phase-8-patch streak: 11 (Steps 2.1–4.2).

Additional decisions from Block 4 frozen decisions (RESUME.md §0):
- **Always-ingest kanban events** — unconditional (Step 4.5 wires the actual table, but
  the subscriber's ingestion policy must accept them unconditionally now).
- **Default privacy — DEFAULT-PRIVATE.** Only events explicitly promoted are ingested.
- **Conflict resolution — surface, don't auto-merge.** The subscriber stores with
  provenance; conflict surfacing is Step 4.6.
- The subscriber creates a durable consumer on the shared stream, not the local stream.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Shared stream unavailable at startup | LOW | Start in degraded mode with backoff, same pattern as promoter |
| Self-originated event loop | LOW | Filter on `promoted_from.node_id === nodeId` |
| Subject parsing ambiguity | LOW | Use prefix matching on known SHARED_SUBJECTS patterns |

No HIGH-severity risks.

## §5 — Deferrals

- Actual writes to entity/theme/decision/mention tables with provenance columns → Step 4.4.
- `tasks_observed` table for kanban events → Step 4.5.
- Conflict surfacing → Step 4.6.
- The subscriber projects events via callback hooks; Steps 4.4/4.5 wire the callbacks to
  concrete store writes.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create subscriber daemon with `evaluateIngestionPolicy(event, nodeId)` (pure function — accept/skip), `parseSharedSubject(subject)` (extract event category from NATS subject), `createSubscriber(nc, nodeId, opts)` (factory — durable consumer on shared stream, ingestion loop, backoff, provenance envelope), CLI main with graceful shutdown | `bin/memory-subscriber.mjs` | new |
| 2 | Tests: ~10 covering evaluateIngestionPolicy (self-skip, kanban accept, concept accept, lesson accept, unknown skip), parseSharedSubject (3 subject types), createBackoff import reuse (1 test) | `test/memory-subscriber.test.mjs` | new |
