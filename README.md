# openclaw-node

Installable package for deploying an OpenClaw node. Includes the full infrastructure stack:

- **Memory Daemon** — persistent background service managing session lifecycle, memory maintenance, and Obsidian sync
- **HyperAgent Protocol** — self-improving agent loop: telemetry, structured reflection, strategy archive, and self-modifying proposals with human-gated approval
- **Mission Control** — Next.js web dashboard (kanban, timeline, graph visualization, memory browser)
- **Soul System** — multi-soul orchestration with trust registry and evolution
- **Skill Library** — 100+ skills for AI agent capabilities
- **Boot Compiler** — profile-aware boot artifact generation for multiple AI models
- **ClawVault** — structured knowledge vault with search and handoffs
- **Mesh Task Engine** — distributed task execution with Karpathy iteration (try → measure → keep/discard → retry)
- **Mechanical Enforcement** — path-scoped coding rules, dual-layer harness, role profiles with structural validation
- **Plan Pipelines** — YAML-based multi-phase workflows with dependency waves, failure cascade, and escalation recovery
- **Knowledge Server** — LLM-agnostic MCP server for semantic search over markdown (local embeddings, sqlite-vec, NATS mesh)

## Quick Start

### Option 1: npx (recommended)

```bash
npx openclaw-node-harness            # Full install — identity, skills, MC, services, everything
npx openclaw-node-harness --update   # Update existing install (skip system deps)
npx openclaw-node-harness --mesh-only  # Worker nodes — mesh agent + NATS only, no full stack
```

### Option 2: Git clone

```bash
git clone https://github.com/moltyguibros-design/openclaw-node.git
cd openclaw-node
bash install.sh                       # Full install
bash install.sh --update              # Update existing
```

The installer will:
1. Check/install system dependencies (Node.js 18+, Python 3, Git, SQLite3, build-essential)
2. Create the `~/.openclaw/` directory structure
3. Install all scripts, identity files, souls, and skills
4. Generate configuration from templates
5. Install Mission Control and its dependencies
6. Set up the memory daemon as a systemd user service
7. Initialize the memory system
8. Deploy path-scoped coding rules — installs universal rules (security, test-standards, design-docs, git-hygiene), auto-detects frameworks (Hardhat → Solidity rules, tsconfig → TypeScript rules, ProjectSettings → Unity rules), version-aware upgrades preserve user modifications
9. Install plan templates — deploys `team-feature`, `team-bugfix`, `team-deploy` YAML pipeline templates (skips if already present)
10. Set up Claude Code hooks + LLM-agnostic git hooks — deploys 6 lifecycle hooks (session-start, validate-commit, validate-push, pre-compact, session-stop, log-agent), symlinks `.claude/rules` → `~/.openclaw/rules/`, installs pre-commit/pre-push git hooks that delegate to the same scripts
11. Merge enforcement settings — `jq`-based merge of `settings.json` that appends new hooks and permissions without overwriting existing user configuration

## Post-Install

1. **Edit your environment file** with API keys:
   ```bash
   nano ~/.openclaw/openclaw.env
   ```

2. **Regenerate configs** with your keys:
   ```bash
   bash install.sh --update
   ```

3. **Check daemon status:**
   ```bash
   systemctl --user status openclaw-memory-daemon
   ```

4. **Start Mission Control:**
   ```bash
   cd ~/.openclaw/workspace/projects/mission-control
   npm run dev
   # Dashboard at http://localhost:3000
   ```

## Updating

Pull latest and re-run with `--update` to refresh scripts and configs without reinstalling system deps:

```bash
cd openclaw-node
git pull
bash install.sh --update
```

## Uninstalling

```bash
bash uninstall.sh          # Remove services and scripts (keep memory data)
bash uninstall.sh --purge  # Remove everything including all data
```

## Directory Structure (installed)

```
~/.openclaw/
├── openclaw.env              # Your API keys and config
├── openclaw.json             # Generated runtime config
├── config/                   # Daemon, transcript, sync configs
├── rules/                    # Path-scoped coding rules (*.md)
├── plan-templates/           # YAML pipeline templates
├── harness-rules.json        # Behavioral enforcement rules
├── souls/                    # Soul definitions (daedalus, specialists)
├── services/                 # Service reference files
├── workspace/
│   ├── bin/                  # All scripts (daemon, mesh-agent, etc.)
│   ├── lib/                  # Shared libraries (rule-loader, harness, roles, plans)
│   ├── skills/               # 100+ skill definitions
│   ├── memory/               # Daily logs, active tasks, archive
│   ├── memory-vault/         # ClawVault structured knowledge
│   ├── .boot/                # Compiled boot profiles
│   ├── .knowledge.db         # Semantic search index (auto-generated)
│   ├── .learnings/           # Corrections and lessons
│   ├── .tmp/                 # Runtime state (logs, sessions)
│   ├── .claude/
│   │   ├── hooks/            # Lifecycle hooks (session, commit, push, compact)
│   │   └── rules → ~/.openclaw/rules/  # Symlink for Claude Code native support
│   ├── projects/
│   │   └── mission-control/  # Next.js dashboard
│   ├── SOUL.md               # Identity
│   ├── PRINCIPLES.md         # Decision heuristics
│   ├── AGENTS.md             # Operational rules
│   ├── CLAUDE.md             # Session init
│   └── MEMORY.md             # Long-term memory
```

