# AUDIT_POST — Step 2.4 · First real adversarial run through the OpenClaw worker

**Closed:** 2026-07-15 · **Version:** v2.4-mid → v2.4 · **Verdict:** ACCEPTED (operator, 2026-07-15 — chose "call it proven, move on" over chasing a formal clean-close).

## Outcome vs. contract

2.4's contract: the grappe worker runs as the node's FULL OpenClaw (advanced-LLM frontend + local
harness), through mesh-collab, D11-guarded; first real adversarial session with non-trivial
artifacts + `visual:` operator review.

**Met.** Runs 7 and 8 (2026-07-15, 3 harness-loaded Claude/sonnet workers on the node's launchd
mesh-task-daemon, parallel inference):
- **Non-trivial artifacts:** 14 (run 7) + 8 (run 8), each reviewer critique 4k–10k chars, zero
  thinking-stream contamination (the f9e54ae/194a189 guards held).
- **Genuine adversarial behavior:** votes spanned continue (0.87–0.91) → converged (0.92–0.93) →
  **blocked (0.97, 0.91)** — reviewers dissented on real findings; the run-2 rubber-stamp failure
  mode is dead.
- **Correct, self-verifying deliverable:** the worker produced corrected F1/F2/F4 blocks with
  file:line rationale (lib/node-identity.mjs:419/:374-404), checked them against the LIVE file, and
  honestly reported F1/F2 already-correct while finding a real F4 gap (SS3.1 missing its
  `session.mode` anchor).
- **Bonus real bugs the task never asked for:** COLLAB_MODE (lib/mesh-collab.js:29-34) lacks
  cooperative/collaborative/management constants (→ Block 3 groundwork); strict verifyEvent reads
  event.node_id (undefined) not signer_node_id. Captured for Block 3.
- **Operator `visual:`:** reviewed the artifacts, accepted the premise as proven.

## Not a clean COMPLETED — and why that's fine (finding 13)

Both runs aborted in late sub-rounds on the circling step budget: OpenClaw workers' deep-review
turns run 5–15 min each, a 2-sub-round session is 15+ serialized turns (>1h), and some single turns
exceed even a 30-min budget. This is an operational parameter of advanced-LLM grappes, not a defect
or a pipeline bug. A formal clean-close is a `max_subrounds:1` (or larger-budget) config run,
deferred as optional — the premise evidence does not need it.

## Phase-8 deltas this step

- mesh-task-daemon launchd + systemd units: `MESH_CIRCLING_STEP_TIMEOUT_MS=1800000` (30 min) so a
  deployed node can finish a real circling session (was: 10-min code default → finalization aborts).
- Findings 6–13 recorded in AUDIT_PRE §5 (thinking-strip, zero-artifact guard, driver collision,
  corrupt-KV coordinator kill, one-bus-one-coordinator, survive-restart-via-service, budget-vs-turn).

## Carry-forward

- **2.6 (premise benchmark)** inherits a proven OpenClaw-worker path. Needs: a solo-OpenClaw baseline
  (same model, no reviewers), ≥5 tasks, blind operator scoring.
- **Block 3** inherits the COLLAB_MODE gap the workers found — cooperative/collaborative need their
  constants + dispatch.
- Optional: the `max_subrounds:1` clean-close run, any time.
