# COMPONENT_REGISTRY — integrations plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe (ps / curl / sql / log / launchctl) verified, and date it. Updated at every
step close (PROTOCOL §3 Phase 9) and re-verified wholesale at every macro re-orient (§5.2).
Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe before acting on them.

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row — flat tables render
empty (PROTOCOL §10).

Probe context for the 2026-09-08 rows: a cloud session on the repo tree at commit `29847ac`
(branch `claude/hermes-essential-skills-ch3s0o`), Node v22.22.2. No `~/.openclaw` runtime exists
in that session, so runtime rows for launchd units, VoiceStudio, Orca and God's Eye View are
recorded as UNKNOWN until the operator probes the design box; repo-tree rows are verified.

## Family 1: Web reach

### workspace-bin/web-fetch.mjs

| | |
|---|---|
| **Status** | LIVE — innerText only |
| **Verified** | 2026-09-08 — `grep -o "'--[a-z]*'" workspace-bin/web-fetch.mjs` → `--html --screenshot --selector --wait`; no `--markdown`; `assertPublicUrl` resolves once and does not pin the address |

### defuddle dependency

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — `grep -c defuddle package.json` → 0; the in-page mechanism was proven in a scratch test (Playwright 1.51.1, `defuddle/full`, title/author/published/wordCount extracted, nav and footer stripped) |

## Family 2: Harness rules and skills

### config/harness-rules.json

| | |
|---|---|
| **Status** | LIVE — 13 rules |
| **Verified** | 2026-09-08 — ids: build-before-done, no-silent-failure, no-assume-running, session-boot-context, git-conventional-commits, no-hardcoded-secrets, playwright-fallback, scope-enforcement, block-sudo-in-scripts, block-rm-rf, hyperagent-task-close, hyperagent-task-start, hyperagent-reflection-ready; no `lazy-senior-ladder`; `lib/mesh-harness.js:391` dispatches `post_validate` |

### skills/ tree

| | |
|---|---|
| **Status** | LIVE — 108 skills |
| **Verified** | 2026-09-08 — `ls skills | wc -l` → 108; absent: ponytail-review, archify, codebase-memory, gods-eye-view, and the six agent-skills ports; `skills/_quarantine/` holds memorylayer and moltbook-registry |

## Family 3: MCP servers

### .mcp.json

| | |
|---|---|
| **Status** | LIVE — one server |
| **Verified** | 2026-09-08 — `mcpServers` keys → `['knowledge']` (node `lib/mcp-knowledge/server.mjs`); no `codebase-memory`; `.gitignore` has no `.codebase-memory/` line |

### codebase-memory-mcp binary

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — not present under the repo or the session; upstream v0.10.8 release read in source (stdio only, no runtime network, C11) |

## Family 4: Mission Control TTS

### mission-control/src/lib/tts

| | |
|---|---|
| **Status** | LIVE — cloud only |
| **Verified** | 2026-09-08 — `ls mission-control/src/lib/tts/` → edge.ts google.ts index.ts types.ts; `synthesizeWithFallback` default preferred `"google"`; route whitelists `edge` and `google` only |

### VoiceStudio (external, :3900)

| | |
|---|---|
| **Status** | UNKNOWN |
| **Verified** | 2026-09-08 — not probeable from the cloud session; operator to run `curl -s 127.0.0.1:3900/health` on the design box before step 3.1 |

## Family 5: Stack launcher

### bin/openclaw-stack.mjs

| | |
|---|---|
| **Status** | LIVE — five ports |
| **Verified** | 2026-09-08 — PORTS map lines 33–37: nats 4222, mission-control 3000, workplan-viewer 7892, memory-daemon 7893, companion-bridge 8787; only companion-bridge has an external-app row; no voicestudio or gods-eye-view rows |

## Family 6: God's Eye View (external, :4173)

### gods-eye-view checkout and Node 24 runtime

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — no clone under `~/Documents/openclaw infrastructure/` is known; upstream `package.json` engines `>=24.14.0 <25 \|\| >=26 <27`; session Node is v22.22.2 (node baseline); default server `localhost:4173`; keyless Esri/OSM fallback confirmed in `src/mapStackController.js` |

### docs/runbooks/

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — `ls docs/runbooks` → no such directory |

## Family 7: Mesh agent state

### bin/mesh-agent.js worktree and heartbeat

| | |
|---|---|
| **Status** | LIVE — no agent-state signal |
| **Verified** | 2026-09-08 — `createWorktree` at `~/.openclaw/worktrees/<taskId>` on `mesh/<taskId>` (lines 489–540); cleanup deletes the branch unconditionally; no hook listener, no `activity_state` in the heartbeat; `lib/agent-status.js` absent |

## Family 8: Local LLM client

### lib/llm-client.mjs

| | |
|---|---|
| **Status** | LIVE — no tool calling |
| **Verified** | 2026-09-08 — `grep -c tools lib/llm-client.mjs` → 0; native `/api/chat` with `think:false`, no `tools` or `tool_calls` handling |
