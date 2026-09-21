# AUDIT_POST — Step 2.7 · Pipeline mode implemented — IN FLIGHT at `v2.7-mid`

**Where this stops, and why.** Phases 1, 4, 5, 7 and 8 were run in a remote Linux container on
2026-09-21. Phase 5's `runtime:` leg was executed on a real `nats-server` 2.12.6 with the real
`bin/mesh-task-daemon.js` process — the same class of mechanism evidence steps 2.1–2.3 closed
on — but **not on the deployed fleet.** MASTER_PLAN §5 items 2–3 (code in
`~/.openclaw/workspace/`, service restarted) cannot be met from here, so VERSION stops at
`v2.7-mid` and **Phase 9 is the operator's**: deploy, `launchctl kickstart -k`, one fleet log
line (`PIPELINE … pass 1/3 (draft) START`), `[A]`→`[x]`, clean `v2.7`, `Runtime-Evidence:`
trailer. `BLOCKED.md` is untouched — it comes down only on step 2.8.

## §1 Promised vs landed (AUDIT_PRE §6, every row)

| # | Delta | Landed | Where |
|---|---|---|---|
| 1 | engine: `COLLAB_MODE.PIPELINE`, implemented, preferred-mode row, topology 3/3, `pipeline` block, `convergence: null`, `startRound({prune})`, pass/artifact/ledger/usage/outcome methods, module-level `pipelineTerminalArtifact`, tracer list, exports | **yes** | `lib/mesh-collab.js:41,155,219,254,479,1079,1256` |
| 2 | daemon: dispatch branch, `startPipelinePass`, deadline handler + sweep, reflect branch (usage → ceiling → bounded retry → positional store → early-exit), `completePipelineSession` ships unconditionally, `failPipelineSession`, D-h seams in `evaluateRound` / leave / stalls, main() timer + shutdown, tracer wraps, `__test` surface | **yes** | `bin/mesh-task-daemon.js:792,989,1625,2249,2288,2425,2487,3129` |
| 3 | agent: `buildPipelinePrompt` (no `vote:` line), round-loop branch reusing `lib/circling-parser.js` unchanged, D-m floor on work/final only, `pipeline_pass` on the reflect payload | **yes** | `bin/mesh-agent.js:1281,1358,1565` |
| 4 | bridge: `collab.pipeline_pass_started` kanban materialisation + CLI auto-track | **yes** | `bin/mesh-bridge.js:356` |
| 5 | collector: grappe arm = pipeline by default (`FED_GRAPPE_MODE=circling_strategy` reproduces D14), mode-aware `grappeFinalArtifact` (exported), `status`/`collect` mode-aware, ledger + `usage_total` into the sealed meta | **yes** | `bin/fed-benchmark.mjs:78,149` |
| 6 | spec: §3 four modes, §3.4 row, §5.1 enum, §8 L1 contract | **yes** | `docs/FEDERATION_SPEC.md:127,512` |
| 7 | tests: `collab-pipeline` (store), `daemon-pipeline-handlers` (real handlers, spies), `pipeline-runtime` (real bus, canonical nats skip marker), `fed-benchmark-pipeline` (collector); plus the 3.4 mode-table pin amended to four rows (AUDIT_PRE §7.7) | **yes** | 4 new files + `test/collab-mode-selection.test.mjs` |
| 8 | ledger: INVENTORY `[A]`, VERSION `v2.7-pre`→`v2.7-mid`, COMPONENT_REGISTRY row (probed fact: implemented / proven on a scratch bus / NOT deployed), DECISIONS untouched (no architectural surprise beyond D18; the T3 sharpening is a dated SPEC note + AUDIT_PRE §7.3) | **yes** | this dir · `VERSION` · `COMPONENT_REGISTRY.md` |

