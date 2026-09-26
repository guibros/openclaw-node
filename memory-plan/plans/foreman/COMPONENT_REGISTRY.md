# COMPONENT_REGISTRY — foreman plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row.

## Family 1: supervisor library

### lib/foreman/ — observation · assessment · policy · steering · assessor · supervisor

| | |
|---|---|
| **Status** | BUILT, SHADOW by default — enforcement opt-in via `MESH_FOREMAN_ENFORCE=1` (D3, superseding D2's enforce-by-default); runtime UNKNOWN: not deployed on the operator's node (probe 2026-09-26 below) |
| **Verified** | 2026-09-21 — `node --test test/foreman-*.test.mjs` → all green (policy 17, assessment 9, observation 7, assessor 6, supervisor 8 = 47); `npm test` root suite 2116 pass / 0 fail / 7 skipped; `test/foreman-supervisor.test.mjs` "supervises a real child process end to end" wrote a JSONL timeline with `foreman.assessed` + `worker.exited exit_code=0` + `foreman.closed` for a real `node -e` child in this container |
| **Assessor** | `createDefaultAssessor` → `lib/llm-client.mjs` `generateAnalysis` (analysis lane, 8s, JSON mode only when `useJsonFormat(model)`) — not exercised against a live Ollama here; unavailable → passthrough by design (D1) |
| **Remediated** | 2026-09-26 (D3) — `node --test test/foreman-*.test.mjs` → 88 pass / 0 fail (assessment 9, assessor 6, enforcement 6, observation 11, policy 21, supervisor 13, verifier 10, verify-gate 12); each of the nine fixes reverted in turn makes at least one of them fail (audits/remediation_2026-09-26/AUDIT.md §3) |
| **Runtime probe** | 2026-09-26 21:30 UTC — `ls ~/.openclaw/workspace/lib/foreman` → no such directory (`workspace/lib` → the main checkout, on a branch without Foreman); `ls ~/.openclaw/foreman` → absent; `launchctl list ai.openclaw.mesh-agent` → loaded, no PID. No Foreman code has run on this node. |
| **Enforcement** | 2026-09-21 — `test/foreman-enforcement.test.mjs`: a real detached `node` child SIGTERM'd by STOP_WORKER (graceful), SIGKILL'd when it ignores SIGTERM past `stop_grace_ms`, ESCALATE raising `state.escalation`, shadow mode leaving the child alive; `test/foreman-verifier.test.mjs`: mission + `FOREMAN_VERDICT` parsing |

## Family 2: mesh worker

### bin/mesh-agent.js — runLLM / executeTask wiring

| | |
|---|---|
| **Status** | WIRED in code, shadow by default: `detached: true` spawn; enforcing, Foreman-stopped attempts retry with the guidance, ESCALATE breaks to release, and a no-metric attempt completes only through `foremanVerify` (one well-formed verifier PASS, tree unchanged; `shell` completes on its exit code); `superviseTask` closes the supervisor on every exit of `executeTask`; the unit templates render `MESH_FOREMAN_ENFORCE`; runtime UNKNOWN — not deployed (see the probe above) |
| **Verified** | 2026-09-21 — `grep -n "createTaskSupervisor\|closeSupervision\|supervisor.attach\|supervisor.workerStarted\|supervisor.recordVerification\|supervisor.workerExited" bin/mesh-agent.js` → helpers + 1 create, 1 workerStarted, 1 attach, 2 workerExited (close/error), 1 recordVerification, 4 closes (dry-run, no-metric success, metric success, release); `node --check bin/mesh-agent.js` clean |
| **Verified (D3)** | 2026-09-26 — `test/foreman-verify-gate.test.mjs` drives `foremanVerify` through the agent's real `runLLM` with a registered stub provider in a real git worktree (PASS completes; FAIL / no verdict / quoted PASS / PASS-with-failed-exit do not; the verifier runs whatever the post-exit decision; a writing verifier is voided and reverted; ESCALATE releases; `shell` completes on exit code; shadow and off complete as before; `superviseTask` closes on a throw); `node --check bin/mesh-agent.js` clean |
| **Failure posture** | every supervisor call null-guarded; constructor failure → `null` + warn; `MESH_FOREMAN=0` → no supervisor |

## Family 3: evidence surfaces

### ~/.openclaw/foreman/<task_id>.jsonl — per-task timeline · mesh.foreman.* — bus events

| | |
|---|---|
| **Status** | UNBUILT at runtime (no task has run under the new code on any node; re-probed 2026-09-26: `~/.openclaw/foreman` absent) |
| **Verified** | 2026-09-21 — shape proven only by the test timeline in this container: `foreman.started, worker.started, foreman.observed, foreman.assessed, foreman.intervened, worker.exited, verification.recorded, foreman.closed`, no `worker.output` rows |

### hyperagent telemetry meta_notes — `Foreman[shadow] …` summary line

| | |
|---|---|
| **Status** | WIRED in code; no row written yet (the row lands in `ha_telemetry.meta_notes` — step 1.2's Verify named a nonexistent `hyperagent_telemetry` until 2026-09-26) |
| **Verified** | 2026-09-21 — `closeSupervision()` return appended to the `notes` of all three `recordHyperagentTask` calls in `executeTask` (grep above) |
