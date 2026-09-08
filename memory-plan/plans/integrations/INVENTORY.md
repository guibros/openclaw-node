# integrations — Step Inventory

Land the 2026-09 extraction plan: web reach, rules, code graph, diagrams, local voice, God's Eye View for Arcane, cockpit, ask-the-node

Every `ROADMAP.md` block decomposed to **true atomic grain**. **One step = one
independently-verifiable runtime outcome = one 9-phase cycle = one commit** (`PROTOCOL.md` §3).
Each step carries done-evidence that is *runtime-observable* (MASTER_PLAN §5), written next to
the table, not just tests-green.

**Atomicity test (apply to every step):** does it produce exactly one verifiable behavior change?
If the Goal needs "and" between two independently-testable outcomes, split it. If the Needs span
two unrelated systems, split it. If the Verify proves two independent outcomes, split it
(PROTOCOL §11).

**Every open row requires the four-field contract** in the notes under its table — Goal · Needs
(pre-screen, checked in Phase 1; missing → BLOCK) · Feeds (post-use consumer, recorded at Phase 9)
· Verify (enforceable test tagged `runtime:` / `code:` / `visual:`). `plan-lint.sh` fails open
rows without it.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred (deliberate; never a next step, never blocks completion).
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — keep the five columns, one row per step.

Every block boundary triggers the **macro Re-Orient** (PROTOCOL §5.2); every step opens with the
**micro Re-Orient** (PROTOCOL §5.1).

Reference material for the steps: the extraction-plan artifact (code drafts for 1.1, 1.3, 2.2,
3.1, 4.4), `scratchpad/defuddle-test/test.mjs` (the in-page Defuddle proof) and
`scratchpad/archify-ir/*.json` (two showcase-valid IRs) from the 2026-09-08 session, and the
shallow clones read during that session. The scratchpad is session-local; anything a step needs
from it is re-derivable from the artifact text.

---

## Block 1 — Web reach and rules

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | web-fetch `--markdown`: inject the Defuddle full bundle into the rendered page and print a provenance header plus Markdown, falling back to innerText under a word floor |
| 1 | 1.2 | v1.2 | [ ] | web-fetch address pinning: resolve once, reject if any address is private, pin the vetted address for Chromium so a DNS rebind cannot reach a private host |
| 1 | 1.3 | v1.3 | [ ] | harness rule `lazy-senior-ladder` (tier 2, local+mesh) with an advisory added-dependency `post_validate` command |
| 1 | 1.4 | v1.4 | [ ] | skill `ponytail-review` installed and wired as a fourth `multi-review` perspective |
| 1 | 1.5 | v1.5 | [ ] | six agent-skills ports (debugging-and-error-recovery, incremental-implementation, doubt-driven-development, interview-me, deprecation-and-migration, code-review-and-quality) with collision-checked triggers |
| 1 | 1.6 | v1.6 | [ ] | `summarize` skill gains a local yt-dlp subtitle path so YouTube works with no Apify token |

> **1.1 — Goal:** `web-fetch.mjs --markdown <url>` prints title/author/published/source/words then the article body as Markdown, and falls back to innerText when the extractor yields fewer than `WEB_FETCH_MIN_WORDS` (default 40).
> **Needs:** `defuddle@^0.19.3` added to root `package.json` (resolve via `createRequire(import.meta.url).resolve('defuddle/full')`; the exports map hides `dist/`); Playwright already a root dependency; the screenshot branch stays before extraction because `parse()` strips `<script>` from the live DOM; `parse()` only, never `parseAsync()` (site extractors may call third-party APIs).
> **Feeds:** deep-research, summarize, knowledge-index-job, memory extraction (cleaner input); the `playwright-fallback` rule content in `config/harness-rules.json` names the flag.
> **Verify:** `runtime:` one public article fetched with and without the flag: output bytes drop by ≥30% and no nav/footer labels appear in the `--markdown` output · `code:` a test that sets page content to a fixture with nav, cookie banner and footer and asserts they are absent and the title header is present.

> **1.2 — Goal:** a hostname that resolves to a public address at check time and a private address at connect time is refused.
> **Needs:** `assertPublicUrl` in `workspace-bin/web-fetch.mjs` (resolves once today); Chromium launch args in the same file; the `page.route('**/*')` guard retained for sub-requests.
> **Feeds:** every consumer of web-fetch; the same pinning helper is reused by 4.6 and 6.2 for plain fetches.
> **Verify:** `code:` unit test with a stubbed `dns.lookup` returning public then private: the browser is launched with `--host-resolver-rules=MAP <host> <public-ip>` and the request never reaches the private address · `runtime:` a rebinding test host is refused with exit 2.

