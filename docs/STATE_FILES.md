# State Files — Memory Infrastructure

Reference inventory of every file the memory infrastructure writes at runtime.
Each entry lists the owner process, format, lifetime, consumers, and location.

> Created by memory-plan Step 0.7. No functional effect — prevents future
> "what is this file?" archaeology.

---

## Workspace runtime files (`~/.openclaw/workspace/`)

These files live in the operator's workspace directory (`$OPENCLAW_WORKSPACE`,
default `~/.openclaw/workspace/`). They are **not** committed to any git repo.

### `.daemon-state-${NODE_ID}.md`

- **Owner:** `memory-daemon.mjs` → `runPhase1StatusSync()`
- **Format:** Markdown with YAML-like key-value pairs (`status`, `started_at`, `last_flush`)
- **Lifetime:** Overwritten every daemon tick (~30s) while a session is ACTIVE or IDLE. Persists across sessions as crash-recovery state.
- **Consumers:**
  - `session-start.sh` — reads at session start, injects into Claude context
  - `daily-log-writer.mjs` — reads to detect active session
  - `mission-control/src/app/api/tasks/route.ts` — reads for `__LIVE_SESSION__` card synthesis
- **NODE_ID source:** `$OPENCLAW_NODE_ID` env var, fallback `os.hostname()`
- **History:** Renamed from `.companion-state.md` in Step 0.2 to avoid collision with companion-bridge.

### `MEMORY.md`

- **Owner:** `pre-compression-flush.mjs` → `runFlush()` (writes); `memory-budget.mjs` → `MemoryBudget` (manages budget, snapshots)
- **Format:** Markdown. Extracted facts as bullet points, optionally with `[user]`/`[assistant]` speaker tags and `<!-- supersedes: <hash> -->` comments.
- **Lifetime:** Persistent. Content accumulates across sessions; trimmed under character budget pressure (~2200 chars). Frozen (snapshotted) at session start, reloaded after flushes.
- **Consumers:**
  - `memory-budget.mjs` — freezes snapshot for prompt injection at session start
  - `memory-daemon.mjs` — triggers flush writes on ACTIVE→IDLE and IDLE→ENDED transitions
  - Claude session hooks — read at session start via `session-start.sh` (indirectly, via the bootstrap chain)

### `memory/YYYY-MM-DD.md`

- **Owner:** `daily-log-writer.mjs` (hourly appends); `memory-daemon.mjs` → `runPhase0Bootstrap()` (creates empty file for today)
- **Format:** Markdown. Timestamped hourly blocks with session recap excerpts, active task state, and git diff summaries.
- **Lifetime:** Persistent. One file per day, append-only within the day.
- **Consumers:**
  - Bootstrap chain reads today's file
  - `session-start.sh` — not directly, but daily logs feed the broader memory context

### `memory/last-session-recap.md`

- **Owner:** `session-recap` (Node.js script)
- **Format:** Markdown. Rolling buffer of the last 2 session digests. Each digest includes session ID prefix, timestamp, and extracted conversation summary (~15 lines max per digest).
- **Lifetime:** Overwritten on each recap run. Keeps last 2 digests.
- **Consumers:**
  - `session-start.sh` — reads first 15 lines at session start
  - `daily-log-writer.mjs` — reads for hourly log entry content

### `memory/active-tasks.md`

- **Owner:** External (kanban system, operator). Not written by the memory daemon itself.
- **Format:** Markdown with YAML-style task blocks (`title`, `status`, etc.).
- **Lifetime:** Persistent. Updated by the task management system.
- **Consumers:**
  - `memory-daemon.mjs` → `runPhase1StatusSync()` — reads to build daemon state
  - `session-start.sh` — reads first 20 lines at session start
  - `daily-log-writer.mjs` — reads for hourly log entry

---

## Daemon internal state (`~/.openclaw/workspace/.tmp/`)

Ephemeral operational state for the daemon. Can be safely deleted; the daemon
recreates what it needs on next tick.

### `.tmp/memory-daemon.log`

- **Owner:** `memory-daemon.mjs` → `log()` function
- **Format:** Plain text. Timestamped log lines, one per event.
- **Lifetime:** Append-only. Grows indefinitely (no rotation). Recreated if missing.
- **Consumers:** Operator debugging only. No in-repo code reads this file.

### `.tmp/daemon-throttle.json`

- **Owner:** `memory-daemon.mjs` → Phase 2 throttle state
- **Format:** JSON. Tracks last-run timestamps for throttled jobs (recap, maintenance, obsidian-sync, trust-health, session-import, clawvault, hyperagent).
- **Lifetime:** Overwritten on each Phase 2 tick. Persists across daemon restarts for throttle continuity.
- **Consumers:** `memory-daemon.mjs` — reads to determine which Phase 2 jobs are due.

### `.tmp/daemon-state.json`

- **Owner:** `memory-daemon.mjs` → `saveDaemonState()`
- **Format:** JSON. Contains `state` (session state machine), `sessionId`, `lastActivityTime`, `pid`, `updatedAt`.
- **Lifetime:** Overwritten on each main tick and on graceful shutdown. Used for crash recovery on restart.
- **Consumers:** `memory-daemon.mjs` → `loadDaemonState()` at startup.

### `.tmp/daily-log-state.json`

