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
