# AUDIT_PRE — step 1.2 · First live shadow timeline on the operator's node

Run on 2026-09-27 (times below are UTC as the logs print them; EDT = UTC−4). The step ran and its
Verify was executed as written: two of three checks pass, the third fails, so the row stays open
(`[A]`). Nothing here closes the step.

## §0 Re-orient

- **Where:** foreman plan, Block 1, step 1.2 — the first open row; `VERSION` v1.1.
- **Last change:** PR #32 (D3: shadow by default, the no-metric gate, the review must-fixes), deployed
  for this run.
- **What this step contributes:** the first supervision evidence from real hardware, which is
  Block 2's go/no-go input.
- **Still the right next step?** Yes. What blocks it is below.

## §1 Deploy (operator-approved in session, coordinated with the three sessions that owned the live checkout)

- **Live checkout** `/Users/moltymac/openclaw-nodedev`:
  - moved from `node-deploy/2026-09-26-d9` (0d1ca19) to `node-deploy/2026-09-27-foreman` (973e81e);
  - 973e81e is d9's tip + origin/main c64ff34 + PR #32 5e10330;
  - it is a local branch, as d9 was.
- **Tests:** the sandboxed full suite on 973e81e (isolated HOME/TMPDIR, dead bus) gave 2306 pass,
  0 fail, 6 skipped.
- **Post-switch checks:**
  - the knowledge MCP server reports `✓ Connected`;
  - `lib/foreman/` is on the runtime path (`~/.openclaw/workspace/lib` → the checkout).
- **`ai.openclaw.mesh-agent` unit**, `~/Library/LaunchAgents/ai.openclaw.mesh-agent.plist`, edited in
  place and reloaded:
  - `MESH_WORKSPACE` now points to `~/.openclaw/mesh-workspace`, a new git repo created with initial
    commit d440f76. `~/.openclaw/workspace` is not a git repository, so the agent's fail-closed
    isolation refused every task before a supervisor existed.
  - `LLM_MODEL=qwen3:8b`.
  - `MESH_FOREMAN_ASSESS_TIMEOUT_MS=90000`.
  - `MESH_FOREMAN_ENFORCE` is unset, so the agent runs in shadow.
- **`~/.openclaw/openclaw.env`:** both `LLM_MODEL=qwen3:14b` lines now read `qwen3:8b`.
- **Ollama:**
  - `qwen3:14b` was pulled, measured and removed. It runs at about 11.7 s per token on this 19 GiB
    VM (a two-token reply took 45 s), and 8.6 of 10 GB of swap was in use right after it loaded.
  - `qwen3:8b` handles one real assessment in 1.1 s of prompt time (461 tokens) plus 20.2 s of
    generation (114 tokens). The 8 s default ceiling could never be met here, so it is 90 s now.
- The operator made each of these choices in session. The first choice, 14b, was reversed on the
  measurements above.

## §2 Run

- **Task** `foreman-step12-20260927`:
  - claude / sonnet, no metric, a 10-minute budget, scope `NOTES.md`;
  - submitted 15:00:16 through `mesh.tasks.submit`, claimed 15:00:19;
  - the `mesh submit` CLI could not be used (§5.4).
