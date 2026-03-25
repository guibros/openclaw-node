# openclaw-node

Installable package for deploying an OpenClaw node. Includes the full infrastructure stack:

- **Memory Daemon** — persistent background service managing session lifecycle, memory maintenance, and Obsidian sync
- **HyperAgent Protocol** — self-improving agent loop: telemetry, structured reflection, strategy archive, and self-modifying proposals with human-gated approval
- **Mission Control** — Next.js web dashboard (kanban, timeline, graph visualization, memory browser)
- **Soul System** — multi-soul orchestration with trust registry and evolution
- **Skill Library** — 100+ skills for AI agent capabilities
- **Boot Compiler** — profile-aware boot artifact generation for multiple AI models
- **ClawVault** — structured knowledge vault with search and handoffs
- **Knowledge Server** — LLM-agnostic MCP server for semantic search over markdown (local embeddings, sqlite-vec, NATS mesh)

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
│   ├── .knowledge.db         # Semantic search index (auto-generated)
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
- **Memory Bridge** — broadcasts session lifecycle events across nodes (`mesh-bridge.mjs`)
- **Knowledge Server** — semantic search via NATS (`mesh.tool.{nodeId}.knowledge.*`), workers query lead's index
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