Nothing outside §6 changed, except two always-writeable captures (`federation/OUT_OF_SCOPE.md`,
`protocol/OUT_OF_SCOPE.md`) and the mode-table test added to the SCOPE block under the same
mandate (§7.7). `lib/mcp-knowledge/server.mjs` showed as modified (an `npm ci` mode flip, not a
delta) and was restored (§7.8).

## §2 Greppable deltas (command → first hit, 2026-09-21)

```
grep -n "PIPELINE: 'pipeline'" lib/mesh-collab.js                              → 41
grep -n "convergence: resolvedMode === COLLAB_MODE.PIPELINE ? null" lib/mesh-collab.js → 155
grep -n "pipeline: resolvedMode === COLLAB_MODE.PIPELINE ? {" lib/mesh-collab.js → 219
grep -n "^function pipelineTerminalArtifact" lib/mesh-collab.js                → 254
grep -n "async startRound(sessionId, { prune = true }" lib/mesh-collab.js       → 479
grep -n "isPipelinePassComplete(session, { ignore" lib/mesh-collab.js           → 1079
grep -n "\.\.\.result," lib/mesh-collab.js                                     → 1256  (§7.1 fix)
grep -n "session.mode === COLLAB_MODE.PIPELINE && session.pipeline) {$" bin/mesh-task-daemon.js → 792 (stall guard; dispatch/leave/reflect follow)
grep -n "evaluateRound reached for" bin/mesh-task-daemon.js                    → 1625  (D-h seam)
grep -n "^async function startPipelinePass" bin/mesh-task-daemon.js             → 2249
grep -n "^async function completePipelineSession" bin/mesh-task-daemon.js       → 2425
grep -n "^async function sweepPipelinePassTimeouts" bin/mesh-task-daemon.js     → 2487
grep -n "pipelinePassSweepTimer = setInterval" bin/mesh-task-daemon.js          → 3129
grep -n "^function buildPipelinePrompt" bin/mesh-agent.js                       → 1281
grep -n "There is NO vote line" bin/mesh-agent.js                               → 1358
grep -n "} else if (isPipeline) {" bin/mesh-agent.js                            → 1565
grep -n "case 'collab.pipeline_pass_started'" bin/mesh-bridge.js                → 356
grep -n "^export function grappeCollabSpec" bin/fed-benchmark.mjs               → 78
grep -n "^function pipelineFinalArtifact" bin/fed-benchmark.mjs                 → 149
grep -n "four modes" docs/FEDERATION_SPEC.md                                    → 127
grep -n "by counted termination only" docs/FEDERATION_SPEC.md                   → 512
```

## §3 Cross-references still valid

- SPEC §2's three hang paths (`isCirclingStepComplete`, `checkConvergence` + `UNANIMOUS`,
  `advanceCirclingStep`'s `needsGate`) are untouched and still where D18 said — history, per D16.
- D18 consequences: (1) rows 2.7/2.8 exist, 2.7 now `[A]`; (2) step-28 RUN_RULES is a DRAFT
  awaiting the operator's §0 lock; (3) the D3 bar is untouched; (4) `BLOCKED.md` stands;
  (5) Block 4's quorum rows are flagged in ROADMAP, not built.
- RUN_RULES §2 "contract-compliant terminal artifact — grappe: `status: completed` AND the
  collector accepts it per SPEC §6" ↔ `pipelineFinalArtifact` (final, or degraded draft, ≥400
  chars; no artifact ⇒ throws). Clause 7 (degradation is a delivery) ↔ `grappeDegraded` +
  `grappeDegradedLedger` in the sealed meta.
- FEDERATION_SPEC §9 (file:line index) was not extended with pipeline anchors — carry-forward 4.

## §4 Findings

