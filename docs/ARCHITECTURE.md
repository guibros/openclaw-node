# OpenClaw Architecture — Comprehensive Technical Reference

Generated: 2026-03-29
Codebase version: 2.0.0

---

## TABLE OF CONTENTS

1. [TOP LEVEL: Architecture & Vision](#1-top-level-architecture--vision)
2. [MID LEVEL: Subsystem Deep Dives](#2-mid-level-subsystem-deep-dives)
   - 2.1 Identity System
   - 2.2 Mesh Networking
   - 2.3 Mission Control Dashboard
   - 2.4 Memory System
   - 2.5 Task Lifecycle
   - 2.6 Security Layer
   - 2.7 Deployment & Services
   - 2.8 Skills System
   - 2.9 Souls System
   - 2.10 MCP Knowledge Server
3. [LOW LEVEL: Key Implementation Details](#3-low-level-key-implementation-details)

---

# 1. TOP LEVEL: Architecture & Vision

## 1.1 What is OpenClaw?

OpenClaw is an autonomous AI agent infrastructure platform. It solves the problem of running persistent, self-improving AI agents across multiple machines with shared memory, distributed task execution, mechanical enforcement of coding standards, and a human-in-the-loop approval system.

The core agent identity is "Daedalus" -- an orchestrator agent that manages specialist sub-agents (souls), delegates work via a mesh network, persists memory across sessions, and self-improves through a telemetry/reflection/proposal loop (HyperAgent Protocol).

The primary user is a solo developer ("Gui") who operates the system from a macOS lead node, with optional Ubuntu worker nodes connected via Tailscale VPN. The system supports any LLM backend (Claude, OpenAI, shell commands) through a provider abstraction layer.

## 1.2 Overall System Architecture

OpenClaw is a **two-node mesh** (expandable to N nodes) with clear role separation:

```
LEAD NODE (macOS)                    WORKER NODE (Ubuntu)
+----------------------------+       +----------------------------+
| Mission Control (Next.js)  |       | mesh-agent.js              |
| mesh-task-daemon.js        |       | mesh-health-publisher.js   |
| mesh-bridge.js             |       | mesh-deploy-listener.js    |
| mesh-agent.js              |       |                            |
| mesh-health-publisher.js   |       +----------------------------+
| memory-daemon              |                  |
| knowledge-server (MCP)     |                  |
| lane-watchdog              |                  |
| gateway                    |                  |
+----------------------------+                  |
             |                                  |
             +---------- NATS (4222) ----------+
             |       (over Tailscale VPN)       |
             +----------------------------------+
```

**Node roles:**
- **Lead** (macOS): Runs the task daemon, bridge, Mission Control, memory daemon, knowledge server. Owns task coordination.
- **Worker** (Linux): Runs mesh-agent to claim and execute tasks. Can also run Mission Control and health publisher.
- **Both**: mesh-agent, health-publisher, deploy-listener, Mission Control, gateway, lane-watchdog, memory-daemon.

## 1.3 Major Subsystems

| Subsystem | Purpose | Key Files |
|-----------|---------|-----------|
| **Identity** | Soul definitions, boot sequence, principles | `identity/SOUL.md`, `AGENTS.md`, `PRINCIPLES.md`, `DELEGATION.md` |
| **Mesh Network** | Distributed task execution via NATS | `bin/mesh-*.js`, `lib/mesh-*.js` |
| **Mission Control** | Next.js web dashboard (kanban, memory, souls) | `mission-control/src/` |
| **Memory** | Multi-layer persistence (markdown, SQLite, ClawVault) | `lib/memory-budget.mjs`, `lib/session-store.mjs` |
| **Task Engine** | Kanban file parsing, scheduling, wave computation | `lib/kanban-io.js`, MC `lib/scheduler.ts` |
| **Security** | Exec safety, harness rules, scope enforcement | `lib/exec-safety.js`, `lib/mesh-harness.js` |
| **Skills** | 109 skill definitions for agent capabilities | `skills/*/SKILL.md` |
| **Souls** | 6 specialist agent identities with evolution | `souls/*/SOUL.md`, `registry.json` |
| **HyperAgent** | Self-improving loop: telemetry, reflection, proposals | `lib/hyperagent-store.mjs`, `bin/hyperagent.mjs` |
| **Knowledge** | Semantic search via local embeddings + sqlite-vec | `lib/mcp-knowledge/core.mjs`, `server.mjs` |
| **Plans** | YAML-based multi-phase workflows with dependency waves | `lib/mesh-plans.js`, `lib/plan-templates.js` |

## 1.4 Deployment Model

- **macOS**: Uses `launchd` plist files for service management
- **Linux**: Uses `systemd` user services
- **NATS**: Message bus running on the Ubuntu node (port 4222), all nodes connect via Tailscale
- **Tailscale**: WireGuard-based VPN mesh providing encrypted connectivity
- **Installation**: Single `bash install.sh` command; `--update` for incremental; `--enable-services` to auto-start

The installer (`install.sh`) is ~1,200 lines of bash that:
1. Installs system dependencies (Node.js 18+, Python 3, SQLite3, build-essential)
2. Creates `~/.openclaw/` directory tree
3. Copies identity, skills, souls, scripts, configs
4. Installs Mission Control (Next.js) dependencies
5. Generates runtime config from templates
6. Sets up systemd/launchd services
7. Deploys path-scoped coding rules
8. Installs Claude Code hooks + git hooks
9. Merges enforcement settings into `settings.json`

Services declared in `services/service-manifest.json`:

| Service | Role | Autostart |
|---------|------|-----------|
| mesh-task-daemon | lead | yes |
| mesh-bridge | lead | yes |
| mesh-agent | both | no (manual start) |
| mesh-health-publisher | both | yes |
| mesh-deploy-listener | both | yes |
| mesh-tool-discord | lead | yes |
| mission-control | both | yes |
| gateway | both | yes |
| lane-watchdog | both | yes |
| memory-daemon | both | yes |
| log-rotate | both | yes (timer) |

## 1.5 Data Flow

```
User (Gui)
    |
    v
Daedalus (Claude Code CLI / Gateway / Discord)
    |
    |-- edits memory/active-tasks.md (file-driven kanban)
    |
    v
Mission Control (Next.js @ localhost:3000)
    |-- polls active-tasks.md every 3s
    |-- syncs to SQLite (drizzle-orm)
    |-- renders kanban board
    |-- scheduler tick: evaluates triggers, computes waves
    |
    v
mesh-bridge.js (kanban -> NATS)
    |-- reads active-tasks.md for execution=mesh tasks
    |-- submits to mesh-task-daemon via NATS
    |-- subscribes to mesh.events.> for results
    |-- writes results back to active-tasks.md
    |
    v
mesh-task-daemon.js (NATS coordinator)
    |-- NATS KV bucket: MESH_TASKS
    |-- handles: submit, claim, start, complete, fail, heartbeat
    |-- enforces budgets (auto-fail), detects stalls (auto-release)
    |-- manages collab sessions (MESH_COLLAB bucket)
    |-- manages plans (MESH_PLANS bucket)
    |
    v
mesh-agent.js (worker on any node)
    |-- claims task via NATS request/reply
    |-- constructs prompt (task + rules + harness + role)
    |-- spawns LLM CLI (claude/openai/shell)
    |-- evaluates metric (exit code 0 = pass)
    |-- retries with failure context (Karpathy loop)
    |-- reports completion/failure via NATS
    |-- git worktree isolation per task
    |
    v
Results flow back through the same chain:
mesh-agent -> NATS events -> mesh-bridge -> active-tasks.md -> Mission Control
```

---

# 2. MID LEVEL: Subsystem Deep Dives

## 2.1 Identity System

**Files:** `identity/SOUL.md`, `AGENTS.md`, `PRINCIPLES.md`, `DELEGATION.md`, `MEMORY_SPEC.md`, `HEARTBEAT.md`, `TOOLS.md`, `CLAUDE.md`

### Boot Sequence

Every session follows a strict two-tier read order optimized for prompt cache hits:

**Tier 1 -- Identity (stable, cacheable):**
1. `SOUL.md` -- personality, voice, boundaries, productive flaws
2. `PRINCIPLES.md` -- 11 decision heuristics with priority ordering
3. `AGENTS.md` -- operational rules, memory protocol, task lifecycle rules

**Tier 2 -- Session State (dynamic):**
4. `.companion-state.md` -- immediate session context (mandatory)
5. `memory/active-tasks.md` -- current work state
6. `.learnings/lessons.md` -- accumulated corrections
7. `memory/YYYY-MM-DD.md` -- today's daily journal
8. `MEMORY.md` -- long-term curated memory (main sessions only)
9. `clawvault-local wake` -- recover active context
10. Check Mission Control is running

**Lazy-loaded:** `TOOLS.md` (environment notes), `memory/task-backlog.md` (504 queued tasks, only when activating a phase)

### Decision Stack

When principles conflict, resolution order is:
1. Safety, privacy, security
2. Truthfulness and evidence
3. User intent and outcomes
4. Speed and convenience
5. Style and polish

### Delegation Protocol

The delegation system (`DELEGATION.md`) defines:

- **Trust tiers**: new (0 tasks) -> developing (3+, >=0.50) -> proven (10+, >=0.65) -> expert (25+, >=0.80)
- **Circuit breaker**: 3 consecutive failures -> OPEN (30min cooldown) -> HALF_OPEN (1 probe) -> CLOSED
- **Contract template**: Every sub-agent prompt must include Deliverable, Verification, Boundaries, Budget, Escalation
- **Task granularity**: 2-5 minutes per delegated task; >5min = decompose; <2min = do inline
- **Two-stage review**: Stage 1 (spec compliance), Stage 2 (code quality). Expert-tier: stage 1 only.
- **Re-delegation**: retry with enriched context -> different soul -> higher capability tier -> escalate to human

### Soul Routing Guide

| Task Domain | Primary Soul | QA Soul | Escalation |
|------------|-------------|---------|------------|
| Smart contract | blockchain-auditor | qa-evidence | Daedalus |
| Narrative/lore | lore-writer | qa-evidence | Daedalus |
| CI/CD, deployment | infra-ops | qa-evidence | Daedalus |
| Identity/trust/SBT | identity-architect | blockchain-auditor | Daedalus |
| Cross-domain | Daedalus | multi-model review | Gui |

### Memory Specification (MEMORY_SPEC.md)

Defines the portable structural contract for any OpenClaw node:
- 5-tier file structure (identity, dynamic state, temporal, automation, optional infrastructure)
- 6 file format contracts with validation rules
- 9 automation requirements (Principle 11 compliance)
- 5-phase compliance check protocol with auto-repair
- Compliance scoring: 100% fully compliant -> <50% structurally broken

---

## 2.2 Mesh Networking

### Components

| Component | File | Role |
|-----------|------|------|
| Task Daemon | `bin/mesh-task-daemon.js` | Central coordinator on NATS |
| Mesh Agent | `bin/mesh-agent.js` | Worker that claims and executes tasks |
| Mesh Bridge | `bin/mesh-bridge.js` | Kanban <-> NATS bidirectional sync |
| Mesh CLI | `bin/mesh.js` | Short-lived CLI for mesh interaction |
| Task Store | `lib/mesh-tasks.js` | Task schema + NATS KV helpers |
| Collab Store | `lib/mesh-collab.js` | Multi-node collaboration sessions |
| Plan Store | `lib/mesh-plans.js` | Multi-phase plan decomposition |
| Registry | `lib/mesh-registry.js` | Tool registry (implemented but unused) |
| NATS Resolver | `lib/nats-resolve.js` | 4-step URL + auth resolution chain |
| LLM Providers | `lib/llm-providers.js` | Provider abstraction (claude, openai, shell) |

### Task Flow: Submit -> Claim -> Execute -> Result

**1. Submit** (via bridge or CLI):
```
mesh.tasks.submit -> { task_id, title, description, budget_minutes, metric, scope, ... }
```
Task is stored in `MESH_TASKS` JetStream KV bucket with status `queued`.

**2. Claim** (agent polls):
```
mesh.tasks.claim -> { node_id }
```
Daemon finds highest-priority queued task, respects `exclude_nodes` and `preferred_nodes`, checks `depends_on` completion, uses CAS (compare-and-swap) to atomically claim.

**3. Execute** (agent runs LLM):
- Creates git worktree (`~/.openclaw/worktrees/<task_id>`)
- Constructs prompt: task description + success criteria + metric + scope + coding rules + harness rules + role profile
- Spawns LLM CLI via provider abstraction
- Sends heartbeats every 60s to prevent stall detection
- If metric defined: runs metric command, checks exit code

**4. Iterate** (Karpathy pattern):
- If metric fails: logs attempt (approach, result, keep/discard), builds retry prompt with failure context
- Attempt 3+: "Try a fundamentally different strategy"
- Max attempts configurable (default 3)

**5. Complete/Fail**:
- On success: `mesh.tasks.complete` -> runs role validation -> marks completed or pending_review
- On failure: `mesh.tasks.fail` -> cascades through plan if applicable -> creates escalation task if role has escalation mapping
- On budget exceeded: auto-fail by daemon enforcement loop (every 30s)
- On stall (no heartbeat for 5min): auto-release for human triage

### Collaboration Protocol

Four modes of multi-node collaboration:

| Mode | Description |
|------|-------------|
| `parallel` | All nodes work simultaneously, merge at convergence |
| `sequential` | Nodes take turns in order |
| `review` | One leader + N reviewers |
| `circling_strategy` | 1 Worker + 2 Reviewers, asymmetric directed rounds |

**Circling Strategy** (most sophisticated):

State machine:
```
[init] -> [circling/SR1/step1] -> [step2] -> [SR2/step1] -> ... -> [finalization] -> [complete]
```

- **Init**: Worker produces `workArtifact v0`, Reviewers produce `reviewStrategy`
- **Step 1 (Review Pass)**: Worker analyzes review strategies; Reviewers review workArtifact
- **Step 2 (Integration)**: Worker judges findings (ACCEPT/REJECT/MODIFY); Reviewers refine strategy using cross-review
- **Finalization**: Worker produces final artifact + completionDiff; Reviewers vote
- **Gate behavior**: Tier 1 = autonomous; Tier 2 = gate on finalization; Tier 3 = gate every sub-round

Key features: directed handoffs (each node sees only role-specific inputs), cross-review between reviewers, adaptive convergence, delimiter-based LLM output parsing, session blob monitoring (warns at 800KB, critical at 950KB).

### Plan Pipelines

Plans decompose parent tasks into subtasks with dependency waves:

```yaml
# Example plan template: team-feature
phases:
  - design: { mode: soul, soul_id: identity-architect }
  - review: { mode: collab_mesh, convergence: unanimous }
  - implement: { mode: solo_mesh, metric: "npm test" }
  - test: { mode: solo_mesh, metric: "npm run test:e2e" }
  - code_review: { mode: collab_mesh, convergence: majority }
```

Failure policies: `continue_best_effort`, `abort_on_first_fail`, `abort_on_critical_fail`.

Wave computation uses BFS topological sort on the dependency DAG. Tasks in the same wave execute concurrently.

### NATS Subjects

| Subject | Protocol | Purpose |
|---------|----------|---------|
| `mesh.tasks.submit` | req/reply | Submit new task |
| `mesh.tasks.claim` | req/reply | Agent claims work |
| `mesh.tasks.start` | req/reply | Agent signals work started |
| `mesh.tasks.complete` | req/reply | Agent reports success |
| `mesh.tasks.fail` | req/reply | Agent reports failure |
| `mesh.tasks.attempt` | req/reply | Agent logs iteration |
| `mesh.tasks.heartbeat` | req/reply | Stall detection signal |
| `mesh.tasks.release` | req/reply | Release for human triage |
| `mesh.tasks.list` | req/reply | List tasks with filter |
| `mesh.tasks.get` | req/reply | Get single task |
| `mesh.tasks.cancel` | req/reply | Cancel task |
| `mesh.events.>` | pub/sub | All state change events |
| `mesh.collab.<sessionId>.recruit` | pub/sub | Collab recruitment signal |
| `mesh.tool.<nodeId>.<tool>.<method>` | req/reply | Remote tool invocation |
| `openclaw.<nodeId>.exec` | req/reply | Remote command execution |
| `openclaw.<nodeId>.heartbeat` | pub/sub | Node heartbeat |

### KV Buckets

| Bucket | Purpose | TTL |
|--------|---------|-----|
| `MESH_TASKS` | Task state storage | none |
| `MESH_COLLAB` | Collaboration session state | none |
| `MESH_PLANS` | Plan decomposition state | none |
| `MESH_TOOLS` | Tool registry (unused) | 120s |

---

## 2.3 Mission Control Dashboard

**Stack:** Next.js 14 (App Router), SQLite (drizzle-orm), Tailwind CSS, SWR for data fetching.

**URL:** `http://localhost:3000`

### Pages

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `page.tsx` | Task board (kanban + daily views) |
| `/live` | `live/page.tsx` | Live session view (chat bubbles, audio spectrum) |
| `/memory` | `memory/page.tsx` | Memory browser (search, categories, docs) |
| `/mesh` | `mesh/page.tsx` | Mesh network status and task management |
| `/graph` | `graph/page.tsx` | Knowledge graph visualization |
| `/souls` | `souls/page.tsx` | Soul management, evolution, spawning |
| `/cowork` | `cowork/page.tsx` | Collaborative session management |
| `/burndown` | `burndown/page.tsx` | Burndown charts |
| `/roadmap` | `roadmap/page.tsx` | Project roadmap (Gantt-style) |
| `/calendar` | `calendar/page.tsx` | Calendar view of scheduled tasks |
| `/diagnostics` | `diagnostics/page.tsx` | System diagnostics |
| `/obsidian` | `obsidian/page.tsx` | Obsidian vault browser (graph, backlinks, file tree) |
| `/settings` | `settings/page.tsx` | Settings management |

### Main Board Components

- **StatusBanner**: Shows current session state from `.companion-state.md`
- **SkillHealthCard**: Displays skill health status
- **KanbanBoard**: 4-column board (Backlog, In Progress, Review, Done)
- **DailyBoard**: Calendar-based task view
- **ActivityTimeline**: Recent task activity log
- **TaskCard**: Individual task display with mesh execution details
- **UnifiedTaskDialog**: Task creation/editing with all fields including mesh routing
- **ExecutionConfig**: Mesh execution configuration (provider, node selection, collab)
- **LiveStream**: Real-time agent activity stream

### API Routes

~50 API routes covering:
- **Tasks**: CRUD, hierarchy (tree), handoffs, bulk operations
- **Memory**: Items, search (FTS5), categories, consolidation, graph, wikilinks, sync, flush
- **Mesh**: Tasks, events (SSE), nodes, identity, tokens
- **Scheduler**: Tick (trigger evaluation), waves (dependency computation)
- **Souls**: List, prompt generation, evolution log, cross-soul propagation
- **Cowork**: Clusters, sessions, dispatch, events, intervention
- **System**: Activity, diagnostics, screenshots, workspace files, settings

### Authentication

`middleware.ts` protects all `/api/*` routes with Bearer token auth:
- Token from `MC_AUTH_TOKEN` env var
- If unset, auth is disabled (localhost-only deployments)
- SSE endpoints accept token as query parameter
- Constant-time comparison to prevent timing attacks
- 1MB body size limit on mutation requests

### Sync Architecture

The dashboard maintains a bidirectional sync between `memory/active-tasks.md` (file, source of truth for agents) and SQLite (fast queries, UI state):

1. **File -> DB**: `syncTasksFromMarkdown()` reads the markdown, parses each task block, upserts into SQLite. Only runs when file mtime changes externally. 5s debounce prevents redundant re-imports.
2. **DB -> File**: `syncTasksToMarkdown()` writes DB state back to markdown after drag-and-drop or UI edits.
3. **Status mapping**: `queued/ready -> backlog`, `submitted/running/blocked -> in_progress`, `waiting-user -> review`, `done/cancelled -> done`
4. **Done gate**: If markdown says "done" but `needsApproval=true` and DB status is not already done, redirects to "waiting-user"

---

## 2.4 Memory System

### Layers

| Layer | Storage | Purpose | Staleness |
|-------|---------|---------|-----------|
| `memory/YYYY-MM-DD.md` | Markdown files | Daily raw journal | 30 days then archive |
| `MEMORY.md` | Markdown file | Curated long-term memory | 7 days max |
| `.companion-state.md` | Markdown file | Immediate session context | 4 hours if active |
| `memory/active-tasks.md` | Markdown file | Running/blocked/done tasks | 48 hours |
| `.learnings/lessons.md` | Markdown file | Corrections and preferences | 30 days |
| `state.db` (sessions) | SQLite FTS5 | Episodic recall | persistent |
| `state.db` (hyperagent) | SQLite | Performance telemetry | persistent |
| `.knowledge.db` | SQLite + sqlite-vec | Semantic search vectors | auto-reindex |
| `memory-vault/` | ClawVault | Structured knowledge vault | manual |
| Mission Control SQLite | SQLite (drizzle-orm) | Dashboard state, memory items | sync from files |

### Memory Budget (`lib/memory-budget.mjs`)

Enforces a hard 2,200-character cap on MEMORY.md with frozen-snapshot semantics:
- **Session start**: Snapshot MEMORY.md, freeze for prompt injection
- **Mid-session writes**: Persist to disk but do NOT mutate the active prompt snapshot
- **Reload**: After compression rebuild or new session
- **Over budget**: Trim oldest entries first; if still over, reject write
- **Events**: `add`, `warning` (80%), `trim`, `freeze`, `reload`

### Session Store (`lib/session-store.mjs`)

SQLite episodic recall database at `~/.openclaw/state.db`:
- **Tables**: `sessions` (id, source, start/end, summary) + `messages` (session_id, role, content, turn_index)
- **FTS5**: Virtual table `messages_fts` with auto-sync triggers on insert/update/delete
- **Search**: Ranked by `(match_count x recency_weight)`, context windows around matches with merged overlapping ranges
- **Import**: Format-agnostic JSONL import via `transcript-parser.mjs`

### HyperAgent Store (`lib/hyperagent-store.mjs`)

Self-improving agent loop persistence (same `state.db`):
- **ha_telemetry**: Per-task performance data with auto-detected pattern flags (`repeated-approach`, `multiple-iterations`, `always-escalated`, `no-meta-notes`)
- **ha_strategies**: Reusable approaches indexed by domain/subdomain, versioned with supersedes chain
- **ha_reflections**: Periodic structured analysis (raw stats + LLM synthesis)
- **ha_proposals**: Self-modification proposals with shadow eval + human approval gate
- **ha_telemetry_proposals**: Junction table for overlapping eval windows

HyperAgent loop:
```
Task completes -> Telemetry logged (auto-detected flags)
    -> 5 tasks accumulate
    -> Daemon triggers reflection
    -> Agent synthesizes hypotheses + proposals
    -> Human reviews proposals (safety gate)
    -> Approved proposals update strategy archive
    -> Next task consults strategies
```

### Mission Control Memory

MC has its own memory subsystem:
- **memory_items**: Extracted atomic facts with confidence scores, gate decisions, temporal chains (supersededBy)
- **memory_docs**: Indexed markdown documents with frontmatter parsing
- **Categories**: work, preferences, people, projects, technical, relationships
- **Wikilinks**: Cross-reference extraction between documents
- **Graph**: Relationship visualization between memory items

---

## 2.5 Task Lifecycle

### States

```
queued -> ready -> submitted -> claimed -> running -> completed
                                              |           |
                                              v           v
                                          pending_review  failed
                                              |           |
                                              v           v
                                          completed    released
                                                          |
                                                          v
                                                       cancelled
```

Terminal states: `completed`, `failed`, `released`, `cancelled`, `rejected`.

### File-Driven Kanban

The kanban board is file-driven, NOT API-driven. The source of truth is `memory/active-tasks.md`:

```yaml
## Live Tasks

- task_id: T-20260315-001
  title: Implement token expiry logic
  status: running
  owner: Daedalus
  execution: mesh
  metric: npm test
  budget_minutes: 30
  scope:
    - contracts/Token.sol
    - test/Token.test.js
  success_criteria:
    - Token expires after 30 days
    - Tests pass with 100% coverage
  next_action: Writing expiry check function
  updated_at: 2026-03-15 14:30 America/Montreal
```

- Agents edit this file directly (no API calls)
- Mission Control polls it every 3 seconds (mtime-based change detection)
- mesh-bridge polls it every 10 seconds for mesh-dispatchable tasks
- File locking via `mkdir` (atomic on POSIX) prevents concurrent write corruption

### Scheduler

`mission-control/src/lib/scheduler.ts` runs a `schedulerTick()` function:

**Phase 1 -- Trigger Evaluation:**
- One-shot triggers (`trigger_kind=at`): fire when `trigger_at <= now`
- Cron triggers: evaluate cron expression, 20-minute detection window
- Recurring tasks: auto-recreate after completion

**Phase 2 -- Auto-Dispatch:**
- Finds tasks with `needsApproval=0` (auto-start), status `queued`
- Computes dependency waves via BFS topological sort
- Dispatches ONE task at a time (V1 serial safety)
- Writes signal file to notify agent of dispatched task

### Task Markdown Parser

`mission-control/src/lib/parsers/task-markdown.ts`:
- Parses `## Live Tasks` section
- Each block starts with `- task_id:`, subsequent fields indented by 2 spaces
- Array fields (success_criteria, artifacts, scope) use 4-space indented `- ` lines
- Supports ~30 fields including mesh routing (llm_provider, preferred_nodes, collaboration)

### Wave Computation

Both `lib/mesh-plans.js` (daemon-side) and `mission-control/src/lib/scheduler.ts` (MC-side) implement the same BFS wave algorithm:
1. Build in-degree map from dependency graph
2. Layer 0 = all nodes with in-degree 0 (independent tasks)
3. Layer N+1 = nodes whose predecessors are all in layers <= N
4. Tasks within a wave execute concurrently

---

## 2.6 Security Layer

### Three-Layer Architecture

**Layer 1: Coding Rules** (`config/rules/`)
- Path-scoped markdown files with YAML frontmatter
- Tier precedence: `project (20) > framework (10) > universal (0)`
- Framework auto-detection: `hardhat.config.js` -> Solidity rules, `tsconfig.json` -> TypeScript rules
- Capped at 4,000 characters per prompt injection
- Shipped rules: security, test-standards, design-docs, git-hygiene, solidity, typescript, unity

**Layer 2: Harness Rules** (`config/harness-rules.json`)
- 12 behavioral rules with dual enforcement: prompt injection + mechanical validation
- Enforcement types: `scope_check`, `post_scan`, `post_validate`, `pre_commit_scan`, `output_block`, `metric_required`, `pre_check`
- Includes HyperAgent integration rules (task-close telemetry, task-start strategy lookup, reflection synthesis)

**Layer 3: Role Profiles** (`config/roles/*.yaml`)
- Domain-specific responsibilities, must_not boundaries, required_outputs, forbidden_patterns
- Auto-assigned from task scope via glob matching
- Shipped roles: `solidity-dev`, `qa-engineer`, `tech-architect`

### Mechanical Enforcement (`lib/mesh-harness.js`)

Post-execution checks that run regardless of LLM compliance:

| Check | Implementation | Blocks? |
|-------|---------------|---------|
| **Scope enforcement** | `git diff` vs `task.scope`, reverts out-of-scope files | Yes (revert + retry) |
| **Post-execution scan** | Regex on LLM stdout for error patterns | Warning |
| **Output block** | Regex for destructive commands (`rm -rf`, `sudo`) | Yes |
| **Pre-commit scan** | gitleaks + regex for secrets in staged diff | Yes |
| **Conventional commits** | Regex on commit message format | Warning |
| **Role validation** | `required_outputs` (file patterns) + `forbidden_patterns` (regex on files) | Forces review |

### Exec Safety (`lib/exec-safety.js`)

Two-layer command filtering for remote execution:

**Blocklist** (always active): 17 destructive patterns including `rm -rf`, `mkfs`, `dd of=`, `curl|sh`, `sudo`, `kill -9 1`, etc.

**Shell chaining detection**: Blocks `; ` ` $()`, `||`, `&&`, `>>`, redirects. Allows safe pipes to `grep`, `head`, `tail`, `wc`, `sort`.

**Dangerous flag detection**: `node -e/--eval`, `git -c/--config`, `find -exec/-delete`, `make SHELL=`, `python -c`.

**Server-side allowlist** (for NATS exec): Only permits commands starting with known-safe prefixes: `git`, `node`, `python`, `npm test/run/install`, `cat`, `ls`, `grep`, etc.

### API Authentication

Mission Control uses Bearer token auth (`MC_AUTH_TOKEN` env var) with:
- Constant-time string comparison (Edge Runtime compatible)
- 1MB body size limit
- SSE endpoints accept token as query parameter
- Auth disabled when no token configured (localhost-only mode)

---

## 2.7 Deployment & Services

### Installation Flow

```bash
bash install.sh              # Full install
bash install.sh --update     # Refresh scripts/configs, skip deps
bash install.sh --dry-run    # Preview without changes
bash install.sh --role=lead  # Force node role
```

**Steps:**
1. Detect OS (macOS/Linux), check system deps
2. Create `~/.openclaw/` directory tree (~15 subdirectories)
3. Copy identity files, skills (109), souls (6), scripts, configs
4. Generate `openclaw.json` runtime config from template + env
5. Install Mission Control (`npm ci` in Next.js project)
6. Deploy services (launchd plists or systemd units)
7. Deploy path-scoped coding rules (universal + framework-detected)
8. Deploy plan templates (`team-feature`, `team-bugfix`, `team-deploy`)
9. Install Claude Code hooks (session-start, validate-commit, validate-push, pre-compact, session-stop, log-agent)
10. Install git hooks (pre-commit, pre-push)
11. Merge enforcement settings into `settings.json` without overwriting user config

### Mesh Installation

`mesh-install.sh` additionally deploys NATS on the lead node and configures Tailscale-based connectivity.

### Uninstallation

```bash
bash uninstall.sh          # Remove services and scripts (keep data)
bash uninstall.sh --purge  # Remove everything including all data
```

### Configuration Files

| File | Purpose |
|------|---------|
| `~/.openclaw/openclaw.env` | User-editable: NATS URL, auth token, node role |
| `~/.openclaw/openclaw.json` | Generated runtime config |
| `~/.openclaw/harness-rules.json` | Behavioral enforcement rules |
| `~/.openclaw/config/daemon.json` | Memory daemon config |
| `~/.openclaw/config/obsidian-sync.json` | Obsidian vault sync settings |
| `~/.openclaw/config/transcript-sources.json` | Transcript import sources |

---

## 2.8 Skills System

**109 skills** organized as directories under `skills/`, each containing:
- `SKILL.md` -- Skill definition with instructions, anti-patterns, usage examples
- `rules/` (optional) -- Skill-specific coding rules

Skills are referenced by soul `capabilities.json` and loaded on-demand. Categories span:

- **Development**: `arcane-dev-ops`, `frontend-design`, `git-essentials`, `github`
- **AI/ML**: `deep-research`, `gemini`, `gemini-deep-research`, `prompt-guard`
- **Business**: `company-research`, `customer-journey-map`, `discovery-process`, `epic-breakdown-advisor`
- **Finance**: `crypto-price`, `finance-metrics-quickref`, `finance-based-pricing-advisor`
- **Content**: `flavor-text-writer`, `twitter`, `video-to-social-media`
- **Tools**: `1password`, `google-drive`, `n8n-workflow-automation`, `excel`
- **Security**: `clawguard`, `clawdbot-security-check`
- **Infrastructure**: `fast-browser-use`, `agent-browser`, `byterover`

Every SKILL.md must include `## Anti-Patterns` with 2-5 "don't do X -- instead do Y" entries.

---

## 2.9 Souls System

**6 souls** defined in `souls/` with a central registry (`registry.json`):

| Soul | Type | Specializations |
|------|------|----------------|
| **daedalus** | orchestrator | orchestration, multi-agent, planning, execution |
| **blockchain-auditor** | specialist | solidity, security, formal-verification |
| **identity-architect** | specialist | cryptographic-identity, trust-systems, delegation-chains |
| **infra-ops** | specialist | infrastructure, ci-cd, deployment, monitoring |
| **lore-writer** | specialist | narrative, world-building, game-lore |
| **qa-evidence** | specialist | quality-assurance, visual-verification, performance-testing |

### Soul Structure

Each soul directory contains:
- `SOUL.md` -- Identity, principles, workflow, boundaries
- `PRINCIPLES.md` -- Domain-specific decision heuristics
- `capabilities.json` -- Skills, tools, MCP servers, permissions, evolution config
- `evolution/` -- Learning artifacts:
  - `genes.json` -- Accumulated learned behaviors
  - `events.jsonl` -- Evolution event log
  - `capsules.json` -- Knowledge capsules

### Soul Evolution

Evolution is tracked in Mission Control's `soul_evolution_log` table:
- Event types: `learning`, `correction`, `feature_request`
- Review status: `pending` -> `approved`/`rejected`
- Cross-soul propagation: genes can propagate from one soul to another
- Human gate: `reviewRequired: true` in evolution config

### Soul Spawning

```bash
bin/soul-prompt <soul-id> [--task-id T-xxx] [--extra-context "..."]
```
Reads the soul's SOUL.md, PRINCIPLES.md, learned genes, permissions, and handoff context. Outputs a complete preamble for sub-agent spawning.

---

## 2.10 MCP Knowledge Server

**Files:** `lib/mcp-knowledge/core.mjs`, `server.mjs`

### Architecture

Local, LLM-agnostic semantic search over markdown files:
1. **Scanner**: Walks configured directories, finds `.md` files
2. **Chunker**: Splits at heading boundaries (max 1800 chars/chunk)
3. **Embedder**: Local ONNX model (`all-MiniLM-L6-v2`, 384 dimensions) via `@huggingface/transformers`
4. **Indexer**: Stores vectors in `sqlite-vec` (sqlite extension for vector similarity)
5. **Searcher**: Cosine similarity search, returns ranked results with file path, section, score, snippet

### MCP Tools

| Tool | Description |
|------|-------------|
| `semantic_search(query, limit)` | Find documents by meaning |
| `find_related(doc_path, limit)` | Find documents similar to a given file |
| `reindex(force)` | Re-scan and re-embed changed files |
| `knowledge_stats()` | Index statistics |

### Transport Modes

| Mode | Trigger | Use Case |
|------|---------|----------|
| **stdio MCP** | Default (no KNOWLEDGE_PORT) | Claude Code, Cursor, VS Code |
| **HTTP MCP** | `KNOWLEDGE_PORT=3100` set | Remote MCP clients, web UIs |
| **NATS mesh** | Registered via mesh-registry | Worker nodes query lead's index |

### Performance

- First index: ~90s (one-time, downloads 23MB ONNX model)
- Incremental reindex: <1s (SHA-256 content hashing)
- Query latency: 3-14ms
- Database size: ~22MB for 6,500 chunks
- Background re-index: every 5 minutes (configurable)

---

# 3. LOW LEVEL: Key Implementation Details

## 3.1 Task Schema (NATS KV)

```javascript
{
  task_id: "T-20260315-001",
  title: "Implement token expiry",
  description: "...",
  budget_minutes: 30,           // NaN -> 30m default
  metric: "npm test",           // exit code 0 = success
  on_fail: "revert and log approach",
  scope: ["contracts/Token.sol", "test/Token.test.js"],
  role: "solidity-dev",
  requires_review: null,        // null = auto-compute
  success_criteria: ["Token expires after 30 days"],
  priority: 0,
  depends_on: [],
  tags: [],
  preferred_nodes: [],
  exclude_nodes: [],
  llm_provider: null,           // 'claude' | 'openai' | 'shell'
  llm_model: null,
  collaboration: null,          // { mode, min_nodes, max_nodes, ... }
  status: "queued",
  owner: null,
  created_at: "2026-03-15T14:30:00.000Z",
  claimed_at: null,
  started_at: null,
  completed_at: null,
  budget_deadline: null,        // set at claim time
  last_activity: null,          // updated by heartbeats
  plan_id: null,                // parent plan ID
  subtask_id: null,             // subtask within plan
  result: null,                 // { success, summary, artifacts, attempts }
  attempts: [],                 // [{ approach, result, keep }]
}
```

## 3.2 Collaboration Session Schema

```javascript
{
  session_id: "collab-T-001-1710500000000",
  task_id: "T-001",
  mode: "circling_strategy",    // parallel | sequential | review | circling_strategy
  status: "recruiting",         // recruiting | active | converged | completed | aborted
  min_nodes: 3,
  max_nodes: null,
  join_window_s: 30,
  nodes: [],
  current_round: 0,
  max_rounds: 5,
  rounds: [],
  convergence: { type: "unanimous", threshold: 0.66, metric: null, min_quorum: 3 },
  recruited_count: 0,
  scope_strategy: "shared",
  node_roles: null,             // [{ soul: "blockchain-auditor" }, ...]
  turn_order: [],
  current_turn: null,
  circling: {                   // Only for circling_strategy mode
    worker_node_id: null,
    reviewerA_node_id: null,
    reviewerB_node_id: null,
    max_subrounds: 3,
    current_subround: 0,
    current_step: 0,
    automation_tier: 2,
    artifacts: {},
    phase: "init",
    artifact_failures: {},
    step_started_at: null,
  },
  result: null,
  audit_log: [],
  created_at: "...",
  recruiting_deadline: null,
  completed_at: null,
}
```

## 3.3 Plan Schema

```javascript
{
  plan_id: "PLAN-T-001-1710500000000",
  parent_task_id: "T-001",
  title: "Feature implementation plan",
  status: "draft",              // draft | review | approved | executing | completed | aborted
  planner: "daedalus",
  subtasks: [{
    subtask_id: "PLAN-T-001-S01",
    title: "Design component",
    delegation: { mode: "soul", soul_id: "identity-architect" },
    budget_minutes: 15,
    metric: null,
    scope: [],
    depends_on: [],
    wave: 0,
    critical: false,
    status: "pending",
    mesh_task_id: null,
  }],
  total_budget_minutes: 120,
  estimated_waves: 3,
  failure_policy: "abort_on_critical_fail",
  requires_approval: true,
}
```

## 3.4 Mission Control SQLite Schema

**Tables** (via drizzle-orm):
- `tasks` -- 40+ columns including mesh routing, scheduling, hierarchy
- `memory_docs` -- Indexed markdown documents
- `memory_items` -- Extracted atomic facts with confidence, gate decisions, temporal chains
- `activity_log` -- Event trail (event_type, task_id, description)
- `soul_handoffs` -- Soul-to-soul work transfers
- `soul_evolution_log` -- Evolution events with review status
- `soul_spawns` -- Sub-agent spawn tracking
- `dependencies` -- Task dependency edges (source_id -> target_id)

## 3.5 Concurrency Control

**NATS KV CAS (Compare-and-Swap):**
Both `TaskStore` and `CollabStore` use `_updateWithCAS()`:
```javascript
async _updateWithCAS(key, mutateFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const entry = await this.kv.get(key);
    const data = JSON.parse(sc.decode(entry.value));
    const updated = mutateFn(data);
    try {
      await this.kv.put(key, sc.encode(JSON.stringify(updated)),
        { previousSeq: entry.revision });
      return updated;
    } catch (err) {
      if (isCasConflict(err) && attempt < maxRetries - 1) continue;
      throw err;
    }
  }
}
```
CAS conflict detection: NATS error code `10071` or message containing `wrong last sequence`.

**File Locking (kanban-io.js):**
`mkdir`-based mutual exclusion for `active-tasks.md`:
- `mkdir` is atomic on POSIX
- 5-second timeout with 50ms polling
- Throws on timeout to prevent data corruption
- Used by mesh-bridge, memory-daemon, and Mission Control

**SQLite WAL Mode:**
Both `state.db` and MC's SQLite use WAL (Write-Ahead Logging) for concurrent read/write. `busy_timeout = 5000ms`.

**Worktree Isolation:**
Each mesh task gets its own git worktree (`~/.openclaw/worktrees/<taskId>`), preventing concurrent tasks from interfering with each other's file changes. Worktrees are created at claim time, committed/merged after completion, and cleaned up after.

**Merge Conflict Handling:**
When merging a worktree branch back to main:
1. First attempt: `git merge --no-ff`
2. On failure: `git merge --abort`, `git pull --ff-only`, retry
3. On second failure: Leave branch for manual resolution, report `conflict: true`

## 3.6 Error Handling and Recovery

**Stall Detection:** Daemon checks every 30 seconds. Tasks with no heartbeat for `STALL_MINUTES` (default 5) are auto-released.

**Budget Enforcement:** Daemon checks every 30 seconds. Tasks past `budget_deadline` are auto-failed.

**Bridge Reconciliation:** On restart, mesh-bridge scans for orphaned tasks (status=running/submitted, owner=mesh-agent), checks daemon KV for actual state, processes completed/failed results missed during downtime.

**Crash Recovery:** `.companion-state.md` tracks `status: active|idle|crashed`. If status is `active` but no session is running, previous session crashed -- trigger crash recovery.

**Circling Timeouts:** Dual-layer: in-memory timers (fast, per-step) + periodic cron sweep every 60s (survives daemon restart via `step_started_at` in KV).

**Audit Logging:** Collab sessions maintain append-only audit logs. Audit write failures are rate-limited (max 3 per session) to prevent log spam from blocking operations.

## 3.7 LLM Provider Abstraction

`lib/llm-providers.js` defines a generic provider factory:

```javascript
// Resolution order for provider selection:
// 1. Task-level: task.llm_provider
// 2. CLI flag: --provider
// 3. Environment: MESH_LLM_PROVIDER
// 4. Default: 'claude'

// Built-in providers:
// - claude: Anthropic Claude Code CLI (--permission-mode bypassPermissions)
// - openai: OpenAI Codex/GPT CLI
// - shell: Raw shell execution (no LLM, command validation enforced)
// - Generic factory: any CLI with prompt/model/cwd flags
```

Shell provider has its own allowlist (`SHELL_PROVIDER_ALLOWED_PREFIXES`) separate from the NATS exec allowlist.

## 3.8 Rule Loading Pipeline

When `mesh-agent.js` builds a prompt for any task:

1. **Load rules**: `loadAllRules(RULES_DIR)` -- parse all `.md` files with YAML frontmatter
2. **Detect frameworks**: `detectFrameworks(WORKSPACE)` -- scan for `hardhat.config.js`, `tsconfig.json`, etc.
3. **Activate**: `activateFrameworkRules(allRules, detected)` -- enable framework-specific rules
4. **Match**: `matchRules(rules, task.scope)` -- glob-match rules against task file paths
5. **Format**: `formatRulesForPrompt(matched)` -- render as markdown, cap at 4000 chars
6. **Inject harness**: `formatHarnessForPrompt(harnessRules)` -- behavioral rules
7. **Inject role**: `formatRoleForPrompt(role)` -- responsibilities, must_not, framework

All injected between the task description and instructions section of the prompt.

---

## Summary of Key File Paths

| Path | Purpose |
|------|---------|
| `/Users/moltymac/openclaw/bin/mesh-agent.js` | Mesh worker agent |
| `/Users/moltymac/openclaw/bin/mesh-task-daemon.js` | NATS task coordinator |
| `/Users/moltymac/openclaw/bin/mesh-bridge.js` | Kanban <-> NATS bridge |
| `/Users/moltymac/openclaw/bin/mesh.js` | Mesh CLI |
| `/Users/moltymac/openclaw/lib/mesh-tasks.js` | Task schema + KV store |
| `/Users/moltymac/openclaw/lib/mesh-collab.js` | Collaboration sessions |
| `/Users/moltymac/openclaw/lib/mesh-plans.js` | Plan decomposition |
| `/Users/moltymac/openclaw/lib/exec-safety.js` | Command safety filtering |
| `/Users/moltymac/openclaw/lib/mesh-harness.js` | Mechanical enforcement |
| `/Users/moltymac/openclaw/lib/rule-loader.js` | Path-scoped coding rules |
| `/Users/moltymac/openclaw/lib/role-loader.js` | Role profile loading |
| `/Users/moltymac/openclaw/lib/kanban-io.js` | active-tasks.md parser |
| `/Users/moltymac/openclaw/lib/nats-resolve.js` | NATS URL resolution |
| `/Users/moltymac/openclaw/lib/llm-providers.js` | LLM provider abstraction |
| `/Users/moltymac/openclaw/lib/memory-budget.mjs` | MEMORY.md budget enforcement |
| `/Users/moltymac/openclaw/lib/session-store.mjs` | SQLite session archive |
| `/Users/moltymac/openclaw/lib/hyperagent-store.mjs` | Self-improvement persistence |
| `/Users/moltymac/openclaw/lib/mcp-knowledge/core.mjs` | Semantic search engine |
| `/Users/moltymac/openclaw/lib/mcp-knowledge/server.mjs` | MCP server (stdio + HTTP) |
| `/Users/moltymac/openclaw/config/harness-rules.json` | 12 behavioral enforcement rules |
| `/Users/moltymac/openclaw/config/roles/*.yaml` | Role profiles |
| `/Users/moltymac/openclaw/config/plan-templates/*.yaml` | Plan templates |
| `/Users/moltymac/openclaw/identity/SOUL.md` | Agent identity |
| `/Users/moltymac/openclaw/identity/AGENTS.md` | Operational rules |
| `/Users/moltymac/openclaw/identity/PRINCIPLES.md` | Decision heuristics |
| `/Users/moltymac/openclaw/identity/DELEGATION.md` | Full delegation protocol |
| `/Users/moltymac/openclaw/identity/MEMORY_SPEC.md` | Memory structural contract |
| `/Users/moltymac/openclaw/souls/registry.json` | Soul registry |
| `/Users/moltymac/openclaw/mission-control/src/app/page.tsx` | Dashboard main page |
| `/Users/moltymac/openclaw/mission-control/src/lib/db/schema.ts` | SQLite schema |
| `/Users/moltymac/openclaw/mission-control/src/lib/scheduler.ts` | Task scheduler |
| `/Users/moltymac/openclaw/mission-control/src/lib/sync/tasks.ts` | File <-> DB sync |
| `/Users/moltymac/openclaw/mission-control/src/middleware.ts` | API auth |
| `/Users/moltymac/openclaw/install.sh` | Installer (~1200 lines) |
| `/Users/moltymac/openclaw/services/service-manifest.json` | Service definitions |
