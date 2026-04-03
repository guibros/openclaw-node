# OpenClaw Logging Strategy & Inventory

**Generated:** 2026-04-03
**Scope:** Database, openclaw-node, openclaw-mesh, companion-bridge (mesh-bridge)

---

## 1. Architecture Overview

OpenClaw uses a **hybrid logging architecture** with three tiers:

| Tier | Transport | Persistence | Purpose |
|------|-----------|-------------|---------|
| **Console** | `console.log/error/warn` → stdout/stderr | Ephemeral (service manager) | Human-readable diagnostics |
| **Tracer** | NATS publish → `openclaw.trace.{nodeId}.{module}` | In-memory ring buffer (2000 events) + SQLite | Structured observability |
| **Activity Log** | SQLite `activity_log` table | Persistent | Audit trail for task/project operations |

**No external logging libraries.** Zero use of winston, pino, bunyan, debug, or log4js. All logging is native Node.js console + custom tracer.

---

## 2. Tracer System (`lib/tracer.js`)

The unified observability layer across all components.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `OPENCLAW_TRACE_MODE` | `smart` | `dev` = all ~500 points; `smart` = filtered |
| `OPENCLAW_NODE_ID` | `os.hostname()` | Node label for distributed traces |

### Smart Mode Filters (always logged)

- **Category:** `state_transition`, `error`, `cross_node`, `lifecycle`
- **Slow calls:** duration > 500ms
- **Tier 1** functions (explicitly marked critical)

### Event Schema

```
{
  id, timestamp, node_id, module, function, tier (1-3),
  category, args_summary (120 chars), result_summary (80 chars),
  duration_ms, error, meta
}
```

### Transport

- **NATS subject:** `openclaw.trace.{NODE_ID}.{module}` (fire-and-forget)
- **Ring buffer:** 2000 events FIFO, survives NATS outages
- **SQLite:** `observability_events` table (mission-control, 24h TTL cleanup on startup)

### Instrumentation Methods

- `tracer.wrap(fnName, fn, opts)` — sync
- `tracer.wrapAsync(fnName, fn, opts)` — async
- `tracer.wrapClass(instance, methods, opts)` — bulk class wrapping
- `tracer.emit(fnName, data)` — manual event

---

## 3. Database Layer

### Location: `mission-control/src/lib/db/`

**Direct logging: None.** The DB layer operates silently.

### Logging Tables (SQLite schema in `schema.ts`)

#### `activity_log`
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `event_type` | TEXT | Event category |
| `task_id` | TEXT | Optional task reference |
| `description` | TEXT | Human-readable description |
| `timestamp` | TEXT | Default `datetime('now')` |

Written by `lib/activity.ts` → `logActivity(eventType, description, taskId?)`.

#### `observability_events`
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `timestamp` | INTEGER | Milliseconds |
| `nodeId` | TEXT | Source node |
| `module` | TEXT | Component name |
| `fn` | TEXT | Function name |
| `tier` | INTEGER | 1-3 |
| `category` | TEXT | Event category |
| `argsSummary` | TEXT | Max 120 chars |
| `resultSummary` | TEXT | Max 80 chars |
| `durationMs` | INTEGER | Execution time |
| `error` | TEXT | Error message if any |
| `meta` | TEXT | JSON metadata |
| `createdAt` | TEXT | Default `datetime('now')` |

**Indexes:** `idx_obs_timestamp` (DESC), `idx_obs_module`, `idx_obs_node`, `idx_obs_category`

**Cleanup:** Events older than 24h deleted on startup (`db/index.ts`).

### NATS Connection Logging (`lib/nats.ts`)

| Level | Message |
|-------|---------|
| WARN | `[nats] connecting guard stale, resetting` |
| INFO | `[nats] connected to {url}` |
| INFO | `[nats] connection closed — will reconnect on next request` |
| ERROR | `[nats] connection failed: {message}` |
| ERROR | `[nats] KV bucket error: {message}` (3 variants) |

### API Route Trace Wrapping (`lib/tracer.ts`)

All mission-control routes use `withTrace(module, method, handler)` which:
- Captures request method/path, response status, duration, errors
- Inserts into `observability_events`
- Publishes to NATS `openclaw.trace.{NODE_ID}.mc`

---

## 4. OpenClaw-Node (mission-control API routes)

### Logging Pattern

Every API route follows the same pattern:
```
try { ... } catch (err) { console.error("METHOD /api/path error:", err); }
```