- **Owner:** `daily-log-writer.mjs` → `saveState()`
- **Format:** JSON. Tracks last recap hash, last task hash, last write hour for dedup.
- **Lifetime:** Overwritten on each daily-log write. Prevents duplicate hourly entries.
- **Consumers:** `daily-log-writer.mjs` → `loadState()`.

### `.tmp/active-sessions/claude-code`

- **Owner:** `auto-checkpoint` (bash hook)
- **Format:** Plain text. Contains the basename of the most recent JSONL session file (no extension).
- **Lifetime:** Overwritten on every `PostToolUse` hook invocation (Edit/Write/Bash). Signals which session is current.
- **Consumers:** `memory-daemon.mjs` — activity detection reads this directory to identify active frontends.

### `.tmp/mc-kanban-notify.txt`

- **Owner:** Mission Control API (external writer)
- **Format:** Plain text. Notification message from kanban system.
- **Lifetime:** Ephemeral. Created by MC API, read and deleted by `auto-checkpoint` on next hook invocation.
- **Consumers:** `auto-checkpoint` — reads, echoes to stdout (visible in Claude context), then deletes.

### `.tmp/daedalus-dispatch.json`

- **Owner:** Scheduler (external writer)
- **Format:** JSON. Contains `taskId` and `title` for auto-dispatched tasks.
- **Lifetime:** Ephemeral. Created by scheduler, read and deleted by `auto-checkpoint` on next hook invocation.
- **Consumers:** `auto-checkpoint` — reads, echoes task info to stdout, then deletes.

---

## SQLite databases (`~/.openclaw/`)

### `state.db`

- **Owner:** `session-store.mjs` (sessions + messages tables); `hyperagent-store.mjs` (ha_* tables). Shared database, WAL mode.
- **Format:** SQLite with WAL. Tables:
  - `sessions` — session metadata (id, source, start_time, end_time, summary, message_count)
  - `messages` — per-message content with turn index
  - `messages_fts` — FTS5 virtual table for full-text search over messages
  - `ha_telemetry` — per-task performance data
  - `ha_strategies` — reusable approaches indexed by domain
  - `ha_reflections` — periodic structured analysis
  - `ha_proposals` — self-modification proposals
  - `ha_telemetry_proposals` — junction table
- **Lifetime:** Persistent. Grows with session history. WAL mode enables concurrent reads.
- **Consumers:**
  - `memory-daemon.mjs` — imports sessions on IDLE→ENDED transition
  - `session-search.mjs` — CLI search tool
  - `hyperagent-store.mjs` — HyperAgent protocol reads/writes

### `.knowledge.db`

- **Owner:** `lib/mcp-knowledge/core.mjs` (MCP knowledge server)
- **Format:** SQLite with WAL + sqlite-vec extension. Stores document chunks with 384-dim embeddings (Xenova/all-MiniLM-L6-v2 via `@huggingface/transformers`).
- **Lifetime:** Persistent. Rebuilt on reindex. Stores embedded workspace documents for semantic search.
- **Consumers:** MCP knowledge server (registered in `.mcp.json`). Accessed via MCP tool calls from Claude sessions.

---

## Configuration files (`~/.openclaw/config/`)

These are read-only from the daemon's perspective (written by the operator or
install scripts).

### `config/daemon.json`

- **Owner:** Operator / install script
- **Format:** JSON. Daemon configuration: intervals, timezone, context window tokens, feature flags.
- **Lifetime:** Persistent. Read at daemon startup.
- **Consumers:** `memory-daemon.mjs` → `loadConfig()`.

### `config/transcript-sources.json`

- **Owner:** `openclaw-register-source` script / operator
- **Format:** JSON. Registry of transcript source directories with `name`, `path`, `format`, `enabled` fields.
- **Lifetime:** Persistent. Updated when new frontends are registered.
- **Consumers:**
  - `memory-daemon.mjs` → `loadTranscriptSources()` — scans for active JSONL sessions
  - `session-recap` → `loadTranscriptDirs()` — discovers JSONL files for digest generation
  - `session-search.mjs` — discovers sources for search

---

## Files removed in Block 0

The following files were written by prior versions but had no in-repo consumer.
They were deleted in Step 0.6.

| File | Former owner | Removed in | Notes |
|------|-------------|------------|-------|
| `~/.openclaw/workspace/.pre-compact-state.md` | `pre-compact.sh` | Step 0.6 | Hook retained as no-op stub for Block 4 rewiring |
| `~/.openclaw/workspace/.tmp/session-fingerprint.json` | `session-recap` | Step 0.6 | ~80 lines of dead code removed (extractFingerprint, writeFingerprint) |
| `~/.openclaw/workspace/.tmp/frontend-activity` | `auto-checkpoint` | Step 0.6 | Touch-based activity signal; daemon uses JSONL mtime instead |
| `confidence` field on `extractFacts` return | `pre-compression-flush.mjs` | Step 0.6 | Computed but never consumed; return shape is now `{ fact, category, speaker }` |

---

## Notes

- **NODE_ID** is derived consistently as `process.env.OPENCLAW_NODE_ID || os.hostname()` (JS/TS) and `${OPENCLAW_NODE_ID:-$(hostname)}` (shell).
- **Workspace files are not git-tracked.** They exist only at runtime in the operator's home directory.
- **`docs/ARCHITECTURE.md`** contains some stale references to removed files (`frontend-activity`, `session-fingerprint.json`). Cleanup is deferred to a later block.