- **[POSITIVE] The contract's regression holds on a real bus.** Reviewer B silent throughout:
  pass 3 opened by the deadline (≥ `PASS_BUDGET_MS` after pass 2, not early), the reviser's input
  read `[REVIEW UNAVAILABLE — timeout]` beside review A, the session ended
  `completed` / `completed_degraded`, ledger exactly `[[2, rt-rb, timeout]]`, B still `active`
  (never marked dead), final ≥ 400 chars, parent task `completed` with the same result, the
  collector accepted it as a degraded delivery, and neither `converged` nor `circling_gate` was
  published; the daemon log carries `PIPELINE PASS 2 CLOSED WITHOUT rt-rb (timeout)`.
- **[POSITIVE] No vote machinery is reachable.** Across 18 daemon scenarios (happy path,
  silenced reviewer, draft absent, revision absent, cost ceiling, reviewer leaves, worker
  leaves, dead member, 3× parse retry, mislabelled type, empty submission, direct
  `evaluateRound`, sweep rehydration, stale snapshot, five passes, under-topology recruit)
  the spies on `checkConvergence` / `advanceCirclingStep` / `isCirclingStepComplete` /
  `markConverged` read 0 and no gate/converged event was published.
- **[POSITIVE] Nothing else moved.** Collab/circling suites 84/84 before the full run; full
  suite 2172 / 2166 pass / 0 fail / 6 skipped against a 2112 / 2106 / 0 / 6 baseline — the
  delta is exactly the new tests; the six skips are the embedding-model census (no cached model
  in this container).
- **[NEGATIVE → fixed] `markCompleted` dropped every result field but four** (AUDIT_PRE §7.1) —
  caught by the runtime test, latent for circling since step 2.x.
- **[NEGATIVE → fixed] `passes: 0` coerced to the default** (§7.2); **direct-call timer orphan**
  (§7.4, twin captured to `OUT_OF_SCOPE.md`); **§6 missed the mode-table pin** (§7.7).
- **[NEGATIVE, by design] This is not D3 evidence.** Reliability was the hypothesis under test
  here and the mechanism now demonstrably cannot hang on a participant; whether the artifact
  quality that won 21-18 and 20-15 survives the removal of the gate is step 2.8's question, on
  a preregistered slate, against the unchanged bar.
- **[NEUTRAL] Container facts:** `nats-server` 2.12.6 fetched with the CI pin's SHA verified;
  `npm ci` flips a `bin` file's mode (§7.8, protocol `OUT_OF_SCOPE.md`).

## §5 Phase-8 patches

None. Every correction (§7.1–§7.8) was made inside Phase 4, is covered by a test, and is
recorded in AUDIT_PRE §7.

## §6 Carry-forwards

1. **Phase 9 (operator):** deploy to `~/.openclaw/workspace/`, restart the mesh daemons, observe
   one `PIPELINE … START` line on the fleet, flip `[A]`→`[x]`, VERSION `v2.7`, close commit with
   the `Runtime-Evidence:` trailer, SCOPE Status → done.
2. **Step 2.8 lock time:** fill RUN_RULES §0 (slate · cost bar · frozen SHA); `bin/fed-run-driver.mjs`'s
   per-poll log should print `s.pipeline?.current_pass` / `outcome` (it prints
   `s.circling?.phase`, undefined for pipeline — terminal detection via `status` already works
   and the gate tripwire is inert by construction, so this is legibility, not correctness).
3. **Mission Control:** `pipeline?:` block in `hooks.ts`, a badge colour, and an expanded
   pipeline panel in `session-card.tsx` (renders on the zinc fallback today).
4. **FEDERATION_SPEC §9** index rows for the pipeline anchors above.
5. **`handleCirclingStepTimeout`** delete→clear (federation `OUT_OF_SCOPE.md`, 2026-09-21).
6. **SCOPE `Expires: 2026-09-28`:** refresh or close at Phase 9 — a stale-`active` header blocks
   every write (the failure mode this plan has now hit twice).
7. **Cosmetic:** the daemon's `COLLAB REFLECT … (vote: undefined …)` line for pipeline
   reflections — agents in this mode send no vote; the store defaults it to `continue`.
