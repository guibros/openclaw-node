# AUDIT_PRE — Step 1.3: Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/)

**Version:** v1.3-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Create `lib/artifacts.mjs` — the content-addressed artifact store for the OpenClaw memory
infrastructure. Artifacts are stored under `~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>`
with `.meta.json` sidecars containing metadata. The store is local-only for now; peer NATS RPC
(`artifacts.fetch.<hash>`) is deferred to Block 4.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.3 | v1.3 | [A] | Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/) |

## §3 — Design decisions (consumed from Step 1.2 AUDIT_POST §6)

- Test baseline is 506 tests (433 pass, 73 fail pre-existing).
- `npm install` may still be blocked. The event-schemas build workaround (mission-control tsc path) continues to work.
- `buildMemoryEvent` is available as a standalone helper for constructing envelope-conformant events. Step 1.3 may use it for `memory.artifact_attached` events — however, per RESUME.md §0 the artifact store is local-only and does not wire into MemoryBudget or the daemon in this step. Event publishing for artifacts is deferred.
- `docs/ARCHITECTURE.md` stale references remain (out of scope).
- `docs/STATE_FILES.md` should be updated to mention local event log stream data (deferred, not this step's scope).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | SHA-256 computation on large files could be slow | LOW | Node.js crypto module is C-binding native; performance is fine for expected artifact sizes (code files, configs, small binaries). |
| 2 | Concurrent `putArtifact` calls for same content could race on file write | LOW | Content-addressed writes are idempotent — if the file already exists with the correct hash, skip writing. Worst case: two concurrent writes produce identical output. |
| 3 | Test temp directory cleanup | LOW | Use `node:fs/promises` + `mkdtemp` for isolated test dirs; cleanup in after hooks. |

## §5 — Deferrals

- Peer NATS RPC `artifacts.fetch.<hash>` — Block 4 wiring.
- `memory.artifact_attached` event publishing — no dual-write for artifacts in this step; the store is pure local I/O.
- `docs/STATE_FILES.md` update for artifacts directory — deferred to a future step.

## §6 — Phase 4 implementation outline

| # | File | Type | Delta |
|---|------|------|-------|
| 1 | `lib/artifacts.mjs` | new | Content-addressed artifact store. Exports: `putArtifact(bytes, { mime_type, filename })` — computes SHA-256, writes to `<base>/sha256/<ref[0:2]>/<ref[2:4]>/<ref>`, writes `.meta.json` sidecar with `{ ref, size, mime_type, filename, created_at, encoding }`, returns `{ ref, size, path }`. Idempotent: existing file with matching hash → return existing ref. `getArtifact(ref)` — reads bytes from local path, throws if not found. `hasArtifact(ref)` — returns boolean. `validateArtifact(ref)` — re-hashes stored bytes, returns `{ valid, ref, computedRef }`. Internal helpers: `refToPath(ref, baseDir)` for shard layout, `ensureDir` for recursive mkdir. Default base: `~/.openclaw/artifacts/`. Configurable via `OPENCLAW_ARTIFACTS_DIR` env var or function parameter. |
| 2 | `test/artifacts.test.mjs` | new | 6 tests: (1) put+get roundtrip — bytes match, (2) hasArtifact returns true after put / false for unknown ref, (3) validateArtifact returns valid:true for intact artifact, (4) validateArtifact detects tampering (overwrite bytes, validate returns valid:false), (5) putArtifact is idempotent — same content produces same ref on second put, (6) .meta.json sidecar contains expected fields (ref, size, mime_type, filename, created_at). |
