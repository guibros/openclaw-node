# MEMORY_SPEC.md — Portable Memory Structural Contract
# OpenClaw Mesh Meta Protocol — Layer 2

Created: 2026-03-03 10:45 America/Montreal
Version: 1.0.0
Author: Daedalus
Status: ACTIVE

## Purpose

This document defines what "healthy memory" looks like for any OpenClaw node.
It is the **meta protocol** — the structural contract that every node must satisfy,
regardless of its personality, role, or private memory content.

Any node can run a compliance check against any other node using this spec.
A node that fails compliance is **structurally degraded** and must be repaired
before it can participate in mesh operations.

## Scope

This spec covers:
- Required file structure (what MUST exist)
- File format contracts (schemas)
- Freshness constraints (staleness thresholds)
- Automation requirements (Principle 11 compliance)
- Cross-reference integrity (internal consistency)
- Compliance check protocol (how to verify)

This spec does NOT cover:
- Private memory content (what a node remembers is its own business)
- Personality or identity (SOUL.md content is per-node)
- Shared truth layer (Obsidian vault sync is a separate protocol)

---

## 1. Required File Structure

Every compliant node MUST have these files at its workspace root:

### Tier 1 — Identity (stable, rarely changes)

| File | Required | Purpose | Max Staleness |
|------|----------|---------|---------------|
| `SOUL.md` | YES | Node identity, voice, personality | 90 days |
| `PRINCIPLES.md` | YES | Decision heuristics | 90 days |
| `AGENTS.md` | YES | Operational rules, memory protocol | 30 days |

### Tier 2 — Dynamic State (changes per session)

| File | Required | Purpose | Max Staleness |
|------|----------|---------|---------------|
| `.companion-state.md` | YES | Immediate session context | 4 hours (if active) |
| `memory/active-tasks.md` | YES | Running/blocked/done tasks | 48 hours |
| `.learnings/lessons.md` | YES | Accumulated corrections | 30 days |
| `MEMORY.md` | YES | Curated long-term memory | 7 days |

### Tier 3 — Temporal (daily/periodic)

| File/Pattern | Required | Purpose | Max Staleness |
|--------------|----------|---------|---------------|
| `memory/YYYY-MM-DD.md` (today) | YES | Today's raw journal | Created by session start |
| `memory/archive/` | YES (dir) | Monthly summaries | N/A |
| `memory/predictions.md` | OPTIONAL | Decision calibration | 7 days (open predictions) |
| `.learnings/ERRORS.md` | OPTIONAL | Error tracking | 14 days (pending entries) |

### Tier 4 — Automation (executables)

| File | Required | Purpose |
|------|----------|---------|
| `bin/auto-checkpoint` | YES | Memory daemon (session start, flush, recap, maintenance) |
| `bin/memory-maintenance` | YES | Periodic maintenance (archival, predictions, stale tasks, sync) |
| `bin/session-recap` | YES | Rolling conversation digest |

### Tier 5 — Optional Infrastructure

| File/System | Required | Purpose |
|-------------|----------|---------|
| `bin/clawvault-local` | NO | Structured vault + search |
| `memory-vault/` | NO | ClawVault data directory |
| Mission Control (localhost:3000) | NO | SQLite + FTS5 + dashboard |
| `HEARTBEAT.md` | NO (but recommended) | Heartbeat checklist |

---

## 2. File Format Contracts

### 2.1 MEMORY.md

MUST contain these temporal sections in this order:

```
## Active Context (this week)
## Recent (this month)
## Stable (long-term preferences & facts)
## Archive Reference
```

**Validation rules:**
- `Active Context` entries must reference dates within the last 7 days
- `Recent` entries must reference dates within the last 30 days
- `Stable` entries have no date constraint
- No duplicate entries across sections (same fact in two places = violation)
- Conflict resolution: most recent entry wins unless older is marked `[core preference]`

### 2.2 memory/active-tasks.md

Each task entry MUST conform to this YAML-like schema:

```yaml
- task_id: T-YYYYMMDD-NNN       # REQUIRED, unique
  title: "<short title>"         # REQUIRED, ≤100 chars
  status: <enum>                 # REQUIRED: queued|running|blocked|waiting-user|done|cancelled
  owner: <string>                # REQUIRED for running tasks
  success_criteria:              # RECOMMENDED for non-trivial tasks
    - <criterion>
  artifacts:                     # OPTIONAL
    - <path or link>
  next_action: "<step>"          # REQUIRED for running/blocked tasks
  updated_at: <timestamp>        # REQUIRED, ISO-8601 or "YYYY-MM-DD HH:MM America/Montreal"
```

