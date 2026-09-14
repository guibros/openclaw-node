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
| **Status** | LIVE — `--markdown` readability path |
| **Verified** | 2026-09-08 (step 1.1) — `node workspace-bin/web-fetch.mjs https://pypi.org/project/requests/ --markdown` exit 0, header `# requests` + `words: 378 (defuddle 194ms)`, nav labels absent that the raw fetch carries; bundle delivered by `addInitScript` before navigation; `chromiumBypassList()` strips CIDR entries from NO_PROXY; `WEB_FETCH_CHROMIUM` overrides the browser path. Step 1.2: `resolvePublicUrl` returns the vetted addresses and the document host is pinned with `--host-resolver-rules`; private literals refused with exit 2; the pin proven to bind (MAP to 192.0.2.1 → ERR_CONNECTION_REFUSED, unpinned → 200). Sub-requests remain check-time only |

### defuddle dependency

| | |
|---|---|
| **Status** | LIVE — ^0.19.3 |
| **Verified** | 2026-09-08 (step 1.1) — in package.json + package-lock.json; resolved at run time through the `defuddle/full` export; exercised in-page against a served fixture and against a live public page |

## Family 2: Harness rules and skills

### config/harness-rules.json

| | |
|---|---|
| **Status** | LIVE — 14 rules |
| **Verified** | 2026-09-08 — ids: build-before-done, no-silent-failure, no-assume-running, session-boot-context, git-conventional-commits, no-hardcoded-secrets, playwright-fallback, scope-enforcement, block-sudo-in-scripts, block-rm-rf, hyperagent-task-close, hyperagent-task-start, hyperagent-reflection-ready. 2026-09-08 (step 1.3): `lazy-senior-ladder` added (tier 2, local+mesh, `post_validate` → `bash ./bin/check-added-deps.sh`); injection and the advisory both proven against a real worktree. Mesh workers read the deployed `~/.openclaw/harness-rules.json`, so the rule is inert there until `harness-sync` runs. `git-conventional-commits` is blocked by exec-safety on every commit (OUT_OF_SCOPE) |

### skills/ tree

| | |
|---|---|
| **Status** | LIVE — 116 skills |
| **Verified** | 2026-09-08 — `ls skills | wc -l` → 108; `skills/_quarantine/` holds memorylayer and moltbook-registry. 2026-09-08 (step 1.4): `ponytail-review` added (audit 100/100 grade A, scanner clean, routing 100.0% with no new collision) and wired as `multi-review`'s fourth perspective. 2026-09-08 (step 1.5): the six agent-skills ports added — debugging-and-error-recovery, incremental-implementation, interview-me, doubt-driven-development, deprecation-and-migration, code-review-and-quality (audit five A one B, scanner clean, routing 100.0% with zero regressed). 2026-09-08 (step 2.3): `archify` installed, 2.3 MB, audit 100/100 A, scanner clean, both shipped examples validate 9/9 showcase; no update checker and no outbound host in the tree. Still absent: codebase-memory, gods-eye-view. 2026-09-08 (step 1.6): `summarize` documents a local yt-dlp subtitle path (audit 100/100 A); the end-to-end YouTube probe is deferred to the operator (D9) because this session's egress refuses YouTube |

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
| **Status** | LIVE — local preferred, cloud behind it |
| **Verified** | 2026-09-14 (step 3.1) — `local.ts` added; registry order `["local","google","edge"]` and `DEFAULT_TTS_PROVIDER = "local"`; the route now admits any registered provider (`listTtsProviders().includes`) and falls unknown names to the default. Probed against a live `next dev`: sidecar up → `x-tts-provider: local`, `audio/mpeg`, 522 B, body `{"model":"omnivoice","input":…,"speed":1.1,"instruct":"calm"}` seen on the wire; sidecar down → all three providers exhausted in 252 ms (no cloud creds here), well inside the 2 s budget; `{"provider":"google"}` with the sidecar up → 200 with `x-tts-fallback-reason: GEMINI_API_KEY not configured`, proving the reason header. Config read per call, not at module load, so `VOICESTUDIO_URL` can change without a rebuild. 13/13 provider tests, MC suite 138/138, `tsc --noEmit` clean. The sidecar was a stand-in http.Server speaking VoiceStudio's two endpoints — the real app's audio is still an operator probe |

