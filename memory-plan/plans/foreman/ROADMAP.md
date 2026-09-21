# foreman — Roadmap

**Goal.** Integrate Foreman-style deterministic supervision — a fast local assessor answering ten
fixed questions, a deterministic policy choosing from a small action vocabulary — over every
mesh worker, shadow-first, inside the existing worker process.
**Created:** 2026-09-21

Foreman (thruwire/foreman, reviewed 2026-09-19) is the reference design: a coding worker streams
while an independent, debounced loop builds a bounded observation, asks a fast model ten yes/no
questions, and a pure policy maps (state, assessment) → continue / steer / stop / retry / verify /
finish / escalate. It is a working instance of what DECISIONS D16 in the federation plan ruled:
no consensus gating, a deterministic pipeline. This plan lands that shape on the mesh worker
(`bin/mesh-agent.js`), where the output stream, the task worktree and the lifecycle are already
in-process — the management layer federation Block 4 never started, built as a library the
existing agent calls (MASTER_PLAN §4.6: no new daemon).

## Block 1 — Shadow supervision

- **Intent:** every mesh task is watched by the supervisor loop; every assessment and every
  decision is recorded to a per-task JSONL timeline (`~/.openclaw/foreman/<task_id>.jsonl`) and
  to `mesh.foreman.*` on the bus — and **nothing is enforced**. This is the calibration substrate:
  shadow decisions against real outcomes (metric, review, release) before any decision can kill a
  worker. An unavailable assessor degrades to today's behaviour, never to an escalation.
- **Exit criterion (runtime-observable):** a real task on the operator's node produces a timeline
  with ≥1 `foreman.assessed` row from the local model and a `foreman.closed` summary, and the
  hyperagent telemetry row for that task carries the `Foreman[shadow] …` note.
- **Unblocks:** Block 2 (enforcement needs shadow evidence that the decisions are sane).

## Block 2 — Enforcement

- **Intent:** by default (`MESH_FOREMAN_ENFORCE=0` for shadow), the policy's decisions act: STOP kills the worker's
  process group and the agent's attempt loop retries with the guidance in the retry prompt;
  ESCALATE releases the task for human triage instead of burning attempts; a verifier pass with a
  structured verdict gates completion the way the metric does today.
- **Exit criterion (runtime-observable):** a deliberately stuck task is stopped by the supervisor,
  retried once, and released with `ESCALATE` in its timeline — observed on the operator's node.
- **Unblocks:** Block 3.

## Block 3 — Calibration and surfaces

- **Intent:** turn timelines into evidence: a calibration report (shadow decision vs. actual
  outcome per task, false-positive / false-negative counts per dimension), and a Mission Control
  view of live supervision.
- **Exit criterion (runtime-observable):** the report runs over ≥20 real timelines and its
  numbers are quoted in the hyperagent-evidence plan's preregistration.
- **Unblocks:** terminal.
