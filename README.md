# openclaw-node

Installable package for deploying an OpenClaw node. Includes the full infrastructure stack:

- **Memory Daemon** — persistent background service managing session lifecycle, memory maintenance, and Obsidian sync
- **Mission Control** — Next.js web dashboard (kanban, timeline, graph visualization, memory browser)
- **Soul System** — multi-soul orchestration with trust registry and evolution
- **Skill Library** — 100+ skills for AI agent capabilities
- **Boot Compiler** — profile-aware boot artifact generation for multiple AI models
- **ClawVault** — structured knowledge vault with search and handoffs
- **Mesh Task Engine** — distributed task execution with Karpathy iteration (try → measure → keep/discard → retry)
- **Mechanical Enforcement** — path-scoped coding rules, dual-layer harness, role profiles with structural validation
- **Plan Pipelines** — YAML-based multi-phase workflows with dependency waves, failure cascade, and escalation recovery

## Quick Start (Ubuntu)

```bash
git clone https://github.com/moltyguibros-design/openclaw-node.git
cd openclaw-node
bash install.sh
```

The installer will:
1. Check/install system dependencies (Node.js 18+, Python 3, Git, SQLite3, build-essential)
2. Create the `~/.openclaw/` directory structure
3. Install all scripts, identity files, souls, and skills
4. Generate configuration from templates
5. Install Mission Control and its dependencies
6. Set up the memory daemon as a systemd user service
7. Initialize the memory system
8. Deploy path-scoped coding rules (auto-detects project frameworks)
9. Install plan templates for multi-phase workflows
10. Set up Claude Code hooks + LLM-agnostic git hooks
11. Merge enforcement settings (preserves existing user permissions)

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

The installer deploys the vault scaffold with 22 domain folders and the **Local REST API** plugin pre-installed. On first Obsidian launch:

1. Obsidian will auto-download 5 missing community plugins (dataview, templater, kanban, git, graph-analysis) — requires internet
2. Generate an API key in the Local REST API plugin settings
3. Save the key to `~/.openclaw/workspace/projects/arcane-vault/.obsidian-api-key`
4. The memory daemon will sync workspace files to the vault every 30 minutes

If not using Obsidian, the sync is disabled by default in `obsidian-sync.json` (set `"enabled": false`).

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
- **Memory Bridge** — broadcasts session lifecycle events across nodes (`mesh-bridge.mjs`)
- **Tailscale** — encrypted WireGuard tunnel between nodes

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

### Failure Cascade and Escalation

When a subtask fails:
1. **Cascade**: BFS blocks all transitive dependents
2. **Blocked-critical check**: if any blocked subtask is critical, abort the plan
3. **Escalation**: if the role defines an escalation target, create a recovery task
4. **Recovery**: if the escalation task succeeds, override FAILED → COMPLETED and unblock dependents

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
