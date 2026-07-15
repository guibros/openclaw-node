# AUDIT_PRE — step 6.4 (federation test census in CI + NODE_ACCEPTANCE federation axis)

**Step:** 6 / 6.4 → v6.4
**Verify contract (INVENTORY):** `code:` CI run: nats absent ⇒ visible census skip with
filenames; nats present ⇒ suites run; `runtime:` one observed green CI including the federation
census.

## Pre-state

- **Census already exists** — `test/mesh-skip-census.test.mjs` has two classes:
  - Class 1 (`meshSkipReason`) — mesh-stack-dependent suites (7 files).
  - Class 2 (`filesContaining('nats-server not found on PATH')`) — nats-binary-gated federation
    suites (5 files: federation-2node/3node/resilience, circling-parse-retry/adaptive-convergence).
  It runs inside `npm test`; `.github/workflows/test.yml` runs `npm test` on ubuntu runners that
  have no `nats-server` ⇒ the federation tier skips VISIBLY with filenames. **Census `code:` half is
  effectively already met.**
- **No `federation` axis** in the acceptance gate — `lib/node-acceptance-probes.mjs` covers
  storage/memory/network/llm; `computeGate` rejects on ANY fail/block.
- Collab/circling UNIT suites (mode-dispatch, cooperative, collaborative, worker-harness, fed-probes)
  carry no skip marker — they always run, so nothing federation-related silently vanishes today.

## Plan (autonomous half)

1. **NODE_ACCEPTANCE federation axis** — two substrate-fitness probes in
   `lib/node-acceptance-probes.mjs`, reusing the 6.3 pure graders:
   - `FED-L2-COORD` (required:false) — mesh-task-daemon loaded ⇒ can coordinate grappes; else
     worker/standalone → SKIP (still ACCEPTED).
   - `FED-L2-QUORUM` (required:false) — `:8222/jsz`+`/varz` topology → `gradeClusterQuorum`.
   Verdict map: WORKING→PASS, OFF/UNKNOWN→SKIP, BROKEN→FAIL. Federation is on-demand, so it must
   never be the SOLE reason a node is rejected: bus-down pre-checks to SKIP (the required network
   axis NET-L2-JSZ owns bus liveness). Live grappe/session LIVENESS stays node-watch's job (6.3).
2. `test/fed-acceptance.test.mjs` — mock-ctx unit tests for both probes + the verdict mapping.
3. **Census completeness guard** in `test/mesh-skip-census.test.mjs` — HARD-FAIL (never skip) if any
   test file gates a describe/test on nats with a skip reason that isn't the canonical censused
   marker, so a future nats-gated suite can't silently escape both census classes. This is the
   "honestly" in the 6.4 goal.

## Honest boundary (declared up front)

- The `runtime:` half — "one observed green CI including the federation census" — needs a **push** to
  observe a CI run. Not observable from this session. 6.4 lands **[A]** (code done + locally green),
  not [x], until an operator push yields an observed-green CI. No green claimed without the run
  (feedback-no-unverified-status-claims).
