# AUDIT_POST — Step 2.3: Promoter writes only new/changed notes (R8)

(AUDIT_PRE folded here — the step opened as a mechanical change-detection fix; §0: Block 2, step 3/11, 11/48; contributes determinism to the shared-vault writer; still-right-next: yes.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/obsidian-promoter.mjs` | ✓ | Change detection comparing content sans the volatile `promoted_at` line; skip-unchanged; `atomicWriteFileSync` replaces bare writeFile; **+ unplanned but in-scope:** deterministic slug-collision handling (first-wins by mention_count, `collisions` reported) — required for the Proof to be satisfiable at all (see Findings). Return gains `skipped` + `collisions`. |
| `test/obsidian-promoter.test.mjs` | ✓ | Old overwrite-tolerance test → skip-semantics test (mtime-locked); +changed-entity-rewrites-exactly-its-note; +collision determinism. 10/10. |

## Verification (Phase 5 — the Proof)

- **Tests:** 10/10; full suite 1503/1503 (pre-collision-fix run; collision test added after — file-local 10/10).
- **Runtime (deployed lib, live state.db, sharedDir override):** run 1 promoted 23 notes + reported 1 collision (`openclaw.md`: `OpenClaw` wins over `openclaw` by mention count); run 2 → **promoted=0, skipped=23, mtime snapshot byte-identical**. Changed-entity rewrite covered by test (exactly its own note).

## Findings (the §7.3 tripwire fired — handled by capture, not scope expansion)

1. **First double-run was NOT idempotent (promoted=2 on run 2):** diff showed `openclaw.md` written twice per run — two distinct entities (`OpenClaw`, `openclaw`) slugify identically and ping-pong overwrite. The minimal deterministic slice (first-wins + report) landed in this step; the underlying entity-duplication/canonicalization defect → OUT_OF_SCOPE (Block 2 re-plan candidate; it equally affects the local vault writer, where last-wins silently hides one entity's note).
2. **Promoter unfiltered post-D7:** its shared dir is a federation-era surface → OUT_OF_SCOPE, decide at P.3.

## Carry-forwards
- 2.4's checker should count slug collisions among above-threshold entities (one more integrity dimension it can measure for free).
