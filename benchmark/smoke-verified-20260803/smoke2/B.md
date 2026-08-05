mesh-agent startup contract
===========================

bin/mesh-agent.js (openclaw-nodedev) — startup and steady-state behavior

NATS CONNECTION
On startup the agent calls `connect()` with a 5 s connection timeout, reconnect
enabled, up to 10 reconnect attempts spaced 2 s apart (lines 1756–1762). The
broker URL is resolved from `lib/nats-resolve`. If the connection is permanently
closed, the process exits with code 1 so launchd can restart it (line 1776).

NODE IDENTITY
`NODE_ID` is taken from `OPENCLAW_NODE_ID`, then `MESH_NODE_ID`, then
`os.hostname()` lowercased and stripped to `[a-z0-9-]` (line 53).

SUBJECTS SUBSCRIBED AT STARTUP

1. `mesh.agent.<NODE_ID>.alive` (line 1781) — the daemon's stall detector sends
   alive-check requests here; the agent responds with whether it is currently
   working on the queried task_id.

2. `mesh.collab.*.recruit` (line 1799) — wildcard subscription for collab
   session broadcast invitations. When a message arrives and the agent is idle,
   it fetches the task and calls `executeCollabTask`.

TASK POLLING
The main loop sends a `mesh.tasks.claim` request (60 s timeout, line 1876) on
each iteration. Between claim attempts the agent sleeps `POLL_INTERVAL` ms,
defaulting to 15 000 ms (15 s, line 54). The loop also calls
`checkRecruitingSessions()` before each claim attempt to catch any recruiting
collab sessions that arrived while the agent was busy.

HEARTBEAT CADENCE
While an LLM is running, a `setInterval` fires every `HEARTBEAT_INTERVAL` ms
(default 60 000 ms / 60 s, line 56) and publishes a `mesh.tasks.heartbeat`
request (line 691) carrying the task_id and, for the Claude provider, an
activity state derived from the session's JSONL file.

WORKTREE ISOLATION RULE
Every task — solo or collab — must execute in a dedicated git worktree located
under `MESH_WORKTREE_BASE` (default `~/.openclaw/worktrees`, line 483). Each
worktree gets its own branch `mesh/<taskId>` branched off HEAD (line 495). If
`createWorktree()` returns null the agent publishes `mesh.tasks.fail` and
returns immediately; there is no shared-workspace fallback (lines 1482–1491,
1287–1297). On success the branch is committed and merged; on release the branch
is kept for post-mortem; on abort it is discarded.
