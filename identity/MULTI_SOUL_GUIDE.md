# Multi-Soul Orchestration System — User Guide

**Date:** 2026-02-20 02:15 America/Montreal
**Version:** 1.0.0

---

## Overview

The Multi-Soul Orchestration System enables specialized AI agents (souls) to collaborate on complex tasks while maintaining:
- **Memory isolation** — Private workspace per soul
- **Evolution tracking** — Auditable learning from task outcomes
- **Task handoff** — Transparent delegation between souls
- **Review gates** — Human approval before souls evolve

---

## Architecture

### Soul Registry

All souls live in `~/.openclaw/souls/`:

```
souls/
├── registry.json          # Soul catalog
├── daedalus/              # Orchestrator soul
│   ├── SOUL.md
│   ├── PRINCIPLES.md
│   └── capabilities.json
├── blockchain-auditor/    # Security specialist
│   ├── SOUL.md
│   ├── PRINCIPLES.md
│   ├── capabilities.json
│   └── evolution/
│       ├── genes.json
│       ├── events.jsonl
│       └── capsules.json
└── lore-writer/           # Narrative specialist
    └── ...
```

### Components

1. **Soul Registry** (`registry.json`) — Central catalog of all souls
2. **Mission Control** (localhost:3000) — Dashboard for tasks, handoffs, evolution
3. **ClawVault** (`memory-vault/`) — Isolated memory storage
4. **Git** — Version control for evolution history

---

## Working with Souls

### Viewing Souls

```bash
curl http://localhost:3000/api/souls | jq
```

Returns:
```json
[
  {
    "id": "daedalus",
    "type": "orchestrator",
    "specializations": ["orchestration", "multi-agent", "planning"],
    ...
  },
  {
    "id": "blockchain-auditor",
    "type": "specialist",
    "specializations": ["solidity", "security"],
    ...
  }
]
```

### Creating a New Soul

1. **Create directory structure:**
   ```bash
   mkdir -p ~/.openclaw/souls/my-soul/evolution
   ```

2. **Write SOUL.md** (identity, values, workflow)
3. **Write PRINCIPLES.md** (decision heuristics)
4. **Write capabilities.json:**
   ```json
   {
     "skills": ["skill1", "skill2"],
     "tools": ["Read", "Bash", "Grep"],
     "permissions": {
       "memory": {
         "shared": "read",
         "private": ["my-soul"],
         "handoffs": "read"
       }
     }
   }
   ```

5. **Initialize evolution files:**
   ```bash
   echo '{"version":"1.0.0","genes":[]}' > ~/.openclaw/souls/my-soul/evolution/genes.json
   echo '{"version":"1.0.0","capsules":[]}' > ~/.openclaw/souls/my-soul/evolution/capsules.json
   touch ~/.openclaw/souls/my-soul/evolution/events.jsonl
   ```

6. **Register via API:**
   ```bash
   curl -X POST http://localhost:3000/api/souls \
     -H "Content-Type: application/json" \
     -d '{
       "id": "my-soul",
       "type": "specialist",
       "basePath": "~/.openclaw/souls/my-soul",
       "capabilities": {...},
       "specializations": ["domain1", "domain2"],
       "evolutionEnabled": true,
       "parentSoul": "daedalus"
     }'
   ```

---

## Task Handoff

### Handing Off a Task

```bash
curl -X POST http://localhost:3000/api/tasks/T-20260220-001/handoff \
  -H "Content-Type: application/json" \
  -d '{
    "toSoul": "blockchain-auditor",
    "reason": "Requires deep Solidity security expertise",
    "context": {
      "focusAreas": ["Reentrancy analysis", "Access control review"],
      "previousWork": ["Initial audit complete"],
      "files": ["contracts/ManaTokenV1.sol"]
    }
  }'
```

**What happens:**
1. Task ownership: `daedalus` → `blockchain-auditor`
2. Handoff document created: `memory-vault/handoffs/T-20260220-001-handoff.md`
3. Logged in `soul_handoffs` table for audit trail

### Viewing Handoff Document

```bash
cat ~/.openclaw/workspace/memory-vault/handoffs/T-20260220-001-handoff.md
```

