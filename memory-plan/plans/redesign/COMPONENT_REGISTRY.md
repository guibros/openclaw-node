# Component Registry — Current State of ~/.openclaw

**Verified:** 2026-05-27 16:30 Montreal (the AUDIT_2026-05-27.md sweep).
**Decay rule (MASTER_PLAN §4.9):** any specific claim here >14 days old gets re-verified before action.

Each component carries a status block + the gap between current and target. The gap is what feeds INVENTORY.md.

Status legend:
- `LIVE` — running and observably doing its job
- `LIVE-DEGRADED` — running but with a known correctness/freshness issue
- `LIVE-STALE` — code is running but is older than the repo HEAD (deploy gap)
- `INERT` — code exists but doesn't execute (not deployed, not launched, missing dependency)
- `ABSENT` — code does not exist in the relevant tree

---

## Family 1: Memory pipeline

### 1.1 Session ingest (JSONL → state.db)

| | |
|---|---|
| **Status** | LIVE-STALE |
| **Owner file (repo)** | `lib/session-store.mjs`, `lib/transcript-parser.mjs`, `workspace-bin/memory-daemon.mjs` |
| **Owner file (runtime)** | `~/.openclaw/workspace/bin/memory-daemon.mjs` (May 23) + `~/.openclaw/workspace/lib/session-store.mjs` (May 23) |
| **Verified live data** | `state.db` has 230 sessions, 8007 messages; latest JSONL imported within minutes of writing |
| **Watches** | `~/.claude/projects/-Users-moltymac-openclaw-workspace/`, `~/.claude/projects/-Users-moltymac-openclaw/`, `~/.openclaw/agents/main/sessions/` (from `~/.openclaw/config/transcript-sources.json`) |

**Target:** Ingest every turn of every session from all three transcript sources into state.db within seconds. No data loss for sessions caught mid-stream. Tool calls and tool results preserved.

**Gap:**
- `skipIfExists: true` is the default in `importSession()` (line 146 deployed / 153 repo). Sessions caught mid-stream never get their later turns ingested.
- Tool calls + tool results silently dropped by the openclaw-gateway adapter (`transcript-parser.mjs:82-85`) — `GATEWAY_SKIP_TYPES` includes `tool_result`.
- Code is May-23 vintage; the repo's session-store has F-H10 (FTS trigger fix), F-H11 (sanitizer), F-H12 (ON CONFLICT) that aren't deployed.

**Done-criteria for closure:**
- `skipIfExists` default flipped OR append-delta semantics implemented; verified by SQL count growing for an active session as new turns land
- `tool_result` no longer in skip set (or explicitly justified as out-of-scope); verified by query showing tool messages present
- Deployed code matches repo (file mtime + `diff -q` empty)

---

### 1.2 LLM extraction (sessions → entities/themes/mentions/decisions)

| | |
|---|---|
| **Status** | LIVE-DEGRADED |
| **Owner file (repo)** | `lib/extraction-prompt.mjs`, `lib/extraction-schema.mjs`, `lib/extraction-store.mjs`, `lib/pre-compression-flush.mjs` |
| **Owner file (runtime)** | `~/.openclaw/workspace/lib/extraction-{prompt,schema,store}.mjs`, `pre-compression-flush.mjs` (all May 22-23) |
| **Verified live data** | 1039 entities, 615 themes, 2074 mentions, 291 decisions in state.db; latest entity at 2026-05-27T07:14Z |
| **LLM** | Ollama-served, model controlled by `LLM_MODEL` env (default `qwen3:8b`) |

**Target:** Every session that flushes (end-of-session, hook-triggered, or budget-pressure-triggered) produces a structured extraction (entities/themes/mentions/decisions/relationships/friction_signals). Mentions carry `turn_index` so chunk-grain privacy filtering works. Schema validation rate >95%.

**Gap:**
- `mentions.turn_index` always NULL (verified: 2074 rows / 0 with turn_idx). Producer never populates the field (F-Q201/Q301). Privacy filter falls back to session-grain.
- LLM returning extractions missing required arrays (`actions`, `decisions`, `friction_signals`, `relationships`) — Zod rejects, caught silently. Many extractions fail validation. Evidence in `~/.openclaw/workspace/.tmp/memory-daemon.err`.
- Deployed code is pre-F-Q* fixes; the repo's tolerant parser (`coerceExtractionResult`, `extractJsonFromText` from commit `47b6719`) is in the repo but the runtime copy is older.

