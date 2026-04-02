# OpenClaw Observability — Complete Coverage Reference

Generated: 2026-04-01

---

## How It Works

OpenClaw ships a unified tracer (`lib/tracer.js`) that instruments every significant function across the distributed mesh. The tracer operates in two modes:

- **`dev` mode** — logs every function call unconditionally (~500 instrumentation points). Useful for local debugging and development.
- **`smart` mode** (default) — applies a sampling filter that only emits events for: tier 1 functions, errors, state transitions, cross-node events, and slow calls (>500 ms). This keeps production NATS traffic manageable while preserving all operationally critical data.

**Transport:** Each trace event is published to NATS on the subject `openclaw.trace.{nodeId}.{module}`. A 2,000-event in-memory ring buffer serves as a fallback for local reads when NATS is unavailable.

**Mission Control (MC) Dashboard:** The Next.js MC app subscribes to `openclaw.trace.>` via a NATS wildcard, ingests events into a SQLite database (`observabilityEvents` table), and serves them through:

- `/api/observability/events` — paginated event query
- `/api/observability/stream` — SSE live feed
- `/api/observability/nodes` — per-node health aggregation
- `/api/observability/config` — runtime trace mode toggle

The dashboard UI includes a live feed, event timeline, and system map for real-time visibility into all mesh nodes.

**Trace Event Schema:** Every event carries: `id`, `timestamp`, `node_id`, `module`, `function`, `tier` (1-3), `category` (lifecycle/state_transition/error/cross_node/compute), `args_summary`, `result_summary`, `duration_ms`, `error`, and optional `meta`.

**Tier Definitions:**

| Tier | Meaning | Smart Mode Behavior |
|------|---------|---------------------|
| 1 | Critical protocol operations — state changes, cross-node coordination | Always logged |
| 2 | Important internal operations — store mutations, daemon phases | Logged on error, slow call, or state transition |
| 3 | Routine / high-frequency operations — reads, parsing, utility | Only logged in dev mode (unless error or >500 ms) |

---

## Coverage Summary

| System Layer | Tier 1 | Tier 2 | Tier 3 | Total |
|-------------|--------|--------|--------|-------|
| Task Lifecycle Protocol | 16 | 38 | 10 | 64 |
| Collaboration Protocol | 16 | 13 | 1 | 30 |
| Plan Pipeline Protocol | 10 | 8 | 0 | 18 |
| Mesh Network Layer | 5 | 19 | 7 | 31 |
| Agent Execution Layer | 5 | 4 | 0 | 9 |
| Security & Enforcement Layer | 4 | 16 | 5 | 25 |
| Memory System | 2 | 16 | 4 | 22 |
| Local Workspace Daemons | 4 | 44 | 7 | 55 |
| Kanban & Scheduler | 2 | 4 | 3 | 9 |
| Hyperagent Self-Improvement | 2 | 18 | 2 | 22 |
| Knowledge & Search | 1 | 4 | 3 | 8 |
| Communication | 1 | 4 | 1 | 6 |
| Deployment & Provisioning | 3 | 16 | 4 | 23 |
| LLM Provider Abstraction | 1 | 1 | 0 | 2 |
| **Total** | **72** | **205** | **47** | **324** |

> Note: Some functions appear in multiple protocol sections when they serve dual roles. The total unique instrumented functions across all source modules is **~324**.

---

## 1. TASK LIFECYCLE PROTOCOL

### 1.1 Task Submission & Queuing

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleSubmit` | mesh-task-daemon | 1 | Entry point for all work entering the mesh — captures task origin, payload shape, and queuing latency for load analysis. |
| `put` | TaskStore | 2 | Persists a task record to the store — needed to correlate submission events with actual storage writes and detect write failures. |
| `handleList` | mesh-task-daemon | 3 | Lists queued tasks — high-frequency read used by dashboards and CLI; logged in dev mode to debug query patterns. |
| `handleGet` | mesh-task-daemon | 3 | Single-task lookup — logged for debugging individual task resolution failures. |
| `list` | TaskStore | 3 | Store-level list operation — provides low-level I/O timing for task queries. |
| `get` | TaskStore | 3 | Store-level get operation — used to debug key-miss scenarios when a task ID is referenced but not found. |
| `publishEvent` | mesh-task-daemon | 2 | Publishes task lifecycle events to NATS for mesh-wide subscribers — critical for ensuring event propagation is healthy. |

### 1.2 Task Claiming & Execution

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleClaim` | mesh-task-daemon | 1 | Tracks which agent claims which task — critical for debugging double-claims and task distribution across nodes. |
| `handleStart` | mesh-task-daemon | 1 | Marks task execution start — establishes the execution timeline and is the reference point for budget enforcement. |
| `claim` | TaskStore | 1 | Store-level claim with CAS semantics — logs the atomic claim operation to detect races and CAS conflicts. |
| `markRunning` | TaskStore | 2 | Transitions task to running state — captures the state machine transition for audit and debugging stuck tasks. |
| `handleHeartbeat` | mesh-task-daemon | 2 | Agent heartbeat during execution — absence triggers stall detection; logged to verify liveness protocol is working. |
| `touchActivity` | TaskStore | 2 | Updates last-activity timestamp — provides ground truth for stall detection thresholds. |
| `handleAttempt` | mesh-task-daemon | 2 | Records an execution attempt — tracks retry count progression and helps diagnose repeated failures on the same task. |
| `logAttempt` | TaskStore | 2 | Store-level attempt log — persists attempt metadata for post-mortem analysis of multi-attempt tasks. |

