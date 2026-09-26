# foreman — Step Inventory

Integrate Foreman-style deterministic supervision (fast assessor + deterministic policy) over mesh workers, shadow-first.

**2026-09-26 (D3):** steps 2.1 and 2.2 were marked `[x]` on 2026-09-21 without their `runtime:`
Verify ever running; they are back to `[A]`. Their code was corrected the same day by the audit
remediation (`audits/remediation_2026-09-26/`): shadow is the default again, and the no-metric
gate, verdict parser, verifier write access, single-sample STOP and supervisor leak were fixed.
`VERSION` is back to `v1.1`, the last step whose Verify ran as written.

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
> **Needs:** 1.1 closed; `~/.openclaw/workspace` deployed at a commit carrying D3 (shadow default); `ai.openclaw.mesh-agent` restarted with `MESH_FOREMAN_ENFORCE` unset; Ollama serving `LLM_MODEL`.
> **Feeds:** Block 2's go/no-go (are shadow decisions sane on real work?); Block 3's calibration input.
> **Verify:** `runtime:` `ls ~/.openclaw/foreman/*.jsonl` non-empty; `grep -c '"type":"foreman.assessed"'` ≥ 1 with `"assessor":"llm:` in the row; `sqlite3 ~/.openclaw/state.db "select meta_notes from ha_telemetry where task_id = '<that task>'"` contains `Foreman[shadow]` (the table is `ha_telemetry` — this line named a nonexistent `hyperagent_telemetry` until 2026-09-26 — and `Foreman[shadow]` is right again because shadow is the default under D3).

## Block 2 — Enforcement

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [A] | Enforce STOP and ESCALATE when MESH_FOREMAN_ENFORCE=1 (shadow by default, D3): kill a confirmed-stuck worker's process group (3 consecutive stuck assessments on an unchanged tree), feed the reason into the retry prompt, release on ESCALATE — code + tests 2026-09-21 (D2), corrected 2026-09-26 (D3); RE-OPENED 2026-09-26: marked closed without its runtime Verify. See audits/step21_enforce-stop-escalate, audits/remediation_2026-09-26 |
| 2 | 2.2 | v2.2 | [A] | Independent verifier pass gating no-metric completion when enforcing: only exactly one FOREMAN_VERDICT: PASS line from a verifier that left the worktree unchanged completes (changes voided and reverted); no verifier on promptless providers (shell completes on its exit code) — code + tests 2026-09-21, gate corrected 2026-09-26 (D3: it completed whenever the policy did not say START_VERIFIER); RE-OPENED 2026-09-26: marked closed without its runtime Verify. See audits/step22_verifier-pass, audits/remediation_2026-09-26 |

> **2.1 — Goal:** with `MESH_FOREMAN_ENFORCE=1`, a worker confirmed stuck is stopped by the supervisor and the agent's attempt loop retries it with the supervisor's reason in the prompt.
> **Needs:** the supervisor loop (1.1); a node running the D3 code with `MESH_FOREMAN_ENFORCE=1` rendered into its mesh-agent unit. (D2 dropped the "≥5 shadow timelines first" pre-screen; D3 makes enforcement opt-in again, so when to flip it is the operator's call — 1.2's shadow timeline is its natural input.)
> **Feeds:** 2.2 (verifier decisions ride the same seam); Block 3 counts enforced actions.
> **Verify:** `runtime:` on the operator's node with `MESH_FOREMAN_ENFORCE=1`, a task whose worker idles without touching the tree (a `shell` task running a script that only sleeps, e.g. `node ./bin/<sleeper>.js` — a bare `sleep` is refused by the shell filter, which made the pre-2026-09-26 wording of this line unrunnable) is stopped after three consecutive stuck assessments: its timeline shows `foreman.intervened` CONTINUE rows reading `unconfirmed (1/3 …)`, `(2/3 …)`, then `STOP_WORKER` with `mode:"enforce"` and `outcome.applied:true`; its attempt record says `stopped by Foreman — … stuck`; and the agent log shows the retry prompt carrying it.

> **2.2 — Goal:** with enforcement on, every no-metric attempt that exits cleanly goes through an independent verifier pass, and only one well-formed PASS from a verifier that left the tree unchanged completes it.
> **Needs:** 2.1's enforcement switch on the node; the verification mission and strict verdict parsing (`lib/foreman/verifier.mjs`); the tree snapshot/restore (`treeSnapshot`/`restoreTree` in `lib/foreman/observation.mjs`).
> **Feeds:** Block 3 measures whether verifier passes change completion quality.
> **Verify:** `runtime:` on the operator's node with `MESH_FOREMAN_ENFORCE=1`, a no-metric task whose verifier reports FAIL (or no single verdict line) is not completed on that attempt: its timeline shows `verification.recorded` with `source:"verifier"`, `passed:false`, and the agent log shows a retry or a release, never `COMPLETED` for that attempt; and a no-metric task whose verifier PASSes completes only after a `verification.recorded` `source:"verifier"` `passed:true` row. `code:` `node --test test/foreman-verify-gate.test.mjs` green.

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
