# AUDIT_POST — Step 2.1 · Live end-to-end circling session on the grappe with a mock LLM

**Closed:** 2026-07-11T05:19Z (session complete) / committed this tick

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| audits/step21_circling-session-live/AUDIT_PRE.md | **yes** | prior phase |
| audits/step21_circling-session-live/AUDIT_POST.md | **yes** | this file |
| VERSION: v2.1-pre → v2.1-mid → v2.1 | **yes** | each phase |
| INVENTORY.md: flip 2.1 `[ ]` → `[A]` → `[x]` | **yes** | prior phase / phase 9 |
| COMPONENT_REGISTRY.md: Family 2 circling → LIVE | **yes** | phase 9 |
| "No production code changes expected" | **delta** — one defensive patch landed (see §4) |

## §2 Greppable deltas

**Code patch (bin/mesh-task-daemon.js, 9 lines added):**
- `grep "auto-assigned roles" bin/mesh-task-daemon.js` → line 1543: `log('CIRCLING: auto-assigned roles (1 worker + 2 reviewers)')`
- Patch location: `checkRecruitingDeadlines()`, inside `if (session.mode === 'circling_strategy')` block
- Trigger: `session.nodes.every(n => n.role === 'worker') && session.nodes.length >= 3`
- Effect: updates node.role in the nodes array when recruiting window expires with all-worker join (belt-and-suspenders; the immediate join path via `handleCollabJoin` already assigns roles in the circling object)

**lib/logger.js (new file, 80 lines):**
- Required by bin/mesh-task-daemon.js and bin/mesh-agent.js via `require('../lib/logger')`
- Shared structured logger factory — unifies per-daemon `function log(msg)` patterns
- Untracked before this step; added to staging for commit

**Runtime evidence (observed 2026-07-11T05:19:19Z):**
```
Session: collab-step21-mock-002-1783747159329
Task:     step21-mock-002

Circling object:
  worker_node_id:   charlie
  reviewerA_node_id: bravo
  reviewerB_node_id: alpha
  max_subrounds:    1
  current_subround: 1
  automation_tier:  1
  phase:            complete

Rounds executed:
  Round 1 (init/step0):         charlie:converged bravo:converged alpha:converged  [3/3 ✓]
  Round 2 (circling/step1):     charlie:converged bravo:converged alpha:converged  [3/3 ✓]
  Round 3 (circling/step2):     charlie:converged bravo:converged alpha:converged  [3/3 ✓]
  Round 4 (finalization/step0): charlie:converged bravo:converged alpha:converged  [3/3 ✓]

MESH_COLLAB KV: status=completed ✓
MESH_TASKS KV:  status=completed, completed_at=2026-07-11T05:19:19.519Z ✓
result.summary: "Circling Strategy completed: 1 sub-rounds, 3 nodes."
node_contributions: {bravo: "mock circling work output", alpha: "...", charlie: "..."}
```

**Test baseline:**
```
npm test → 1718 pass / 2 fail (observer.test.mjs, embed-benchmark.test.mjs) / 1 skipped
```
Same 2 pre-existing failures — unchanged from 2026-07-10 baseline.

## §3 Cross-refs still valid

- INVENTORY 2.1 Needs "Block 1 substrate" — NATS :4222 live (in_msgs 8585, 5 connections, :8222/varz) ✓
- INVENTORY 2.1 Needs "lib/mesh-collab.js" — 34920 bytes, confirmed ✓
- INVENTORY 2.1 Needs "bin/mesh-task-daemon.js" — 95350→+9 lines ✓
- INVENTORY 2.1 Needs "mock-LLM mode" — shell provider at mesh-agent.js:1125 triggered; vote=converged on exit 0 ✓
- INVENTORY 2.1 Verify "3 roles assigned" — circling.worker_node_id=charlie, reviewerA=bravo, reviewerB=alpha ✓
- INVENTORY 2.1 Verify "≥1 full sub-round, both barriers 3/3" — rounds 2+3 (step1+step2), 3/3 each ✓
- INVENTORY 2.1 Verify "finalization votes recorded" — round 4, 3/3 converged ✓
- INVENTORY 2.1 Verify "MESH_COLLAB KV shows status=completed" — confirmed ✓
- INVENTORY 2.1 Feeds "2.2-2.4 build on a proven baseline" — baseline established ✓

## §4 Findings

- **[POSITIVE]** Full circling lifecycle observed: 4 rounds (init → step1 → step2 → finalization), all 4 barriers 3/3, session COMPLETE in KV. Verify contract satisfied.
- **[POSITIVE]** Daemon role-assignment in `handleCollabJoin` works correctly: all 3 nodes joined as 'worker', circling object got proper worker/reviewerA/reviewerB assignment on recruiting-done trigger.
- **[DELTA vs AUDIT_PRE]** One code patch landed that was not anticipated: `checkRecruitingDeadlines` auto-role-assign (9 lines). This defends against the recruiting-window-timeout path where all nodes join as 'worker' and the immediate-join path is NOT triggered. Does not affect the closing evidence (session ran via the immediate-join path). Defensive; not a functional regression.
- **[NOTE]** lib/logger.js was untracked — included in this commit as it is a required dependency already imported by mesh-task-daemon.js and mesh-agent.js.
- **[NOTE]** wg-alpha was dissolved and re-formed with 3 members (alpha/bravo/charlie) per 1.4 carry-forward. The grappe registry shows the clean 3-member formation (formed_at: 2026-07-11T05:11:09.113Z).

## §5 Phase-8 patches

None. The auto-assign code was part of Phase 4 implementation, not a post-verify correction.

## §6 Carry-forwards to the next step

- **To 2.2 (adaptive convergence):** Baseline established: `advanceCirclingStep` in lib/mesh-collab.js handles the SR→finalization transition at line 750-767. The `max_subrounds=1` path works (SR1 → finalization directly). Step 2.2 adds early-out for unanimous converge before max_subrounds is reached.
- **To 2.2:** Shell provider mock confirmed as the correct mechanism for scripted tests. Use `MESH_LLM_PROVIDER=shell` + task description as a shell command that exits 0 → vote=converged.
- **To 2.3:** The auto-assign patch in `checkRecruitingDeadlines` (9 lines) is in place for robustness; 2.3's retry logic is in the daemon reflect handler (separate path).
- **To all Block 2:** The daemon correctly handles the circling lifecycle end-to-end via NATS. No architectural surprises.
