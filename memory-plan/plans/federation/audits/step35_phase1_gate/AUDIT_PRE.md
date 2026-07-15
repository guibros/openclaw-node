# AUDIT_PRE — Step 3.5 · Phase-1 operational gate (IN-FLIGHT [A])

## Status: NOT closeable autonomously

3.5 is the Phase-1 exit gate, not a feature. Full close requires (a) a ≥12h unattended soak,
(b) the 6.3/6.4 ops prerequisites (fed.* probes + grappe notification source; CI federation
census), and (c) the operator's T7 sign-off after watching a live session. None are autonomously
completable. This session delivered the RUNNABLE core — the chaos harness + the cells that run on
the current single-node bus with mock agents — as real evidence, and pins the remaining checklist.

## T3 live-local matrix (L1–L6) — mostly already proven by prior closed steps

| Cell | Scenario | Evidence |
|---|---|---|
| L1 | adversarial 3 SRs → converged | 2.4 runs 7/8 (AUDIT step24): full circling lifecycle, artifacts per SR |
| L2 | adversarial converge in SR1 | 2.2 adaptive convergence (AUDIT step22): runtime early finalization |
| L3 | adversarial blocked vote → tier gate | daemon handleCirclingGateApprove/Reject present; run 8 showed blocked-vote escalation. **Live gate-approve resume: to observe under T7.** |
| L4 | cooperative 3 rounds, rotating integrator | 3.2 mock run (AUDIT step32): charlie→alpha→bravo, all 3 integrations in KV |
| L5 | collaborative 3 subtasks | 3.3 mock run (AUDIT step33): 3 subtasks 0.2s concurrent span, merge + 2 review votes |
| L6 | mode field each of 3 values | 3.4 runtime (AUDIT step34): adversarial/cooperative/collaborative each landed; unknown rejected |

## T5 chaos matrix — RUNNABLE cells executed this session (bin/fed-chaos.mjs)

| Cell | Injection | Observed | Result |
|---|---|---|---|
| **C1** | kill a member mid step-1 barrier | circling step timeout (set 1m for the run) fired, node marked dead, session ABORTED — never hung | **PASS** |
| **C5** | duplicate reflection / barrier | completed session round-1 reflections=3 == unique nodes=3 (barrier counts once) | **PASS** |
| **C7** | daemon restart mid-session | pre=recruiting → daemon reloaded → session present post-restart (rehydrated from KV) → final=completed | **PASS** |
| C2 | kill NATS follower | needs R=3 cluster (step 1.5 not cut over) — REMAINING |
| C3 | kill NATS meta-leader | needs R=3 cluster — REMAINING |
| C4 | LLM stall > step timeout | mock-sleep injection + zombie-timer check after restart — REMAINING (harness stub) |
| C6 | forged join / forged envelope | node-identity verify path exists; live forged-envelope reject + block-ledger — REMAINING |
| C8 | KV blob approaching 1MB | oversized-artifact 800KB warning (paper §5) — REMAINING |

The harness (`bin/fed-chaos.mjs c1|c5|c7|all`) sets a short circling step budget, spins 3 mock
(shell) agents, injects, and asserts terminal state from KV — near-zero Claude spend. Daemon step
budget restored to 30m after the run.

## Remaining to CLOSE the gate (the honest checklist)
1. C2/C3 — after the 1.5 R=3 cutover (operator-gated).
2. C4/C6/C8 — extend the chaos harness (stall/forgery/oversized injections).
3. 6.3 — node-watch fed.* probes (fed.cluster.quorum, fed.grappe.<id>.members, fed.session.liveness)
   + `grappe` notification source.
4. 6.4 — CI federation census (nats-binary-gated, visible skips) green.
5. T6 soak — ≥12h cron feeder cycling the 3 modes; 0 hung / 0 crash-loop / flat memory; ledger +
   node-watch snapshots as witnesses.
6. T7 — operator watches one live session end-to-end (MC/kanban) and signs the checklist here.

Premise gate (D3) is satisfied — 2.6 PASSED, so the plan does not BLOCK before 3.5.