### 1.3 Task Completion & Review

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleComplete` | mesh-task-daemon | 1 | Task completion event — captures success path including output summary; essential for throughput metrics. |
| `handleTaskApprove` | mesh-task-daemon | 1 | Reviewer approves completed task — tracks approval latency and who approved, for audit and quality control. |
| `handleTaskReject` | mesh-task-daemon | 1 | Reviewer rejects completed task — captures rejection reason; critical for understanding rework loops. |
| `markCompleted` | TaskStore | 2 | Transitions task to completed state — store-level confirmation that the state change persisted. |
| `markPendingReview` | TaskStore | 2 | Moves task into review queue — tracks how long tasks wait for review. |
| `markApproved` | TaskStore | 2 | Final approval state write — closes the task lifecycle in the store. |
| `markRejected` | TaskStore | 2 | Rejection state write — triggers downstream retry logic; logged to trace rejection cascades. |

### 1.4 Task Failure & Recovery

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleFail` | mesh-task-daemon | 1 | Task failure event — captures error class, message, and attempt number for failure pattern analysis. |
| `handleRelease` | mesh-task-daemon | 1 | Agent voluntarily releases a claimed task — important for detecting agents that cannot complete work. |
| `handleCancel` | mesh-task-daemon | 1 | Task cancellation — tracks external cancellation requests and ensures task resources are cleaned up. |
| `markFailed` | TaskStore | 2 | Persists failure state — needed to confirm the failure was recorded before retry logic kicks in. |
| `markReleased` | TaskStore | 2 | Clears the claim on a task — must be logged to detect release-claim race conditions. |
| `delete` | TaskStore | 2 | Removes a task record — logged for audit; deletion is irreversible and should be traceable. |

### 1.5 Task Stall Detection & Budget Enforcement

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `detectStalls` | mesh-task-daemon | 1 | Periodic sweep for stalled tasks — logs how many tasks were detected stalled; key health signal for the mesh. |
| `enforceBudgets` | mesh-task-daemon | 1 | Kills tasks exceeding time/token budgets — logged to track enforcement actions and prevent runaway agents. |
| `findStalled` | TaskStore | 2 | Query for tasks with stale heartbeats — provides the raw data for stall detection; timing is diagnostic. |
| `findOverBudget` | TaskStore | 2 | Query for tasks exceeding limits — logged to monitor budget violation frequency and tune thresholds. |

---

## 2. COLLABORATION PROTOCOL

### 2.1 Session Creation & Recruiting

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleCollabCreate` | mesh-task-daemon | 1 | Creates a new collaboration session — logs session type (circling, sequential), participating nodes, and task binding. |
| `handleCollabJoin` | mesh-task-daemon | 1 | Node joins an existing collab session — tracks participant count growth and join timing for scheduling analysis. |
| `handleCollabRecruiting` | mesh-task-daemon | 2 | Handles recruiting phase for collaboration — logs which nodes were invited and their response status. |
| `handleCollabLeave` | mesh-task-daemon | 2 | Node leaves a collab session — important for understanding session attrition and triggering quorum checks. |
| `checkRecruitingDeadlines` | mesh-task-daemon | 2 | Sweeps for expired recruiting windows — prevents sessions from waiting forever for participants. |
| `publishCollabEvent` | mesh-task-daemon | 2 | Publishes collab lifecycle events via NATS — ensures all mesh nodes see collaboration state changes. |
| `put` | CollabStore | 2 | Persists a collab session record — store-level confirmation of session creation. |
| `addNode` | CollabStore | 2 | Adds a participant to the collab record — tracks the authoritative participant list. |
| `removeNode` | CollabStore | 2 | Removes a participant — logged to trace session membership changes. |
| `findActiveSessionsByNode` | CollabStore | 3 | Queries active sessions for a node — used by load balancers; high frequency in dev. |

### 2.2 Round Management

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `startCollabRound` | mesh-task-daemon | 1 | Initiates a new collaboration round — logs round number, participants, and strategy parameters. |
| `evaluateRound` | mesh-task-daemon | 1 | Evaluates round completion and convergence — key decision point that determines if collaboration continues or converges. |
| `startRound` | CollabStore | 2 | Store-level round start — persists round metadata for durability across daemon restarts. |
| `setNodeStatus` | CollabStore | 2 | Updates a participant's status within a round — tracks per-node progress through the collaboration. |

### 2.3 Reflection & Convergence

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handleCollabReflect` | mesh-task-daemon | 1 | Agent submits reflection for current round — captures reflection quality signals and convergence indicators. |
| `submitReflection` | CollabStore | 2 | Persists a reflection artifact — ensures reflection data is durably stored before round evaluation. |
| `storeArtifact` | CollabStore | 2 | Stores collaboration artifacts (code, docs) — tracks artifact production rate and sizes. |
| `recordArtifactFailure` | CollabStore | 2 | Records when artifact production fails — important for diagnosing collaboration quality issues. |
| `markConverged` | CollabStore | 1 | Marks a session as converged — terminal state transition; must always be logged for correctness auditing. |
| `markCompleted` | CollabStore | 1 | Final completion of collaboration — closes the session lifecycle and triggers downstream task completion. |
| `markAborted` | CollabStore | 1 | Collaboration aborted — captures abort reason for debugging session failures. |
| `cleanupTaskCollabSession` | mesh-task-daemon | 2 | Cleans up resources after collab ends — logged to ensure no orphaned state remains. |

### 2.4 Sequential Turn Management

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `notifySequentialTurn` | mesh-task-daemon | 1 | Notifies next agent in sequential collab — tracks turn handoffs and detects stuck turns. |
| `advanceTurn` | CollabStore | 2 | Advances the turn pointer in the store — provides ordering guarantees for sequential collaboration. |
| `handleCollabStatus` | mesh-task-daemon | 2 | Returns collab session status — diagnostic endpoint for monitoring session health. |
| `handleCollabFind` | mesh-task-daemon | 2 | Finds collaboration sessions by criteria — used by agents to discover joinable sessions. |
| `get` | CollabStore | 2 | Retrieves a single collab session — basic read used by all collab operations. |
| `list` | CollabStore | 2 | Lists all collab sessions — used by dashboards and CLI. |
| `findByTaskId` | CollabStore | 2 | Finds collab session for a given task — links the task and collab lifecycles. |
| `appendAudit` | CollabStore | 2 | Appends audit log entry to session — provides fine-grained event history within a collaboration. |
| `delete` | CollabStore | 2 | Removes a collab session — logged for cleanup audit trail. |