**Done-criteria for closure:**
- `mentions.turn_index` populated on at least the last-turn-of-tail (cheap, structural) OR via per-turn LLM citation (expensive, correct). Verified: SQL `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h` > 0.
- Extraction success rate >95% on a 10-session sample; verified by running the validation CLI.
- Deployed code matches repo.

---

### 1.3 Memory injection HTTP server (:7893)

| | |
|---|---|
| **Status** | LIVE |
| **Owner file (repo)** | `lib/memory-inject-server.mjs`, `lib/memory-injector.mjs`, `lib/retrieval-pipeline.mjs`, `lib/memory-formatter.mjs`, `lib/memory-directives.mjs` |
| **Owner file (runtime)** | Same paths under `~/.openclaw/workspace/lib/` (May 23) |
| **Verified** | `lsof -iTCP:7893 -sTCP:LISTEN` shows PID 869 listening; `curl :7893/memory/inject` returns HTTP 401 (token required), confirming server is live |
| **Token** | `~/.openclaw/config/memory-injection-token` (`0o600`, 64 bytes, present since May 23) |

**Target:** Any frontend (companion-bridge, SDK wrappers, manual curl) POSTing to `/memory/inject` with a valid token gets a memory block back. Five channels (FTS, vec, entity, theme, spreading-activation) all live. Privacy respected at chunk grain. <500ms p95 latency.

**Gap:**
- Channel 2 (vec) operates on stale `~/.openclaw/workspace/.knowledge.db` (May 22, 74MB) — sessions since then aren't embedded.
- Channel 5 (spreading activation) uses stale `graph-cache.db` (last refreshed 2026-05-25 23:45) — no refresh job running.
- Privacy filter is session-grain (because turn_index is NULL on every mention).
- Recall scoring (`recallScore`) is in the repo with F-N52/F-N54 fixes; deployed copy of `memory-injector.mjs` is pre-fix — scoring is theatrical, not effective.

**Done-criteria for closure:**
- All 5 channels return non-empty for a known-good query; verified via diagnostic CLI.
- knowledge.db incremental indexing running (last_indexed within 1h of latest session).
- graph-cache refresh running (`graph_cache_meta.last_refresh_at` within 1h).
- Deployed code matches repo.

---

### 1.4 Consolidation cycle

| | |
|---|---|
| **Status** | INERT |
| **Owner file (repo)** | `lib/consolidation.mjs`, `bin/consolidate.mjs`, `bin/consolidation-scheduler.mjs`, `services/launchd/ai.openclaw.consolidation-scheduler.plist` |
| **Owner file (runtime)** | NONE — `lib/consolidation.mjs` is not in `~/.openclaw/workspace/lib/`. Plist not installed in `~/Library/LaunchAgents/`. |
| **Verified** | `entities_archived` table absent; no `*consolidation*` matches in `launchctl list`; `~/Library/LaunchAgents/ai.openclaw.consolidation-scheduler.plist` does not exist |

**Target:** Every 30 min during quiet periods, cycle through: decay un-recalled entities (half-life 14d), reinforce co-occurrence ≥3, detect clusters, regenerate summaries, surface contradictions, evaluate promotion candidates. Hard cap 5 min/cycle. Output: `entities_archived` populated, promotion queue file appended, vault notes refreshed.

**Gap:**
- Module not deployed.
- Scheduler plist not installed.
- Even when deployed: `entities_archived` has no reader anywhere (write-only audit).
- Promotion candidates currently dropped — no automated writer to `published_items`.

**Done-criteria for closure:**
- `consolidation.mjs` present in workspace lib + scheduler binary present in workspace bin.
- Plist installed in LaunchAgents + verified loaded (`launchctl list` shows it).
- At least one cycle observed in logs with `entities_archived` writes OR clusters detected.
- Decision made on promotion candidates routing (queue file? auto-publish? drop?).

---

### 1.5 Federation (broadcaster / offerer / acceptor)

