# AUDIT_PRE — Step 1.4: Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4)

**Version:** v1.4-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Create the shared JetStream stream `OPENCLAW_SHARED` with R=3 replication across the three mesh nodes (moltymac, Ubuntu VM, macOS VM). This is infrastructure preparation only — the stream sits idle until Block 4 wires promoter/subscriber processes. The module follows the same pattern as `lib/local-event-log.mjs` (idempotent stream creation via `jsm.streams.info()` / `jsm.streams.add()`).

This is the last step of Block 1. After Phase 9 close, the block-close ceremony runs.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.4 | v1.4 | [A] | Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4) |

## §3 — Design decisions (from prior step's AUDIT_POST §6)

- Test baseline is now 512 tests (439 pass, 73 fail pre-existing). +6 tests added in Step 1.3.
- `lib/artifacts.mjs` exports `putArtifact`, `getArtifact`, `hasArtifact`, `validateArtifact`. No caller wiring yet — standalone and local-only.
- Peer NATS RPC `artifacts.fetch.<hash>` is Block 4 scope.
- `buildMemoryEvent` from `lib/local-event-log.mjs` is available if artifact events need publishing in a future step.
- `docs/STATE_FILES.md` update for artifacts directory deferred (not Step 1.4's scope).
- `npm install` may still be blocked. No new dependencies for this step either.
- `docs/ARCHITECTURE.md` stale references remain (out of scope).
- Phase-4-correction streak: 1-of-3 (target: extend to 2-of-4).
- Phase-8-patch streak: 2-of-3 (target: extend to 3-of-4).

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| NATS cluster not configured for 3-node operation (R=3 requires ≥3 cluster members) | LOW | Module uses `num_replicas: 3` in stream config; if cluster has fewer nodes, NATS will reject at runtime. The module is correct regardless — it's the cluster topology that needs ≥3 nodes. Module includes an `inspectSharedStream()` function that reports cluster state for operational verification. |
| Subject filter too broad or too narrow | LOW | Subjects are verbatim from REFERENCE_PLAN §1.4, frozen in RESUME.md §0. No discretion exercised. |
| Stream name collision | NEGLIGIBLE | `OPENCLAW_SHARED` is a unique name, not used by any existing code (`grep` confirms zero hits). |

No HIGH-severity risks.

## §5 — Deferrals

- Promoter/subscriber processes: Block 4 scope.
- Memory data flows through shared stream: Block 4 scope.
- Kanban event publishing to shared stream: separate kanban work.
- NATS server cluster topology configuration (nats-server.conf files on each node): operational/infrastructure task, outside repo scope. The module creates the stream on whatever cluster is connected.
- Authentication/authorization for shared stream subjects: deferred.

## §6 — Phase 4 implementation outline

| # | File | Delta | Type |
|---|------|-------|------|
| 1 | `lib/shared-event-stream.mjs` | New module. Exports `ensureSharedStream(nc)` — creates/verifies `OPENCLAW_SHARED` stream with R=3, File storage, 7-subject filter. Exports `inspectSharedStream(nc)` — returns stream info for operational verification. Exports `SHARED_STREAM_NAME` and `SHARED_SUBJECTS` constants. Uses same pattern as `lib/local-event-log.mjs` (`jsm.streams.info()` / `jsm.streams.add()`). | new |
| 2 | `test/shared-event-stream.test.mjs` | New test file. Tests: (1) `ensureSharedStream` creates stream with correct name, (2) correct `num_replicas: 3`, (3) correct subject filter matches all 7 subject patterns, (4) correct File storage, (5) idempotent — second call succeeds without error, (6) `inspectSharedStream` returns stream config, (7) `inspectSharedStream` throws on missing stream, (8) `SHARED_STREAM_NAME` equals `OPENCLAW_SHARED`, (9) `SHARED_SUBJECTS` has 7 entries with each individual pattern verified. 16 `it()` blocks total. | new |

## Mid-Implementation Findings

- **StorageType.File value correction:** Test initially asserted `StorageType.File === 2` (numeric). Actual value in `nats` library is the string `'file'`. Fixed during Phase 5 verification to use imported `StorageType.File` constant. This is a Phase-4-correction (streak resets to 0).
- **Test count discrepancy:** AUDIT_PRE §6 described 6 conceptual tests; implementation expanded to 16 individual `it()` blocks (7 subject-pattern checks became individual assertions). No new requirements — granularity increase only.