### VoiceStudio (external, :3900)

| | |
|---|---|
| **Status** | UNKNOWN |
| **Verified** | 2026-09-14 — still not probeable from the cloud session; step 3.1 shipped its client against a stand-in server, so the app itself remains unverified. Operator: install it, then `curl -s 127.0.0.1:3900/health` and repeat step 3.1's probes A and B on the design box. Env keys documented in `openclaw.env.example` |

## Family 5: Stack launcher

### bin/openclaw-stack.mjs

| | |
|---|---|
| **Status** | LIVE — seven ports, two report-only |
| **Verified** | 2026-09-14 (step 3.2) — PORTS gains `voicestudio: 3900`; `externalAppRow(id, port, dir)` pushes a `reportOnly` row whose closed state is **`CLOSED`**, not `DOWN`, so the exit predicate (`rows.some(status === 'DOWN')`) and `notifyCounts`'s `bad` set skip it without a special case; `notifyCounts` (extracted from `notifyResult`) also excludes report-only rows from `live`/`total`. Real-CLI probes with a stand-in `systemctl`: dir present + port shut → `CLOSED`, exit **0**; listener on 3900 → `LIVE`, exit 0; no dir → `ABSENT`, exit 0; the same run with `OPENCLAW_BRIDGE_DIR` set so companion-bridge reads `DOWN` → exit **1** beside a `CLOSED` voicestudio, proving the predicate is live and the exemption real. 14/14 in `test/openclaw-stack.test.mjs` (was 8). companion-bridge deliberately keeps its DOWN semantics. 2026-09-14 (step 4.2): the two hand-pushed call sites became an `EXTERNAL_APPS` table (id, port, dir) and `gods-eye-view` joined it on 4173, dir from `OPENCLAW_GEV_DIR` (default `~/Documents/openclaw infrastructure/gods-eye-view`). Probed: clone present + port shut → `CLOSED`, exit 0; listener on 4173 → `LIVE`, exit 0; no clone → `ABSENT`, exit 0; and with companion-bridge forced `DOWN` in the same table → exit **1** beside a `CLOSED` GEV and an `ABSENT` voicestudio. 17/17 tests. The listener was a two-line server, not the globe — the real LIVE is 4.1's on the design box |

## Family 6: God's Eye View (external, :4173)

### gods-eye-view checkout and Node 24 runtime

| | |
|---|---|
| **Status** | UNBUILT — but the stack now has a row waiting for it |
| **Verified** | 2026-09-14 — still no clone; upstream `package.json` engines `>=24.14.0 <25 \|\| >=26 <27`, session Node is v22.22.2 (node baseline, unchanged); default server `localhost:4173`; keyless Esri/OSM fallback confirmed in `src/mapStackController.js`. Step 4.2 added its `openclaw-stack` row, so once the operator clones and starts it the status table reports LIVE with no further change |

### docs/runbooks/

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — `ls docs/runbooks` → no such directory |

### docs/diagrams/

| | |
|---|---|
| **Status** | LIVE — two self-contained diagrams |
| **Verified** | 2026-09-08 (step 2.4) — `memory-daemon-lifecycle.html` and `memory-pipeline-dataflow.html` delivered at 9/9 showcase, Google Fonts links stripped, opened from `file://` in Chromium with a request listener: 0 external requests, 0 page errors, 37 and 42 SVG labels. Sources are `skills/archify/examples/*.json`, linked from `docs/ARCHITECTURE.md` |

## Family 7: Mesh agent state

### bin/mesh-agent.js worktree and heartbeat

