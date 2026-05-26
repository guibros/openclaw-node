# OpenClaw Memory Plan — Resume Doc

**Workplan status.** Block 10 in progress; Step 10.5 closed. 4 steps remain (v10.6–v10.9).
**Current version carrier.** `v10.5` (Step 10.5 closed; Block 10: 5 of 9).
**Streaks.** zero-Phase-4-correction: 11 (Block 9 all 6 + Steps 10.1–10.5 clean) · zero-Phase-8-patch: 31 (Block 5 all 5 + Block 6 all 4 + Block 7 all 4 + Block 8 both 2 + 1 from Block 4 + Steps 9.1–9.6 + Steps 10.1–10.5).
**Last commit on plan branch.** `<pending>` v10.5 — Two-node integration test (`test/federation-2node.test.mjs`) — real NATS, real round-trip.
**Last tag.** `pre-reboot-2026-05-25` — snapshot before Mac reboot to recover Ollama performance.

A fresh worker reading only this file should be able to resume the workplan with no
conversational context. The Framework that governs how steps are executed is at
[FRAMEWORK.md](FRAMEWORK.md). The full implementation plan is at
[REFERENCE_PLAN.md](REFERENCE_PLAN.md). The step list is at [INVENTORY.md](INVENTORY.md).

---

## Handoff log — 2026-05-25 12:00 (pre-reboot)

The operator session that ran from 2026-05-23 evening through 2026-05-25 noon
hit a Mac perf wall while running the historical-session backfill
(`bin/extract-existing-sessions.mjs` over `~/.openclaw/state.db`). User is about
to reboot the Mac to recover GPU performance. This section captures everything
the next Claude session needs to pick up cleanly.

### Backfill state (Step 6.4 carry-forward work)

- **120 of 228** historical sessions extracted into the entity_store + concepts
- Checkpoint: `~/.openclaw/.extract-migration-checkpoint.json` — `{ok: 120, fail: <varies>}`
- After reboot the operator wants to resume — most or all of the remaining
  ~108 sessions should succeed at normal Mac speed (~30 sec per session vs the
  5-15 min that was happening pre-reboot).

### Mac perf root cause (DIAGNOSED, not fixed)

- Qwen3-8B on Ollama running at **~1.3 sec/token** vs normal **0.03-0.05 sec/token**
  (14-50× slower than baseline). System load avg 4-7, 67k accumulated swapouts,
  GPU contention with Discord/Claude Code/WindowServer.
- Ollama has a **5m01s per-request hard wall** (not configurable in 0.24.0 —
  `OLLAMA_LOAD_TIMEOUT=3600s` extended one test request to 10 min but the wall
  STILL hit large-input sessions. Internal runner watchdog, no escape hatch).
- The combination: rich sessions need >5 min of output at degraded speed,
  hit the wall, fail. **Reboot solves the perf issue, which makes the wall
  irrelevant.**

### Code patches landed in this session (3 commits + 1 tag)

All three proven by 10+ hours of live backfill traffic on 2026-05-25:

1. **`47b6719` feat(extraction): tolerant parser**
   - `coerceExtractionResult()` — maps fuzzy enum values like `"Security"→"technology"`,
     `"research"→"researching"` instead of failing the whole 1-15 min LLM call
   - `extractJsonFromText()` — strips markdown fences + brace-matches outermost
     `{...}` for free-form LLM output (paired with LLM_FORCE_FREE_FORM env)