Example output:
```markdown
# Task Handoff: T-20260220-001
From: daedalus → blockchain-auditor
Reason: Requires deep Solidity security expertise

## Task Context
**Title:** Audit ManaTokenV1.sol
**Status:** in_progress

## Focus Areas
- Reentrancy analysis
- Access control review

## Resources
- contracts/ManaTokenV1.sol
```

---

## Soul Evolution

### How Evolution Works

1. **Capture** — Soul writes evolution event to `evolution/events.jsonl` after task completion
2. **Review** — Daedalus sees pending event in Mission Control dashboard
3. **Approve/Reject** — If approved, change is applied + git commit created

### Creating an Evolution Event

(Typically done automatically by the soul after completing a task)

```bash
curl -X POST http://localhost:3000/api/souls/blockchain-auditor/evolution \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_002",
    "soulId": "blockchain-auditor",
    "category": "attack_pattern",
    "trigger": "task_completion",
    "summary": "Discovered new flash loan attack vector",
    "proposedChange": {
      "target": "genes.json",
      "action": "add",
      "content": {
        "id": "gene_flashloan_attack",
        "category": "attack_pattern",
        "signal": "...",
        "strategy": [...]
      }
    },
    "reviewStatus": "pending"
  }'
```

### Reviewing Evolution Events

**Via Mission Control UI:**
1. Navigate to http://localhost:3000/souls
2. Select the soul (e.g., blockchain-auditor)
3. View pending evolution events
4. Click "Approve" or "Reject"

**Via API:**

```bash
# View pending events
curl 'http://localhost:3000/api/souls/blockchain-auditor/evolution?status=pending'

# Approve event
curl -X PATCH 'http://localhost:3000/api/souls/blockchain-auditor/evolution?eventId=evt_002' \
  -H "Content-Type: application/json" \
  -d '{"action":"approve","reviewedBy":"daedalus"}'

# Reject event
curl -X PATCH 'http://localhost:3000/api/souls/blockchain-auditor/evolution?eventId=evt_002' \
  -H "Content-Type: application/json" \
  -d '{"action":"reject","reviewedBy":"daedalus"}'
```

### Evolution Git History

Every approved evolution creates a git commit:

```bash
cd ~/.openclaw/souls
git log --oneline
```

Example:
```
eae6b23 evolution(evt_001): Discovered cross-contract reentrancy pattern
64f2e4a Initial souls commit
```

### Rolling Back Evolution

```bash
cd ~/.openclaw/souls
git revert eae6b23  # Revert specific evolution commit
```

---

## Memory Isolation

### Memory Categories

```
memory-vault/
├── shared/              # Cross-soul knowledge (all can read, only daedalus writes)
│   ├── project-arcane/
│   └── decisions/
├── private/             # Per-soul isolation (only owner + daedalus can access)
│   ├── daedalus/
│   ├── blockchain-auditor/
│   └── lore-writer/
└── handoffs/            # Task context transfers (readable by involved souls)
    └── T-20260220-001-handoff.md
```

### Access Control

Enforced by `bin/clawvault-access-control`:

```bash
# Check if soul can access category
clawvault-access-control blockchain-auditor private/blockchain-auditor read
# Output: GRANTED

clawvault-access-control blockchain-auditor private/lore-writer read
# Output: DENIED: Can only access own private memory
```

---

## Example Workflows

### Workflow 1: Contract Audit with Specialist Soul

```bash
# 1. Daedalus creates task
curl -X POST http://localhost:3000/api/tasks \
  -d '{"id":"T-20260220-003","title":"Audit ManaTokenV1.sol",...}'

# 2. Hand off to blockchain-auditor
curl -X POST http://localhost:3000/api/tasks/T-20260220-003/handoff \
  -d '{"toSoul":"blockchain-auditor","reason":"Security expertise needed"}'

# 3. Blockchain-auditor completes audit, writes to private/blockchain-auditor/

# 4. Blockchain-auditor proposes evolution (new attack pattern discovered)
curl -X POST http://localhost:3000/api/souls/blockchain-auditor/evolution \
  -d '{...}'

# 5. Daedalus reviews and approves evolution via UI

# 6. Blockchain-auditor hands task back to Daedalus
# 7. Daedalus summarizes findings for Gui
```