### 2.5 Circling Strategy (Worker/Reviewer)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `startCirclingStep` | mesh-task-daemon | 1 | Begins a circling step (worker produces, reviewer evaluates) — tracks step type and assigned roles. |
| `completeCirclingSession` | mesh-task-daemon | 1 | Completes the full circling strategy — logs final quality score and number of rounds taken. |
| `handleCirclingGateApprove` | mesh-task-daemon | 1 | Reviewer approves a circling gate — quality checkpoint passed; logged for approval chain auditing. |
| `handleCirclingGateReject` | mesh-task-daemon | 1 | Reviewer rejects a circling gate — triggers rework; logged to track rejection frequency per step. |
| `handleCirclingStepTimeout` | mesh-task-daemon | 2 | A circling step exceeded its time limit — detects stuck workers/reviewers and triggers recovery. |
| `sweepCirclingStepTimeouts` | mesh-task-daemon | 2 | Periodic sweep for timed-out circling steps — batch timeout enforcement. |
| `advanceCirclingStep` | CollabStore | 2 | Moves to next step in circling sequence — tracks step progression through the strategy. |
| `parseCirclingReflection` | circling-parser | 2 | Parses structured reflection from circling agents — validates reflection format and extracts quality signals. |
| `processProposals` | mesh-task-daemon | 2 | Processes improvement proposals from circling — logs proposal acceptance rate and applied changes. |

---

## 3. PLAN PIPELINE PROTOCOL

### 3.1 Plan Creation & Wave Computation

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handlePlanCreate` | mesh-task-daemon | 1 | Creates a multi-task plan with dependency graph — logs plan structure, wave count, and total subtask count. |
| `publishPlanEvent` | mesh-task-daemon | 2 | Publishes plan lifecycle events to NATS — ensures plan state changes propagate across the mesh. |
| `put` | PlanStore | 2 | Persists a plan record — store-level write confirmation for plan durability. |
| `loadTemplate` | plan-templates | 2 | Loads a plan template — tracks which templates are used and template resolution failures. |
| `listTemplates` | plan-templates | 3 | Lists available templates — diagnostic for template discovery. |
| `validateTemplate` | plan-templates | 2 | Validates template structure — catches malformed templates before plan creation. |
| `instantiateTemplate` | plan-templates | 2 | Creates a concrete plan from a template — logs variable substitution and generated subtask count. |
| `substituteVars` | plan-templates | 3 | Variable substitution in templates — low-level utility; logged in dev for template debugging. |

### 3.2 Plan Approval & Execution

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handlePlanApprove` | mesh-task-daemon | 1 | Plan approved for execution — triggers wave dispatch; critical gate in the plan lifecycle. |
| `handlePlanAbort` | mesh-task-daemon | 1 | Plan aborted — logs abort reason and cascading cancellation of in-flight subtasks. |
| `handlePlanGet` | mesh-task-daemon | 2 | Retrieves plan details — diagnostic for plan inspection. |
| `handlePlanList` | mesh-task-daemon | 2 | Lists all plans — dashboard and CLI query. |
| `approve` | PlanStore | 2 | Store-level approval write — confirms plan state transition persisted. |
| `submitForReview` | PlanStore | 2 | Moves plan to review state — tracks plan review queue depth. |
| `startExecuting` | PlanStore | 2 | Marks plan as actively executing — establishes execution start time for budget tracking. |
| `markAborted` | PlanStore | 2 | Store-level abort — confirms abort persisted and prevents further wave dispatch. |

### 3.3 Subtask Dispatch & Progress

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `handlePlanSubtaskUpdate` | mesh-task-daemon | 1 | Updates subtask status within a plan — triggers wave progression checks and dependency resolution. |
| `advancePlanWave` | mesh-task-daemon | 1 | Advances to the next wave of subtasks — logs which subtasks are dispatched and their dependency chains. |
| `updatePlanSubtaskStatus` | mesh-task-daemon | 2 | Internal subtask status update — correlates task completion events with plan progress. |
| `updateSubtask` | PlanStore | 2 | Store-level subtask update — persists individual subtask state changes. |
| `checkPlanProgress` | mesh-task-daemon | 2 | Evaluates overall plan completion percentage — provides progress metrics for dashboards. |
| `get` | PlanStore | 2 | Retrieves a plan record — basic read for plan operations. |
| `list` | PlanStore | 2 | Lists plans from store — used by query handlers. |
| `findByParentTask` | PlanStore | 2 | Finds plans associated with a parent task — links task and plan lifecycles. |

### 3.4 Failure Cascade & Recovery

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cascadeFailure` | mesh-task-daemon | 1 | Propagates subtask failure up through the plan — logs which downstream subtasks are cancelled and the failure chain. |
| `markCompleted` | PlanStore | 2 | Marks plan as completed — terminal state; confirms all waves finished successfully. |
| `delete` | PlanStore | 2 | Removes a plan record — logged for cleanup audit. |

---

## 4. MESH NETWORK LAYER

### 4.1 Node Discovery & Health

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cmdStatus` | mesh CLI | 1 | Reports mesh node status — provides operator-facing health snapshot of the entire mesh. |
| `cmdHealth` | mesh CLI | 2 | Detailed health check for a node — logs connectivity, store integrity, and resource usage. |
| `cmdRepair` | mesh CLI | 2 | Initiates repair operations on a node — logged to track repair actions and their outcomes. |
| `collectHeartbeats` | mesh CLI | 2 | Gathers heartbeats from all mesh nodes — provides fleet-wide liveness snapshot. |
| `gatherHealth` | health-publisher | 2 | Collects local health metrics — CPU, memory, disk, NATS status; feeds into health dashboard. |
| `publish` | health-publisher | 2 | Publishes health data to NATS — makes local health visible to the mesh. |
| `computeNodeScopes` | mesh-task-daemon | 2 | Computes task routing scopes per node — determines which node handles which task types. |

### 4.2 NATS Connection & Resolution

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `resolveNatsUrl` | nats-resolve | 1 | Resolves the NATS server URL — failure here means total mesh disconnection; always logged. |
| `resolveNatsToken` | nats-resolve | 2 | Resolves authentication token for NATS — logged to diagnose auth failures without exposing the token. |
| `natsConnectOpts` | nats-resolve | 2 | Builds NATS connection options — logs connection parameters (sans secrets) for troubleshooting. |

