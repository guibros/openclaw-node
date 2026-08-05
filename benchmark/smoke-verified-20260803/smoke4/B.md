---

**mesh-agent.js startup and steady-state contract**

`bin/mesh-agent.js` is the OpenClaw mesh <role>. Below is what it does at startup and during its main loop, with citations to the key lines.

**Constants**

- `POLL_INTERVAL` — 15 000 ms (line 54). Overridable via `MESH_POLL_INTERVAL`.
- `HEARTBEAT_INTERVAL` — 60 000 ms (line 56). Overridable via `MESH_HEARTBEAT_INTERVAL`.
- `NODE_ID` — derived from `OPENCLAW_NODE_ID`, then `MESH_NODE_ID`, then `os.hostname()` (line 53).
- `WORKTREE_BASE` — `~/.openclaw/worktrees` (line 486).

**NATS connection**

On startup, the agent calls `connect(natsConnectOpts())` (line 1801) using the URL resolved by `lib/nats-resolve`. Connection timeout is 5 000 ms. If the connect fails, the process exits.

**Subjects subscribed at startup**

1. `mesh.agent.<NODE_ID>.alive` (line 1826) — alive-check requests from the daemon's stall detector. The agent responds with `{ alive, task_id }` indicating whether it is currently working on the queried task. `currentTaskId` (line 259) tracks this.

2. `mesh.collab.*.recruit` (line 1844) — wildcard subject for collab recruiting broadcasts. When a message arrives, the agent, if idle, fetches the task and calls `executeCollabTask`. This is the push-based recruiting path.

**Steady-state poll loop**

Every `POLL_INTERVAL` (15 s), the main `while (running)` loop (line 1911):
1. Calls `checkRecruitingSessions()` — a pull-based fallback that queries `mesh.collab.recruiting` for sessions the push broadcast may have missed.
2. If idle, requests a task claim from the daemon.
3. Dispatches to `executeCollabTask` or `executeSoloTask` depending on whether `task.collaboration` is set.

**Heartbeat during execution**

While an LLM subprocess runs, a `setInterval` fires every `HEARTBEAT_INTERVAL` (60 s) and publishes to `mesh.tasks.heartbeat` (line 707). On LLM process close or error, the interval is cleared (lines 724, 731).

**Worktree isolation**

Every task — solo or collab — gets its own git worktree under `WORKTREE_BASE` via `createWorktree(taskId)` (line 493). If worktree creation fails, the agent is fail-closed: it withdraws from the task rather than falling back to the shared workspace (lines 529–532, 1305–1310). After task completion, the worktree is committed, merged into main, and removed (`cleanupWorktree`).