> **1.3 — Goal:** worker prompts that mention implementation keywords carry the seven-rung ladder, and a worker commit that adds a dependency logs a post-commit validation failure.
> **Needs:** `config/harness-rules.json` schema (id/tier/type/scope/content/activateOn/mesh_enforcement/mesh_validate_command); `lib/mesh-harness.js` dispatch of `post_validate` (line ~391) and `formatHarnessForPrompt` substring matching; D6 locked (tier 2, not tier 1).
> **Feeds:** every mesh worker prompt; local sessions through the companion bridge; the hyperagent A/B that may later promote it.
> **Verify:** `code:` `formatHarnessForPrompt` includes the rule for a prompt containing "implement" and excludes it for "summarize this" · `runtime:` a mesh task whose commit adds a line to `package.json` dependencies produces `[HARNESS] POST-COMMIT FAIL` in the agent log.

> **1.4 — Goal:** `skills/ponytail-review/SKILL.md` exists in node format and `multi-review` emits a fourth "Simplicity" prompt block.
> **Needs:** the ponytail `skills/ponytail-review` body (MIT); node frontmatter with triggers "review for over-engineering", "what can we delete", "is this over-engineered", "find speculative abstractions" and negatives "refactor suggestions", "tech debt cleanup", "security scan skill"; a routing-eval baseline saved before the edit; `workspace-bin/multi-review` prompt-block structure.
> **Feeds:** `multi-review` callers; the quality-gate reviewer flow.
> **Verify:** `code:` `skill-audit --skill ponytail-review --min-grade B` exits 0; `skill-routing-eval --compare <baseline>` reports no regression; `openclaw-skill-scanner` scores it clean · `runtime:` `multi-review --files lib/mesh-harness.js` prints four prompt blocks.

> **1.5 — Goal:** six skills installed in node format, each grade B or better, with zero routing regressions against the pre-step baseline.
> **Needs:** the six SKILL.md bodies (MIT); the frontmatter drafts from the extraction artifact; rewording rules (CONSTRAINTS.md → harness-rules + active SCOPE; nested-subagent / `codex exec` text → "a fresh mesh task carrying only artifact + contract"); scanner and skill-audit runnable.
> **Feeds:** skill routing for engineering asks; `multi-review` may cite code-review-and-quality's five axes.
> **Verify:** `code:` scanner clean on all six; `skill-audit --min-grade B` exits 0; `skill-routing-eval --compare <baseline>` no regression · `runtime:` the skill loader lists all six.