### 4.3 Remote Execution (mesh exec)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cmdExec` | mesh CLI | 1 | Executes a command on a remote mesh node — logged for security audit and debugging remote failures. |
| `cmdCapture` | mesh CLI | 2 | Captures output from a remote command — tracks capture size and duration for performance analysis. |
| `cmdBroadcast` | mesh CLI | 2 | Broadcasts a command to all mesh nodes — logged because it affects the entire fleet simultaneously. |

### 4.4 File Sync & Shared Folder

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cmdLs` | mesh CLI | 3 | Lists files on a remote node — high-frequency read; logged in dev for debugging sync issues. |
| `cmdPut` | mesh CLI | 2 | Transfers a file to a remote node — tracks file sync operations and transfer sizes. |

### 4.5 Deploy Pipeline

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cmdDeploy` | mesh CLI | 1 | Triggers deployment from CLI — critical operational action; always logged for deploy audit trail. |
| `cmdPlan` | mesh CLI | 2 | Shows deployment plan before executing — logged to record what was reviewed before deploy. |

### 4.6 Fleet Management

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `cmdSubmit` | mesh CLI | 2 | Submits a task via CLI — logged to track CLI-originated tasks separately from API submissions. |
| `cmdTasks` | mesh CLI | 3 | Lists tasks from CLI — high-frequency read; dev-mode logging for CLI debugging. |
| `discoverNodes` | fleet-deploy | 2 | Discovers all nodes in the mesh fleet — logs node count and connectivity for fleet operations. |
| `showStatus` | fleet-deploy | 2 | Shows fleet-wide status — aggregates health from all nodes. |
| `fleetDeploy` | fleet-deploy | 1 | Deploys to all fleet nodes — critical multi-node operation; logged for rollback and audit. |

---

## 5. AGENT EXECUTION LAYER

### 5.1 LLM Invocation & Prompt Construction

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `runLLM` | mesh-agent | 1 | Invokes the LLM for task execution — logs model, token count, latency, and cost; central to cost/performance monitoring. |
| `buildInitialPrompt` | mesh-agent | 2 | Constructs the first prompt for a task — logged to diagnose prompt quality and size issues. |
| `buildRetryPrompt` | mesh-agent | 2 | Constructs retry prompt after failure — logs what error context is injected into the retry. |

### 5.2 Metric Evaluation

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `evaluateMetric` | mesh-agent | 1 | Evaluates a quality metric on agent output — logs metric name, score, and pass/fail; drives quality dashboards. |

### 5.3 Git Worktree Management

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `createWorktree` | mesh-agent | 1 | Creates an isolated git worktree for task execution — logged to track worktree lifecycle and detect orphaned worktrees. |
| `cleanupWorktree` | mesh-agent | 2 | Removes worktree after task completion — logged to confirm cleanup and detect leaked worktrees. |

### 5.4 Commit & Merge

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `commitAndMergeWorktree` | mesh-agent | 1 | Commits agent work and merges to target branch — logged for git audit trail and conflict detection. |
| `executeTask` | mesh-agent | 1 | Top-level task execution orchestrator — wraps the full execute lifecycle; logs total duration and final status. |
| `executeCollabTask` | mesh-agent | 1 | Executes a collaborative task — logs collab session binding and participant role. |

---

## 6. SECURITY & ENFORCEMENT LAYER

### 6.1 Command Validation (exec-safety)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `validateExecCommand` | exec-safety | 1 | Validates a shell command before execution — logs the command and validation result; security-critical gate. |
| `isAllowedExecCommand` | exec-safety | 1 | Checks command against allowlist — logs allowed/denied decisions for security audit. |
| `checkDestructivePatterns` | exec-safety | 2 | Scans for destructive shell patterns (rm -rf, etc.) — logs pattern matches to track dangerous command attempts. |
| `containsShellChaining` | exec-safety | 2 | Detects shell chaining operators (;, &&, pipes) — logged to identify attempts to bypass command validation. |

### 6.2 Mechanical Harness (pre/post checks)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `runMeshHarness` | mesh-harness | 1 | Runs the full mechanical harness (pre+post checks) — logs pass/fail and which rules triggered. |
| `loadHarnessRules` | mesh-harness | 2 | Loads harness rule definitions — logged to track rule set version and detect missing rules. |
| `rulesByEnforcement` | mesh-harness | 3 | Categorizes rules by enforcement level — utility grouping; logged in dev for rule debugging. |
| `enforceScopeCheck` | mesh-harness | 2 | Validates agent stayed within allowed scope — logs scope violations that block task completion. |
| `postExecutionScan` | mesh-harness | 2 | Scans agent output after execution — detects forbidden patterns, leaked secrets, or policy violations. |
| `scanOutputForBlocks` | mesh-harness | 2 | Scans for blocked content in agent output — logs blocked content categories. |
| `preCommitSecretScan` | mesh-harness | 1 | Scans staged files for secrets before commit — security-critical; always logged to prove scan occurred. |
| `postCommitValidate` | mesh-harness | 2 | Validates commit after it lands — checks for accidentally committed sensitive files. |
| `runPostCommitValidation` | mesh-harness | 2 | Runs full post-commit validation suite — aggregates all post-commit checks. |
| `formatHarnessForPrompt` | mesh-harness | 3 | Formats harness rules for LLM prompt injection — logged in dev to debug prompt construction. |

### 6.3 Role Profiles & Forbidden Patterns

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `loadRole` | role-loader | 2 | Loads an agent role definition — logs role name and capability set for debugging role assignment. |
| `findRole` | role-loader | 2 | Searches for a role by name or alias — logged to detect role resolution failures. |
| `listRoles` | role-loader | 3 | Lists all available roles — diagnostic for role inventory. |
| `validateRole` | role-loader | 2 | Validates role definition completeness — catches malformed roles before they affect agent behavior. |
| `formatRoleForPrompt` | role-loader | 3 | Formats role for LLM prompt — logged in dev to debug role prompting. |
| `checkForbiddenPatterns` | role-loader | 1 | Checks agent actions against forbidden patterns — security enforcement; always logged. |

