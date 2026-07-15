# AUDIT_PRE — Step 2.4 · First real adversarial run: qwen3:8b to a converged vote

> **⚠ D11 (2026-07-13):** this audit records qwen3:8b **scaffold** runs. Per DECISIONS D11 they are proofs of the choreography **mechanism** only, NOT worker quality — a grappe worker is the node's OpenClaw agent on an advanced LLM, never qwen. 2.4 is re-scoped accordingly.

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

**Runs executed 2026-07-12 (driven from the interactive session as background tasks — the
original block's premise was obsoleted; this harness CAN launch the stack):**

```
RUN 1 (aborted):
  SESSION_ID:   collab-fed-2.4-spec-harden-1783826875244-1783826875279
  OUTCOME:      ABORTED at Init by the 10-min circling step timeout — 3 serialized qwen3:8b
                inferences (~8.6 min EACH on this GPU) cannot fit a 10-min step budget.
                Worker artifact WAS delivered (2,903 chars, on-target) before reviewers were
                marked dead. Structural finding, not flake.

RUN 2 (completed):
  SESSION_ID:    collab-fed-2.4-spec-harden-1783827647571-1783827647583
  TASK_ID:       fed-2.4-spec-harden-1783827647571
  START:         2026-07-12T03:40:47Z   COMPLETE: 2026-07-12T04:50:39Z
  WALL_CLOCK_S:  4192 (69.9 min)
  INFERENCES:    19 (18 planned + 1 parse-retry)
  STEP_BUDGET:   MESH_CIRCLING_STEP_TIMEOUT_MS=2700000 (45 min — the fix for RUN 1)
  CONVERGED_IN:  no early exit; full max_subrounds=2, finalization votes 2/3 converged
                 (charlie converged/1.0 · bravo converged/1.0 · alpha continue/0.5)
  ARTIFACTS:     18 stored in session KV (circling.artifacts); dumped + ANSI-stripped
  PARSE_RETRIES: 1 (bravo, SR1 Step1 — the 2.3 machinery fired live, no degradation)
  ARTIFACTS_REVIEW_VERDICT: <ACCEPT|REJECT|NEEDS_WORK — operator visual gate, pending>
```

**Real-run findings (the reason 2.4 exists):**

1. **Env resolution kills the runbook** — live openclaw.env has `OPENCLAW_NATS=nats://100.91.131.61:4222`
   (Tailscale IP, unreachable off-tailnet) → every daemon dies `Fatal: TIMEOUT` while the loopback
   bus is healthy. The launchd units hardcode loopback (R28) for exactly this; the manual runbook
   and any bare-shell launch must export `OPENCLAW_NATS=nats://127.0.0.1:4222`.
2. **`LLM_MODEL` env does not reach mesh-agent model choice** — resolution is task.llm_model >
   `--model` flag > provider default (lib/llm-providers.js:236); agents came up on `llama3`
   (not pulled). Workaround: `--model qwen3:8b` + task-level `llm_model`. The D9 unit templates
   set the env var, which the agent ignores — units need the flag (or the agent needs an env
   fallback).
3. **10-min circling step budget is structurally wrong for single-GPU serialization** — needs
   `≥ N_nodes × inference_time`. Knob exists: `MESH_CIRCLING_STEP_TIMEOUT_MS`
   (mesh-task-daemon.js:54). Paper timing assumes parallel inference.
4. **ANSI/control-sequence pollution** — `ollama run` CLI emits terminal control chars into
   captured artifacts.
5. **Aborted-session heartbeat zombie** — agents log "Session aborted. Unsubscribing." every 10s
   forever; the unsubscribe never tears down the heartbeat timer.
6. **CRITICAL — qwen3 thinking-stream contaminates the artifact pipeline**: artifacts store the
   `Thinking…/…done thinking.` reasoning stream; the worker's FINAL artifacts
   (sr1_step2 + sr2_step2 workArtifact) contain ZERO deliverable after stripping the thinking
   block — the corrected spec text never survived. Pollution PROPAGATED: the SR2 worker's own
   trace says "the work artifact provided seems to be the reviewer's thinking process, not the
   actual document." Reviewer quality was real where content existed (SR1 reviewerA artifact
   correctly identifies all three defects post-thinking) — the model can do the work; the
   pipeline loses it. Fix: disable/strip thinking in the ollama provider (think=false / strip
   block) AND treat an empty-after-strip artifact as a parse failure (extends 2.3's retry).
7. **Convergence over garbage** — both `converged/1.0` sign-offs explicitly *assume* the fixes
   are present (their traces say so); the only honest vote was the worker's `continue/0.5`.
   The barrier/vote machinery followed its rules on polluted inputs — finding 6's fix is the
   remedy; a converged vote should require a non-empty deliverable to vote on.

**Machinery verdict (independent of artifact quality): VERIFIED** — recruit → 3/3 join →
role assignment → Init → SR1 → SR2 → finalization → `status=completed`, barriers held, one
parse-retry consumed, 45-min budget absorbed serialization, KV/event trail complete.

**RUNS 3–4 (2026-07-13, post-fix):**

```
RUN 3 (completed → ESCALATED, 39 min):
  SESSION_ID:  collab-fed-2.4-spec-harden-1783904708658-1783904708667
  FIXES LIVE:  --think=false + stripLlmOutput (f9e54ae) — ~3x faster, artifacts carried
               real content where present (no thinking traces)
  OUTCOME:     worker (charlie) emitted ZERO artifact blocks on Init/Step2 (daemon
               warn-only); reviewers REFUSED to sign → finalization 2x blocked →
               CIRCLING ESCALATION. Honest anti-rubber-stamp behavior — the run-2
               failure mode is dead.
  FINDING 8:   zero-artifact circling submissions must be parse failures, not warnings
               → guard tightened (zero-or-empty ⇒ parse_failed ⇒ 2.3 retry), 194a189.

RUN 4 (guard v2, orphaned by driver collision):
  SESSION_ID:  collab-fed-2.4-spec-harden-1783907585200-1783907585225
  OBSERVED:    reviewers' Init artifacts real (1920/2014 chars); worker (alpha) parse
               failures correctly RETRIED (attempt 1→2→3) — finding-8 guard working live.
  FINDING 9:   DRIVER COLLISION — at 02:18:52Z a second Claude session (operator-armed
               tick, Fable budget limits) SIGTERM'd this session's agents mid-retry and
               started identical replacements; fresh agents cannot rejoin an in-flight
               session → run 4 orphaned, self-cleans via the 45-min step timeout.
               Chain-discipline rule: ONE session-driver at a time; interactive driver
               stood down 2026-07-13 ~02:30Z, the tick owns the runtime from here.

  FINDING 10:  CORRUPT KV VALUE KILLS THE COORDINATOR — during the collision's SIGTERM
               storm, a writer put a ZERO-BYTE value on run 4's session key (observed:
               length 0 at revision 256). CollabStore.get (lib/mesh-collab.js:158) does
               a naked JSON.parse → 'Unexpected end of JSON input' → the daemon's
               step-timeout sweep (handleCirclingStepTimeout, mesh-task-daemon.js:1366)
               died UNHANDLED → daemon exit 1. Every other reader (agents' status calls,
               the watch poller) crashed on the same value. Same fragility family the
               2026-07-10 audit ledgered pre-1.5. Remediation observed: corrupt key
               PURGED, daemon restarted 02:40:32Z, >5 sweep cycles clean. Code fix for
               the pre-1.5 hardening batch: CollabStore.get must treat unparseable/empty
               values as missing (warn + skip), never throw into the sweep.

RUN 7 (2026-07-15 — THE OpenClaw-worker run, D11 satisfied): session
collab-fed-2.4-spec-harden-1784073104338-1784073104346, driven on the node's LAUNCHD
mesh-task-daemon (the production service — now live from the operator's install; survives
harness restarts). Workers = 3 harness-loaded Claude/sonnet OpenClaws (MESH_LLM_PROVIDER=claude),
inferencing in PARALLEL. **14 substantive artifacts** (reviewer critiques 4k–10k chars each — no
thinking contamination, the strip/guard stack held). **Genuine adversarial behavior**: votes ranged
continue(0.87-0.91) → converged(0.93) → BLOCKED(0.97 alpha, 0.91 charlie) — reviewers dissented on
real findings, the rubber-stamp failure mode is dead. **The worker deliverable is real and correct**:
sr0/sr2 workArtifacts give corrected F1/F2/F4 blocks with file:line rationale
(lib/node-identity.mjs:419 checkEventFreshness, :374-404 signEvent), and the worker VERIFIED against
the live file — honestly reporting F1/F2 "already correct, no edit needed" and finding one real gap
(SS3.1 missing its session.mode anchor for F4). This MEETS 2.4's "artifacts non-trivial" contract and
demonstrates the OpenClaw-worker quality lift the premise predicts.

  OUTCOME: aborted at FINALIZATION — the launchd daemon ran the 10-min code-default step budget
           (my MESH_CIRCLING_STEP_TIMEOUT_MS override applies only to manually-launched daemons, not
           the service); bravo's finalization turn exceeded 10 min → startRound failed → abort.
           ENVIRONMENT CONFIG, not a quality/code failure — the deliverable was already produced.
  FIX (this batch): mesh-task-daemon launchd + systemd units now set
           MESH_CIRCLING_STEP_TIMEOUT_MS=1800000 (30 min) so a deployed node can finish a real
           OpenClaw circling session. Rerun on the re-rendered unit expected to close cleanly.
  FINDINGS 11-12: (11) TWO coordinators on one bus = session-id split + "already joined"/full aborts —
           the operator's install brought the launchd mesh-task-daemon live while a manual daemon ran;
           one bus MUST have one coordinator (killed the manual stack, launchd owns it). (12) harness
           process restarts orphan child-launched stacks mid-session — mitigated by driving through the
           launchd service (survives restarts) + a detached notify-watcher (desktop popup + on-disk
           result, independent of the interactive session).

RUN 5 (the tick's, in flight at handoff): session
collab-fed-2.4-spec-harden-1783909185003-1783909185026 (submitted 02:19:45Z by the tick's
driver) SURVIVED the coordinator crash-and-restore — KV-backed session state resumed under
the restarted daemon with no intervention (an unplanned but observed resilience proof:
coordinator death mid-session is recoverable). Status at 02:5xZ: init phase, 2 artifacts
stored, 3/3 nodes working. The tick drives it to the operator's visual gate.
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