| | |
|---|---|
| **Status** | LIVE — agent state reported AND consumed |
| **Verified** | 2026-09-08 (step 5.2) — the Block-0 row claiming "no `activity_state` in the heartbeat" was wrong: `grep -n activity_state bin/mesh-agent.js` → lines 793–798, and `lib/agent-activity.js` classifies starting/active/ready/idle/waiting_input/blocked from Claude's JSONL. The real gap was the consumer: `handleHeartbeat` dropped the field while renewing the lease. Now `touchActivity` persists `activity_state`/`activity_timestamp`/`activity_state_since` and `findNotProgressing` releases a worker stuck past `MESH_NOT_PROGRESSING_MINUTES`; proven on real nats-server v2.10.22 + JetStream. 2026-09-09 (step 5.3): the alive check is bounded — `markStallCleared` counts and dates consecutive clears, a worker heartbeat resets the run, and past `MESH_STALL_CLEAR_WINDOW_MINUTES` (30) the task is released with a reason naming the count; `findNotProgressing` now requires a fresh heartbeat so a dead-while-parked worker falls to stall detection. 2026-09-09 (step 5.4): `createWorktree`'s `rm -rf` fallback now requires `isOwnWorktree` proof (a `.git` FILE whose `gitdir:` resolves under this workspace's admin dir) and fails closed otherwise; `cleanupWorktree` deletes with `git branch -d`, keeping any branch that still holds unmerged commits and saying so in the log |

## Family 8: Local LLM client

### mission-control /api/agent/ask

| | |
|---|---|
| **Status** | LIVE — answer plus tool trace, token-gated |
| **Verified** | 2026-09-14 (step 6.3) — `POST {q}` → `{answer, trace, rounds, usage}`. Probed on a live `next dev`: no token → **401** from the middleware; `{"q":"  "}` → 400, non-JSON → 400; no ollama → **503** `local model unreachable at http://localhost:11434 (ECONNREFUSED)`; with the model endpoint stubbed → **200** `{"answer":"All 1 node(s) online: vm (lead, disk 32%).","trace":[{"tool":"get_fleet_state","ms":54,"error":null}],"rounds":2}` — real middleware, real runtime load of `lib/node-agent.mjs`, real ollama queue (no bypass), real `/api/mesh/nodes`. Wait bounded by `AGENT_ASK_TIMEOUT_MS` (120 s) returning 504 naming the queue rather than hanging; bypassing the queue was rejected (a second inference beside extraction is what it exists to prevent). `src/lib/openclaw-lib.ts` now holds the root-module resolution rule and `mesh-sign.ts` was rewritten onto it — one candidate list, not two. MC suite 149/149, `tsc --noEmit` clean |

### lib/node-agent.mjs

| | |
|---|---|
| **Status** | LIVE — four grounding tools, loop proven against the real Mission Control API |
| **Verified** | 2026-09-14 (step 6.2) — `createNodeAgent({client, providers})` with `applyFilter`/`projectFleet`/`projectNodeHealth`/`projectTasks` as pure functions (ported from GEV `analystEngine.js`, D11) and `createDefaultProviders()` reaching `/api/mesh/nodes` and `/api/mesh/tasks` with `mcAuthHeaders`. Probed against a live `next dev` with only the model stubbed: `ask("which nodes are down")` advertised all four tools, called `get_fleet_state` (28 ms), and the real API's row (`vm`, online, lead, linux, disk 32%, cpu 8%) reached the model as a `role: tool` message **before** the answer; `query_tasks{status=queued}` → `{count: 0}` against real NATS KV; `get_node_health{nodeId: laptop}` → `no node "laptop" in the mesh — known nodes: vm`, returned as a correctable tool result rather than a throw. 21/21 tests. The fleet projection is asserted under 1200 bytes with the tailscale peer dump and service list excluded. Model-side tool selection (does qwen3 pick the right tool unprompted) remains the operator probe 6.1 recorded |


### lib/llm-client.mjs

| | |
|---|---|
| **Status** | LIVE — tool calling on both backends |
| **Verified** | 2026-09-08 (step 6.1) — `generate()` accepts `tools`/`toolChoice` and returns normalized `toolCalls` on Ollama native `/api/chat` (object arguments) and `/v1/chat/completions` (JSON-string arguments); `format: 'json'` suppressed when tools are present; 9/9 tests against a real HTTP server. `generateAnalysis()` deliberately unchanged. Model-side reliability (qwen3 tool selection, ≥17/20) is an operator probe — no ollama in this session |