| | |
|---|---|
| **Status** | ABSENT (runtime) / LIVE (repo) |
| **Owner file (repo)** | `lib/broadcast-emitter.mjs`, `broadcast-offerer.mjs`, `broadcast-acceptor.mjs`, `node-identity.mjs`, `federation-startup.mjs`, `federation-resilience.mjs`, `bin/openclaw-memory-daemon.mjs` |
| **Owner file (runtime)** | NONE of these files exist in `~/.openclaw/workspace/lib/` or `bin/` |
| **Verified** | `diff -rq lib/ ~/.openclaw/workspace/lib/` — all broadcast/federation files listed under "Only in lib" |
| **Identity** | `~/.openclaw/identity.key` + `identity.pub` present (May 27) — generated by something but unused without deployed federation code |

**Target:** Per-node ed25519 signed broadcasts on context themes. Peers respond with `context.offer` (their relevant local artifacts). Acceptor scores offers, picks best, surfaces via `[peer-memory:]` block in next injection. Strict signature verification. Identity registry persisted at `~/.openclaw/identity-registry.json`. Reinforcement loop closes via `context.accepted`.

**Gap:**
- Entire layer not deployed.
- `bin/openclaw-memory-daemon.mjs` (the federation daemon I built) is in the repo, not launched. Per MASTER_PLAN §4.6 it cannot stay as a parallel implementation — must either be merged into the workspace daemon or deleted.
- NATS server not running locally (`lsof -iTCP:4222` empty); federation needs a NATS cluster.
- Identity registry never built (no `identity-registry.json`).

**Done-criteria for closure:**
- NATS cluster running (single-node minimum for dev; 3-node for R=3 production federation).
- Federation modules deployed to workspace lib.
- Workspace daemon imports + invokes `startFederation` (per MASTER_PLAN §4.6, NOT a sibling daemon).
- `bin/openclaw-memory-daemon.mjs` deleted from repo.
- Identity registry populated; verified by JSON file present + at least 1 trusted peer entry.
- One real cross-node broadcast/offer/accept round-trip observed.

---

### 1.6 Real-time extraction trigger (`mesh.memory.extract_request`)

| | |
|---|---|
| **Status** | LIVE (subscriber) / INERT (broker) |
| **Owner file (repo)** | `lib/extraction-trigger.mjs`, `hooks/claude-code/pre-compact.sh`, `lib/publishers/publish-helper.mjs` |
| **Owner file (runtime)** | `~/.openclaw/workspace/lib/extraction-trigger.mjs` (May 22) — IS deployed |
| **Verified** | Deployed daemon imports + invokes `createExtractionTrigger` at line 1113 |

**Target:** Any LLM frontend can publish `mesh.memory.extract_request` via NATS; the daemon subscribes and runs the flush pipeline. Time-based idle fallback (45 min default) self-publishes if nothing else fires.

**Gap:**
- NATS server not running → no broker → no events delivered → idle timer is the only path that ever fires extraction. (The 1039 entities exist because the idle timer + end-of-session paths DO work without NATS.)
- `.claude/hooks/pre-compact.sh` is a no-op stub from Phase 0.6; the functional version at `hooks/claude-code/pre-compact.sh` is not auto-installed.
- Publisher SDK wrappers (`lib/publishers/*-wrapper.mjs`) not deployed; only the repo has them. Tests use them; nothing in production does.

**Done-criteria for closure:**
- NATS server running locally.
- Publishing a manual extract event via `bin/openclaw-extract-now.mjs` observably triggers a flush within seconds (log line confirms).
- One real frontend hook installed and tested.

---

### 1.7 Local event log + MemoryBudget event emission

