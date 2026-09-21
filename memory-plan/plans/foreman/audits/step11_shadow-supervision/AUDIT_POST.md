# AUDIT_POST — step 1.1 · Shadow-mode Foreman supervision over mesh workers

## §1 Promised vs landed

| §6 delta (AUDIT_PRE) | Landed | Evidence |
|---|---|---|
| `lib/foreman/{assessment,policy,steering,observation,assessor,supervisor,index}.mjs` | yes | `ls lib/foreman` → 7 files; `node --check` clean on each |
| `bin/mesh-agent.js`: helpers `createTaskSupervisor`/`closeSupervision`; `runLLM(prompt, task, worktreePath, supervisor)` attaches the child and reports exit; `executeTask` creates, reports attempts, records the metric, closes on every exit path | yes | `git diff --stat bin/mesh-agent.js` → +59/−7; greps in §2 |
| `test/foreman-{assessment,policy,observation,assessor,supervisor}.test.mjs` | yes | 47 tests, all green (§2) |
| `docs/foreman.md` | yes | 108 lines: watches / assesses / decides / modes / timeline / configuration |
| plan silo: ROADMAP (3 blocks) · INVENTORY (1.1 `[x]`, 1.2, 2.1, 2.2, 3.1, 3.2 with §11 contracts) · DECISIONS D1 · COMPONENT_REGISTRY (3 families, probed) · TICK_PROMPT bindings · VERSION `v1.1` | yes | `workspace-bin/plan-lint.sh foreman` → CONFORMANT, 0 FAIL |
| `CLAUDE.md` "Where we are" paragraph | yes | `grep -n "foreman plan, step 1.1" CLAUDE.md` |

## §2 Greppable deltas

- `grep -n "createTaskSupervisor\|closeSupervision" bin/mesh-agent.js` → definitions + 1 create (after `Started:`), 4 closes (dry-run, no-metric success, metric success, release).
- `grep -n "supervisor.attach\|supervisor.workerStarted\|supervisor.workerExited\|supervisor.recordVerification" bin/mesh-agent.js` → attach in `runLLM` after `spawn`; exit reported from both `close` and `error`; one `workerStarted` per attempt; the metric recorded as the verification signal.
- `node --test test/foreman-*.test.mjs` → `# tests 47 · # pass 47 · # fail 0`.
- `npm test` (root suite, this container, `OPENCLAW_NO_EMBED_MODEL=1`, no NATS so the mesh suites skip visibly): `# tests 2123 · # pass 2116 · # fail 0 · # skipped 7` (the 7 are the embedding suites' visible skips), exit 0 — re-run on the final tree before the closing commit.

## §3 Cross-refs still valid

- DECISIONS D1 ↔ `lib/foreman/policy.mjs` header (the three carried-in rules) ↔ `docs/foreman.md` "What it decides" — same precedence, same thresholds (0.80 / 0.65 / 0.75).
- Federation D16 (deterministic pipeline, no consensus) ↔ this plan's ROADMAP preamble.
- MASTER_PLAN §4.6 (no new daemon) ↔ supervisor runs inside `bin/mesh-agent.js`; no new service, no plist.

## §4 Findings

- [POSITIVE] The enforcement seam (`onIntervention` + `config.enforce`) is exercised by a test today even though nothing wires it — Block 2 starts from a proven contract, not a TODO.
- [POSITIVE] Passthrough on assessor failure is a tested property (`foreman.assessor_unavailable`, zero interventions), not a comment.
- [POSITIVE] The real-child test (`spawn(process.execPath, …)`) proves the loop against an actual process, not only fake streams.
- [NEGATIVE] `git diff` outside a repository returned its usage text through stderr into the observation on the first cut; fixed to read as empty (no evidence beats noise for the assessor). Caught by the observation test.
- [NEGATIVE] No test loads `bin/mesh-agent.js` itself — it requires a NATS bus and the task daemon (the CI job stands both up; this container does not). The wiring is verified by `node --check` and greps only. Carry-forward.
- [NEGATIVE] The local-model assessor is not exercised against a live Ollama anywhere in this step; only the analysis-lane contract is (stub client: llm / fallback / error / rejected). That is exactly step 1.2's job.

## §5 Phase-8 patches

None.

## §6 Carry-forwards (to step 1.2 and Block 2)

1. **Runtime evidence on the operator's node is owed** (MASTER_PLAN §5.2–5.4): deploy to `~/.openclaw/workspace`, `launchctl kickstart -k` the mesh agent, run one real task, read `~/.openclaw/foreman/<task_id>.jsonl` and the telemetry `meta_notes`. The container evidence in this step's commit trailer is the new code path running against a real child here, not there.
2. **Watch the assessor's first real rows for junk**: qwen3:8b is a thinking-family model, so JSON mode is off and the tolerant parser carries the load; if `foreman.assessor_unavailable … rejected` dominates, tune `buildAssessmentMessages` before Block 2.
3. **Block 2 mapping is decided, not built** (D1): STOP → kill the worker's process group (spawn with `detached: true` in `runLLM`), attempt record `stopped by foreman: <reason>` so `buildRetryPrompt` carries it; ESCALATE → `mesh.tasks.release`. Do not enforce before ≥5 real shadow timelines have been read.
4. An integration test that drives `executeTask` with a shell provider against the CI mesh stack would close the "no test loads mesh-agent" gap; it belongs with 2.1, which changes that path again.
