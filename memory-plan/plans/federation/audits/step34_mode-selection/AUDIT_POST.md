# AUDIT_POST — Step 3.4 · Mode-selection contract

**Closed:** 2026-07-15 · **Version:** v3.3 → v3.4

## Contract vs. delivered

3.4 goal: mode choice is a contract, not folklore — the spec says which task shapes get which mode,
the envelope carries it, dispatch honors it.
Verify: spec decision table + envelope `preferred_mode` + dispatch honors it (unit test); runtime —
a session created with each of the three values lands in the matching protocol.

**Delivered:**
- **docs/FEDERATION_SPEC.md** — §3.4 decision table (high-stakes single artifact → adversarial;
  exploratory/no-owner → cooperative; decomposable → collaborative) and §5.1 task envelope carries
  `preferred_mode` (already present from prior spec work; verified correct + consistent with code).
- **lib/mesh-collab.js** — `PREFERRED_MODE_MAP` + `resolvePreferredMode()` (adversarial →
  circling_strategy · cooperative → cooperative · collaborative → collaborative). `createSession`
  resolves the effective mode as: explicit wire `mode` wins → else `preferred_mode` mapped → else
  parallel; unknown preferred_mode throws (fail-loud). The circling/cooperative/collaborative
  substructure blocks + min_nodes now key off the RESOLVED mode, so a preferred_mode-only spec builds
  the correct protocol.
- **bin/mesh-task-daemon.js** — envelope-level `task.preferred_mode` folds into the spec as a fallback
  when the collaboration spec sets neither mode nor preferred_mode.

## Verify — both halves met

- **code:** `test/collab-mode-selection.test.mjs` 8/8 (map correctness incl. unknown→null; decision
  table = 3 rows; createSession honors each preferred_mode + builds the right substructure; explicit
  mode wins; unknown preferred_mode throws; parallel default). Regression 98/98 green.
- **runtime:** live launchd daemon (reloaded); 3 tasks submitted with `collaboration.preferred_mode`
  = adversarial / cooperative / collaborative each auto-created a session whose `session.mode` was
  circling_strategy / cooperative / collaborative respectively — all three matched. Zero Claude spend
  (sessions created + purged, no agents). 

## Carry-forward
- 4.1 management decomposer applies the §3.4 table mechanically (`preferred_mode` per subtask, §4.1).
- 3.5 — Phase-1 operational gate (T3 matrix, chaos, ≥12h soak, T7). The premise verdict (2.6) it
  needs is done. This is the heavier remaining Block-3 step.
