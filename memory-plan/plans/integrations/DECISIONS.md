# DECISIONS — integrations plan (append-only)

Architectural decisions for this plan. Newest at bottom. Never rewrite an entry; supersede with
a new one. Log at minimum: D1 (why this plan exists + the approach chosen) before the first step
runs, every Phase-8 architectural BLOCK resolution, and every macro-re-orient course-correction
(PROTOCOL §5.2).

Entry shape: **Decision** (what was chosen) · **Why** (the constraint or evidence that forced it)
· **Consequences** (what this commits us to / rules out).

---

## D1 — Why this plan exists and the approach chosen (2026-09-08)

**Decision.** One plan silo lands the outcome of the 2026-09 source-level review of nine
repositories (Defuddle, Ponytail, codebase-memory-mcp, Archify, VoiceStudio, Orca,
addyosmani/agent-skills, God's Eye View, Agent-Reach), as six blocks ordered by value per day and
by dependency: web reach and rules · code graph and diagrams · local voice · God's Eye View for
Arcane · cockpit and detector · ask the node. Each step is one runtime-observable outcome under
the PROTOCOL lifecycle; nothing is vendored that can be called over HTTP or installed as a skill.

**Why.** Two article-driven lists (19 Hermes skills, 10 "free" repos) were reviewed by reading
the code, not the READMEs. Most items duplicated what the node already has (kanban, memory
daemon, Karpathy loop, 108 skills) or failed the local-first policy. The survivors fill real gaps:
raw innerText fed to the extractor, a rebindable fetch guard, no code-structure index, no diagram
tooling, cloud-only TTS, no way to tell a working agent from a stuck one, and no geospatial
surface for a geolocated game. The operator then asked for an actionable integration plan and
promoted God's Eye View from "patterns only" to a real Arcane tool.

**Consequences.** Every step needs its own SCOPE activation and Runtime-Evidence trailer. The
plan does not touch the memory daemon, NATS, or the scheduler. Effort is roughly 12 engineer days
plus operator installs (VoiceStudio, Node 24 runtime, Orca).

## D2 — Agent-Reach rejected as a package (2026-09-08)

**Decision.** Do not install Agent-Reach or its skill. Borrow two local ideas only: yt-dlp
subtitle extraction for `summarize` (step 1.6) and a thin `gh search` wrapper if a step ever
needs it.

**Why.** Read in source: every web page read goes to `r.jina.ai`, web search to Exa's hosted
MCP, audio transcription to Groq or OpenAI, and four platforms are read by driving the operator's
live Chrome through a local daemon. The skill also instructs the agent to fetch and follow a
remote `update.md`. That is the memorylayer pattern the 2026-09-06 review quarantined: data
leaves the machine by design, not by bug. No author-run relay and no telemetry were found, which
does not change the verdict.

**Consequences.** Social reach stays on the existing DuckDuckGo, Tavily (keyed), X API (keyed)
and Playwright paths. Reddit, Xiaohongshu and Bilibili remain out of reach unless a keyed,
local-first path is designed separately.

## D3 — God's Eye View as an external app, keyless, text-only, two-line overlay (2026-09-08)

**Decision.** Clone God's Eye View under `~/Documents/openclaw infrastructure/gods-eye-view`
like companion-bridge, discovered by `openclaw-stack` by port probe and never spawned by it. Run
it on the keyless Esri/OSM globe with no OpenAI Realtime voice and no Google tiles. Arcane state
lives on an `arcane` branch that touches two upstream lines (`localLayers.js`, `layerState.js`)
plus new files, so `git rebase origin/main` stays cheap. Agents reach it through a node skill and
`agent-browser`, never through `web-fetch.mjs`, which refuses loopback by design.

**Why.** Operator decisions on 2026-09-08 (external, keyless, text-only, primary job open). Read
in source: the backend is a 7,800-line `vite.config.js` of dev-server middlewares with no
standalone server, the 28 voice tools are bound to OpenAI Realtime transport, the globe works with
no key, layer registration is sealed by a serialization registry, and the app requires Node 24
while the node baseline is 22. Vendoring a 160 MB Vite app into the node would violate
MASTER_PLAN §4.6 and drag a second Node runtime into the install.

**Consequences.** GEV runs under its own Node 24 through `fnm exec`, documented in a runbook; the
node's Node 22 baseline is untouched. `/api/setup/keys` is off-limits. The primary job and the
Arcane data source are decided at step 4.5 (D8) with the seed layer in front of the operator;
steps 4.6–4.9 stay deferred until then. The two client-exposed keys (Google Maps, Cesium ion) are
never set.

## D4 — codebase-memory-mcp installed by hand, never through its installer (2026-09-08)

**Decision.** Download the `darwin-arm64` release tarball and `checksums.txt`, verify SHA-256,
unpack under `~/.openclaw/workspace/lib/`, register in `.mcp.json` with `CBM_ALLOWED_ROOT`,
`CBM_CACHE_DIR`, `CBM_MEM_BUDGET_MB`, and set `auto_index false` and `watcher_enabled false`.

**Why.** Read in source: the upstream `install` subcommand edits up to 45 client configs and
injects SessionStart, UserPromptSubmit, PreToolUse and PostToolUse hooks into
`~/.claude/settings.json`, which would collide with `.claude/hooks/scope-check.sh`. The
`curl | bash` installer is the exact pattern the skill scanner refuses. The binary itself is pure
C, stdio-only, makes no network request at runtime, and indexes without any model or service.
Its optional session daemon would be a new resident process.

**Consequences.** Updates are a manual re-download. Mesh workers index their own checkout; the
unauthenticated localhost `/rpc` UI is never exposed over the mesh. `.codebase-memory/` is
gitignored.

## D5 — VoiceStudio over HTTP only; audio from the default weights is non-commercial (2026-09-08)

**Decision.** Mission Control gains a `local` TTS provider that calls VoiceStudio's
OpenAI-compatible speech endpoint on loopback port 3900 and is preferred over Google and Edge.
No VoiceStudio code is vendored. `OMNIVOICE_ANALYTICS_DISABLED=1` is set in any node-launched
environment even though analytics default to off.

**Why.** The node is local-first and every other lane already runs locally; TTS was the last
cloud default. VoiceStudio is AGPL-3.0, which is compatible with calling it over HTTP and
incompatible with vendoring. Its default OmniVoice weights are CC-BY-NC; Whisper weights are MIT.
Loopback clients need no key. Intel Macs run the engine on CPU only.

**Consequences.** Generated audio from the default engine is fine for the operator's own
notifications and not for any commercial Arcane asset; a commercially licensed engine would be
selected through the `model` field if that ever matters. The app is discovered, never spawned.
Voice-note transcription waits for a real gateway sample (step 3.3).

## D6 — Ponytail ladder enters at tier 2, promotion only on evidence (2026-09-08)

**Decision.** The seven-rung decision ladder becomes a tier-2 inject rule scoped local and mesh,
activated by implementation keywords, with an advisory `post_validate` command that flags a
newly added dependency. The `ponytail-review` skill is ported; the hooks, audit, debt and gain
skills are not.

**Why.** The delivery mechanism already exists in `config/harness-rules.json` and
`lib/mesh-harness.js`; the hooks only re-inject context and make no network calls. Ponytail's own
results files show the ladder helps Sonnet and Opus and does nothing measurable for small local
models (llama3.2 sign flips by seed; Haiku 0 of 6 in both arms of the comprehension test), and
the node's mesh workers run qwen3.

**Consequences.** Tier-1 promotion requires a hyperagent-evidence A/B on mesh tasks. The
dependency check is advisory (logged), matching the rule's own "if it can be avoided" wording.

## D7 — Sequencing against the runtime-repair batch (2026-09-08, operator to confirm)

**Decision.** This plan is an independent silo. Under one-scope-per-session discipline it
alternates with the queued runtime-repair scope named in CLAUDE.md rather than overlapping it.
Block 1 may start before runtime repair lands because it touches none of the repaired
components.

**Why.** The repair batch targets consolidation idle-gating, NATS auth, scheduler heartbeat,
stream naming, the nested Sharp duplication and watcher freshness. No step here edits the memory
daemon, NATS config, the scheduler, or `lib/mcp-knowledge`. Federation stays locked regardless.

**Consequences.** If the operator prefers repair first, this plan's SCOPE goes idle after Block 0
and resumes at 1.1 afterwards; the silo loses nothing. Any step found to touch a repaired
component is re-scoped, not merged into the repair batch.