### Workflow 2: Multi-Soul Collaboration

```bash
# 1. Daedalus receives: "Design gameplay loop and audit smart contracts"

# 2. Hand off lore design to lore-writer
curl -X POST http://localhost:3000/api/tasks/T-20260220-004/handoff \
  -d '{"toSoul":"lore-writer","reason":"Need narrative design"}'

# 3. Hand off contract audit to blockchain-auditor (parallel task)
curl -X POST http://localhost:3000/api/tasks/T-20260220-005/handoff \
  -d '{"toSoul":"blockchain-auditor","reason":"Security audit"}'

# 4. Both souls work independently, write to their private/ memory

# 5. Both hand back to Daedalus when done

# 6. Daedalus integrates findings and responds to Gui
```

---

## Troubleshooting

### Soul Not Found

```bash
# Check registry
curl http://localhost:3000/api/souls | jq '.[] | .id'

# Re-register soul if missing
curl -X POST http://localhost:3000/api/souls -d '{...}'
```

### Handoff Failed

```bash
# Check task exists
curl http://localhost:3000/api/tasks | jq '.[] | {id, title}'

# Verify soul ID is correct
curl http://localhost:3000/api/souls | jq '.[] | .id'
```

### Evolution Approval Failed

```bash
# Check git repo initialized
cd ~/.openclaw/souls && git status

# If not initialized:
git init
git config user.name "Daedalus"
git config user.email "daedalus@openclaw.local"
git add .
git commit -m "Initial souls commit"
```

### Access Denied in ClawVault

```bash
# Verify access control script
clawvault-access-control <soul-id> <category> <read|write>

# Check permissions in capabilities.json
cat ~/.openclaw/souls/<soul-id>/capabilities.json | jq '.permissions.memory'
```

---

## API Reference

### Souls

- `GET /api/souls` — List all souls
- `GET /api/souls?id=<soul-id>` — Get specific soul
- `POST /api/souls` — Register new soul
- `PATCH /api/souls?id=<soul-id>` — Update soul
- `DELETE /api/souls?id=<soul-id>` — Delete soul

### Handoffs

- `POST /api/tasks/:id/handoff` — Hand off task to another soul

### Evolution

- `GET /api/souls/:id/evolution?status=<pending|approved|rejected|all>` — List evolution events
- `POST /api/souls/:id/evolution` — Create evolution event
- `PATCH /api/souls/:id/evolution?eventId=<event-id>` — Approve/reject evolution

---

## Best Practices

1. **Name souls descriptively** — `blockchain-auditor`, not `agent-1`
2. **Keep SOUL.md concise** — Identity and workflow, not exhaustive docs
3. **Review evolutions promptly** — Don't let pending queue grow
4. **Use handoff context** — Give receiving soul enough info to start
5. **Isolate private memory** — Don't leak specialist knowledge to shared/
6. **Git commit messages** — Auto-generated, include event ID for traceability
7. **Test before deploying** — Use test tasks to validate handoff workflow

---

## Soul-Aware Task Tool Spawning

Daedalus can spawn sub-agents that operate **as a specific soul**, inheriting that soul's identity, principles, learned genes, and constraints.

### Using `bin/soul-prompt` (CLI)

```bash
# Generate preamble for blockchain-auditor
bin/soul-prompt blockchain-auditor

# With task handoff context
bin/soul-prompt blockchain-auditor --task-id T-20260220-003

# With extra context
bin/soul-prompt lore-writer --extra-context "Focus on Mana Well flavor text"
```

**Output:**
- `stdout` — The assembled prompt preamble (pipe into Task tool prompt)
- `stderr` — Recommended `subagent_type` (`general-purpose` or `Explore`)

### Using Mission Control API

```bash
curl -X POST http://localhost:3000/api/souls/blockchain-auditor/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "T-20260220-003",
    "extraContext": "Focus on reentrancy in withdraw()"
  }'
```

