# integrations — Roadmap

**Goal.** Land the 2026-09 extraction plan: web reach, rules, code graph, diagrams, local voice, God's Eye View for Arcane, cockpit, ask-the-node
**Created:** 2026-09-08

Source of the block list: the source-level review of nine repositories (artifact
`openclaw-node Extraction Plan`, 2026-09-08) and the operator's decisions for God's Eye View
(external app tracked upstream · keyless and text-only first · primary job open · Arcane data
source not yet named). Blocks are ordered by value per day and by dependency. Every block
respects MASTER_PLAN §4: local-first, no phone-home by default, no new daemons, one scope per
session, runtime evidence before "done". None of these blocks touches the memory daemon, NATS,
or the scheduler; the queued runtime-repair batch is a separate scope that alternates with this
plan (DECISIONS D7).

Block 0 (this scaffold) has no INVENTORY rows: it is the silo itself, closed by the commit that
lands ROADMAP, INVENTORY, DECISIONS D1–D7, COMPONENT_REGISTRY and the TICK_PROMPT bindings.

## Block 1 — Web reach and rules

- **Intent:** cleaner page text for every downstream consumer (Defuddle), a rebind-proof fetch guard, the Ponytail ladder as a harness rule, one simplicity-review skill, six engineering skills with collision-checked triggers, and a local YouTube subtitle path. For agents and the memory extractor.
- **Exit criterion (runtime-observable):** `node workspace-bin/web-fetch.mjs <url> --markdown` prints a Markdown article with a provenance header; `skill-routing-eval --compare` against the pre-block baseline shows zero regressions with the seven new skills installed; a mesh worker adding a dependency produces a `[HARNESS] POST-COMMIT FAIL` line.
- **Unblocks:** Block 4 step 4.4 (the gods-eye-view skill uses the same skill gate); Block 6 (grounding tools consume cleaner text).

## Block 2 — Code graph and diagrams

- **Intent:** a code-structure MCP server beside the markdown knowledge server, and a deterministic diagram renderer with the first two architecture diagrams in the docs. For operator sessions and mesh workers reading repos.
- **Exit criterion (runtime-observable):** `trace_path` over this repo answers a caller question with no file read; `docs/diagrams/*.html` open offline from Mission Control with an empty network tab.
- **Unblocks:** terminal (Block 4 diagrams reuse Archify but do not depend on this block closing).

## Block 3 — Local voice

- **Intent:** Mission Control speaks through a local engine first and falls back to the cloud providers only when the desktop app is closed. Transcription of gateway voice notes deferred until a real sample exists.
- **Exit criterion (runtime-observable):** `POST /api/tts` answers with `X-TTS-Provider: local` while VoiceStudio is open and falls back within 2 s when it is closed; `openclaw-stack status` reports the app without flipping its exit code.
- **Unblocks:** Block 6 step 6.3 voice mode (later); Block 4 step 4.9 if a spoken design tool is ever wanted.

## Block 4 — God's Eye View for Arcane

- **Intent:** a live globe with real-world layers standing beside Arcane's own geolocated state, as an external app tracked upstream with a two-line overlay branch, keyless and text-only. First deliverable is a ManaWell seed layer over Montreal and a skill agents can use to reach, drive and screenshot it. The primary job (world console · real-world feeds for game logic · agent-driven design tool) is decided at step 4.5 once the operator names the Arcane data source.
- **Exit criterion (runtime-observable):** `openclaw-stack status` shows `gods-eye-view LIVE`; `curl 127.0.0.1:4173/api/setup/status` reports every provider absent; the `arcane-manawells` toggle renders pins over Montreal in a screenshot produced by the node skill's wrapper; D8 records the data source and primary job.
- **Unblocks:** steps 4.6–4.9 (deferred until D8); Block 6 step 6.4.

## Block 5 — Cockpit and detector

- **Intent:** the operator drives the node's worktrees from Orca without any repo change, and the node learns the one thing Orca does that it cannot: tell a working agent from one stuck on a permission prompt. Plus reaper staleness and worktree hygiene.
- **Exit criterion (runtime-observable):** a daemon-created `mesh/<taskId>` worktree is listed in Orca; a worker that hits a permission prompt reports `waiting` within one heartbeat; a crashed task's branch survives cleanup.
- **Unblocks:** terminal.

## Block 6 — Ask the node

- **Intent:** a text-first agent over Mission Control's own data (fleet state, node health, tasks, memory) using the grounding shape read from God's Eye View: plain JSON tool schemas, context tools that must be called before answering, a pure record filter. Requires tool calling in the local LLM client, which does not exist today.
- **Exit criterion (runtime-observable):** `POST /api/agent/ask {"q":"which nodes are down"}` answers from `get_fleet_state` output with the tool call visible in the trace; qwen3 tool-call reliability recorded under `audits/` before the route ships.
- **Unblocks:** Block 4 step 4.9.