| | |
|---|---|
| **Status** | BLOCK 1 COMPLETE (v1.5) — all 4 boundary-event producers wired: `memory.ingested` (3 ingest boundaries), `memory.extracted` (3 flush boundaries), `memory.retrieved` + `memory.injected` (inject server), `memory.error` (7 catch blocks: 3 ingest, 3 extract, 1 retrieve). 8 boundary-event schemas defined + validated. Stream `local-events-daedalus` LIVE with 9 messages. |
| **Owner file (repo)** | `lib/memory-budget.mjs`, `lib/local-event-log.mjs`, `packages/event-schemas/` |
| **Owner file (runtime)** | `~/.openclaw/workspace/lib/memory-budget.mjs`, `local-event-log.mjs` (May 21) |
| **Verified** | Deployed `memory-budget.mjs` calls `eventLog.publishLocal()` at lines 82, 128, 188 (fire-and-forget); daemon connects + creates the stream (0.4) |
| **Storage** | JetStream stream `local-events-daedalus` LIVE (subjects `local.>`, R=1, file-backed under `~/.openclaw/nats/jetstream/`); created 2026-05-29 (0.4). CLI test publish lands. |

**Target:** Every `MemoryBudget.startSession/endSession/addEntry` publishes a signed memory.* event to the per-node JetStream stream `local-events-<NODE_ID>`. The stream is R=1, file-backed, durable. Consolidation + federation observe it (eventually).

**Gap:**
- ~~NATS not running → publishLocal silently fails~~ CLOSED 0.4: local NATS up + daemon connected + `local-events-daedalus` stream live and writable. publishLocal now has a real broker.
- 8 new boundary-event schemas defined (1.1: `memory.ingested`, `memory.extracted`, `memory.retrieved`, `memory.injected`, `memory.synthesized`, `memory.decayed`, `memory.promoted`, `memory.error`) — validated in tests + round-trip against live stream.
- `memory.ingested` producer wired (1.2): `emitIngestEvent()` called at Phase 0 Bootstrap, Phase 2 Throttled Work, and IDLE→ENDED session archive — all 3 ingest boundaries.
- `memory.extracted` producer wired (1.3): `emitExtractEvent()` called at all 3 flush boundaries (ACTIVE→IDLE, IDLE→ENDED, NATS-triggered). Fires only on LLM extractions (mode='llm'), not regex fallback. Carries per-type counts (entities, themes, mentions, decisions) + model + duration_ms.
- `memory.retrieved` + `memory.injected` producers wired (1.4): emitted in `lib/memory-inject-server.mjs` per `/memory/inject` HTTP request. Both share a per-request UUID as `entity_id`. Retrieved carries `query_hash`/`channels_hit`/`results_count`/`duration_ms`; injected carries `request_id`/`token_count`/`blocks_count`/`duration_ms`.
- `memory.error` producer wired (1.5): `emitErrorEvent(boundary, err, sessionId)` in daemon (6 catch blocks: 3 ingest, 3 extract) + `buildMemoryEvent('memory.error', ...)` in inject server (1 catch block: retrieve). Carries `boundary`/`error_code`/`error_message`/`session_id?`.
- 5 of the original 8 memory.* event schemas still have no producer (`turn_recorded`, `concept_mentioned`, `snapshot_taken`, `artifact_attached`, `compaction_triggered`) — separate from the new boundary schemas.
- No reader verifies signatures on local events (F-N17 still open) — signing is security theater on the local path.

**Done-criteria for closure:**
- NATS running + JetStream stream `local-events-<NODE_ID>` exists on disk.
- A test session start produces an observable event in the stream (`nats stream view` shows it).
- Decision on the 5 dead schemas: wire producers OR delete the schemas. Either is fine; ambiguity is not.

---

### 1.8 Memory watcher

| | |
|---|---|
| **Status** | LIVE (v2.3) — core subscribe-and-persist loop with per-op classification (ok/noop/error) + periodic store-health probes running inside the daemon. Durable JetStream consumer `watcher-daedalus` on `local-events-daedalus`, writing per-op JSONL records to `~/.openclaw/watcher.jsonl`. Each event record carries `{ts,op,status,actor,session,duration_ms}`. Health probe records carry `{ts,op:'health.probe',status,stores:{state,knowledge,graph_cache},drift}` every 5 minutes. |
| **Owner file (repo)** | `lib/memory-watcher.mjs` |
| **Owner file (runtime)** | `~/.openclaw/workspace/lib/memory-watcher.mjs` (symlinked to repo) |
| **Verified** | Daemon log: `[watcher] Memory watcher initialized` + `[watcher] health probe: 3 stores checked`; `watcher.jsonl` has event records + health probe records; probe shows state.db sessions=233/entities=1039, knowledge.db session_docs=225, graph-cache nodes=65/edges=317, WAL sizes, drift symlinks=true. |
| **Output** | `~/.openclaw/watcher.jsonl` — one JSON line per memory operation + periodic health probes. |

