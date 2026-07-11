# AUDIT_PRE — Step 2.4 · First real adversarial run: qwen3:8b to a converged vote

## §0 Micro Re-Orient

- **Where:** Block 2 (adversarial circling), step 2.4 of 6 (2.1/2.2/2.3/2.4/2.5[D]/2.6). Last step (2.3) proved parse-failure retry ×3 before degradation.
- **This step contributes:** the Block 2 exit criterion — one real adversarial run using qwen3:8b, artifacts non-trivial, converged vote, wall-clock + timing recorded for D3.
- **North-star line:** "prove the paper lives in the real runtime" before Block 3 extends the machinery.
- **Still the right next step?** Yes — substrate live, qwen3:8b confirmed (curl :11434/api/tags), task locked in D8, tree clean.

## §1 Intent

Run one complete adversarial circling session using the qwen3:8b local LLM on the operator-chosen task: **harden the three FEDERATION_SPEC schema defects the 2026-07-10 parallel audit found (F1/F2/F4)**. Session runs through mesh-task-daemon + mesh-bridge + 3 mesh-agent instances. Observe COMPLETE in NATS KV. Record wall-clock + per-step timings in AUDIT_POST.

Step BLOCKS at Phase 5 for the `visual:` gate — the operator reviews the artifacts (the corrected spec text) before the step is closed. D8 records this as the intended behavior.

## §2 Design (consuming 2.3 carry-forwards)

**Carry-forwards from 2.3:**
- Retry is live (up to 3× before degradation); the session is resilient to occasional parse failures from qwen3:8b.
- Use `max_subrounds ≥ 2`; with 2.2 adaptive convergence, if qwen3:8b converges in SR1 the session skips SR2.
- Failure count is step-keyed, so a failure in SR1 doesn't penalize SR2.

**Session parameters:**
- `mode: 'circling_strategy'`
- `automation_tier: 1` — fully autonomous, no tier gates
- `max_subrounds: 2` — with adaptive early-exit if SR1 unanimous converge
- `MESH_LLM_PROVIDER: ollama`, `LLM_MODEL: qwen3:8b`

**Task:** Harden FEDERATION_SPEC envelope + session schemas (audit F1/F2/F4). Task description includes the exact defects, relevant code snippets, and acceptance criteria (see §3 below). The description is self-contained so qwen3:8b has all context without needing file access.

**Service startup sequence:**
1. Start mesh-task-daemon.js (OPENCLAW_NODE_ID=alpha, background, `nohup`)
2. Start mesh-bridge.js (OPENCLAW_NODE_ID=alpha, background)
3. Start 3 mesh-agent.js instances (OPENCLAW_NODE_ID=alpha/bravo/charlie, MESH_LLM_PROVIDER=ollama, LLM_MODEL=qwen3:8b, background)
4. Submit task via NATS `mesh.tasks.submit` (includes `collaboration` spec → daemon auto-creates session + broadcasts recruit)
5. Agents see recruit, join, and work autonomously
6. Poll MESH_COLLAB KV until `status=completed` or 60-min timeout

**Expected timing (D3 baseline):** ~35 GPU-min (18 inferences × ~120s) for max_subrounds=2 without early convergence; ~18 GPU-min if converged in SR1 (adaptive 2.2). Wall-clock recorded in AUDIT_POST.

## §3 Task description (verbatim for mesh.tasks.submit)

