# AUDIT_PRE — Step 2.7 · Pipeline mode implemented (the D16 fixed-pass protocol)

## §0 Micro Re-Orient

- **Where:** Block 2, reopened. 2.6 closed PREMISE NOT EVIDENCED (D15) on reliability; D16 ruled
  consensus gating dead; D18 specified pipeline mode. 2.7 implements it; 2.8 benchmarks it.
- **Last step changed:** the design batch (46b037a) — `PIPELINE_MODE_SPEC.md`, step-28 RUN_RULES
  (DRAFT), rows 2.7/2.8, the ROADMAP Block-2 exit criterion.
- **This step contributes:** a fourth `architecture` whose session can never hang on a
  participant — the direct replacement for the three hang paths D18 named.
- **North-star line served:** ROADMAP Block 2 exit criterion (current): pipeline mode implemented
  and benchmarked against the unchanged D3 bar.
- **Still the right next step?** Yes — BLOCKED.md names implementing pipeline mode + the new
  benchmark as the plan's only forward path, starting on operator go (given 2026-09-21).

## §1 Intent

Make `mode: 'pipeline'` a live protocol in the session engine, daemon, agent and collector, such
that the load-bearing invariant of SPEC §1 holds mechanically:

> No participant's output is a precondition for the session reaching a terminal state.

Three counted terminators (passes exhausted · per-pass deadline · cost ceiling), a `degraded`
ledger, and — structurally — no path from a pipeline session into `checkConvergence`,
`advanceCirclingStep`, or a `needsGate`.

## §2 Pre-screen (every Need of the §11 contract)

