# OpenClaw Memory & Automation Architecture
> Updated: 2026-03-04 11:45 America/Montreal

## Overview

OpenClaw's memory system is a **platform-level service** independent of any frontend (Claude Code, OpenClaw Gateway, OpenAI, Kimi, etc.). Frontends write JSONL transcripts; the daemon detects activity via mtime polling and drives the full memory lifecycle.

```
┌────────────────────────────────────────────────────────────────────┐
│                         FRONTENDS (optional)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  Claude Code  │  │   Gateway    │  │  Future LLM  │            │
│  │  (PostToolUse │  │  (Discord/   │  │  (Kimi/GPT/  │            │
│  │   hook)       │  │  Telegram)   │  │  MiniMax)    │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                  │                  │                    │
│         ▼                  ▼                  ▼                    │
│     JSONL writes       JSONL writes       JSONL writes            │
│         │                  │                  │                    │
│         └──────────┬───────┴──────────────────┘                   │
│                    ▼                                               │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              PLATFORM LAYER (always running)                 │  │
│  │                                                              │  │
│  │  ai.openclaw.memory-daemon (KeepAlive, Node.js)             │  │
│  │    ├─ State machine: ENDED → BOOT → ACTIVE → IDLE → ENDED  │  │
│  │    ├─ detect_activity() — JSONL mtime via registry           │  │
│  │    ├─ Phase 0: session bootstrap (ENDED→BOOT)               │  │
│  │    │    ├─ session-recap --previous                          │  │
│  │    │    ├─ clawvault wake + observe + doctor                 │  │
│  │    │    ├─ memory-maintenance --force                        │  │
│  │    │    ├─ compile-boot --all                                │  │
│  │    │    └─ subagent-audit (previous session)                 │  │
│  │    ├─ Phase 1: status sync (every tick, ~5ms)               │  │
│  │    └─ Phase 2: throttled background work                    │  │
│  │         ├─ session-recap (every 10min)                      │  │
│  │         ├─ memory-maintenance (every 30min)                 │  │
│  │         ├─ clawvault observe/reflect/archive (10-30min)     │  │
│  │         ├─ subagent-audit --health-check (every 30min)      │  │
│  │         └─ obsidian-sync (every 30min, after stage 1)       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐ │
│  │  ai.openclaw.gateway    │  │  ai.openclaw.mission-control    │ │
│  │  (KeepAlive)            │  │  (KeepAlive)                    │ │
│  │  Port 18789             │  │  Port 3000                      │ │
│  └─────────────────────────┘  └─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Services (launchd / systemd / pm2)

| Service | Label | Type | Purpose |
|---------|-------|------|---------|
| Memory Daemon | `ai.openclaw.memory-daemon` | KeepAlive | Memory lifecycle orchestrator (Node.js long-running) |
| Gateway | `ai.openclaw.gateway` | KeepAlive | Discord/Telegram bridge (port 18789) |
| Mission Control | `ai.openclaw.mission-control` | KeepAlive | Dashboard + API (port 3000) |

Install: `bin/install-daemon` (detects OS: launchd on macOS, systemd on Linux, pm2 elsewhere)

## Scripts (`workspace/bin/`)

### Memory & Session Lifecycle (PLATFORM)

| Script | Lang | Purpose | Triggered by |
|--------|------|---------|--------------|
| `memory-daemon.mjs` | node | Master orchestrator. Long-running process with ENDED→BOOT→ACTIVE→IDLE→ENDED state machine. Detects activity via JSONL mtime, runs session bootstrap, status sync, throttled background work. | launchd/systemd (KeepAlive) |
| `memory-maintenance.mjs` | node | 12 maintenance checks: archival, predictions, stale tasks, MEMORY.md freshness, companion-state, ClawVault checkpoint, MC sync, daily file, timestamps, ERRORS.md, consolidation, graph health | memory-daemon (30min) |
| `session-recap` | node | Extracts rolling 2-session digest + session fingerprint (JSON sidecar) from JSONL transcripts | memory-daemon (10min) |
| `obsidian-sync.mjs` | node | Push workspace artifacts to Obsidian vault. Hash-based change detection, 14 node-private + 39 shared routes across all 22 vault domains. REST API + file fallback. | memory-daemon (30min, after stage 1) |
| `subagent-audit.mjs` | node | Scan JSONL for Task tool delegations, classify outcomes, update trust-registry + lessons. | memory-daemon (Phase 0 + 30min health check) |
| `clawvault-local` | bash | ClawVault wrapper with auto vault-path injection | memory-daemon + on-demand |
| `clawvault-access-control` | bash | Access control for ClawVault operations | on-demand |
| `compile-boot` | python | Compiles AGENTS.md into profile-aware boot artifacts (.boot/*.compiled.md). Fetches entity context from MC graph API (Option B: top 10 entities). | memory-daemon (session start) |
| `install-daemon` | bash | Cross-platform service installer (macOS/Linux/Windows) | manual (once) |

### Frontend Adapters

| Script | Frontend | Purpose |
|--------|----------|---------|
| `auto-checkpoint` | Claude Code | Thin adapter: touches `frontend-activity`, writes session ID. Called by PostToolUse hook. |
| *(gateway writes JSONL directly)* | Gateway | No adapter needed — daemon scans `~/.openclaw/agents/main/sessions/*.jsonl` |
| *(generic)* | Any new frontend | Touch `.tmp/frontend-activity` OR write JSONL to a scannable dir |

### Delegation & Agent Infrastructure

| Script | Purpose |
|--------|---------|
| `soul-prompt` | Generate soul preambles for sub-agent spawning |
| `trust-registry` | Soul trust tracking (tier, circuit breaker, history) |
| `multi-review` | Spawn 3 parallel reviewers for high-criticality code |
| `quality-gate` | Write-time quality checks on changed files |
| `proactive-scan` | Proactive scanning for workspace issues |
| `evolve` | Genetic algorithm for soul evolution |
| `fitness_score.py` | Fitness scoring for evolved souls |
| `test-multi-soul-workflow` | Test harness for multi-soul |

### Skill Management

| Script | Purpose |
|--------|---------|
| `skill-audit` | Comprehensive skill directory audit (scores, format, routing) |
| `skill-quality-check` | Quick skill quality checks |
| `skill-routing-eval` | Evaluate skill routing accuracy (556 test cases) |
| `hooks/pre-commit` | Skill security gate (blocks dangerous patterns) |

### Other

| Script | Purpose |
|--------|---------|
| `obsidian` | Obsidian vault management integration |

## Activity Detection (How the Daemon Finds Frontends)

The daemon polls JSONL transcript mtimes from a JSON registry every 30s. Any JSONL modified within 15 minutes = "active".

**Registry**: `~/.openclaw/config/transcript-sources.json`
```json
{
  "sources": [
    { "name": "claude-code-workspace", "path": "~/.claude/projects/-Users-moltymac--openclaw-workspace/", "format": "claude-code", "enabled": true },
    { "name": "gateway", "path": "~/.openclaw/agents/main/sessions/", "format": "openclaw-gateway", "enabled": true }
  ]
}
```

**Adding a new frontend**: Add an entry to `transcript-sources.json`. Write JSONL to that directory. The daemon auto-discovers it on next tick.

## File System Layout

```
~/.openclaw/
├── workspace/                     # Git repo (main working directory)
│   ├── SOUL.md                    # Identity
│   ├── PRINCIPLES.md              # Decision heuristics
│   ├── AGENTS.md                  # Operational rules (source of truth)
│   ├── MEMORY.md                  # Curated long-term memory
│   ├── .companion-state.md        # Live session banner (auto-flushed by daemon)
│   ├── .learnings/lessons.md      # Accumulated corrections
│   ├── .boot/                     # Compiled boot artifacts
│   │   ├── manifest.yaml          # Section-to-profile mapping
│   │   └── *.compiled.md          # Profile-specific compiled boots
│   ├── .tmp/                      # Daemon runtime state (not in git)
│   │   ├── daemon-state.json      # Persistent state machine {state, sessionId, pid, updatedAt}
│   │   ├── daemon-throttle.json   # Throttle timestamps {lastRecap, lastMaintenance, lastObsidianSync, lastTrustHealth}
│   │   ├── obsidian-sync-state.json # Hash cache for change detection
│   │   ├── maintenance-results/   # Last maintenance run details
│   │   ├── memory-daemon.log      # Daemon log (append-only)
│   │   └── memory-maintenance.log # Maintenance log
│   ├── memory/                    # Daily logs + active tasks
│   │   ├── YYYY-MM-DD.md          # Daily logs
│   │   ├── active-tasks.md        # Kanban source of truth
│   │   ├── task-backlog.md        # 504 queued tasks (lazy-loaded)
│   │   ├── predictions.md         # Prediction calibration
│   │   ├── last-session-recap.md  # Rolling 2-session digest
│   │   └── archive/               # Monthly summaries (>30 days)
│   ├── memory-vault/              # ClawVault storage
│   ├── bin/                       # All automation scripts
│   ├── skills/                    # Skill definitions
│   └── projects/                  # Project directories
│       ├── arcane/                # AR gaming platform
│       ├── arcane-vault/          # Obsidian vault (sync target)
│       └── mission-control/       # Dashboard (Next.js)
├── config/                        # Platform-level config
│   ├── daemon.json                # Daemon intervals and behavior
│   ├── transcript-sources.json    # Registered JSONL directories
│   └── obsidian-sync.json         # Obsidian vault routing (14 private + 39 shared routes)
├── agents/main/sessions/          # Gateway JSONL transcripts
├── credentials/                   # API keys (encrypted)
├── cron/                          # Cron jobs config
├── logs/                          # Gateway logs
├── souls/                         # Soul definitions
└── openclaw.json                  # Master config

~/.claude/
├── settings.json                  # PostToolUse hook → auto-checkpoint
└── projects/
    └── -Users-moltymac--openclaw-workspace/
        ├── *.jsonl                # Claude Code session transcripts
        └── memory/                # Claude Code auto-memory (separate from OpenClaw)

~/Library/LaunchAgents/
├── ai.openclaw.memory-daemon.plist
├── ai.openclaw.gateway.plist
└── ai.openclaw.mission-control.plist
```

## Data Flow

### Session Start (ENDED → BOOT → ACTIVE)
```
memory-daemon detects new session via JSONL mtime
  Phase 0 Bootstrap:
  → session-recap --previous (capture what last session did)
  → clawvault-local wake (restore active context)
  → clawvault-local observe --cron (scan recent entries)
  → clawvault-local doctor (verify vault integrity)
  → memory-maintenance --force (catch up on any stale maintenance)
  → compile-boot --all (ensure boot artifacts are fresh)
  → subagent-audit on previous session (scan delegations, update trust)
```

### During Active Session (ACTIVE state)
```
Phase 1 — Status Sync (every tick, ~5ms):
  → Update .companion-state.md with running/done counts

Phase 2 — Throttled Background Work:
  Stage 1 (parallel):
    Every 10min: session-recap (rolling 2-session digest)
    Every 30min: memory-maintenance (archival, predictions, stale tasks)
    Every 10-30min: clawvault observe/reflect/archive (vault lifecycle)
    Every 30min: subagent-audit --health-check (trust registry)
  Stage 2 (after stage 1):
    Every 30min: obsidian-sync (push workspace → vault, hash-based)
```

### Session End (ACTIVE → IDLE → ENDED or ACTIVE → ENDED)
```
Idle timeout (15min no JSONL writes) → IDLE
  → Final session-recap
  → clawvault-local observe (capture final activity)
IDLE timeout (5min) → ENDED
  → clawvault-local sleep

Session switch (ACTIVE → ENDED, new session detected):
  → Quick cleanup: session-recap + clawvault observe
  → Immediately transitions to BOOT for the new session
```

### Mission Control Integration
```
memory-maintenance → POST localhost:3000/api/memory/sync
  → MC indexes 156+ memory documents (FTS5 full-text search)
memory-maintenance → POST localhost:3000/api/memory/consolidate
  → Merges near-duplicate facts (Jaccard ≥ 0.8)
memory-maintenance → GET/POST localhost:3000/api/memory/graph
  → Seeds known entities, reports graph stats
active-tasks.md → MC kanban reads file every 3s (reactive, no API needed)
```

## Knowledge Graph (Entity-Relation Memory)

The memory system includes a knowledge graph that tracks entities, their relationships, and how facts change over time.

### Architecture
```
                    ┌─────────────────────────────────┐
                    │     memory_entities (25+)        │
                    │  person, project, contract,      │
                    │  concept, tool, file             │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     memory_relations   memory_entity_items   memory_items
     (edges: uses,      (junction: which      (facts with
      depends_on,        entities appear       superseded_by,
      blocks, owns,      in which facts)       valid_from/to)
      part_of,
      supersedes)
```

### How It Works
1. **Fact ingestion** → `storeExtractedFacts()` in `extract.ts`
2. **Entity extraction** → heuristic: known entities, PascalCase detection, file paths → `processFactEntities()` in `entities.ts`
3. **Relation extraction** → pattern matching on fact text (e.g., "X uses Y", "X depends on Y")
4. **Contradiction detection** → Jaccard similarity ≥ 0.6 with shared entities → supersede old fact
5. **Consolidation** → maintenance check #11, Jaccard ≥ 0.8 → merge duplicates
6. **Graph-aware retrieval** → `tieredSearch()` expands queries with 1-hop related entities
7. **Boot injection** → `compile-boot` fetches top-10 entities from `GET /api/memory/graph?boot=true`

### Token Budget (Option B)
- Boot: ~800 tokens (10 entities × 3 relations each, hard capped)
- Background: ~3K tokens/day (entity extraction runs inside existing maintenance cycle)
- Retrieval expansion: ~300 tokens/query (graph adds 1-3 extra search terms)

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/memory/graph` | GET | Graph stats + top entities with relations |
| `/api/memory/graph?boot=true` | GET | Boot injection block (Option B) |
| `/api/memory/graph` | POST | Seed known entities |
| `/api/memory/consolidate` | POST | Merge near-duplicate facts |

### Session Fingerprints
`session-recap` emits `.tmp/session-fingerprint.json` every 10min:
```json
{
  "turns": 149, "durationMin": 86,
  "filesRead": ["..."], "filesEdited": ["..."],
  "commands": ["..."], "skills": []
}
```

## Frontend Contract

To integrate a new frontend (e.g., Kimi, GPT, MiniMax):

1. Write JSONL transcripts to a dedicated directory
2. Register the directory in `~/.openclaw/config/transcript-sources.json`:
   ```json
   { "name": "my-frontend", "path": "~/.openclaw/agents/my-frontend/sessions/", "format": "openclaw-gateway", "enabled": true }
   ```
3. The daemon auto-discovers it on next tick — no code changes needed

JSONL format (either works):
```jsonl
{"type":"message","message":{"role":"user","content":"..."},"timestamp":"2026-03-03T22:00:00Z"}
{"type":"message","message":{"role":"assistant","content":"..."},"timestamp":"2026-03-03T22:00:05Z"}
```

## Dependency Chain

```
memory-daemon.mjs (node)
  ├─ calls: session-recap (node)
  ├─ calls: memory-maintenance.mjs (node)
  ├─ calls: subagent-audit.mjs (node)
  ├─ calls: obsidian-sync.mjs (node)
  ├─ calls: clawvault-local (bash + clawvault npm package)
  └─ calls: compile-boot (/usr/bin/python3 + pyyaml)
```

Hard dependency: `node` (all .mjs modules and session-recap)
Soft dependencies: `python3` (compile-boot — skipped if missing), `clawvault` (gracefully skipped), `curl` (MC sync skipped if down)

## Startup / Onboarding — Exact Command Order

### Fresh Machine Setup (from scratch)

```bash
# 1. Prerequisites
brew install node
# python3 (system /usr/bin/python3 with pyyaml) — needed for compile-boot only

# 2. Clone workspace
git clone <repo-url> ~/.openclaw/workspace
cd ~/.openclaw/workspace

# 3. Create required directories
mkdir -p .tmp memory/archive .boot .learnings
mkdir -p ~/.openclaw/config

# 4. Create config files
# transcript-sources.json — register where frontends write JSONL
cat > ~/.openclaw/config/transcript-sources.json << 'JSON'
{
  "sources": [
    { "name": "claude-code-workspace", "path": "~/.claude/projects/-Users-$(whoami)--openclaw-workspace/", "format": "claude-code", "enabled": true }
  ]
}
JSON

# 5. Install ClawVault (optional — soft dependency)
mkdir -p .npm-global
npm install --prefix .npm-global clawvault
# Verify: bin/clawvault-local status

# 6. Install Mission Control (optional — dashboard)
cd projects/mission-control && npm install && cd ../..

# 7. Compile boot artifacts
python3 bin/compile-boot --all

# 8. Install daemon service (auto-detects OS)
bin/install-daemon
# macOS: generates + loads launchd plist (KeepAlive)
# Linux: generates + enables systemd unit
# Other: uses pm2

# 9. (Optional) Mission Control + Gateway services
# Same pattern — see their respective plist/unit files

# 10. Verify
launchctl list | grep openclaw         # PID present = running
tail -5 .tmp/memory-daemon.log         # State transitions visible
cat .companion-state.md                # last_flush is current
```

### Adding a New Frontend

```bash
# 1. Write JSONL to a dedicated directory
mkdir -p ~/.openclaw/agents/<frontend-name>/sessions
# Write transcript lines per the JSONL format in "Frontend Contract" above

# 2. Register in transcript-sources.json
# Add an entry to ~/.openclaw/config/transcript-sources.json:
# { "name": "<frontend-name>", "path": "~/.openclaw/agents/<frontend-name>/sessions/", "format": "openclaw-gateway", "enabled": true }

# Daemon auto-discovers on next tick — no restart needed
```

### Verifying Everything Works

```bash
# 1. Check services
launchctl list | grep openclaw

# 2. Check daemon state
cat ~/.openclaw/workspace/.tmp/daemon-state.json    # state should be ACTIVE
cat ~/.openclaw/workspace/.tmp/daemon-throttle.json  # recent timestamps

# 3. Check daemon log
tail -20 ~/.openclaw/workspace/.tmp/memory-daemon.log

# 4. Run modules standalone
node bin/memory-maintenance.mjs --force --verbose
node bin/obsidian-sync.mjs --dry-run --verbose
node bin/subagent-audit.mjs --health-check

# 5. Check companion state
cat ~/.openclaw/workspace/.companion-state.md

# 6. Check session recap
head -10 ~/.openclaw/workspace/memory/last-session-recap.md
```

## Portability Notes

All scripts in `bin/` derive `WORKSPACE` from their own location:
```bash
# Bash scripts:
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${OPENCLAW_WORKSPACE:-$(dirname "$SCRIPT_DIR")}"

# Node.js modules:
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
```

This means:
- **No hardcoded username** — works for any user
- **No hardcoded paths** — works wherever the workspace is cloned
- **OPENCLAW_WORKSPACE env var** — optional override for non-standard layouts
- **Claude Code project dir** — derived from workspace absolute path
- **Transcript dirs** — configurable via `~/.openclaw/config/transcript-sources.json`

The only machine-specific file is the launchd plist (macOS-only). `bin/install-daemon` generates the appropriate service file for each OS.

## Validation Report — 2026-03-04 11:30 America/Montreal

### Summary
Daemon v2 deployment (bash → Node.js): **COMPLETE**. 6 bugs fixed, all modules verified, KeepAlive service live.

### v2 Deployment Verification

| # | Check | Result |
|---|-------|--------|
| V1 | Daemon running as KeepAlive Node.js process | ✅ PID active |
| V2 | State machine: ENDED→BOOT→ACTIVE transitions logged | ✅ |
| V3 | Phase 0 bootstrap runs on session start (recap, maintenance, compile-boot, audit) | ✅ |
| V4 | Phase 1 status sync updates .companion-state.md | ✅ last_flush current |
| V5 | obsidian-sync dry-run: 15 synced, 354 unchanged, 0 errors | ✅ |
| V6 | memory-maintenance: all 10 checks pass, 0 warnings | ✅ |
| V7 | subagent-audit health-check: trust registry healthy (2 souls, circuits closed) | ✅ |
| V8 | Throttle state persists across restarts (daemon-throttle.json) | ✅ |

### Architecture: v1 (bash) → v2 (Node.js)

| Aspect | v1 | v2 |
|--------|----|----|
| Daemon runtime | bash, StartInterval=30s (spawn/exit loop) | Node.js, KeepAlive (long-running process) |
| State machine | Implicit (file-based) | Explicit: ENDED→BOOT→ACTIVE→IDLE→ENDED |
| Activity detection | Touchfile + JSONL scan + hardcoded dirs | JSONL mtime via JSON registry (transcript-sources.json) |
| Throttling | Epoch files (.tmp/last-checkpoint, .tmp/last-maintenance) | Single JSON file (daemon-throttle.json) |
| Maintenance | bash (memory-maintenance) | Node.js (memory-maintenance.mjs), 10 checks |
| Obsidian sync | Not included | obsidian-sync.mjs: hash-based, 14 private + 39 shared routes |
| Subagent audit | Not included | subagent-audit.mjs: JSONL scanning, trust registry |
| New frontend registration | Edit script source code | Add entry to transcript-sources.json |
| Install | Manual plist creation | `bin/install-daemon` (macOS/Linux/pm2) |

### Knowledge Graph Integration — 2026-03-04 13:00

| # | Check | Result |
|---|-------|--------|
| G1 | Schema: memory_entities + memory_relations + memory_entity_items tables | ✅ |
| G2 | Entity seeding: 20 known entities (contracts, tools, projects, people) | ✅ 25 total |
| G3 | Entity extraction: heuristic (PascalCase, known, file paths) fires on fact ingestion | ✅ |
| G4 | Relation extraction: pattern matching (uses, depends_on, blocks, owns) | ✅ 6 relations |
| G5 | Graph-aware retrieval: 1-hop expansion in tieredSearch() | ✅ |
| G6 | Boot injection: compile-boot fetches top-10 entities from MC API | ✅ ~800 tokens |
| G7 | Temporal tracking: superseded_by + valid_from/to on memory_items | ✅ |
| G8 | Contradiction detection: Jaccard ≥ 0.6 auto-supersedes old facts | ✅ |
| G9 | Consolidation: maintenance check #11, merges Jaccard ≥ 0.8 duplicates | ✅ |
| G10 | Graph health: maintenance check #12, seeds + reports stats | ✅ |
| G11 | Session fingerprints: .tmp/session-fingerprint.json sidecar | ✅ |
| G12 | MC build: 31 routes, all clean | ✅ |

### Known Issues (non-blocking)
- ClawVault wake intermittently fails (exit 1) — vault service startup timing
- ClawVault observe can timeout at 60s — large vault scans; daemon continues gracefully
