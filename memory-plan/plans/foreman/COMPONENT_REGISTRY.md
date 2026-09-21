# COMPONENT_REGISTRY — foreman plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row.

## Family 1: supervisor library

### lib/foreman/ — observation · assessment · policy · steering · assessor · supervisor

| | |
|---|---|
| **Status** | BUILT, ENFORCING by default (code + tests in this repo; D2); runtime UNKNOWN until step 1.2 deploys it |
| **Verified** | 2026-09-21 — `node --test test/foreman-*.test.mjs` → all green (policy 17, assessment 9, observation 7, assessor 6, supervisor 8 = 47); `npm test` root suite 2116 pass / 0 fail / 7 skipped; `test/foreman-supervisor.test.mjs` "supervises a real child process end to end" wrote a JSONL timeline with `foreman.assessed` + `worker.exited exit_code=0` + `foreman.closed` for a real `node -e` child in this container |
| **Assessor** | `createDefaultAssessor` → `lib/llm-client.mjs` `generateAnalysis` (analysis lane, 8s, JSON mode only when `useJsonFormat(model)`) — not exercised against a live Ollama here; unavailable → passthrough by design (D1) |
| **Enforcement** | 2026-09-21 — `test/foreman-enforcement.test.mjs`: a real detached `node` child SIGTERM'd by STOP_WORKER (graceful), SIGKILL'd when it ignores SIGTERM past `stop_grace_ms`, ESCALATE raising `state.escalation`, shadow mode leaving the child alive; `test/foreman-verifier.test.mjs`: mission + `FOREMAN_VERDICT` parsing |

## Family 2: mesh worker

### bin/mesh-agent.js — runLLM / executeTask wiring

| | |
|---|---|
| **Status** | WIRED in code, enforcing: `detached: true` spawn, Foreman-stopped attempts retry with the guidance, ESCALATE breaks to release, no-metric completion gated by `foremanVerify`; runtime UNKNOWN — the deployed `~/.openclaw/workspace` copy and `ai.openclaw.mesh-agent` are on the operator's node (step 1.2) |
| **Verified** | 2026-09-21 — `grep -n "createTaskSupervisor\|closeSupervision\|supervisor.attach\|supervisor.workerStarted\|supervisor.recordVerification\|supervisor.workerExited" bin/mesh-agent.js` → helpers + 1 create, 1 workerStarted, 1 attach, 2 workerExited (close/error), 1 recordVerification, 4 closes (dry-run, no-metric success, metric success, release); `node --check bin/mesh-agent.js` clean |
| **Failure posture** | every supervisor call null-guarded; constructor failure → `null` + warn; `MESH_FOREMAN=0` → no supervisor |

## Family 3: evidence surfaces

### ~/.openclaw/foreman/<task_id>.jsonl — per-task timeline · mesh.foreman.* — bus events

| | |
|---|---|
| **Status** | UNBUILT at runtime (no task has run under the new code on any node) |
| **Verified** | 2026-09-21 — shape proven only by the test timeline in this container: `foreman.started, worker.started, foreman.observed, foreman.assessed, foreman.intervened, worker.exited, verification.recorded, foreman.closed`, no `worker.output` rows |

### hyperagent telemetry meta_notes — `Foreman[shadow] …` summary line

| | |
|---|---|
| **Status** | WIRED in code; no row written yet |
| **Verified** | 2026-09-21 — `closeSupervision()` return appended to the `notes` of all three `recordHyperagentTask` calls in `executeTask` (grep above) |