| Need | Present? | Evidence |
|---|---|---|
| `PIPELINE_MODE_SPEC.md` + D18 | yes | committed 46b037a (PR #24) |
| D16 | yes | DECISIONS.md D16 |
| `lib/mesh-collab.js` engine + `startRecruitedSession` single dispatch seam (3.1 correction) | yes | read in full this session; seam at `bin/mesh-task-daemon.js:1985` |
| grappe substrate 1.3/1.4 | code yes; live runtime **not probed from this container** | COMPONENT_REGISTRY 2026-08-02 records the runtime registry EMPTY; the in-container verify runs on a scratch bus and does not depend on the live grappe |
| `bin/fed-benchmark.mjs` collector | yes | read in full; `grappeFinalArtifact` at line 129 |

No missing Need → proceed.

## §3 Design (decisions pre-made here, not during Phase 4)

- **D-a `convergence: null` for pipeline sessions** (SPEC §5). The only runtime reader outside the
  engine is MC `session-card.tsx:194` via `session.convergence?.type` — null-safe. MC's
  `hooks.ts:527` types it required; that is compile-time only and is carried forward (D-i).
- **D-b SPEC "Terminal FAILED" ≙ `COLLAB_STATUS.ABORTED` + `pipeline.outcome = 'failed'`.** No new
  status: every consumer (agent heartbeat, bridge, collector, driver) already treats `aborted` as
  terminal failure; adding `failed` would touch all of them for no behavioural gain.
- **D-c Parse failures keep circling's bounded 3-attempt retry**, inside the pass budget, with a
  pipeline-local counter (`pipeline.artifact_failures[nodeId_passN]`). The third failure counts as
  that node's submission and records a `parse_failure` degradation. Bounded and deterministic;
  it is a reliability aid, not a gate.
- **D-d Pipeline passes reuse `rounds[]` / `submitReflection`** (dup guard, membership gate,
  audit trail) via `startRound(sessionId, { prune: false })`. Pipeline never prunes dead members
  and never aborts on member count after recruiting — liveness is the pass deadline, nothing else.
  Default `prune: true` keeps every other mode byte-identical in behaviour.
- **D-e The reflect wire field for typed artifacts stays `circling_artifacts`.** Renaming would
  touch store, agent and daemon for no behavioural gain; the pipeline branch reads it as "typed
  artifacts". Recorded so the name does not read as a leftover.
- **D-f A pass's `.round` message goes ONLY to that pass's expected submitters** — worker in
  passes 1 and 3, both reviewers in pass 2. Idle members receive nothing and learn of completion
  through the agent's existing 10 s status heartbeat.
- **D-g No `markConverged` for pipeline.** Terminal is `completed` directly; D16 has no
  "converged". The collector already accepts `completed`.
- **D-h `evaluateRound` gets an explicit pipeline early-return** — the structural D16 seam, the
  same shape cooperative/collaborative use. The leave and stall paths check the mode before their
  `isRoundComplete → evaluateRound` re-check.
- **D-i Mission Control untouched.** A pipeline session renders with the zinc fallback badge and
  no expanded pipeline panel. Carry-forward: `pipeline?:` block in `hooks.ts`, badge colour,
  expanded state in `session-card.tsx`.
- **D-j `bin/fed-run-driver.mjs` untouched.** For a pipeline session `s.circling?.phase` is
  undefined, so the clause-2 gate tripwire is inert by construction and terminal detection works
  through `status`. Carry-forward to 2.8 lock time: the per-poll log line should print pipeline
  pass/outcome instead of `undefined`.
- **D-k `docs/circling-strategy-implementationV3.md` untouched** — history per D16 consequence 1.
- **D-l `pass_budget_ms` defaults to 10 min** (= the circling step timeout) and is a session
  field, so RUN_RULES can fix it per run without a daemon env knob.
- **D-m Artifact typing per pass is positional, not trusted from the model:** pass 1 → `workArtifact`,
  pass 2 → `reviewArtifact` (per reviewer), pass 3 → `finalArtifact`. If the model mislabels the
  `type:` line, the first non-empty artifact is taken and the mislabel is audited — a label
  mistake must not cost a delivery. The ≥400-char floor applies to work/final artifacts only; a
  short review is still a review.

## §4 Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | `startRound` prune option alters circling/cooperative behaviour | option defaults to the current behaviour; only pipeline passes `prune: false`; existing suites guard |
| R2 | Reflect-handler branch order routes pipeline reflections into the generic `isRoundComplete → evaluateRound` fallthrough | pipeline branch precedes it; D-h early-return in `evaluateRound`; spy test asserts zero calls to `checkConvergence` / `advanceCirclingStep` / `isCirclingStepComplete` across every pipeline scenario |
| R3 | Real `setTimeout` pass timers keep `node:test` alive | `__test.clearPipelineTimers()`; runtime test uses small budgets |
| R4 | KV blob size (draft + 2 reviews + final in one value) | same 950 KB guard as `storeArtifact`; circling stored far more per session |
| R5 | Agent degenerate-output guards too strict/loose for reviews | floor on work/final only (D-m) |
| R6 | The in-container bus is not the deployed fleet | VERSION stops at `v2.7-mid`; Phase 9 is the operator's (MASTER_PLAN §5 items 2–3); stated in SCOPE and here, never claimed otherwise |

## §5 Verify contract (INVENTORY 2.7, executed exactly as written)

- `runtime:` a live pipeline session with **one reviewer deliberately silenced** (never submits,
  never marked dead) reaches `status: completed` with a collectable artifact inside the pass
  budget, and its `degraded` ledger names that reviewer. Executed by
  `test/pipeline-runtime.test.mjs` against a real `nats-server` 2.12.6 (the CI pin,
  sha-verified) with `bin/mesh-task-daemon.js` spawned as a real process over real JetStream KV,
  three simulated members on the bus. Command: `PATH=<scratch>/bin:$PATH node --test
  test/pipeline-runtime.test.mjs`.
- `code:` `test/daemon-pipeline-handlers.test.js` proves `checkConvergence`, reflection `vote`,
  `current_subround` and `needsGate` are unreachable from the pipeline path (spies + no
  `circling_gate`/`converged` event), and covers the three T2 absence behaviours (draft absent ⇒
  ABORTED/`failed`; reviews absent ⇒ advance; revision absent ⇒ ship the draft flagged degraded)
  plus T3 (cost ceiling). Baseline: `npm test` green before and after.

## §6 File-delta outline (BINDING — Phase 4 implements exactly this)

1. `lib/mesh-collab.js` — `COLLAB_MODE.PIPELINE`; in `IMPLEMENTED_MODES`;
   `PREFERRED_MODE_MAP.pipeline`; `min_nodes` default 3 for pipeline; conditional `pipeline`
   block; `convergence: null` for pipeline (D-a); `startRound(id, { prune })` (D-d); new
   methods `advancePipelinePass`, `storePipelineArtifact`, `recordPipelineDegradation`,
   `recordPipelineArtifactFailure`, `addPipelineUsage`; pure helpers `pipelineExpectedSubmitters`,
   `isPipelinePassComplete`, `compilePipelineInput`, `pipelineTerminalArtifact`,
   `assignPipelineRoles`; tracer list extended; exports.
2. `bin/mesh-task-daemon.js` — `pipelinePassTimers`; dispatch branch in `startRecruitedSession`;
   `startPipelinePass`, `handlePipelinePassTimeout`, `advanceOrCompletePipeline`,
   `completePipelineSession`, `failPipelineSession`, `clearPipelinePassTimer`,
   `sweepPipelinePassTimeouts`; pipeline branch in `handleCollabReflect` (usage → ceiling → retry
   → store → completeness); D-h guards in `evaluateRound`, `handleCollabLeave`, `detectStalls`;
   `main()` sweep timer + shutdown; tracer wraps; `__test` additions (`reflect`, `leave`,
   `startPipelinePass`, `handlePipelinePassTimeout`, `sweepPipelinePassTimeouts`,
   `clearPipelineTimers`, `spy` hooks via the injected `collabStore`).
3. `bin/mesh-agent.js` — `buildPipelinePrompt` (no `vote:` line); round-loop branch (parser reuse,
   floor guard per D-m, `pipeline_pass` on the reflect payload, log label).
4. `bin/mesh-bridge.js` — `case 'collab.pipeline_pass_started'` (auto-track + `next_action`).
5. `bin/fed-benchmark.mjs` — grappe arm submits pipeline by default (`FED_GRAPPE_MODE=
   circling_strategy` reproduces D14); `grappeFinalArtifact` mode-aware + exported;
   `status`/`collect` mode-aware (`degraded` ledger and `usage_total` into the sealed meta);
   header doc.
6. `docs/FEDERATION_SPEC.md` — §3 intro, §3.4 row, §5.1 enum, §8 L1 contract.
7. Tests — `test/collab-pipeline.test.js`, `test/daemon-pipeline-handlers.test.js`,
   `test/pipeline-runtime.test.mjs` (canonical nats skip marker), `test/fed-benchmark-pipeline.test.mjs`.
8. Ledger — INVENTORY 2.7 `[ ]→[A]`, VERSION `v2.7-pre` → `v2.7-mid`; COMPONENT_REGISTRY row only
   if a probed fact changes (none expected from a container); DECISIONS only on a Phase-8
   architectural surprise.

Nothing else. Surprises go to §7 below and/or `OUT_OF_SCOPE.md`.

## §7 Mid-Implementation Findings

1. **`CollabStore.markCompleted` silently dropped every result field but four.** It rebuilt
   `session.result` from `artifacts / summary / rounds_taken / node_contributions` only, so
   `pipeline_final_artifact` never reached the parent task — the real-bus runtime test caught it
   (`result.pipeline_final_type` undefined). Latent for circling too: `circling_final_artifact` /
   `circling_completion_diff` were passed by `completeCirclingSession` and discarded; nothing read
   them (the collector reads `circling.artifacts` from KV), which is why it never surfaced. Fixed
   generically (`...result` then the four canonical fields normalised). Consumers of `result`
   (MC `Record<string, unknown>`, bridge `rounds_taken`) are unaffected; circling sessions now
   carry the two fields they always meant to.
2. **`passes: 0` was coerced to the default 3** by `parseInt(x) || 3`; the store-level schema test
   caught it. Now `null/undefined → 3`, anything else must be an odd integer ≥ 1 (`Number.isInteger`
   guards `NaN` too).
3. **T3 interpretation sharpened, not changed:** SPEC §3 read "closes the current pass and takes
   the T2 path for that pass"; the implementation closes the pass **and completes the session**
   (no further pass opens). A ceiling that let the next pass spend would not be a ceiling; this
   is the `NoMoneyException` shape §8 already cites. SPEC §3 amended with a dated note.
4. **`handlePipelinePassTimeout` deleted its map entry without clearing the timer** — correct
   when the timer is the caller, an orphan when the sweep or a test calls it directly. The
   orphaned 10-minute timer is what kept the daemon test's child process alive after all 18
   tests had passed (0 % CPU, idle). Production never reached it (the sweep only fires when no
   in-memory timer exists); now it clears (idempotent) instead of deleting. The sibling
   `handleCirclingStepTimeout` has the same shape and is not this step's to touch — noted for
   `OUT_OF_SCOPE.md`.
5. **`passes` must be odd.** SPEC §9 item 3 calls a 5-pass variant legal; an even count would end
   on a review with nothing to ship, so `createSession` rejects it. Consistent with the spec,
   made explicit.
6. **`max_nodes` defaults to 3 for pipeline** (SPEC §5 fixes the topology at 1 worker + 2
   reviewers; an unbounded roster would let a fourth joiner reflect with no role). Recorded
   because §6 item 1 did not list it.

7. **§6 missed the test that pins the mode table.** `test/collab-mode-selection.test.mjs` (step
   3.4) asserts `PREFERRED_MODE_MAP` has exactly the three §3.4 rows; the approved fourth row
   fails it by construction (full suite: 2171 / 1 fail, that test). Added to the SCOPE files
   block (same operator mandate — a pipeline mode that the mode-table test forbids is not
   implemented) and updated to the four-row table, with a pipeline `createSession` case. Not a
   product change; the pin now pins the amended spec.
8. **Environment artifact, not a delta:** `npm ci` flipped `lib/mcp-knowledge/server.mjs` to
   mode 755 (it is an npm `bin` target). Caught by the gate ③ enumeration as a file no scope
   covers; restored with `git checkout --`, captured in the protocol plan's `OUT_OF_SCOPE.md`
   because it trips the tick chain's clean-tree guard on every fresh install.

None of these is a sprawl into a second step (PROTOCOL §5.3): each is a correction inside a §6
delta, found by the step's own tests or its gate.
