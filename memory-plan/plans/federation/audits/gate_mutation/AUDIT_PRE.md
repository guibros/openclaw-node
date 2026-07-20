# AUDIT_PRE — gate mutation-tests (operator "go" 2026-07-19)

**Written:** before code. The "gates rot" countermeasure: prove each custom gate still REJECTS
known-bad input. Motivated by two live instances this week (inject probe budget grading a loaded
live server BROKEN; embed benchmark flaking on load) and MASTER_PLAN §4.9 (audits decay).

## Scope: custom logic only
Vendored tools' core behavior (tsc rejecting type errors, npm audit parsing advisories) does not
rot. OUR glue does: grep patterns, shell guards, budget constants, ignore-lists. Targets:

1. **Tarball-smoke assertions** (.github/workflows/test.yml) — the three greps must FAIL against
   doctored pack listings (module deleted, install.sh missing, event-schemas dist absent) and
   PASS against the real captured listing. Fixture-based: the logic is replicated against text
   fixtures; the real listing capture is proven by CI itself.
2. **scope-check.sh** — the most load-bearing gate in the repo. Invoke the hook directly with a
   PreToolUse-shaped payload: out-of-scope path → must block (exit 2); in-scope path (this batch's
   own test file) → must allow; always-writeable (OUT_OF_SCOPE.md) → must allow.
3. **MEM-L2-INJECT budget vs design** — static: probe timeoutMs must exceed the inject server's
   designed worst case (DEFAULT_ANALYSIS_TIMEOUT + margin). Locks the calibration relationship
   that rotted once already.
4. **MC eslint gate vacuity** — the rot mode is `ignores` silently swallowing src/ (gate passes
   because nothing is linted). Assert eslint actually scans a healthy file count AND rejects a
   seeded-error scratch file. Runs from the root suite via execSync into mission-control.
5. **node-watch graders** — audit-only: verify the existing 32-test suite already asserts each
   memory grader's REJECT path via the real-failure fixtures; fill gaps only if found.

## Non-goals
Mutating package.json/CI for real (fixtures only); testing vendored tool internals; a scheduled
re-run cadence (the tests join the root suite — every CI run IS the cadence).

## Verify
New suite green locally + full root suite green + CI green on its own run.
