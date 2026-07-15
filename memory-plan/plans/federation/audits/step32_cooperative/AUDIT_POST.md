# AUDIT_POST — Step 3.2 · Cooperative protocol

**Closed:** 2026-07-15 · **Version:** v3.1 → v3.2

## Contract vs. delivered

3.2 goal: three nodes co-author one artifact with a rotating integrator, live.
Verify: mock-LLM cooperative session — 3 rounds, integrator differs each round (KV state), final
artifact assembled from all proposals, barriers 3/3 each round.

**Delivered — propose-all / integrate-one / rotate-integrator, reusing the legacy round barrier
(NOT a fork of the circling machinery):**
- **lib/mesh-collab.js:** `cooperative` session block (integrator_order, rounds_target default 3,
  current_integrator, integrations[]); COOPERATIVE added to IMPLEMENTED_MODES.
- **bin/mesh-task-daemon.js:** recruiting-close sets the integrator rotation (node join order) and
  starts round 1; `startCollabRound` tags each node's per-round `cooperative_role`
  (integrator vs proposer); new `evaluateCooperativeRound` records the integration, rotates the
  integrator, runs rounds_target rounds, then completes with the final integration + all proposals.
- **bin/mesh-agent.js:** the round prompt gains a proposer/integrator instruction (proposer =
  contribute a distinct proposal; integrator = synthesize the others' proposals into one artifact).

## Verify — both halves met

- **code:** `test/collab-cooperative.test.mjs` 5/5 (session block, rounds_target, rotation math —
  every node integrates once over 3 rounds, wrapping). Full regression 146/146 green (incl. the
  updated 3.1 dispatch test: cooperative moved not-implemented → implemented).
- **runtime:** live launchd daemon (reloaded on new code) + 3 shell-provider (mock) agents. A
  cooperative task ran **3 rounds, integrator rotated charlie → alpha → bravo (a different node
  each round), barriers 3/3, status=completed**; KV recorded all 3 integrations with proposers.
  Near-zero Claude spend (shell provider). Session purged after.

## Bug found + fixed in-step
Non-CAS lost-update: the final round's integration was pushed in-memory but not persisted before
`markCompleted()` re-fetched the session → KV dropped the last integration (2 of 3 recorded).
Fixed: `collabStore.put(session)` before the completion branch. Re-run confirmed 3/3 persisted.
Same family as the pre-1.5 evaluateRound finding — now guarded in the cooperative path.

## Carry-forward
- 3.3 (collaborative — decompose → per-node subtasks → merge + merge-review) has the seam:
  add the session block, move to IMPLEMENTED_MODES, add the daemon branch + agent prompt.
- 3.4 mode-selection contract; 3.5 Phase-1 operational gate.