## Requirements

- **Ubuntu 20.04+** (or any Linux with systemd)
- **Node.js 18+** (installer will set up if missing)
- **Python 3.8+** (usually pre-installed on Ubuntu)
- **Git** (usually pre-installed)
- **SQLite 3** (installer will set up if missing)

Also works on macOS (uses launchd instead of systemd).

### System dependencies installed automatically

| Package | Purpose |
|---|---|
| `nodejs` (18+) | Runtime for daemon, MC, and Node.js scripts |
| `python3` + `python3-pip` | Runtime for boot compiler, trust registry, evolution |
| `build-essential` | Compiles `better-sqlite3` native module |
| `git` | Version control |
| `sqlite3` | Database engine |
| `curl` | HTTP calls from scripts |
| `jq` | JSON processing in test/workflow scripts |
| `pyyaml` (pip) | Required by `bin/compile-boot` for YAML parsing |
| `scrot` (Linux) | Screenshot capture (fallback: gnome-screenshot, flameshot) |

### Skills with their own dependencies

The installer auto-detects and installs these:
- **memorylayer** — npm: `axios`
- **moltbook-registry** — npm: `ethers`, `dotenv`
- **prompt-guard** — pip: `pyyaml`
- **crypto-price** — pip: `matplotlib`
- **fast-browser-use** — Rust (requires manual `cargo build` if needed)

## Obsidian Setup

The installer deploys the vault scaffold with 23 domain folders and the **Local REST API** plugin pre-installed. On first Obsidian launch:

1. Obsidian will auto-download 5 missing community plugins (dataview, templater, kanban, git, graph-analysis) — requires internet
2. Generate an API key in the Local REST API plugin settings
3. Save the key to `~/.openclaw/workspace/projects/arcane-vault/.obsidian-api-key`
4. The memory daemon will sync workspace files to the vault every 30 minutes

If not using Obsidian, the sync is disabled by default in `obsidian-sync.json` (set `"enabled": false`).

## HyperAgent Protocol

A self-improving loop that makes any agent on any node better over time. Based on the DGM-Hyperagents framework (Zhang et al., 2026): the mechanism that generates improvements is itself subject to improvement.

### How It Works

```
Task completes → Telemetry logged (auto-detected pattern flags)
                      ↓
              5 tasks accumulate
                      ↓
        Daemon triggers reflection (raw stats)
                      ↓
     Agent synthesizes hypotheses + proposals (autonomous)
                      ↓
          Human reviews proposals (safety gate)
                      ↓
     Approved proposals update strategy archive
                      ↓
        Next task consults strategies at start
```

The loop is fully autonomous except proposal approval. Telemetry, reflection, synthesis, and strategy consultation all happen without human intervention.

### Components

| Component | Location | Purpose |
|---|---|---|
| `lib/hyperagent-store.mjs` | SQLite in `state.db` | 5 tables: telemetry, strategies, reflections, proposals, junction |
| `bin/hyperagent.mjs` | CLI | `status`, `log`, `reflect`, `strategies`, `approve`, `reject` |
| Harness rules (3) | `config/harness-rules.json` | Injected into any agent: task-close telemetry, task-start strategy lookup, reflection synthesis |
| Daemon phase | `memory-daemon.mjs` | Triggers reflection every 30min when 5+ unreflected tasks exist |

### Agent-Agnostic

Works for any soul (daedalus, infra-ops, blockchain-auditor, etc.) on any node. Telemetry is tagged with `node_id` and `soul_id`. Strategies are queryable by domain. The harness rules inject into any agent session via companion-bridge.

### Pattern Flags

Pathology detection is automatic. The store detects these flags at telemetry write time:

