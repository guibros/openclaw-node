# openclaw-node

Installable package for deploying an OpenClaw node. Includes the full infrastructure stack:

- **Memory Daemon** — persistent background service managing session lifecycle, memory maintenance, and Obsidian sync
- **HyperAgent Protocol** — self-improving agent loop: telemetry, structured reflection, strategy archive, and self-modifying proposals with human-gated approval
- **Mission Control** — Next.js web dashboard (kanban, timeline, graph visualization, memory browser)
- **Soul System** — multi-soul orchestration with trust registry and evolution
- **Skill Library** — 100+ skills for AI agent capabilities
- **Boot Compiler** — profile-aware boot artifact generation for multiple AI models
- **ClawVault** — structured knowledge vault with search and handoffs

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
├── souls/                    # Soul definitions (daedalus, specialists)
├── services/                 # Service reference files
├── workspace/
│   ├── bin/                  # All scripts (daemon, maintenance, etc.)
│   ├── skills/               # 100+ skill definitions
│   ├── memory/               # Daily logs, active tasks, archive
│   ├── memory-vault/         # ClawVault structured knowledge
│   ├── .boot/                # Compiled boot profiles
│   ├── .learnings/           # Corrections and lessons
│   ├── .tmp/                 # Runtime state (logs, sessions)
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