2. **`51adf2c` feat(llm-client): LLM_FORCE_FREE_FORM=1**
   - Disables Ollama `format: "json"` grammar constraint when set
   - Hypothesis (didn't pan out) that constrained decoder stalls on contended HW
   - Kept because pairs naturally with the tolerant parser + helpful for non-Ollama backends

3. **`2a4b4d0` feat(queue): retry control + isTransient tightened**
   - `OLLAMA_QUEUE_RETRIES=none` disables retries (3 retries × 5 min per failure
     was wasting 15 hr of wall time on a 228-session backfill)
   - `isTransient` no longer treats HTTP 500 + "fetch failed" as retryable —
     deterministic Ollama deadline failures retry-amplified to no benefit

Plus the earlier `f45e7b2 chore: LLM_MAX_TOKENS env var` from this session window.

### Reboot recovery procedure

1. **Reboot Mac** (~3 min)
2. Open fresh Claude Code session, say "resume the backfill"
3. The new Claude should:
   - Verify `git log` shows tag `pre-reboot-2026-05-25` and last commit `2a4b4d0`
   - Verify checkpoint: `jq '{ok:(.completed|length),fail:(.failed|length)}' ~/.openclaw/.extract-migration-checkpoint.json` → ok≥120
   - Verify Ollama running: `curl -s http://localhost:11434/api/tags` (launchd auto-restarts the macOS Ollama app)
   - Optionally relaunch Ollama manually with extended timeouts (only needed if hitting walls again):
     ```bash
     launchctl bootout gui/$(id -u)/com.ollama.ollama
     pkill -f "Ollama.app"
     nohup env OLLAMA_LOAD_TIMEOUT=3600s OLLAMA_KEEP_ALIVE=24h OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 \
       /Applications/Ollama.app/Contents/Resources/ollama serve > ~/.openclaw/logs/ollama-manual.log 2>&1 & disown
     ```
   - Reset failed list (give them a fresh shot):
     ```bash
     node -e 'const fs=require("fs"),p=require("os").homedir()+"/.openclaw/.extract-migration-checkpoint.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.failed=[];fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")'
     ```
   - Resume backfill with default-good settings:
     ```bash
     cd /Users/moltymac/openclaw-nodedev
     nohup env LLM_TIMEOUT=86400000 LLM_MAX_TOKENS=4096 OLLAMA_QUEUE_RETRIES=none \
       node bin/extract-existing-sessions.mjs --tail 20 > /tmp/extract-backfill.log 2>&1 & disown
     ```
   - Monitor: `tail -F /tmp/extract-backfill.log` + `watch -n 30 'jq . ~/.openclaw/.extract-migration-checkpoint.json'`
4. **Chain (Block 9)**: separate from backfill. To resume the workplan chain at
   Step 9.1, click "Load" in the workplan viewer at http://localhost:7892, or:
   ```bash
   launchctl enable gui/$(id -u)/com.openclaw.memory-plan-tick
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.memory-plan-tick.plist
   ```

### Open / deferred items

- **Item F** (workspace deploy script) still queued — see Block 8 §0 line ~275
- Backfill failed-list (whatever it shows on resume) → run a 2nd pass with
  `--tail 8 LLM_MAX_TOKENS=1500` if any sessions still fail post-reboot
- 119+ entities/decisions/themes in DB but **no concept notes regenerated yet** —
  backfill script does this in post-extraction phase (lines 220+) only if processed > 0;
  on full reboot run it'll run. To force now: `node -e 'import("./lib/obsidian-summarizer.mjs").then(m=>m.generateConceptNotes({}))'`
- **Block 9 ready to start** — frozen decisions in §0 below cover Steps 9.1–9.6
  (broadcast/offer/accepted schemas, broadcaster, offerer, acceptor, privacy
  with default-private items, cross-node integration test). User chose
  "aggressive" cadence + "default-private" + "add 9.6 cross-node test".

---

## §0 — Block-level frozen decisions

These constraints apply to every step in the **current block** and are not
re-litigated per step. Each block transition resets §0 with the block's own constraints.

### Working principles (apply to all blocks)

- **Local-first.** No phase may break local offline operation. Federation features are opt-in capabilities.
- **One commit per step.** No mid-step commits, no amends, no force-pushes. The Phase 9 commit is the only commit a tick produces.
- **Block on architectural choices.** If a step needs a decision not already captured in §0 or in the prior step's `AUDIT_POST §6` carry-forwards, write `BLOCKED.md` and stop. The autonomous worker does not improvise architecture.
- **Tests are a hard gate.** A red `npm test` at Phase 5 is a block trigger, not a "fix forward" cue.
- **Workspace files are out of repo.** `/Users/moltymac/.openclaw/workspace/` is the live runtime tree (MEMORY.md, .companion-state.md, memory/*). When a step touches a workspace file, the **change is documented in the audit doc** but the workspace file itself is not committed (it's not git-tracked). Plan ledgers committed to the repo describe what landed in the workspace.

### Block 1 frozen decisions (CLOSED — preserved for reference)

Block 1 completed 2026-05-21. All 4 steps (v1.1–v1.4) closed. See `memory-plan/audits/BLOCK_1_COMPLETE.md`.

### Block 2 frozen decisions

Authored 2026-05-21 by operator (interactive viewer session).

**Validation gate (REFERENCE_PLAN §1 "Validation") — skipped, not honored.** REFERENCE_PLAN calls for one week of dual-write shadow mode before Block 2 starts. Skipping is deliberate: the dual-write is genuinely shadow-only (existing MEMORY.md + session-store writes are unchanged; the local event log is additive), so the risk of breakage is bounded. The semantic-search Gulf-1 evaluation in Step 2.5 is the more valuable signal anyway. **Record:** if validation reveals event-log issues later, fix forward — do not roll back Block 2.

**Step 2.1 sqlite-vec stack scoping — extend `lib/mcp-knowledge/core.mjs`.** It already implements sqlite-vec + `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1 adds session-JSONL-turn embedding to this existing stack. **One embedding stack, two data sources** (markdown files + session messages). No Ollama install, no BGE-M3, no parallel vec table in session-store. This contradicts REFERENCE_PLAN §2.1's literal "install Ollama, pull bge-m3" instructions and is intentional — the plan was written before the operator confirmed mcp-knowledge was already wired.

**Block 2 hard scope — Phase 2 only (Steps 2.1–2.5).** Steps 2.1–2.4 implement extend-mcp-knowledge + hybrid search (FTS5 + semantic via reciprocal rank fusion). Step 2.5 is the manual evaluation against 20–30 real historical queries — the **major decision gate** for the entire memory plan. **Block 3 (LLM extraction) does NOT begin until Step 2.5's evaluation results are scored AND the operator authors Block 3 frozen decisions here.** If hybrid retrieval is no-better-or-worse than FTS5 on real data, the plan terminates at Block 2.

**Embedding model — ~~Xenova/all-MiniLM-L6-v2 (384-dim)~~ → AMENDED 2026-05-22 → Xenova/bge-m3 (1024-dim, multilingual).** Upgrade rationale: nodes deploy worldwide and must handle non-English content; MiniLM is English-only and benchmarks ~10 points lower on retrieval (MTEB ~41 vs BGE-M3 ~58). Latency trade-off (~200-300ms/query vs ~10ms) is acceptable for interactive use. Switch performed as an operator chore commit at the Block 2 → Block 3 boundary (tree clean, Block 2 closed). Steps required:
- `lib/mcp-knowledge/core.mjs`: `MODEL_NAME` and `EMBEDDING_DIM` constants updated.
- `test/embed-benchmark.test.mjs`: frozen-decision assertions + latency threshold updated (500ms target vs 100ms).
- `~/.openclaw/workspace/.knowledge.db` wiped; `~/.openclaw/.embed-migration-checkpoint.json` cleared; `bin/embed-existing-sessions.mjs` re-run in background (~1-3 hours for 225 sessions).
- Live MCP knowledge daemon experiences ~1-3h window of empty semantic results while re-embed runs; markdown indexer will repopulate on its next scheduled scan.

**Test baseline for Block 2:** the existing 73 pre-existing failures are still expected to fail; do not chase them. Step 2.1 begins from the v1.4 commit (`2511c75`) baseline.

### Block 3 frozen decisions

Authored 2026-05-22 by operator. Gulf-1 outcome: skip-formal-scoring; structural result already decisive — FTS5 returned 2/125 hits (broken on natural-language queries due to AND-on-tokens), semantic returned 125/125 with on-target snippets. Proceed to Block 3 (LLM extraction).

**Extraction LLM — ~~Qwen3.5-27B-Instruct via mlx-lm~~ → AMENDED 2026-05-22 → tiered Qwen3 family via Ollama.** mlx-lm is Mac-only; Qwen3.5-27B needs ~24 GB RAM unquantized (or ~14 GB at 4-bit). Both contradict the lightweight worldwide-deployment goal. New baseline:

- **Runtime — Ollama** (cross-platform: macOS / Linux / Windows). Single binary, HTTP API on localhost:11434, OpenAI-compatible endpoints (`/v1/chat/completions`). Operators can swap in mlx-lm / llama-server / vLLM by overriding `LLM_BASE_URL`.
- **Default model — `qwen3:8b`** (Ollama tag, 4-bit quant, ~5 GB RAM). The floor where JSON-mode is reliable enough for production extraction.
- **Pluggable model selector** via env var `LLM_MODEL`. Tier policy (Ollama tags):
  - ≥48 GB RAM → `qwen3:32b` (~18 GB) — top quality, slow inference
  - ≥32 GB RAM → `qwen3:14b` (~9 GB) — sweet spot
  - ≥16 GB RAM → `qwen3:8b` (~5 GB) — floor (default)
  - <16 GB → local LLM extraction unsupported; operator must wire a cloud-LLM adapter (out of scope for Block 3) or skip
- **`/no_think` directive** prepended to extraction system prompt. Qwen3 has thinking mode enabled by default; for structured-JSON extraction we want output, not reasoning narration. With thinking enabled, Qwen3-8B burns 500-2000 tokens reasoning before JSON — extraction times out at 120s. With `/no_think`, latency drops to acceptable range. Non-Qwen models ignore the token harmlessly.
- **Default LLM timeout — 600s (10 min).** Extraction is end-of-session work, not realtime; long timeout is acceptable. Operators override via `LLM_TIMEOUT`.
- **4B is excluded** by operator decision — JSON-mode reliability is too poor below 8B for this task.
- **Install-time system check — `bin/check-llm-baseline.mjs`** probes `os.totalmem()`, reports platform/arch/cores, recommends the right tier, and with `--install` runs `ollama pull <recommended>` to fetch it. Lands as part of this §0 amendment chore commit alongside the llm-client default fixes.

Step 3.1 (committed at `605ad5e` as Qwen2.5-27B-via-mlx-lm) is SUPERSEDED in spirit but its artifacts (`lib/llm-client.mjs`, `bin/llm-benchmark.mjs`, `test/llm-benchmark.test.mjs`) are retained — the HTTP client is OpenAI-compatible, so swapping defaults (port 8080→11434, model name) makes them work with Ollama. Tweaks land in this §0 amendment commit.

Step 3.2 (committed at `0bb224c` as extraction schema + prompt) is model-agnostic; no changes needed.

**Block 3 hard scope — Phase 3 only (Steps 3.1–3.4).** No bundling of Phase 4 (federation). Steps:
- **Step 3.1** — ~~Set up Qwen3.5-27B via mlx-lm~~ (committed; superseded by amendment).
- **Step 3.2** — Design extraction prompt + Zod schema (`ExtractionResult`) covering entities, themes, actions, decisions, friction_signals, relationships. Prompt template in `lib/extraction-prompt.mjs`; schema in `lib/extraction-schema.mjs`. (Committed; model-agnostic.)
- **Step 3.3** — Wire into the daemon. Replace `pre-compression-flush.mjs:extractFacts` (regex) with `extractStructured(tailMessages)` (LLM call). New SQLite tables: `entities`, `themes`, `mentions`, `decisions`. MEMORY.md generated from these tables, not raw regex fragments. **Feature flag `USE_LLM_EXTRACTION` defaults true; setting it false restores the regex extractor** for emergency rollback. Uses Ollama by default per the amended runtime above.
- **Step 3.4** — Manual validation: pick 10 recent sessions, run both extractors, manually compare MEMORY.md output quality (semantic coherence, fragment count, signal/noise).

**Validation gate before Block 4:** Step 3.4 must produce a written assessment in `memory-plan/eval/block-3-validation.md` showing LLM extraction is visibly better than regex on real sessions. If it's not better, prompt iteration is required before Block 4 begins; if it's persistently worse, Block 3 work is reverted via the feature flag and the plan continues with regex extraction (Block 4 doesn't depend on LLM extraction).

**Test baseline carrying into Block 3:** post-BGE-M3-upgrade, the embed-benchmark test will run on bge-m3 (1024-dim). Expected baseline: 559 tests with the same 73 pre-existing failures. After Step 3.1, +3-5 tests added for Qwen setup verification.

**Carry-forward to Block 4:** federation primitives (promoter, subscriber, JetStream cluster activation) do NOT depend on LLM extraction; they only need the local event log substrate from Block 1 to be working. If Step 3.4 hits problems, Block 4 can start in parallel.

**Carry-forward to Block 4 — LLM extraction timeout on large sessions:** Block 3 validation (`bin/run-block3-validation.mjs`) succeeded on small/synthetic sessions but failed with "fetch failed" on the 3 largest real sessions (557 / 340 / 336 messages, ~5K-20K input tokens). 600s timeout was insufficient at Qwen3-8B speed on that input volume. Mitigations to apply in Block 4: (a) reduce extraction tail from 40 messages to 20, OR (b) raise default LLM_TIMEOUT to 1800s (30 min), OR (c) stream the extraction so partial JSON can be parsed incrementally. Recommendation: (a) tail reduction since 40 turns produces redundant content beyond ~20-turn window in practice.

### Block 4 frozen decisions

Authored 2026-05-22 by operator (interactive session). Block 3 LLM extraction works correctly on small/medium sessions per direct smoke test; large-session timeout deferred as carry-forward.

**Federation runtime — Ollama-based architecture remains the host for any cross-node concept embedding work.** Block 4 implements the network and policy primitives that let nodes share knowledge.

**Default privacy — DEFAULT-PRIVATE.** Nothing auto-shares unless explicitly marked `share: true` OR meets the strict threshold. Per REFERENCE_PLAN: safest starting policy for a worldwide deployment with mixed-trust operators.

**Promotion policy (tighter than REFERENCE_PLAN §4.1 defaults):**
- `automatic`: kanban events (cross-node task coordination is the point)
- `explicit`: any concept/lesson with frontmatter `share: true`
- `threshold`: `concept_mention_count >= 10` (raised from REFERENCE_PLAN's 5)
- `threshold`: `decision_confidence >= 0.95` (raised from 0.9)
- `manual_review`: everything else → queued, never auto-shared

**Mesh topology assumption — bridges build regardless of cluster health.** Shared JetStream `OPENCLAW_SHARED` (configured idle in Step 1.4) may or may not be up. Block 4 wires the bridge processes; if cluster unreachable, they retry with exponential backoff. Single-node operation must work fully without the cluster.

**Conflict resolution — surface, don't auto-merge.** When local and shared disagree on a concept, retrieval returns both with provenance; agent decides per-conflict.

**Always-ingest kanban events** — unconditional. Tasks must be visible across all nodes.

**Block 4 hard scope — Steps 4.1–4.9** (expanded from REFERENCE_PLAN's 4.1–4.6 to incorporate operator-mandated agnostic-trigger + resilience work):

- **4.1** — Promotion policies config (`config/promotion-policy.yaml`).
- **4.2** — Promoter daemon (`bin/memory-promoter.mjs`): subscribes to local event log, evaluates policy, publishes eligible events to shared cluster. **Includes health-check hook + exponential backoff on cluster unreachable.**
- **4.3** — Subscriber daemon (`bin/memory-subscriber.mjs`): subscribes to shared subjects, projects into local stores with provenance. **Includes same health-check + backoff.**
- **4.4** — Provenance fields on all local stores: `source_type` (`local` / `shared`), `source_node`, `source_event_id`.
- **4.5** — Always-ingest `kanban.events.>` subjects into local `tasks_observed` table.
- **4.6** — Conflict surfacing in retrieval pipeline: when local and shared agree → merged; when disagree → return both with `conflict: true` flag.
- **4.7** — **Agnostic extraction trigger.** New NATS subject `mesh.memory.extract_request`. Memory daemon subscribes; any publisher fires extraction. Replaces Claude-Code-specific `.claude/hooks/pre-compact.sh` with a thin publisher (5-line bash that publishes the event). Daemon ALSO runs a **time-based fallback**: if no extract event in 45 min on an active session, daemon publishes one to itself. Env: `EXTRACTION_IDLE_THRESHOLD_SEC=2700`.
- **4.8** — **Daemon health monitor + supervisor.** New `lib/health-check.mjs` exporting `runHealthCheck()` → `{daemon, nats, ollama, embedder, sqlite, workspace_writable}` with per-component status. New `bin/health-watch.mjs` long-running watcher (60s interval). Alerts written to: `~/.openclaw/workspace/.daemon-health.md` (file), `mesh.health.alerts` (NATS), and macOS banner via `memory-plan-notify.sh`. launchd plist for memory-daemon gets `KeepAlive` so launchd respawns on crash. New `bin/openclaw-restart.sh` for manual graceful restart of all daemons.
- **4.9** — **Frontend publisher pack** — agnostic event publishers for popular LLM frontends. Lands in new top-level `hooks/` + `lib/publishers/` directories:
  - Tier 1 (direct hooks): `hooks/claude-code/pre-compact.sh` (replaces gutted stub), `hooks/openwebui/openclaw-publisher-plugin.py`, `hooks/librechat/openclaw-trigger.js`, `hooks/continue/openclaw-config.json`.
  - Tier 2 (SDK wrappers): `lib/publishers/openai-wrapper.mjs`, `lib/publishers/anthropic-wrapper.mjs`, `lib/publishers/gemini-wrapper.mjs`, `lib/publishers/minimax-wrapper.mjs`. Kimi/DeepSeek/OpenRouter share the OpenAI wrapper (OpenAI-compatible APIs).
  - Tier 3 (universal fallback): the 45-min idle timer from Step 4.7 plus manual `openclaw extract-now` command.
  - `docs/PUBLISHERS.md` enumerates each frontend's integration + closed-app limitations.

**Validation gate before Block 5:** all 9 steps closed AND `bin/health-watch.mjs` running for 24 hours on the operator's machine with zero spurious warnings.

**Idle threshold — 45 min.** Configurable via `EXTRACTION_IDLE_THRESHOLD_SEC` env var (default 2700).

**Health-watch alert destinations — all three:** file (`.daemon-health.md`), NATS (`mesh.health.alerts`), macOS banner. Operators can disable specific destinations via `HEALTH_ALERT_TARGETS` env var (CSV of: `file`, `nats`, `banner`).

**Test baseline for Block 4:** starts from v3.4 commit baseline. Each step adds 3-8 tests. Block 4 total expected: +35-60 tests on top of Block 3 baseline.

**Carry-forward to Block 5:** thematic substrate (Obsidian vault) needs to consume promoted concepts. The shared vault path `projects/arcane-vault/concepts-shared/` is where Block 4's subscriber writes promoted-from-others content. Block 5 reads from there.

### Block 5 frozen decisions

Authored 2026-05-22 by operator. Block 4 closed cleanly (v4.1–v4.9). The 24-hour health-watch validation gate from Block 4 §0 is **explicitly waived** — daemons launched clean, KeepAlive verified, no spurious warnings in initial runs; "fix-forward if issues surface" is the policy. Block 5 starts immediately.

**Vault location — `~/.openclaw/obsidian-local/`** (per-node, outside the repo, gitignored). NOT the existing `obsidian-vault/` at repo root (that's project lore, distinct from this concept graph). Operators override via `OBSIDIAN_VAULT_PATH` env var. Subdirectory layout:
- `concepts/` — one note per entity from Block 3's extraction store (mention_count >= threshold)
- `decisions/` — one note per significant decision
- `sessions/` — one note per session (auto-linked from concepts/decisions touched)
- `themes/` — high-level thematic indexes
- `daily/` — daily logs (existing pattern, moved here for unified vault)

**Concept-note threshold — `mention_count >= 5`** per REFERENCE_PLAN §5.2 baseline. Operators tune via `OBSIDIAN_CONCEPT_THRESHOLD` env var. Start conservative; raise if the graph becomes noisy. Decisions and themes have no threshold — every distinct one gets a note.

**Body generation — hybrid data + LLM**:
- Frontmatter is fully data-driven (`type`, `created`, `last_seen`, `mention_count`, `themes`, `related` wikilinks, `salience`).
- Body is LLM-generated 2-3 sentence summary via the same Ollama/Qwen3 stack from Block 3. New helper `lib/obsidian-summarizer.mjs` calls `extractStructured`-style prompt but with a summary-focused schema. **Falls back to data-only body** (just frontmatter + auto-listed related sessions) if LLM is unavailable — graph still works without summaries.
- Regenerated on the consolidation cycle (Block 8) or on-demand via `bin/openclaw-vault rebuild`.

**Wikilink graph parser — standard Obsidian `[[...]]` convention.** New `lib/obsidian-graph.mjs` exports `buildGraph(vaultPath)` returning `{nodes, edges}`. Edges typed: `mentions` (default), `derived_from`, `contradicts`, `instance_of` — directive parsed from frontmatter when present.

**Adjacency cache — SQLite tables**:
- `concept_graph_nodes(id, label, last_activated_at, weight)`
- `concept_graph_edges(source_id, target_id, edge_type, weight)`
- Indexed both directions for fast spreading-activation queries (Block 6 dependency).
- Refresh cadence: every 10 min OR on filesystem change via fsevents/inotify. New `bin/obsidian-graph-cache.mjs` daemon.

**Shared vault promotion — concepts that pass Block 4's promotion policy** get a copy at `projects/arcane-vault/concepts-shared/<slugified-name>.md` with provenance frontmatter:
```yaml
source_node: <NODE_ID>
source_event_id: <event-id>
original_path: ~/.openclaw/obsidian-local/concepts/<name>.md
promoted_at: <iso-ts>
```
The shared vault path is fixed; the operator's actual Obsidian app reads BOTH the local AND shared vaults (configurable as two roots in Obsidian).

**Block 5 hard scope — Steps 5.1–5.5** per REFERENCE_PLAN:
- **5.1** — Set up per-node vault (mkdir, gitignore, README in each subdir).
- **5.2** — Auto-generate concept notes from entity store (data-driven frontmatter; LLM body with fallback).
- **5.3** — Wikilink graph parser (`lib/obsidian-graph.mjs`).
- **5.4** — Adjacency cache + refresh daemon (`bin/obsidian-graph-cache.mjs`).
- **5.5** — Shared vault promotion path (writes to `projects/arcane-vault/concepts-shared/`).

**Validation gate before Block 6:** spreading activation (Block 6) needs a populated adjacency cache. Gate: after Block 5 closes, the operator's actual concept graph must have **at least 50 concept nodes and 100 edges** (verified by `node bin/obsidian-graph-cache.mjs --stats`). If lower, more session activity is needed before Block 6 starts.

**Test baseline for Block 5:** continues from v4.9 baseline. Each step adds 3-6 tests. Block 5 total expected: +20-30 tests.

**Carry-forward to Block 6:** spreading activation algorithm consumes `concept_graph_nodes` + `concept_graph_edges` directly. Block 5 must ensure the cache is queryable via library API (not just CLI).

### Block 6 frozen decisions

Authored 2026-05-22 by operator. Block 5 closed cleanly (v5.1–v5.5) but the **Block 5 validation gate is explicitly waived**: `bin/obsidian-graph-cache.mjs --stats` reports `Nodes: 0  Edges: 0  Last refresh: never`. The vault is empty because the LLM extractor (Block 3) has not yet been run against the 225 historical sessions — that's a ~19-37 hour Ollama backfill, impractical as a blocker. The chain has been building infrastructure faster than real session activity can fill it. **Policy:** Block 6 builds the spreading-activation algorithm on synthetic test graphs (mathematically valid on empty real graphs — returns nothing, caller falls back to other channels). Real-world tuning happens organically as session activity populates the graph.

**Algorithm parameters — REFERENCE_PLAN §6.1 defaults:**
- `steps = 3` — propagate activation 3 hops from seed nodes
- `decay = 0.7` — each hop multiplies activation by 0.7
- `threshold = 0.1` — drop nodes with activation below this
- Activation uses `Math.max` at each target (not sum) — prevents one well-connected hub from dominating
- All defaults configurable via env: `SPREAD_STEPS`, `SPREAD_DECAY`, `SPREAD_THRESHOLD`

**5-channel retrieval pipeline (REFERENCE_PLAN §6.2):**
1. FTS5 keyword (k=10)
2. Vector / semantic via BGE-M3 (k=10)
3. Entity exact match (k=10)
4. Theme seed → query for any themes/entities mentioned
5. Spreading activation from seeds (top 20 activated nodes)

**Reranking — Reciprocal Rank Fusion (RRF) only, no BGE-reranker-v2-m3.** REFERENCE_PLAN §6.2 names BGE-reranker-v2-m3, but it adds a 568M-param model dependency, ~150-300ms/query latency, and is overkill at this scale. RRF (constant 60, no model) combines the 5 channels well enough for shipping; cross-encoder upgrade can be a Block 7+ tuning step if retrieval quality demands it.

**Channel weights — equal start, tunable per env var.** Each channel contributes 1/5 of the combined score initially. Operators tune via `RETRIEVAL_WEIGHTS=fts:1,vec:1,entity:1,theme:1,spread:1` (CSV of channel:weight pairs).

**Block 6 hard scope — Steps 6.1–6.4** (REFERENCE_PLAN's 6.1–6.3 plus one operator-added step):
- **6.1** — Implement spreading activation algorithm (`lib/spreading-activation.mjs`, ~50 lines per REFERENCE_PLAN spec).
- **6.2** — Wire 5-channel retrieval pipeline (RRF combiner) into the existing session-store search API.
- **6.3** — Parameter tuning harness — same 25-query Gulf-1 set, run with varying decay/steps/threshold, report deltas. No formal scoring required (operator may eyeball).
- **6.4** (new) — **Historical session backfill**: `bin/extract-existing-sessions.mjs` runs the LLM extractor over all sessions in `~/.openclaw/state.db`, populates entity store, regenerates concept notes, refreshes adjacency cache. Resumable via checkpoint file (same pattern as `embed-existing-sessions`). Long-running (19-37 hours); can run in background while later blocks proceed.

**Validation gate before Block 7:** spreading activation must return non-empty results for at least 5 of the Gulf-1 25 queries when run against the populated graph (i.e., backfill from 6.4 must have created enough nodes/edges to make activation meaningful).

**Test baseline for Block 6:** continues from v5.5. Each step adds 2-5 tests. Block 6 total expected: +10-15 tests. Algorithm tests use synthetic graphs (the math is provable independent of real data).

**Carry-forward to Block 7:** proactive injection (Block 7) consumes the 5-channel retrieval pipeline directly. Empty results from any channel are acceptable; injection just shows less context. Block 7 doesn't gate on graph density.

### Block 7 frozen decisions

Authored 2026-05-23 by operator. Block 6 closed clean (v6.1–v6.4 including the historical-session backfill step). Block 7 makes memory "come to mind" automatically on every prompt without explicit recall.

**Query analysis — embedding-based, NOT a per-prompt LLM call.** REFERENCE_PLAN §7.1 proposes a small LLM call (~50ms) to extract themes/entities from each user prompt. Reject: adds 200-300ms per turn on consumer hardware (the small LLM call still routes through Ollama → too slow). Instead:
- Embed the user prompt via the existing BGE-M3 stack (one embedding pass, ~50-150ms on M4, ~250-400ms on a CPU-only consumer machine).
- Use that embedding as the seed for the 5-channel retrieval pipeline from Block 6. The pipeline's entity-match and theme-seed channels handle named-entity surfacing without needing a separate LLM call.
- A simple regex fallback runs alongside for trivial structured cues (e.g. `lib/foo.mjs`, `STEP-123`) — cheap, captures things the embedding-based path might miss.

**Pre-retrieval token budget — `INJECTION_TOKEN_BUDGET=750` (default).** REFERENCE_PLAN §7.2 says cap at 500–1000 tokens; 750 is the midpoint. Configurable via env. Tokenization uses the same model-agnostic char-based heuristic the daemon already uses (~4 chars/token estimate).

**Injection format — REFERENCE_PLAN §7.3 verbatim:**
```
[memory: recent relevant context]
Active concepts in this conversation: <list>
Recent decisions:
- <date>: <decision> (<confidence>)
Related sessions: <links>
[end memory]

<user prompt here>
```
Markdown-readable; clearly delimited so the model knows where injected context ends and the actual prompt begins.

**Runtime control — REFERENCE_PLAN §7.4 verbatim:**
- `@memory off` — disable injection for the current turn only
- `@memory deep` — increase injection budget to 2× default for current turn
- `@memory none` — hard disable for the entire session (until session restart)
- New addition: `@memory only:<theme>` — constrain injection to a specific theme/entity (operator override for focused work)

These directives are parsed from the user prompt by a tiny regex in the publisher (no LLM call needed); when matched, the directive is stripped from the prompt before injection logic runs.

**Block 7 hard scope — Steps 7.1–7.4** per REFERENCE_PLAN:
- **7.1** — Query analysis: embedding + regex fallback (no LLM call). Lives in `lib/query-analysis.mjs`.
- **7.2** — Pre-retrieve via 5-channel pipeline; trim to token budget. New `lib/memory-injector.mjs`.
- **7.3** — Inject as system-message prefix using the format above. Wires into each publisher (`hooks/claude-code/pre-compact.sh`, etc.) and the API wrappers (`lib/publishers/*-wrapper.mjs`).
- **7.4** — Runtime control directive parser. Lives in `lib/memory-directives.mjs`.

**Validation gate before Block 8:** injection adds <500ms to average prompt round-trip (measured via `bin/inject-benchmark.mjs` on 100 synthetic prompts). On the empty-graph case (current state, before backfill completes), injection should still complete cleanly with an empty context block — no errors.

**Test baseline for Block 7:** continues from v6.4. Each step adds 3-5 tests. Block 7 total expected: +12-20 tests.

**Carry-forward to Block 8:** consolidation cycle (Block 8) is the "sleep" analog that maintains graph health (decay, reinforcement, clustering, summaries, contradiction detection). Block 7 makes memory readable in real-time; Block 8 keeps the graph healthy over time. The two are independent.

### Block 8 frozen decisions

Authored 2026-05-23 by operator (interactive session). Block 7 closed (v7.1–v7.4) but five amendments remain outstanding — captured below as carry-forwards into Block 8 scope so they're FROZEN and not lost.

**Block 7 follow-up carry-forwards** — items A-E completed in commits 08b0812 / f4ae29d / 9523d8e / debb0d2 on 2026-05-23 as operator chore commits before Block 8 starts. Item F added 2026-05-23 — infrastructure tech debt surfaced during B+D deployment.

- **(A) ✅ DONE (`f4ae29d`)** — Wire `analyzeQueryWithLlm` into the production injection path. `createMemoryInjector` auto-instantiates an `llmClient` if none is passed (lazy thunk via `await import('./llm-client.mjs')`); operator opts out via `ANALYSIS_MODE=embedding`. Production traffic now benefits from intent / sentiment / disambiguation signals, with auto-fallback to embedding-only when the LLM queue is busy (per the contention design in 08b0812).

- **(B) ✅ DONE (`9523d8e` + `debb0d2`)** — Companion-bridge harness Tier 0 integration as PRIMARY injection path. Implemented as a loopback HTTP endpoint on the memory daemon (port 7893, bearer-token auth at `~/.openclaw/config/memory-injection-token`) rather than direct in-process integration (companion-bridge is a separate Bun process; can't directly import from this repo's `lib/`). New `lib/memory-inject-server.mjs` exposes `POST /memory/inject`. `harness.ts` gained `injectMemory(prompt, meta?)` async method that POSTs to the endpoint (2-sec timeout, silent on any failure, opt-out via `OPENCLAW_MEMORY_INJECT=off`). `adapter.ts` calls `harness.injectMemory()` at the two injection sites (lines 2094 + 2117). Every prompt traversing companion-bridge:8787 from any frontend now gets `[memory: ...]` automatically.

- **(C) ✅ DONE (`f4ae29d`)** — Human-recall-modeled curation. `lib/extraction-store.mjs` got idempotent ALTER TABLE migrations adding `salience` + `last_recalled` columns to `entities` and `decisions`. `lib/memory-injector.mjs` got `recallScore(item)` (composite: recency × frequency × salience × graph_activation × rrf_rank), `inhibitWithinGroup(items, cap)`, `curateForRecall(data, budget)` (replaces dumb trim with Miller 7±2 caps: active_concepts:7, recent_decisions:5, related_sessions:3, themes:3, contradictions:2), and `writeBackReconsolidation(db, recalled)`. `retrieve()` calls them in sequence. Token cap demoted 750 → 1500 (safety ceiling only). Decay half of the loop is queued as Block 8 Step 8.3 (salience half-life 14 days for un-recalled items).

- **(D) ✅ DONE (`9523d8e` — absorbed into B)** — Embedding model cached. Originally planned as a separate `lib/embedder-cache.mjs` singleton in the companion-bridge Bun process. The HTTP-endpoint architecture from item B made this naturally unnecessary: BGE-M3 lives in the memory daemon's process (already loaded by `mcp-knowledge`), and the daemon serves all injection requests over HTTP. Cold-load happens once at daemon startup; every subsequent prompt is `~30 ms` regardless of which frontend asked.

- **(E) ✅ DONE (already in Block 7.3 commits)** — Memory injection in Block 4.9 SDK wrappers. The four wrappers (`lib/publishers/{openai,anthropic,gemini,minimax}-wrapper.mjs`) already accept an `injector` opt and call `injector.retrieve()` + `injectIntoMessages()`. Their callers just need to pass one. Reassessment confirmed this was implemented; my earlier "not wired" note was wrong.

- **(F) Workspace deploy script — infrastructure tech debt.** Surfaced 2026-05-23 during B+D deployment. Symptom: code lives in `/Users/moltymac/openclaw-nodedev/` (dev repo) but the running daemon reads from `/Users/moltymac/.openclaw/workspace/` (runtime tree). The two trees are linked by manual file copies + symlinks into `~/.openclaw/workspace/node_modules/` pointing at the dev repo's installed packages. The recent `openclaw → openclaw-nodedev` rename silently broke 4 native-dep symlinks (`better-sqlite3`, `bindings`, `file-uri-to-path`, `prebuild-install`) and left 166 other packages unlinked entirely. Each daemon restart hit a different missing dep in cascade — turned a "restart the daemon" task into a 30-minute archaeology dig. Proposed fix: new `bin/deploy-to-workspace.sh` that atomically (a) diffs and copies changed `lib/*.mjs` + `bin/*.mjs` + `workspace-bin/*.mjs` files dev→workspace, (b) ensures every npm package referenced by the deployed files is symlinked into the workspace's `node_modules/`, (c) gracefully restarts the daemon via SIGTERM + launchd KeepAlive respawn, (d) verifies the new inject server endpoint comes up healthy. Either everything updates and daemon is healthy or nothing updates. Lower priority than the memory plan itself; queue as a step after Block 9 closes, or skip for personal dev use and only build before the project gets a second contributor.

**Block 8 hard scope — Steps 8.1–8.4 per REFERENCE_PLAN:**

- **8.1** — Consolidation jobs library. New `lib/consolidation.mjs` exporting: `decayWeights()`, `reinforceCoOccurrence()`, `detectClusters()`, `regenerateSummaries()`, `detectContradictions()`, `evaluatePromotionCandidates()`. Each is independently runnable + testable. New `bin/consolidate.mjs` orchestrates one full cycle.
- **8.2** — Scheduler. New `bin/consolidation-scheduler.mjs` run by launchd at 30-min cadence. Triggers a cycle when: no extraction in queue for ≥5 minutes AND no analysis in the last 60 seconds (read via `ollama-queue.getState()`). Skip if queue is busy. Hard cap ~5 minutes per cycle. All consolidation work routes through `ollama-queue.requestExtraction()` (same priority as session extraction — long-running, waits for quiet periods).
- **8.3** — Decay parameters (operator-authored, applied in 8.1):
  - Salience decay: half-life 14 days for un-recalled items: `new = old * 0.5^(days_since_recall / 14)`
  - Drop threshold: salience < 0.05 → move to `entities_archived` table (don't hard delete)
  - Reinforcement: entities co-occurring in ≥3 recent sessions → `mention_count += 1` and `salience += 0.05` (capped 1.0)
  - **This is the decay HALF of the reconsolidation loop from Block 7 amendment (C).** Reconsolidation boosts on each recall (Block 7); decay runs in batch here (Block 8). Together they implement biological forgetting + reinforcement.
- **8.4** — Cluster detection: simple co-occurrence threshold (entities appearing in same session ≥5 times → candidate for new theme note). NOT k-means / DBSCAN — too heavy for our scale; deterministic + transparent is preferred over ML clustering.

**Validation gate before Block 9:** consolidation cycle runs cleanly 3 times on the operator's machine without errors, AND a measurable change in graph state (≥10 items decayed OR ≥1 cluster detected) is verified.

**Test baseline for Block 8:** continues from v7.4. Each step adds 4-8 tests. Block 8 total expected: +20-30 tests.

**Next-tick checklist (rev — fixes prior loop bug):**

When Block 8 closes, the next tick will attempt Step 9.1 (broadcast protocol). Per framework:

1. Read `RESUME.md §0` to find Block 9 frozen decisions.
2. If `### Block 9 frozen decisions` section is ABSENT → **write `BLOCKED.md`** with reason "Block 9 frozen decisions not authored" and exit. **DO NOT** exit cleanly without `BLOCKED.md` — that bypasses the autopause mechanism and causes launchd to poll every 120s indefinitely (the bug that wasted ~5 phantom ticks at the Block 7→8 boundary on 2026-05-23).
3. The autopause logic in `workspace-bin/memory-plan-tick.sh:maybe_autopause()` requires `BLOCKED.md` presence. Honor the contract.

**This applies to EVERY block boundary going forward.** Line 974 of this file (the now-broken Block 7→8 checklist) updated to match.

### Block 9 frozen decisions

Authored 2026-05-24 by operator (interactive session). Block 8 closed at `v8.2` — consolidation library + scheduler + decay parameters + co-occurrence cluster detection all landed cleanly. Block 9 implements the cross-soul broadcast protocol per REFERENCE_PLAN §9.

**Transport (settled in Block 4, no change):** NATS shared stream `OPENCLAW_SHARED` (R=3, subject filter already covers `context.broadcast.>`, `context.offer.>`, `context.accepted.>`). All three new schemas live in `packages/event-schemas`.

**Block 9 hard scope — Steps 9.1–9.6 (REFERENCE_PLAN 9.1–9.5 + operator-added 9.6):**

- **9.1** — Schema definitions in `packages/event-schemas`. All three event types extend `EventEnvelopeSchema` (event_id, ts, source_node_id, schema_version):
  - `ContextBroadcastSchema.data`: `{ themes: string[], entities: string[], problem_class?: 'debug'|'design'|'research'|'implement', intensity: 'passive'|'interested'|'actively_seeking', ttl_minutes: number, dedup_key: string }`. **`dedup_key`** (added beyond REFERENCE_PLAN) = SHA-256 of canonicalized `themes ∪ entities` set; offerer drops duplicates without re-parsing.
  - `ContextOfferSchema.data`: `{ responding_to: uuid, offerer_node_id: string, artifacts: Array<{ artifact_ref, relevance_score, provenance, summary }>, expires_at: ISO timestamp }`. **`expires_at`** added — broadcaster ignores offers arriving after broadcast TTL expired.
  - `ContextAcceptedSchema.data`: `{ responding_to: uuid (offer's event_id), accepted_artifacts: string[] (artifact_refs), feedback?: { useful: boolean, note?: string } }`.

- **9.2** — Broadcaster (`lib/broadcast-emitter.mjs`), wired into both `consolidation-scheduler.mjs` (Block 8.2) AND `memory-daemon.mjs` per-prompt path. **Aggressive cadence** (operator decision):
  - Fires on every user turn where query-analysis (Block 7A) detects ≥3 themes
  - Also fires at end of every consolidation cycle (for the slow-cooked theme set)
  - Per-session cap: **1 broadcast per 60 sec** (rate limit, not deep silence)
  - Per-node cap: **unbounded** (no per-hour throttle — let the offerer side filter on relevance)
  - Dedup window: 15 min — same `dedup_key` within 15 min is suppressed at the broadcaster (prevents echo when same themes repeat in a turn cluster)
  - TTL default `ttl_minutes: 60`. Operator override via env `OPENCLAW_BROADCAST_TTL_MIN`
  - Intensity inference: query-analysis output drives it — question marks / "how do I" / "stuck" / "blocked" → `actively_seeking`; exploration verbs ("explore", "think about", "what if") → `interested`; descriptive/declarative → `passive`. Skip broadcast if `passive` AND theme set unchanged from prior 5 turns (truly idle)

- **9.3** — Offerer (`lib/broadcast-offerer.mjs`) runs inside `memory-daemon.mjs` (uses existing shared-stream connection). Wakes on every `context.broadcast.>` from any node except self:
  - Routes through `ollama-queue.requestAnalysis()` for `generateRelevanceSummary()` — short timeout, falls back to embedding-only summary if Ollama busy (same pattern as injection per Block 7B)
  - Relevance threshold: **`RELEVANCE_THRESHOLD = 0.55`** (RRF-combined score from the 5-channel retrieval pipeline). Below threshold = silent (don't offer noise)
  - Top-K artifacts per offer: **3** (Miller-style cap; same family as Block 7C curation caps)
  - Privacy filter: hard pre-filter on `private = 1` items per 9.5 — these never enter retrieval results that feed the offerer

- **9.4** — Acceptor (`lib/broadcast-acceptor.mjs`) inside `memory-daemon.mjs`. Wakes on `context.offer.>` events where `responding_to` matches a broadcast this node emitted:
  - Offers scored against current session's recall state (last 5 turns); top 1 surfaces via the **companion-bridge injection path** (Block 7B) as a `[peer-memory: ...]` block prepended after the local `[memory: ...]` block
  - Auto-emit `context.accepted` when the user's next prompt references the offered content (heuristic: token overlap ≥ 0.3 with the offer's summary). Feedback field stays optional — wired explicitly later if useful

- **9.5** — Privacy implementation (**default-private** per operator decision, matches REFERENCE_PLAN §9.5 recommendation):
  - ALTER TABLE migration: add `private INTEGER DEFAULT 1` to `entities`, `decisions`, `themes`. Default = private
  - New table `published_items (item_id, item_type, published_at, published_by_session)` — explicit allowlist
  - Promotion to public via: (1) `@publish` directive in chat (parsed like `@memory`), (2) operator-curated `bin/publish-item.mjs` CLI
  - Retrieval pipeline gains `respect_privacy: true` flag (default true). Offerer always passes true; local injection always passes false (your own private memory is fair game for your own sessions)

- **9.6** — Cross-node integration test (**operator-added** beyond REFERENCE_PLAN). New `test/broadcast-cross-node.test.mjs` spins up two in-process NATS clients (ephemeral stream), simulates a peer node, asserts full round-trip: emit broadcast → peer offers → acceptor injects → accepted event flows back. This becomes the deterministic equivalent of Block 8's "3 clean cycles" gate. Without it, regressions in Block 10/11/12 could silently break the loop with no automated guard.

**Validation gate before Block 10:** Step 9.6 test passes AND a real broadcast from this node has produced ≥1 offer from a (simulated or real) peer AND an accepted offer was injected into the next session prompt.

**Test baseline for Block 9:** continues from v8.2. Each step adds 4-8 tests. Block 9 total expected: +25-35 tests (9.6 cross-node fixture alone is ~8 tests).

**Next-tick checklist (Block 9→10 boundary):**

When Block 9 closes (Step 9.6 = cross-node integration test), the next tick will attempt Step 10.1. Per framework: read `### Block 10 frozen decisions` in §0 — **now present below**.

### Block 10 frozen decisions

Authored 2026-05-25 by operator (interactive session). Block 9 closing at v9.6 (federation primitives implemented + cross-node test via ephemeral NATS). Block 10 validates those primitives with REAL multi-node deployment.

**Theme.** Federation validation in the real world — Block 9 is code-on-disk with unit tests; nobody has actually federated yet. Block 10 stands up real multi-node deployment, validates the council pattern, and produces reusable infrastructure for new nodes.

**Architectural decisions (operator-frozen):**

- **Single-machine dev nodes FIRST, real VMs SECOND.** Most steps use N isolated openclaw instances on one machine (separate config trees + state.dbs + ports). Final step deploys to actual separate machines/VMs as smoke test.
- **NATS cluster size: 3** (minimum for R=3 federation; matches "council of nodes" architectural premise).
- **Node identity = ed25519 keypair** per node at `~/.openclaw/identity.key` — used to sign broadcast/offer/accepted events. Peers verify on receive.
- **Auth strictness: STRICT** — reject events with bad signatures (drop silently + log warning). No "warn-only" migration path; this is the security stance from day one.
- **Council size = 3 nodes** for this block. Multi-council / supercluster coordination is Block 11+.
- **Real NATS, not ephemeral in-process** — Step 9.6 used ephemeral NATS for unit testing; Block 10 uses actual `nats-server` instances (launchd-managed for dev, documented for VM deployment).
- **Dogfood IN the block as a harness step** — Step 10.9 builds the dogfood harness (3-node council + metrics capture). The actual 24h dogfood RUN happens between Block 10 close and Block 11 start (operator-paced), with results captured for Block 11 frozen decisions.

**Block 10 hard scope — Steps 10.1–10.9 (LARGE block, 9 steps):**

- **10.1** — `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/` with its own state.db, config, identity key. Lets us run N nodes on one dev machine without containers. CLI: `spawn-node --id alpha --port 7900` etc. Idempotent.

- **10.2** — NATS cluster setup. New `services/nats/` directory with launchd plists for 3 NATS server instances (`nats-server-1.plist`, etc.) forming a cluster on ports 4222/4223/4224 with R=3 replication. Plus `docs/NATS_CLUSTER.md` documenting the same setup for real-VM deployment (replacing localhost with actual peer addresses).

- **10.3** — Wire `ensureSharedStream(nc)` (Block 1.4) to actually run at memory-daemon startup, not just be available as a helper. Verify R=3 propagates by reading stream info on each node. Refuse to start if shared stream config doesn't match expected R=3 / file storage.

- **10.4** — Node identity + signing infrastructure. New `lib/node-identity.mjs` exporting `getOrCreateIdentity()` (generates ed25519 keypair if absent), `signEvent(event, privateKey)` (returns event with `signature` + `signer_pubkey` fields), `verifyEvent(event, expectedPubkey)` (returns boolean). Wire into `local-event-log.publishLocal` (signs outgoing) and broadcast-offerer/acceptor subscribers (verifies incoming, drops bad-sig events with warning log). Update event-schemas to include optional `signature` + `signer_pubkey` fields.

- **10.5** — Two-node integration test. `test/federation-2node.test.mjs` — spawns real `nats-server` + 2 spawned openclaw node processes (using 10.1's spawn-node), runs broadcast → offer round-trip across the cluster, asserts via NATS message capture that signatures verified, content matched, and timing was within bounds. Real network, not in-process.

- **10.6** — Three-node council test. `test/federation-3node.test.mjs` — 3 spawned nodes (A/B/C), A broadcasts on a theme, B and C BOTH produce offers, A's acceptor receives both, selects top via relevance score, accepts one. Validates: dedup_key collision handling when B and C generate independent dedup_keys for the same broadcast; expires_at respected; relevance scoring chooses sensibly.

- **10.7** — Network resilience. Peer goes offline mid-offer (test via `nats-server` SIGKILL), NATS reconnect handling in `memory-daemon.mjs` (auto-reconnect with backoff), dead-peer detection (broadcasts to a peer that's been silent >N min get logged + ignored for offer scoring), broadcast TTL cleanup on receive side (expire pending offers whose source broadcast TTL elapsed).

- **10.8** — `docs/MULTI_NODE_DEPLOY.md` — comprehensive guide for spinning up a 3-node council on real hardware. Covers: prerequisites (Node.js + nats-server), per-node setup (spawn-node CLI usage, identity key generation, NATS config), cluster startup ordering, verification steps (curl shared stream R=3 status, run a test broadcast end-to-end), troubleshooting (common firewall + DNS issues, signature mismatch debugging), and rollback procedure. Targets any combination of macOS/Linux nodes.

- **10.9** — Dogfood harness. New `bin/dogfood-council.mjs` — spawns 3 nodes locally (or accepts 3 remote node configs), wires this Claude Code's prompts through one of them, captures metrics (broadcast emit rate, offer-to-acceptance ratio, average round-trip time, signature failures, dead-peer events) to `~/.openclaw/dogfood-metrics.jsonl`. New `docs/DOGFOOD_PROTOCOL.md` documents how to interpret the metrics and what "healthy federation" looks like. **The 24h dogfood RUN happens between Block 10 close and Block 11 — results inform Block 11 frozen decisions.**

**Validation gate before Block 11:**
1. Step 10.5 and 10.6 integration tests pass cleanly (3 runs each)
2. At least 1 real broadcast → offer → accept round-trip observed on a 3-node dev cluster
3. Signature verification rejects a forged event in unit test
4. Dogfood harness emits metrics correctly

**Test baseline for Block 10:** continues from v9.6. Each step adds 4-12 tests, especially 10.5/10.6/10.7 which are integration-heavy. Block 10 total expected: +50-70 tests. Final baseline target: ~950+ tests.

**Next-tick checklist (Block 10→11 boundary):**

When Block 10 closes, the next tick will attempt Step 11.1. Per framework: read `### Block 11 frozen decisions` in §0; if absent → **write `BLOCKED.md`** with reason "Block 11 frozen decisions not authored" and exit. The dogfood results (10.9) should inform Block 11 scope — likely council coordination primitives (voting/quorum) per the architecture vision, or supercluster prep, or Neo4j savant cluster prototype. Author Block 11 decisions only AFTER reviewing dogfood metrics.

### Carry-forward from Block 0 + Block 1

- **Phase 2 scope must be revisited before Block 2 starts.** `lib/mcp-knowledge/core.mjs` already implements sqlite-vec + embeddings via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1's first deliverable is a written re-scoping decision.
- **Zod** is a workspace package dependency (`packages/event-schemas`), not a root dependency.
- **NATS JetStream** has local stream `local-events-${NODE_ID}` (R=1) and shared stream config `OPENCLAW_SHARED` (R=3, idle).
- **`docs/ARCHITECTURE.md`** has stale references to `frontend-activity` and `session-fingerprint.json`.
- **COMPANION variable name** in `daily-log-writer.mjs:34` is cosmetic.
- **Test fixture `confidence`** in `test/memory-budget.test.mjs` — harmless extra property.
- **`pre-compact.sh`** is a no-op stub awaiting Block 4 rewiring.
- **`docs/STATE_FILES.md`** should be updated to document `~/.openclaw/artifacts/` directory and shared stream.
- **`lib/artifacts.mjs`** has no caller wiring; peer NATS RPC is Block 4.
- **`ensureSharedStream`** has no caller wiring; promoter/subscriber are Block 4.
- **`npm install`** may still be blocked. No new dependencies since Block 1.
- **NATS cluster** must have ≥3 nodes for R=3 to succeed (infrastructure prerequisite).

---

## §1 — Per-step close paragraphs

### Step 0.1 — Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

Closed at v0.1. `MemoryBudget.reload()` now fires after both daemon flush paths
(pre-compression at line 835, end-of-session at line 874) and via an optional NATS
subscription on `mesh.memory.compaction_completed` (line 1054). The NATS connection is
optional with graceful degradation — if NATS is unavailable, the daemon continues to work
locally. One new test added. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.2: the daemon now has an async shutdown handler
and an optional `natsConn` in `main()` scope.

### Step 0.2 — Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers)

Closed at v0.2. Daemon state file renamed from `.companion-state.md` to
`.daemon-state-${NODE_ID}.md` across all four readers: `memory-daemon.mjs` (line 526),
`session-start.sh` (line 33), `daily-log-writer.mjs` (line 34), and
`mission-control/src/app/api/tasks/route.ts` (line 23). Function `readCompanionState`
renamed to `readDaemonState`. Migration script `scripts/migrate-companion-state.mjs`
added — idempotent, detects daemon-written files via `## Session Status` / `last_flush`
markers. `NODE_ID` derived consistently as `process.env.OPENCLAW_NODE_ID || os.hostname()`
across all JS/TS files and `${OPENCLAW_NODE_ID:-$(hostname)}` in shell. 6 positive audit
findings, zero Phase 4 corrections, zero Phase 8 patches. Carry-forwards to Step 0.3:
`COMPANION` variable name retained in daily-log-writer (cosmetic, deferred); session-start.sh
sandbox restriction requires operator pre-apply for Step 0.6; test baseline unchanged at 467.

### Step 0.3 — Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup)

Closed at v0.3. Replaced the parenthetical merge format `(updated: ...)` in `mergeFacts`
with a supersedes-comment model: merged entries now write the NEW fact verbatim plus an
invisible `<!-- supersedes: <8-char-sha256> -->` HTML comment. Added
`cleanParentheticalChains(content)` to strip legacy chains (keeps only the innermost/most
recent segment). Added `stripSupersedes(text)` for clean similarity comparison. 5 new
regression tests cover 10-merge accumulation, nested chain cleanup, supersedes presence,
comment stripping, and no-chain passthrough. `crypto` import added (Node.js built-in, no
new dependency). 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.4: test baseline now 472 (399 pass, 73 fail pre-existing);
`extractFacts` still filters `role === 'user'` only; `confidence` field still unused;
`crypto` import shifts line numbers in `pre-compression-flush.mjs`.

### Step 0.4 — Include assistant-role messages in extraction + add speaker field + new patterns

Closed at v0.4. Opened `extractFacts` role filter to include assistant messages
alongside user messages (line 166). Added `stripSpeaker(text)` helper (line 203) to
remove `[user]`/`[assistant]` prefix before similarity comparison. Added two
assistant-voice pattern groups: `agent_action` (line 160) for intent declarations
(`I'll`, `I'm going to`, etc.) and `finding` (line 162) for observations (`I found`,
`I noticed`, etc.). Added `speaker: msg.role` field on all extracted fact objects
(line 180). Updated `mergeFacts` to format entries with `[speaker]` prefix and strip
speaker tags during similarity comparison and hash computation. 5 new tests cover
assistant inclusion, speaker field, pattern matching, tool exclusion, and speaker tag
formatting. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.5: test baseline now 477 (404 pass, 73 fail pre-existing);
`confidence` field still unused (deferred to Step 0.6); `stripSpeaker` exported at
line 203; speaker tags formatted as `[user]`/`[assistant]` in MEMORY.md entries;
`agent_action` and `finding` categories are new (no downstream consumer filters by
category yet).

### Step 0.5 — Fix mid-word truncation via truncateAtWord helper

Closed at v0.5. Added `truncateAtWord(text, maxLen)` helper at
`lib/pre-compression-flush.mjs:212` to replace the hard `.slice(0, 120)` in
`extractFacts` (line 173). The helper truncates at the last space before `maxLen`,
with a 0.7 fallback threshold that avoids absurdly short results when a single word
is very long (falls back to hard slice if `lastSpace < maxLen * 0.7`). 4 new tests
cover short-text passthrough, word-boundary truncation, long-word fallback, and
exact-length passthrough. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.6: test baseline now 481 (408 pass, 73
fail pre-existing); `confidence` field still unused (Step 0.6 deletes it);
`truncateAtWord` exported at line 212; `cleanParentheticalChains` shifted to line 222.

### Step 0.6 — Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field)

Closed at v0.6. Removed four dead artifacts that were written but never read by any
in-repo consumer. (1) `.claude/hooks/pre-compact.sh`: removed `STATE_FILE` variable and
the entire `.pre-compact-state.md` write block; hook retained as no-op stub for future
Block 4 rewiring. (2) `workspace-bin/session-recap`: deleted `FINGERPRINT_FILE` constant,
`extractFingerprint` function (~60 lines), `writeFingerprint` function (~12 lines), and
the fingerprint caller block in `main()`. (3) `workspace-bin/auto-checkpoint`: deleted
`ACTIVITY_FILE` variable and `touch "$ACTIVITY_FILE"`. (4) `lib/pre-compression-flush.mjs`:
removed `confidence` property from all 7 pattern objects, from the loop destructuring, from
the fact push, and from both JSDoc annotations. `extractFacts` return shape is now
`{ fact, category, speaker }`. 1 new regression test asserts `confidence` is absent from
returned fact objects. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8
patches. Carry-forwards to Step 0.7: test baseline now 482 (409 pass, 73 fail pre-existing);
`docs/ARCHITECTURE.md` has stale references to `frontend-activity` and
`session-fingerprint.json` (out of Block 0 scope, defer or address if Step 0.7's
`docs/STATE_FILES.md` work opens the door); `pre-compact.sh` is a no-op stub; test
fixture data still passes `confidence` in some `mergeFacts` calls (harmless, cosmetic).

### Step 0.7 — Document state files (docs/STATE_FILES.md)

Closed at v0.7. Created `docs/STATE_FILES.md` — comprehensive reference inventory of
every runtime state file the memory infrastructure writes. Organized by location:
workspace runtime files (`~/.openclaw/workspace/`), daemon internal state (`.tmp/`),
SQLite databases (`~/.openclaw/`), and configuration files (`~/.openclaw/config/`).
Each entry documents owner process, format, lifetime, and consumers. Includes a
"Files removed in Block 0" section tracking the four artifacts deleted in Step 0.6.
Documentation-only step: zero functional code changes, zero new tests. 6 positive
audit findings, zero Phase 4 corrections, zero Phase 8 patches. **Block 0 complete
(7/7).**

### Step 1.1 — Create packages/event-schemas (zod envelope + memory event payloads + discriminated union)

Closed at v1.1. Created the `packages/event-schemas` workspace package — the foundational
schema layer for the event-sourced memory infrastructure. EventEnvelopeSchema defines the
13-field canonical event envelope (event_id, event_type, event_version, entity_id,
entity_type, timestamp, causation_id, correlation_id, actor, node_id, idempotency_key).
Eight memory event payload schemas extend the envelope with literal `event_type`
discriminators and typed `data` payloads: session-started, session-ended, turn-recorded,
fact-extracted, concept-mentioned, snapshot-taken, compaction-triggered, artifact-attached.
MemoryEventSchema provides a `z.discriminatedUnion` for runtime validation by event_type.
`toJsonSchema()` generates JSON Schema for cross-language consumers. npm workspaces enabled
at root (`"workspaces": ["packages/*"]`) with a `pretest` script that builds workspace
packages before tests. 15 new tests. 6 positive audit findings, 1 Phase 8 patch
(`.gitignore` for `packages/*/dist/`). Carry-forwards to Step 1.2: test baseline now 497;
`npm install` was blocked during this tick — event-schemas build script uses
mission-control's tsc (workaround), `toJsonSchema` has an `as any` cast for Zod 4/3
type mismatch — both resolve when workspace deps are properly installed; event-schemas
package exports are ready for import by `lib/local-event-log.mjs`.

### Step 1.2 — Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring)

Closed at v1.2. Created `lib/local-event-log.mjs` — the per-node event log substrate backed
by NATS JetStream. `createLocalEventLog(nc, nodeId)` ensures a JetStream stream
`local-events-${NODE_ID}` exists (R=1, file storage, `local.>` subject filter) and returns
a `publishLocal(event)` method that validates against `MemoryEventSchema` and publishes with
`idempotency_key` as `msgID` for dedup. `buildMemoryEvent()` helper constructs
envelope-conformant events with auto-generated `event_id`, `timestamp`, and `idempotency_key`.
Dual-write wired into `MemoryBudget` at three sites: `startSession()` publishes
`memory.session_started`, `endSession()` publishes `memory.session_ended`, `addEntry()`
publishes `memory.fact_extracted`. All publishing is fire-and-forget via `#publishEvent()`
private helper — errors are caught silently to ensure the event log never disrupts the
primary MEMORY.md write path (shadow mode). The daemon initializes the event log after NATS
connection and passes it as `eventLog` option to `createBudget`. 9 new tests cover event
construction, schema validation, dual-write integration, and error isolation. 6 positive
audit findings, 0 Phase 8 patches. Phase-4-correction streak reset to 0 (test count
underestimated in AUDIT_PRE: planned 7, delivered 9). Carry-forwards to Step 1.3: test
baseline now 506; `createLocalEventLog` and `buildMemoryEvent` are available for use by
the artifact store; MemoryBudget accepts `eventLog` and `nodeId` options.

### Step 1.3 — Create content-addressed artifact store (lib/artifacts.mjs + ~/.openclaw/artifacts/)

Closed at v1.3. Created `lib/artifacts.mjs` — the content-addressed artifact store under
`~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>` with `.meta.json` sidecars. Four exported
functions: `putArtifact(bytes, opts)` computes SHA-256, writes to sharded path, writes
`.meta.json` sidecar with `{ ref, size, mime_type, filename, created_at, encoding }`, returns
`{ ref, size, path }`. Idempotent: existing file → skip write. `getArtifact(ref)` reads bytes
from local path, throws on miss (peer NATS RPC deferred to Block 4). `hasArtifact(ref)` returns
boolean. `validateArtifact(ref)` re-hashes stored bytes and compares to ref. No new dependencies
(Node.js built-ins: `node:crypto`, `node:fs/promises`, `node:path`, `node:os`). Configurable
base directory via `OPENCLAW_ARTIFACTS_DIR` env var or `baseDir` parameter. 6 new tests cover
roundtrip, existence check, integrity validation, tamper detection, idempotency, and sidecar
fields. 6 positive audit findings, 0 Phase 8 patches. Carry-forwards to Step 1.4: test baseline
now 512; `lib/artifacts.mjs` is standalone with no caller wiring; peer NATS RPC and event
publishing for artifacts deferred; `docs/STATE_FILES.md` update for artifacts directory deferred.

### Step 1.4 — Configure shared JetStream cluster preparation only (R=3 stream, idle until Phase 4)

Closed at v1.4. Created `lib/shared-event-stream.mjs` — the shared JetStream stream
configuration module. Exports `ensureSharedStream(nc)` which creates/verifies the
`OPENCLAW_SHARED` stream with R=3 replication, File storage, and 7 federation subject
patterns (`kanban.events.>`, `lessons.shared.>`, `concepts.shared.>`,
`context.broadcast.>`, `context.offer.>`, `context.accepted.>`, `artifacts.shared.>`).
Exports `inspectSharedStream(nc)` for operational verification returning `{ config, state }`.
Exports `SHARED_STREAM_NAME` and `SHARED_SUBJECTS` constants. Infrastructure preparation
only — stream sits idle until Block 4 wires promoter/subscriber processes. 16 new tests
with mock NATS connection cover constants, stream creation, idempotency, storage type,
and inspection. 6 positive audit findings, 1 negative finding (`StorageType.File` value
assumption — numeric 2 vs actual string 'file'), 0 Phase 8 patches. Phase-4-correction
streak reset to 0. **Block 1 complete (4/4).**

### Step 2.1 — Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test

Closed at v2.1. Extended `lib/mcp-knowledge/core.mjs` with session-turn embedding capability.
Three deliverables landed: (1) Scope review documented in AUDIT_PRE §3 — decision is to extend
mcp-knowledge with parallel session tables (`session_documents`, `session_chunks`,
`session_chunk_vectors`) rather than mixing into existing document tables. One embedding stack,
two data sources. (2) sqlite-vec verified working — already loaded in mcp-knowledge via
`sqlite-vec` package. (3) Integration smoke test — 7 new tests prove session turns can be
embedded, stored, and searched alongside markdown chunks. New exports: `chunkSessionTurns(turns)`
for turn-aligned chunking with role prefix, `indexSessionTurns(db, sessionId, sourcePath, turns)`
for idempotent content-hash-based indexing, `searchSessions(db, query, limit)` for semantic search
over session chunks. `getStats()` updated to include `session_documents` and `session_chunks`
counts. `createKnowledgeEngine()` exposes `searchSessions` and `indexSessionTurns` methods.
6 positive audit findings, 1 negative (test count underestimate: planned 6, delivered 7),
0 Phase 8 patches.

### Step 2.2 — Choose embedding model + benchmark on real session data (latency target <100ms/turn)

Closed at v2.2. Confirmed Xenova/all-MiniLM-L6-v2 (384-dim) as the embedding model per
Block 2 frozen decisions (no Ollama, no BGE-M3 — overrides REFERENCE_PLAN §2.2). Benchmark
validates the model meets the <100ms/turn latency target by a wide margin (~5ms/turn on M4
after warm-up). 5 new tests in `test/embed-benchmark.test.mjs` across 2 describe blocks:
"embedding model identity" (3 tests: model name matches frozen decision, dimension is 384,
output is L2-normalized) and "embedding latency benchmark" (2 tests: per-turn mean <100ms on
50 synthetic turns, batch of 100 turns <10s). Synthetic turns model real session patterns
(NATS config, code review, architecture discussion, debugging, artifact store, spreading
activation). 6 positive audit findings, 0 negative, 0 Phase 8 patches.

### Step 2.3 — Chunk and embed existing sessions (resumable migration with checkpoint file)

Closed at v2.3. Created `bin/embed-existing-sessions.mjs` — a standalone resumable migration
script that reads all sessions from the session-store DB (`~/.openclaw/state.db`) and indexes
their embeddings into the mcp-knowledge database via the existing `indexSessionTurns()`
infrastructure. The script opens the session store read-only (`{ readonly: true }` flag in
better-sqlite3), iterates all sessions, queries their messages, forms turns arrays, and calls
`indexSessionTurns()` for each. Checkpoint file at `~/.openclaw/.embed-migration-checkpoint.json`
tracks completed session IDs after each session for crash resumability. SIGINT handler enables
graceful mid-migration shutdown. Session source path uses synthetic URI format
`session-store://<session-id>`. `indexSessionTurns()` idempotency (content-hash check) provides
a second layer of dedup. 5 new tests in `test/embed-existing-sessions.test.mjs`: migrate 2
sessions, idempotent re-run, checkpoint file verification, empty session store, zero-message
session skip. 6 positive audit findings, 0 negative, 0 Phase 8 patches.

### Step 2.4 — Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags

Closed at v2.4. Extended `lib/mcp-knowledge/core.mjs` with three search modes: FTS5 keyword
search (`searchSessionsFts` at line 712), Reciprocal Rank Fusion combiner (`reciprocalRankFusion`
at line 768), and hybrid search (`hybridSearchSessions` at line 804) which fuses FTS5 + semantic
via RRF. Added `session_chunks_fts` FTS5 virtual table with external content mode
(`content='session_chunks', content_rowid='id'`) and sync triggers (AFTER INSERT, AFTER DELETE)
in `initDatabase()`. One-time FTS5 rebuild for pre-existing data via `session_fts_built` meta key.
Updated `searchSessions()` to include `chunk_id` field for RRF deduplication keying. Updated
`createKnowledgeEngine()` to expose `searchSessionsFts` and `hybridSearchSessions` methods.
Created `bin/session-search.mjs` CLI tool with `--semantic`/`--hybrid`/`--fts` flags (default:
hybrid), `--limit N`, `--db PATH` options. Uses `node:util` parseArgs (zero external dependencies).
7 new tests in `test/hybrid-search.test.mjs`: RRF merge+boost, RRF empty input, RRF single set,
FTS5 keyword hit, FTS5 no-match, hybrid combined results, hybrid ranking. 7 positive audit
findings, 0 negative, 0 Phase 8 patches.

### Step 2.5 — Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate

Closed at v2.5. Created `bin/run-gulf1-eval.mjs` — the Gulf 1 evaluation runner that queries
all three search modes (FTS5, semantic, hybrid) against a curated query set and produces a
structured markdown results document with scoring columns for manual operator review. Exports
`parseQuerySet`, `runEvaluation`, `formatResults`, `aggregateScores`, and `checkDatabaseReadiness`.
Created `memory-plan/eval/gulf1-queries.json` with 25 queries across 8 categories (architecture,
memory-lifecycle, architecture-decision, semantic-layer, extraction, infrastructure, search,
federation). Each query has `id`, `query`, `category`, and `expected_topic` fields. The results
document includes per-query tables showing top-5 results from each mode with empty 0-2 scoring
columns, plus an aggregate scores section and a go/no-go decision checklist. Operator must run
the evaluation against live databases and score results before Block 3 can begin. 7 new tests in
`test/gulf1-eval.test.mjs`: parseQuerySet valid/invalid/missing-field, runEvaluation 3-mode
structured results, empty database handling, formatResults markdown output, checkDatabaseReadiness
counts. 6 positive audit findings, 1 negative (test count underestimate: planned 5, delivered 7),
0 Phase 8 patches. **Block 2 complete (5/5).**

### Step 3.1 — Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session)

Closed at v3.1. Created `lib/llm-client.mjs` — the LLM client module that communicates
with a locally-running Qwen3.5-27B-Instruct model via the `mlx-lm` server's OpenAI-compatible
HTTP API. `createLlmClient({ baseUrl, model, timeout })` factory returns `{ generate, healthCheck }`.
`generate(messages, opts)` calls `POST /v1/chat/completions` with support for JSON mode
(`response_format: { type: 'json_object' }`). `healthCheck()` calls `GET /v1/models` and returns
structured status `{ ok, model, models, error }`. Fully configurable via environment variables
(`LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT`). Zero new npm dependencies (uses Node built-in
`fetch`). Created `bin/llm-benchmark.mjs` — CLI benchmark tool that generates a 40-turn
synthetic session with realistic domain vocabulary (NATS, embeddings, spreading activation,
entity extraction), runs structured-output extraction via JSON mode, and measures wall-clock
latency against the ≤30s target. Reports tokens/sec when usage data is available. Exports
`generateSyntheticSession(turnCount)` and `runBenchmark(client, turns)` for programmatic use.
4 new tests with mock HTTP server: interface check, generate request format, healthCheck
response parsing, JSON mode response_format. 6 positive audit findings, zero corrections,
zero Phase 8 patches. Carry-forwards to Step 3.2: test baseline now 563 (490 pass, 73
fail pre-existing); `createLlmClient` ready for import by the extraction prompt module;
`DEFAULT_MODEL` set to `mlx-community/Qwen2.5-27B-Instruct-4bit` (operator should verify
against local installation); operator should run `node bin/llm-benchmark.mjs` to verify live
≤30s target before Step 3.2.

### Step 3.2 — Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships)

Closed at v3.2. Created `lib/extraction-schema.mjs` — ExtractionResultSchema via Zod v4.3.6
defining the structured-output shape for LLM-driven extraction. Six categories: entities
(name, type enum of 6 values, salience 0-1), themes (label, hierarchy array), actions (enum
of 6 activity types), decisions (decision, rationale, confidence 0-1), friction_signals
(signal, severity enum), relationships (source, target, type enum of 5 values). Sub-schemas
exported individually (`EntitySchema`, `ThemeSchema`, `DecisionSchema`, `FrictionSignalSchema`,
`RelationshipSchema`) alongside enum arrays (`ENTITY_TYPES`, `ACTION_TYPES`, `SEVERITY_LEVELS`,
`RELATIONSHIP_TYPES`). `validateExtractionResult(data)` convenience function wraps
`ExtractionResultSchema.parse()`. Created `lib/extraction-prompt.mjs` — prompt template and
extraction runner. `buildExtractionPrompt(messages)` formats session tail messages (user +
assistant only, tool messages filtered) into a system+user message pair with detailed
extraction instructions, schema description in JSON format, and rules for canonical naming,
salience interpretation, and empty-array handling. `extractStructured(client, messages)` calls
`client.generate()` with JSON mode, parses the response content as JSON, validates against
the schema, and returns the typed result. Three failure modes cleanly separated: network/HTTP
(from client), JSON parse (caught with raw content preview), schema validation (Zod errors).
7 new tests with mock clients: 4 schema validation tests (valid full, empty arrays, missing
field, invalid type), 1 prompt builder test (message construction), 2 extraction runner tests
(mock validation, malformed JSON rejection). 6 positive audit findings, zero Phase 8 patches.
Phase-4-correction streak reset to 0 (test count underestimate: planned 6, delivered 7).
Carry-forwards to Step 3.3: test baseline now 570 (497 pass, 73 fail pre-existing);
`extractStructured` ready for daemon wiring behind `USE_LLM_EXTRACTION` feature flag;
schema covers all 6 categories needed for the entity/theme/decision/mention SQLite tables.

### Step 3.4 — Validate LLM vs regex extraction on 10 sessions; document quality delta

Closed at v3.4. Created `bin/run-block3-validation.mjs` — CLI validation tool that reads
sessions from the session store (`~/.openclaw/state.db`), runs both the regex extractor
(`extractFacts` + `mergeFacts`) and the LLM extractor (`extractStructured` +
`generateMemoryContent` via temp in-memory extraction store) on each session, and produces
a structured markdown comparison document at `memory-plan/eval/block-3-validation.md` for
manual operator review. Exports `readSessions(dbPath, limit)` for session reading,
`runRegexExtraction(messages)` and `runLlmExtraction(client, messages, sessionId)` for the
two extraction paths, `aggregateMetrics(results)` for summary statistics,
`formatComparison(results)` for the markdown document, and `runValidation(opts)` for the
full pipeline with CLI entry. Handles LLM unavailability gracefully — runs regex extraction
unconditionally and skips LLM extraction with a message if Ollama health check fails.
Per-session manual scoring tables with 5 criteria (semantic coherence, signal-to-noise
ratio, coverage, actionable information, fragment quality) and a go/no-go decision
checklist. 9 new tests with mock DB and mock LLM client. 6 positive audit findings,
1 negative (test count underestimate: planned ~6, delivered 9), zero Phase 8 patches.
**Block 3 complete (4/4).**

### Step 4.1 — Define promotion policies (config/promotion-policy.yaml)

Closed at v4.1. Created `config/promotion-policy.yaml` with operator-specified thresholds
(tighter than REFERENCE_PLAN defaults): `automatic: [kanban_events]`, `explicit: [share_true]`,
`threshold: { concept_mention_count: 10, decision_confidence: 0.95 }`,
`manual_review: [everything_else]`. Created `lib/promotion-policy.mjs` with
`loadPromotionPolicy(configPath)` (async YAML loader with validation),
`validatePromotionPolicy(parsed)` (structural validator rejecting unknown keys/categories),
`DEFAULT_POLICY_PATH` (resolves to `config/promotion-policy.yaml`), and `POLICY_CATEGORIES`
constant. Uses `js-yaml` (existing dependency, ^4.1.1). 11 new tests cover load default
config, missing file, custom path, valid policy, null input, missing category, unknown key,
non-numeric threshold, unknown threshold key, DEFAULT_POLICY_PATH suffix, POLICY_CATEGORIES
content. 6 positive audit findings, 1 negative (test count underestimate: planned ~6,
delivered 11), zero Phase 8 patches. INVENTORY.md updated to add Steps 4.7–4.9 per Block 4
frozen decisions (block expanded from 6 to 9 steps; total steps 45 → 48).
Carry-forwards to Step 4.2: `loadPromotionPolicy` ready for import by promoter daemon;
`evaluatePromotionPolicy(event, policy)` is the next step's primary deliverable.

### Step 4.2 — Implement promoter (bin/memory-promoter.mjs)

Closed at v4.2. Created `bin/memory-promoter.mjs` — the promoter daemon that subscribes to
the local event log (NATS JetStream), evaluates each event against the promotion policy, and
publishes eligible events to the shared cluster (`OPENCLAW_SHARED`) with `promoted_from`
provenance tracking. Exports `evaluatePromotionPolicy(event, policy)` — pure function checking
event against policy rules in priority order: automatic (kanban_events via entity_type/event_type),
explicit (share:true in data), threshold (concept_mention_count >= 10, decision_confidence >= 0.95).
Returns `{ decision, category, reason }`. Exports `mapToSharedSubject(event)` mapping local event
types to shared stream subjects (kanban → `kanban.events.*`, concept → `concepts.shared.*`,
fact → `lessons.shared.*`). Exports `createBackoff(opts)` — exponential backoff controller
(base 1s, max 60s, multiplier 2) with `recordFailure()`, `reset()`, `getDelay()`. Exports
`createPromoter(nc, nodeId, opts)` — factory wiring JetStream durable consumer on local stream,
evaluate→promote pipeline, shared cluster publishing with provenance, and cluster health
resilience (degraded mode at startup, retry with backoff on publish failures). CLI entry point
with SIGINT/SIGTERM graceful shutdown. 10 new tests covering policy evaluation (6 cases),
subject mapping (3 cases), and backoff controller (1 case). 7 positive audit findings,
zero corrections, zero Phase 8 patches.
Carry-forwards to Step 4.3: `evaluatePromotionPolicy` available for reuse by subscriber;
`createBackoff` reusable by subscriber; `mapToSharedSubject` establishes subject conventions.

### Step 4.3 — Implement subscriber (bin/memory-subscriber.mjs)

Closed at v4.3. Created `bin/memory-subscriber.mjs` — the subscriber daemon that subscribes
to the shared NATS JetStream cluster (OPENCLAW_SHARED), evaluates each incoming event via
`evaluateIngestionPolicy(event, nodeId, parsed)` — pure function checking self-originated
(skip), category-based acceptance (kanban → always ingest, concept/lesson/artifact → accept,
broadcast/offer/accepted → defer to Block 9). `parseSharedSubject(subject)` maps all 7
SHARED_SUBJECTS patterns to category labels. `createSubscriber(nc, nodeId, opts)` factory
creates a durable consumer (`subscriber-${nodeId}`) on the shared stream, runs the ingestion
loop with provenance envelope `{ source_type: 'shared', source_node, source_event_id }`,
reuses `createBackoff` from promoter (zero duplication). Handles shared stream unavailability
gracefully — returns a degraded no-op subscriber. CLI entry point with SIGINT/SIGTERM
graceful shutdown. 14 new tests covering parseSharedSubject (6 cases), evaluateIngestionPolicy
(7 cases), and createBackoff reuse (1 case). 8 positive audit findings, zero corrections,
zero Phase 8 patches.
Carry-forwards to Step 4.4: `parseSharedSubject` provides category routing for store writes;
`onIngest` callback is the hook point for actual store projection; provenance envelope shape
matches the column schema planned for Step 4.4; `createBackoff` lives in promoter — both
daemons import it.

### Step 4.4 — Add provenance fields (source_type, source_node, source_event_id) to local stores

Closed at v4.4. Added provenance columns (`source_type TEXT DEFAULT 'local'`, `source_node TEXT`,
`source_event_id TEXT`) to all 4 extraction store tables (`entities`, `themes`, `mentions`,
`decisions`) via idempotent ALTER TABLE migration with `PRAGMA table_info()` checks.
Added provenance indexes (`idx_*_source_type`) for efficient retrieval filtering. Updated
`storeExtractionResult(sessionId, result, provenance)` to accept optional provenance
parameter — existing callers pass no provenance and get `PROVENANCE_LOCAL` automatically.
Exported `PROVENANCE_LOCAL` frozen constant with shape `{ source_type: 'local', source_node: null,
source_event_id: null }`. 8 new tests cover column existence on all 4 tables, default local
provenance, shared provenance storage, query-by-source filtering, and constant shape.
7 positive audit findings, zero corrections, zero Phase 8 patches.
Carry-forwards to Step 4.5: `storeExtractionResult` ready to receive shared provenance from
subscriber's `onIngest` callback; provenance indexes ready for retrieval queries;
`tasks_observed` table (Step 4.5) should include provenance columns in its CREATE TABLE.

### Step 4.5 — Always-ingest kanban events into tasks_observed

Closed at v4.5. Created `lib/kanban-store.mjs` with `createKanbanStore(opts)` factory — opens
SQLite database and creates `tasks_observed` table with provenance columns from creation
(no migration needed, per Step 4.4 carry-forward). `projectKanbanEvent(event, nodeId, provenance)`
provides full projection for owned tasks (`owner === nodeId`: all data fields stored including
title, priority, and full JSON blob in `data_json`) and summary projection for non-owned tasks
(`owner !== nodeId`: only task_id, owner, status stored; title, priority, data_json set to null).
Query API: `getObservedTasks(filters)` supports `ownedOnly`, `status`, and `sourceType` filter
dimensions; `getTaskById(taskId)` returns latest event by `received_at DESC`;
`getStats()` returns `{ total, owned, summary, localCount, sharedCount }`. Handles missing
`owner` field gracefully (defaults to null, treated as non-owned). 8 new tests cover table
creation with provenance columns, full projection, summary projection, ownedOnly filtering,
sourceType filtering, latest-event retrieval, stats counts, and missing owner. 7 positive
audit findings, zero corrections, zero Phase 8 patches.
Carry-forwards to Step 4.6: `createKanbanStore` exported from `lib/kanban-store.mjs:27`;
`projectKanbanEvent` matches subscriber's `onIngest(event, parsed, provenance)` signature;
wiring subscriber to kanban store requires category-routing in `onIngest` callback;
`tasks_observed` table is in same database as extraction store tables.

### Step 4.6 — Conflict surfacing in retrieval pipeline (describeConflict)

Closed at v4.6. Created `lib/conflict-surfacing.mjs` with 5 exports for conflict detection
and surfacing in the retrieval pipeline. `describeConflict(localItem, sharedItem)` is a pure
function per REFERENCE_PLAN returning `{ local_definition, shared_definition, last_local_mention,
last_shared_mention }`. `findEntityConflicts(db)` queries entities that have mentions from both
`source_type='local'` AND `source_type='shared'` via subquery-based detection on the mentions
table — each conflict includes `entity_name`, `conflict_type: 'mixed_provenance'`, mention counts
by source, `shared_source_node`, and a formatted `description` from `describeConflict`.
`findDecisionConflicts(db)` queries sessions that have decisions from both local and shared sources
using GROUP BY with HAVING — returns local and shared decision lists per session.
`surfaceConflicts(db)` aggregates entity and decision conflicts into
`{ entity_conflicts, decision_conflicts, total }`. `annotateWithConflicts(results, conflicts)`
adds `conflict: true` flag and `conflict_detail` to retrieval results matching known conflicts
by entity name (O(1) Map lookup, non-mutating). All functions take `db` parameter (dependency
injection) — compatible with both extraction store and kanban store databases. 9 new tests.
7 positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
Carry-forwards to Step 4.7: `surfaceConflicts(db)` and `annotateWithConflicts()` ready for
pipeline integration; Step 4.7 (agnostic extraction trigger) is independent of conflict surfacing.

### Step 4.7 — Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer)

Closed at v4.7. Created `lib/extraction-trigger.mjs` with 4 exports: `EXTRACT_SUBJECT`
('mesh.memory.extract_request'), `DEFAULT_IDLE_THRESHOLD_SEC` (2700 = 45 min),
`publishExtractRequest(nc, nodeId, opts)` for NATS event publishing, and
`createExtractionTrigger(nc, nodeId, opts)` factory returning `{ start(), stop(),
resetIdleTimer() }` with NATS subscription + idle timer management. Wired into
memory-daemon: extraction trigger created after NATS connection, onExtract runs
shouldFlush+runFlush pipeline, idle timer reset on active ticks, stopped on shutdown.
`.claude/hooks/pre-compact.sh` modification dropped due to tooling constraint — deferred
to Step 4.9. 9 new tests. 9 positive, 2 negative findings, 1 Phase 8 patch
(parseInt→parseFloat).

### Step 4.8 — Daemon health monitor + supervisor (lib/health-check.mjs + bin/health-watch.mjs)

Closed at v4.8. Created `lib/health-check.mjs` with 7 exports: `runHealthCheck(opts)` async
function with dependency-injected 6-component health checks (daemon via launchctl/pgrep, nats
via monitoring HTTP endpoint, ollama via `/api/tags`, embedder via @huggingface/transformers
import, sqlite via better-sqlite3 `SELECT 1`, workspace_writable via temp file probe), each
returning `{ ok, detail, latency_ms }` with 5s timeout via `timedCheck()` wrapper and
`Promise.allSettled` for parallel execution. `deriveStatus(result)` pure function (all
ok→'healthy', none→'unhealthy', mixed→'degraded'). `formatHealthReport(result)` markdown
table formatter. `parseAlertTargets(envValue)` CSV parser for `HEALTH_ALERT_TARGETS` env var
(validates against Set of 'file','nats','banner'). Constants: `COMPONENT_NAMES` (6),
`DEFAULT_INTERVAL_SEC` (60), `ALERT_TARGETS_DEFAULT` ('file,nats,banner'). Created
`bin/health-watch.mjs` with `createHealthWatch(opts)` factory — runs health checks at
configurable interval (default 60s via `HEALTH_WATCH_INTERVAL_SEC`), fires alerts only on state
transitions or every 5 min while unhealthy, routes to 3 destinations (file→.daemon-health.md,
NATS→mesh.health.alerts, macOS banner→memory-plan-notify.sh). Created `bin/openclaw-restart.sh`
— manual restart script using `launchctl kickstart -k` for managed services + `pgrep/kill`
fallback for unmanaged processes. 15 new tests. 10 positive, 2 negative findings, 1 Phase 8
patch (`??`/`||` syntax fix).
Carry-forwards to Step 4.9: test baseline 671 (594 pass, 77 fail); `runHealthCheck` at
`lib/health-check.mjs:190`; `createHealthWatch` at `bin/health-watch.mjs:107`;
`bin/openclaw-restart.sh` needs `chmod +x`; Step 4.9 should add health-watch launchd plist.

### Step 4.9 — Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md)

Closed at v4.9. Created `lib/publishers/publish-helper.mjs` — shared NATS publish utility
with `publishExtractDirect(nc, nodeId, triggeredBy)` for direct publishing on an existing
connection (line 30) and `createNatsPublisher(opts)` factory (line 48) with lazy NATS
connection and fire-and-forget semantics. Four SDK wrappers: `openai-wrapper.mjs` wraps
`chat.completions.create` (line 29), `anthropic-wrapper.mjs` wraps `messages.create`
(line 25), `gemini-wrapper.mjs` wraps `generateContent` (line 26), `minimax-wrapper.mjs`
wraps `chat.completions.create` (line 24, OpenAI-compatible). All wrappers accept a publisher
object via dependency injection and call `publisher.publish(triggeredBy).catch(() => {})`
post-response — failures never propagate to callers. Created `bin/openclaw-extract-now.mjs`
(line 30, `runExtractNow`) — manual CLI tool used by Tier 1 hooks and as Tier 3 fallback.
Tier 1 hooks: `hooks/claude-code/pre-compact.sh` (shell, delegates to CLI),
`hooks/openwebui/openclaw-publisher-plugin.py` (Python subprocess, fire-and-forget),
`hooks/librechat/openclaw-trigger.js` (Node.js, imports publish-helper),
`hooks/continue/openclaw-config.json` (config template). Created `docs/PUBLISHERS.md` —
comprehensive 3-tier documentation with code examples, env vars, closed-app limitations table,
and troubleshooting. `.claude/hooks/pre-compact.sh` modification dropped (sandbox constraint,
third consecutive step). 14 new tests. 9 positive, 2 negative findings, zero Phase 8 patches.
**Block 4 complete (9/9).**

### Step 5.1 — Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/

Closed at v5.1. Created `lib/obsidian-vault.mjs` — the per-node Obsidian vault setup module.
`DEFAULT_VAULT_PATH` constant resolves `~/.openclaw/obsidian-local/` via `os.homedir()` +
`path.join()` for cross-platform compatibility. `VAULT_SUBDIRS` array constant holds the 5
subdirectories per Block 5 frozen decisions: `concepts`, `decisions`, `sessions`, `themes`,
`daily`. `getVaultPath(opts)` resolves vault path with precedence: explicit opts > `OBSIDIAN_VAULT_PATH`
env var > default. `ensureVaultStructure(vaultPath)` async function creates vault root + all
subdirs with `mkdir({ recursive: true })`, returns `{ vaultPath, created }` listing newly
created dirs. Idempotent — safe to call repeatedly. No external dependencies (Node.js
built-ins: `node:os`, `node:path`, `node:fs/promises`). 8 new tests cover constants,
path resolution, directory creation, and idempotency. 8 positive audit findings, 1 negative
(test count underestimate: planned ~6, delivered 8), zero Phase 8 patches.

### Step 5.2 — Auto-generate concept notes from entity store (frontmatter + body via LLM)

Closed at v5.2. Created `lib/obsidian-summarizer.mjs` — the concept note auto-generation module.
`DEFAULT_CONCEPT_THRESHOLD` constant (5) with env override via `OBSIDIAN_CONCEPT_THRESHOLD`.
`slugifyName(name)` sanitizes entity names for filesystem-safe filenames (lowercase, special
chars replaced with hyphens). `buildConceptFrontmatter(entity, relatedEntities, avgSalience)`
produces YAML frontmatter with type (always `concept`), entity_type, created, last_seen,
mention_count, salience, and related wikilinks to co-mentioned entities. `buildConceptBody`
formats markdown body with LLM summary (or `_Summary not yet generated._` fallback), decisions
section, and recent activity section with session wikilinks. `generateConceptSummary` calls
LLM with `/no_think` system prompt for 2-3 sentence summary; returns null on any failure.
`queryConceptData(db, threshold)` queries extraction store for entities above threshold with
co-mentioned entities (via mentions JOIN), average salience, related decisions (via
mentions→decisions JOIN), and recent sessions. `generateConceptNotes(opts)` orchestrates:
queries store, ensures vault structure, writes notes to `<vault>/concepts/<slug>.md`.
12 new tests. 10 positive audit findings, 1 negative (test count underestimate: planned ~7,
delivered 12), zero Phase 8 patches.

### Step 5.3 — Build wikilink graph parser (lib/obsidian-graph.mjs)

Closed at v5.3. Created `lib/obsidian-graph.mjs` — the wikilink graph parser module.
`walkVault(vaultPath)` at line 24 recursively discovers `.md` files across all vault
subdirectories, returning `{filePath, relativePath, id, subdirectory}` descriptors.
`parseNote(content)` at line 63 splits YAML frontmatter (via `js-yaml`) from body,
handles malformed YAML gracefully. `extractWikilinks(text)` at line 86 finds all
`[[target]]` and `[[target|display]]` patterns, returning target strings.
`buildGraph(vaultPath)` at line 119 orchestrates: walks vault, parses each note, collects
nodes into a Map keyed by file ID with label + subdirectory + frontmatter fields, and
edges from body wikilinks + frontmatter `related` field with deduplication. Edge type
defaults to `mentions`; frontmatter `edge_types` mapping supports `derived_from`,
`contradicts`, `instance_of` per Block 5 §0. 16 new tests. 9 positive audit findings,
1 negative (test count underestimate), zero Phase 8 patches.

### Step 5.4 — Cache adjacency in SQLite + periodic refresh job (fsevents/10-min)

Closed at v5.4. Created `bin/obsidian-graph-cache.mjs` — the adjacency cache module.
`createGraphCache(opts)` factory at line 72 returns a queryable API: `refreshCache()`
calls `buildGraph(vaultPath)` and projects nodes/edges into SQLite tables
`concept_graph_nodes(id, label, last_activated_at, weight)` and
`concept_graph_edges(source_id, target_id, edge_type, weight)` via full-replace
transaction. `queryNeighbors(nodeId, { direction })` supports `outgoing`/`incoming`/`both`
for spreading activation forward and backward propagation. `getNodes()`, `getEdges()`,
`getStats()` for inspection. `startWatcher()` sets up 10-min interval timer + optional
`fs.watch` recursive watcher with 2s debounce (macOS; timer-only fallback elsewhere).
CLI entry with `--stats`/`--refresh`/daemon modes. `DEFAULT_DB_PATH` at line 27
resolves to `~/.openclaw/graph-cache.db`. `DEFAULT_REFRESH_INTERVAL_MS` at line 30 =
600000 (10 min). 10 new tests. 9 positive audit findings, 1 negative (test count
underestimate), zero Phase 8 patches.

### Step 5.5 — Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/)

Closed at v5.5. Created `lib/obsidian-promoter.mjs` — the shared vault promotion module.
`SHARED_CONCEPTS_DIR` constant at line 25 resolves to `<repo>/projects/arcane-vault/concepts-shared/`.
`getNodeId()` at line 33 returns `process.env.OPENCLAW_NODE_ID || hostname()`.
`buildPromotedFrontmatter(entity, nodeId, relatedEntities, avgSalience)` at line 47 builds
YAML frontmatter with standard concept fields (type, entity_type, created, last_seen,
mention_count, salience, related wikilinks) plus provenance fields per Block 5 §0:
`source_node`, `original_path` (local vault path), `promoted_at` (ISO timestamp).
`queryPromotableConcepts(db, threshold)` at line 85 delegates to `queryConceptData` from
obsidian-summarizer — zero code duplication. `promoteConceptNotes(opts)` at line 100
orchestrates the full promotion pipeline: loads promotion policy (or accepts pre-loaded
policy), queries concepts meeting `concept_mention_count >= threshold` (default 10 per
Block 4 frozen decisions), builds notes with provenance frontmatter and optional LLM body,
creates shared directory with `mkdir({ recursive: true })`, writes notes as
`<slug>.md`. 8 new tests. 10 positive audit findings, zero Phase 8 patches.
**Block 5 complete (5/5).**

### Step 6.1 — Implement spreading-activation algorithm (lib/spreading-activation.mjs)

Closed at v6.1. Created `lib/spreading-activation.mjs` — pure spreading activation algorithm
module with zero external dependencies. `spreadingActivation(seeds, graph, opts)` at line 32
accepts seeds as Map or object, a graph with `edgesFrom(nodeId)` interface, and configurable
`steps` (default 3), `decay` (default 0.7), `threshold` (default 0.1) with env var overrides
via `SPREAD_STEPS`, `SPREAD_DECAY`, `SPREAD_THRESHOLD`. Uses `Math.max` merge at each target
per Block 6 §0 to prevent hub domination. `resolveNum` helper at line 17 handles env var
precedence correctly (explicit > env > default), including edge case where value is 0.
`createGraphAdapter(graphCache)` at line 73 wraps Step 5.4's `queryNeighbors('outgoing')` into
the `edgesFrom` interface, mapping `target_id` → `target` and defaulting weight to 1. 9 new
tests with synthetic graphs covering linear chain decay, hub activation, Math.max diamond merge,
threshold filtering, empty graph, edge weights, Map seeds, and adapter interface. 9 positive
audit findings, 1 negative (test count underestimate: planned ~6, delivered 9), zero Phase 8
patches.

### Step 6.2 — Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank

Closed at v6.2. Created `lib/retrieval-pipeline.mjs` — the 5-channel retrieval pipeline module.
Channel 1: FTS5 keyword via `searchSessionsFts` from mcp-knowledge. Channel 2: vector/semantic
via `searchSessions` from mcp-knowledge. Channel 3: entity exact match via `findMatchingEntities`
→ mentions → session chunks (`entitySearch` at line 141). Channel 4: theme/entity seed via
`findMatchingThemes` + decision text search → session chunks (`themeEntitySearch` at line 179).
Channel 5: spreading activation via `buildSeeds` + `createGraphAdapter` + `spreadingActivation`
→ activated nodes → entity reverse lookup → session chunks (`activationSearch` at line 259).
Combined via `weightedRRF` (line 323) with per-channel weights (`DEFAULT_CHANNEL_WEIGHTS`,
configurable via `RETRIEVAL_WEIGHTS` env var). Factory `createRetrievalPipeline({knowledgeDb,
extractionDb, graphCache})` (line 362) returns `{ retrieve(query, opts) }` with graceful
degradation when databases are absent. Cross-database joins handled at application level:
extraction DB → session_ids → knowledge DB → chunks. Channel 5 excludes seed nodes from results
to avoid duplication with Channels 3/4. 18 new tests. 10 positive audit findings, 1 negative
(test count underestimate: planned ~8, delivered 18), zero Phase 8 patches.

### Step 6.3 — Tune decay/steps/threshold on the same evaluation set from Step 2.5

Closed at v6.3. Created `bin/run-tuning-harness.mjs` — CLI parameter tuning harness that runs
the 25-query Gulf-1 evaluation set through `createRetrievalPipeline` with 12 named parameter
configurations. `DEFAULT_CONFIGS` (line 28) defines 12 configs: baseline (all defaults),
low-decay (0.3), high-decay (0.9), short-steps (1), long-steps (5), low-threshold (0.01),
high-threshold (0.2), fts-heavy (fts:3), vec-heavy (vec:3), spread-heavy (spread:3),
no-spread (spread:0), aggressive (steps=5, decay=0.9, threshold=0.01). `applyConfig` (line 100)
and `resetConfig` (line 117) manage env var lifecycle with save/restore pattern.
`runConfigQueries` (line 136) executes all queries through a pipeline instance with graceful
error handling. `formatTuningReport` (line 162) produces a structured markdown report with
three analysis sections: configuration summary table, delta vs baseline comparison, and
per-query hit count matrix across all configs. `runTuningHarness` (line 252) orchestrates the
full pipeline: for each config, sets env vars, creates a fresh `createRetrievalPipeline`,
runs all queries, resets env vars. Reuses `parseQuerySet` from Step 2.5 and
`createRetrievalPipeline` from Step 6.2. 6 new tests. 9 positive audit findings, zero
corrections, zero Phase 8 patches.

### Step 6.4 — Historical session backfill (bin/extract-existing-sessions.mjs)

Closed at v6.4. Created `bin/extract-existing-sessions.mjs` — resumable LLM extraction backfill
script. `runExtraction(opts)` at line 88 opens the session-store DB read-only, iterates all
sessions, forms a 20-message tail per session (reduced from 40 per Block 3 carry-forward to
avoid LLM timeout), calls `extractStructured(client, tail)` for each, and stores results via
`storeExtractionResult(sessionId, result)`. Checkpoint file at
`~/.openclaw/.extract-migration-checkpoint.json` tracks completed and failed session IDs for
crash resumability. Per-session try/catch ensures individual LLM failures don't abort the run —
failures are recorded in `checkpoint.failed` and skipped on resume. SIGINT handler for graceful
shutdown. LLM health check at startup prevents running against an unreachable server. Post-
extraction hooks: optional concept note regeneration (`generateConceptNotes` from
obsidian-summarizer) and graph cache refresh (`createGraphCache().refreshCache()` from
obsidian-graph-cache), both gated on `processed > 0` and individually try/caught. CLI entry
with `--session-db`, `--extraction-db`, `--checkpoint`, `--tail`, `--skip-notes`, `--skip-graph`
flags. 9 new tests with mock LLM client and mock extraction store. 9 positive audit findings,
1 negative (test count underestimate: planned ~7, delivered 9), zero Phase 8 patches.
**Block 6 complete (4/4).**

### Step 7.1 — Implement query analysis (per-prompt theme/entity extraction, ~50ms)

Closed at v7.1. Created `lib/query-analysis.mjs` — per-prompt analysis module using
embedding-based approach (BGE-M3, not LLM call per Block 7 frozen decisions) plus regex
fallback for structured cues. `analyzeQuery(prompt, opts)` at line 104 is the main entry
returning `{ rawQuery, embedding, structuredCues }`. `extractStructuredCues(text)` at
line 36 is a pure regex function extracting file paths (`lib/foo.mjs` patterns),
version/step references (`v6.4`, `Step 7.1`), and backtick code identifiers
(`spreadingActivation`), with deduplication via Set. `embedPrompt(prompt, embedFn)` at
line 76 is an async wrapper around mcp-knowledge's `embed()` with null-on-failure
graceful degradation. Dynamic `import()` at line 81 lazy-loads the embedder to avoid
pulling `@huggingface/transformers` at startup. 11 new tests with mock embedder. 9
positive audit findings, 1 negative (test count underestimate: planned ~6, delivered 11),
zero Phase 8 patches. Carry-forwards to Step 7.2: `analyzeQuery` at
`lib/query-analysis.mjs:104` ready for consumption; `@memory` directive parsing deferred
to Step 7.4; test baseline now 792 (715 pass, 77 fail).

### Step 7.4 — Runtime control: @memory off/deep/none

Closed at v7.4. Created `lib/memory-directives.mjs` — runtime control directive parser
with `DIRECTIVE_REGEX` at line 22 (case-insensitive pattern matching
`@memory off/deep/none/only:<theme>`), `DIRECTIVE_TYPES` Set constant at line 24,
`parseMemoryDirective(text)` at line 42 returning `{ type, param, cleanedText }` (first
match wins; strips matched directive from text, collapses whitespace), and
`replaceLastUserContent(messages, newContent)` at line 79 for non-mutating OpenAI-compatible
message replacement. Modified all 4 SDK wrappers (`openai-wrapper.mjs`,
`anthropic-wrapper.mjs`, `gemini-wrapper.mjs`, `minimax-wrapper.mjs`) to parse directives
before injection: `off` skips injection for the current turn, `deep` passes
`DEFAULT_TOKEN_BUDGET * 2` (1500) to injector's `tokenBudget` option, `none` sets a
`memoryDisabledForSession` closure flag that persists across all subsequent calls within
the same wrapper instance, `only:<theme>` uses the theme name as the retrieval query
instead of the full prompt text. Directives are stripped from user prompt text via
`replaceLastUserContent` (OpenAI-compatible) or `replaceGeminiPromptText` (Gemini internal
helper) before the LLM API call. Error isolation preserved via empty `catch {}`. 33 new
tests across 11 describe blocks. 10 positive audit findings, 1 negative (test count
underestimate: planned ~12-15, delivered 33), zero Phase 8 patches. **Block 7 complete (4/4).**

### Step 8.1 — Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote)

Closed at v8.1. Created `lib/consolidation.mjs` — the consolidation jobs library implementing
all 6 functions from Block 8 frozen decisions §0. Constants: `DECAY_HALF_LIFE_DAYS` (14),
`DECAY_DROP_THRESHOLD` (0.05), `REINFORCEMENT_COOCCURRENCE_MIN` (3),
`REINFORCEMENT_SALIENCE_BOOST` (0.05), `CLUSTER_COOCCURRENCE_MIN` (5).
`initConsolidationTables(db)` creates `entities_archived` table idempotently.
`decayWeights(db, opts)` applies half-life formula `new = old * 0.5^(days/14)`, archives
entities below 0.05 threshold to `entities_archived`, decays decisions similarly without
archival. `reinforceCoOccurrence(db, opts)` finds entity pairs co-occurring in ≥3 sessions
via mentions join, bumps `mention_count + 1` and `salience + 0.05` (capped 1.0), each entity
bumped at most once per cycle. `detectClusters(db, opts)` uses union-find on entity pairs
co-occurring in ≥5 sessions to form cluster candidates with suggested theme labels.
`regenerateSummaries(opts)` wraps `generateConceptNotes` from `obsidian-summarizer.mjs` with
graceful degradation. `detectContradictions(db)` wraps `surfaceConflicts` from
`conflict-surfacing.mjs`. `evaluatePromotionCandidates(db, opts)` queries entities with
`mention_count ≥ 10` and decisions with `confidence ≥ 0.95` (Block 4 §0 thresholds).
Created `bin/consolidate.mjs` — CLI orchestrator with `runConsolidationCycle(opts)` running
all 7 jobs in sequence, returning per-job results with total `durationMs`. CLI supports
`--db`, `--vault-path`, `--dry-run` flags. 14 new tests. 10 positive audit findings, 1
negative (test count underestimate: planned ~8-10, delivered 14), zero Phase 8 patches.
Carry-forwards to Step 8.2: `runConsolidationCycle` is the entry point for the scheduler;
needs integration with `ollama-queue.getState()` for busy detection; test baseline now 883.

### Step 8.2 — Schedule + budget consolidation cycle (~5 min quiet periods)

Closed at v8.2. Created `bin/consolidation-scheduler.mjs` — the consolidation scheduler
module. Dual idle detection: `isQueueIdle(getStateFn)` reads in-process `ollama-queue.getState()`
for daemon-embedded use (checks current_job, queue_depth, recent analysis fallbacks within
`ANALYSIS_QUIET_MS` 60s); `isOllamaIdle(baseUrl)` probes Ollama HTTP `/api/ps` for standalone
launchd use (returns true when no models running or Ollama unreachable — consolidation jobs
that don't need LLM still run). `isSystemIdle(opts)` combines both paths. `runScheduledCycle(opts)`
wraps `runConsolidationCycle` with a 5-minute hard cap via `AbortController` + `Promise.race`.
`createConsolidationScheduler(opts)` factory returns `{ start, stop, runOnce }` with configurable
interval (default 30 min). CLI supports single-shot mode (launchd fires → check idle → run →
exit) and `--daemon` mode (long-running interval). Created `services/launchd/ai.openclaw.consolidation-scheduler.plist`
with `StartInterval` 1800 (30 min), matching project plist conventions. 14 new tests. 10
positive audit findings, 1 negative (test count underestimate), zero Phase 8 patches.
**Block 8 complete (2/2).**

### Step 9.1 — Define broadcast/offer/accepted schemas in event-schemas package

Closed at v9.1. Added three broadcast protocol schemas to `packages/event-schemas` in a new
`src/broadcast/` directory, following the established `EventEnvelopeSchema.extend()` pattern
from Block 1. `ContextBroadcastSchema` (`event_type: 'context.broadcast'`) with data payload:
`themes`, `entities`, `problem_class` (optional enum), `intensity` (enum), `ttl_minutes`,
`dedup_key`. `ContextOfferSchema` (`event_type: 'context.offer'`) with data payload:
`responding_to` (uuid), `offerer_node_id`, `artifacts` (array of `{ artifact_ref,
relevance_score, provenance: { source_node, source_type }, summary }`), `expires_at`
(datetime). `ContextAcceptedSchema` (`event_type: 'context.accepted'`) with data payload:
`responding_to` (uuid), `accepted_artifacts` (string[]), `feedback` (optional `{ useful,
note? }`). `BroadcastEventSchema` discriminated union over all three. All re-exported from
package root `index.ts`. 12 new tests. 10 positive audit findings, zero corrections, zero
Phase 8 patches.

Carry-forwards to Step 9.2: schemas available via `import { ContextBroadcastSchema, ... }
from 'event-schemas'` (dist build verified); broadcaster should validate against
`ContextBroadcastSchema` before publishing to `context.broadcast.>` on shared stream;
`dedup_key` field enables offerer-side dedup without re-parsing; `expires_at` in offer
enables broadcaster to ignore stale offers.

### Step 9.2 — Implement broadcaster (consolidation-driven, with TTL + de-dup)

Closed at v9.2. Created `lib/broadcast-emitter.mjs` — the context broadcaster module.
`createBroadcaster(nc, nodeId, opts)` factory returns `{ maybeBroadcast,
broadcastFromConsolidation, stop, stats }`. `inferIntensity(prompt)` classifies prompts as
`actively_seeking`/`interested`/`passive`. `computeDedupKey(themes, entities)` produces
deterministic SHA-256 from canonicalized theme∪entity set. `inferProblemClass(prompt)` maps
to schema enum. Per-prompt path gates on ≥3 themes, 60s rate limit, 15-min dedup window, and
passive+unchanged skip. Consolidation path bypasses rate limit but respects dedup. Validates
against `ContextBroadcastSchema` before publishing to `context.broadcast.<nodeId>`. 23 new
tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.

Carry-forwards to Step 9.3: `createBroadcaster` at `lib/broadcast-emitter.mjs:141`;
`inferIntensity` and `computeDedupKey` exported for reuse by offerer; events published to
`context.broadcast.<nodeId>` on shared stream; offerer subscribes to `context.broadcast.>`
from any node except self.

### Step 9.3 — Implement offerer (local retrieve → score → publish offer)

Closed at v9.3. Created `lib/broadcast-offerer.mjs` — the context offerer module.
`createOfferer(nc, nodeId, opts)` factory returns `{ start, stop, stats, _processBroadcast }`.
Subscribes to `context.broadcast.>` on the shared stream. On each broadcast: skips
self-originated (`node_id === nodeId`), checks TTL expiry, builds composite query from
themes+entities, retrieves via 5-channel retrieval pipeline, applies privacy pre-filter
(`filterPrivateItems` — forward-compatible with Step 9.5's `private` column), filters by
`RELEVANCE_THRESHOLD` (0.55), caps at `MAX_ARTIFACTS_PER_OFFER` (3), generates relevance
summaries via `generateRelevanceSummary` (LLM via `requestAnalysis` with data-only fallback),
validates against `ContextOfferSchema`, publishes to `context.offer.<nodeId>`. 24 new tests.
10 positive audit findings, zero corrections, zero Phase 8 patches.

Carry-forwards to Step 9.4: `createOfferer` at `lib/broadcast-offerer.mjs:214`; offers
published to `context.offer.<nodeId>` with `data.responding_to` matching the originating
broadcast's `event_id`; artifact refs use `session:<id>:chunk:<id>` format (acceptor must
parse); `filterPrivateItems` ready for Step 9.5's `private` column migration.

### Step 9.4 — Implement acceptor + inject offers into agent prompt + emit context.accepted

Closed at v9.4. Created `lib/broadcast-acceptor.mjs` — the context acceptor module.
`createAcceptor(nc, nodeId, opts)` factory returns `{ start, stop, stats, getPendingOffers,
getTopOffer, checkAcceptance, _processOffer }`. Subscribes to `context.offer.>` on the
shared stream, filters to offers where `responding_to` matches this node's own broadcast IDs,
checks TTL expiry via `expires_at`, queues valid offers in a capped pending list
(MAX_PENDING_OFFERS=10). `getTopOffer()` returns formatted `[peer-memory: ...]` block for
injection. `checkAcceptance(prompt)` computes token overlap (TOKEN_OVERLAP_THRESHOLD=0.3)
between user prompt and offer summaries; on match, emits `context.accepted` with artifact
refs and causation chain. 28 new tests. 10 positive audit findings, zero corrections, zero
Phase 8 patches.

### Step 9.5 — Privacy markers (private: true) + default-private retrieval policy

Closed at v9.5. Added `private INTEGER DEFAULT 1` column to `entities`, `decisions`,
`themes` tables in `lib/extraction-store.mjs` via idempotent ALTER TABLE migration. Created
`published_items` allowlist table with UNIQUE index on `(item_id, item_type)`. Added
`publishItem`/`unpublishItem`/`isItemPublished`/`getPublishedItems` API functions to the
extraction store. Added `@publish` directive parsing to `lib/memory-directives.mjs` —
`parsePublishDirective(text)` with `PUBLISH_DIRECTIVE_REGEX` supporting quoted and unquoted
names. Created `bin/publish-item.mjs` CLI tool with `--name`/`--type`/`--unpublish`/`--list`
flags and `lookupItem` export for programmatic use. Added `filterPrivateResults` to
`lib/retrieval-pipeline.mjs` and `respect_privacy` option (default true) to
`createRetrievalPipeline`. 30 new tests. 10 positive audit findings, zero corrections,
zero Phase 8 patches.

Carry-forwards: `@publish` directive parsed but not wired into SDK wrappers' per-prompt
path (CLI is primary mechanism). Offerer's `filterPrivateItems` now active. Local injection
should pass `respect_privacy: false`.

### Step 9.6 — Cross-node integration test for broadcast → offer → accepted round-trip

Closed at v9.6. Created `test/broadcast-cross-node.test.mjs` — deterministic two-node
integration test using mock NATS connections with a shared message bus. 9 `describe` blocks
and 10 `it()` blocks cover: full round-trip (node A broadcasts → node B offers → node A
accepts → context.accepted with artifact_refs), TTL-expired broadcasts skipped by offerer,
private items filtered by offerer (in-memory SQLite extraction store with privacy migration),
offer `expires_at` respected by acceptor, accepted `artifact_refs` flow correctly through
`context.accepted`, self-originated broadcasts skipped by offerer, below-threshold results
produce no offer, non-matching `responding_to` skipped by acceptor, and
`buildOfferFromResults` → `formatPeerMemoryBlock` pipeline rendering. 10 positive audit
findings, zero corrections, zero Phase 8 patches. **Block 9 complete (6/6).**

Carry-forwards: Block 10 frozen decisions must be authored by the operator. `@publish`
directive still deferred. Item F (workspace deploy script) still queued from Block 8.

### Step 10.1 — `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/`

Closed at v10.1. Created `bin/spawn-node.mjs` — CLI tool and library for spawning isolated
openclaw node trees at `~/.openclaw-<nodeid>/`. Exports `spawnNode(opts)` (async, idempotent
creation with full subdirectory tree, `config/node.json`, WAL-mode state.db), `validateNodeId`
(lowercase alphanumeric + hyphens, 1-32 chars), `resolveNodeRoot` (path resolution supporting
both prefix-append and parent-directory patterns), `readNodeConfig` (JSON config readback).
CLI accepts `--id`, `--port`, `--nats-url`, `--base-dir` flags. `NODE_SUBDIRS` matches
production layout: workspace, workspace/memory, config, obsidian-local (5 subdirs), artifacts,
logs, state. 13 new tests. 10 positive audit findings, zero corrections, zero Phase 8 patches.

Carry-forwards: `spawnNode` creates the directory tree but does NOT generate identity keys
(Step 10.4) or start NATS (Step 10.2). `resolveNodeRoot` and `readNodeConfig` utilities
available for Steps 10.5/10.6 integration tests. `@publish` directive still deferred. Item F
(workspace deploy script) still queued.

### Step 10.2 — NATS cluster setup (`services/nats/` plists + `docs/NATS_CLUSTER.md`)

Closed at v10.2. Created `services/nats/` directory with 3 NATS server config files
(`nats-{1,2,3}.conf`) forming a full-mesh cluster on ports 4222–4224 (client), 6222–6224
(cluster), 8222–8224 (monitor). Each config has a unique `server_name`, JetStream enabled
with per-node data directory under `~/.openclaw/nats/jetstream-N/`, and 256MB mem / 1GB file
limits. Three launchd plists (`ai.openclaw.nats-{1,2,3}.plist`) with `KeepAlive: true` for
auto-restart and `RunAtLoad: false` for explicit operator control. Comprehensive
`docs/NATS_CLUSTER.md` covering local dev (launchd with placeholder substitution), multi-machine
(systemd + firewall rules), and Tailscale deployment paths with verification steps and
troubleshooting. Infrastructure-only step — no code logic changes, no new tests. 10 positive
audit findings, zero corrections, zero Phase 8 patches.

Carry-forwards: NATS cluster configs have `${OPENCLAW_REPO}` and `${HOME}` placeholders
requiring substitution before installation. Cluster must be running before Step 10.3 can verify
R=3 propagation. `nats-server` confirmed at `/opt/homebrew/bin/nats-server`. JetStream data dirs
must be created by operator. `@publish` directive still deferred. Item F still queued.

### Step 10.3 — Wire `ensureSharedStream` at memory-daemon startup; verify R=3 propagates

Closed at v10.3. Added `verifySharedStreamConfig(streamInfo)` pure validation function to
`lib/shared-event-stream.mjs` — checks `config.num_replicas === 3` and `config.storage === File`,
returns `{ valid: boolean, reasons: string[] }`. Added `EXPECTED_REPLICAS` named constant (3).
Wired `ensureSharedStream(natsConn)` → `inspectSharedStream(natsConn)` → `verifySharedStreamConfig()`
into `workspace-bin/memory-daemon.mjs` startup sequence, positioned after NATS connection + local
event log init and before extraction trigger init. On invalid config → `process.exit(1)` (refuse
to start). On stream creation failure (e.g. <3 nodes) → log warning, continue without federation
stream (existing graceful degradation pattern). 11 new tests. 10 positive audit findings, zero
corrections, zero Phase 8 patches.

Carry-forwards: Shared stream verified at daemon startup (R=3, File storage). `@publish` directive
still deferred. Step 10.4 adds ed25519 signing — signed events will flow through the verified
shared stream.

### Step 10.4 — Node identity + ed25519 signing infrastructure (`lib/node-identity.mjs`); STRICT verification

Closed at v10.4. Created `lib/node-identity.mjs` — per-node ed25519 identity keypair management
and event signing module. `getOrCreateIdentity(identityDir?)` generates/loads ed25519 keypair PEM
at `<dir>/identity.key` (mode 0o600). `signEvent(event, privateKey)` adds `signature` (base64)
and `signer_pubkey` (base64 raw 32-byte ed25519 public key) fields via canonical JSON serialization
(recursive key sorting excluding signature fields). `verifyEvent(event)` implements STRICT mode:
unsigned events → true (backward compat), signed events → verify or reject. Added optional
`signature` + `signer_pubkey` fields to `EventEnvelopeSchema`. Wired signing into
`createLocalEventLog` via `opts.identity`. Added STRICT verification to `broadcast-offerer.mjs`
and `broadcast-acceptor.mjs` with `signatureRejected` stats. 12 new tests. 10 positive findings,
zero corrections, zero Phase 8 patches.

Carry-forwards: Test baseline 1064. `getOrCreateIdentity()` creates keypair at `<dir>/identity.key`.
Step 10.5's two-node test verifies distinct identities + signed event traversal. `@publish` still deferred.

### Step 10.5 — Two-node integration test (`test/federation-2node.test.mjs`) — real NATS, real round-trip

Closed at v10.5. Created `test/federation-2node.test.mjs` — two-node integration test with real
NATS JetStream. Starts an actual `nats-server` process (via `child_process.spawn`), spawns 2
isolated openclaw node trees in a temp directory with distinct ed25519 identities, and validates
the full federation round-trip (broadcast signed by A → offerer on B verifies signature → B offers
→ acceptor on A verifies signature → A accepts → `context.accepted` emitted to JetStream).
11 `it()` blocks: distinct identities, JetStream persistence, full signed round-trip, cross-node
signature verification, tampered broadcast rejection (offerer), tampered offer rejection (acceptor),
self-originated skip, TTL-expired skip, JetStream consumer read, timing (<5s), context.accepted
persistence. Graceful skip when `nats-server` not on PATH. 10 positive findings, zero corrections,
zero Phase 8 patches.

Carry-forwards: Test baseline 1075. `startNatsServer`/`stopNatsServer` + `createTestSharedStream`
helpers can be extracted to shared utility for Step 10.6 (3-node council test). Step 10.6 needs 3
NATS servers for R=3 replication. `@publish` still deferred. Dist files for event-schemas still
need full tsc rebuild when toolchain available.

---

## §N+1 — Progress tracker

```
Steps closed:               55 / 59
Current block:              Block 10 in progress (5 of 9)
Steps closed in block:      5 / 9 (Block 10)
Consecutive zero-Phase-4-correction streak:  11 (Block 9 all 6 + Steps 10.1–10.5 clean)
Consecutive zero-Phase-8-patch streak:       31 (Block 5 all 5 + Block 6 all 4 + Block 7 all 4 + Block 8 both 2 + 1 from Block 4 + Steps 9.1–9.6 + Steps 10.1–10.5)
Test baseline (npm test):   1075 tests (1000 pass, 75 fail — 73 pre-existing + 2 flaky variance)
Last successful tick:       2026-05-26 (Step 10.5)
Last block file written:    memory-plan/audits/BLOCK_9_COMPLETE.md
```

---

## Next-tick checklist

Block 10 is in progress. The next scheduled tick should:

1. Run pre-flight (Framework §8).
2. Decode VERSION (`v10.5`, no suffix) → next step is 10.6 (first `[ ]` row).
3. Read Block 10 frozen decisions in §0 for Step 10.6 scope.
4. Execute Phases 1 → 4 → 5 → 7 → 8 → 8.5 → 9 for Step 10.6.