**Validation rules:**
- No two tasks with the same `task_id`
- `running` tasks MUST have `owner` and `next_action`
- `updated_at` must parse to a valid datetime
- Running tasks not updated in >24h = STALE (warning)
- Running tasks not updated in >48h = VIOLATION

### 2.3 memory/YYYY-MM-DD.md (daily files)

```markdown
# YYYY-MM-DD — Daily Log

## <Section Header>
- <entries>
```

**Validation rules:**
- Filename date MUST match the `# YYYY-MM-DD` header
- File must not be empty (at minimum, the header)
- Files >30 days old MUST be archived (violation if still in `memory/`)

### 2.4 memory/predictions.md

```markdown
### YYYY-MM-DD — [decision name]
**Decision:** <what was chosen>
**Prediction:** <expected outcome>
**Confidence:** High | Medium | Low
**Outcome:** <actual result or [expired]>
**Delta:** <what surprised you>
**Lesson:** <model update>
```

**Validation rules:**
- Predictions open >7 days without `**Outcome:**` filled = auto-expire
- `Confidence` must be one of: High, Medium, Low
- Calibration summary section should exist if >3 predictions total

### 2.5 .learnings/lessons.md

```markdown
[tag] Lesson text (YYYY-MM-DD)
```

**Valid tags:** `preference`, `correction`, `pattern`, `error`, `workflow`

**Validation rules:**
- Each entry must have a valid tag
- Each entry should have a date
- No exact duplicate entries

### 2.6 .companion-state.md

```markdown
## Session Status
status: active|idle|crashed
started_at: <ISO-8601>
last_flush: <ISO-8601>

## Active Task
<current task description>

## Current State
<state summary>

## Crash Recovery
<recovery instructions>
```

**Validation rules:**
- `status: active` with no session running = stale (needs reset to idle)
- `started_at` must be a valid timestamp
- `last_flush` must be within 4 hours of current time (if status=active)

---

## 3. Automation Requirements (Principle 11 Compliance)

**HARD RULE: Every structural maintenance operation MUST have an automated trigger.**

### Required Automated Triggers

| Operation | Trigger Mechanism | Max Interval |
|-----------|-------------------|-------------|
| Session recap | auto-checkpoint | 10 min |
| Companion state flush | auto-checkpoint | Every tool activity |
| Daily file creation | auto-checkpoint (session start) | Once per session |
| Memory maintenance (full) | auto-checkpoint | 30 min |
| Daily file archival | memory-maintenance | 30 min (checks; archives >30d files) |
| Prediction closure | memory-maintenance | 30 min (checks; closes >7d predictions) |
| Stale task detection | memory-maintenance | 30 min |
| MEMORY.md freshness check | memory-maintenance | 30 min |
| ClawVault checkpoint | memory-maintenance | 30 min (if clawvault available) |

### Compliance Test

A node is **Principle 11 compliant** if:
1. `bin/auto-checkpoint` exists and is executable
2. `bin/memory-maintenance` exists and is executable
3. `bin/session-recap` exists and is executable
4. `.tmp/last-maintenance` exists and its timestamp is within 60 min of current time (during an active session)
5. No maintenance operation requires manual invocation to function

---

## 4. Cross-Reference Integrity

These internal references MUST be consistent:

| Source | References | Constraint |
|--------|-----------|-----------|
| `MEMORY.md` Active Context | `memory/YYYY-MM-DD.md` dates | Dates in Active Context must have corresponding daily files (or be within last 7 days) |
| `active-tasks.md` artifacts | File paths | Referenced files must exist |
| `AGENTS.md` automation table | `bin/` scripts | Referenced scripts must exist and be executable |
| `.companion-state.md` active task | `active-tasks.md` | If companion-state references a task, it should exist in active-tasks |
| `HEARTBEAT.md` commands | `bin/` scripts | Referenced scripts must exist |
| `lessons.md` tags | Valid tag set | Tags must be in: preference, correction, pattern, error, workflow |

---

## 5. Compliance Check Protocol

### 5.1 Self-Check (node checks itself)