All routes additionally wrapped with `withTrace()` for structured observability.

### Complete API Route Error Log Inventory

#### Tasks
| Route | Log Message |
|-------|-------------|
| `GET /api/tasks` | `GET /api/tasks error:` |
| `POST /api/tasks` | `POST /api/tasks error:` |
| `DELETE /api/tasks/[id]` | `DELETE /api/tasks/[id] error:` |
| `PATCH /api/tasks/[id]` | `PATCH /api/tasks/[id] error:` |
| `GET /api/tasks/[id]/tree` | `GET /api/tasks/[id]/tree error:` |
| `POST /api/tasks/[id]/handoff` | `Failed to hand off task:` |

#### Memory
| Route | Log Message |
|-------|-------------|
| `POST /api/memory/flush` | `POST /api/memory/flush error:` |
| `GET /api/memory/flush` | `GET /api/memory/flush error:` |
| `GET /api/memory/graph` | `[memory/graph] GET error:` |
| `POST /api/memory/graph` | `[memory/graph] POST error:` |
| `GET /api/memory/search` | `GET /api/memory/search error:` |
| `GET /api/memory/wikilinks` | `GET /api/memory/wikilinks error:` |
| `GET /api/memory/list` | `GET /api/memory/list error:` |
| `GET /api/memory/doc` | `GET /api/memory/doc error:` |
| `POST /api/memory/sync` | `POST /api/memory/sync error:` |
| `GET /api/memory/items` | `GET /api/memory/items error:` |
| `POST /api/memory/items` | `POST /api/memory/items error:` |
| `GET /api/memory/retrieve` | `GET /api/memory/retrieve error:` |
| `GET /api/memory/categories` | `GET /api/memory/categories error:` |
| `POST /api/memory/categories` | `POST /api/memory/categories error:` |

#### Activity & Projects
| Route | Log Message |
|-------|-------------|
| `GET /api/activity` | `GET /api/activity error:` |
| `POST /api/activity` | `POST /api/activity error:` |
| `GET /api/projects` | `GET /api/projects error:` |
| `POST /api/projects` | `POST /api/projects error:` |

#### Analytics
| Route | Log Message |
|-------|-------------|
| `GET /api/critical-path` | `GET /api/critical-path error:` |
| `GET /api/burndown` | `GET /api/burndown error:` |
| `GET /api/dependencies` | `GET /api/dependencies error:` |
| `POST /api/dependencies` | `POST /api/dependencies error:` |
| `DELETE /api/dependencies` | `DELETE /api/dependencies error:` |

#### Observability
| Route | Log Message |
|-------|-------------|
| `GET /api/observability/events` | `[observability/events] error:` |
| `GET /api/observability/config` | `[observability/config] GET error:` |
| `PATCH /api/observability/config` | `[observability/config] PATCH error:` |
| `GET /api/observability/nodes` | `[observability/nodes] error:` |

#### Mesh API
| Route | Log Message |
|-------|-------------|
| `GET /api/mesh/nodes` | `[mesh/nodes] error:` |
| `GET /api/mesh/identity` | `[mesh/identity] error:` |

#### Other
| Route | Log Message |
|-------|-------------|
| `POST /api/scheduler/tick` | `POST /api/scheduler/tick error:` |
| `GET /api/scheduler/tick` | `GET /api/scheduler/tick error:` |
| `POST /api/screenshot` | `POST /api/screenshot error:` |
| `GET /api/screenshot` | `GET /api/screenshot error:` |
| `GET /api/settings/gateway` | `Failed to load gateway settings:` |
| `POST /api/settings/gateway` | `Failed to save gateway settings:` |
| `GET /api/workspace/read` | `GET /api/workspace/read error:` |
| `GET /api/workspace/files` | `GET /api/workspace/files error:` |
| `GET /api/souls` | `Failed to load souls:` |
| `POST /api/souls` | `Failed to register soul:` |
| `PATCH /api/souls` | `Failed to update soul:` |
| `DELETE /api/souls` | `Failed to delete soul:` |
| `POST /api/souls/[id]/propagate` | `Failed to propagate gene:` |

### Library-Level Logging

