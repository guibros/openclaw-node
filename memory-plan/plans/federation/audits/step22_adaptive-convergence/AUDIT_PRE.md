# AUDIT_PRE — Step 2.2 · Paper gap 14.1 — adaptive convergence (unanimous converged ⇒ early finalization)

## §0 Micro Re-Orient

Block 2, step 2 of 5 (2.2 of 2.1/2.2/2.3/2.4/2.6). Prior step (2.1) established the full
circling lifecycle end-to-end (4 rounds, all barriers 3/3, session COMPLETE). This step proves
paper §14.1: a session where all nodes converge unanimously on step 2 of SR_N must skip to
finalization rather than burn the remaining max_subrounds−N inferences. Contributes to Block 2's
token-budget story (ROADMAP constraint 3) which 2.4 and D3 depend on. Still the right next
step — yes.

## §1 Intent

Paper gap §14.1 (FEDERATION_SPEC §7.3.4): when all active nodes vote `converged` on circling
step 2, the session should advance directly to finalization rather than advancing to the next
subround. On consumer hardware (D3: ~35 GPU-min/session) this cuts cost on tasks where nodes
reach consensus faster than the max_subrounds budget assumed.

## §2 Design (consuming 2.1 carry-forwards)

Carry-forward from 2.1: `advanceCirclingStep` in lib/mesh-collab.js handles the transition at
lines 750-767. Inspection confirms the early-exit IS already present (lines 750-755):
```
if (allConverged && c.current_subround < c.max_subrounds) {
  if (c.automation_tier >= 2) needsGate = true;
  c.phase = 'finalization'; c.current_step = 0;
}
```
The 2.1 session used max_subrounds=1, so this branch was never reached (1 < 1 is false). Step
2.2's work: (a) update the misleading JSDoc which only documents the non-early-exit path,
(b) write unit tests that directly exercise this branch with max_subrounds=3, (c) run a runtime
mock session with max_subrounds=3 scripted to converge in SR1 and observe early finalization.

## §3 Risk register

- **R1:** Mock KV layer for unit tests must faithfully simulate _updateWithCAS behavior.
  Mitigation: build a minimal in-memory mock that stores JSON + revision, no encoding bypass.
- **R2:** Runtime session timing — mesh-task-daemon must be running. 2.1 confirmed the daemon
  works; same setup.
- **R3:** JSDoc comment fix is minor but must not introduce logic drift. Mitigation: restrict
  to the comment block, no logic touches.

## §4 Pre-screen: Needs check

- 2.1 baseline: `lib/mesh-collab.js` present (34920 bytes), `bin/mesh-task-daemon.js` present ✓
- `advanceCirclingStep` at line 727 — confirmed present ✓
- No decisions needed (logic exists, step proves + documents it) ✓

## §5 Phase-8 patches anticipated

None expected.

## §6 File-delta outline

| File | Change |
|---|---|
| `lib/mesh-collab.js` | Fix JSDoc comment (lines 722-726) — add early-exit path to state machine diagram |
| `test/circling-adaptive-convergence.test.mjs` | **NEW** — unit tests for §14.1 via mock KV |
| `memory-plan/plans/federation/VERSION` | v2.2-pre → v2.2-mid → v2.2 |
| `memory-plan/plans/federation/INVENTORY.md` | flip 2.2 [ ] → [A] → [x] |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | Family 2 — note adaptive convergence proven |
| `memory-plan/plans/federation/audits/step22_adaptive-convergence/AUDIT_PRE.md` | this file |
| `memory-plan/plans/federation/audits/step22_adaptive-convergence/AUDIT_POST.md` | Phase 7 |
