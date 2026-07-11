# AUDIT_PRE — Step 2.1 · Live end-to-end circling session on the grappe with a mock LLM

## §0 Micro Re-Orient (≤6 lines)

Block 2 / step 2.1 — opening Block 2. Step 1.4 landed grappe membership signing; Block 1 substrate is solid.
This step: prove the paper's full session lifecycle actually runs — the 93 unit tests never executed a live session.
Serves the Block 2 exit criterion: one observed adversarial session, artifacts in KV, barriers 3/3, finalization.
Still the right next step: yes — NATS live on :4222, logical nodes heartbeating, grappe registry operational.

## §1 Intent

Run one complete circling session via `mesh.collab.create` using 3 logical nodes (alpha/bravo/charlie) as worker
+ 2 reviewers, with `MESH_LLM_PROVIDER=shell` (the mock-LLM mode already built into mesh-agent.js line 1125).
Observe every state transition in the KV: roles assigned → SR1 step1 barriers 3/3 → SR1 step2 barriers 3/3 →
finalization votes → COMPLETE. Capture KV read, log evidence, kanban trail.

## §2 Design (consuming carry-forwards from step 1.4 AUDIT_POST §6)

**Carry-forward:** "Dissolve and re-form wg-alpha with 3 members before Block 2 starts (currently 4 members from
the 1.4 verify test)." → will dissolve wg-alpha and re-form with alpha/bravo/charlie (3 nodes) before the session.

**Session parameters:**
- `mode: 'circling_strategy'`
- `automation_tier: 1` — no tier gates; session runs autonomously end-to-end
- `max_subrounds: 1` — single sub-round for the mock run (fastest path to verify)
- Task description: `echo "mock circling work output"` — valid shell cmd, exits 0 → shell provider votes `converged`

**Shell provider behavior (mesh-agent.js:1125-1132):**
When `MESH_LLM_PROVIDER=shell`, agent runs `task.description` as bash, synthesizes:
`{vote: 'converged', confidence: 1.0, parse_failed: false}` on exit 0. No circling delimiters needed.

**Session flow with automation_tier=1, max_subrounds=1:**
1. Init → SR1 step1 (3 reflections, `converged`) → SR1 step2 (3 reflections, `converged`)
2. `advanceCirclingStep`: `allConverged=true`, `current_subround=1 == max_subrounds=1`, hits `else` branch,
   no gate (automation_tier=1 < 2), → finalization phase
3. Finalization step (3 reflections) → `advanceCirclingStep(finalization)` → complete
4. `completeCirclingSession`: all votes `converged` → `markCompleted`

**Service startup sequence:**
- Pre: dissolve wg-alpha, re-form with alpha/bravo/charlie, issue fresh join token
- Start mesh-task-daemon (background, OPENCLAW_NODE_ID=alpha, port 4222)
- Start mesh-bridge (background, OPENCLAW_NODE_ID=alpha)
- Start 3 mesh-agent instances: alpha/bravo/charlie (MESH_LLM_PROVIDER=shell each)
- Create collab task, then collab session, observe to COMPLETE

## §3 Risks

| Risk | Mitigation |
|---|---|
| Health-publishers PIDs from Jul 11 01:54 may no longer be running | Probe before starting services; re-launch if dead |
| mesh-task-daemon NATS auth: was `TIMEOUT` historically (D5) | NATS is live on :4222 with JetStream; single-node has no token req; verify with curl :8222/varz |
| automation_tier=2 default would pause at gate | Set `automation_tier: 1` explicitly in session creation payload |
| Finalization step: `completeCirclingSession` reads finalization round reflections | shell provider votes converged → `finalizationVotes.every(converged)` → passes |
| wg-alpha has 4 members (delta from 1.4 test) | Dissolve + re-form first |

## §4 Needs pre-screen

| Need | Check |
|---|---|
| Block 1 substrate (NATS :4222, GRAPPE_REGISTRY KV, logical nodes) | NATS live (curl :8222/varz → confirmed 2026-07-10); KV confirmed (1.4); nodes alpha/bravo/charlie heartbeating |
| lib/mesh-collab.js | present: 34920 bytes, Apr 12 |
| bin/mesh-task-daemon.js | present: 95350 bytes, Jul 11 00:57 (includes D7 Array.isArray fix) |
| bin/mesh-agent.js | present: 66423 bytes, Jul 10 |
| bin/mesh-bridge.js | present: 35289 bytes, Apr 3 |
| mock-LLM mode (shell provider) | mesh-agent.js:190 + :1125-1132 — MESH_LLM_PROVIDER=shell handled |
| bin/openclaw-grappe.mjs (dissolve/re-form) | present: confirmed 1.4 |

All Needs present. No BLOCK.

## §5 File-delta outline (§6)

| File | Change |
|---|---|
| audits/step21_circling-session-live/AUDIT_PRE.md | this file |
| memory-plan/plans/federation/VERSION | v1.4 → v2.1-pre (phase 1), → v2.1-mid (phase 4), → v2.1 (phase 9) |
| memory-plan/plans/federation/INVENTORY.md | flip 2.1 `[ ]` → `[A]` (phase 1), → `[x]` (phase 9) |
| memory-plan/plans/federation/COMPONENT_REGISTRY.md | update Family 2 circling status to LIVE (phase 9) |
| audits/step21_circling-session-live/AUDIT_POST.md | phase 7 |

No production code changes expected — the stack was prepared by prior commits (D7, ec4aad5, 74315fd).