| File | Level | Message |
|------|-------|---------|
| `lib/scheduler.ts` | ERROR | `MC gateway notify failed:` |
| `lib/scheduler.ts` | ERROR | `Failed to write dispatch signal:` |
| `lib/gateway-notify.ts` | ERROR | `gateway-notify: no gateway token configured` |
| `lib/gateway-notify.ts` | ERROR | `gateway-notify error:` |
| `lib/speech/use-speech-pipeline.ts` | WARN | `[TTS] Requested "..." but served by "..."` |
| `lib/speech/use-speech-pipeline.ts` | ERROR | `Speech pipeline error:` |
| `lib/tts/index.ts` | WARN | `TTS provider "..." failed, trying "...":` |

---

## 5. OpenClaw-Mesh

### 5.1 mesh-agent.js (LLM Worker — 1610 lines)

**Log format:** `[ISO_TS] [mesh-agent:{NODE_ID}] {message}`

**Tracer-wrapped functions (28):** `executeTask`, `executeCollabTask`, `evaluateMetric`, `runLLM`, `createWorktree`, `commitAndMergeWorktree`, `cleanupWorktree`, `buildInitialPrompt`, `buildRetryPrompt`, `natsRequest`, `isAllowedMetric`, `buildCollabPrompt`, `buildCirclingPrompt`, `parseReflection`, etc.

#### Console Log Inventory (~70 calls)

**Startup:**
- Node ID, NATS URL, LLM provider, model, workspace, max attempts, poll interval, mode

**NATS Lifecycle:**
- Connected, status changes, disconnected (WARN), permanently closed (ERROR → exit)

**Task Execution Pipeline:**
| Phase | Level | What's Logged |
|-------|-------|---------------|
| Claim | INFO | `Claimed {taskId} "{title}"` |
| Execute | INFO | Task ID, title, budget, metric, max attempts |
| Worktree | INFO | Created path/branch; ERROR on failure (falls back to shared workspace) |
| LLM Spawn | INFO | Provider, binary, args preview, target dir |
| LLM Exit | INFO | Exit code |
| Cost | INFO | USD amount, input/output tokens |
| Attempt | INFO | `Attempt N/MAX with remaining budget` |
| Metric | INFO | Command, directory, pass/fail result |
| Commit | INFO | SHA, branch, message |
| Merge | INFO | Success; WARN on retry; ERROR on conflict |
| Worktree Cleanup | INFO | Path, branch keep/delete |
| Complete | INFO | Task ID, metric status, attempt count |
| Release | INFO | Task ID, reason |
| Budget | WARN | Exhausted before attempt |

**Harness Enforcement:**
| Level | What's Logged |
|-------|---------------|
| ERROR | `HARNESS BLOCKED: {violations}` + per-violation details (rule, message) |
| WARN | `HARNESS WARNINGS: {count}` + per-warning details |
| WARN | `Harness blocked commit (secrets), retrying` |

**LLM Errors:**
| Level | What's Logged |
|-------|---------------|
| WARN | Provider error, backoff duration before retry |
| ERROR | Fatal error (exit 1) |

**Collaboration:**
| Level | What's Logged |
|-------|---------------|
| INFO | Collab executing (task_id, title, mode) |
| INFO | No session_id, discovering via mesh.collab.find |
| INFO | Session not found, waiting 3s |
| ERROR | No session found, refusing solo fallback |
| ERROR | Collab join failed |
| INFO | Collab joined (session_id, node count) |
| WARN | Running in shared workspace (no isolation) |
| INFO | Collab heartbeat / session done / step started |
| WARN | Not our turn |
| INFO | Reflection submitted (vote, confidence, artifacts) |
| ERROR | Reflection submit failed |

**Reflection Parsing:**
| Level | What's Logged |
|-------|---------------|
| WARN | JSON found but invalid fields |
| WARN | JSON block found but invalid JSON |
| WARN | Using deprecated legacy format |
| ERROR | No JSON or legacy block found |

---

### 5.2 mesh-task-daemon.js (Task Orchestrator — 2196 lines)

**Log format:** `[ISO_TS] {message}` (no module prefix)

#### Console Log Inventory (~220 calls)

