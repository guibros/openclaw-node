# AUDIT_PRE — step 1.1 · Shadow-mode Foreman supervision over mesh workers

## §0 Micro Re-Orient
- **Where:** foreman plan, Block 1 (shadow supervision), step 1.1 of 2; plan at v0.0 → this step opens v1.1.
- **Last step changed:** nothing — first step of a new plan scaffolded 2026-09-21 on operator instruction.
- **This step contributes:** the whole supervisor library and its wiring into the worker path, in shadow mode.
- **North-star line served:** MASTER_PLAN §3 mesh family; federation ROADMAP Block 4 (management layer) re-derived under D16 as a deterministic pipeline.
- **Still the right next step?** Yes — there is no supervision of workers today; shadow mode is the only safe first move.

## §1 Intent
Every task `bin/mesh-agent.js` runs is supervised: the worker's output is observed as it streams, the local model answers ten fixed questions, a deterministic policy decides, and the decision is recorded — not enforced.

## §2 Design (DECISIONS D1)
`lib/foreman/{assessment,policy,steering,observation,assessor,supervisor,index}.mjs`; `runLLM(prompt, task, worktreePath, supervisor)` attaches the child and reports exit; `executeTask` creates the supervisor after the task starts, reports each attempt, records the metric as the verification signal, and closes the supervisor on every exit path, carrying a one-line summary into hyperagent telemetry notes.

## §3 Risk register
| Risk | Mitigation |
|---|---|
| Supervisor error breaks task execution | Every supervisor call in the agent is null-guarded; construction failures return `null` and log; the loop's own errors are caught per cycle. |
| Local model unavailable → false escalations | Assessor failure = passthrough (no decision), by design (D1). Shadow mode enforces nothing anyway. |
| Timeline I/O amplification (upstream finding) | Lifecycle + assessments + decisions only; output feeds the observation in memory, never the file. |
| Context blow-up on qwen3:8b | Tails bounded (output 8k, diff 12k, instructions 6k chars) — configurable. |
| Deploy gap (§4.1) | This container cannot reach `~/.openclaw`; runtime evidence here is the real-child-process test + its timeline; the operator's-node evidence is step 1.2, stated as such. |

## §6 File-delta outline
- add `lib/foreman/*.mjs` (7 files)
- edit `bin/mesh-agent.js` (helpers; `runLLM` signature + attach/exit; `executeTask` create/report/close)
- add `test/foreman-{assessment,policy,observation,assessor,supervisor}.test.mjs`
- add `docs/foreman.md`
- plan silo: ROADMAP, INVENTORY (1.1 `[A]`), DECISIONS D1, COMPONENT_REGISTRY, TICK_PROMPT bindings, VERSION `v1.1-pre` → `v1.1`
- `CLAUDE.md`: one paragraph in "Where we are" naming the plan