### 6.4 Coding Rules & Framework Detection

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `loadAllRules` | rule-loader | 2 | Loads all coding rules — logged to confirm rule set is complete on startup. |
| `matchRules` | rule-loader | 2 | Matches applicable rules for a given context — logs which rules activate for each task. |
| `formatRulesForPrompt` | rule-loader | 3 | Formats rules for LLM prompt — logged in dev for prompt debugging. |
| `detectFrameworks` | rule-loader | 2 | Detects project frameworks (React, Next.js, etc.) — logs detected frameworks to explain why certain rules activate. |
| `activateFrameworkRules` | rule-loader | 2 | Activates rules specific to detected frameworks — logged to trace rule activation chain. |

---

## 7. MEMORY SYSTEM

### 7.1 Memory Budget & Session Management

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `startSession` | memory-budget | 1 | Initializes a new memory budget session — logs budget limits and session binding. |
| `endSession` | memory-budget | 1 | Closes a memory budget session — logs total consumption and whether budget was exceeded. |
| `addEntry` | memory-budget | 2 | Adds an entry to the memory budget — tracks incremental consumption for budget forecasting. |
| `getRendered` | memory-budget | 2 | Retrieves rendered memory content — logged to track render frequency and output size. |
| `reload` | memory-budget | 2 | Reloads memory budget from disk — logged to detect stale budget state after crashes. |
| `getStats` | memory-budget | 3 | Returns budget usage statistics — high-frequency read; dev-mode logging. |
| `getMeterDisplay` | memory-budget | 3 | Formats budget meter for display — utility; logged in dev. |

### 7.2 Session Store (SQLite)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `importSession` | session-store | 2 | Imports a session transcript into SQLite — logs session ID, token count, and import duration. |
| `importDirectory` | session-store | 2 | Batch imports a directory of session files — logs file count and total import time. |
| `search` | session-store | 2 | Full-text search across stored sessions — logs query and result count for search quality analysis. |
| `updateSummary` | session-store | 2 | Updates session summary/metadata — logged to track summary generation. |
| `getSession` | session-store | 2 | Retrieves a stored session — basic read operation. |
| `listSessions` | session-store | 2 | Lists all stored sessions — diagnostic for session inventory. |
| `getStats` | session-store | 3 | Returns store statistics — high-frequency health check. |
| `close` | session-store | 2 | Closes the SQLite connection — logged to confirm clean shutdown. |

### 7.3 Pre-Compression Flush

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `shouldFlush` | pre-compression-flush | 2 | Determines if memory should be flushed before compression — logs flush decision and trigger reason. |
| `extractFacts` | pre-compression-flush | 2 | Extracts important facts from session before compression — logs fact count and extraction quality. |
| `runFlush` | pre-compression-flush | 2 | Executes the pre-compression flush — logs bytes saved and facts preserved. |

### 7.4 Transcript Parsing

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `detectFormat` | transcript-parser | 3 | Detects transcript file format (JSONL, plain text) — utility; logged in dev. |
| `parseLine` | transcript-parser | 3 | Parses a single transcript line — very high frequency; dev-mode only. |
| `parseJsonlFile` | transcript-parser | 2 | Parses an entire JSONL transcript file — logs file size, line count, and parse duration. |
| `estimateFileTokens` | transcript-parser | 2 | Estimates token count for a file — logged to track budget consumption accuracy. |

---

## 8. LOCAL WORKSPACE DAEMONS

### 8.1 Memory Daemon (lifecycle, phases, transitions)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `detectActivity` | memory-daemon | 1 | Detects whether a Claude session is actively running — primary signal for daemon phase transitions. |
| `runPhase0Bootstrap` | memory-daemon | 2 | Bootstrap phase — initializes daemon state on startup; logs configuration and initial conditions. |
| `runPhase1StatusSync` | memory-daemon | 2 | Status sync phase — synchronizes memory state with running sessions; logs sync results. |
| `runPhase2ThrottledWork` | memory-daemon | 2 | Throttled work phase — performs background memory tasks when sessions are idle; logs work items completed. |
| `handleTransitions` | memory-daemon | 1 | Handles phase transitions (idle/active/cooling) — critical state machine; always logged for debugging daemon behavior. |
| `initMemoryBudget` | memory-daemon | 2 | Initializes memory budget for current session — logs budget configuration. |
| `runSubprocess` | memory-daemon | 2 | Executes a subprocess (e.g., obsidian-sync) — logs command, exit code, and duration. |
| `saveDaemonState` | memory-daemon | 2 | Persists daemon state to disk — logged to confirm state durability across restarts. |
| `loadDaemonState` | memory-daemon | 2 | Loads persisted daemon state — logged to detect state corruption or version mismatches. |
| `loadConfig` | memory-daemon | 2 | Loads daemon configuration — logs effective config for debugging. |
| `loadTranscriptSources` | memory-daemon | 2 | Discovers transcript source directories — logs source count and paths. |
| `findCurrentJsonl` | memory-daemon | 2 | Finds the current session's JSONL file — logged to track session file resolution. |
| `findPreviousJsonl` | memory-daemon | 2 | Finds the previous session's JSONL file — logged for session continuity debugging. |