**Task Lifecycle:**
| Event | Level | Message Pattern |
|-------|-------|-----------------|
| Submit | INFO | `SUBMIT: {taskId} "{title}" budget={min}m metric={cmd}` |
| Claim | INFO | `CLAIMED: {taskId} by {agent}` |
| Start | INFO | `STARTED: {taskId}` |
| Complete | INFO | `COMPLETED: {taskId} in {elapsed}s ({attempts} attempts)` |
| Fail | ERROR | `FAILED: {taskId} reason={reason}` |
| Release | INFO | `RELEASED: {taskId} reason={reason}` |
| Cancel | INFO | `CANCELLED: {taskId}` |
| Approve | INFO | `APPROVED: {taskId}` |
| Reject | INFO | `REJECTED: {taskId} reason={reason}` |
| Escalate | INFO | `ESCALATED: {taskId} → new task` |
| Budget exceeded | ERROR | `BUDGET EXCEEDED: {taskId}` |
| Claim race | INFO | `Claim race detected` |
| Review pending | INFO | `Pending review: {taskId}` |

**Collaboration Management:**
| Event | Level | Message Pattern |
|-------|-------|-----------------|
| Create | INFO | `COLLAB CREATE: {sessionId} mode={mode} nodes={min}-{max}` |
| Join | INFO | `COLLAB JOIN: {nodeId} ({count} nodes)` |
| Leave | INFO | `COLLAB LEAVE: {nodeId} reason={reason}` |
| Round start | INFO | `COLLAB ROUND R{n}: {nodeCount} nodes` |
| Reflection | INFO | `COLLAB REFLECT: vote={v} confidence={c}` |
| Converge | INFO | `COLLAB CONVERGED after {n} rounds` |
| Max rounds | INFO | `Max rounds reached` |
| Abort | ERROR | `COLLAB ABORTED: insufficient nodes` |
| Sequential turn | INFO | `Sequential turn advanced` |

**Circling (Advanced Collab):**
| Event | Level | Message Pattern |
|-------|-------|-----------------|
| Step start | INFO | `CIRCLING STEP START` |
| Artifact stored | INFO | `CIRCLING ARTIFACT: {sizeKB}KB` |
| Parse failure | ERROR | `CIRCLING PARSE FAILURE` |
| No artifacts | WARN | `No artifacts in submission` |
| Gate waiting | INFO | `CIRCLING GATE: SR{n} waiting for approval` |
| Gate approved | INFO | `CIRCLING GATE APPROVED` |
| Gate rejected | INFO | `CIRCLING GATE REJECTED` |
| Completed | INFO | `CIRCLING COMPLETED: {subRounds} sub-rounds` |
| Escalation | INFO | `CIRCLING ESCALATION: blocked votes` |
| Timeout | ERROR | `Step timeout forcing advance` |
| Dead node | WARN | `Marked node as dead` |
| Sweep stale | ERROR | `Circling sweep error` |

**Plan Execution:**
| Event | Level | Message Pattern |
|-------|-------|-----------------|
| Create | INFO | `PLAN CREATE: {planId} ({subtasks} subtasks, {waves} waves)` |
| Approve | INFO | `PLAN APPROVED: {planId}` |
| Abort | INFO | `PLAN ABORTED: {planId}` |
| Wave dispatch | INFO | `PLAN WAVE: materializing subtasks` |
| Progress | INFO | `PLAN PROGRESS: {completed}/{total}` |
| Completed | INFO | `PLAN COMPLETED: {planId}` |
| Auto-role | INFO | `Auto-role assigned` |
| Subtask status | INFO | `Subtask status updated` |
| Dependency unblocked | INFO | `Dependency unblocked` |

**Stall Detection:**
| Event | Level | Message Pattern |
|-------|-------|-----------------|
| Suspected | WARN | `STALL SUSPECTED: no heartbeat for {min}m` |
| Cleared | INFO | `STALL CLEARED: agent alive` |
| Confirmed | INFO | `STALL CONFIRMED: agent unresponsive` |
| Dead in collab | INFO | `Marked dead in collab session` |
| Error | ERROR | `STALL ERROR: {message}` |

**Role Validation:**
| Level | Message |
|-------|---------|
| ERROR | `Role validation failed: {issues}` |
| INFO | `Role validation passed` |

---

### 5.3 mesh-health-publisher.js (Health Monitor)

**Log format:** Console with `[health-publisher]` prefix

| Level | Message |
|-------|---------|
| INFO | Startup: node ID, NATS URL, publish interval |
| INFO | NATS connected |
| INFO | KV bucket ready |
| INFO | Recovered after N failures |
| ERROR | Publish failed (with suppression after repeated failures) |
| ERROR | Backoff: skipping ticks |
| ERROR | Fatal error |

---

### 5.4 mesh-deploy-listener.js (Deploy Listener)

**Log format:** Console with timestamps

