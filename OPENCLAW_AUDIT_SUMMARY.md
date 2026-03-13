# OpenClaw Ecosystem — Full Cross-Repo Code Review

**Date:** 2026-03-13
**Reviewer:** Claude Opus 4.6
**Scope:** ~120 files across 2 repos + Mission Control
**Repos:** `openclaw-mesh-nodedeploy` (v2.0.0), `openclaw-node`, `mission-control`

---

## Executive Summary

The OpenClaw ecosystem is architecturally ambitious and well-designed — a multi-node mesh with autonomous task dispatch, soul-based delegation, persistent memory, and a full operational dashboard. The code quality is high across the board; the issues below are integration-layer bugs, not fundamental design problems.

**The single most impactful bug** is the `active-tasks.md` field-stripping cycle between Mission Control and the mesh bridge. It silently breaks every mesh-dispatched task within 3 seconds of MC's next sync. Fix this first.

**Total findings:** 87 across all batches
- **Critical:** 12 (will crash or produce wrong results)
- **High:** 18 (security, correctness, data loss)
- **Medium:** 32 (robustness, logic, performance)
- **Low:** 25 (style, polish, minor)

---

## Top 10 Priority Fixes

These are ranked by impact × effort. Fix these first and 80% of the operational risk disappears.

### 1. 🔴 `syncTasksToMarkdown` strips mesh fields — MC ↔ mesh-bridge fight loop

**Impact:** Every mesh-dispatched task breaks within 3 seconds
**Files:** `mission-control/src/lib/sync/tasks.ts`, `mission-control/src/lib/parsers/task-markdown.ts`, DB schema
**Batches:** 4, 7, 8