### 8.2 Obsidian Sync (vault sync, lessons propagation)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `syncToObsidian` | obsidian-sync | 1 | Top-level sync orchestrator — logs sync direction, file count, and total duration. |
| `discoverFiles` | obsidian-sync | 2 | Discovers files to sync — logs discovered count and filter criteria. |
| `routeFile` | obsidian-sync | 2 | Routes a file to its Obsidian destination — logs routing decisions for debugging path mapping. |
| `walkDir` | obsidian-sync | 3 | Walks a directory tree — low-level I/O; logged in dev for performance profiling. |
| `apiPut` | obsidian-sync | 2 | Writes a file via Obsidian API — logs write result and any API errors. |
| `apiHealthCheck` | obsidian-sync | 2 | Checks Obsidian API availability — logged to detect sync failures due to Obsidian being closed. |
| `directWrite` | obsidian-sync | 2 | Direct filesystem write fallback — logged when API is unavailable to track fallback usage. |
| `parseLessons` | obsidian-sync | 2 | Parses lessons from workspace files — logs lesson count and parse quality. |
| `propagateSharedLessons` | obsidian-sync | 2 | Propagates lessons to shared knowledge stores — logs propagation targets and success rate. |
| `loadConfig` | obsidian-sync | 3 | Loads sync configuration — startup diagnostic. |
| `loadSyncState` | obsidian-sync | 2 | Loads persistent sync state (last sync times, hashes) — logged to detect stale sync state. |
| `saveSyncState` | obsidian-sync | 2 | Saves sync state — confirms state persistence for crash recovery. |

### 8.3 Memory Maintenance (14 health checks)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `runMaintenance` | memory-maintenance | 1 | Top-level maintenance orchestrator — logs how many checks ran and how many passed/failed. |
| `checkArchival` | memory-maintenance | 2 | Checks if old sessions need archival — logged to track archival backlog. |
| `checkPredictions` | memory-maintenance | 2 | Validates prediction accuracy from previous sessions — logged for self-improvement metrics. |
| `checkStaleTasks` | memory-maintenance | 2 | Detects tasks stuck in active state — prevents memory corruption from abandoned tasks. |
| `checkMemoryFreshness` | memory-maintenance | 2 | Verifies memory files are not stale — logged to detect memory system failures. |
| `checkCompanionFreshness` | memory-maintenance | 2 | Checks companion state file freshness — ensures companion context is current. |
| `checkClawVault` | memory-maintenance | 2 | Validates ClawVault integrity — logged to detect vault corruption. |
| `checkMissionControl` | memory-maintenance | 2 | Checks MC connectivity and data freshness — logged to detect MC sync failures. |
| `checkDailyFile` | memory-maintenance | 2 | Verifies today's daily log exists and is current — logged to catch daily log generation failures. |
| `checkTimestamps` | memory-maintenance | 2 | Validates timestamp consistency across memory files — detects clock skew or file corruption. |
| `checkErrors` | memory-maintenance | 2 | Scans for error patterns in recent memory — logged to surface recurring issues. |
| `checkConsolidation` | memory-maintenance | 2 | Checks if memory consolidation is needed — logged to trigger proactive consolidation. |
| `checkGraphHealth` | memory-maintenance | 2 | Validates knowledge graph connectivity — detects orphaned nodes or broken links. |
| `checkSharedLessons` | memory-maintenance | 2 | Verifies shared lessons are propagated — logged to ensure cross-workspace lesson sync. |

### 8.4 Daily Log Writer

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `run` | daily-log-writer | 1 | Runs the daily log generation — logs whether a new daily file was created or updated. |
| `loadState` | daily-log-writer | 2 | Loads writer state (last run, deltas) — logged for continuity across runs. |
| `saveState` | daily-log-writer | 2 | Persists writer state — confirms durability for crash recovery. |
| `isSessionActive` | daily-log-writer | 2 | Checks if a session is currently active — determines whether to defer log writing. |
| `getRecapDelta` | daily-log-writer | 2 | Computes session recap changes since last run — logs delta size for content tracking. |
| `getTaskDelta` | daily-log-writer | 2 | Computes task state changes since last run — logs task progression for daily summary. |
| `getGitDelta` | daily-log-writer | 2 | Computes git commit changes since last run — logs commit count for daily summary. |

### 8.5 Subagent Audit

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `auditSession` | subagent-audit | 2 | Audits a subagent session for quality and compliance — logs audit score and flagged issues. |
| `extractResultText` | subagent-audit | 3 | Extracts result text from subagent output — utility; logged in dev for parsing debugging. |
| `classifyResult` | subagent-audit | 2 | Classifies subagent result (success/partial/failure) — logs classification for quality tracking. |
| `extractErrorPattern` | subagent-audit | 2 | Extracts error patterns from failures — logged to build error taxonomy. |
| `processResults` | subagent-audit | 2 | Batch processes subagent results — logs batch size and aggregate quality metrics. |
| `healthCheck` | subagent-audit | 3 | Checks subagent audit system health — periodic self-check. |

### 8.6 Lane Watchdog (deadlock detection)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `tailLog` | lane-watchdog | 2 | Tails the lane log for deadlock patterns — logs bytes read and pattern match rate. |
| `checkForDeadlock` | lane-watchdog | 1 | Evaluates if a lane is deadlocked — critical safety check; always logged because deadlock requires intervention. |
| `sendSigusr1` | lane-watchdog | 2 | Sends SIGUSR1 to a deadlocked process — logged because it forces a state dump for debugging. |

### 8.7 Heartbeat Detection

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `detectHeartbeat` | heartbeat-detect | 2 | Detects presence of heartbeat signal — logged to track liveness detection accuracy. |
| `isHeartbeatActive` | heartbeat-detect | 2 | Checks if heartbeat is currently active — logged to feed into stall detection logic. |

---

## 9. KANBAN & SCHEDULER

### 9.1 Task File I/O (read, parse, update)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `readTasks` | kanban-io | 2 | Reads task files from the kanban directory — logs file count and read duration. |
| `parseTasks` | kanban-io | 2 | Parses task file contents into structured data — logs parse success rate and malformed entries. |
| `updateTaskInPlace` | kanban-io | 1 | Updates a task file in place — logged because it mutates the source of truth for local task state. |

### 9.2 Kanban <-> Mesh Bridge (dispatch, events, reconciliation)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `findDispatchable` | mesh-bridge | 2 | Finds kanban tasks ready for mesh dispatch — logs dispatchable count and filter criteria. |
| `dispatchTask` | mesh-bridge | 1 | Dispatches a kanban task to the mesh — bridges local and distributed task systems; critical for task flow. |
| `reconcile` | mesh-bridge | 2 | Reconciles kanban state with mesh state — logs discrepancies found and corrections applied. |
| `handleEvent` | mesh-bridge | 2 | Handles incoming mesh events for kanban updates — logs event type and resulting kanban mutations. |
| `handleCompleted` | mesh-bridge | 2 | Processes task completion from mesh back to kanban — logs status sync from distributed to local. |
| `handleFailed` | mesh-bridge | 2 | Processes task failure from mesh back to kanban — logs failure reason propagation. |