| Level | Message |
|-------|---------|
| INFO | Startup: Node ID, Repo, NATS URL |
| INFO | Deploy triggered (SHA, initiator) |
| INFO | Already deploying (SHA, initiator) |
| INFO | Running command |
| INFO | Success at SHA |
| ERROR | Deploy failed |
| INFO | Catching up (local vs latest SHA) |
| INFO | Up to date |
| WARN | NATS connect failed, retrying |
| INFO | Listening on `mesh.deploy.trigger` |
| INFO | Trigger not for us |
| INFO | Ready / Shutdown signal |
| ERROR | Fatal error |

---

### 5.5 mesh-collab.js (Collaboration State)

| Level | Message |
|-------|---------|
| ERROR | `[collab] audit append failed for {sessionId}/{event}` (rate-limited) |
| ERROR | `[collab] CRITICAL: session blob approaching 1MB KV limit` |
| WARN | `[collab] WARNING: session blob size warning` |
| ERROR | `[collab] storeArtifact FAILED` |

All methods tracer-wrapped via `wrapClass()` (tier 1, category: `state_transition`).

---

### 5.6 mesh-harness.js (Security Enforcement)

| Level | Message |
|-------|---------|
| ERROR | `[mesh-harness] Failed to load {rulesPath}` |
| ERROR | `[mesh-harness] Scope check error` |
| ERROR | `[mesh-harness] Pre-commit scan error` |

10 functions tracer-wrapped (tier 2, category: `compute`).

---

### 5.7 Other Mesh Libraries

| File | Level | Message |
|------|-------|---------|
| `mesh-registry.js` | ERROR | `[mesh-registry] heartbeat failed for {kvKey}` |
| `agent-activity.js` | WARN | `[agent-activity] Computed path not found, using fallback` |
| `rule-loader.js` | ERROR | `[rule-loader] Skipped {file}` |
| `role-loader.js` | ERROR | `[role-loader] Failed to load {candidate}` |

`mesh-plans.js`, `mesh-tasks.js` — no console logging, fully tracer-instrumented.

---

## 6. Companion-Bridge (`bin/mesh-bridge.js` — 882 lines)

**Log format:** `[ISO_TS] [mesh-bridge] {message}`

**Tracer-wrapped functions (12):** `findDispatchable`, `dispatchTask`, `reconcile`, `handleEvent`, `handleCompleted`, `handleFailed`, `handleCancelled`, `handleCollabEvent`, `handlePlanEvent`, `materializeSubtask`, `checkStaleness`, `writeLog`

#### Console Log Inventory (~72 calls)

**Startup:**
- NATS URL, active-tasks path, log dir, dispatch interval, mode

**NATS Lifecycle:**
- Connected, status changes, reconnected → reconciliation, permanently closed → exit

**Reconciliation (on startup + NATS reconnect):**
| Level | Message |
|-------|---------|
| INFO | No orphaned tasks / found N orphaned tasks |
| INFO | Task already completed/failed/released/cancelled → processing |
| WARN | Task submitted but not in daemon → marking blocked |
| INFO | Task still in progress → resuming tracking |
| ERROR | Error checking task |
| INFO | Reconciliation done, tracking count |

**Task Dispatch:**
| Level | Message |
|-------|---------|
| INFO | `DISPATCHING: {taskId} "{title}"` |
| INFO | `[DRY RUN] Would submit` |
| INFO | `SUBMITTED: {taskId} to mesh (budget: {min}m)` |
| INFO | `UPDATED: {taskId} → submitted` |
| ERROR | `DISPATCH ERROR ({count}/{max})` |
| ERROR | `BLOCKING: {taskId} after {max} submit failures` |

**Event Handling:**
| Level | Message |
|-------|---------|
| INFO | `CLAIMED: {taskId} by {agent}` |
| INFO | `KANBAN: {taskId} → running` |
| INFO | `COMPLETED: {taskId} in {elapsed}s` |
| INFO | `KANBAN: {taskId} → waiting-user` |
| INFO | `{REASON}: {taskId} after {attempts} attempts` |
| INFO | `KANBAN: {taskId} → blocked` |
| INFO | `CANCELLED: {taskId}` |
| INFO | `EVENT IGNORED: not in dispatched set` |
| ERROR | `ERROR handling event` |

**Collaboration Events:**
| Level | Message |
|-------|---------|
| INFO | `COLLAB CREATED/JOINED/ROUND/REFLECT/CONVERGED/COMPLETED/ABORTED` |
| INFO | `CIRCLING AUTO-TRACK/STEP/GATE` |

