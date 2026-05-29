# AUDIT_POST — Step 1.3: Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/)

**Version:** v1.3-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/artifacts.mjs` (new): putArtifact, getArtifact, hasArtifact, validateArtifact, refToPath, ensureDir | `lib/artifacts.mjs:48` (putArtifact), `:82` (getArtifact), `:103` (hasArtifact), `:118` (validateArtifact), `:23` (refToPath) | yes | `grep -n 'export async function putArtifact' lib/artifacts.mjs` → line 48 |
| 2 | `test/artifacts.test.mjs` (new): 6 tests for put+get, hasArtifact, validateArtifact, tamper detection, idempotent put, .meta.json sidecar | `test/artifacts.test.mjs:1` (6 tests in 1 describe block) | yes | `grep -n 'it(' test/artifacts.test.mjs` → 6 hits at lines 26, 36, 44, 54, 67, 77 |

All 2 rows landed = yes. 2 non-audit non-ledger files in planned diff = 2 unique files changed.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export async function putArtifact' lib/artifacts.mjs` | `48:export async function putArtifact(bytes, { mime_type, filename, baseDir } = {}) {` |
| 2 | `grep -n 'export async function getArtifact' lib/artifacts.mjs` | `82:export async function getArtifact(ref, { baseDir } = {}) {` |
| 3 | `grep -n 'export async function hasArtifact' lib/artifacts.mjs` | `103:export async function hasArtifact(ref, { baseDir } = {}) {` |
| 4 | `grep -n 'export async function validateArtifact' lib/artifacts.mjs` | `118:export async function validateArtifact(ref, { baseDir } = {}) {` |
| 5 | `grep -n 'function refToPath' lib/artifacts.mjs` | `23:function refToPath(ref, baseDir) {` |
| 6 | `grep -n '.meta.json' lib/artifacts.mjs` | `52:  const metaPath = artifactPath + '.meta.json';` |
| 7 | `grep -n 'it(' test/artifacts.test.mjs` | `26:  it('put+get roundtrip — bytes match', async () => {` |

## §3 — Cross-references still valid

- `putArtifact`, `getArtifact`, `hasArtifact`, `validateArtifact` are defined in `lib/artifacts.mjs` and imported by `test/artifacts.test.mjs:8-12`. No other files reference these yet. No stale imports.
- `refToPath` and `ensureDir` are internal (not exported). No external references.
- No existing codebase files were modified; the two new files are self-contained.
- No imports from `lib/artifacts.mjs` exist in the daemon or MemoryBudget — expected, as wiring is deferred.
- The `node:crypto`, `node:fs/promises`, `node:path`, `node:os` imports are all Node.js built-ins. No new dependencies.
- Zero stale references found in codebase-wide search for `putArtifact`, `getArtifact`, `hasArtifact`, `validateArtifact`, `refToPath`.

## §4 — Findings

- [POSITIVE] All 2 planned file deltas landed exactly as specified in AUDIT_PRE §6. Zero deviations.
- [POSITIVE] The content-addressed sharding layout `sha256/<2>/<2>/<full-hash>` matches RESUME.md §0 Block 1 frozen decisions exactly.
- [POSITIVE] `.meta.json` sidecar contains all specified fields: `ref`, `size`, `mime_type`, `filename`, `created_at`, `encoding`.
- [POSITIVE] `putArtifact` is idempotent — checks file existence before writing, so duplicate puts skip the write entirely.
- [POSITIVE] 6 new tests all pass, covering all four exported functions plus idempotency and sidecar validation. Test total: 512 (439 pass, 73 fail pre-existing).
- [POSITIVE] No dependencies added. The module uses only Node.js built-ins (`node:crypto`, `node:fs/promises`, `node:path`, `node:os`). Zero supply-chain surface.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 1.4

- Test baseline is now 512 tests (439 pass, 73 fail pre-existing). +6 tests added this step.
- `lib/artifacts.mjs` exports `putArtifact`, `getArtifact`, `hasArtifact`, `validateArtifact`. No caller wiring yet — the artifact store is standalone and local-only.
- Peer NATS RPC `artifacts.fetch.<hash>` is Block 4 scope. `getArtifact` currently throws on miss; the Block 4 step will add a fallback to RPC before throwing.
- `buildMemoryEvent` from `lib/local-event-log.mjs` is available if artifact events (`memory.artifact_attached`) need publishing in a future step. Not wired in this step.
- `docs/STATE_FILES.md` should be updated to document the `~/.openclaw/artifacts/` directory layout (deferred, not Step 1.4's scope either — Step 1.4 is cluster config).
- `npm install` may still be blocked. No new dependencies, so no impact.
- `docs/ARCHITECTURE.md` stale references remain (out of scope).
- Phase-4-correction streak: 1-of-3 (this step had zero mid-implementation corrections).
- Phase-8-patch streak: 2-of-3 (this step had zero Phase 8 patches).
