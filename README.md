# openclaw-node

Installable package for deploying an OpenClaw node. Includes the full infrastructure stack:

- **Memory Daemon** — persistent background service managing session lifecycle, memory maintenance, and Obsidian sync
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

## Environment Variables

See `openclaw.env.example` for all available configuration. Key variables:

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_NODE_ID` | Yes | Unique name for this node |
| `OPENCLAW_TIMEZONE` | Yes | Timezone (e.g. `America/Montreal`) |
| `ANTHROPIC_API_KEY` | Optional | For Claude-powered features |
| `OPENAI_API_KEY` | Optional | For OpenAI-powered features |
| `GOOGLE_API_KEY` | Optional | For Gemini-powered features |
| `DISCORD_BOT_TOKEN` | Optional | For Discord integration |
| `TELEGRAM_BOT_TOKEN` | Optional | For Telegram integration |
| `WEB_SEARCH_API_KEY` | Optional | For web search capability |
| `OBSIDIAN_API_KEY` | Optional | For Obsidian vault sync |