**Target:** Full observability lens over the memory pipeline — who/where/how/when of every operation, classification (ok/noop/error), health probes, anomaly alerts, mission-control panel.

**Gap:**
- ~~No classification (ok/noop/error)~~ CLOSED 2.2: `classifyStatus()` in `lib/memory-watcher.mjs` classifies each event as ok/noop/error based on output counts. Verified: zero-count extraction → `status:noop`, nonzero → `status:ok`, memory.error → `status:error`.
- ~~No health probes (row counts, WAL size, drift)~~ CLOSED 2.3: `runStoreHealthProbes()` in `lib/memory-watcher.mjs` queries 3 stores readonly every 5 min. Verified: probe output shows row counts, WAL sizes (state=4.3MB, knowledge=4.5MB, graph-cache=32KB), and drift symlinks.
- ~~No API endpoint~~ CLOSED 2.4: `GET /api/watcher` on mission-control (:3000) serves event records + latest health probe from watcher.jsonl. Supports `?limit`, `?status`, `?op` filters. `last_indexed` epoch-ms normalized to ISO in health response.
- ~~No mission-control panel~~ CLOSED 2.5: `/watcher` page at `:3000/watcher` with live stream (SWR 3s poll of `GET /api/watcher`) + silent-failures tab (noop+error filter). Health card shows store metrics + drift. Deployed as file copy to runtime. Verified: HTTP 200, events render, failures populate.
- No anomaly alerts — step 2.6.
- JSONL grows unbounded (no rotation).

---

## Family 2: companion-bridge (the harness)

### 2.1 Companion-bridge HTTP adapter (:8787)

| | |
|---|---|
| **Status** | INERT (currently off) |
| **Owner file** | `~/Documents/openclaw infrastructure/companion-bridge/` (separate repo, npm package `companion-bridge`) |
| **Verified** | `lsof -iTCP:8787 -sTCP:LISTEN` empty; runs on-demand via `npx companion-bridge` |

**Target:** Always-running HTTP server between OpenClaw (or any OpenAI-compatible client) and the upstream LLM. Every prompt: harness.injectRules + harness.injectMemory + contextMgr.wrapPromptWithContext. Survives context-out via session recycling. Reads/writes `.companion-state.md` + daily memory logs.

**Gap:**
- Not running as a daemon. Currently launches per-need. Memory injection works only when bridge is up.
- Hard-rule system (Tier 1/2/3 from `~/.openclaw/harness-rules.json`) functions but is decoupled from memory observations — no feedback loop where memory informs rules or rules surface in memory.

**Done-criteria for closure:**
- Companion-bridge installed as a launchd service with KeepAlive (or equivalent always-on mechanism).
- Probe verifies :8787 responds.
- One end-to-end test: OpenClaw prompt → bridge → memory injection block visible in upstream LLM request.

---

### 2.2 Hard rules (Tier 1/2/3 injection)

| | |
|---|---|
| **Status** | LIVE (when bridge is up) |
| **Owner file** | `companion-bridge/harness.ts`, `~/.openclaw/harness-rules.json` (user-editable, hot-reloadable) |
| **Verified** | File exists (referenced in HANDOFF Part 1); not in this audit's scope |

**Target:** Tier 1 always-inject (max 5 rules), Tier 2 keyword-match inject, Tier 3 regex-validate output. Hot-reloadable. Rules evolve based on observed failures.

**Gap:**
- No integration with memory yet. Rule violations not logged as memory events. Memory observations don't promote into soft rules.
- Out of scope for this round unless explicitly added to SCOPE.md.

---

### 2.3 Context persistence (`.companion-state.md`, `.companion-summary.md`)

| | |
|---|---|
| **Status** | LIVE (daemon-side write); companion-bridge-side reads when running |
| **Owner file (daemon)** | `~/.openclaw/workspace/.daemon-state-<host>.md` (renamed in Phase 0.2 from `.companion-state.md`) |
| **Owner file (bridge)** | `~/.openclaw/workspace/.companion-state.md`, `.companion-summary.md` |
| **Verified** | Daemon writes daemon-state-<host>.md every ~20s (verified in tail of memory-daemon.log: "Companion state updated") |