- **Every attempt failed before any work:**
  - the worker's claude CLI got `401 authentication_error: OAuth access token has expired.
    Re-authenticate to continue.`;
  - it retried for about 3½ minutes, then exited 1 with an empty stderr;
  - this happened on attempts 1, 2 and 3.
- **The budget ran out mid-attempt:**
  - the daemon's budget enforcement failed the task at 15:10:42 (the deadline was 15:10:19) while
    attempt 3 was still running;
  - the agent's `mesh.tasks.attempt` call then got `Task … not found`, and the attempt loop threw.
- **Error path:**
  - `superviseTask` closed the supervisor (`foreman.closed`, outcome `error`). That is the first
    runtime evidence of D3's leak fix;
  - the main loop then wrote the telemetry row.
- **After the run:** the agent was stopped (it was not running before), and the probe's worktree
  and branch were removed.

## §3 Verify (INVENTORY 1.2, executed as written)

| Check | Result |
|---|---|
| `ls ~/.openclaw/foreman/*.jsonl` non-empty | **PASS** — `foreman-step12-20260927.jsonl`, 10,123 B |
| `grep -c '"type":"foreman.assessed"'` ≥ 1 with `"assessor":"llm:` in the row | **PASS** — 8 rows, all `llm:qwen3:8b` |
| `select meta_notes from ha_telemetry where task_id = 'foreman-step12-20260927'` contains `Foreman[shadow]` | **FAIL** — the row reads `Unhandled worker error: Task foreman-step12-20260927 not found`; the error path does not carry the Foreman summary line |

## §4 What the timeline shows (calibration input)

- **Counts:** 10 iterations, 8 assessments and 2 assessor timeouts. The timeouts hit the 90 s
  ceiling at 15:10:32 and 15:12:33 and became passthroughs.
- **Latency:** assessments took 26.3, 22.3, 25.6, 28.3, 40.7, 42.1, 44.9 and 62.8 s. They got slower
  as the observation grew (Known limits: the prompt is not bounded as a whole).
- **Scores:** all eight assessments were identical, `meaningful_progress` 0.9 and `worker_stuck` 0.
  The worker they described printed nothing and changed nothing for eleven minutes while failing
  authentication.
- **Decisions:** every decision was CONTINUE (shadow).
- **Reading:** the 8b assessor with this prompt did not discriminate on this task, and STOP
  hysteresis would not have fired either (stuck never reached 0.8). This is evidence for keeping
  enforcement off until Block 3.

## §5 Findings → operator

1. **Blocker — the node's claude CLI login.** Its OAuth access token has expired. Re-authenticating
   is the operator's move (interactive `claude`, then `/login`); until then no claude task can run
   on this node.
2. **Code gap (D3 area) — fixed in code the same day.** On the error path `superviseTask` closed
   the supervisor, but the Foreman summary line never reached the `Unhandled worker error`
   telemetry row the main loop writes, so only a task that completed or was released normally
   could satisfy 1.2's Verify. `superviseTask` now hands the line out as `err.foremanNote` and
   the main loop appends it (PR #32, covered by `test/foreman-verify-gate.test.mjs`).
3. **Daemon/agent race (pre-existing, not Foreman code).** When budget enforcement fails a task
   under a running agent, the agent's next attempt or release call gets `not found` and the rest of
   its bookkeeping is skipped: worktree cleanup, the agent-state reset, the normal telemetry write.
4. **`bin/mesh.js submit` cannot run on the node.** It requires the `yaml` package, which is not a
   dependency; the repository depends on `js-yaml`.
5. **`~/.openclaw/openclaw.env` is mode 644.** It holds the NATS token. The installer's
   `scripts/install/config.sh` sets it to 600, and the node's other secret files are 600. This
   predates the run: `sed -i` preserves the mode.
6. **Other sessions share this Ollama.** Their pre-compaction extraction hooks queue on the same
   server, so assessments can wait behind them.

## §6 Carry-forwards

- **Re-run 1.2** once finding 1 is resolved.
  - Give the task a budget that absorbs 20–60 s assessments (15 minutes, say).
  - Expect a normal completion, or a release, whose telemetry row carries `Foreman[shadow]`.
  - Alternatively, close finding 2 first; then an error-path task also satisfies the Verify.
- **Roll back the checkout:**
  `git -C /Users/moltymac/openclaw-nodedev checkout node-deploy/2026-09-26-d9`.
- **Roll back the unit:**
  - set `MESH_WORKSPACE` to `~/.openclaw/workspace` and drop `MESH_FOREMAN_ASSESS_TIMEOUT_MS` in the
    plist;
  - then run `launchctl bootout` and `launchctl bootstrap`.
  - `LLM_MODEL` stays `qwen3:8b`: 14b is gone and unusable here.
