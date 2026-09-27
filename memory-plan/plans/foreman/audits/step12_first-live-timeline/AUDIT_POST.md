# AUDIT_POST — step 1.2 · First live shadow timeline on the operator's node

Closed 2026-09-27 on the re-run below (times UTC). The first run and the node setup it needed
are recorded in `AUDIT_PRE.md`.

## §1 Promised vs landed

| Verify (INVENTORY 1.2, executed as written) | Landed | Evidence |
|---|---|---|
| `ls ~/.openclaw/foreman/*.jsonl` non-empty | yes | `foreman-step12-20260927-r2.jsonl` (3,151 B), and the first run's `foreman-step12-20260927.jsonl` (10,123 B) |
| `grep -c '"type":"foreman.assessed"'` ≥ 1 with `"assessor":"llm:` in the row | yes | 2 rows, both `"assessor":"llm:qwen3:8b"` (30.0 s and 31.8 s) |
| `select meta_notes from ha_telemetry where task_id = '<that task>'` contains `Foreman[shadow]` | yes | row 60, outcome `success`: `Completed without a configured metric. Done. The line has been appended to \`NOTES.md\`. Foreman[shadow] iterations=2 interventions=0 actions=CONTINUE:1,START_WORKER:1 assessor=llm:qwen3:8b failures=0 last(progress=0.9 stuck=0 ready=0.9)` |

## §2 The run

- **Preconditions:**
  - the worker's claude CLI was re-authenticated by the operator (the keychain credential was
    rewritten at 18:16:16Z);
  - an agent-environment call answered in 5 s;
  - the live checkout was `node-deploy/2026-09-27-foreman` @ e57f89b, which adds PR #32's
    error-path telemetry fix (8a60399);
  - the queue was empty and `qwen3:8b` was warm.
- **Task** `foreman-step12-20260927-r2`: claude / sonnet, no metric, a 15-minute budget, scope
  `NOTES.md`.
  - submitted 18:17:29 and claimed 18:17:39;
  - `FOREMAN …: supervising in shadow mode (assessor llm:qwen3:8b, …)` at 18:17:39.
- **Worker:** exited 0 at 18:18:31 ($0.33) and committed 88480da on `mesh/foreman-step12-20260927-r2`
  (`NOTES.md`, +1 line).
- **Completion:**
  - the daemon took the task to `pending_review`, and the branch was kept unmerged;
  - #31's lease was stored at `~/.openclaw/mesh-leases/<sha256>` (0600);
  - Foreman closed with outcome `success`; `COMPLETED …(no metric, attempt 1)` at 18:19:04.
- **After the run:** the agent was stopped again (its resting state on this node). The task awaits
  the operator's review decision.

## §3 Cross-references

- The 1.2 row, the contract and the ROADMAP Block 1 exit criterion still describe what ran. That
  criterion is a timeline with ≥ 1 local-model `foreman.assessed` row plus a `foreman.closed`
  summary, and the telemetry note: met, so **Block 1 is complete** (1.1 and 1.2 `[x]`).
- `docs/foreman.md` Configuration and Known limits match the node. The node overrides the
  assessor ceiling to 90 s (AUDIT_PRE §1).

## §4 Findings

- [POSITIVE] Every supervision surface works end to end on real hardware: the timeline, local-model
  assessments, shadow decisions, the bus events and the telemetry note. The error-path fix
  (8a60399) is deployed, but this run exercised the normal path.
- [NEGATIVE] **The assessor does not discriminate yet.** Both assessments here were identical
  (implementation 0.9, requirements 0.9, ready 0.9, `tests_sufficient` 0, `needs_verification` 0),
  as were all eight in the first run. Those eight scored a worker that did nothing for eleven
  minutes at progress 0.9 and stuck 0.
- [NEGATIVE] **The finish gate misfires on tasks with no tests.** The task said not to run tests.
  The assessor scored `tests_sufficient` 0, so FINISH (which needs ≥ 0.75) could not fire, and the
  shadow decision after a clean, correct completion was `START_WORKER — meaningful implementation
  work remains`. Under enforcement this stays advisory: completion is the agent's. Calibration
  (Block 3) should still count it as a false negative.
- [NEGATIVE] **Assessments cost 20–60 s** of `qwen3:8b` on this VM, against the design's 8 s ceiling.
- [NEGATIVE] **Not Foreman: the harness post-commit check never runs.** `git-conventional-commits`
  in `~/.openclaw/harness-rules.json` is blocked on every task by the shell-chaining filter, because
  its command pipes `git log` into `grep`.

## §5 Phase 8 patches

None.

## §6 Carry-forwards

1. **Block 2 go/no-go.** Shadow decisions on real work are not yet sane (§4), so keep
   `MESH_FOREMAN_ENFORCE` unset. The 2.1/2.2 runtime Verify can still run on purpose-built tasks,
   but enabling enforcement for real work should wait for Block 3 calibration.
2. **Block 3 inputs:** these two timelines; the tests-less FINISH false negative; the
   assessment-latency distribution; the identical-score pattern.
3. **Pending operator action:** approve or reject `foreman-step12-20260927-r2`. With the agent
   stopped, an approval merges through `reconcileKeptBranches` on its next start (#31's path).
