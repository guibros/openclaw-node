# AUDIT_POST — CI dependency-audit gate on PR #12

**Closed:** 2026-09-14, Montreal · Not a plan step: a drive-to-green fix on the plan's own PR.

## What was red

`unit-tests (22)` failed on head `2e95112`. The test suite itself **passed** — `# tests 2293 ·
# pass 2287 · # fail 0 · # skipped 6`. The job died at a later step, the root
`npm audit --audit-level=high` gate:

```
sharp  <0.35.4
Severity: high
sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545
No fix available
node_modules/sharp
  @huggingface/transformers  *
```

## Whose failure it is

Not this PR's, and not fixed by waiting. `sharp` reaches the tree through
`@huggingface/transformers` (the knowledge embedder), which this branch never touched, and the lock
pinned `0.35.3` **identically on `origin/main`** — verified by reading main's own
`package-lock.json`, not inferred. The advisory is what changed, not the dependency: `main`'s last
workflow run is 2026-09-08 and was green, so there is no red base run to point at, but the same
audit run against main's pin fails the same way today.

A base-branch failure with a fix that exists is ported into this PR rather than waited on, so:

## The fix, and why "No fix available" was not the last word

npm reported no fix because the *resolver* saw nothing to move: sharp is not a direct dependency
here, and `@huggingface/transformers@3.8.1` asks for `sharp: ^0.34.1`, a range that excludes every
0.35.x. But `sharp@0.35.4` — the patched release — **is published**, and this repo already forces a
single sharp version through an `overrides` entry, which is exactly why one hoisted `0.35.3` sits
there instead of a nested `0.34.x`. Raising that floor is the repo's own mechanism, not a workaround:

- `package.json` and `mission-control/package.json`: `overrides.sharp` `^0.35.0` → `^0.35.4`
- both lockfiles regenerated with `npm install --package-lock-only` (tooling, never by hand)

Mission Control carried the identical high-severity finding and would have failed its own gate on the
next run; both were fixed together rather than one now and one after the next red build.

## Evidence

- Root `npm audit --audit-level=high` → `found 0 vulnerabilities`, **exit 0** (was exit 1).
- Mission Control `npm audit --audit-level=high` → **exit 0**, zero high or critical findings. Its
  remaining moderate findings (vitest mocker, esbuild via drizzle-kit) are below the gate and
  untouched — this fix does not quietly widen into them.
- Lock diff is 123 lines each way: `sharp` and its `@img/*` platform binaries, nothing else.
- `npm ci` then a functional check, because a bumped version that cannot load is worse than the
  advisory: `sharp 0.35.4 libvips 8.18.6`, and an 8×8 PNG encoded to 95 bytes.
- Root suite: **2196 / 1910 pass / 211 fail / 7 skipped** — every number identical to the pre-bump
  run, failure lists diffed by name, empty both ways.
- Mission Control: 149/149, `npx eslint .` exit 0, `tsc --noEmit` clean.

Recorded under a `ci-audit-gate` block in `SCOPE.md` rather than written around it: the two manifests
and their locks are outside every step block, and the scope contract binds whatever tool performs the
write.
