# Foreman — deterministic supervision over mesh workers

`lib/foreman/` watches a mesh worker while it works, records what it sees and decides, and —
only when enforcement is switched on — acts on it. It is the supervisory design of
[thruwire/foreman](https://github.com/thruwire/foreman) — reviewed 2026-09-19, its policy defects
fixed — landed inside `bin/mesh-agent.js`, where the worker's output stream, task worktree and
lifecycle already live. Plan: `memory-plan/plans/foreman/` (DECISIONS D1–D3).

```text
CODING WORKER (claude -p …)                FOREMAN (same process)
reason → tool → observe → edit → test      observe   bounded snapshot: output tails, git status/diff,
        │ stdout/stderr                              elapsed, attempt, prior decision
        └────────────────────────────────►  assess    ten fixed yes/no questions → ten probabilities
                                            decide    pure policy, fixed precedence, 8 actions
                                            record    ~/.openclaw/foreman/<task_id>.jsonl + mesh.foreman.*
                                            act       only with MESH_FOREMAN_ENFORCE=1:
                                                      confirmed STOP → kill + retry with guidance
                                                      ESCALATE → release for triage
                                                      no-metric completion → an independent verifier's PASS
```

**Shadow is the default.** With `MESH_FOREMAN_ENFORCE` unset (or anything but `1`), every
assessment and decision is recorded and nothing acts: no worker is stopped, no task is released
by Foreman, and a no-metric task completes exactly as it did before Foreman. Enforcement was the
default from 2026-09-21 until the 2026-09-26 audit found the defects D3 records; it is opt-in
until shadow timelines from real work show the decisions are sane (plan step 1.2, then the
2.1/2.2 runtime checks).

## What it watches

Each observation is compact and bounded — never the repository:

- the task (title, description, metric, scope, budget) and factory status;
- the active worker's stdout/stderr tails (8k chars each) and the worker history;
- `git status --short`, a bounded diff (12k) and the changed file names from the task worktree,
  all measured against `HEAD` — staged edits and new untracked files count as changes;
- the worktree's own `AGENTS.override.md` / `AGENTS.md` / `CLAUDE.md` (6k, read fresh, never persisted);
- the metric result once it ran (this pipeline's verification signal);
- the previous assessment and decision, attempt/failure counts, elapsed time.

While a worker runs, each cycle also takes a **tree snapshot**: the hash of the tree `git add -A`
would commit (tracked, staged and untracked non-ignored files), written through a scratch copy
of the worktree's index so the worker's own staging is never touched. It is what STOP hysteresis
compares, and what the verifier gate compares.

Only a running worker is polled. Between workers the loop sleeps: a lifecycle event (worker
started / exited, verification recorded) forces one cycle, and the agent asks for a decision
through `assessNow()` at its own decision points.

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
2. intervention ceiling (20 actions other than CONTINUE taken **while a worker runs** — never a
   count of assessments, and never the advisory decisions taken between workers) → **ESCALATE**
3. active worker off track / drifting / stuck ≥ 0.80 → **STEER_WORKER** if the worker has a live
   input channel and budget remains (a rejected delivery is retried, not charged; a delivered
   steer buys a 30s grace period); otherwise **STOP_WORKER** — but only once the warning has held
   for `MESH_FOREMAN_STOP_CONFIRMATIONS` (3) consecutive assessments of that worker **with the
   worktree unchanged between them**. Until then the decision is CONTINUE, recorded with the
   reason and the count (`… appears stuck — unconfirmed (2/3 consecutive on an unchanged tree)`).
   A worker that keeps writing restarts the count, however a single sample reads.
4. no active worker after a stop → **RETRY_WORKER** (once), then **ESCALATE**
5. ready ≥ 0.75, requirements ≥ 0.75, tests ≥ 0.75, and verification resolved → **FINISH** —
   only a verifier that ran *after* the latest coding pass and **passed** resolves it (or
   `needs_verification` < 0.65)
6. implementation ≥ 0.75 and `needs_verification` ≥ 0.65 → **START_VERIFIER**
7. no active worker → **START_WORKER**; else **CONTINUE**

`claude -p` has no live input channel, so `supports_steering` is false and step 3 resolves to a
confirmed STOP. A verifier never changes the tree, so for a verifier only the consecutive count
protects it.

## What it does about it (enforce mode)

| Decision | While a worker runs | After the coding worker exits (no metric) | After the worker exits (metric) |
|---|---|---|---|
| **STOP_WORKER** (confirmed) | SIGTERM the worker's whole process group, SIGKILL after `MESH_FOREMAN_STOP_GRACE_MS`; the agent's attempt loop retries with `stopped by Foreman — <reason>` and the steering guidance in the retry prompt | — | — |
| **ESCALATE** | same termination, then the loop stops spending attempts and releases the task for human triage with the reason | release instead of verifying | advisory — a passed metric wins |
| **anything else** | advisory: the agent's loop owns starting, retrying and completing | the verifier gate below runs regardless | — (the metric is the verification) |

The worker leads its own process group (`detached: true` in `runLLM`) so a stop ends the CLI and
everything it spawned. The retry prompt already renders every attempt's approach and result, so
the next attempt reads exactly why the last one was stopped and what to change.

### The no-metric completion gate

`foremanVerify` in `bin/mesh-agent.js` runs after a no-metric coding worker exits 0 and passes the
harness. In enforce mode the attempt **completes only on exactly one well-formed
`FOREMAN_VERDICT: PASS` from an independent verifier that left the worktree as it found it** —
whatever the post-exit decision is, and whether or not the assessor answered at all:

1. The post-exit assessment runs; **ESCALATE** releases the task. Nothing else short-circuits.
2. A provider that ignores its prompt (`shell`, `acceptsPrompt: false`) cannot host a verifier —
   the "verifier" would only re-run the task's command. Its exit status 0 is the verification, as
   a metric's would be: recorded as `verification.recorded` with `source: "exit-code"`, and the
   attempt completes (operator ruling 2026-09-26).
3. Otherwise the tree is snapshotted and a verification worker runs on the task's provider with a
   report-only mission (`lib/foreman/verifier.mjs`). The coding worker's report is fenced in the
   prompt as evidence, never instructions, with any verdict token in it neutralized, and the
   verdict contract comes last.
4. The tree is snapshotted again. **Any change voids the verdict** and is reverted — paths the
   verifier added are deleted, paths it changed or deleted are rewritten from the snapshot through
   a scratch index — so nothing a verifier wrote reaches the commit or the next attempt. A tree
   that cannot be snapshotted fails the gate (a verifier that cannot be held read-only does not
   verify).
5. The verdict is exactly one line reading `FOREMAN_VERDICT: PASS` or `FOREMAN_VERDICT: FAIL`
   and nothing else (case and markdown emphasis around the line are tolerated). No such line,
   more than one (a quoted or early PASS beside the real FAIL), or a malformed one
   (`PASS/FAIL`, `PASS or FAIL will follow`, trailing text) is **no verdict**, and no verdict is
   a failed verification. A PASS from a verifier that exited non-zero is a failure too.
6. A failure is recorded as a failed attempt carrying the findings, and the loop retries with them;
   an ESCALATE raised while the verifier ran releases the task.

In shadow mode (and with `MESH_FOREMAN=0`) the gate is not consulted: the attempt completes as it
always did.

## Lifecycle

Every exit from `executeTask` — completion, release, dry run, or an error thrown anywhere in the
attempt loop — closes the task's supervisor (`superviseTask`); an abnormal exit records
`foreman.closed` with `outcome: "error"`. A closed supervisor never assesses again.

## Modes

| Mode | Set by | What happens |
|---|---|---|
| **shadow** | default (`MESH_FOREMAN_ENFORCE` unset, empty, or anything but `1`) | Every assessment and decision is recorded; nothing is enforced. |
| **enforce** | `MESH_FOREMAN_ENFORCE=1` | Decisions act as described above, and are recorded. |
| off | `MESH_FOREMAN=0` | No supervisor is created. |

`MESH_FOREMAN_ENFORCE` is rendered into the mesh-agent service units
(`services/launchd/ai.openclaw.mesh-agent.plist`, `services/systemd/openclaw-mesh-agent.service`)
from `~/.openclaw/openclaw.env` when `install.sh` or `openclaw-node-init` renders them; unset
renders empty, which is shadow. Changing it means re-rendering the unit and restarting the agent.

## The timeline

One JSONL file per task at `~/.openclaw/foreman/<task_id>.jsonl` (`MESH_FOREMAN_DIR`):
`foreman.started` · `worker.started` · `foreman.observed` · `foreman.assessed` ·
`foreman.intervened` (with `mode` and, when enforced, `outcome`) · `foreman.assessor_unavailable` ·
`worker.exited` · `verification.recorded` (`source`: `metric`, `verifier` or `exit-code`) ·
`foreman.closed` (the summary). Worker output feeds the observation in memory and is **never**
written per line. `foreman.assessed`, `foreman.intervened`, `foreman.assessor_unavailable` and
`foreman.closed` are also published on the bus as `mesh.foreman.<event>` with `task_id` and
`node_id`.

The task's hyperagent telemetry row (`ha_telemetry.meta_notes` in `~/.openclaw/state.db`) carries
a one-line summary:
`Foreman[shadow] iterations=N interventions=N actions=CONTINUE:n,… assessor=llm:qwen3:8b failures=0 last(progress=… stuck=… ready=…)`.

## Configuration

| Variable | Default | Meaning |
|---|---:|---|
| `MESH_FOREMAN` | `1` | `0` disables supervision |
| `MESH_FOREMAN_ENFORCE` | unset (shadow) | `1` enforces; anything else records decisions without acting |
| `MESH_FOREMAN_STOP_CONFIRMATIONS` | `3` | consecutive warning assessments on an unchanged tree before a STOP |
| `MESH_FOREMAN_STOP_GRACE_MS` | `5000` | SIGTERM → SIGKILL grace when stopping a worker |
| `MESH_FOREMAN_MIN_INTERVAL_MS` | `5000` | debounce floor between assessments while output flows |
| `MESH_FOREMAN_PERIODIC_MS` | `30000` | assessment during quiet work (only while a worker runs) |
| `MESH_FOREMAN_ASSESS_TIMEOUT_MS` | `8000` | analysis-lane ceiling before passthrough |
| `MESH_FOREMAN_MODEL` | `LLM_MODEL` | assessor model (Ollama tag) |
| `MESH_FOREMAN_DIR` | `~/.openclaw/foreman` | timeline directory |
| `MESH_FOREMAN_MAX_INTERVENTIONS` | `20` | ceiling on actions other than CONTINUE taken while a worker runs |
| `MESH_FOREMAN_MAX_RETRIES` | `MESH_MAX_ATTEMPTS − 1` | retries after a stop (the agent's own attempt loop is the real budget) |
| `MESH_FOREMAN_MAX_WORKERS` | `2 × MESH_MAX_ATTEMPTS + 2` | worker records per task: one coding worker plus one verification record per attempt |
| `MESH_FOREMAN_GRACE_MS` | `30000` | post-steer grace |

Thresholds and observation bounds are fields of `DEFAULT_POLICY` / `DEFAULT_LIMITS` for embedders.

## Known limits

- The verifier's read-only check covers the task worktree. A provider running with broad
  permissions (`claude --permission-mode bypassPermissions`) could still write outside it.
- A provider that takes a prompt but cannot inspect the repository (a bare local model) passes the
  gate's mechanics while judging only the prompt; the gate cannot tell.
- `needs_human` ≥ 0.80 escalates on a single sample; hysteresis covers STOP only.
- `claude -p --output-format text` prints nothing until it finishes, so the assessor sees a
  silent worker; the tree snapshot is the progress signal for it.

These are tracked in `memory-plan/plans/foreman/OUT_OF_SCOPE.md`.

## Tests

`node --test test/foreman-*.test.mjs` — offline: every policy branch (including the fixes above
and STOP hysteresis), the strict assessment contract, git evidence and tree snapshots/restores in
real temporary repositories, the assessor against a stub analysis lane (llm / fallback / error /
rejected), the supervisor loop against fake streams and a **real spawned child process** (idle
loop quiet, idle decisions off the ceiling, a writing worker never stopped, an idle tree stopped
after three), enforcement against **real detached children** (SIGTERM, the SIGKILL fallback,
ESCALATE, shadow leaving the worker alone), the verdict contract, and
`test/foreman-verify-gate.test.mjs`: the agent's `foremanVerify` driven through its real `runLLM`
with a registered stub provider — PASS completes; FAIL, no verdict, a quoted PASS beside a FAIL,
and PASS-with-a-failed-exit do not; the verifier runs whatever the post-exit decision (or none);
a writing verifier is voided and reverted; ESCALATE releases; `shell` completes on its exit
code; shadow and off complete as before — and `superviseTask` closing the supervisor when the
attempt loop throws.