- `repeated-approach` — same strategy on last 3+ tasks in same domain
- `multiple-iterations` — more than 3 attempts to complete
- `always-escalated` — failed with only 1 iteration (didn't try)
- `no-meta-notes` — missing or insufficient observations

### CLI

```bash
hyperagent status                          # overview
hyperagent log '<json>'                    # log telemetry
hyperagent strategies [--domain X]         # list strategies
hyperagent reflect [--force]               # trigger reflection
hyperagent reflect --pending               # get pending synthesis (JSON)
hyperagent reflect --write-synthesis '<json>'  # write agent synthesis
hyperagent proposals                       # list proposals
hyperagent approve <id>                    # approve (human gate)
hyperagent reject <id> [reason]            # reject
hyperagent shadow <id> [--window 60]       # start shadow eval
hyperagent seed-strategy '<json>'          # import strategy manually
```

### Tests

```bash
node test/hyperagent-store.test.js   # 28 tests, no external deps
```

## Semantic Knowledge Search (MCP)

Local, LLM-agnostic semantic search over your markdown knowledge base. Uses vector embeddings to find documents by meaning, not just keywords.

### How it works

The knowledge server scans markdown files in your workspace, splits them into chunks at heading boundaries, embeds each chunk with a local ONNX model (all-MiniLM-L6-v2, 384-dim), and stores the vectors in a sqlite-vec index. Queries return the most semantically similar chunks with file path, section name, relevance score, and a snippet.

### Tools exposed

| Tool | Description |
|------|-------------|
| `semantic_search(query, limit)` | Find documents by meaning (e.g. "oracle threat model GPS spoofing") |
| `find_related(doc_path, limit)` | Find documents similar to a given file |
| `reindex(force)` | Re-scan and re-embed changed files |
| `knowledge_stats()` | Index statistics (doc count, chunk count, model info) |

### Access paths

Any MCP-compatible client can use these tools. The server supports three transports:

| Transport | How | Use case |
|-----------|-----|----------|
| **stdio MCP** | Auto-starts via `.mcp.json` | Claude Code, Cursor, VS Code |
| **HTTP MCP** | `KNOWLEDGE_PORT=3100 node lib/mcp-knowledge/server.mjs` | Remote MCP clients, web UIs |
| **NATS mesh** | `mesh.tool.{nodeId}.knowledge.{method}` | Any mesh worker node |

The NATS transport means worker nodes get semantic search without needing the embedding model, database, or knowledge files locally. One index on the lead node, queried from anywhere on the mesh.

### Configuration

Environment variables (set in `.mcp.json` env block or shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `KNOWLEDGE_ROOT` | `~/.openclaw/workspace` | Directory to scan for markdown files |
| `KNOWLEDGE_DB` | `{KNOWLEDGE_ROOT}/.knowledge.db` | SQLite database path |
| `KNOWLEDGE_POLL_MS` | `300000` (5 min) | Background re-index interval |
| `KNOWLEDGE_PORT` | *(unset)* | Set to enable HTTP transport (e.g. `3100`) |
| `KNOWLEDGE_HOST` | `127.0.0.1` | HTTP bind address |
| `INCLUDE_DIRS` | `memory/,projects/,...` | Comma-separated directories to scan |

### Performance

Benchmarked on a ~250-file workspace:

- **First index:** ~90s (one-time, downloads 23MB ONNX model on first run)
- **Incremental reindex:** <1s (SHA-256 content hashing, only re-embeds changed files)
- **Query latency:** 3-14ms
- **Database size:** ~22MB for 6,500 chunks

### Running tests

```bash
cd lib/mcp-knowledge
node test.mjs
# 98 assertions across 12 test groups
```

## Mesh Network (Multi-Node)

The installer detects Tailscale and optionally deploys a full mesh network across multiple machines. When enabled, nodes share files, execute remote commands, and broadcast session lifecycle events via NATS.

### Setup

1. Install [Tailscale](https://tailscale.com) on both machines and connect them
2. Run `bash install.sh` — Step 15 auto-detects Tailscale and deploys the mesh
3. Set `OPENCLAW_NATS=nats://<ubuntu-tailscale-ip>:4222` in `~/.openclaw/openclaw.env`
4. Re-run `bash install.sh --update` to regenerate configs

### Mesh commands

```
mesh status          # see online nodes
mesh health --all    # check all nodes
mesh repair --all    # fix broken services
mesh exec "cmd"      # run command on remote node
```

### Architecture

- **NATS** — message bus for commands, heartbeats, file sync (runs on Ubuntu)
- **Agent v3** — polling-based shared folder sync over NATS (`~/openclaw/shared/`)
- **Memory Bridge** — broadcasts session lifecycle events across nodes (`mesh-bridge.js`)
- **Knowledge Server** — semantic search via NATS (`mesh.tool.{nodeId}.knowledge.*`), workers query lead's index
- **Tailscale** — encrypted WireGuard tunnel between nodes
- **Agent Activity Monitor** (`lib/agent-activity.js`) — zero-cost agent state detection via Claude Code JSONL session files (active, ready, idle, blocked)
- **Memory Budget** (`lib/memory-budget.mjs`) — character budget enforcement for MEMORY.md with freeze/thaw semantics per session
- **Mesh Registry** (`lib/mesh-registry.js`) — NATS KV-backed tool registry for discovering and calling remote tools across nodes

The mesh is optional. Without Tailscale, everything runs as a standalone single node.

## Mechanical Enforcement

The enforcement layer operates independently of the LLM backend. Rules are prompt-injected (soft enforcement) AND mechanically validated (hard enforcement). If the LLM ignores a rule, the mechanical check catches it.

### Three-Layer Prompt Injection

Every mesh agent task receives context from three independent sources, injected in order:

1. **Coding rules** (`~/.openclaw/rules/*.md`) — path-scoped technical standards. A task touching `contracts/Token.sol` auto-gets Solidity rules (reentrancy guards, events on state changes). Rules match via glob patterns in frontmatter.
2. **Harness rules** (`harness-rules.json`) — universal behavioral constraints. "Never declare done without running tests." "Never silently swallow errors." Each rule has both a prompt injection AND a mechanical enforcement mapping.
3. **Role profiles** (`config/roles/*.yaml`) — domain-specific responsibilities, must-not boundaries, thinking frameworks, and escalation maps. A `solidity-dev` role knows to check for test coverage and emit events.

### Mechanical Checks (post-execution, pre-commit)

After the LLM exits and before results are committed:

| Check | What it does | Blocks on failure |
|---|---|---|
| **Scope enforcement** | `git diff` vs `task.scope` — reverts files outside allowed paths | Yes (revert + retry) |
| **Forbidden patterns** | Role-defined regex on changed files (e.g., hardcoded addresses in `.sol`) | Yes (violation + retry) |
| **Secret scanning** | gitleaks/trufflehog/regex on staged changes | Yes (block commit) |
| **Output block patterns** | Regex on LLM stdout for dangerous commands (`rm -rf`, `sudo`) | Yes (block completion) |
| **Error pattern scan** | Detects error/exception patterns in metric-less task output | Warning (forces review) |
| **Required outputs** | Role-defined structural checks (test files exist, events emitted) | Forces review |

### Coding Rules

Rules live in `~/.openclaw/rules/` as markdown files with YAML frontmatter:

```yaml
---
id: solidity
version: 1.0.0
tier: framework           # universal | framework | project
paths: ["contracts/**", "**/*.sol"]
detect: ["hardhat.config.js", "foundry.toml"]
priority: 80
---
# Solidity Standards
- Reentrancy guards on all external calls
- Events on every state change
- checks-effects-interactions pattern
```

Three tiers with precedence: `project > framework > universal`. Framework rules auto-activate when the installer detects matching config files. Version-aware upgrades preserve user modifications.

### Rule Loader (`lib/rule-loader.js`)

The rule loader is a zero-dependency engine that:

1. **Parses YAML frontmatter** from markdown rule files (custom parser, no `js-yaml` required)
2. **Matches rules to file paths** using glob patterns (`*`, `**`, `?`, `{a,b}` brace expansion)
3. **Sorts by tier + priority** — project rules (weight 20) override framework (10) override universal (0)
4. **Auto-detects frameworks** — scans for `hardhat.config.js` → activates Solidity rules, `tsconfig.json` → TypeScript rules, `ProjectSettings/` → Unity rules
5. **Caps prompt injection** at 4,000 characters to avoid context budget blowout

**Shipped rules:**

| Tier | Rule | Auto-detects |
|------|------|-------------|
| Universal | `security.md` | Always active |
| Universal | `test-standards.md` | Always active |
| Universal | `design-docs.md` | Always active |
| Universal | `git-hygiene.md` | Always active |
| Framework | `solidity.md` | `hardhat.config.js`, `foundry.toml` |
| Framework | `typescript.md` | `tsconfig.json` |
| Framework | `unity.md` | `ProjectSettings/`, `Assets/` |

### Rule Injection into Agents

When `mesh-agent.js` builds a prompt for any task, it calls `findRulesByScope(task.scope)` and injects matching rules into all three prompt paths:

- `buildInitialPrompt()` — first attempt
- `buildRetryPrompt()` — retry after failure
- `buildCollabPrompt()` — collaborative session

Rules are injected between the task description and the metric/success criteria, so the agent sees them as constraints on how to approach the work.

### Role Profiles

Roles define domain-specific agent behavior with mechanical validation:

```yaml
# config/roles/solidity-dev.yaml
id: solidity-dev
responsibilities:
  - "Implement smart contract logic per specification"
  - "Write comprehensive test coverage for all state transitions"
must_not:
  - "Modify deployment scripts without explicit delegation"
  - "Hardcode addresses — resolve through ArcaneKernel"
required_outputs:
  - type: file_match
    pattern: "test/**/*.test.js"
    description: "Test file must accompany any contract change"
forbidden_patterns:
  - pattern: "0x[a-fA-F0-9]{40}"
    in: "contracts/**/*.sol"
    description: "No hardcoded addresses"
scope_paths: ["contracts/**", "test/**"]
escalation:
  on_metric_failure: qa-engineer
  on_budget_exceeded: tech-architect
framework:
  name: "Checks-Effects-Interactions"
  prompt: "Structure all external calls using CEI pattern..."
```

Roles auto-assign from task scope: a task with `scope: ["contracts/Token.sol"]` gets `role: solidity-dev` because the glob matches.

## Plan Pipelines

Multi-phase workflows defined as YAML templates. Plans decompose into subtasks dispatched across mesh agents in dependency waves.

### Usage

```bash
# List available templates
mesh plan templates

# Create a plan from template
mesh plan create --template team-feature --context "Add token expiry logic"

# Inspect the full subtask tree before approving
mesh plan show PLAN-xxx

# Override template defaults
mesh plan create --template team-feature --context "..." \
  --set implement.delegation.mode=collab_mesh \
  --set test.budget_minutes=30

# Approve and start execution
mesh plan approve PLAN-xxx

# Monitor progress
mesh plan list --status executing
mesh plan show PLAN-xxx
```

### Shipped Templates

| Template | Phases | Failure Policy |
|---|---|---|
| `team-feature` | Design → Architecture Review → Implement → Test → Code Review | `abort_on_critical_fail` |
| `team-bugfix` | Reproduce → Diagnose → Fix → Regression Test | `abort_on_first_fail` |
| `team-deploy` | Pre-flight → Deploy → Smoke Test → Monitor | `abort_on_first_fail` |

### Plan Templates (`lib/plan-templates.js`)

Templates are YAML files in `~/.openclaw/plan-templates/` that define reusable multi-phase workflows. The template engine:

1. **Loads and validates** template structure (phases, subtasks, dependency IDs)
2. **Detects circular dependencies** via DFS — rejects templates with cycles
3. **Substitutes variables** — `{{context}}` gets the user's task description, `{{vars.key}}` for custom variables
4. **Validates delegation modes** — only `solo_mesh`, `collab_mesh`, `local`, `soul`, `human`, `auto` allowed
5. **Instantiates into executable plans** via `lib/mesh-plans.js` with wave computation and auto-routing

### Approval Gate

Tasks auto-compute whether human review is required:

| Delegation Mode | Has Metric | Review Required |
|---|---|---|
| `solo_mesh` | Yes | No (metric IS the approval) |
| `solo_mesh` | No | Yes |
| `soul` | Any | Yes |
| `collab_mesh` | No | Yes |
| `human` | Any | Yes (by definition) |

Tasks in `pending_review` block wave advancement — downstream subtasks don't dispatch until the review is completed via `mesh task approve <id>`.

### Failure Policies

Each plan declares a `failure_policy` that controls what happens when a subtask fails:

| Policy | Behavior |
|--------|----------|
| `continue_best_effort` | Skip failed subtask, continue with non-dependent waves |
| `abort_on_first_fail` | Abort entire plan on any failure |
| `abort_on_critical_fail` | Abort only if the failed subtask has `critical: true` |

Subtasks can be marked `critical: true` to indicate their failure should trigger plan abort under the `abort_on_critical_fail` policy.

### Failure Cascade and Escalation

When a subtask fails:
1. **Cascade**: BFS blocks all transitive dependents (follows `depends_on` graph)
2. **Blocked-critical check**: if any blocked subtask is `critical: true`, abort the plan
3. **Escalation**: if the role defines an escalation target, create a recovery task
4. **Recovery**: if the escalation task succeeds, override FAILED → COMPLETED and unblock dependents

### Plan-Task Back-References

Each mesh task carries `plan_id` and `subtask_id` fields that link back to the parent plan. This enables O(1) plan progress checks — when a task completes, stalls, or exceeds budget, the daemon looks up the plan directly instead of scanning all plans. The daemon's enforcement loop (`checkPlanProgress`, `detectStalls`, `enforceBudgets`) all use these back-references to trigger cascade and wave advancement efficiently.

### Heterogeneous Collaboration

Collab tasks can assign different souls to different nodes:

```yaml
delegation:
  mode: collab_mesh
  collaboration:
    mode: review
    node_roles:
      - soul: blockchain-auditor    # primary executor
      - soul: identity-architect    # consultant
    convergence: unanimous
```

Both souls produce reflections. The shared intel compilation includes both perspectives.

### Circling Strategy (Asymmetric Multi-Agent Review)

A directed collaboration mode where 3 agents — 1 Worker and 2 Reviewers — iterate through structured sub-rounds of work, review, and integration. Each agent sees only what the protocol decides it should see at each step, creating cognitive separation that prevents groupthink.

**Architecture:** Four layers with zero coupling:

```
lib/circling-parser.js   (parsing)       Delimiter-based LLM output parser
bin/mesh-agent.js        (execution)     Prompt construction, LLM calls
bin/mesh-task-daemon.js  (orchestration) NATS handlers, step lifecycle, timeouts
lib/mesh-collab.js       (state)         Session schema, artifact store, state machine
bin/mesh-bridge.js       (human UI)      Kanban materialization, gate messages
```

**Workflow:**

```
Task → RECRUITING (3 nodes join, roles assigned)
     → INIT (Worker: workArtifact v0, Reviewers: reviewStrategy)
     → SUB-ROUND LOOP (SR1..SRN):
         Step 1 — Review Pass:
           Worker analyzes review strategies (+ review findings in SR2+)
           Reviewers review workArtifact using their strategy
         Step 2 — Integration:
           Worker judges each finding (ACCEPT/REJECT/MODIFY), updates artifact
           Reviewers refine strategy using Worker feedback + cross-review
     → FINALIZATION (Worker: final artifact + completionDiff, Reviewers: vote)
     → COMPLETE (or gate → human approve/reject → loop)
```

**Key features:**
- **Directed handoffs** — each node sees only its role-specific inputs per step (information flow matrix enforced by `compileDirectedInput`)
- **Cross-review** — in Step 2, Reviewer A sees Reviewer B's findings and vice versa, enabling inter-reviewer learning
- **Adaptive convergence** — if all nodes vote `converged` after step 2, skips remaining sub-rounds and goes directly to finalization
- **Stored role identities** — `worker_node_id`, `reviewerA_node_id`, `reviewerB_node_id` assigned once at recruiting close, stable for session lifetime
- **Dual-layer timeouts** — in-memory timers (fast, per-step) + periodic cron sweep every 60s (survives daemon restart via `step_started_at` in JetStream KV)
- **Tiered human gates** — Tier 1: fully autonomous. Tier 2: gate on finalization. Tier 3: gate every sub-round. Blocked votes always gate.
- **Delimiter-based parsing** — `===CIRCLING_ARTIFACT===` / `===END_ARTIFACT===` delimiters instead of JSON (LLMs produce reliable delimiter-separated output). Parser extracted to standalone `lib/circling-parser.js` (zero deps, shared by agent and tests).
- **Anti-preamble prompt hardening** — explicit instruction prevents LLM prose from contaminating code artifacts
- **Session blob monitoring** — warns at 800KB, critical at 950KB (JetStream KV max 1MB). KV write failures caught and recovered (artifact removed, session re-persisted).
- **Recruiting guard** — validates 1 worker + 2 reviewers before starting. `min_nodes` defaults to 3 for circling mode.

**Information flow matrix — what each node receives:**

| Phase | Worker Receives | Reviewers Receive |
|-------|----------------|-------------------|
| Init | Task plan | Task plan |
| Step 1 (SR1) | Both reviewStrategies | workArtifact |
| Step 1 (SR2+) | Both strategies + review findings* | workArtifact + reconciliationDoc |
| Step 2 | Both reviewArtifacts | workerReviewsAnalysis + other reviewer's cross-review* |
| Finalization | Task plan + final workArtifact | Task plan + final workArtifact |

`*` = optional (silently skipped if null)

**State machine:**

```
[init] → [circling/SR1/step1] → [step2] → [SR2/step1] → ... → [finalization] → [complete]
                                                                      ↑                |
                                        gate reject: max_subrounds++ ─┘    (all converged)
```

**Gate behavior:**
- Tier 2+: gates on finalization entry
- Tier 3: also gates after every sub-round
- Blocked votes in finalization: always gate, reviewer reason shown on kanban (`[GATE] SR2 blocked — reentrancy guard missing on withdraw function`)

**Usage:**

```yaml
delegation:
  mode: collab_mesh
  collaboration:
    mode: circling_strategy
    min_nodes: 3
    max_subrounds: 3
    automation_tier: 2
    node_roles:
      - role: worker
        soul: solidity-dev
      - role: reviewer
        soul: blockchain-auditor
      - role: reviewer
        soul: qa-engineer
```

**Tests:**

```bash
# All circling tests (93 tests, no external deps)
node --test test/collab-circling.test.js test/daemon-circling-handlers.test.js test/circling-comprehensive.test.js
```

Full implementation reference: `docs/circling-strategy-implementationV3.md`

## Lifecycle Hooks

6 hooks wired into Claude Code lifecycle events, plus dual-wired git hooks for LLM-agnostic enforcement:

| Hook | Trigger | What it does |
|---|---|---|
| `session-start.sh` | SessionStart | Loads git state, active tasks, companion state, last session recap |
| `validate-commit.sh` | PreToolUse (Bash) | Blocks secrets, validates JSON, warns on bare TODOs, checks commit format |
| `validate-push.sh` | PreToolUse (Bash) | Warns on force-push and protected branch pushes |
| `pre-compact.sh` | PreCompact | Preserves session state before context compression |
| `session-stop.sh` | Stop | Logs session end to daily memory file |
| `log-agent.sh` | SubagentStart | Audit trail of every subagent spawn |

Git hooks (`pre-commit`, `pre-push`) delegate to the same scripts — enforcement works regardless of IDE or AI tool.

---

## Distributed Mission Control

Mission Control runs on **every node** in the mesh. Each instance operates independently against its own local SQLite database, while staying in sync through NATS JetStream KV buckets. This means any node can view all mesh tasks, and worker nodes get their own full MC dashboard instead of being headless executors.

### How It Works

The system has two layers:

**Layer 1 — KV Mirror (read visibility):** Every MC instance watches NATS KV bucket `MESH_TASKS` in real-time. When the lead creates, updates, or completes a task, all connected MC instances see the change within milliseconds. Worker nodes display these tasks as read-only cards in the Kanban.

**Layer 2 — Sync Engine (write participation):** Worker nodes can *propose* new tasks to the mesh. Proposals land in the KV bucket with `status: proposed`. The lead's task daemon validates proposals within its 30-second enforcement loop and transitions them to `queued` (accepted) or `rejected`. Once queued, any node with the `claim` capability can execute the task.

```
                     NATS KV: MESH_TASKS
                    ┌─────────────────────┐
                    │  T-001: running     │
                    │  T-002: queued      │
                    │  T-003: proposed    │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
        │  Lead MC  │ │ Worker MC │ │ Worker MC │
        │           │ │           │ │           │
        │ SQLite    │ │ SQLite    │ │ SQLite    │
        │ (primary) │ │ (mirror)  │ │ (mirror)  │
        │           │ │           │ │           │
        │ Read/Write│ │ Read +    │ │ Read +    │
        │ + Approve │ │ Propose   │ │ Propose   │
        └───────────┘ └───────────┘ └───────────┘
```

### Data Flow

1. **Lead creates a task** via MC UI or agent dispatch
   - Task saved to local SQLite (primary)
   - Task written to `MESH_TASKS` KV bucket
   - SSE event broadcast to UI
   - All other MC instances receive the KV watch event and update their local mirrors

2. **Worker proposes a task** via `POST /api/mesh/tasks`
   - Task written to KV with `status: proposed`, `origin: <worker-node-id>`
   - Lead's `mesh-task-daemon` picks it up in the next enforcement loop (< 30s)
   - Daemon validates and transitions: `proposed` → `queued` (or `rejected`)
   - Worker's MC sees the status change via KV watch

3. **Worker reads mesh state** via `GET /api/mesh/tasks`
   - Returns all tasks from NATS KV (not local SQLite)
   - UI merges KV tasks with local SQLite tasks (dedup by task ID)
   - On workers: KV version preferred (more current for mesh tasks)
   - On lead: SQLite version preferred (has richer fields like `kanbanColumn`, `sortOrder`)

4. **Anyone updates a task** via `PATCH /api/mesh/tasks/:id`
   - Authority check: only `lead` can transition most states
   - Workers can update tasks they own (`origin` matches)
   - Uses CAS (Compare-And-Swap) to prevent stale writes — the `revision` field must match
   - On revision mismatch: HTTP 409 with the current state, so the client can retry

### Authority Model

The system enforces explicit authority boundaries:

| Action | Who Can Do It | Mechanism |
|--------|--------------|-----------|
| Create local task | Lead only | Direct SQLite + KV write |
| Propose mesh task | Any node | KV write with `status: proposed` |
| Accept/reject proposal | Lead only | Daemon enforcement loop |
| Claim a queued task | Any node | CAS on KV (first writer wins) |
| Complete a task | Task owner only | CAS with `origin` check |
| Approve (mark done) | Human's node only | `approve` capability gate |
| View all tasks | Any node | KV watch + local mirror |

### Key Files

```
mission-control/
├── src/
│   ├── app/api/mesh/
│   │   ├── tasks/
│   │   │   ├── route.ts          # GET (list from KV) + POST (propose)
│   │   │   └── [id]/route.ts     # GET (single) + PATCH (CAS update)
│   │   ├── identity/route.ts     # Node role/ID for sidebar badge
│   │   └── events/route.ts       # SSE: dual-iterator (NATS sub + KV watch)
│   ├── lib/
│   │   └── sync/
│   │       └── mesh-kv.ts        # Sync engine (KV watch → SQLite, CAS push)
│   └── components/layout/
│       └── sidebar.tsx            # Node badge (⬢ Lead / ◇ Worker)
├── src/lib/__tests__/
│   ├── mesh-kv-sync.test.ts      # 30 unit tests (CAS, authority, merge, proposals)
│   └── mocks/mock-kv.ts          # Shared MockKV for all KV tests
bin/
└── mesh-task-daemon.js            # Proposal processing (30s enforcement loop)
lib/
└── mesh-tasks.js                  # PROPOSED + REJECTED task statuses
test/
├── mesh-tasks-status.test.js      # 7 unit tests (status enum, defaults)
└── distributed-mc.test.js         # 12 integration tests (needs NATS + daemon)
```

### CAS (Compare-And-Swap) Explained

Every task in the KV bucket has a `revision` number that increments on each write. To update a task, you must provide the current revision. If another node wrote between your read and your write, the revision won't match and the update fails with a 409.

This eliminates race conditions without locks or a central coordinator:

```
Node A reads T-001 (revision 5)
Node B reads T-001 (revision 5)
Node A writes T-001 with revision 5 → succeeds (now revision 6)
Node B writes T-001 with revision 5 → FAILS (expected 5, got 6)
Node B re-reads T-001 (revision 6), retries → succeeds
```

### SSE Dual-Iterator

The `/api/mesh/events` endpoint runs two async iterators in parallel:

1. **NATS subscription** on `mesh.events.>` — receives all mesh event broadcasts
2. **KV watcher** on `MESH_TASKS` — receives real-time task state changes

Both feed into a single SSE stream. When the client disconnects, both iterators are cleaned up (subscription unsubscribed, watcher stopped). This prevents zombie NATS connections.

### Node Badge

The sidebar shows the node's identity:

- **⬢ Lead** (green) — full read/write/approve authority
- **◇ Worker** (blue) — read + propose, no direct task management
- **◇ Offline** (gray) — NATS unreachable, operating in standalone mode

### Configuration

Two environment variables control behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_NODE_ROLE` | Auto-detected | `lead` or `worker`. Auto-detected from `service-manifest.json` if unset |
| `OPENCLAW_NODE_ID` | `os.hostname()` | Unique identifier for this node in the mesh |

No configuration needed on the lead — it works exactly as before. Workers just need `OPENCLAW_NATS` pointed at the lead's NATS server.

### Testing

```bash
# Unit tests (no dependencies — run anywhere)
cd mission-control && npm run test:unit    # 30 tests: CAS, authority, merge, proposals
cd .. && npm run test:unit                 # 7 tests: status enum, task creation

# Integration tests (needs live NATS + mesh-task-daemon)
npm run test:integration                   # 12 tests: proposal lifecycle, RPC, events
                                           # Skips gracefully if daemon not running

# Everything
npm run test:all
```

### Migration Path

This is Phase 1+2 of a 4-phase rollout:

| Phase | What Changes | Status |
|-------|-------------|--------|
| **1: KV Mirror** | Workers get read-only MC dashboards via KV watch | Done |
| **2: Sync Engine** | Workers can propose tasks, lead validates | Done |
| 3: Distributed Claiming | Any node can claim and execute queued tasks via CAS | Planned |
| 4: Full Sovereignty | No central daemon, each node schedules independently | Planned |

Phase 1+2 is **non-breaking** — the lead's existing task daemon, kanban sync, and agent dispatch all work exactly as before. The new code paths only activate when `OPENCLAW_NATS` is configured and reachable.

## Environment Variables

See `openclaw.env.example` for all available configuration. Key variables:

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_NODE_ID` | Yes | Unique name for this node |
| `OPENCLAW_TIMEZONE` | Yes | Timezone (e.g. `America/Montreal`) |
| `ANTHROPIC_API_KEY` | Optional | For Claude-powered features |
| `OPENAI_API_KEY` | Optional | For OpenAI-powered features |
| `GOOGLE_API_KEY` | Optional | For Gemini + Mission Control TTS |
| `DISCORD_BOT_TOKEN` | Optional | For Discord integration |
| `TELEGRAM_BOT_TOKEN` | Optional | For Telegram integration |
| `WEB_SEARCH_API_KEY` | Optional | For web search capability |
| `OBSIDIAN_API_KEY` | Optional | For Obsidian vault sync |
| `OPENCLAW_NATS` | Optional | NATS server URL for mesh (e.g. `nats://100.91.131.61:4222`) |
