Now I have all the facts grounded in the actual code. Producing the artifact.

## mesh-agent.js: Startup and Steady-State Contract

`bin/mesh-agent.js` is the OpenClaw mesh <role> agent. It wraps any LLM CLI (Claude, OpenAI, or a raw shell) behind a deterministic Node.js outer loop: connect to NATS, claim a task, run the LLM, evaluate a metric, retry or report, repeat.

### Startup

The agent first logs its resolved configuration, then opens a NATS connection using options from `lib/nats-resolve` (line 51). The `connect` call (lines 1801–1807) sets `timeout: 5000 ms`, `reconnect: true`, `maxReconnectAttempts: 10`, and `reconnectTimeWait: 2000 ms`. If the connection is permanently closed after exhausting reconnect attempts, `nc.closed()` resolves and the process calls `process.exit(1)` (lines 1820–1822) so that launchd restarts it automatically.

Two subscriptions are opened immediately after connecting:

- **`mesh.agent.<NODE_ID>.alive`** (line 1826): handles alive-check probes from the daemon's stall detector. The agent responds with `{ alive, task_id }` indicating whether it is actively working on the task in question. `NODE_ID` is resolved in priority order: `OPENCLAW_NODE_ID` → `MESH_NODE_ID` → sanitized hostname (line 53).
- **`mesh.collab.*.recruit`** (line 1844): receives broadcast invitations to join collaborative multi-agent sessions. If `currentTaskId` is null (agent is idle) and node preferences allow it, the handler joins the session and calls `executeCollabTask`.

### Steady State

The main `while (running)` loop (line 1911) runs continuously. Each iteration begins by calling `checkRecruitingSessions()` (line 1914), which sends a `mesh.collab.recruiting` request (line 1881) to catch any recruit broadcasts that arrived while the agent was offline or busy. If the agent is idle after that check, it sends `mesh.tasks.claim` with `{ node_id: NODE_ID }` to the daemon (line 1921, 60-second timeout). When no task is returned, the loop sleeps for `POLL_INTERVAL` before retrying — default **15 000 ms** (`MESH_POLL_INTERVAL`, line 54).

While a task is executing, the agent fires a heartbeat to `mesh.tasks.heartbeat` on a `setInterval` (lines 693–714) at `HEARTBEAT_INTERVAL`, default **60 000 ms** (`MESH_HEARTBEAT_INTERVAL`, line 56). The payload includes the task ID and, for Claude providers, live activity state scraped from its JSONL output.

### Worktree Isolation

Every task — both solo and collaborative — is executed in an isolated git worktree. `createWorktree(taskId)` creates the directory at `~/.openclaw/worktrees/<task_id>` and branches off HEAD as `mesh/<task_id>` (lines 486–532). This is **fail-closed**: if `createWorktree` returns `null`, the agent immediately publishes `mesh.tasks.fail` with a clear reason and returns without executing anything (lines 1528–1536). There is no fallback to the shared workspace. Post-task, `commitAndMergeWorktree` is skipped when `MESH_NO_MERGE=1` is set (line 549), preserving isolation for benchmark runs.
