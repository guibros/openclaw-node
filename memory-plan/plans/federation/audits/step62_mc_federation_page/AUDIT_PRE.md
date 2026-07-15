# AUDIT_PRE — step 6.2 (MC federation page: grappes, sessions, rounds, votes, gates)

**Step:** 6 / 6.2 → v6.2
**Verify contract (INVENTORY):** `visual:` operator confirms a live session's rounds/votes render
and a gate can be approved from the page · `runtime:` page + API 200 with real session data.

## Pre-state (what already exists)

MC (`mission-control/`, Next.js app-router) already has a substantial cowork feature:
- `/cowork` page — tabs Sessions / Clusters / Dispatch; `useCollabSessions`, `SessionCard`.
- `api/cowork/sessions` — reads MESH_COLLAB via `getCollabKv()`, returns the **full** session
  object unchanged (no field stripping). Also `events`, `intervene`, `sessions/[id]`, `dispatch`.
- `SessionCard` renders the **circling/reflection model**: rounds, per-node reflections, **votes**
  (converged/blocked), confidence, node chips, intervention (Force Converge / Abort).
- `@/lib/nats.ts` — singleton connection, `getCollabKv/getHealthKv/getTasksKv`.

## Gap (what's missing for the Block-3 modes)

1. `CollabSession` type + `SessionCard` only model circling. The **new mode substructures** are
   neither typed nor rendered: cooperative `{integrator_order, current_integrator, integrations[]}`,
   collaborative `{merger_node_id, phase, subtasks{}, merged, review_votes[]}`, circling `{worker,
   reviewerA/B, subround, step, phase}`. The API already passes them through — only the client lags.
2. `MODE_BADGE` lacks circling_strategy / cooperative / collaborative / management (they fall back to
   a generic zinc badge).
3. **Gates** — "a gate can be approved from the page." No operator-approvable gate exists yet; that
   belongs to Block 4 management (`requires_approval`) + savant change-sets — unbuilt. The
   collaborative merge-review gate STATE (votes) can render; operator gate-APPROVAL is premature.

## Plan (autonomous, verifiable half)

1. Extend `CollabSession` (hooks.ts) with optional `circling?/cooperative?/collaborative?` blocks +
   a `CollabArtifact` type (worker artifacts are `{summary, artifacts}` objects, not strings).
2. `SessionCard`: mode badges for the 4 new modes; mode-aware expanded sections rendering
   integrations (cooperative), subtasks/merge/review-votes (collaborative), and circling state.
3. Verify runtime: build passes, MC serves, `api/cowork/sessions` 200 with real MESH_COLLAB data,
   the page renders live sessions (generate real cooperative/collaborative sessions to exercise it).

## Honest boundary

- The `visual:` operator sign-off is theirs; I can only confirm the page renders real data.
- Operator gate-APPROVAL is forward-deferred to Block 4 management (no operator-gated step exists yet)
  — same deferral shape as 6.3's management/savant notify sources.