> **1.6 — Goal:** `summarize` produces a YouTube summary with `APIFY_API_TOKEN` unset.
> **Needs:** `yt-dlp` on PATH (documented in the skill's `requires.bins`); `skills/summarize/SKILL.md` current fallback section.
> **Feeds:** research and marketing skills that cite video sources.
> **Verify:** `runtime:` one public YouTube URL summarized end to end with no Apify token in the environment, subtitles fetched by yt-dlp visible in the log.

---

## Block 2 — Code graph and diagrams

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | codebase-memory-mcp binary installed by hand under `~/.openclaw/workspace/lib/` with SHA-256 verified and the resident watcher disabled, documented in a runbook |
| 2 | 2.2 | v2.2 | [ ] | `.mcp.json` registers `codebase-memory` beside `knowledge`, with `.codebase-memory/` ignored and a wrapper skill naming its tools |
| 2 | 2.3 | v2.3 | [ ] | skill `archify` installed from the upstream skill directory with the update check disabled by env |
| 2 | 2.4 | v2.4 | [ ] | two showcase-valid diagrams (memory daemon lifecycle, JSONL-to-inject dataflow) delivered under `docs/diagrams/` and linked from `docs/ARCHITECTURE.md`, fonts stripped for offline viewing |

> **2.1 — Goal:** the binary runs from `~/.openclaw/workspace/lib/codebase-memory-mcp/` and its config shows `auto_index false` and `watcher_enabled false`.
> **Needs:** release v0.10.8 `darwin-arm64` tarball and `checksums.txt`; operator present (macOS box); D4 locked (never the upstream `install` subcommand, which injects hooks into `~/.claude/settings.json`); `docs/runbooks/` directory created.
> **Feeds:** 2.2; mesh workers on other machines follow the same runbook per checkout.
> **Verify:** `runtime:` `shasum -a 256` matches the published digest; `codebase-memory-mcp config get watcher_enabled` prints `false`; no `codebase-memory-mcp` daemon process after a session.

> **2.2 — Goal:** an operator session can call `trace_path` over this repo through MCP.
> **Needs:** 2.1 closed; `.mcp.json` current shape (one server, `${HOME}` expansion); env `CBM_CACHE_DIR`, `CBM_ALLOWED_ROOT`, `CBM_MEM_BUDGET_MB`; `skills/codebase-memory/SKILL.md` wrapper listing the 15 tools.
> **Feeds:** operator sessions; `.gitignore` gains `.codebase-memory/`.
> **Verify:** `runtime:` after `index_repository`, `trace_path` answers "what calls createWorktree" naming `bin/mesh-agent.js` with zero Read tool calls in the transcript · `code:` scanner clean on the wrapper skill; `.gitignore` contains the line.

> **2.3 — Goal:** `node skills/archify/bin/archify.mjs doctor` passes on the node's Node 22 and the skill grades B or better.
> **Needs:** the upstream `archify/` skill directory (MIT; drop `examples/` and `test/`); frontmatter from the extraction artifact; `ARCHIFY_UPDATE_CHECK_DISABLED=1` in `openclaw.env.example` and in the skill's `metadata.clawdbot.env`.
> **Feeds:** 2.4; any later diagram ask.
> **Verify:** `code:` `doctor` exit 0; `skill-audit --skill archify --min-grade B`; scanner clean · `runtime:` `grep -r check-update skills/archify/bin/archify.mjs` returns nothing (the CLI never self-invokes the update check).

> **2.4 — Goal:** both diagrams open from Mission Control offline with an empty network tab.
> **Needs:** 2.3 closed; the two IR JSONs (lifecycle + dataflow, showcase-valid on 2026-09-08); `docs/diagrams/` directory; the two Google Fonts `<link>` tags removed post-render.
> **Feeds:** `docs/ARCHITECTURE.md` readers; Mission Control docs links.
> **Verify:** `code:` `archify validate <type> <ir> --quality showcase --json` reports 9 checks passed for both · `runtime:` DevTools network tab shows zero external requests when each HTML opens · `visual:` operator confirms the lifecycle rail reads ENDED→BOOT→ACTIVE→IDLE→ENDED.

---

## Block 3 — Local voice

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | Mission Control TTS provider `local` against VoiceStudio on 127.0.0.1:3900, preferred first with cloud fallback |
| 3 | 3.2 | v3.2 | [ ] | `openclaw-stack status` reports VoiceStudio on port 3900 as a report-only external app that never affects the exit code |
| 3 | 3.3 | v3.3 | [D] | gateway voice notes transcribed through `/v1/audio/transcriptions` before memory ingest |

> **3.1 — Goal:** `POST /api/tts` answers with `X-TTS-Provider: local` while VoiceStudio is open and with a fallback provider plus `X-TTS-Fallback-Reason` within 2 s when it is closed.
> **Needs:** VoiceStudio installed by the operator (Apple Silicon DMG, OmniVoice engine 2.4 GB downloaded); `mission-control/src/lib/tts/{index.ts,types.ts}` registry and `synthesizeWithFallback`; the route's provider whitelist; D5 locked (HTTP only, CC-BY-NC weights noted).
> **Feeds:** Mission Control notifications and the live page; 6.3 voice mode later.
> **Verify:** `runtime:` two curl calls against `/api/tts`, one with the app open (header `local`, `Content-Type` audio) and one closed (fallback header set, elapsed < 2 s) · `code:` a Mission Control test that the registry lists `local` and that a refused connection throws before the synth timeout.

> **3.2 — Goal:** `openclaw-stack status` prints a `voicestudio` row (LIVE / DOWN / ABSENT) and exits 0 when the app is simply not open.
> **Needs:** `bin/openclaw-stack.mjs` PORTS map and the companion-bridge row pattern (lines 24–37, 115–119); env `OPENCLAW_VOICESTUDIO_DIR`.
> **Feeds:** operator status checks; 4.2 reuses the same row shape.
> **Verify:** `runtime:` `openclaw-stack status` shows DOWN with the app closed and exit 0; LIVE with it open · `code:` the row is excluded from the `bad` set.

> **3.3 — Goal:** a Discord or Telegram voice note appears in the memory store as `[voice note: <text>]`.
> **Needs:** a real gateway JSONL carrying an audio attachment block (none observed yet; the parser at `lib/transcript-parser.mjs` extracts text only); an ASR model installed in VoiceStudio (409 otherwise); 3.1 closed.
> **Feeds:** memory extraction; session recap.
> **Verify:** `runtime:` one voice note posted through the gateway shows up transcribed in `state.db` within one daemon tick; a closed app leaves the placeholder and never blocks ingest.

---

## Block 4 — God's Eye View for Arcane

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | God's Eye View runs keyless from `~/Documents/openclaw infrastructure/gods-eye-view` under its own Node 24 with a runbook |
| 4 | 4.2 | v4.2 | [ ] | `openclaw-stack status` reports God's Eye View on port 4173 as a report-only external app |
| 4 | 4.3 | v4.3 | [ ] | `arcane` overlay branch adds the `arcane-manawells` seed layer with two upstream lines touched |
| 4 | 4.4 | v4.4 | [ ] | node skill `gods-eye-view` with a snapshot wrapper: reach, toggle layers, screenshot, forbidden routes |
| 4 | 4.5 | v4.5 | [ ] | operator names the Arcane world data source and the primary job; recorded as D8 |
| 4 | 4.6 | v4.6 | [D] | overlay middleware `/api/arcane/manawells` reading the named source behind `VITE_ARCANE_SOURCE` |
| 4 | 4.7 | v4.7 | [D] | world console: territory/biome polygon layer and a Mission Control link tile |
| 4 | 4.8 | v4.8 | [D] | real-world feeds for game logic: document the keyless proxied routes for the Arcane repo to consume |
| 4 | 4.9 | v4.9 | [D] | agent-driven design tool: local model drives `runGevAction` through the exported tool schemas |

> **4.1 — Goal:** `curl -s 127.0.0.1:4173/api/setup/status` returns 200 with every provider absent, from a checkout on branch `arcane` running under Node 24.
> **Needs:** operator present on the design box; `fnm` (or equivalent) with Node 24.14 installed (GEV engines `>=24.14 <25 || >=26 <27`; the node baseline is 22 and must not change); clone under `~/Documents/openclaw infrastructure/gods-eye-view`; no `.env`; D3 locked; `docs/runbooks/gods-eye-view.md` naming the launch command `fnm exec --using 24 npm run dev -- --host 127.0.0.1 --port 4173` and marking `/api/setup/keys` off-limits.
> **Feeds:** 4.2, 4.3, 4.4.
> **Verify:** `runtime:` the curl above; `node -v` inside the launch shell prints 24.x · `visual:` the globe shows the Esri attribution string with no Google tiles.

> **4.2 — Goal:** `openclaw-stack status` prints a `gods-eye-view` row that is LIVE after 4.1 and DOWN with the app stopped, exit 0 either way.
> **Needs:** 3.2 closed (row pattern) or the same pattern applied fresh; env `OPENCLAW_GEV_DIR`.
> **Feeds:** operator status checks; the skill in 4.4 tells agents to check this row first.
> **Verify:** `runtime:` two status runs, stopped and running · `code:` the row is excluded from the `bad` set.

> **4.3 — Goal:** the ManaWells toggle appears in the data-layers menu and renders seed pins over Montreal.
> **Needs:** 4.1 closed; on the `arcane` branch: new `src/data/local_data/arcane_manawells/arcane_manawells.geojsonl` (Point features; properties `wellId, name, biome, manaCap, manaCurrent, ownerAddress, claimedAt, contract, chainId, source`), new `src/data/arcaneLayers.js` using `createLocalGeoJsonLayer`, one spread line in `src/data/localLayers.js`, one registry entry in `src/data/layerState.js` with an unused token; commits prefixed `arcane:`; rebase recipe in the runbook.
> **Feeds:** 4.4 screenshots; 4.6 swaps the loader; D8.
> **Verify:** `code:` GEV's own `layerState` test passes with the new token · `visual:` pins over Montreal after toggling · `runtime:` the share-link URL carries the new token after enabling.

> **4.4 — Goal:** `node skills/gods-eye-view/scripts/gev-snapshot.mjs --layer arcane-manawells out.png` writes a PNG showing the seed pins.
> **Needs:** 4.3 closed; `agent-browser` installed (the skill's `requires.bins`); the driving seam `window.__godsEyeView.dataManager.setEnabled(id, true, { origin: 'user' })`; the safe-route list (`/api/setup/status`, `/api/regional-brief`, `/api/overpass`, `/api/celestrak`, `/api/launches`, `/api/gbfs`) and forbidden list (`/api/setup/keys`, `/api/realtime/*`, `/api/openai/*`, `/api/google/*`, `/api/tomtom`, `/api/firms`); routing-eval baseline; note that `web-fetch.mjs` refuses loopback by design.
> **Feeds:** quality-gate screenshot evidence for Arcane UI work; 4.7–4.9.
> **Verify:** `code:` scanner clean, `skill-audit --min-grade B`, routing-eval no regression · `runtime:` the PNG exists and is non-trivial in size; the wrapper never calls a forbidden route (log assertion).

> **4.5 — Goal:** D8 in DECISIONS names the Arcane world data source (Hardhat JSON-RPC · GeoJSONL export from `projects/arcane` · pipeline/lore locations) and the primary job (world console · feeds for game logic · design tool).
> **Needs:** 4.3 closed so the operator decides with the seed layer in front of them; the three candidate mechanisms written up in the runbook.
> **Feeds:** 4.6–4.9 un-defer accordingly.
> **Verify:** `code:` DECISIONS.md contains a D8 entry with Decision / Why / Consequences filled · `runtime:` none (decision step); BLOCKED.md names "name the source" as the external action until then.

> **4.6 — Goal:** `GET /api/arcane/manawells` on the overlay returns `{status:'live'|'cached', features:[…]}` from the named source.
> **Needs:** D8; a `configureServer` plugin following the `/api/regional-brief` pattern (GET only, single-flight cache); address-pinned fetch from 1.2 for the RPC case; `VITE_ARCANE_SOURCE=seed|rpc|file` switch in `arcaneLayers.js`.
> **Feeds:** the layer in 4.3 without a rewrite; 4.7.
> **Verify:** `runtime:` the route answers within the cache window and the layer reflects a change made at the source.

> **4.7 — Goal:** territory or biome polygons render as a second Arcane layer and Mission Control links to the globe.
> **Needs:** D8; polygon source; `createLocalGeoJsonLayer` polygon handling (see `neighborhoodPolygons.js`); a Mission Control tile pointing at `127.0.0.1:4173`.
> **Feeds:** design and ops review of Arcane territory.
> **Verify:** `visual:` polygons over Montreal · `runtime:` the Mission Control tile opens the app.

> **4.8 — Goal:** the Arcane repo has a documented list of keyless GEV routes (weather via Open-Meteo, USGS quakes, CelesTrak/ISS passes) to consume for BiomeOracle inputs.
> **Needs:** D8 choosing this job; the runbook section; nothing in this repo beyond docs.
> **Feeds:** `projects/arcane` (outside this repo).
> **Verify:** `code:` the runbook section exists and each route is curl-verified once with output pasted into AUDIT_POST.

> **4.9 — Goal:** a local model flies the camera to a ManaWell and annotates it through `runGevAction`, driven by `workspace-bin/gev-agent.mjs`.
> **Needs:** 6.1 closed (tool calling in `lib/llm-client.mjs`); `GEV_REALTIME_TOOLS` exported or served at `/api/gev/tools` on the overlay; `agent-browser evaluate` dispatch.
> **Feeds:** quest and level design sessions.
> **Verify:** `runtime:` a transcript showing tool calls `fly_to_location` then `annotate_map` and the resulting screenshot.

---

## Block 5 — Cockpit and detector

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | Orca cockpit runbook: worktree base, `mesh/` branch prefix, external worktree visibility, openclaw agent overrides, telemetry off |
| 5 | 5.2 | v5.2 | [ ] | `lib/agent-status.js`: hook listener and event mapping so mesh-agent reports working / waiting / done |
| 5 | 5.3 | v5.3 | [ ] | task-daemon reaper: 30-minute staleness and missed-Stop inference |
| 5 | 5.4 | v5.4 | [ ] | mesh-agent worktree hygiene: orphan-gitdir proof and preserve-branch-by-default |

> **5.1 — Goal:** a worktree created by the daemon at `~/.openclaw/worktrees/<taskId>` on `mesh/<taskId>` is listed in Orca.
> **Needs:** Orca installed by the operator; settings `worktreeBasePath`, `nestWorkspaces=false`, branch prefix custom `mesh/`, `worktreeVisibilityDefaults.external=show`, `agentCmdOverrides.openclaw`, `agentDefaultEnv` with `MESH_*`; `DO_NOT_TRACK=1` in the launch env; `docs/runbooks/orca-cockpit.md`.
> **Feeds:** the operator's daily driving; 5.2 hook endpoint coexists with Orca's own.
> **Verify:** `visual:` the worktree row in Orca · `runtime:` `orca worktree list --json` includes the path.

> **5.2 — Goal:** a worker that reaches a permission prompt reports `activity_state: waiting` within one heartbeat.
> **Needs:** `bin/mesh-agent.js` spawn point (~line 775) accepting a `--settings` JSON for Claude; a loopback `http.Server` on port 0 with a token; endpoint file `~/.openclaw/agent-hooks/endpoint.env`; the event mapping (tool events → working; PermissionRequest or PreToolUse of AskUserQuestion → waiting; Stop → done); the blocked-sentinel regex for hookless providers; never touching `~/.claude/settings.json`.
> **Feeds:** heartbeat payload; budget watchdog treats `waiting` as blocked; Mission Control mesh page.
> **Verify:** `runtime:` a scripted worker that triggers a permission prompt shows `waiting` in the next heartbeat · `code:` unit test for the mapping.

> **5.3 — Goal:** a worker whose last status is older than 30 minutes is reaped, and a missed Stop is inferred only when the terminal baseline matches.
> **Needs:** 5.2 closed; `bin/mesh-task-daemon.js` lease and reject paths.
> **Feeds:** task queue health.
> **Verify:** `runtime:` a stalled worker is re-queued after the window with a log line naming the cause · `code:` test for the inference guard.

> **5.4 — Goal:** cleanup of a crashed task leaves its `mesh/<taskId>` branch in place and refuses to remove a worktree whose `.git` file does not point at this repo.
> **Needs:** `cleanupWorktree` in `bin/mesh-agent.js`; the orphan-gitdir proof pattern.
> **Feeds:** operator review of failed tasks; 5.1 (Orca shows the preserved branch).
> **Verify:** `code:` tests for both paths · `runtime:` `git branch --list 'mesh/*'` still shows the branch after a simulated crash.

---

## Block 6 — Ask the node

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | `lib/llm-client.mjs` gains `tools` in and `toolCalls` out on the OpenAI-compatible branch, with qwen3 reliability evidence |
| 6 | 6.2 | v6.2 | [ ] | `lib/node-agent.mjs`: four grounding tools over Mission Control data and a pure record filter |
| 6 | 6.3 | v6.3 | [ ] | Mission Control `POST /api/agent/ask` text route with the tool trace |
| 6 | 6.4 | v6.4 | [D] | the God's Eye View design-tool loop (4.9) on top of 6.1 |

> **6.1 — Goal:** `generate({ tools })` returns `toolCalls` for a prompt that requires one, and an audit records the hit rate over 20 runs on qwen3.
> **Needs:** `lib/llm-client.mjs` `/v1/chat/completions` branch (no `tools` today); ollama with qwen3 on the box; `audits/step61_*/` table of runs.
> **Feeds:** 6.2, 4.9.
> **Verify:** `code:` unit test with a mocked server · `runtime:` the 20-run table with the WIN threshold ≥ 17/20 correct tool selections.

> **6.2 — Goal:** `askNode("which nodes are down")` calls `get_fleet_state` before answering and the answer names the down nodes.
> **Needs:** 6.1 closed; `/api/mesh/nodes` data; `memory-injector` for `recall_memory`; the "call context tools first" system prompt discipline read from GEV.
> **Feeds:** 6.3.
> **Verify:** `runtime:` a transcript with the tool call preceding the answer · `code:` record-filter tests.

> **6.3 — Goal:** `curl -X POST /api/agent/ask -d '{"q":"which nodes are down"}'` returns the answer and the tool trace.
> **Needs:** 6.2 closed; Mission Control session token on the route like every other `/api` method.
> **Feeds:** operator; later voice through Block 3.
> **Verify:** `runtime:` the curl above with the session token; a 401 without it.

> **6.4 — Goal:** same as 4.9, tracked here for dependency order.
> **Needs:** 6.1, 4.4.
> **Feeds:** 4.9.
> **Verify:** as 4.9.
