# Step 1.3 — AUDIT_PRE

## 0 — Micro Re-Orient

Bridge 1.2 closes with Claude source/runtime approval and actual managed exit/restart evidence. Worker 1.3 is the next idle stop repair; recovery still requires all repaired clients before preservation. This is the existing worker, not a second worker or a provider redesign.

## 1 — Intent and evidence

2026-09-28 11:21 EDT owned Mac run: fresh authenticated NATS, actual empty task daemon, isolated HOME/workspace Git repo, unique identity and explicit provider. Empty actual claim reply and alive=false/task_id=null precede SIGTERM. Unmodified worker exits 1 through permanent-close callback, without Agent worker stopped. Live original unit PID 93953, Node /usr/local/bin/node, cwd unset; e57 has the same unconditional closed callback.

## 2 — Needs pre-screen

1.2 closed; actual main/source and live unit verified. Owned NATS 2.12.6/task daemon available. D2/D3/D4/D7/D8 and operator authorization apply. Idle worker does not require a Mission Control HTTP fixture; no task reaches the memory recall/provider execution path. Runtime e57 drift must remain separate from this patch.

## 3 — Design

Main-local draining flag immediately before existing await nc.drain, suppress only error-free intentional close, require nc.isClosed before logging completion. Preserve signal handlers/polling/current-task semantics and all subscriptions. Tests observe all four worker subscriptions on one connection, a real daemon claim yielding no task, and an actual idle alive reply. Every child gets minimal private HOME/TMPDIR/Git/worktree paths and an owned authenticated random-port bus. No live ports or inherited credentials/configuration.

## 4 — Risks

| Risk | Mitigation |
|---|---|
| Stop request masks loss before drain | Long-poll negative control; ownership starts at drain boundary only. |
| Request-subscription false drain completion | Default/late outage controls and both weakened mutants. |
| Worker claims work while being stopped | Real empty owned daemon; fresh live queued/claim/child/kanban proof and actual alive reply. No task/provider execution in fixture. |
| Natural stop exceeds supervisor grace | Observe process exit; default 15s poll control; bounded supervisor, any forced kill fails acceptance. In-flight 60s claim/task remains outside idle contract. |
| Staged release erases drift | e57 archive plus worker-only lifecycle diff; compare other tracked bytes; preserve original unit values/dependencies/cwd. |

## 5 — Acceptance

Execute INVENTORY 1.3 with eight real controls locally and full isolated CI. Reject unmodified connected stop and both weakened error/actual-close conditions. Claude independently challenges immutable source and staged bytes. Live managed SIGTERM must emit exactly one completion and exit 0, then replacement answers idle alive without a claim; task-state and unrelated-owner comparisons hold. Record entry/dependency versions for preservation revalidation.

## 6 — File deltas

bin/mesh-agent.js lifecycle conditions; test/mesh-agent-lifecycle.test.mjs owned controls; silo audit/evidence/carriers. Private e57 worker-only release and existing unit entry are the only intended runtime changes.