**Target:** Two distinct files: daemon's snapshot of session state vs. companion-bridge's recovery context. No collision (resolved in Phase 0.2).

**Gap:** None known; this part works.

---

## Family 3: Gateway (external)

### 3.1 ai.openclaw.gateway (PID 858)

| | |
|---|---|
| **Status** | LIVE |
| **Owner file** | external npm package `openclaw@2026.2.15` at `/opt/homebrew/lib/node_modules/openclaw/` |
| **Verified** | `ps -p 858`, plist at `~/Library/LaunchAgents/ai.openclaw.gateway.plist` |
| **Writes** | `~/.openclaw/agents/main/sessions/<uuid>.jsonl` |

**Target:** Runs LLM agents with context; writes session JSONLs that the memory daemon reads. External dependency; we don't modify it.

**Gap:** None we own. Out of scope for this plan.

---

## Family 4: Mesh (cross-node coordination)

### 4.1 Mesh services (5 launchd jobs)

| | |
|---|---|
| **Status** | LIVE |
| **Services** | `ai.openclaw.mesh-task-daemon`, `mesh-bridge`, `mesh-agent`, `mesh-deploy-listener`, `mesh-tool-discord`, `mesh-health-publisher`, `lane-watchdog`, `deploy-listener` |
| **Verified** | All listed in `launchctl list`, status 1 (loaded, not currently executing) |
| **Owner file** | `workspace-bin/mesh-*.mjs`, `bin/mesh*.js` |

**Target:** Kanban events, deploy coordination, Discord tools, health publishing. Cross-node coordination, NOT memory-specific.

**Gap:**
- All mesh subjects need NATS to function. NATS not running.
- Memory daemon's `mesh.memory.compaction_completed` subscription overlaps with mesh subject namespace; clean separation needed eventually.
- Out of scope for memory work unless cross-cutting (e.g., mesh-health-publisher emits health events that memory consolidation could consume).

---

## Family 5: Mission Control

### 5.1 ai.openclaw.mission-control (PID 872)

| | |
|---|---|
| **Status** | LIVE |
| **Owner file** | `~/.openclaw/workspace/projects/mission-control/` (Next.js dev server) |
| **Verified** | PID 872 running `next dev`; reads `.daemon-state-<host>.md` for live session card |
| **Port** | check via lsof — typically 3000 or similar Next.js port |

**Target:** Operations UI showing kanban, daemon health, live session, memory stats, federation peers.

**Gap:** Memory introspection minimal; would benefit from a "what's the memory daemon doing right now" panel that reads from a `bin/openclaw-status.mjs` JSON endpoint (currently broken; introspects the wrong daemon).

---

## Family 6: Storage

### 6.1 Databases on disk

| File | Size | Last write | Tables | Status |
|---|---|---|---|---|
| `~/.openclaw/state.db` | 24 MB | 2026-05-25 18:37 (file mtime; data updates more recently via WAL) | sessions, messages, messages_fts*, entities, themes, mentions, decisions, plus `kanban_*` and `ha_*` (test-only) | LIVE |
| `~/.openclaw/workspace/.knowledge.db` | 74 MB | 2026-05-22 12:58 | session_documents, session_chunks, session_chunk_vectors, session_chunks_fts, documents, chunks, chunk_vectors, meta | LIVE-STALE |
| `~/.openclaw/graph-cache.db` | (small) | 2026-05-25 18:45 | concept_graph_nodes (65), concept_graph_edges (317), graph_cache_meta | LIVE-STALE |
| `~/.openclaw/lcm.db` | (small) | varies | (mesh? out of scope) | unknown scope |
| `~/.openclaw/extraction.db` | — | — | none — extraction tables actually live in `state.db` despite the doc's name | ABSENT (intentional) |
| `~/.openclaw/local-events/` | — | — | (would-be JetStream R=1 data dir) | ABSENT |
| `~/.openclaw/identity-registry.json` | — | — | trust registry | ABSENT |

