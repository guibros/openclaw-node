# AUDIT_PRE — collab-mode P1 hardening (queue item 8; deep-review P1s #3–#9)

**Written:** 2026-07-17, before the code. Every finding re-verified against CURRENT sources
(post join-dispatch fix) with line-level reads this session.

## Findings confirmed, fix design

**#6 `evaluateRound` reentrancy (foundation — fix first).** Entry is naked get→stamp
`completed_at`→put; reflect-barrier, leave-handler, and (new) timeout paths can all fire it
concurrently → double integrations / double round-starts. FIX: `claimRoundEvaluation(sessionId)`
in mesh-collab using the existing `_updateWithCAS` — atomically stamps the current round
`evaluated=true` + `completed_at`; exactly one caller wins, losers get null and return.

**#7 zombie reflections count toward barriers.** `submitReflection` dedupes by node_id but never
checks membership — a removed node's late reflection inflates `reflections.length` and trips
`isRoundComplete` early. FIX: membership gate in `submitReflection` (reject non-members) AND
`isRoundComplete` counts only reflections from currently-active members (defense in depth).

**#3 merge-review votes are decorative.** `evaluateCollaborativeRound` merge phase records votes
then `markCompleted` UNCONDITIONALLY — two `blocked` votes complete identically to two
`converged`. FIX: the vote becomes a binding gate — complete only if approvals (`converged`) >
rejections AND ≥1 vote AND the merger actually submitted a merge; otherwise abort the session
loudly (votes in the reason) and fail the parent task.

**#5 integrator/merger death → silent placeholders.** Cooperative rotation walks the frozen
`integrator_order` even onto dead/removed nodes ("(integrator submitted no reflection)" rounds
forever); collaborative completes with "(merger submitted no reflection)". FIX: rotation skips
dead/removed nodes (abort if none alive); a missing integrator reflection is marked
`degraded: true` + loud log/audit, never silent; a missing MERGER reflection aborts (a merge
that never happened cannot pass review).

**#4 no barrier timeout for the new modes.** Circling has `step_started_at` + a sweep; cooperative/
collaborative rounds can hang forever on one crashed member. FIX: a round-timeout sweep for
ACTIVE cooperative/collaborative sessions — `now - currentRound.started_at >
MESH_COLLAB_ROUND_TIMEOUT_MS` (default 15 min, env-tunable) ⇒ mark non-reflected members dead
(audited), then abort if below min_nodes else evaluate with the quorum present. Mirrors circling's
timeout semantics.

**#8 D11 guard is a one-string denylist.** `LOCAL_MODEL_PROVIDERS = {'ollama'}` — any future local
provider (llamacpp, lmstudio, vllm…) walks through; `shell` (no LLM at all) is a full worker.
FIX: explicit sets — local-model providers never workers; `shell` allowed ONLY with
`MESH_ALLOW_MOCK_WORKERS=1` (chaos harness/repros set it explicitly — choreography testing remains
possible but can never silently masquerade as a real worker in production).

**#9 one non-compliant node poisons the mesh.** D11 refusal publishes `mesh.tasks.fail`, and
`handleFail` has no ownership check — any node can abort any task mesh-wide. FIX: (a) refusal
becomes DECLINE-to-participate (log + skip), never task-fail; (b) `handleFail` requires
`node_id === task.claimed_by` — unclaimed/collab tasks cannot be failed externally at all
(daemon-internal paths call `store.markFailed` directly and are unaffected).

## Verification plan

- Unit tests against REAL functions (no replicas): mesh-collab layer (membership gate,
  count-by-membership, claim-once) + daemon `__test` surface extended with the evaluators
  (cooperative skip-dead rotation, collaborative vote gate + merger-absent abort) using injected
  MockKV stores — the daemon-recruit-dispatch pattern.
- Existing suites (cooperative/collaborative/dispatch/recruit) stay green.
- Live repro where the bus makes it real: a cooperative run where the next integrator is killed
  (skip-dead observed), and a round-timeout drill (agents killed mid-round → sweep drives terminal,
  never hangs). Chaos harness gains `MESH_ALLOW_MOCK_WORKERS=1`.

---

# AUDIT_POST (appended) — 2026-07-17T04:40Z

## All 7 findings fixed, tested against REAL functions, live-verified

| # | fix | proof |
|---|---|---|
| #6 reentrancy | `claimRoundEvaluation` (CAS, one winner) gates `evaluateRound` | two concurrent evaluateRound calls → ONE integration (test vs real daemon fn) |
| #7 zombies | membership gate in `submitReflection` + `isRoundComplete` requires every ACTIVE member | non-member refused; 3 stale entries with a silent member ≠ complete; all-dead ≠ complete (old vacuous-true contract flipped in collab-unit.test.js, its own comment admitted the wart) |
| #3 merge gate | votes BINDING: needs real merge artifact + approvals > rejections | 2×blocked → ABORTED + parent failed (used to complete); 2×converged → completed; 1-1 split → aborted |
| #5 dead integrator/merger | rotation skips dead (abort if none alive); missing integrator ⇒ `degraded:true` + loud audit; missing merger ⇒ abort | skip-dead lands on next alive; degraded recorded; merger-absent aborts |
| #4 round timeout | `sweepCollabRoundTimeouts` (60s cadence, `MESH_COLLAB_ROUND_TIMEOUT_MS` default 15min): non-reflected marked dead → abort below min_nodes else evaluate with quorum | stale round → aborted + task failed; fresh round untouched |
| #8 D11 guard | denylist→enumerated local providers + `shell` gated behind `MESH_ALLOW_MOCK_WORKERS=1` (chaos harness sets it explicitly) | shell refused by default, allowed with flag; llamacpp/lmstudio/vllm/mlx refused |
| #9 poison | refusal + rejected-join = DECLINE (3 agent fail-calls removed/ownered); `handleFail` requires `node_id === task.owner`, unclaimed = no external fail | LIVE: `mesh.tasks.fail` from "mallory" → `{"ok":false,"error":"Fail refused…"}` against the running daemon |

**Bonus (same class, found by the tests):** the cooperative rotation's blind `put` of a pre-audit
session snapshot was CLOBBERING audit entries (including the existing `cooperative_integration`
audit) — the review's "blind-put-after-CAS" pattern one level deeper. Rotation now writes via CAS;
audits ordered after puts.

## Evidence

- `test/collab-p1-hardening.test.js`: 17/17 — every case drives the daemon's real functions via the
  `__test` surface (extended with evaluateRound / sweepCollabRoundTimeouts / handleFail) or the real
  CollabStore. Full adjacent sweep (10 suites): **97/97**.
- LIVE (bus + restarted daemon): cooperative min=max=3 with gated mock agents → recruiting closed via
  join path, `integrator_order ["bravo","alpha","charlie"]`, R1 by bravo → R2 by alpha (rotation),
  completed with real artifacts (repro-live-out.txt). Poison attempt refused live (above).
- Chaos harness updated (`MESH_ALLOW_MOCK_WORKERS=1`) so choreography testing still works — but a
  mock can never silently masquerade as a worker in production again.

## Not covered here (honest)
- Live round-timeout drill at production cadence (15min wait) — sweep logic proven against real
  functions with a stale-round fixture; a live drill belongs in the 3.5 chaos matrix (C-cells).
- The parse-retry×3 being circling-only (review P2) and per-node stall detection beyond round
  granularity — queued, not P1.
