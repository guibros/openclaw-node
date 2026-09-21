# Foreman — deterministic supervision over mesh workers

`lib/foreman/` watches a mesh worker while it works. It is the supervisory design of
[thruwire/foreman](https://github.com/thruwire/foreman) — reviewed 2026-09-19, its policy defects
fixed — landed inside `bin/mesh-agent.js`, where the worker's output stream, task worktree and
lifecycle already live. Plan: `memory-plan/plans/foreman/` (DECISIONS D1).

```text
CODING WORKER (claude -p …)                FOREMAN (same process)
reason → tool → observe → edit → test      observe   bounded snapshot: output tails, git status/diff,
        │ stdout/stderr                              elapsed, attempt, prior decision
        └────────────────────────────────►  assess    ten fixed yes/no questions → ten probabilities
                                            decide    pure policy, fixed precedence, 8 actions
                                            record    ~/.openclaw/foreman/<task_id>.jsonl + mesh.foreman.*
                                            (enforce) STOP / ESCALATE — Block 2, behind MESH_FOREMAN_ENFORCE
```

## What it watches

Each observation is compact and bounded — never the repository:

- the task (title, description, metric, scope, budget) and factory status;
- the active worker's stdout/stderr tails (8k chars each) and the worker history;
- `git status --short`, a bounded diff (12k) and changed file names from the task worktree;
- the worktree's own `AGENTS.override.md` / `AGENTS.md` / `CLAUDE.md` (6k, read fresh, never persisted);
- the metric result once it ran (this pipeline's verification signal);
- the previous assessment and decision, attempt/failure counts, elapsed time.

## What it assesses

Ten independent yes/no questions, each answered with the probability of "yes". Five describe the
**task**: `implementation_complete`, `tests_sufficient`, `requirements_satisfied`,
`needs_verification`, `ready_to_finish`. Five describe the **floor now**: `meaningful_progress`,
`worker_stuck`, `work_off_track`, `agents_md_drift`, `needs_human`. A missing dimension is an
error, never a default.

The assessor is the local model through the existing analysis lane (`lib/llm-client.mjs`
`generateAnalysis`, 8s ceiling, small output). **If it is unavailable — busy with extraction,
down, or answering junk — the cycle is a passthrough: no decision, and the worker runs exactly as
it does today.** Foreman escalates in that case; here the metric, harness and review gates are
still downstream, so killing healthy work over a model outage would be strictly worse.

## What it decides

A deterministic policy (`lib/foreman/policy.mjs`), in this precedence:

1. `needs_human` ≥ 0.80 → **ESCALATE**
2. intervention ceiling (20 actions other than CONTINUE — never a count of assessments) → **ESCALATE**
3. active worker off track / drifting / stuck ≥ 0.80 → **STEER_WORKER** if the worker has a live
   input channel and budget remains (a rejected delivery is retried, not charged); otherwise
   **STOP_WORKER**; a delivered steer buys a 30s grace period
4. no active worker after a stop → **RETRY_WORKER** (once), then **ESCALATE**
5. ready ≥ 0.75, requirements ≥ 0.75, tests ≥ 0.75, and verification resolved → **FINISH** —
   only a verifier that ran *after* the latest coding pass and **passed** resolves it (or
   `needs_verification` < 0.65)
6. implementation ≥ 0.75 and `needs_verification` ≥ 0.65 → **START_VERIFIER**
7. no active worker → **START_WORKER**; else **CONTINUE**

`claude -p` has no live input channel, so `supports_steering` is false and step 3 resolves to
STOP. `FINISH` and `START_WORKER` are advisory in this pipeline — the agent's attempt loop and the
daemon's review own completion.

## Modes

| Mode | Default | What happens |
|---|---|---|
| **shadow** | yes | Every assessment and decision is recorded; nothing is enforced. The calibration substrate. |
| **enforce** | `MESH_FOREMAN_ENFORCE=1` | Block 2: STOP kills the worker's process group and the retry prompt carries the reason; ESCALATE releases the task. |
| off | `MESH_FOREMAN=0` | No supervisor is created. |

## The timeline

One JSONL file per task at `~/.openclaw/foreman/<task_id>.jsonl` (`MESH_FOREMAN_DIR`):
`foreman.started` · `worker.started` · `foreman.observed` · `foreman.assessed` ·
`foreman.intervened` (with `mode` and, when enforced, `outcome`) · `foreman.assessor_unavailable` ·
`worker.exited` · `verification.recorded` · `foreman.closed` (the summary). Worker output feeds the
observation in memory and is **never** written per line. `foreman.assessed`, `foreman.intervened`,
`foreman.assessor_unavailable` and `foreman.closed` are also published on the bus as
`mesh.foreman.<event>` with `task_id` and `node_id`.

The task's hyperagent telemetry row carries a one-line summary in `meta_notes`:
`Foreman[shadow] iterations=N interventions=N actions=CONTINUE:n,… assessor=llm:qwen3:8b failures=0 last(progress=… stuck=… ready=…)`.

## Configuration

| Variable | Default | Meaning |
|---|---:|---|
| `MESH_FOREMAN` | `1` | `0` disables supervision |
| `MESH_FOREMAN_ENFORCE` | `0` | `1` enforces decisions (Block 2) |
| `MESH_FOREMAN_MIN_INTERVAL_MS` | `5000` | debounce floor between assessments while output flows |
| `MESH_FOREMAN_PERIODIC_MS` | `30000` | assessment during quiet work |
| `MESH_FOREMAN_ASSESS_TIMEOUT_MS` | `8000` | analysis-lane ceiling before passthrough |
| `MESH_FOREMAN_MODEL` | `LLM_MODEL` | assessor model (Ollama tag) |
| `MESH_FOREMAN_DIR` | `~/.openclaw/foreman` | timeline directory |
| `MESH_FOREMAN_MAX_INTERVENTIONS` | `20` | ceiling on actions other than CONTINUE |
| `MESH_FOREMAN_MAX_RETRIES` | `MESH_MAX_ATTEMPTS − 1` | retries after a stop (the agent's own attempt loop is the real budget) |
| `MESH_FOREMAN_MAX_WORKERS` | `2 × MESH_MAX_ATTEMPTS + 2` | worker records per task: one coding worker plus one metric verification record per attempt |
| `MESH_FOREMAN_GRACE_MS` | `30000` | post-steer grace |

Thresholds and observation bounds are fields of `DEFAULT_POLICY` / `DEFAULT_LIMITS` for embedders.

## Tests

`node --test test/foreman-*.test.mjs` — offline: every policy branch (including the three
fixes above), the strict assessment contract, git evidence in a real temp repository, the
assessor against a stub analysis lane (llm / fallback / error / rejected), and the supervisor
loop against fake streams and a **real spawned child process**, asserting the timeline shape,
burst coalescing, shadow-vs-enforce behaviour and passthrough on assessor failure.