**Target:** Each DB has WAL + busy_timeout + integrity_check on startup. Schema versioning via `user_version`. Per-DB write-locks via a shared `lib/sqlite-store.mjs` helper. knowledge.db auto-incrementally indexes new sessions. graph-cache.db refreshes on a timer + on filesystem change.

**Gap:**
- No `busy_timeout` on state.db or its extraction tables.
- No schema versioning anywhere (F-Q401).
- No integrity_check on startup.
- knowledge.db never auto-updates (one-shot CLI only).
- graph-cache.db refresh job dormant.
- `local-events/` never created → MemoryBudget events lost.
- `identity-registry.json` never written → federation trust binding inert.

**Done-criteria for closure:**
- Extract shared `lib/sqlite-store.mjs` helper that ALWAYS sets WAL + foreign_keys + busy_timeout + integrity_check on open.
- All 16+ `new Database(...)` call sites routed through the helper.
- knowledge.db incremental indexer running (verified by file mtime within 1h after a session ends).
- graph-cache refresh running (verified by `last_refresh_at` within 1h).

---

## Family 7: Infrastructure

### 7.1 NATS server

| | |
|---|---|
| **Status** | LOCAL NODE RUNNING + DAEMON WIRED (0.3 + 0.4) — single-node, loopback, JetStream on, launchd-managed; `local-events-daedalus` stream live (2026-05-29). |
| **Verified** | `lsof :4222` → `nats-server` on `127.0.0.1:4222` (+ monitor `:8222`); `launchctl list` → `ai.openclaw.nats` live PID; survives `kickstart -k`; `curl :8222/jsz` returns JetStream stats (api lvl 3, max_mem 128MB, max_file 1GB) |
| **Service** | `~/Library/LaunchAgents/ai.openclaw.nats.plist` → `nats-server -c ~/.openclaw/nats/nats.conf`; KeepAlive, RunAtLoad, ThrottleInterval 10; logs `~/.openclaw/nats/nats.{log,err}`; store `~/.openclaw/nats/jetstream/` |
| **Required by** | extraction-trigger (mesh.memory.extract_request), MemoryBudget publishLocal, federation (broadcast/offer/accepted), mesh.* subjects, mesh.memory.compaction_completed |

**Target:** Local NATS server running (single-node dev). For federation: 3-node cluster with R=3. JetStream enabled. `local-events-<NODE_ID>` stream + `OPENCLAW_SHARED` stream both reachable.

**Local vs mesh:** the local node (0.3) is loopback-only and separate from the remote mesh (`OPENCLAW_NATS=nats://100.91.131.61:4222` in `~/.openclaw/openclaw.env`, Tailscale, currently down — the federation layer D4 keeps dormant). The repo `services/nats/` 3-node cluster plists are the G-phase / step 10.2 deliverable, NOT used for local-first; a single loopback node is correct for L0.

**Gap (remaining):**
- ~~`local-events-<NODE_ID>` not created; daemon not wired~~ CLOSED 0.4: daemon plist sets `OPENCLAW_NATS=nats://127.0.0.1:4222` + `OPENCLAW_NODE_ID=daedalus` (highest-priority override, `openclaw.env` untouched); daemon connects and creates `local-events-daedalus`. Boot log: `NATS connected` + `Local event log initialized (stream: local-events-daedalus)`.
- `OPENCLAW_SHARED` (federation, R=3) stays dormant on one node — `Shared stream unavailable (replicas > 1 …) — continuing` (D4, intended). G-phase / 3-node cluster.

**Done-criteria for closure:**
- ~~single NATS server running locally with JetStream enabled~~ ✓ (0.3)
- Both streams (`local-events-<NODE_ID>`, `OPENCLAW_SHARED`) created. (0.4 / G)
- Memory daemon connects on startup (log line confirms). (0.4)
- One memory event observed in `local-events-<NODE_ID>` after a session start. (0.4)

---

### 7.2 launchd plists (the deploy surface)