MC's scheduler dispatches a task → calls `syncTasksToMarkdown()` → serializes DB → overwrites `active-tasks.md`. The serializer doesn't know about `execution`, `metric`, `budget_minutes`, or `scope` fields (they're not in the DB schema). These fields get silently dropped. The mesh-bridge detects this (`FIELD-STRIP DETECTED`) but can't fix it.

**Fix:**
1. Add columns to drizzle schema: `execution TEXT, metric TEXT, budget_minutes INTEGER DEFAULT 30, scope TEXT`
2. Run `drizzle-kit generate` for migration
3. Add these fields to `ParsedTask` type in `task-markdown.ts`
4. Add parse cases in `parseTasksMarkdown()` and serialize cases in `serializeTasksMarkdown()`
5. Add to `syncTasksFromMarkdown()` merge logic in `tasks.ts`

### 2. 🔴 `nats-resolve.js` never deployed by `openclaw-mesh` setup.sh

**Impact:** Agent and mesh CLI crash on startup with `MODULE_NOT_FOUND`
**Files:** `openclaw-mesh-nodedeploy/setup.sh`
**Batch:** 1

`agent.js` requires `./lib/nats-resolve` and `mesh.js` requires `../lib/nats-resolve`, but `setup.sh` never copies `nats-resolve.js` to the target directories. Note: this is only broken in the standalone `openclaw-mesh-nodedeploy` repo. The `openclaw-node` installer (`install.sh`) correctly deploys to `~/openclaw/lib/`.

**Fix:** Add to setup.sh Phase 3:
```bash
mkdir -p "$OPENCLAW_DIR/lib" "$BIN_DIR/lib"
cp "$FILES_DIR/lib/nats-resolve.js" "$OPENCLAW_DIR/lib/"
cp "$FILES_DIR/lib/nats-resolve.js" "$BIN_DIR/lib/"
```

### 3. 🔴 Config template syntax mismatch — `mesh deploy` breaks configs

**Impact:** `mesh deploy --component config` produces unsubstituted `${VAR}` strings
**Files:** `openclaw-node/bin/mesh-deploy.js` (line 397), all `*.template` files
**Batches:** 1 (batch 2), 2

Templates use `${VAR}` syntax. `install.sh` correctly uses `envsubst`/`sed` for `${VAR}`. But `mesh-deploy.js` postInstall uses `{{VAR}}` regex. Two deployment paths, incompatible substitution.

**Fix:** Change `mesh-deploy.js` line 397 regex from `\\{\\{${match[1]}\\}\\}` to `\\$\\{${match[1]}\\}`.

### 4. 🟡 NATS task claim is non-atomic — concurrent agents can double-claim

**Impact:** Two agents work the same task, last writer wins, first agent's work lost
**Files:** `openclaw-node/lib/mesh-tasks.js` (`TaskStore.claim()`)
**Batches:** 2, 3

`list({ status: QUEUED })` → pick one → mutate → `put()`. Between list and put, another agent can claim the same task. NATS KV supports revision-based CAS but it's not used.

**Fix:** Use `kv.update(key, value, revision)` instead of `kv.put()` in the claim path. If revision changed, retry.

### 5. 🟡 No exec blocklist on agent-side — mesh exec is unauthenticated RCE

**Impact:** Any Tailscale peer can run arbitrary commands on any mesh node
**Files:** `openclaw-mesh-nodedeploy/files/agent.js` (line 430), `openclaw-node/bin/mesh-agent.js` (line 350)
**Batches:** 1, 2

The `DESTRUCTIVE_PATTERNS` blocklist exists in `mesh.js` (CLI-side) but not in `agent.js` (server-side). NATS has no auth. Any device on the tailnet can publish to `openclaw.{node}.exec` and bypass the blocklist.

**Fix:**
1. Duplicate the blocklist check in `agent.js` before `execSync`
2. Consider adding NATS auth tokens (even simple shared secrets) for the exec subject

### 6. 🟡 `agent.js` reads wrong config key — role from `.mesh-config` is dead code

**Impact:** Node role always falls back to platform detection, ignoring config
**Files:** `openclaw-mesh-nodedeploy/files/agent.js` (line 46)
**Batch:** 1

Regex looks for `MESH_ROLE` but config file writes `OPENCLAW_NODE_ROLE`.

**Fix:** Change regex to `/^\s*OPENCLAW_NODE_ROLE\s*=\s*(.+)/m`

### 7. 🟡 `kanban-io.js` busy-wait spin lock pegs CPU

**Impact:** 100% CPU during lock contention, blocks Node.js event loop
**Files:** `openclaw-node/lib/kanban-io.js` (lines 54-57)
**Batch:** 3

The `withMkdirLock` function uses a synchronous busy-wait loop. During contention (mesh-bridge + MC writing simultaneously), this blocks the entire process.

**Fix:** Replace busy-wait with `child_process.spawnSync('sleep', ['0.01'])` or remove locking entirely (the atomic write via `tmp + rename` already prevents corruption; the lock only prevents lost updates during read-modify-write).

### 8. 🟡 `install.sh` overwrites evolved identity files unconditionally

**Impact:** User customizations to SOUL.md, PRINCIPLES.md, AGENTS.md destroyed on every `--update`
**Files:** `openclaw-node/install.sh` (lines 308-313)
**Batches:** 3, 9

SOUL.md says "This file is yours to evolve." The installer says `cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f"`. `mesh-deploy.js` correctly handles this with `.repo` sidecar files; the installer doesn't.

**Fix:** Add diff-check before copy:
```bash
if [ -f "$WORKSPACE/$f" ] && ! diff -q "$REPO_DIR/identity/$f" "$WORKSPACE/$f" >/dev/null 2>&1; then
  cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f.repo"
  warn "$f differs from repo — saved as $f.repo for manual merge"
else
  cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f"
fi
```

### 9. 🟡 NATS `max_payload` vs file sync — files over ~750KB silently dropped

**Impact:** File sync silently fails for files between 750KB and 10MB
**Files:** `openclaw-mesh-nodedeploy/setup.sh` (line 198)
**Batch:** 1

NATS default `max_payload` is 1MB. Base64 encoding adds 33% overhead. A 750KB file becomes ~1MB on the wire and gets dropped. The agent logs nothing.

**Fix:** Add `--max_payload 16777216` to the NATS ExecStart, or reduce `MAX_SYNC_SIZE` from 10MB to 700KB.

### 10. 🟡 Two independent parsers for `active-tasks.md` — will drift

**Impact:** Subtle field corruption as either side adds fields the other doesn't know
**Files:** `mission-control/src/lib/parsers/task-markdown.ts`, `openclaw-node/lib/kanban-io.js`
**Batches:** 3, 7

MC's parser handles ~30 fields (trigger, cron, capacity, scheduling). The mesh-bridge parser handles ~15 fields (execution, metric, budget, scope). Neither knows about the other's fields. MC writes strip mesh fields; mesh-bridge writes strip MC fields.

**Fix (long-term):** Single parser library, shared between both. **Fix (short-term):** Make `kanban-io.js` only do in-place field updates (which it already does via `updateTaskInPlace`), never full-file serialization. Only MC does full serialization.

---

## All Findings by Repo

### Repo 1: `openclaw-mesh-nodedeploy` (v2.0.0)

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 1 | 🔴 CRITICAL | `lib/nats-resolve.js` never deployed — agent/CLI crash on require | `setup.sh` |
| 2 | 🔴 CRITICAL | NATS max_payload (1MB default) vs base64 file sync (~750KB real limit) | `setup.sh` |
| 3 | 🔴 CRITICAL | `npx openclaw-mesh` 404s — package name is `openclaw-mesh-nodedeploy` | `package.json`, `README.md` |
| 4 | 🟡 HIGH | agent.js reads wrong config key (`MESH_ROLE` vs `OPENCLAW_NODE_ROLE`) | `agent.js:46` |
| 5 | 🟡 HIGH | agent.js ignores `OPENCLAW_NODE_ID` env var | `agent.js:34` |
| 6 | 🟡 HIGH | No server-side exec blocklist — destructive command filter is client-only | `agent.js` |
| 7 | 🟡 HIGH | macOS sudoers wildcard allows arbitrary LaunchDaemon loading | `setup.sh:357` |
| 8 | 🟡 HIGH | `mesh ls` and `mesh put` have path traversal — no validation on subdir | `mesh.js` |
| 9 | 🟡 HIGH | Exec timeout mismatch: agent=120s, CLI=35s, docs=30s | Multiple |
| 10 | 🟠 MEDIUM | Remote health/repair uses relative paths (`bash openclaw/bin/...`) | `mesh.js:412,466` |
| 11 | 🟠 MEDIUM | mesh-repair.sh parses health output by grepping Unicode symbols | `mesh-repair.sh` |
| 12 | 🟠 MEDIUM | Redundant NATS connectivity checks on macOS | `mesh-health.sh` |
| 13 | 🟠 MEDIUM | `loginctl enable-linger` unnecessary for system-level systemd units | `setup.sh` |
| 14 | 🟠 MEDIUM | Node.js install uses deprecated nodesource script | `setup.sh:171` |
| 15 | ⚪ LOW | `_gitignore` needs to be `.gitignore` in actual repo | `_gitignore` |
| 16 | ⚪ LOW | Health check greps agent.js file on disk, not running process | `mesh-health.sh` |
| 17 | ⚪ LOW | `gatherHealth()` hardcodes services from broader OpenClaw ecosystem | `agent.js` |
| 18 | ⚪ LOW | NATS server has no JetStream enabled | `setup.sh` |

### Repo 2: `openclaw-node` — Mesh Daemons & Deploy

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 19 | 🔴 CRITICAL | Config template `${VAR}` syntax vs mesh-deploy `{{VAR}}` regex | `mesh-deploy.js:397`, templates |
| 20 | 🔴 CRITICAL | mesh-bridge re-reads kanban on failure — may block wrong task | `mesh-bridge.js:499` |
| 21 | 🔴 CRITICAL | `getSessionInfo` reads from hardcoded temp dir, not task's worktree | `mesh-agent.js:513` |
| 22 | 🔴 CRITICAL | `transcript-sources.json` hardcoded macOS path encoding breaks Ubuntu | Template |
| 23 | 🟡 HIGH | Task claim race condition — `store.claim()` + verify is non-atomic | `mesh-tasks.js`, `mesh-task-daemon.js` |
| 24 | 🟡 HIGH | `mesh-deploy.js` rollback does `git reset --hard` on potentially dirty worktree | `mesh-deploy.js:815` |
| 25 | 🟡 HIGH | `installComponentFiles` strips first path segment unconditionally | `mesh-deploy.js:663` |
| 26 | 🟡 HIGH | `mesh-agent.js` runs Claude with `--permission-mode bypassPermissions` | `mesh-agent.js:350` |
| 27 | 🟡 HIGH | No NATS auth — any Tailscale peer can publish task submissions | All daemons |
| 28 | 🟡 HIGH | fleet-deploy accepts unauthenticated `trigger.branch` for `git merge` | `mesh-deploy-listener.js:107` |
| 29 | 🟠 MEDIUM | `lane-watchdog.js` `fs.watchFile` returns void — `watcher` variable is undefined | `lane-watchdog.js:171` |
| 30 | 🟠 MEDIUM | mesh-bridge dispatch loop fixed 10s sleep regardless of error severity | `mesh-bridge.js:517` |
| 31 | 🟠 MEDIUM | health-publisher detects role from daemon presence, not config | `mesh-health-publisher.js:172` |
| 32 | 🟠 MEDIUM | `commitAndMergeWorktree` merges in WORKSPACE without locking | `mesh-agent.js:287` |
| 33 | 🟠 MEDIUM | `exec('sleep 1')` spawns shell process for a 1s delay | `mesh-deploy.js:714` |
| 34 | 🟠 MEDIUM | Discord rate limit parsed but not retried | `mesh-tool-discord.js:76` |
| 35 | 🟠 MEDIUM | `ROLE_COMPONENTS` duplicated in 3 files with no shared source | Multiple |
| 36 | ⚪ LOW | Dangling JSDoc comment in mesh-agent.js (orphaned from refactor) | `mesh-agent.js:248` |
| 37 | ⚪ LOW | `mesh.js` exists in both repos — will drift | Both repos |
| 38 | ⚪ LOW | `manifest.yaml` references `kimi` model — untested API | `manifest.yaml` |

### Repo 2: `openclaw-node` — Shared Libraries & Installer

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 39 | 🔴 CRITICAL | `kanban-io.js` busy-wait spin lock pegs CPU at 100% | `kanban-io.js:54` |
| 40 | 🔴 CRITICAL | `kanban-io.js` parser scans past `## Live Tasks` to EOF (includes completed) | `kanban-io.js` |
| 41 | 🔴 CRITICAL | `mesh-tasks.js` `claim()` is read-then-write without atomicity | `mesh-tasks.js` |
| 42 | 🟡 HIGH | `install.sh` sources env file — command injection risk | `install.sh:363` |
| 43 | 🟡 HIGH | `install.sh` overwrites identity files unconditionally | `install.sh:308` |
| 44 | 🟡 HIGH | `agent-activity.js` fallback returns most recent dir regardless of workspace match | `agent-activity.js:62` |
| 45 | 🟡 HIGH | `agent-activity.js` cost estimation hardcodes Sonnet pricing | `agent-activity.js:298` |
| 46 | 🟠 MEDIUM | `kanban-io.js` `updateTaskInPlace` — `updatedAtIdx > 0` should be `>= 0` | `kanban-io.js:226` (3 occurrences) |
| 47 | 🟠 MEDIUM | `kanban-io.js` parser doesn't handle multi-line descriptions | `kanban-io.js:162` |
| 48 | 🟠 MEDIUM | `mesh-registry.js` heartbeat doesn't update `registered_at` | `mesh-registry.js:107` |
| 49 | 🟠 MEDIUM | `install.sh` uses deprecated nodesource setup script | `install.sh:101` |
| 50 | 🟠 MEDIUM | `install.sh` mesh step calls `npx openclaw-mesh` (wrong package name) | `install.sh:802` |
| 51 | 🟠 MEDIUM | HEARTBEAT.md has mesh snippet duplicated (main body + appended) | `HEARTBEAT.md` |
| 52 | 🟠 MEDIUM | AGENTS.md and CLAUDE.md have significant rule duplication | Identity files |
| 53 | ⚪ LOW | MEMORY_SPEC.md compliance check protocol has no implementing code | `MEMORY_SPEC.md` |
| 54 | ⚪ LOW | DELEGATION.md trust tiers reference model escalation but mesh-agent hardcodes sonnet | Multiple |
| 55 | ⚪ LOW | `install.sh` banner has misaligned box (no closing `║`) | `install.sh:81` |

### Mission Control — DB & Scripts

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 56 | 🔴 CRITICAL | `soul_schema_update.sql` crashes on re-run (no IF NOT EXISTS for ALTER TABLE) | `soul_schema_update.sql` |
| 57 | 🔴 CRITICAL | Tasks schema missing mesh columns — field-stripping root cause | DB schema |
| 58 | 🔴 CRITICAL | Import scripts reference columns (`type`, `project`, `scheduled_date`) not in schema | `import-pipeline-v2.js` |
| 59 | 🟡 HIGH | `gen-chronology.js` hardcoded absolute paths (`/Users/moltymac/...`) | `gen-chronology.js` |
| 60 | 🟡 HIGH | Import scripts reference `dependencies` table not in drizzle schema | Both import scripts |
| 61 | 🟠 MEDIUM | Import markdown parser fragile on multi-byte emoji variants | `import-pipeline-v2.js` |
| 62 | 🟠 MEDIUM | Import uses DELETE+INSERT instead of UPSERT — resets timestamps | Both import scripts |
| 63 | 🟠 MEDIUM | "enriched" detection heuristic (double newline) can over-count | `enrich-descriptions.js` |
| 64 | ⚪ LOW | Drizzle journal version mismatch (journal=7, snapshot=6) | `_journal.json` |
| 65 | ⚪ LOW | No indexes on `tasks` for common query patterns | Schema |

### Mission Control — Frontend

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 66 | 🟡 HIGH | Memory page debounce leaks timers (cleanup return value discarded) | `memory/page.tsx` |
| 67 | 🟡 HIGH | Live Chat page is mock-only — no real agent integration | `live/page.tsx` |
| 68 | 🟠 MEDIUM | Burndown page `setSelectedProject` in render body (not useEffect) | `burndown/page.tsx` |
| 69 | 🟠 MEDIUM | Graph page `fgRef` typed as `any` | `graph/page.tsx` |
| 70 | 🟠 MEDIUM | Full graph fetched on mount with no pagination | `graph/page.tsx` |
| 71 | 🟠 MEDIUM | Obsidian 2-hop local graph computation is O(links²) | `obsidian/page.tsx` |
| 72 | ⚪ LOW | Dark mode only, no light mode support | `globals.css` |
| 73 | ⚪ LOW | `daedalus-glow` keyframe defined but never used in uploaded files | `globals.css` |
| 74 | ⚪ LOW | No per-page `<title>` metadata | All pages |

### Mission Control — Components

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 75 | 🟠 MEDIUM | XSS via `dangerouslySetInnerHTML` on search excerpts | `search-results.tsx` |
| 76 | 🟠 MEDIUM | `canvas.parentElement!` non-null assertion | `audio-spectrum.tsx` |
| 77 | 🟠 MEDIUM | Obsidian graph glow effect broken (hex color string manipulation) | `obsidian-graph.tsx` |
| 78 | ⚪ LOW | `doc-reader.tsx` and `obsidian-reader.tsx` duplicate markdown config | Both readers |
| 79 | ⚪ LOW | Sidebar sync button has no error feedback to user | `sidebar.tsx` |
| 80 | ⚪ LOW | File tree doesn't auto-expand to selected path on external navigation | `file-tree.tsx` |

### Mission Control — Server Core

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 81 | 🔴 CRITICAL | `syncTasksToMarkdown` confirmed as field-stripping vector | `sync/tasks.ts` |
| 82 | 🔴 CRITICAL | `generateNextId` scans all tasks in JS — race condition on concurrent ticks | `scheduler.ts` |
| 83 | 🟡 HIGH | Cron trigger 20-min window + 30s tick = 40 duplicate activity log entries | `scheduler.ts` |
| 84 | 🟡 HIGH | Two independent parsers for same file format | `task-markdown.ts` vs `kanban-io.js` |
| 85 | 🟡 HIGH | FTS5 query injection — operators pass through unsanitized | `retrieval.ts` |
| 86 | 🟡 HIGH | `gateway-notify.ts` uses `WebSocket` global — may not exist in Node.js | `gateway-notify.ts` |
| 87 | 🟠 MEDIUM | `transcript.ts` hardcoded macOS Claude path encoding | `transcript.ts` |
| 88 | 🟠 MEDIUM | Scheduler tick via SWR POST has no error boundary | `hooks.ts` |
| 89 | 🟠 MEDIUM | `extract.ts` `checkAndSupersede` does N×100 comparisons per batch | `extract.ts` |
| 90 | 🟠 MEDIUM | `categories.ts` summary archive grows unbounded | `categories.ts` |
| 91 | ⚪ LOW | `config.ts` DB_PATH uses `process.cwd()` while other paths use HOME | `config.ts` |

### Soul System

| # | Severity | Finding | File(s) |
|---|----------|---------|---------|
| 92 | 🟡 HIGH | Daedalus `capabilities.json` has no `restrictedActions` | `daedalus/capabilities.json` |
| 93 | 🟡 HIGH | Two versions of Daedalus PRINCIPLES.md (10 vs 11 principles) | Identity files |
| 94 | 🟠 MEDIUM | `registry.json` capabilities duplicated from individual files — will drift | `registry.json` |
| 95 | 🟠 MEDIUM | All specialist souls have `handoffs: "read"` but need to write handoffs | All `capabilities.json` |
| 96 | 🟠 MEDIUM | identity-architect + lore-writer have Write/Edit without genome-write restriction | `capabilities.json` |
| 97 | ⚪ LOW | Only blockchain-auditor has genes (2); all others empty | `genes.json` files |
| 98 | ⚪ LOW | All `events.jsonl` files appear empty — evolution system not generating data | `events.jsonl` |

---

## Systemic Patterns

### Pattern 1: Multiple Sources of Truth

The same data exists in multiple places with no synchronization mechanism:

- **Task state:** `active-tasks.md` ↔ SQLite DB ↔ NATS KV (three stores, three parsers)
- **Node role:** env var ↔ `.mesh-config` ↔ `openclaw.env` ↔ platform detection (four sources)
- **Soul capabilities:** `capabilities.json` per soul ↔ `registry.json` global (two copies)
- **ROLE_COMPONENTS:** `mesh-health-publisher.js` ↔ `mesh-deploy-listener.js` ↔ `mesh-deploy.js` (three copies)
- **Config templates:** `${VAR}` syntax (installer) ↔ `{{VAR}}` syntax (mesh-deploy) (two incompatible substitution engines)

**Recommendation:** Establish clear authority hierarchy. For task state: DB is authoritative, markdown is a view, NATS KV is the mesh-local cache. For config: one template syntax, one substitution engine.

### Pattern 2: Security Boundaries Are Prompt-Level Only

The DELEGATION.md defines excellent security rules (no git push, no genome writes, no external APIs without contract). But enforcement is:
- **Prompt-level:** LLM is told "don't do X" in prose
- **Not machine-enforced:** `capabilities.json` `restrictedActions` exists but it's unclear if `soul-prompt` actually enforces it
- **Bypassed by design:** `mesh-agent.js` runs with `--permission-mode bypassPermissions`
- **No NATS auth:** Any tailnet device can submit tasks or trigger deploys

**Recommendation:** For V1 solo-dev use, this is acceptable. Before any multi-user or production scenario, add NATS auth tokens and move exec restrictions to the agent-side.

### Pattern 3: Platform-Specific Paths Hardcoded

Claude Code encodes workspace paths differently on macOS vs Linux. Multiple files hardcode the macOS encoding:
- `transcript-sources.json.template` → `-Users-${USER}--openclaw-workspace`
- `transcript.ts` → same encoding
- `agent-activity.js` → computed path with macOS assumption + fallback

**Recommendation:** Generate the encoded path at install time based on platform, or use the `getProjectDir` fallback pattern from `agent-activity.js` everywhere.

### Pattern 4: Evolution System Designed but Dormant

The soul evolution system (genes, capsules, events, trust registry, circuit breaker) is architecturally complete but operationally empty:
- 6 souls, only 1 has genes (2 genes)
- All `capsules.json` empty
- All `events.jsonl` appear empty
- Trust registry never updated (no delegation has occurred through the formal system)

This isn't a bug — the system is scaffolded for when autonomous delegation ramps up. Just noting it's 100% scaffolding, 0% populated.

---

## Architecture Notes (Not Bugs — Design Observations)

1. **The `active-tasks.md` file is load-bearing infrastructure.** It's read by: MC (every 3s), mesh-bridge (every 10s), memory-daemon, heartbeat, and Daedalus (at session start). Five concurrent readers, three writers. The mkdir-lock in `kanban-io.js` is local-only. This file is the single point of contention in the entire system. The MEMORY_SPEC.md notes this: "Phase 3: replace with shared-state layer (cr-sqlite / JetStream KV)." That migration should be prioritized.

2. **The mesh-bridge is the critical integration point.** It bridges kanban (file) ↔ mesh (NATS), with reconciliation on restart, heartbeat staleness detection, and exponential backoff. The code quality here is high — it handles edge cases that most systems ignore. The remaining issues are field-stripping (fix #1) and the busy-wait lock (fix #7).

3. **Mission Control is a full operational dashboard built in ~3 weeks.** Kanban, memory browser, knowledge graph, burndown charts, soul evolution, TTS pipeline, Obsidian view — this is an impressive amount of functionality. The main gap is the DB schema not keeping pace with the markdown format (missing columns from import scripts, missing mesh columns).

4. **The boot compiler / manifest system is well-designed.** Profile-aware compilation, model-specific overrides, lazy-loading — this is a smart approach to managing context window costs across models. No bugs found in the manifest; the `kimi` model override is speculative but harmless.

---

## Suggested Fix Order

**Week 1 (critical path):**
1. Fix #1: Add mesh columns to DB schema + parser/serializer
2. Fix #2: Deploy `nats-resolve.js` in `openclaw-mesh` setup.sh
3. Fix #3: Align config template substitution syntax
4. Fix #6: Fix agent.js config key regex
5. Fix #5: Add exec blocklist to agent.js server-side

**Week 2 (reliability):**
6. Fix #7: Replace busy-wait with sleep or remove lock
7. Fix #8: Guard identity file overwrites in install.sh
8. Fix #9: Set NATS max_payload or reduce sync size limit
9. Fix #4: Add CAS to task claim
10. Fix #10: Converge on single task parser

**Week 3+ (hardening):**
- Add NATS auth tokens for exec/deploy subjects
- Fix all `handoffs: "read"` → `"readwrite"` for specialist souls
- Add `restrictedActions` to Daedalus capabilities.json
- Fix memory page debounce timer leak
- Sanitize FTS5 search input
- Fix obsidian-graph hex color manipulation
- Add DB indexes for common query patterns

---

*End of audit. 120 files reviewed, 98 findings across 2 repos + Mission Control.*