```bash
bin/memory-maintenance --force --verbose
# Exit 0 = healthy
# Exit 1 = warnings (non-critical degradation)
# Exit 2 = critical failure (structurally broken)
```

Additionally, read `.tmp/maintenance-results` for specific findings.

### 5.2 Peer Check (node A checks node B)

A peer compliance check runs these validations over the mesh:

```
PHASE 1: Structure (files exist)
  □ All Tier 1-3 required files present
  □ All Tier 4 required executables present and chmod +x
  □ memory/archive/ directory exists

PHASE 2: Format (files parse correctly)
  □ MEMORY.md has all 4 required sections
  □ active-tasks.md entries parse as valid YAML-like blocks
  □ All task_ids are unique
  □ All timestamps parse to valid datetimes
  □ lessons.md entries have valid tags
  □ companion-state.md has required fields

PHASE 3: Freshness (nothing stale beyond thresholds)
  □ MEMORY.md modified within 7 days
  □ active-tasks.md modified within 48 hours (if any running tasks)
  □ No daily files >30 days old in memory/ (should be archived)
  □ No predictions open >7 days without outcome
  □ No ERRORS.md entries pending >14 days
  □ .tmp/last-maintenance within 60 min (if session active)

PHASE 4: Automation (Principle 11)
  □ auto-checkpoint executable
  □ memory-maintenance executable
  □ session-recap executable
  □ .tmp/last-maintenance file exists (evidence of automated runs)

PHASE 5: Integrity (cross-references valid)
  □ AGENTS.md referenced scripts exist
  □ HEARTBEAT.md referenced scripts exist
  □ active-tasks.md artifact paths exist (spot check, not exhaustive)
  □ No duplicate task_ids
  □ No contradictory MEMORY.md entries
```

### 5.3 Compliance Scoring

| Score | Meaning | Action |
|-------|---------|--------|
| 100% | Fully compliant | No action needed |
| 80-99% | Minor degradation | Auto-repair if possible, log warning |
| 50-79% | Significant degradation | Flag to node operator, attempt repair |
| <50% | Structurally broken | Node cannot participate in mesh until repaired |

### 5.4 Auto-Repair Actions

Some violations can be repaired automatically by the checking node:

| Violation | Auto-Repair |
|-----------|-------------|
| Missing today's daily file | Create with header |
| Stale predictions (>7d, no outcome) | Mark as expired |
| Daily files >30d not archived | Run archival |
| Missing `memory/archive/` dir | Create directory |
| MEMORY.md >7 days stale | Flag for manual refresh (cannot auto-generate content) |
| Running tasks >48h without update | Mark as stale, flag for review |

Non-auto-repairable violations (require human or node-owner intervention):
- Missing identity files (SOUL.md, PRINCIPLES.md, AGENTS.md)
- Missing automation scripts (bin/*)
- Corrupted file formats
- Contradictory memory entries

---

## 6. Mesh Sync Boundaries

### What Syncs (Shared Truth Layer — Obsidian Vault)
- Lore documents
- Architecture decisions
- Shared knowledge base
- Project documentation
- Sync mechanism: git + last-write-wins
- Conflict model: most recent commit wins; structural conflicts flagged for human review

### What Does NOT Sync (Private Memory Layer)
- `SOUL.md` (each node has its own identity)
- `MEMORY.md` (each node has its own memories)
- `memory/*.md` (daily files are private)
- `.companion-state.md` (session-local)
- `.learnings/lessons.md` (per-node learning)
- `memory/predictions.md` (per-node calibration)
- Active tasks (per-node workload)

### What Syncs as Structure Only (Meta Protocol Layer)
- This spec (`MEMORY_SPEC.md`) — replicated to all nodes
- Compliance check results — shared so nodes can see each other's health
- Principle 11 rule — enforced uniformly
- File format contracts — enforced uniformly
- Automation requirements — enforced uniformly

---

## 7. Versioning

This spec follows semver:
- **MAJOR**: Breaking changes to required file structure or format contracts
- **MINOR**: New optional checks, additional validation rules
- **PATCH**: Clarifications, typo fixes

All nodes on the mesh MUST run the same MAJOR version.
MINOR version differences are tolerated (newer node may check things older node doesn't).

---

## Changelog

- **1.0.0** (2026-03-03): Initial spec. Codifies 5-tier file structure, 6 format contracts,
  9 automation requirements, 5-phase compliance check, auto-repair actions, mesh sync boundaries.