**Plan Events:**
| Level | Message |
|-------|---------|
| INFO | `PLAN CREATED/APPROVED/WAVE/PROGRESS/COMPLETED/ABORTED` |
| INFO | `MATERIALIZED: subtask → kanban` |
| WARN | `SKIP: subtask already in kanban` |
| ERROR | `ERROR materializing subtask` |

**Anomaly Detection:**
| Level | Message |
|-------|---------|
| WARN | `STALE WARNING: no heartbeat for {min}m` |
| INFO | `FIELD-STRIP DETECTED: lost execution:mesh fields` |
| INFO | `WAKE: received wake signal` |

---

## 7. Workspace Daemons (`workspace-bin/`)

### memory-daemon.mjs
| Level | Message |
|-------|---------|
| INFO | Verbose mode logging (conditional) |
| ERROR | `Fatal: {message}` |

### daily-log-writer.mjs
| Level | Message |
|-------|---------|
| INFO | Verbose logging, dry run output |
| INFO | `Done.` |

### obsidian-sync.mjs
| Level | Message |
|-------|---------|
| INFO | Verbose sync operations (conditional) |

### mesh-bridge.mjs (Memory Bridge)
Publishes memory lifecycle events to NATS:
- `openclaw.memory.{nodeId}.session.start/active/idle/end`
- `openclaw.memory.{nodeId}.maintenance`
- Remote events logged to `~/.openclaw/workspace/memory/mesh-events.jsonl`

---

## 8. Log Storage Locations

| Location | Format | Retention | Content |
|----------|--------|-----------|---------|
| stdout/stderr | Plain text | Ephemeral (launchd) | Console logs |
| SQLite `activity_log` | Rows | Permanent | Task/project audit trail |
| SQLite `observability_events` | Rows | 24 hours (auto-cleanup) | Structured traces |
| NATS `openclaw.trace.*` | Messages | JetStream config | Distributed traces |
| In-memory ring buffer | Objects | Process lifetime (2000 max) | Recent traces |
| `~/.openclaw/workspace/memory/mesh-logs/{taskId}.md` | Markdown | Permanent | Per-task execution logs |
| `~/.openclaw/workspace/memory/mesh-events.jsonl` | JSONL | Permanent | Cross-node memory events |

---

## 9. Log Level Summary

| Level | Usage Count (approx) | Purpose |
|-------|---------------------|---------|
| **INFO** (`console.log`) | ~450 | State transitions, startup, normal flow, user-facing CLI output |
| **ERROR** (`console.error`) | ~100 | Failures, exceptions, fatal errors, harness blocks |
| **WARN** (`console.warn`) | ~30 | Degraded states, fallbacks, deprecation notices, stale warnings |
| **DEBUG** | 0 | Not used anywhere |

---

## 10. Log Format Patterns

```
# Mesh daemons (agent, bridge, task-daemon)
[2026-04-03T12:34:56.789Z] [mesh-agent:node-1] CLAIMED: task-123 "Fix bug"

# Libraries
[collab] audit append failed for session-456/reflect: timeout

# API routes
GET /api/tasks error: Error: connection refused

# Tracer events (NATS payload)
{ id: "uuid", timestamp: 1712160896789, node_id: "node-1", module: "mesh-agent",
  function: "executeTask", tier: 1, category: "state_transition", duration_ms: 5432 }

# CLI tools (colored)
[OK] Deployed mesh-agent
[FAIL] Health check failed
[WARN] Node unreachable
```

---

## 11. Gaps & Observations

1. **No DEBUG level** — zero `console.debug` usage anywhere; dev-mode tracing partially fills this role
2. **No structured console logging** — all console output is unstructured strings (no JSON logs to stdout)
3. **No log rotation** — relies on launchd/systemd or external tooling; SQLite events auto-cleaned at 24h
4. **Inconsistent prefixes** — `mesh-task-daemon` omits module prefix in log format unlike other daemons
5. **Error-only API logging** — API routes only log errors, not request/response info (tracer fills this gap)
6. **No request IDs** — console logs don't carry correlation/request IDs (tracer events do via `id` field)
7. **Silent failures** — tracer `insertEvent` and `publishEvent` silently swallow errors
8. **Rate-limited audit logging** — `mesh-collab` suppresses repeated audit-append failures after a limit