---

## 10. HYPERAGENT SELF-IMPROVEMENT

### 10.1 Telemetry & Strategies

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `logTelemetry` | hyperagent-store | 2 | Records telemetry data point — logs metric name and value for trend analysis. |
| `getTelemetry` | hyperagent-store | 3 | Retrieves telemetry data — read operation for dashboards. |
| `getStrategies` | hyperagent-store | 2 | Lists active strategies — logged to track strategy inventory. |
| `addStrategy` | hyperagent-store | 2 | Adds a new self-improvement strategy — logs strategy definition and activation status. |
| `seedStrategy` | hyperagent-store | 2 | Seeds an initial strategy — logged to track bootstrapping of the self-improvement system. |
| `updateStrategy` | hyperagent-store | 2 | Updates strategy parameters — logs what changed for strategy evolution tracking. |
| `cmdStatus` | hyperagent CLI | 2 | Shows hyperagent system status — operator-facing health view. |
| `cmdLog` | hyperagent CLI | 3 | Displays hyperagent log — diagnostic read. |
| `cmdTelemetry` | hyperagent CLI | 2 | Displays telemetry data — operator query interface. |
| `cmdStrategies` | hyperagent CLI | 2 | Lists strategies from CLI — operator view. |
| `cmdStrategy` | hyperagent CLI | 2 | Shows single strategy detail — operator inspection. |
| `cmdSeedStrategy` | hyperagent CLI | 2 | Seeds strategy from CLI — logged for audit of manual seeding. |

### 10.2 Reflection & Synthesis

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `reflect` | hyperagent-store | 1 | Triggers self-reflection on recent performance — logs reflection output and identified improvement areas. |
| `getPendingSynthesis` | hyperagent-store | 2 | Retrieves pending synthesis items — tracks synthesis backlog. |
| `writeSynthesis` | hyperagent-store | 2 | Writes synthesis results — logs synthesized insights for knowledge evolution tracking. |
| `cmdReflect` | hyperagent CLI | 2 | Triggers reflection from CLI — operator-initiated reflection. |

### 10.3 Proposals & Approval

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `getProposals` | hyperagent-store | 2 | Lists improvement proposals — tracks proposal queue. |
| `submitProposal` | hyperagent-store | 1 | Submits a self-improvement proposal — logged to audit all proposed changes to agent behavior. |
| `approveProposal` | hyperagent-store | 2 | Approves a proposal for implementation — logs approval decision and who approved. |
| `rejectProposal` | hyperagent-store | 2 | Rejects a proposal — logs rejection reason for learning feedback. |
| `cmdProposals` | hyperagent CLI | 2 | Lists proposals from CLI — operator view. |
| `cmdApprove` | hyperagent CLI | 2 | Approves proposal from CLI — operator action. |
| `cmdReject` | hyperagent CLI | 2 | Rejects proposal from CLI — operator action. |

### 10.4 Shadow Evaluation

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `startShadowEval` | hyperagent-store | 2 | Starts a shadow evaluation (A/B test of a strategy) — logs strategy under test and evaluation criteria. |
| `endShadowEval` | hyperagent-store | 2 | Ends shadow evaluation — logs comparison results and recommendation. |
| `getStats` | hyperagent-store | 2 | Returns hyperagent system statistics — periodic health metric. |
| `close` | hyperagent-store | 2 | Closes the hyperagent store — logged for clean shutdown confirmation. |
| `cmdShadow` | hyperagent CLI | 2 | Manages shadow evaluation from CLI — operator interface. |

---

## 11. KNOWLEDGE & SEARCH

### 11.1 MCP Knowledge Server

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| server lifecycle | mcp-knowledge/server | 1 | Server start/stop/error events — logged to track knowledge server availability. |

### 11.2 Markdown Scanning & Chunking

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `scanMarkdownFiles` | mcp-knowledge/core | 2 | Scans directory for markdown files — logs file count and scan duration for indexing performance. |
| `chunkMarkdown` | mcp-knowledge/core | 2 | Chunks markdown into embeddable segments — logs chunk count and average size. |
| `splitOversized` | mcp-knowledge/core | 3 | Splits chunks exceeding size limits — utility; logged in dev for chunking tuning. |
| `hashContent` | mcp-knowledge/core | 3 | Computes content hash for change detection — utility; logged in dev. |

### 11.3 Mesh Tool Registry

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| All MeshRegistry methods | mesh-registry | 2 | Registry CRUD operations — logged to track tool registration, discovery, and deregistration across the mesh. |

---

## 12. COMMUNICATION

### 12.1 Discord Tool (read, search, channels)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `callTool` | discord-read | 2 | Invokes a Discord MCP tool — logs tool name and invocation context. |
| `readMessages` | discord-tool | 2 | Reads messages from a Discord channel — logs channel, message count, and latency. |
| `searchMessages` | discord-tool | 2 | Searches Discord messages — logs query and result count. |
| `listChannels` | discord-tool | 3 | Lists available Discord channels — read operation; logged in dev. |
| `channelInfo` | discord-tool | 2 | Gets channel metadata — logged for channel resolution debugging. |

### 12.2 Gateway Notifications

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| (Integrated into `publishEvent`, `publishCollabEvent`, `publishPlanEvent`) | mesh-task-daemon | 1 | NATS-based event publishing serves as the notification gateway — all events propagate to subscribed consumers. |

### 12.3 Teams Transport

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| TeamsTransport class methods (15) | pair-transport-teams | 2 | All Teams transport operations — logged to track message delivery, connection health, and transport errors for the Teams integration. |

---

## 13. DEPLOYMENT & PROVISIONING

