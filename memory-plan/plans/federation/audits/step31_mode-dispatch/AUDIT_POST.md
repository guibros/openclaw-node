# AUDIT_POST — Step 3.1 · Mode dispatch seam

**Closed:** 2026-07-15 · **Version:** v2.6 → v3.1

## Contract vs. delivered

3.1 goal: one session schema carries all modes; the daemon dispatches by mode without forking the
stack; unknown modes rejected; the adversarial default preserved (93 circling tests green).

**Delivered:**
- **Schema (was already partly present** from the prior COLLAB_MODE-gap fix the 2.4 grappe surfaced):
  `COLLAB_MODE` declares all seven modes; `createSession` validates and stores `session.mode`,
  throwing on unknown modes (no silent PARALLEL fallback). Field name is `session.mode` per the
  FEDERATION_SPEC F4 hardening — NOT `architecture` (the INVENTORY's old wording is stale).
- **Dispatch seam (new, lib/mesh-collab.js):** `IMPLEMENTED_MODES` + `isModeImplemented(mode)` — one
  shared source of truth. Live: parallel, sequential, review, circling_strategy. Declared-but-unbuilt:
  cooperative (3.2), collaborative (3.3), management (Block 4).
- **Daemon dispatch (new, bin/mesh-task-daemon.js recruiting-complete):** was a binary
  `circling_strategy | else→startCollabRound`; now an explicit three-way — circling → circling;
  legacy-implemented → startCollabRound; **unimplemented → abort loud** ("mode X has no daemon
  protocol yet. Aborting (not silently downgrading to parallel)"), releasing the parent task. This
  is the seam 3.2/3.3/4.x fill in.

## Verify — both halves met

- **code:** `test/collab-mode-dispatch.test.mjs` 7/7 pass (mode declared, createSession stores/rejects,
  isModeImplemented classification, no-orphan invariant, circling substructure preserved). Regression:
  circling family 137/137 green (contract said 93).
- **runtime:** live launchd daemon (reloaded on new code, PID 86183) — a submitted `cooperative` task
  auto-created a session `mode: cooperative` in KV, 3 nodes joined, RECRUIT DONE, and dispatch
  **aborted** with the fail-loud message. No LLM inference occurred (abort precedes any round) — a
  cheap, clean seam proof. Session purged after.

## Carry-forward
- 3.2 (cooperative) and 3.3 (collaborative) now have a clean seam: implement the protocol + move the
  mode into IMPLEMENTED_MODES + add the daemon branch. Until then they abort honestly.
- Block 4 management mode likewise.