**Response:**
```json
{
  "preamble": "# Soul Identity\n...",
  "subagentType": "general-purpose",
  "soulId": "blockchain-auditor"
}
```

The API also logs a spawn event to the `soul_spawns` table for tracking.

### Preamble Contents

The generated preamble includes (in order):
1. **Soul Identity** — From `SOUL.md`
2. **Decision Principles** — From `PRINCIPLES.md`
3. **Learned Patterns** — From `evolution/genes.json` (if any)
4. **Operational Constraints** — Memory permissions, restricted actions, available tools
5. **Handoff Context** — From `memory-vault/handoffs/` (if task-id provided)
6. **Completion Protocol** — Standard reporting requirements

### subagent_type Mapping

| Soul tools include | subagent_type |
|---|---|
| `Write`, `Edit`, or `Bash` | `general-purpose` |
| Read-only tools only | `Explore` |

### Example: Full Workflow

```bash
# 1. Generate preamble
PREAMBLE=$(bin/soul-prompt blockchain-auditor --task-id T-20260220-003 2>/dev/null)
TYPE=$(bin/soul-prompt blockchain-auditor 2>&1 1>/dev/null)

# 2. Daedalus uses Task tool with:
#    subagent_type: $TYPE
#    prompt: "$PREAMBLE\n\n## Task\nAudit ManaTokenV1.sol..."
#    name: "blockchain-auditor"
```

---

## Cross-Soul Learning Protocol

When a soul learns something valuable (approved gene), it can be **propagated** to other souls that might benefit.

### How It Works

1. A soul proposes an evolution event (new gene discovered)
2. Daedalus reviews and **approves** the gene (standard flow)
3. After approval, the UI shows **"Propagate to other souls?"** with eligible target buttons
4. Clicking a target creates a **propagation event** in that soul's evolution queue
5. The propagated event appears as **"Inherited from: [source-soul]"** with pending status
6. The target soul's evolution can be approved/rejected independently

### Gene Scope (Transfer Rules)

Genes can include an optional `scope` field controlling propagation:

```json
{
  "id": "gene_example",
  "category": "attack_pattern",
  "scope": {
    "domain": "security",
    "applicableSouls": [],
    "transferRule": "manual_approval"
  },
  "signal": "..."
}
```

| `transferRule` | Behavior |
|---|---|
| `manual_approval` | Propagation buttons shown — you decide per-soul |
| `never` | No propagation allowed — gene stays in originating soul only |

### Propagation API

```bash
# Propagate an approved gene to another soul
curl -X POST http://localhost:3000/api/souls/blockchain-auditor/propagate \
  -H "Content-Type: application/json" \
  -d '{
    "sourceEventId": "evt_001",
    "targetSoulId": "lore-writer"
  }'
```

**Response:**
```json
{
  "success": true,
  "propagationEventId": "evt_001-propagate-lore-writer",
  "sourceSoulId": "blockchain-auditor",
  "targetSoulId": "lore-writer"
}
```

### Traceability

Every propagated gene carries metadata:
- `sourceSoulId` — which soul discovered the pattern
- `sourceEventId` — the original evolution event
- `trigger: "cross_soul_propagation"` — distinguishes inherited vs native genes

These fields are stored in both `events.jsonl` and the `soul_evolution_log` DB table.

### Example: Propagating a Meta-Pattern

```
1. lore-writer discovers: "narrative threat modeling"
   → Posts evolution event evt_003

2. Daedalus approves evt_003 for lore-writer

3. UI shows: "Propagate to: [blockchain-auditor]"
   → Daedalus clicks blockchain-auditor

4. System creates: evt_003-propagate-blockchain-auditor
   → Appears in blockchain-auditor's pending events
   → Shows "Inherited from: lore-writer" badge

5. Daedalus reviews from blockchain-auditor's view
   → Approves → gene added to blockchain-auditor's genes.json
   → Rejects → nothing happens
```

---

## Future Enhancements

- **Automatic handoff routing** — AI decides which soul to delegate to
- **A/B testing** — Compare soul performance across similar tasks

---

**Questions?** Check Mission Control dashboard at http://localhost:3000
