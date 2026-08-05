Now I have everything needed to judge all findings against verified source. Let me produce both artifacts.

---

# mesh-agent.js — Startup and Steady-State Contract

## Overview

`mesh-agent.js` is the mesh <role> daemon. It connects to NATS, claims tasks from the mesh-task-daemon, runs an LLM subprocess in an isolated git worktree, evaluates the result against an optional metric, and reports completion or failure. The agent is LLM-agnostic: the provider, binary, and model are resolved per-task from environment and task payload.

## Startup

`main()` (line 1783) executes the following sequence:

1. **Resolve provider and model.** `resolveProvider()` and `resolveModel()` are called at startup to determine the default LLM backend and model (lines 1784–1785). The startup-resolved model is the default; individual tasks may specify a different model in their payload.
2. **Log all resolved configuration.** The agent logs 12 distinct configuration values (lines 1787–1798): Node ID, NATS URL, LLM provider name and binary, model, workspace path, max attempts, poll interval, run mode (`--once` / continuous and dry-run flag), heartbeat interval, rules directory, harness path, and worktree base.
3. **Connect to NATS** (lines 1801–1807). Options: 5 s connect timeout, `reconnect: true`, up to 10 reconnect attempts with 2 s wait between.
4. **Watch NATS status** (lines 1813–1818). Logs disconnect/reconnect events. On permanent connection closure (`nc.closed()`, line 1820), the process calls `process.exit(1)` — launchd interprets exit code 1 as a crash and schedules an immediate restart.
5. **Subscribe to alive probe** (`mesh.agent.<NODE_ID>.alive`, line 1826). See Subjects.
6. **Subscribe to collab recruit broadcasts** (`mesh.collab.*.recruit`, line 1844). See Subjects.
7. **Enter main poll loop** (line 1911). See Task Polling.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_NODE_ID` / `MESH_NODE_ID` | Sanitized hostname | Node identifier; first variable wins |
| `MESH_POLL_INTERVAL` | `15000` ms | Sleep duration between claim attempts when idle |
| `MESH_MAX_ATTEMPTS` | `3` | LLM attempt budget per solo task |
| `MESH_HEARTBEAT_INTERVAL` | `60000` ms | Interval between heartbeat publishes during LLM execution |
| `MESH_WORKTREE_BASE` | `~/.openclaw/worktrees` | Parent directory for per-task git worktrees |
| `MESH_WORKSPACE` | `~/.openclaw/workspace` | Git repository used as worktree source; must be a git repo |
| `OPENCLAW_RULES_DIR` | `~/.openclaw/rules` | Path to coding rule files injected into LLM prompts |
| `OPENCLAW_HARNESS_RULES` | `~/.openclaw/harness-rules.json` | Harness enforcement rules (secrets, scope) |
| `OPENCLAW_SOUL_ID` | — | Soul identity for agent persona |
| `MESH_MEMORY_INJECT_CHARS` | `4000` | Cap on memory text injected into prompts (0 = disabled) |
| `MEMORY_INJECT_PORT` | `7893` | Port of the loopback memory-inject server |

### CLI Flags

| Flag | Description |
|---|---|
| `--once` | Claim one task, execute it, then exit. If no task is available, exits immediately. Distinct from continuous mode: the agent runs exactly one iteration of the poll loop. |
| `--dry-run` | Claim a task and build the prompt but do not invoke the LLM. Useful for prompt inspection and configuration verification. |
| `--model <name>` | Override the default model for tasks that do not specify their own. |
| `--provider <name>` | Override the LLM provider (`claude`, `openai`, `shell`, etc.). |

## NATS Subjects

### `mesh.agent.<NODE_ID>.alive`

Request/response. Subscribed at startup (line 1826). Used by the daemon's stall detector.

**Request payload:**
```json
{ "task_id": "<string, optional>" }
```

**Response payload:**
```json
{ "alive": true | false, "task_id": "<string | null>" }
```

**Evaluation logic** (line 1831):

```
alive = (currentTaskId != null) && (task_id === currentTaskId || !task_id)
```

`alive` is `true` only when:
- the agent is running *the specific queried `task_id`*, OR
- no `task_id` was provided in the request (generic busy check).

A queried `task_id` that does not match the running task returns `alive: false` **even when the agent is busy** — this is a task-ID mismatch signal, not an idle signal. A stall detector should distinguish these cases.

**Error fallback** (line 1836): on JSON parse failure, responds with `{ alive: currentTaskId != null, task_id: currentTaskId }` — the simpler busy/idle signal without task-ID matching.

---

### Task Lifecycle Subjects

Tasks flow through the following subject sequence:

```
claim → start → attempt(s) → complete | fail | release
```

#### `mesh.tasks.claim`

Request/response. The agent publishes `{ node_id }` with a 60 s timeout (line 1921). The daemon responds with a task object or `null`. On `null`: in `--once` mode the agent exits; otherwise it sleeps `POLL_INTERVAL` and retries.

#### `mesh.tasks.start`

Publish. Emitted immediately after worktree isolation succeeds, before the LLM subprocess starts (solo: line 1542; collab member: line 1330).

**Solo payload:** `{ task_id, workspace_isolated: boolean }`

**Collab payload:** `{ task_id }`

#### `mesh.tasks.heartbeat`

Publish. Emitted every `MESH_HEARTBEAT_INTERVAL` ms during LLM execution (line 707).

**Payload:** `{ task_id, activity_state?, activity_timestamp? }`

`activity_state` is **provider-dependent** (lines 692–706):

- **Claude provider:** derived from Claude's JSONL session files via `getActivityState()`. Values reflect actual model activity state.
- **All other providers:** hardcoded `activity_state: 'active'`, `activity_timestamp: <now>`.

A daemon implementing stall detection on `activity_state` values should not expect rich state signals when the provider is not Claude.

#### `mesh.tasks.attempt`

Publish. Emitted after each LLM invocation regardless of outcome (lines 1587, 1624, 1646, 1691).

**Key fields:** `{ task_id, approach: string, result: string, keep: boolean }`

`keep: true` indicates the attempt produced work worth preserving. `keep: false` indicates the attempt was discarded and a retry will follow.

#### `mesh.tasks.complete`

Publish. Emitted on successful task completion (lines 1657, 1702).

**Key fields:**
```json
{
  "task_id": "...",
  "result": {
    "success": true,
    "summary": "...",
    "artifacts": [],
    "cost": null,
    "harness": { "violations": [], "warnings": [] },
    "sha": "<commit-sha | null>",
    "merged": true | false | null
  }
}
```

`sha` is the commit SHA after merge to main. `merged: false` indicates a merge conflict; the branch is retained for manual resolution.

---

#### Terminal Paths: `mesh.tasks.fail` vs. `mesh.tasks.release`

These are semantically distinct terminal subjects. Treating them as equivalent will cause mis-triage.

| Subject | Meaning | When fired |
|---|---|---|
| `mesh.tasks.fail` | Infrastructure/protocol error — a single attempt failed at the isolation or coordination layer. | Worktree creation failure (solo: line 1530; collab member: line 1306); collab session-not-found (line 1244); collab join failure (line 1272). |
| `mesh.tasks.release` | Attempt budget exhausted — automation tried `MAX_ATTEMPTS` times; human must triage. | All `MAX_ATTEMPTS` consumed (line 1749). Partial work is committed but not merged to main. |

The distinction (stated in the source at lines 1743–1744):
> "Released = automation tried everything, human must triage. Failed = a single attempt failed (used by daemon for budget/stall)."

`mesh.tasks.release` payload includes the full `attempts` array for post-mortem. On release, the worktree branch is retained (see Worktree Lifecycle).

---

### Collab Subjects (Summary)

Collab session coordination uses additional subjects: `mesh.collab.find`, `mesh.collab.join`, `mesh.collab.status`, `mesh.collab.reflect`, `mesh.collab.recruiting`, and per-round notifications on `mesh.collab.<sessionId>.node.<NODE_ID>.round`. The full collab round-trip protocol is outside the scope of this startup contract and warrants a separate reference document.

---

## Task Polling

The agent runs a `while (running)` loop (line 1911). On each iteration:

1. **Check recruiting sessions.** `checkRecruitingSessions()` is called first (line 1914). This is an **idle-only** safety net: if `currentTaskId` is set the function returns immediately without doing anything (line 1879 — `if (currentTaskId) return`). When idle, it polls `mesh.collab.recruiting` for active sessions whose push-broadcast (`mesh.collab.*.recruit`) the agent may have missed. The push subscription is the primary real-time delivery path; the poll is the missed-broadcast fallback.

2. **Claim a task** via `mesh.tasks.claim` (60 s timeout, line 1921). On `null` return: `--once` mode exits, otherwise sleeps `POLL_INTERVAL` before the next iteration. When a task is returned, the agent dispatches it **immediately with no wait** — there is no delay between task completion and the next claim attempt.

3. **Execute.** Dispatches to `executeCollabTask()` or `executeTask()` based on `task.collaboration`.

In `--once` mode, the loop breaks after the first iteration regardless of whether a task was claimed (line 1961).

## Worktree Isolation

Each task runs in an isolated git worktree created under `MESH_WORKTREE_BASE` (default `~/.openclaw/worktrees`). The repository at `MESH_WORKSPACE` must be a valid git repository.

### Branch Naming

| Task type | Branch name |
|---|---|
| Solo task | `mesh/<task_id>` |
| Collab member | `mesh/<task_id>-<node_id>` |

The <session> naming (line 1303) allows multiple nodes to work the same task simultaneously without branch collisions. Operators inspecting branches after a collab run must use the node-qualified form.

### Fail-Closed Behavior

Worktree creation is fail-closed. If `createWorktree()` returns `null`:

- Solo tasks publish `mesh.tasks.fail` and abort (lines 1528–1536).
- Collab members publish `mesh.tasks.fail` and withdraw before rounds begin (lines 1304–1312).

No shared-workspace fallback is permitted. Rationale: shared-tree artifacts from multiple concurrent agents would be context-contaminated and may pass automated review silently.

> **Source discrepancy:** The JSDoc at line 491 reads "On failure, returns null (falls back to shared workspace)." This comment is stale and contradicts current behavior. The authoritative statement is at lines 528–529: "Callers are fail-closed (D14 rerun): null means the task/member must fail or withdraw, never run in the shared tree." The JSDoc should be updated to: "On failure, returns null. Callers must treat null as a hard failure and publish to `mesh.tasks.fail`; no shared-workspace fallback is permitted."

### Worktree Lifecycle

| Phase | Behavior |
|---|---|
| **Creation** | `git worktree add -b <branch> <path> HEAD` executed in `WORKSPACE` (line 519). |
| **Stale cleanup on re-creation** | If the worktree path already exists (from a prior crash), `git worktree remove --force` is attempted first; on failure, falls back to `fs.rmSync`. The branch is also deleted (lines 503–515). This cleanup is silent — no published event. |
| **Normal cleanup** (`keep=false`) | Worktree directory removed; branch deleted (lines 635–640). Used on success and on `fail`. |
| **Keep-branch cleanup** (`keep=true`) | Worktree directory removed; **branch retained** for post-mortem inspection (line 1755, used on `release`; also used when merge conflict prevents clean merge). |

Operators debugging a released task will find the branch retained at `mesh/<task_id>` (solo) or `mesh/<task_id>-<node_id>` (collab). Normally completed tasks have their branches deleted.

## Shutdown

Two shutdown paths exist with different exit codes and launchd implications.

### Graceful Drain (SIGTERM / SIGINT)

```js
process.on('SIGINT',  () => { running = false; });  // line 1971
process.on('SIGTERM', () => { running = false; });  // line 1972
```

Setting `running = false` prevents the poll loop from claiming new tasks. **Any in-flight LLM subprocess runs to completion before the process exits.** After the loop drains, the agent calls `aliveSub.unsubscribe()` and `nc.drain()` (lines 1964–1965), then returns normally.

**Exit code: 0.** launchd does not restart on exit 0 (clean stop).

### Permanent NATS Disconnect

When the NATS connection closes permanently, `nc.closed()` resolves and the agent calls `process.exit(1)` (line 1822).

**Exit code: 1.** launchd interprets this as a crash and restarts the agent immediately if `KeepAlive` is set in the plist.

**Summary for plist authors:** set `KeepAlive: true` to survive NATS loss; use SIGTERM for intentional shutdown (exits 0, no restart).