### 13.1 Node Init (npx install)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `discoverNats` | openclaw-node-init | 1 | Discovers NATS server during node initialization — failure here blocks node join; always logged. |
| `setupDirectories` | openclaw-node-init | 2 | Creates required directory structure — logged to confirm filesystem readiness. |
| `installMeshCode` | openclaw-node-init | 2 | Installs mesh agent code on new node — logs installed version and component list. |
| `installService` | openclaw-node-init | 2 | Installs system service (systemd/launchd) — logs service configuration for debugging startup failures. |
| `verifyServiceRunning` | openclaw-node-init | 2 | Verifies the installed service started correctly — logged to confirm node is operational. |
| `verifyNatsHealth` | openclaw-node-init | 2 | Verifies NATS connectivity from the new node — logged to confirm mesh connectivity. |

### 13.2 Mesh Deploy

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `gitFetchAndDiff` | mesh-deploy | 2 | Fetches latest code and computes diff — logs changed file count and affected components. |
| `gitMerge` | mesh-deploy | 2 | Merges fetched code — logs merge result and conflict status. |
| `getAffectedComponents` | mesh-deploy | 2 | Determines which components need redeployment — logs component list for deploy scoping. |
| `installComponentFiles` | mesh-deploy | 2 | Installs updated component files — logs file count and install duration. |
| `restartComponentServices` | mesh-deploy | 1 | Restarts affected services — critical operation; logs restart success/failure for each component. |
| `loadDeployState` | mesh-deploy | 2 | Loads deployment state — logged for deploy continuity. |
| `saveDeployState` | mesh-deploy | 2 | Saves deployment state — confirms deploy state persistence. |

### 13.3 Fleet Deploy

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| (Covered in Section 4.6 — `discoverNodes`, `showStatus`, `fleetDeploy`) | fleet-deploy | — | See Mesh Network Layer > Fleet Management. |

### 13.4 Join Token & Node Removal

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `getOrCreateSecret` | mesh-join-token | 2 | Gets or creates the mesh join secret — logged for security audit of token generation. |
| `generateToken` | mesh-join-token | 2 | Generates a time-limited join token — logs token expiry (not the token itself) for audit. |
| `cleanNatsState` | mesh-node-remove | 1 | Cleans NATS state for a removed node — critical cleanup; ensures no orphaned subscriptions. |
| `removeLocalService` | mesh-node-remove | 2 | Removes the local system service — logged to confirm clean service teardown. |
| `purgeLocalFiles` | mesh-node-remove | 2 | Purges local mesh files — logged for cleanup audit. |

### 13.5 Harness Sync

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `diffRules` | harness-sync | 2 | Computes diff between local and remote harness rules — logs rule count differences. |
| `mergeRules` | harness-sync | 2 | Merges harness rules from remote source — logs merged rule count and conflict resolutions. |

### 13.6 Deploy Listener

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `executeDeploy` | deploy-listener | 1 | Executes a deploy received via NATS — critical autonomous operation; always logged. |
| `checkAndCatchUp` | deploy-listener | 2 | Checks for missed deploys on startup — logged to ensure deploy consistency after downtime. |

---

## 14. LLM PROVIDER ABSTRACTION

### 14.1 Provider Resolution

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `resolveProvider` | llm-providers | 1 | Resolves which LLM provider to use (Anthropic, OpenAI, etc.) — logged to track provider selection and detect fallback scenarios. |

### 14.2 Model Resolution

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `resolveModel` | llm-providers | 2 | Resolves specific model within a provider — logged to track model selection, version pinning, and cost tier. |

---

## 15. AGENT ACTIVITY (Session Monitoring)

| Function | Module | Tier | Why Logged |
|----------|--------|------|------------|
| `getProjectDir` | agent-activity | 2 | Resolves the project directory for a session — logged to track session-to-project binding. |
| `findLatestSessionFile` | agent-activity | 2 | Finds the most recent session file — logged to debug session file resolution. |
| `readLastEntry` | agent-activity | 2 | Reads the last entry from a session file — logged for activity detection accuracy. |
| `parseJsonlTail` | agent-activity | 3 | Parses the tail of a JSONL file — utility; logged in dev. |
| `getActivityState` | agent-activity | 2 | Computes current activity state (active/idle/stale) — logged to feed daemon phase transitions. |
| `getSessionInfo` | agent-activity | 2 | Gets detailed session information — logged for session diagnostics. |

---

## Total Instrumented Functions

| Source Module | Count |
|--------------|-------|
| mesh-task-daemon | 48 |
| TaskStore | 16 |
| PlanStore | 11 |
| CollabStore | 19 |
| mesh-agent | 9 |
| mesh-bridge | 6 |
| exec-safety | 4 |
| mesh-harness | 10 |
| role-loader | 6 |
| rule-loader | 5 |
| llm-providers | 2 |
| kanban-io | 3 |
| nats-resolve | 3 |
| agent-activity | 6 |
| memory-budget | 7 |
| session-store | 8 |
| hyperagent-store | 22 |
| pre-compression-flush | 3 |
| transcript-parser | 4 |
| circling-parser | 1 |
| plan-templates | 5 |
| mesh-registry | varies |
| mcp-knowledge/core | 4 |
| mcp-knowledge/server | varies |
| heartbeat-detect | 2 |
| pair-transport-teams | 15 |
| memory-daemon | 13 |
| obsidian-sync | 12 |
| memory-maintenance | 14 |
| daily-log-writer | 7 |
| subagent-audit | 6 |
| lane-watchdog | 3 |
| health-publisher | 2 |
| mesh CLI | 13 |
| fleet-deploy | 3 |
| mesh-deploy | 7 |
| deploy-listener | 2 |
| mesh-join-token | 2 |
| mesh-node-remove | 3 |
| harness-sync | 2 |
| openclaw-node-init | 6 |
| discord-read | 1 |
| discord-tool | 4 |
| hyperagent CLI | 11 |
| **Grand Total** | **~330** |

> The exact count varies slightly due to MeshRegistry and MCP knowledge server having dynamic method counts. All functions listed above are wrapped by `tracer.wrapClass()`, `tracer.wrapAsync()`, or `tracer.wrap()` and emit structured trace events through the unified observability pipeline.
