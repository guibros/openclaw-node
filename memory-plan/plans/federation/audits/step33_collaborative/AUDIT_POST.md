# AUDIT_POST — Step 3.3 · Collaborative protocol

**Closed:** 2026-07-15 · **Version:** v3.2 → v3.3

## Contract vs. delivered

3.3 goal: a task splits into per-node subtasks executed in parallel and merged, live.
Verify: mock-LLM collaborative session — 3 subtasks to 3 distinct node-ids, worked concurrently
(overlapping timestamps), merge artifact produced, merge-review vote recorded.

**Delivered — decompose → parallel subtasks → merge + merge-review, on the round barrier
(reuses the existing `partitioned` scope_strategy for decomposition):**
- **lib/mesh-collab.js:** `collaborative` session block (merger_node_id, phase work→merge→done,
  subtasks{}, merged, review_votes[]); COLLABORATIVE added to IMPLEMENTED_MODES.
- **bin/mesh-task-daemon.js:** recruiting-close designates a merger, sets scope_strategy=partitioned,
  starts the work round; new `evaluateCollaborativeRound` — work phase records the per-node subtask
  results and advances to the merge round; merge phase records the merger's artifact + the other
  nodes' merge-review votes, then completes. Per-round role generalized: the round notification now
  carries `round_role` (cooperative: integrator/proposer · collaborative: subtask_worker in the work
  round, merger/merge_reviewer in the merge round), replacing 3.2's `cooperative_role`.
- **bin/mesh-agent.js:** the round prompt handles subtask_worker (own one slice, work in parallel),
  merger (assemble all subtasks into one coherent artifact), merge_reviewer (review + vote).

## Verify — both halves met

- **code:** `test/collab-collaborative.test.mjs` 4/4 (session block, partition invariant, merge-role
  split). Full regression 150/150 green (incl. the updated 3.1 dispatch test).
- **runtime:** live launchd daemon (reloaded) + 3 shell-provider (mock) agents. A collaborative task
  with a 3-path scope ran: **3 subtasks partitioned to 3 distinct node-ids (charlie, alpha, bravo),
  work-round timestamp span 0.2s (concurrent/overlapping), merged by alpha, merge-review votes
  charlie=converged + bravo=converged, status=completed**; KV recorded subtasks + merged + votes.
  Near-zero Claude spend (shell provider). Session purged after.

## Carry-forward
- Block 3 protocol modes are DONE: adversarial (2.x), cooperative (3.2), collaborative (3.3).
- 3.4 — mode-selection contract (FEDERATION_SPEC decision table + envelope `preferred_mode` honored).
- 3.5 — Phase-1 operational gate (T3 matrix, chaos, soak, T7). Needs the 2.6 premise verdict (done).
- 4.1 (management decomposition) maps naturally onto this collaborative subtask machinery.
