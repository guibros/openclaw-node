# OpenClaw Logging Audit — Missing Logging

**Generated:** 2026-04-03
**Scope:** Full infrastructure — every moving piece

**Total gaps found: ~650+** across all components.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Systemic Patterns](#2-systemic-patterns)
3. [mesh-agent.js (~95 gaps)](#3-mesh-agentjs)
4. [mesh-task-daemon.js (~80 gaps)](#4-mesh-task-daemonjs)
5. [mesh-bridge.js (~30 gaps)](#5-mesh-bridgejs)
6. [mesh-collab.js (~29 gaps)](#6-mesh-collabjs)
7. [mesh-plans.js (~16 gaps)](#7-mesh-plansjs)
8. [mesh-tasks.js (~21 gaps)](#8-mesh-tasksjs)
9. [mesh-harness.js (~31 gaps)](#9-mesh-harnessjs)
10. [mesh-registry.js (~13 gaps)](#10-mesh-registryjs)
11. [rule-loader.js (~10 gaps)](#11-rule-loaderjs)
12. [role-loader.js (~13 gaps)](#12-role-loaderjs)
13. [agent-activity.js (~20 gaps)](#13-agent-activityjs)
14. [Tracer & NATS Infrastructure (~60 gaps)](#14-tracer--nats-infrastructure)
15. [API Routes (~350 gaps)](#15-api-routes)
16. [Database Layer (~21 gaps)](#16-database-layer)
17. [Deploy & Fleet Scripts (~45 gaps)](#17-deploy--fleet-scripts)
18. [Workspace Daemons (~40 gaps)](#18-workspace-daemons)
19. [Priority Matrix](#19-priority-matrix)

---

## 1. Executive Summary

The infrastructure has **three systemic blind spots**:

| Blind Spot | Impact | Gap Count |
|------------|--------|-----------|
| **Silent catch blocks** | Errors vanish — can't diagnose failures | ~80 instances |
| **No request/success logging in API routes** | Only errors logged; can't trace normal flow | ~350 instances |
| **NATS protocol messages unlogged** | Can't trace what was sent, received, or dropped | ~60 instances |

**By severity:**

| Severity | Description | Count |
|----------|-------------|-------|
| **CRITICAL** | Data loss, security events, state corruption invisible | ~40 |
| **HIGH** | State transitions, protocol failures, auth decisions invisible | ~150 |
| **MEDIUM** | Operational visibility gaps, debugging difficulty | ~250 |
| **LOW** | Pure functions, cache hits, minor state reads | ~200+ |

---

## 2. Systemic Patterns

### Pattern 1: Silent catch blocks (`catch {}` or `.catch(() => {})`)

**~80 instances across the codebase.** Every one should at minimum `console.warn` with the error message and context.

**Worst offenders:**
- `mesh-agent.js`: 15 silent catches (heartbeat, NATS requests, git ops)
- `nats-resolve.js`: 4 empty catches on config file reads
- `agent-activity.js`: 10 empty catches (file reads, JSON parse, stat)
- `mesh-deploy-listener.js`: 5 empty catches (KV writes, git ops)
- `mesh-bridge.mjs`: 4 empty catches (NATS publish, event parse)
- `db/index.ts`: 1 empty catch (chmod)
- `tracer.js/ts`: 4 empty catches (NATS publish, SQLite insert)

### Pattern 2: Error-only route logging

**Every API route** follows: `try { ... } catch { console.error(...) }`. Nothing is logged on:
- Request received (method, path, params, body summary)
- Validation failures (which field, what value)
- DB queries (query type, row count)
- Successful responses (status, result summary)
- NATS publishes from routes
- File operations from routes

### Pattern 3: NATS fire-and-forget without logging

All `nc.publish()` calls are unlogged. All `.catch(() => {})` on NATS requests are silent. No NATS subject/payload logging on send or receive.

### Pattern 4: State transitions without pre/post logging

KV `put` operations, DB `update` calls, and in-memory state changes happen without logging the old→new values. When something is in the wrong state, there's no trace of what changed it.

### Pattern 5: Functions with zero logging

Many core functions (especially in `mesh-collab.js`, `rule-loader.js`, `role-loader.js`, `agent-activity.js`) have **zero** log statements — not even error paths.

---

## 3. mesh-agent.js

### CRITICAL

| Line | Operation | Gap |
|------|-----------|-----|
| 512-513 | Heartbeat send `catch { // fire-and-forget }` | Heartbeat failures completely invisible. Repeated failures = NATS down but nobody knows. |
| 988-991, 1014-1017, 1025-1028 | `natsRequest('mesh.tasks.fail', ...).catch(() => {})` (3 instances) | If reporting a task failure itself fails, the task is orphaned with zero trace. |
| 1551 | `checkRecruitingSessions` catch — all errors swallowed | Recruiting loop can silently die. |

### HIGH — NATS Protocol (20 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 170 | `natsRequest()` helper — no subject/payload logging | Every NATS request is invisible. Should log subject + truncated payload. |
| 511 | Heartbeat publish — no periodic success log | No confirmation heartbeat loop is alive. |
| 968-970 | `collab.find` first attempt — response not logged | Don't know if session was found. |
| 977-979 | `collab.find` retry — response not logged | Same. |
| 1046 | `collab.status` check — active status not logged | Only logs on abort/complete. |
| 1053 | Session heartbeat catch — silent | Session may be gone, nobody knows. |
| 1057 | `tasks.start` catch — silent | Daemon doesn't know task started. |
| 1132-1145 | `collab.reflect` — no pre-send log | Only logged after success. |
| 1154-1161 | `collab.status` post-reflection catch — silent | Error swallowed. |
| 1252, 1289, 1311, 1352, 1391 | `tasks.attempt` sends — no confirmation log (5 instances) | Attempt records may be silently lost. |
| 1322-1334, 1363-1377 | `tasks.complete` sends — no ack log (2 instances) | Completion may not be acknowledged. |
| 1403-1407 | `tasks.release` — no ack log | Release may not be acknowledged. |
| 1472, 1489 | Subscribe calls — no success/failure log | Subscription may fail silently. |
| 1526 | `collab.recruiting` response — session count not logged | No visibility into recruiting pool. |

### HIGH — State Mutations (12 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 152-157 | `writeAgentState()` — catch is `{ /* best-effort */ }` | Disk write failures invisible. |
| 992, 1018, 1029, 1184, 1336, 1379, 1410 | `writeAgentState('idle', null)` — no log (7 instances) | State transitions to idle are invisible. |
| 1511, 1513, 1516, 1579, 1585 | `currentTaskId` mutations — no log (5 instances) | Agent busy/idle transitions invisible. |

### HIGH — Conditional Branches (10 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 87-98 | `injectRules` — no log when zero rules match | Can't tell if rules were evaluated at all. |
| 119-125 | `injectRole` — silent return when role not found | Role injection silently fails. |
| 543 | `isAllowedMetric` — no log when metric IS allowed | Only blocked metrics logged. |
| 1304 | No metric defined — silent trust | No log that output was accepted without metric. |
| 1493-1508 | Recruit handler — silently skips busy/own/excluded tasks | Can't tell why recruit was ignored. |
| 1558-1561 | Main loop — silently skips when busy | No log of skipped poll cycles. |
| 1566-1573 | No tasks available — silent in continuous mode | Can't tell if polling or hung. |

### MEDIUM — Config & Startup (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 56 | `HEARTBEAT_INTERVAL` env var — not logged at startup | |
| 60 | `RULES_DIR` env var — not logged | Affects which rules load. |
| 61 | `HARNESS_PATH` env var — not logged | |
| 306 | `WORKTREE_BASE` env var — not logged | |
| 497 | Heartbeat interval timer creation — not logged | |

### MEDIUM — Git Operations (12 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 327 | `git worktree remove --force` — not logged before execution | |
| 328 | Catch for forced removal — silent | |
| 334 | `git branch -D` — not logged | |
| 334-335 | Branch delete catch — silent | |
| 368-369 | `git status --porcelain` — not logged | |
| 378 | `git add -A` — not logged | |
| 409 | `git merge --abort` — not logged | |
| 410-415 | `git pull --ff-only` catch — silent | |
| 441 | `git worktree remove` — not logged before | |
| 447 | `git branch -D` in cleanup — not logged | |
| 1123 | `git status` in collab — not logged | |
| 1128 | Git status catch in collab — silent | |

### MEDIUM — Function Entry/Exit (10 gaps)

| Line | Function | Gap |
|------|----------|-----|
| 65 | `getRules()` | No log of rule count, cache hit/miss. |
| 74 | `getHarnessRules()` | No log of path, rule count. |
| 84 | `injectRules()` | No log of matched count, injected IDs. |
| 107 | `getRole()` | No log of cache miss, lookup result. |
| 183 | `buildInitialPrompt()` | No log of prompt length. |
| 242 | `buildRetryPrompt()` | No log of attempt number. |
| 585 | `buildCollabPrompt()` | No log of round, mode, prompt length. |
| 684-747 | `parseReflection()` — success path silent | Only failures logged. |
| 755 | `buildCirclingPrompt()` | No log of phase, step, role. |
| 943 | `parseCirclingReflection()` success — silent | |

---

## 4. mesh-task-daemon.js

### CRITICAL

| Line | Operation | Gap |
|------|-----------|-----|
| 80-86 | `parseRequest()` catch returns `{}` silently | Malformed agent messages completely invisible. **Debugging nightmare.** |
| 2157-2158 | `detectStalls` and `checkRecruitingDeadlines` intervals — **no try/catch** | Unhandled rejections will crash the daemon. |
| 255-268 | `needsReview` auto-computation | Review decision logic is completely invisible. |

### HIGH — RPC Error Responses Without Server-Side Log (~40 gaps)

`respondError()` (line 76) sends error to caller but **never logs locally**. Every handler below sends errors invisibly:

| Handler | Error Cases (all unlogged) |
|---------|---------------------------|
| `handleSubmit` | Missing params (107), duplicate task (113) |
| `handleClaim` | Missing node_id (186), already active (194), no task (212) |
| `handleStart` | Missing task_id (223), not found (226) |
| `handleComplete` | Missing task_id (239), not found (252) |
| `handleFail` | Missing task_id (349), not found (351) |
| `handleAttempt` | Missing task_id (414), not found (417) |
| `handleGet` | Missing task_id (439), not found (443) |
| `handleHeartbeat` | Missing task_id (454), not found (458) |
| `handleRelease` | Missing task_id (471), not found (474) |
| `handleCancel` | Missing task_id (488), not found (491) |
| `handleTaskApprove` | Missing task_id (512), not found (515) |
| `handleTaskReject` | Missing task_id (532), not found (535) |
| `handleCollabCreate` | Missing task_id (707), not found (710), no spec (711), exists (715) |
| `handleCollabJoin` | Missing params (742), join failed (745) |
| `handleCollabStatus` | Missing session_id (810), not found (814) |
| `handleCollabFind` | Missing task_id (826) |
| `handleCollabReflect` | Missing params (861), submit failed (864) |
| `handlePlanCreate` | Missing params (1606), not found (1612) |
| `handlePlanGet` | Missing plan_id (1632), not found (1636) |
| `handlePlanApprove` | Missing plan_id (1658), not found (1661) |
| `handlePlanAbort` | Missing plan_id (1679), not found (1682) |
| `handlePlanSubtaskUpdate` | Missing params (1697), not found (1700) |
| `handleCirclingGateApprove` | Not found (1435), not circling (1436) |
| `handleCirclingGateReject` | Not found (1479), not circling (1480) |

**Fix:** Add `log(\`WARN: ${error}\`)` inside `respondError()`.

### HIGH — Silent State Transitions

| Line | Operation | Gap |
|------|-----------|-----|
| 603-608 | `store.markReleased()` returns null (race) — silent | Task already released by another path. |
| 661-662 | `store.markFailed()` returns null — silent | |
| 667-668 | `collabStore.markAborted()` returns null — silent | |
| 791 | `collabStore.markAborted()` on insufficient nodes — no explicit log | |
| 1186, 1215, 1422, 1449-1459 | Parent task completion from collab/circling — no explicit log (4 paths) | Task marked complete as side effect. |

### HIGH — Unlogged Functions

| Line | Function | Gap |
|------|----------|-----|
| 969-1024 | `computeNodeScopes()` | Scope strategy (shared/leader/partitioned) decision invisible. `[NO-SCOPE-ASSIGNED]` fallback at 1006 is critical. |
| 1887-1897 | `checkPlanProgress()` legacy fallback scan | O(n*m) scan activating is invisible. Blocks planned removal. |

### MEDIUM — NATS Publishes Without Logging (10 gaps)

| Line | Publish | Gap |
|------|---------|-----|
| 136-143 | `mesh.collab.*.recruit` broadcast | |
| 460 | `publishEvent('heartbeat', task)` | High volume but no periodic summary. |
| 556-558 | `mesh.agent.*.alive` request | Request not logged before send. |
| 615-619 | `mesh.agent.*.stall` publish | Stall notification silent. |
| 678-682 | `mesh.agent.*.budget_exceeded` publish | Budget notification silent. |
| 724-731 | `mesh.collab.*.recruit` in collabCreate | |
| 1069-1079 | Per-node round notifications | |
| 1115-1125 | Sequential turn notifications | |
| 1273-1285 | Circling step directed inputs | |
| 1807-1813 | Plan subtask recruit broadcasts | |

### MEDIUM — Circling Lifecycle (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 1292 | Step timeout timer creation — not logged | |
| 1362-1368 | `clearCirclingStepTimer()` — not logged | |
| 1309-1312 | Stale timer early return — not logged | |
| 1488-1492 | Circling state machine reset on gate reject — not logged with new values | |
| 1572, 1582 | Circling sweep errors | |

### MEDIUM — Shutdown (3 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 2170-2183 | Shutdown: timer clears, unsubscribes, drain — not individually logged | |
| 2181 | Subscription unsubscribe count — not logged | |
| 2182 | `nc.drain()` — not logged before/after | |

---

## 5. mesh-bridge.js

### CRITICAL

| Line | Operation | Gap |
|------|-----------|-----|
| 63-68 | `natsRequest()` helper — no subject/payload/error logging | Every NATS request invisible. |
| 202-206 | `updateTaskInPlace()` not try/caught — can desync dispatched set vs kanban | Task is in `dispatched` but kanban still says `queued`. |
| 286-288 | `collab.aborted` — no kanban update (functional bug + logging gap) | Card stuck in wrong state. |

### HIGH — `updateTaskInPlace` failures unlogged (~10 instances)

All `updateTaskInPlace` calls in `handleCollabEvent` (lines 227-332), `handlePlanEvent` (lines 357-423), `handleCompleted` (572), `handleFailed` (592), `handleCancelled` (605), and `reconcile` (108) are unwrapped. Failures propagate to generic catch losing the specific context.

### HIGH — Operational Gaps

| Line | Operation | Gap |
|------|-----------|-----|
| 167-169 | Task filtering — silently drops non-matching tasks | Can't tell which filter eliminated a task. |
| 171 | `findDispatchable` returns null — no log | Can't tell if bridge is polling but finding nothing. |
| 508-512 | Non-terminal events for non-dispatched tasks — silently dropped | |
| 541-543 | Heartbeat events — completely silent | Can't confirm heartbeats arriving. |
| 554-555 | `dispatched.delete` / `lastHeartbeat.delete` — not logged | Dispatch slot opening invisible. |
| 811-857 | Dispatch loop — no iteration logging | Can't confirm loop is running. |
| 834 | Field-strip catch — wrong comment claims logging elsewhere | |

### MEDIUM

| Line | Operation | Gap |
|------|-----------|-----|
| 301 | `collab.circling_step_started` catch — silent `break` | |
| 480-498 | `formatTaskYaml()` — YAML serialization bugs invisible | |
| 654-716 | `writeLog()` — `mkdirSync` and `writeFileSync` not try/caught | |
| 867-871 | Shutdown steps not individually logged | |

---

## 6. mesh-collab.js

### CRITICAL

| Line | Operation | Gap |
|------|-----------|-----|
| 361-374 | `startRound()` — dead node pruning + abort on insufficient nodes: **silent** | Session-killing event with zero trace. |
| 568 | `storeArtifact` recovery write `catch (_) { /* best effort */ }` | Session state may be corrupted. |

### HIGH — State Transitions (15 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 179 | `_updateWithCAS` retry — no log | CAS contention invisible. |
| 279-285 | `addNode` — 3 rejection paths silent (not recruiting, full, duplicate) | |
| 314-319 | `removeNode` — removal event not logged | |
| 325-331 | `setNodeStatus` — old→new status change not logged | |
| 407-413 | `submitReflection` — 3 rejection paths silent | |
| 430 | Node status → 'reflecting' — not logged | |
| 451-471 | `advanceTurn` — turn changes completely silent | |
| 728-786 | `advanceCirclingStep` — 5 state machine transitions not individually logged | |
| 851-861 | `markConverged` — round number not logged | |
| 868 | `markCompleted` — double-completion silent null | |
| 888 | `markAborted` — double-abort silent null | |
| 792-803 | `recordArtifactFailure` — failure count increment silent | |

### HIGH — Protocol Logic (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 478-522 | `checkConvergence` — convergence decision reasoning not logged | Can't tell WHY convergence was/wasn't reached. |
| 620-700 | `compileDirectedInput` — complex function, zero logging | Determines what each node sees. |
| 820-844 | `compileSharedIntel` — compilation not logged | |
| 537-573 | `storeArtifact` CAS retry — silent | |
| 338-342 | `isRecruitingDone` — can't tell why recruiting closed | |

---

## 7. mesh-plans.js

### HIGH

| Line | Operation | Gap |
|------|-----------|-----|
| 140-142, 229-234 | Cycle detection — blocked subtasks silent | Plan authoring errors invisible. |
| 399, 416-419 | `_updateWithCAS` retry silent; `list()` JSON.parse has no try/catch | **Corrupted KV entry crashes entire list.** |
| 441-473 | All lifecycle null returns (submit, approve, start, complete) — silent | Invalid transitions invisible. |
| 482-486 | `markAborted` — batch subtask blocking silent | |
| 494-500 | `updateSubtask` — missing subtask silent null | |
| 507-520 | `getNextWaveSubtasks` — no logging of readiness | |
| 348 | `autoRoutePlan` — silent by default when no logger passed | |

---

## 8. mesh-tasks.js

### HIGH

| Line | Operation | Gap |
|------|-----------|-----|
| 198-201 | `list()` — `JSON.parse` has no try/catch. **Corrupted KV entry crashes entire list.** | |
| 231, 235-237 | `claim()` — exclusion filter and dependency check silent | Can't tell why node couldn't claim. |
| 253, 257 | `claim()` — empty result and CAS race loss silent | |
| 273-382 | **All 10 lifecycle methods** return null on terminal/wrong state with zero logging | Invalid state transitions from bugs are invisible. Methods: `markRunning`, `markCompleted`, `markPendingReview`, `markApproved`, `markRejected`, `markFailed`, `logAttempt`, `markReleased`, `touchActivity`, claim CAS. |
| 422-425 | `_checkDeps` — dependency resolution completely silent | |

---

## 9. mesh-harness.js

### CRITICAL

| Line | Operation | Gap |
|------|-----------|-----|
| 92-103 | Scope check: `git checkout` revert catch **empty**, `fs.unlinkSync` catch **empty** | **Security-relevant**: a file that couldn't be reverted is an out-of-scope mutation that persists silently. |
| 173 | Block rule invalid regex — empty catch | Config error invisible. |

### HIGH

| Line | Operation | Gap |
|------|-----------|-----|
| 38-40 | `loadHarnessRules` — missing file vs 0 rules indistinguishable | |
| 66-67 | `enforceScopeCheck` — early return on empty args, no log | |
| 74-81 | Git diff/ls-files commands not logged | |
| 121, 157, 189, 244 | 4 early returns (empty input) — all silent | |
| 196-206 | `preCommitSecretScan` — gitleaks availability unknown | |
| 210-227 | Regex fallback scan — no log that fallback was taken | |
| 248-249 | `postCommitValidate` — security block not logged | |
| 287-293, 329-339, 343-352, 365-372 | `runMeshHarness` — all pass paths silent | Only failures logged; clean passes invisible. |
| 374-376 | Final harness result (pass/fail, violation/warning counts) — not logged | |

---

## 10. mesh-registry.js

### HIGH — Entire Registry Lifecycle Unlogged

| Line | Operation | Gap |
|------|-----------|-----|
| 47-52 | `init()` — KV bucket creation, TTL config | |
| 60-91 | `register()` — tool manifest, KV key, NATS subjects, method count | |
| 80-81 | Declared method has no handler — silent skip (wiring bug) | |
| 94-116 | `_processSubscription()` — incoming requests, no-handler, handler errors: all silent server-side | |
| 121-137 | `startHeartbeat()` — start, interval, per-tool refresh | |
| 147-158 | `call()` — outgoing calls, responses | |
| 164-174 | `listTools()` — tool count | |
| 179-196 | `shutdown()` — cleanup steps, KV delete catch empty (189) | |
| 202-207 | `createRegistry()` — NATS connection | |

---

## 11. rule-loader.js

### HIGH

| Line | Operation | Gap |
|------|-----------|-----|
| 170 | `loadAllRules` — missing dir returns `[]` silently | |
| 172-196 | File scan — no log of dir, file count, per-rule parse, total loaded | |
| 204-221 | `matchRules()` — zero logging (checked, matched, sort) | |
| 254-311 | `detectFrameworks()` — zero logging (package.json, deps, config files, detected frameworks) | |
| 273 | Malformed package.json — empty catch | |
| 333-348 | `activateFrameworkRules()` — zero logging | |
| 227-248 | `formatRulesForPrompt()` — silent truncation at line 238-239 | |

---

## 12. role-loader.js

### HIGH — Entire Module Has ~Zero Logging

| Line | Operation | Gap |
|------|-----------|-----|
| 28-33 | `loadRole()` — file read, YAML parse | |
| 41-55 | `findRole()` — search loop across dirs, candidates probed | |
| 54 | Returns null (not found) — silent | |
| 61-85 | `listRoles()` — dirs scanned, files found, roles loaded, duplicates. Catch at 80 is empty. | |
| 93-112 | `validateRole()` — validation results never logged | |
| 121-151 | `formatRoleForPrompt()` — output size | |
| 162-206 | `validateRequiredOutputs()` — files inspected, pass/fail. Catch at 189 empty. | |
| 215-246 | `checkForbiddenPatterns()` — patterns, files, regex. Catch at 240 empty. | |
| 253-283 | `findRoleByScope()` — scoring, best match | |

---

## 13. agent-activity.js

### HIGH — Entire Module Has Zero Logging (except 1 warn)

| Line | Operation | Gap |
|------|-----------|-----|
| 48-98 | `getProjectDir()` — 4 empty catches (56, 64, 77), fast path silent, fallback silent | |
| 106-130 | `findLatestSessionFile()` — 2 empty catches (110, 123), search results silent | |
| 138-182 | `readLastEntry()` — 2 empty catches (176, 179), file open/read/parse all silent | |
| 188-231 | `parseJsonlTail()` — 2 empty catches (208, 228), all operations silent | |
| 252-287 | `getActivityState()` — the **primary API**, zero observability | |
| 298-381 | `getSessionInfo()` — billing data computed with zero auditability. Model detection (359-373) and pricing tier not logged. | |

---

## 14. Tracer & NATS Infrastructure

### tracer.js (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 32-34 | `setTraceMode()` — mode change silent, invalid mode silently ignored | |
| 44-47 | `setNatsConnection()` — transport attach/replace not logged | |
| 56-59 | `pushToRing()` — ring buffer overflow/wrap-around not logged | |
| 112-114 | `emit()` catch — **NATS publish failure completely empty catch** | |
| 138 | `summarizeArgs()` catch — serialization error discarded | |

### nats-resolve.js (13 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 34-61 | `resolveNatsUrl()` — 4 resolution steps, none log which source was used. 2 empty catches (44, 56). Localhost fallback at 61 not logged. | |
| 70-92 | `resolveNatsToken()` — same pattern, 2 empty catches (80, 90). Null return (no token) at 92 not logged. | |
| 96-97 | Module-level resolution — no summary log of final URL/token source. | |

### mission-control/src/lib/nats.ts (14 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 33-44 | URL resolution — same empty catches, no source log. | |
| 59 | `getNats()` cached connection — no trace event. | |
| 66 | Returns null (connecting) — no log. Caller gets null with zero explanation. | |
| 70-78 | NATS connect options (reconnect policy, timeouts, jitter) — never logged. | |
| 81-84 | KV handle reset after reconnect — not logged. | |
| 92-97 | `closed()` catch — state reset but **logs nothing**. Connection error closure invisible. | |
| 122, 153, 184 | KV cache hit paths (3 buckets) — no trace. | |

### mission-control/src/lib/tracer.ts (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 53-56 | `insertEvent()` catch — **empty**. SQLite insert failures vanish. | |
| 60-68 | `publishEvent()` — NATS subject not logged. | |
| 66-68 | `publishEvent()` catch — **empty**. NATS publish failures vanish. | |
| 99-107 | `batchInsertEvents()` catch — **empty**. Entire batches silently lost. | |
| 99-107 | `batchInsertEvents()` — no traceCall wrapper, no success/failure visibility. | |

### mission-control/src/lib/activity.ts (2 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 6-22 | `logActivity()` — **no try/catch at all**. DB insert crashes caller. | |
| 24-35 | `getRecentActivity()` — **no try/catch**. DB query crashes caller. | |

### mission-control/src/lib/scheduler.ts (12 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 103 | Tick entry — not logged. Can't correlate tick start/end or detect hangs. | |
| 131-139, 162-169 | `at` and `cron` task mutations — DB updates not individually logged. | |
| 205 | Cron parse failure in recurring recreation — silent catch. | |
| 210-240 | Recurring task insert and original mutation — no error handling. **Duplicate creation on partial failure.** | |
| 255-266 | `hasActiveTask` result — never logged. Key dispatch branch invisible. | |
| 318-326 | Dispatch DB update — no logging. False positive if update fails. | |
| 337-338 | Gateway notify catch — console.error but no traceCall. Not in trace system. | |
| 343-357 | Dispatch signal file write — success not logged. | |
| 376-377 | `syncTasksToMarkdown` — no try/catch. Throws uncaught. | |
| 387-409 | `generateNextId()` — zero logging/tracing. | |

### mission-control/src/lib/gateway-notify.ts (9 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 22-33 | Config read catch — falls back to defaults silently. | |
| 48-51 | WebSocket timeout (5s) — **zero logging**. Silent 5-second hang. | |
| 53 | WS connection opened — not logged. | |
| 58-79 | Auth challenge/handshake — **zero logging**. | |
| 81-91 | `chat.send` payload — not logged. | |
| 102-104 | Error response — console.error but no traceCall. | |
| 113-115 | WS `onclose` — **no logging**. Close reason/code lost. | |
| 49 | Timeout `ws.close()` catch — **empty**. | |
| 43 | Missing token — console.error but no traceCall. | |

---

## 15. API Routes

### Pattern: ALL 56 route files, ~95 handlers follow the same gap pattern

Every handler only logs on `catch(err)`. **None log:**
- Request received (method, path, params, body summary)
- Validation failures (which field, what value)
- DB query types and row counts
- Successful response summaries
- NATS publishes
- File operations
- Cache hits/misses

### CRITICAL — Security Events

| Route | Operation | Gap |
|-------|-----------|-----|
| `/api/workspace/read` | Path traversal security check | Blocked traversal attempts not logged. **Must be security-logged.** |
| `/api/memory/doc` | Path traversal check | Same. |
| `/api/mesh/tasks/[id]` PATCH | Authority check (worker vs lead) | Permission denials silent. **Must be security-logged.** |
| `/api/cowork/intervene` | Operator interventions (abort, force_converge, remove_node) | 5+ NATS publishes, DB mutations, NATS RPCs — **zero logging**. Must be audited. |
| `/api/settings/gateway` PATCH | Config file mutation | No before/after logging. |

### HIGH — SSE Endpoints (3 routes, zero lifecycle logging)

| Route | Gap |
|-------|-----|
| `/api/mesh/events` | No connection, subscription, event count, or disconnect logging. |
| `/api/cowork/events` | Same. |
| `/api/observability/stream` | Same. |

### HIGH — Critical Data Paths

| Route | Operation | Gap |
|-------|-----------|-----|
| `/api/souls/[id]/evolution` PATCH | 5 git operations (checkout, add, commit, checkout, merge) | None logged. |
| `/api/souls/[id]/prompt` POST | 4-5 file reads (SOUL.md, PRINCIPLES.md, genes.json, etc.) | None logged. |
| `/api/mesh/nodes` GET | 5+ external commands (tailscale, df, launchctl, git) | None logged. |
| `/api/tasks` POST | NATS publish `mesh.bridge.wake` | Not logged. |
| `/api/tasks/[id]` DELETE | Recursive child collection, NATS cancel, dependency cleanup | Not individually logged. |
| `/api/cowork/dispatch` POST | NATS publish, node resolution, DB insert | Not individually logged. |

### MEDIUM — All Other Routes

~350 individual operations across remaining routes lack logging. See pattern description above.

---

## 16. Database Layer

### CRITICAL — Migration System (21 gaps in `db/index.ts`)

The entire `runMigrations()` function (lines 17-507) is **completely silent**:

| Lines | Operation | Gap |
|-------|-----------|-----|
| 19-63 | 4 initial tables created | No log per table. |
| 66-91 | FTS triggers created | No log. |
| 94-125 | Soul tables created | No log. |
| 128-189 | 15+ ALTER TABLE columns added | No log per column. |
| 222-235 | Data migration (auto_start → scheduling) | Row count not logged. |
| 237-259 | Dependencies table + indexes | No log. |
| 262-327 | Memory items tables, FTS, triggers | No log. |
| 330-380 | Knowledge graph tables, temporal columns | No log. |
| 383-456 | Token usage, clusters, normalization | `UPDATE tasks SET execution='local'` — row count not logged. |
| 479-506 | Observability table, indexes, 24h cleanup | Cleanup row count not logged. |
| 509-537 | `getDb()` — WAL mode, FK, permissions | No log. |
| 520-533 | `chmodSync` on DB files | **Empty catch at 533.** |

---

## 17. Deploy & Fleet Scripts

### mesh-deploy.js (13 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 577-583 | `loadDeployState()` — JSON parse catch silent | |
| 596-613 | `gitFetchAndDiff()` — no log of SHAs, changed files | |
| 615-620 | `gitMerge()` — no pre/post SHA log | |
| 667-707 | `installComponentFiles()` — individual file copies not logged | **Core deploy action invisible.** |
| 851 | `git stash push` in rollback — result not logged | |
| 855 | `git reset --hard` in rollback — **destructive op not logged** | |

### mesh-deploy-listener.js (12 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 84-87, 146, 198, 273 | KV put catches — all empty | |
| 110-135 | Git operations (init, remote, fetch, merge) — not individually logged | |
| 191-198 | Node registry update — not logged | |
| 301-323 | Status query handler — receipt/response not logged | |

### fleet-deploy.js (9 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 68-110 | `discoverNodes()` — 4 empty catches (77, 84, 88-107, 107) | |
| 217 | "Latest" deploy marker write — not logged | |
| 230 | Trigger publish payload — not logged | |
| 276-278 | KV result polling catches — silent | |

### mesh-health-publisher.js (10 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 53-57 | `execSafe()` — all command failures silently return null | |
| 155-241 | 5 data collection functions — all error paths silent | |
| 275-318 | `gatherHealth()` — full payload never logged | |
| 357-358 | KV publish payload — never logged | |

### mesh-node-remove.js (10 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 109-131 | Task release loop — individual task IDs not logged | |
| 153-158 | Removal announcement payload — not logged | |
| 177-196 | Service stop/remove commands — not individually logged | |
| 213-220 | `fs.rmSync(dir, { recursive })` — not logged before execution | |

### harness-sync.js (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 260-277 | Source/dest load, file copy, mkdir — not individually logged | |
| 308-312 | Backup creation, merge write — not logged with size | |

### mesh-join-token.js (5 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 69-80 | Secret creation/load — not logged | |
| 97-124 | Token generation params — not logged | |
| 51-62 | SSH key selection — not logged | |

---

## 18. Workspace Daemons

### memory-daemon.mjs (10 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 46-70 | Store initialization — success not logged | |
| 105-116 | Config load — source not logged | |
| 184-218 | Activity detection — detection results not logged | |
| 510-583 | `.companion-state.md` write — not logged | |
| 957-968 | `saveDaemonState()` catch — write failures ignored | |
| 970-991 | `loadDaemonState()` — corrupt state silently ignored | |

### daily-log-writer.mjs (6 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 74-76 | State load — JSON parse error returns empty silently | |
| 143-159 | `getGitDelta()` — git failure returns null silently | |
| 239-245 | Daily file creation — only logged in VERBOSE | |

### obsidian-sync.mjs (12 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 39-61 | Config load — falls back silently | |
| 130-143 | Sync state — parse errors silent | |
| 394-434 | `apiPut()` — HTTP requests not logged | |
| 439-461 | Health check — result not logged | |
| 466-470 | `directWrite()` — writes not logged | |
| 476-575 | `ensureNodeDirs()` — dir/file creation not logged | |
| 626-714 | Sync loop — file read errors silently continue | |
| 767-871 | `propagateSharedLessons()` — read errors only logged if verbose | |

### mesh-bridge.mjs (11 gaps)

| Line | Operation | Gap |
|------|-----------|-----|
| 49-51 | NATS not configured — returns null silently | |
| 57-66 | NATS module import failure — returns null silently | |
| 73, 95, 99, 100, 103 | NATS connect, event parse, publish — all silent or empty catch | |
| 133-141 | `getRecentRemoteEvents()` — read failures return empty silently | |
| 148-159 | `close()`, connection failure — silent | |

---

## 19. Priority Matrix

### P0 — Fix Immediately (security, data loss, crash risks)

1. **`respondError()` in mesh-task-daemon.js** — add `log()` call. Fixes ~40 invisible error responses.
2. **`parseRequest()` silent catch** — log malformed messages.
3. **`detectStalls`/`checkRecruitingDeadlines` intervals** — wrap in try/catch.
4. **Path traversal checks** in `/api/workspace/read` and `/api/memory/doc` — security log.
5. **`/api/cowork/intervene`** — full audit logging for operator interventions.
6. **`mesh-harness.js` scope revert empty catches** — security-relevant file ops.
7. **`activity.ts`** — add try/catch to both functions.

### P1 — Fix This Sprint (operational visibility)

1. **`natsRequest()` helpers** in mesh-agent and mesh-bridge — log subject + truncated payload.
2. **All `_updateWithCAS` retry paths** across collab/plans/tasks — log CAS retries.
3. **All lifecycle method null returns** in mesh-tasks.js (10 methods) — log invalid transitions.
4. **Ring buffer overflow** in tracer.js — log when first wrap occurs.
5. **NATS config resolution** — log which source provided URL/token.
6. **DB migrations** — log each table/column/migration.
7. **API request/response logging** — add middleware-level logging (path, method, status, duration).
8. **Gateway notify** — log WebSocket lifecycle.
9. **Silent catch blocks** — systematic sweep, add `console.warn` to all ~80 instances.

### P2 — Fix This Quarter (debugging, observability)

1. **Function entry/exit logging** for all unlogged core functions.
2. **NATS publish logging** for all `nc.publish()` calls.
3. **Deploy scripts** — log individual file operations.
4. **Workspace daemons** — log state persistence operations.
5. **Role/rule loaders** — log scan, match, and detection operations.
6. **SSE endpoints** — log connection lifecycle.
7. **Circling/collab protocol** — log convergence reasoning, directed input compilation.
8. **Health publisher** — log gathered payload summary.

### P3 — Nice to Have (trace-level, pure functions)

1. Cache hit/miss logging for NATS KV handles.
2. Pure function result logging (`isRoundComplete`, `isMaxRoundsReached`, etc.).
3. Timer creation/destruction logging.
4. Environment variable reads at startup.
