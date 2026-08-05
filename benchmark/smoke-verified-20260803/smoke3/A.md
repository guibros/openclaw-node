---

**mesh-agent startup and steady-state contract**

`bin/mesh-agent.js` is a Node.js mesh <role>. Below is what it does at startup and in its main loop, grounded in the source.

**Startup**

On launch the agent resolves its identity: `NODE_ID` defaults to `os.hostname()` lowercased (line 53). It then opens a NATS connection with a 5-second connect timeout, up to 10 reconnect attempts spaced 2 seconds apart (lines 1800-1806). If the NATS connection permanently closes, the process exits with code 1 so launchd can restart it (lines 1820-1823).

After connecting it registers two subscriptions before entering the work loop.

**Subscriptions**

1. `mesh.agent.<NODE_ID>.alive` (line 1826) — the daemon's stall detector sends requests here. The agent responds with `{ alive, task_id }` indicating whether it is actively running a specific task. `alive` is `true` only when `currentTaskId` is non-null and matches the queried task (lines 1831-1832).

2. `mesh.collab.*.recruit` (line 1844) — a wildcard subscription for collab session broadcasts. When a recruit message arrives and the agent is idle, it fetches the task, checks `preferred_nodes`/`exclude_nodes` filters, and joins the collaboration session (lines 1848-1867).

**Poll interval and main loop**

Constants at the top of the file set the rhythm:
- `POLL_INTERVAL = 15 000 ms` (line 54, env `MESH_POLL_INTERVAL`)
- `HEARTBEAT_INTERVAL = 60 000 ms` (line 56, env `MESH_HEARTBEAT_INTERVAL`)
- `MAX_ATTEMPTS = 3` (line 55, env `MESH_MAX_ATTEMPTS`)

In steady state the loop calls `mesh.tasks.claim` to pull one task at a time (line 1921). If no task is available it sleeps for `POLL_INTERVAL` (15 s) and retries (line 1929). While a task runs, a `setInterval` fires every `HEARTBEAT_INTERVAL` (60 s) publishing to `mesh.tasks.heartbeat` (line 707), carrying the agent's activity state so the daemon knows it has not stalled.

**Worktree isolation**

Every task gets its own git worktree (line 493). `createWorktree` runs `git worktree add -b mesh/<taskId> <path> HEAD` inside `WORKSPACE` (lines 519-523). The LLM subprocess is given only the worktree path as its working directory; it never sees the parent checkout (line 668, comment on line 665-667). If worktree creation fails the function returns `null` and the task is failed or withdrawn — there is no fallback to the shared workspace (line 529, callers at lines 1305-1309). After completion the worktree is committed, merged (or kept on conflict), and removed (lines 544-646).
