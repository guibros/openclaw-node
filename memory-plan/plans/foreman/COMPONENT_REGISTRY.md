# COMPONENT_REGISTRY — foreman plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row.

## Family 1: supervisor library

### lib/foreman/ — observation · assessment · policy · steering · assessor · supervisor

| | |
|---|---|
| **Status** | BUILT, SHADOW by default — enforcement opt-in via `MESH_FOREMAN_ENFORCE=1` (D3, superseding D2's enforce-by-default); DEPLOYED on the operator's node 2026-09-27 and observed supervising one task in shadow (probe below) |
| **Verified** | 2026-09-21 — `node --test test/foreman-*.test.mjs` → all green (policy 17, assessment 9, observation 7, assessor 6, supervisor 8 = 47); `npm test` root suite 2116 pass / 0 fail / 7 skipped; `test/foreman-supervisor.test.mjs` "supervises a real child process end to end" wrote a JSONL timeline with `foreman.assessed` + `worker.exited exit_code=0` + `foreman.closed` for a real `node -e` child in this container |
| **Assessor** | `createDefaultAssessor` → `lib/llm-client.mjs` `generateAnalysis` (analysis lane, 8s, JSON mode only when `useJsonFormat(model)`) — not exercised against a live Ollama here; unavailable → passthrough by design (D1) |
| **Remediated** | 2026-09-26 (D3) — `node --test test/foreman-*.test.mjs` → 88 pass / 0 fail (assessment 9, assessor 6, enforcement 6, observation 11, policy 21, supervisor 13, verifier 10, verify-gate 12); each of the nine fixes reverted in turn makes at least one of them fail (audits/remediation_2026-09-26/AUDIT.md §3) |
| **Runtime probe 2026-09-27** | live checkout `node-deploy/2026-09-27-foreman` (973e81e: d9 + main c64ff34 + PR #32 5e10330); agent log 15:00:19Z `FOREMAN foreman-step12-20260927: supervising in shadow mode (assessor llm:qwen3:8b, timeline /Users/moltymac/.openclaw/foreman)`; `grep -c '"type":"foreman.assessed"' ~/.openclaw/foreman/foreman-step12-20260927.jsonl` → 8, all `llm:qwen3:8b` (22–63 s each, 2 timeouts at 90 s); every assessment progress 0.9 / stuck 0 for a worker failing auth — no discrimination (audits/step12_first-live-timeline §4) |
| **Mid-cycle events** | 2026-10-01 — the drop is visible on the node: `~/.openclaw/foreman/foreman-step12-20260927-r2.jsonl` has `worker.exited` 318 ms into iteration 2's 31.8 s assessment, that iteration's `START_WORKER` (`worker_id: null`, the pre-exit assessment decided against the post-exit state), and no post-exit cycle; `foreman.closed` follows 7 ms after the settle. Fixed in code the same day: a cycle consumes only the events pending when it begins, a later event gets a follow-up once it settles, and no timer is armed while a cycle runs. `node --test test/foreman-*.test.mjs` → 99 pass / 0 fail. **Deployed 2026-10-01 13:40 EDT** as the layered release `~/.openclaw/releases/worker-drain-69b7f37-foreman-5cb71b7-e57f89b`, which is worker-drain-69b7f37 plus this one file. Its 2,615 entries were compared with the base release and its 1,911 tracked files with e57f89b, and the reproduction run against the release's `lib/foreman` gives 2 cycles ending in FINISH. `ai.openclaw.mesh-agent` `ProgramArguments[1]` was re-pointed to it: plist sha256 `bb28366c…` → `c9209b9b…`, backup `~/.openclaw/backups/foreman/ai.openclaw.mesh-agent.plist.20261001T134005.bak`. The entry SHA is unchanged (`1304cb31…`) and bare-module resolutions under the unit env are unchanged; the agent is loaded, not running and not disabled. The node-state-recovery full-node baseline of 2026-10-01 00:01 EDT pinned the old plist and needs recapturing. No task has run on the release, so the fixed path's runtime is UNKNOWN |
| **Runtime probe** | 2026-09-26 21:30 UTC — `ls ~/.openclaw/workspace/lib/foreman` → no such directory (`workspace/lib` → the main checkout, on a branch without Foreman); `ls ~/.openclaw/foreman` → absent; `launchctl list ai.openclaw.mesh-agent` → loaded, no PID. No Foreman code has run on this node. |
| **Enforcement** | 2026-09-21 — `test/foreman-enforcement.test.mjs`: a real detached `node` child SIGTERM'd by STOP_WORKER (graceful), SIGKILL'd when it ignores SIGTERM past `stop_grace_ms`, ESCALATE raising `state.escalation`, shadow mode leaving the child alive; `test/foreman-verifier.test.mjs`: mission + `FOREMAN_VERDICT` parsing |

## Family 2: mesh worker

### bin/mesh-agent.js — runLLM / executeTask wiring

| | |
|---|---|
| **Status** | DEPLOYED 2026-09-27 (unit: `MESH_WORKSPACE=~/.openclaw/mesh-workspace`, `LLM_MODEL=qwen3:8b`, `MESH_FOREMAN_ASSESS_TIMEOUT_MS=90000`, shadow); loaded, NOT running (stopped after the 1.2 run — its claude CLI login has expired). `superviseTask` observed live: the attempt loop threw on the daemon's budget-fail (`Task … not found`) and the supervisor still closed (`foreman.closed` outcome `error`). WIRED in code, shadow by default: `detached: true` spawn; enforcing, Foreman-stopped attempts retry with the guidance, ESCALATE breaks to release, and a no-metric attempt completes only through `foremanVerify` (one well-formed verifier PASS, tree unchanged; `shell` completes on its exit code); `superviseTask` closes the supervisor on every exit of `executeTask`; the unit templates render `MESH_FOREMAN_ENFORCE`; runtime UNKNOWN — not deployed (see the probe above) |
| **Verified** | 2026-09-21 — `grep -n "createTaskSupervisor\|closeSupervision\|supervisor.attach\|supervisor.workerStarted\|supervisor.recordVerification\|supervisor.workerExited" bin/mesh-agent.js` → helpers + 1 create, 1 workerStarted, 1 attach, 2 workerExited (close/error), 1 recordVerification, 4 closes (dry-run, no-metric success, metric success, release); `node --check bin/mesh-agent.js` clean |
| **Verified (D3)** | 2026-09-26 — `test/foreman-verify-gate.test.mjs` drives `foremanVerify` through the agent's real `runLLM` with a registered stub provider in a real git worktree (PASS completes; FAIL / no verdict / quoted PASS / PASS-with-failed-exit do not; the verifier runs whatever the post-exit decision; a writing verifier is voided and reverted; ESCALATE releases; `shell` completes on exit code; shadow and off complete as before; `superviseTask` closes on a throw); `node --check bin/mesh-agent.js` clean |
| **Failure posture** | every supervisor call null-guarded; constructor failure → `null` + warn; `MESH_FOREMAN=0` → no supervisor |

## Family 3: evidence surfaces

### ~/.openclaw/foreman/<task_id>.jsonl — per-task timeline · mesh.foreman.* — bus events

| | |
|---|---|
| **Status** | LIVE — two timelines on 2026-09-27: `foreman-step12-20260927-r2.jsonl` (3,151 B; completed task, 2 `foreman.assessed`, `foreman.closed` outcome `success`) and the first run's `~/.openclaw/foreman/foreman-step12-20260927.jsonl` (10,123 B; 10 iterations, 8 `foreman.assessed`, 8 `foreman.intervened` CONTINUE shadow, 2 `foreman.assessor_unavailable`, `foreman.closed` outcome `error`) |
| **Verified** | 2026-09-21 — shape proven only by the test timeline in this container: `foreman.started, worker.started, foreman.observed, foreman.assessed, foreman.intervened, worker.exited, verification.recorded, foreman.closed`, no `worker.output` rows |

### hyperagent telemetry meta_notes — `Foreman[shadow] …` summary line

| | |
|---|---|
| **Status** | LIVE 2026-09-27 — `ha_telemetry` row 60 (task `foreman-step12-20260927-r2`, outcome success) carries `Foreman[shadow] iterations=2 interventions=0 actions=CONTINUE:1,START_WORKER:1 assessor=llm:qwen3:8b failures=0 …`. The error-path fix (`superviseTask` → `err.foremanNote`) is deployed (e57f89b) but not yet exercised on the node; the 2026-09-27 task's row, written before the fix, reads `Unhandled worker error: Task foreman-step12-20260927 not found`, with no `Foreman[shadow]` line; no normal-path row yet (the row lands in `ha_telemetry.meta_notes` — step 1.2's Verify named a nonexistent `hyperagent_telemetry` until 2026-09-26) |
| **Verified** | 2026-09-21 — `closeSupervision()` return appended to the `notes` of all three `recordHyperagentTask` calls in `executeTask` (grep above) |