```
Fix three documented defects in docs/FEDERATION_SPEC.md.
Do NOT change any section not listed below. For each defect, produce the corrected
text block and a one-line rationale citing the real interface at file:line.

--- DEFECT F1 — Timestamp field mismatch + false event_id attribution ---

Current spec §5.1 (line 338), §5.2 (line 365), §5.3 (line 404):
  issued_at: "<ISO timestamp>",   ← WRONG

Real interface — lib/node-identity.mjs:419-432 (checkEventFreshness):
  if (event.timestamp === undefined || event.timestamp === null) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  const tsMs = typeof event.timestamp === 'number'
    ? event.timestamp : Date.parse(event.timestamp);
  ← freshness keys on .timestamp, not .issued_at

Current spec (§5.1 line 343, §5.2 line 369): event_id attributed to signEvent.
Real interface — lib/node-identity.mjs:374-404 (signEvent):
  return { ...rest, signature: signature.toString('base64'), signer_pubkey: publicKeyBase64 };
  ← signEvent adds only signature + signer_pubkey; event_id is caller-injected.

Fix F1:
- Change `issued_at` → `timestamp` in §5.1, §5.2, §5.3 envelope schemas.
- Correct the event_id attribution: note it is caller-injected (not from signEvent).

--- DEFECT F2 — Missing signer_node_id field in §5.1, §5.2, §5.3 ---

Current spec: envelopes carry signer_pubkey but no signer_node_id.
Real interface — lib/node-identity.mjs verifyEvent accepts opts.expectedNodeId to defend
against registry impersonation; without signer_node_id on the envelope the receiver can't
supply this option.

Fix F2:
- Add  signer_node_id: "<node id>"  to the signed-fields block of all three envelope schemas
  (§5.1, §5.2, §5.3), alongside signer_pubkey.

--- DEFECT F4 — Wrong session mode discriminator in §3 and §4.1 ---

Current spec §3 (lines 120-123) and session anchors §3.1/§3.2/§3.3:
  "session architecture field"
  session.architecture = "adversarial"  /  "cooperative"  /  "collaborative"

Current spec §4.1:
  Management sessions use session.type = "management"

Real interface — lib/mesh-collab.js:54-59 (createSession):
  return { session_id, task_id, mode: collabSpec.mode || COLLAB_MODE.PARALLEL, ... }

Real interface — lib/mesh-collab.js:34:
  CIRCLING_STRATEGY: 'circling_strategy'

The real discriminator is session.mode, not session.architecture or session.type.

Fix F4:
- In §3 prose: replace "session architecture field" with "session.mode field".
- In §3.1/§3.2/§3.3 session anchors: change session.architecture = "..." to
  session.mode = "circling_strategy" / "cooperative" / "collaborative".
- In §4.1: change session.type = "management" to session.mode = "management"
  (or note it is a new mode value, consistent with the session.mode pattern).

--- ACCEPTANCE ---
For each of F1/F2/F4: the corrected schema/text block + one-line rationale tied to file:line.
No changes outside these three defects.
```

## §4 Needs pre-screen (PROTOCOL §11)

| Need | Check |
|---|---|
| 2.1 baseline (circling lifecycle live) | COMPONENT_REGISTRY Family 2 LIVE ✓ |
| 2.2 (adaptive convergence) | CLOSED 2026-07-11 ✓ |
| 2.3 (parse-failure retry ×3) | CLOSED 2026-07-11 ✓ |
| ollama running with qwen3:8b | `curl :11434/api/tags` → qwen3:8b 8.2B Q4_K_M ✓ |
| real small task chosen with operator | D8 (F1/F2/F4 hardening) ✓ |
| idle-enough GPU window | no mesh-agent processes running (ps aux grep clean) ✓ |
| NATS live on :4222 | `curl :8222/varz` → in_msgs=31969, connections=5 ✓ |
| bin/mesh-task-daemon.js | present ✓ |
| bin/mesh-bridge.js | present ✓ |
| bin/mesh-agent.js | present ✓ |
| lib/mesh-collab.js | present ✓ |

All Needs present. No BLOCK.

## §5 Mid-Implementation Findings

**Blocker encountered at Phase 4 (2026-07-11):** The Claude Code sandbox in this interactive session
blocks background process launch (`&`, `nohup`) and file redirection (`>`). The mesh-task-daemon,
mesh-bridge, and mesh-agent processes cannot be started from within the tick. BLOCKED.md written;
operator must run the session manually (exact commands in BLOCKED.md).

**To be filled in by operator after session completes:**

```
SESSION_ID:    <fill in>
TASK_ID:       <fill in>
START_MS:      <fill in>
COMPLETE_MS:   <fill in>
WALL_CLOCK_S:  <fill in>
INFERENCES:    <fill in>  (check mesh-agent logs for LLM calls)
CONVERGED_IN:  SR<N>  (which sub-round triggered adaptive early-exit, if any)
ARTIFACT_KV_KEY: <fill in>  (nats kv get MESH_COLLAB <SESSION_ID> | jq '.result.artifact_key')
PARSE_RETRIES: <fill in>  (how many parse failures occurred total)
ARTIFACTS_REVIEW_VERDICT: <ACCEPT|REJECT|NEEDS_WORK>  (operator visual review outcome)
```

## §6 Phase-8 patches anticipated

None — no production code changes this step. Stack is fully in place from 2.1–2.3.

## §6 File-delta outline

| File | Change |
|---|---|
| `memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_PRE.md` | this file |
| `memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_POST.md` | phase 7 |
| `memory-plan/plans/federation/VERSION` | v2.3 → v2.4-pre (phase 1) → v2.4-mid (phase 4) → BLOCK at visual (phase 5) |
| `memory-plan/plans/federation/INVENTORY.md` | flip 2.4 `[ ]` → `[A]` (phase 1) → `[x]` at close (phase 9, after visual gate) |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | update Family 2 with real-LLM evidence |
| `memory-plan/plans/federation/BLOCKED.md` | phase 5 — visual gate for operator artifact review |

No production code changes.
