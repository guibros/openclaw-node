# foreman — Step Inventory

Integrate Foreman-style deterministic supervision (fast assessor + deterministic policy) over mesh workers, shadow-first.

Every `ROADMAP.md` block decomposed to **true atomic grain**. **One step = one
independently-verifiable runtime outcome = one 9-phase cycle = one commit** (`PROTOCOL.md` §3).
Each step carries done-evidence that is *runtime-observable* (MASTER_PLAN §5), written next to
the table, not just tests-green.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred.
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — keep the five columns, one row per step.

---

## Block 1 — Shadow supervision

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Shadow-mode supervisor: lib/foreman (observation · assessment · policy · steering · assessor · supervisor) wired into mesh-agent runLLM/executeTask; per-task JSONL timeline + mesh.foreman.* events; decisions recorded, none enforced — CLOSED 2026-09-21: 47 foreman tests + root suite green; real-child timeline evidence in this container; operator-node evidence is 1.2. See audits/step11_shadow-supervision |
| 1 | 1.2 | v1.2 | [ ] | First live shadow timeline on the operator's node: deploy, restart the agent, run one real task, read its timeline and telemetry note |

> **1.1 — Goal:** every mesh task run by `bin/mesh-agent.js` is supervised in shadow mode and leaves a timeline of what the supervisor observed, assessed and would have decided.
> **Needs:** `bin/mesh-agent.js` `runLLM`/`executeTask` (present); `lib/llm-client.mjs` `generateAnalysis` + `useJsonFormat` (present); `lib/hyperagent-store.mjs` telemetry notes (present); DECISIONS D1 (logged).
> **Feeds:** step 1.2 reads the timeline this step writes; Block 2 enforces through the `onIntervention` seam this step leaves; hyperagent telemetry `meta_notes` carries the per-task summary line.
> **Verify:** `code:` `node --test test/foreman-*.test.mjs` green (policy precedence, verification gate, steer accounting, passthrough on assessor failure, real child process supervised end to end, no per-output-line timeline writes) and `npm test` green at baseline · `runtime:` `node --test test/foreman-supervisor.test.mjs` writes a JSONL timeline whose rows include `foreman.assessed` and `foreman.closed` for a real spawned child (this container); the operator's-node timeline is step 1.2.

> **1.2 — Goal:** one real task's timeline exists on the operator's node with a local-model assessment in it.
> **Needs:** 1.1 closed; `~/.openclaw/workspace` deployed at the 1.1 commit; `ai.openclaw.mesh-agent` restarted; Ollama serving `LLM_MODEL`.
> **Feeds:** Block 2's go/no-go (are shadow decisions sane on real work?); Block 3's calibration input.
> **Verify:** `runtime:` `ls ~/.openclaw/foreman/*.jsonl` non-empty; `grep -c '"type":"foreman.assessed"'` ≥ 1 with `"assessor":"llm:` in the row; `sqlite3 ~/.openclaw/state.db "select meta_notes from hyperagent_telemetry order by id desc limit 1"` contains `Foreman[shadow]`.

## Block 2 — Enforcement

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [x] | Enforce STOP and ESCALATE (default on; MESH_FOREMAN_ENFORCE=0 for shadow): kill the worker's process group, feed the reason into the retry prompt, release on ESCALATE — CLOSED 2026-09-21 with 2.2 in one commit on operator instruction (D2); real detached children stopped in tests. See audits/step21_enforce-stop-escalate |
| 2 | 2.2 | v2.2 | [x] | Independent verifier pass: a verification-mission worker with a structured verdict, gating completion through the policy's verification rule — CLOSED 2026-09-21 (no-metric tasks; the metric stays the verification where one exists). See audits/step22_verifier-pass |

> **2.1 — Goal:** with enforcement on, a stuck worker is stopped by the supervisor and the agent's attempt loop retries it with the supervisor's reason in the prompt.
> **Needs:** the supervisor loop (1.1). The "≥5 shadow timelines first" pre-screen was dropped by operator ruling 2026-09-21 (D2): enforcement is the default.
> **Feeds:** 2.2 (verifier decisions ride the same seam); Block 3 counts enforced actions.
> **Verify:** `runtime:` a task whose worker loops (`sleep` in a shell provider) is stopped, its attempt record says `stopped by foreman: … stuck`, and the retry prompt contains that line — observed in the agent log and timeline on the operator's node.

> **2.2 — Goal:** a verifier pass runs after the coding worker when the policy asks for one, and its PASS/FAIL verdict gates completion.
> **Needs:** 2.1 closed; a verification mission prompt; verdict parsing (`FOREMAN_VERDICT: PASS|FAIL`).
> **Feeds:** Block 3 measures whether verifier passes change completion quality.
> **Verify:** `runtime:` a task whose verifier reports FAIL is not completed; the timeline shows `verification.recorded passed=false` followed by a non-FINISH decision.

## Block 3 — Calibration and surfaces

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | Calibration report over timelines: shadow decision vs actual outcome per task, per-dimension FP/FN |
| 3 | 3.2 | v3.2 | [ ] | Mission Control: live supervision panel from mesh.foreman.* events |

> **3.1 — Goal:** a report that says, per dimension, how often the shadow supervisor was right.
> **Needs:** ≥20 timelines with closed outcomes; the hyperagent telemetry join key (`task_id`).
> **Feeds:** hyperagent-evidence preregistration (2.1 there); threshold tuning in `lib/foreman/policy.mjs`.
> **Verify:** `code:` the report runs on fixture timelines with known answers and prints the expected counts · `runtime:` it runs on the operator's real timelines and the numbers are pasted into the audit.

> **3.2 — Goal:** an operator can watch a task's supervision live in Mission Control.
> **Needs:** 1.2 closed (events flowing); MC's existing NATS subscription path.
> **Feeds:** operator workflow.
> **Verify:** `visual:` the panel shows the ten scores updating during a real task.