| Plist | Path in LaunchAgents | Status | Repo source |
|---|---|---|---|
| `ai.openclaw.memory-daemon` | INSTALLED | RUNNING (PID 869) | `services/launchd/ai.openclaw.memory-daemon.plist` |
| `ai.openclaw.gateway` | INSTALLED | RUNNING (PID 858) | (external) |
| `ai.openclaw.mission-control` | INSTALLED | RUNNING (PID 872) | `services/launchd/ai.openclaw.mission-control.plist` |
| `ai.openclaw.consolidation-scheduler` | NOT INSTALLED | INERT | `services/launchd/ai.openclaw.consolidation-scheduler.plist` |
| `ai.openclaw.health-watch` | NOT INSTALLED | INERT | not yet written |
| `ai.openclaw.nats-{1,2,3}` (cluster) | NOT INSTALLED | INERT | `services/nats/` |
| `mesh-*` (5 services) | INSTALLED | RUNNING (loaded) | various |

---

## Family 8: The deploy gap itself

| | |
|---|---|
| **Status** | CODE CLOSED — `lib/` synced (step 0.1) AND daemon binary symlinked + restarted (step 0.2), both 2026-05-28. Running daemon IS repo HEAD. Remaining gap is NATS only (0.3/0.4), not code. |
| **Owner** | symlinks (`lib/` and `bin/memory-daemon.mjs`) — both live links into repo, no drift possible |
| **Last sync** | both live symlinks → repo HEAD; daemon restarted onto repo binary 2026-05-28 16:34 (PID 51216) |
| **Drift** | ZERO for code. `lib/` → repo `lib/` (`diff -rq` empty); `bin/memory-daemon.mjs` → repo `workspace-bin/memory-daemon.mjs` (`readlink` confirms). |
| **0.1 evidence** | `readlink` shows symlink; `diff -rq` empty; better-sqlite3 loads via symlink under daemon node; mcp-knowledge node_modules (580MB) moved into repo `lib/mcp-knowledge/` (gitignored); rollback snapshot at `~/.openclaw/workspace/lib.bak-2026-05-28` |
| **0.2 evidence** | `readlink bin/memory-daemon.mjs` → repo; restart gave new PID 51216 (≠869), executing the symlinked repo file, stable 2:48+ past 10s ThrottleInterval; `:7893` → 401; `.err` frozen at restart instant, zero new error class (one-time old-process teardown `mutex lock failed` aside); rollback binary at `bin/memory-daemon.mjs.bak-2026-05-23` |

**Target:** Either (a) `bin/deploy-to-workspace.sh` exists and is invoked on every commit-to-main, OR (b) `~/.openclaw/workspace/bin/memory-daemon.mjs` and `~/.openclaw/workspace/lib/` are symlinks into the repo (Decision 0c from the audit). Either way: zero drift between repo HEAD and runtime tree.

**Gap:** Currently nothing. This is the single biggest blocker per MASTER_PLAN §4.1 (Code on disk ≠ shipped).

**Done-criteria for closure:**
- Either a deploy script or symlinks in place.
- `diff -rq lib/ ~/.openclaw/workspace/lib/` returns empty (no differences, no "Only in" entries).
- A test commit (e.g., adding a log line) is observable in daemon logs within 60 seconds of restart.

---

## Cross-component issues (no single owner)

These don't fit one component but show up across many:

- **Tool calls + tool results never reach state.db.** Affects ingest, extraction, retrieval, federation. Per-format adapter issue in `transcript-parser.mjs`.
- **No schema versioning anywhere.** Affects every DB. Cross-cutting helper needed (`lib/sqlite-store.mjs`).
- **Atomic-write inconsistency.** 5 different implementations across the repo; only 2 with `fsync`. Cross-cutting helper needed (`lib/atomic-write.mjs` — exists in repo, not deployed).
- **`bin/openclaw-status.mjs` introspects the wrong daemon.** Reports false NOT_WIRED for things that ARE wired in the workspace daemon.
- **`test/wiring-manifest.test.mjs` defends the wrong file.** Tests pass while the wrong daemon is being defended.
- **Memory watcher (the "indispensable debug/QA tool" the operator described) does not exist.** Needs design before code (Decision C in the prior HANDOFF).

---

## How to use this doc

When SCOPE.md gets set, the goal in scope should map to a specific component above. The done-criteria from this doc become (or refine) the done-criteria in SCOPE.md.

When this doc is updated, it's because reality changed (a service started running, a deploy landed, a database was created). Updates land in their own commit with subject `registry: <component> <status-change>`.
