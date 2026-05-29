# OpenClaw Memory System — Architecture Map

**Date:** 2026-05-27
**Purpose:** A grounded, end-to-end map of the memory system as it actually exists at HEAD. Built from three parallel investigations + my own verification of running processes/plists + REFERENCE_PLAN.md as the spec baseline.

**Triggered by:** User callout — "this kind of shitfuck is all over the place with you ... need a really exhaustive mapping of all the memory system." Direct response: stop leaf-fixing, get a global picture.

---

## TL;DR — what changed in this pass

Three findings reframe everything I had been doing in the prior 3 review rounds:

1. **There are TWO memory daemons.** The one I've been auditing and "fixing" for 3 review passes (`bin/openclaw-memory-daemon.mjs`) is **NOT the one that runs in production.** The actually-running daemon is `~/.openclaw/workspace/bin/memory-daemon.mjs` (PID 869, launched by `~/Library/LaunchAgents/ai.openclaw.memory-daemon.plist`), which is a deployed copy of `workspace-bin/memory-daemon.mjs`. Verified via `launchctl list | grep memory` + `ps -p 869 -o command=`.

2. **Many subsystems I called "dead" are actually alive — in the OTHER daemon.** `SessionStore`, `MemoryBudget`, `startInjectionServer`, `createMemoryInjector`, `memory-formatter`, `memory-directives`, `injection-logger` — all instantiated by `workspace-bin/memory-daemon.mjs` (lines 84, 381, 1191-1192). My STUB_AUDIT marked them "dead in production" — that's wrong; they're dead **only in `bin/openclaw-memory-daemon.mjs`** because that file is not the production daemon.

3. **The spec (REFERENCE_PLAN.md) and the implementation took different paths at Phase 1.** The spec mandates an event-sourced foundation: `MemoryBudget` → `local-event-log` → `memory-promoter` → shared stream → `memory-subscriber` → local projections. The actual implementation **bypasses the event log** and writes directly to `state.db` (via `SessionStore.importSession`) and `extraction.db` (via `extraction-store.storeExtractionResult`). The Phase 1 schemas + modules exist but aren't on any live path.

What this means for the prior 3 review rounds: most findings are still valid (the F-N* and F-P* fixes addressed real bugs in real code) — but the global picture I was building was wrong about which code actually runs. `bin/openclaw-memory-daemon.mjs` is essentially a re-implementation attempt that never replaced the workspace daemon.

---

## 1. The two-daemon situation

### What's actually deployed (verified 2026-05-27)

```
launchctl list | grep openclaw  →  ai.openclaw.memory-daemon  PID 869
ps -p 869                       →  /Users/moltymac/.openclaw/bin/node
                                   /Users/moltymac/.openclaw/workspace/bin/memory-daemon.mjs
~/Library/LaunchAgents/ai.openclaw.memory-daemon.plist
                                →  ProgramArguments points to workspace path
```

### The two files

| File | Status | What it does |
|---|---|---|
| `workspace-bin/memory-daemon.mjs` (49 510 bytes) | **PRODUCTION** — deployed to `~/.openclaw/workspace/bin/` and launched by launchd | Session state machine (BOOT/ACTIVE/IDLE/ENDED), JSONL → state.db ingest via SessionStore, MemoryBudget instantiation, runFlush calls, HTTP injection server, periodic recap/maintenance |
| `bin/openclaw-memory-daemon.mjs` (NEW, post-F-N1) | **NEVER LAUNCHED** — has a `services/launchd/ai.openclaw.memory-daemon.plist` referencing `${OPENCLAW_WORKSPACE}/bin/memory-daemon.mjs` which RESOLVES to the workspace file, not this one | Federation factories (broadcaster/offerer/acceptor), identity registry, seenIds, consolidation scheduler, real-time extraction trigger, graphCache wiring |

Both have valid implementations. Both share `lib/` modules. The first runs; the second is a parallel daemon that doesn't.

### Why this happened (best reconstruction)

The F-N1 fix (in the follow-up review batch on 2026-05-26) found that `createBroadcaster/createOfferer/createAcceptor` were never instantiated in production. I created `bin/openclaw-memory-daemon.mjs` to instantiate them. I didn't check whether `workspace-bin/memory-daemon.mjs` already existed or was the real production daemon. The plist in `services/launchd/` uses a path that LOOKS like it points to my new daemon but actually resolves to the workspace one because of how `${OPENCLAW_WORKSPACE}` expands.

Net: I built a federation daemon thinking it would replace something, when in fact nothing was replaced, and the existing workspace daemon kept running without federation.

---

## 2. The actual deployed process tree

```
launchd services on this machine:

ai.openclaw.gateway              PID 858
  ↓ binary: /opt/homebrew/lib/node_modules/openclaw/dist/index.js gateway
  ↓ source: SEPARATE NPM PACKAGE (openclaw@2026.2.15) — NOT THIS REPO
  ↓ writes: ~/.openclaw/agents/main/sessions/<uuid>.jsonl

ai.openclaw.memory-daemon        PID 869
  ↓ binary: ~/.openclaw/workspace/bin/memory-daemon.mjs
  ↓ source: deployed copy of workspace-bin/memory-daemon.mjs (THIS REPO)
  ↓ polls: JSONL dirs (gateway + Claude Code), state.db ingest, runFlush, MemoryBudget, HTTP injection server (port 7893)

ai.openclaw.mesh-task-daemon     (mesh coordination — out of memory scope)
ai.openclaw.mesh-bridge          (mesh coordination — out of memory scope)
ai.openclaw.mesh-agent           (mesh coordination — out of memory scope)
ai.openclaw.mesh-health-publisher
ai.openclaw.mesh-deploy-listener
ai.openclaw.mesh-tool-discord
ai.openclaw.lane-watchdog
ai.openclaw.deploy-listener

NOT LAUNCHED — exist as plists/files but no launchd service references them:
  ai.openclaw.consolidation-scheduler  (plist exists; daemon also runs in-process)
  bin/openclaw-memory-daemon.mjs       (no service references it)
  bin/memory-promoter.mjs              (listed in openclaw-restart.sh as "unmanaged"; nothing starts it)
  bin/memory-subscriber.mjs            (no service; daemon-mode dead)
  bin/health-watch.mjs                 (no service)
  bin/dogfood-council.mjs              (no service)

External processes that feed data in:
  Anthropic Claude.app                 PID 583 (writes ~/.claude/projects/*/*.jsonl)
  Ollama                               (LLM)
  NATS server                          (federation event bus)
```

### Configuration that resolves into the production path

| Env var | Default | Resolves to |
|---|---|---|
| `OPENCLAW_WORKSPACE` | unset | `~/.openclaw/workspace` |
| Plist `ProgramArguments[1]` | `/Users/moltymac/.openclaw/workspace/bin/memory-daemon.mjs` | the workspace daemon, fixed |
| `OPENCLAW_HOME` | unset | `~/.openclaw` |
| `OPENCLAW_NODE_ID` | unset | `os.hostname()` sanitized (post-F-Q101) |
| `~/.openclaw/config/transcript-sources.json` | n/a | 3 sources: claude-code-workspace, claude-code-repo, gateway |

---

## 3. Spec vs Reality alignment

REFERENCE_PLAN.md describes 10 phases (0-9). Status of each:

| Phase | Spec intent | Implementation status |
|---|---|---|
| **0 Stop the bleeding** | Wire `MemoryBudget.reload()`, fix mergeFacts, include assistant role, etc. | Partial. Some fixes landed in workspace daemon; some still open. |
| **1 Schema & event foundations** | Build event-sourced foundation: schema package, `local-event-log`, `MemoryBudget.publishLocal` calls, artifact store, shared JetStream cluster | **BYPASSED.** Schema package exists (`packages/event-schemas`). `local-event-log.mjs` exists. `MemoryBudget` exists. **None are wired into the live data path** — daemon writes directly to state.db/extraction.db instead. Shared stream exists. Artifact store exists. |
| **2 Local semantic layer** | sqlite-vec + BGE-M3 embeddings + hybrid search | **LIVE.** `lib/mcp-knowledge/core.mjs` has it; `bin/embed-existing-sessions.mjs` writes `knowledge.db`. Channel 2 of retrieval is live. |
| **3 LLM-driven extraction** | Replace regex with structured Zod-validated LLM extraction | **LIVE.** `lib/extraction-prompt.mjs`, `lib/extraction-store.mjs`. |
| **4 Federation primitives** | Promoter + subscriber bridges to shared cluster, provenance fields | **DEAD on the workspace daemon.** `bin/memory-promoter.mjs` exists, never launched. `bin/memory-subscriber.mjs` exists, never launched. Provenance columns added (F-C15). `bin/openclaw-memory-daemon.mjs` would wire some of this but isn't launched. |
| **5 Thematic substrate** | Obsidian vault, wikilink graph, adjacency cache | **PARTIALLY LIVE.** `bin/obsidian-graph-cache.mjs` runs in-process inside `bin/openclaw-memory-daemon.mjs` (which isn't launched). The workspace daemon doesn't wire it. So graph cache isn't running. Vault notes generated only by consolidation cycle (if it runs). |
| **6 Spreading activation** | 5-channel pipeline, RRF | **LIVE in code, INERT in deployment.** `lib/spreading-activation.mjs` works post-F-P201. `lib/retrieval-pipeline.mjs` uses it. But channel 5 needs `graphCache` which workspace daemon doesn't construct. |
| **7 Proactive injection** | Per-turn ambient memory in prompts | **LIVE.** Workspace daemon starts `startInjectionServer` (line 1191). Companion-bridge POSTs to it. Publisher wrappers are TEST-ONLY in production — only the HTTP route is real. |
| **8 Consolidation cycle** | Decay, reinforcement, clusters, summaries, contradictions, promotion candidates | **PARTIALLY LIVE.** `bin/consolidation-scheduler.mjs` has a plist (`ai.openclaw.consolidation-scheduler.plist`) with `StartInterval 1800` — but it's UNCLEAR whether it's actually loaded. The same scheduler is ALSO started in-process by `bin/openclaw-memory-daemon.mjs` (which isn't launched). Need to verify. |
| **9 Broadcast protocol** | context.broadcast/offer/accepted | **DEAD in deployment.** Code is correct (we've been hardening it across 3 review rounds), but the daemon that runs it (`bin/openclaw-memory-daemon.mjs`) is not launched. The workspace daemon doesn't import any of `lib/broadcast-*.mjs`. |

**Summary:** the deployed daemon implements Phases 2, 3, 7 (HTTP path), and parts of 8. It does NOT implement Phase 1 (event log), 4 (federation primitives), 5 (graph cache), 6 (Channel 5), or 9 (broadcast). The federation code I've been hardening doesn't run.

---

## 4. End-to-end data flows

### Flow A — Session ingest (JSONL → `state.db`)

Triggered: continuously. The workspace daemon polls JSONL directories.

```
External writers:
  Anthropic Claude.app (PID 583) → ~/.claude/projects/<project>/<session>.jsonl
  openclaw-gateway (PID 858, EXTERNAL npm package) → ~/.openclaw/agents/main/sessions/<session>.jsonl

Workspace daemon polls (workspace-bin/memory-daemon.mjs):
  1. State machine ENDED → BOOT (line 497-509)
     getSessionStore() → new SessionStore() → opens ~/.openclaw/state.db
     For each transcript source in ~/.openclaw/config/transcript-sources.json:
       store.importDirectory(source.path, { source: source.name, format: source.format })
     → calls importSession per JSONL
       → parseJsonlFile (lib/transcript-parser.mjs)
       → INSERT OR REPLACE INTO sessions (lib/session-store.mjs:184)
       → INSERT INTO messages (lib/session-store.mjs:189)
       → FTS5 triggers maintain messages_fts mirror

  2. Phase 2 throttled work (every 10 min, ACTIVE state, lines 710-727)
     Re-walks transcript sources, picks up new JSONLs

  3. End-of-session archive (IDLE → ENDED, lines 921-937)
     store.importSession(currentJsonl, …)
```

**Known data loss:** `importSession` defaults to `skipIfExists: true`. Once a session row exists, later turns appended to its JSONL **never reach state.db**. Sessions caught mid-stream are permanently truncated to whatever was in the JSONL at first import.

**Format-specific drop:** `lib/transcript-parser.mjs:82-85` (openclaw-gateway adapter) silently skips `session`, `model_change`, `thinking_level_change`, `custom`, `queue-operation`, `tool_result` entry types. Tool calls and tool results never reach state.db.

---

### Flow B — Real-time extraction (hook → `extraction.db`)

```
PreCompact hook (.claude/hooks/pre-compact.sh OR hooks/claude-code/pre-compact.sh)
  → bin/openclaw-extract-now.mjs
  → nc.publish('mesh.memory.extract_request', payload)

Subscriber: createExtractionTrigger
  ↑ NEVER WIRED IN WORKSPACE DAEMON (verified by grep)
  ↑ WIRED IN bin/openclaw-memory-daemon.mjs:165-220 (which isn't launched)

→ runFlush(jsonlPath, memoryMdPath, { llmClient, extractionStore })
  → estimateSessionTokens → parseJsonlFile (tail 40 messages)
  → extractStructured(client, tailMessages)
    → Ollama call via ollama-queue.requestExtraction
    → Zod-validated {entities, themes, actions, decisions, friction_signals, relationships}
  → extractionStore.storeExtractionResult(sessionId, result)
    → entities upsert
    → themes upsert
    → mentions INSERT (turn_index ALWAYS NULL — F-Q201/Q301)
    → decisions INSERT
  → extractionStore.generateMemoryContent(2200) → markdown
  → fs.writeFileSync(memoryMdPath, content) → <session>.memory.md
```

**Deployment reality:**
- The PreCompact hook fires. Verified.
- `openclaw-extract-now.mjs` publishes to NATS. Verified.
- **No subscriber.** `createExtractionTrigger` is not invoked anywhere in the deployed daemon.
- Real-time extraction is **broken end-to-end in production.**
- Only backfill via `bin/extract-existing-sessions.mjs` (manual CLI) writes to extraction.db.

---

### Flow C — Memory injection (prompt → memory block → LLM)

Two paths exist; only one is live in deployment.

**Path 1: HTTP (LIVE in workspace daemon)**
```
Frontend (companion-bridge / other) POST → http://127.0.0.1:7893/memory/inject
  → workspace-bin/memory-daemon.mjs:1191 startInjectionServer
  → lib/memory-inject-server.mjs:107 buildHandler
  → parseMemoryDirective(prompt)
  → injector.retrieve(prompt, opts)
    → analyzeQueryWithLlm (LLM call via ollama-queue)
    → pipeline.retrieve (5 channels parallel)
      Channel 1: FTS5 keyword on session_chunks
      Channel 2: vec0 cosine on session_chunk_vectors
      Channel 3: entity exact match → mentions → chunks
      Channel 4: theme + decision LIKE search
      Channel 5: spreading activation → graphCache.queryNeighbors
                  ↑ INERT — workspace daemon doesn't construct graphCache
    → weightedRRF fuse
    → filterPrivateResults (chunk-grain when turn_index present; session-grain fallback per F-Q201)
  → queryRelevantConcepts (extraction.db entities, respectPrivacy=true)
  → queryRelevantDecisions (respectPrivacy=true)
  → curateForRecall (Miller 7±2 + scoring)
  → writeBackReconsolidation (UPDATE entities/decisions salience+last_recalled)
  → format → return JSON {block, analysis, tokens, items}
Caller injects the block into its system message before calling the LLM.
```

**Path 2: SDK wrapper (TEST-ONLY in deployment)**
```
lib/publishers/openai-wrapper.mjs:wrapOpenAI mutates client.chat.completions.create
  → on call: extractLastUserPrompt → parseMemoryDirective
  → injector.retrieve → formatMemoryBlock → injectIntoMessages
  → originalCreate → publisher.publish('openai-wrapper') (fires Flow B subject)
```

All 4 wrappers (openai, anthropic, gemini, minimax) are imported only by tests. No production frontend uses them.

---

### Flow D — Federation broadcast (themes → peers → offers → accept)

```
ENTIRELY DEAD in deployment. Code path:
  broadcaster.maybeBroadcast → publishBroadcast → js.publish 'context.broadcast.<nodeId>'
  peer offerer subscribes, runs retrieve, publishes 'context.offer.<nodeId>'
  my acceptor subscribes, checks ownBroadcastIds, publishes 'context.accepted.<nodeId>'
  ??? subscribes to 'context.accepted.<nodeId>'
       ↑ NOTHING. The reinforcement loop documented in REFERENCE_PLAN Phase 9.4 has no consumer.

Why dead in deployment:
  - The factories (createBroadcaster/Offerer/Acceptor) are only called from
    bin/openclaw-memory-daemon.mjs (which isn't launched) and tests.
  - The workspace daemon does not import any lib/broadcast-*.mjs file.
```

---

### Flow E — Consolidation cycle

```
Scheduler trigger (two paths, ambiguous which is live):

  Path E1: launchd plist
    services/launchd/ai.openclaw.consolidation-scheduler.plist
    StartInterval = 1800 (30 min)
    ProgramArguments: node bin/consolidation-scheduler.mjs --once
    UNVERIFIED whether this plist is actually loaded (launchctl list didn't show it
    in the production sweep — but the user may have it loaded under a non-system
    domain we didn't check)

  Path E2: in-process inside bin/openclaw-memory-daemon.mjs
    Constructed at line 225, started with setInterval (30 min)
    But this daemon isn't launched. Dead in deployment.

Cycle steps (lib/consolidation.mjs):
  1. initConsolidationTables (creates entities_archived)
  2. decayWeights (salience × 0.5^(days/14); below 0.05 → archive)
  3. reinforceCoOccurrence (entities co-occurring in ≥3 sessions get +salience)
  4. detectClusters (union-find on co-occurrence)
  5. regenerateSummaries → generateConceptNotes → write vault .md files
  6. detectContradictions (MISNAMED — flags provenance mixing, not actual contradictions, per F-P202)
  7. evaluatePromotionCandidates → returns {entityCandidates, decisionCandidates}
     ↑ Output is dropped. No automated path moves candidates into published_items.

Hard cap (5 min), aborts via AbortSignal, F-N100 propagation, F-P208 mid-loop fix.
```

**Conclusion:** consolidation may run via the standalone plist (need to verify), but if it does, its `entities_archived` writes go nowhere readable, and its promotion candidates go nowhere automated.

---

### Flow F — Vault generation

Only invoked via Flow E step 5. No standalone trigger. If consolidation doesn't run, no vault notes get generated.

---

### Flow G — Knowledge indexing (sessions → `knowledge.db`)

```
Trigger: ONLY bin/embed-existing-sessions.mjs (manual CLI)
  → opens state.db read-only
  → for each session: chunks turns into semantic units
  → calls Ollama BGE-M3 to embed
  → INSERT INTO session_documents, session_chunks, session_chunk_vectors

After this runs, retrieval channels 1 (FTS5) + 2 (vec) have data.

Without it, both channels return zero results.
```

**Cadence:** one-shot, operator-initiated. No automatic refresh as new sessions arrive.

---

## 5. Storage map

### Database files

| File | Path | Tables |
|---|---|---|
| `state.db` | `~/.openclaw/state.db` | **3 unrelated subsystems share this one file:** sessions+messages+messages_fts (session-store), kanban_* (kanban-store; test-only), hyperagent_* (hyperagent-store; test-only). Whoever opens first sets pragmas. |
| `extraction.db` | `~/.openclaw/extraction.db` | entities, themes, mentions, decisions, published_items, entities_archived |
| `knowledge.db` | `~/.openclaw/knowledge.db` or `${KNOWLEDGE_ROOT}/.knowledge.db` | documents, chunks, chunk_vectors, meta, session_documents, session_chunks, session_chunk_vectors, session_chunks_fts |
| `graph-cache.db` | `~/.openclaw/graph-cache.db` | concept_graph_nodes, concept_graph_edges, graph_cache_meta |
| JetStream files | `~/.openclaw/local-events/` (R=1 local) + NATS server's data dir (R=3 shared) | streams: `local-events-<nodeId>`, `OPENCLAW_SHARED` |
| `identity-registry.json` | `~/.openclaw/identity-registry.json` | JSON `{nodeId: {pubkey, source}}` |
| `identity.key/.pub` | `~/.openclaw/identity.key`, `.pub` | ed25519 keypair PEMs |
| `memory-injection-token` | `~/.openclaw/config/memory-injection-token` | 32-byte hex auth token (0o600) |
| Injection log JSONL | `INJECTION_LOG_PATH` env-driven | per-injection records, rotated |

### Per-table writers/readers (live subset)

**`extraction.db`:**

| Table | Writers | Readers | Notes |
|---|---|---|---|
| `entities` | `storeExtractionResult` upserts (live); `decayWeights` UPDATE/DELETE (only if consolidation runs); `writeBackReconsolidation` (live via inject-server); `publishItem` (manual CLI) | `queryRelevantConcepts`, retrieval-pipeline channels 3/4/5, `queryConceptData` (consolidation), `evaluatePromotionCandidates` (consolidation), `filterPrivateResults` | Live |
| `themes` | `storeExtractionResult` upserts | `findMatchingThemes`, retrieval channels 4/5 | Live |
| `mentions` | `storeExtractionResult` INSERT (**turn_index always null — F-Q201**) | retrieval channels 3/4/5, `queryRelevantConcepts` subquery, `filterPrivateResults` | Live but turn_index gap breaks chunk-grain privacy |
| `decisions` | `storeExtractionResult` INSERT; `decayWeights` UPDATE; `writeBackReconsolidation` UPDATE; `publishItem` UPDATE | `queryRelevantDecisions`, `themeEntitySearch`, `evaluatePromotionCandidates` | Live |
| `published_items` | `extractionStore.publishItem` (only caller: `bin/publish-item.mjs` manual CLI) | `evaluatePromotionCandidates` LEFT JOIN; `bin/publish-item.mjs` | Operator-driven only |
| `entities_archived` | `decayWeights` INSERT OR REPLACE | **NO READER** | Write-only audit; F-N154 |

**`state.db`:**

| Table | Writers | Readers |
|---|---|---|
| `sessions` | `SessionStore.importSession` (workspace daemon) | session-search CLI, backfill scripts (direct SQL) |
| `messages` | `SessionStore.importSession` | session-search, backfill scripts |
| `messages_fts` | triggers from `messages` table | `SessionStore.search` |
| `kanban_*` (multiple) | `createKanbanStore` (**test-only**) | (test-only) |
| `hyperagent_*` (5 tables: ha_telemetry, ha_strategies, ha_reflections, ha_proposals, ha_telemetry_proposals) | `HyperAgentStore` (**test-only**) | (test-only) |

**`knowledge.db`:**

| Table | Writers | Readers |
|---|---|---|
| `documents`, `chunks`, `chunk_vectors`, `meta` | indexer in `lib/mcp-knowledge/core.mjs` (when MCP server runs) | knowledge MCP server |
| `session_documents`, `session_chunks`, `session_chunk_vectors`, `session_chunks_fts` | `bin/embed-existing-sessions.mjs` (manual CLI) | retrieval-pipeline channels 1, 2 |

**`graph-cache.db`:**

Written by `bin/obsidian-graph-cache.mjs:refreshCache` (only when started — by `bin/openclaw-memory-daemon.mjs`, which isn't launched). Read by `spreadingActivation` channel 5. **Both ends dead in workspace deployment.**

**Schema versioning:** none. No `user_version`, no `_meta` table. F-Q401 still open.

**Concurrency safety:**
- WAL enabled on extraction.db, session-store side of state.db, knowledge.db, graph-cache.db.
- `busy_timeout = 5000` only on graph-cache.db. Others missing (F-Q403). Concurrent writers can throw `SQLITE_BUSY` (inject-server reconsolidation racing scheduler).

---

## 6. NATS subject inventory

### Live, paired subjects

| Subject | Producer | Consumer | Status |
|---|---|---|---|
| `mesh.memory.extract_request` | `openclaw-extract-now.mjs`, hooks/librechat, publisher-helper, hooks/claude-code/pre-compact.sh (when wired) | `extraction-trigger.mjs` subscribed BY `bin/openclaw-memory-daemon.mjs` | **PAIRED, but consumer dead** because the daemon isn't launched. Hook fires; nothing acts. |
| `mesh.events.>` | `mesh-task-daemon` | `mesh-bridge`, mission-control | Live (mesh scope, not memory) |
| `mesh.tasks.>` | `mesh.js`, `mesh-agent`, `mesh-bridge` | `mesh-task-daemon` | Live (mesh scope) |
| `mesh.deploy.>` | `mesh.js`, `fleet-deploy.js` | `mesh-deploy-listener.js` | Live (mesh scope) |
| `mesh.tool.<nodeId>.<tool>.<method>` | `discord-read.js`, `mesh-registry.js` | `mesh-registry.js` | Live (mesh scope) |

### Dead loops (both ends dead in deployment)

| Subject | Producer side | Consumer side |
|---|---|---|
| `local.>` (stream `local-events-<nodeId>`) | `local-event-log.publishLocal` — only caller is `memory-budget.mjs` which workspace daemon DOES instantiate (line 381) — **AMBIGUOUS, verify** | `memory-promoter.mjs` durable consumer — never launched |
| `mesh.health.alerts` | `bin/health-watch.mjs:68` — never launched | `bin/dogfood-council.mjs:334` — never launched |
| `context.broadcast.>` | `broadcast-emitter.mjs` — wired only by `bin/openclaw-memory-daemon.mjs` (not launched) | `broadcast-offerer.mjs` — same |
| `context.offer.>` | `broadcast-offerer.mjs` — same | `broadcast-acceptor.mjs` — same |
| `context.accepted.>` | `broadcast-acceptor.mjs` — same | **NOTHING.** Even if federation ran, this subject has no consumer; Phase 9.4 reinforcement is unwired by design. |

### Producer-only (events lost)

| Subject | Producer | Why no consumer |
|---|---|---|
| `mesh.health.<nodeId>` | `bin/mesh-node-remove.js:154`, `bin/openclaw-node-init.js:684` | No subscriber in repo or mission-control |
| `mesh.agent.<owner>.stall` | `bin/mesh-task-daemon.js:626` | No agent subscribes |
| `mesh.agent.<owner>.budget_exceeded` | `bin/mesh-task-daemon.js:690` | Same |
| `openclaw.broadcast` | `bin/mesh.js:337` (one-shot CLI) | No subscriber (probably legacy) |

### Consumer-only (idle listeners)

| Subject | Consumer | Status |
|---|---|---|
| `openclaw.*.heartbeat` | `bin/mesh.js:133` (only on `mesh status` invocation) | No producer in repo |
| `openclaw.memory.>` | `workspace-bin/mesh-bridge.mjs:74` | No producer (workspace-only listener with no upstream) |
| `mesh.memory.compaction_completed` | `workspace-bin/memory-daemon.mjs:1108` | No producer in repo |

---

## 7. Dead-end inventory (consolidated)

### A. Dead factories (no production caller; only tests)

| Factory | Module | Notes |
|---|---|---|
| `HyperAgentStore` | `lib/hyperagent-store.mjs:27` | Manages 5 tables; entire subsystem orphan |
| `createKanbanStore` | `lib/kanban-store.mjs:27` | `tasks_observed` table; orphan |
| `publishExtractRequest` | `lib/extraction-trigger.mjs:30` | Duplicate of `publishExtractDirect`; test-only |
| `wrapOpenAI`, `wrapAnthropic`, `wrapGemini`, `wrapMiniMax` | `lib/publishers/*-wrapper.mjs` | All 4 SDK wrappers; test-only |
| `promoteConceptNotes` | `lib/obsidian-promoter.mjs:100` | Whole module orphan |
| `walkVault`, `parseNote`, `extractWikilinks`, `buildGraph` | `lib/obsidian-graph.mjs` | Whole module orphan |
| `loadPromotionPolicy`, `validatePromotionPolicy` | `lib/promotion-policy.mjs` | Only consumers (promoter, obsidian-promoter) are dead |
| `describeConflict`, `findEntityConflicts`, `findDecisionConflicts`, `annotateWithConflicts` | `lib/conflict-surfacing.mjs` | Wrapper `surfaceConflicts` is live; these 4 are dead exports |
| `registerFormat`, `listFormats`, `extractContent` | `lib/transcript-parser.mjs` | Internal-only; no third-party adapter registers |
| `getOrCreateToken` | `lib/memory-inject-server.mjs:52` | Internal helper |
| `parsePublishDirective` | `lib/memory-directives.mjs:93` | Test-only |

### B. Dead by transitive dependency

These factories exist and look reachable, but every real call site is itself dead:

| Factory | Why transitively dead |
|---|---|
| `startInjectionServer` | Only invoked by `workspace-bin/memory-daemon.mjs:1191` — **LIVE in production** (correcting STUB_AUDIT entry) |
| `createMemoryInjector` | Used by inject server (LIVE) and test-only wrappers |
| `formatMemoryBlock`, `injectIntoMessages`, `formatConceptList`, etc. | Used by inject server (LIVE) and wrappers (dead) |
| `logInjection`, `channelStats`, `promptExcerpt`, `getLogPath` | Used by memory-injector (LIVE via inject server) |
| `MemoryBudget`, `createBudget` | Used by `workspace-bin/memory-daemon.mjs:381` — **LIVE in production** (correcting STUB_AUDIT) |
| `SessionStore` | Used by workspace daemon — **LIVE** (correcting STUB_AUDIT) |
| `ensureSharedStream`, `inspectSharedStream` | Only used by dead promoter/subscriber and workspace |
| Health-check helpers | Only consumed by dead `bin/health-watch.mjs` |
| `createKnowledgeEngine`, `startPolling` | Only used by `lib/mcp-knowledge/server.mjs`; the `.mcp.json` at repo root points to a WORKSPACE copy of server.mjs, not this one |
| `TeamsTransport` | Workspace-only |

### C. Idle daemons (process exists, no service starts it)

| Daemon | Notes |
|---|---|
| `bin/health-watch.mjs` | NO plist; only listed in `openclaw-restart.sh` as "unmanaged" |
| `bin/dogfood-council.mjs` | NO plist; pair-dead with health-watch (it subscribes to `mesh.health.alerts` which only health-watch publishes) |
| `bin/memory-subscriber.mjs` | NO plist; standalone never runs; in-process gated by `OPENCLAW_SUBSCRIBER_PROJECTION=stub` which defaults off |
| `bin/memory-promoter.mjs` | Listed unmanaged in `openclaw-restart.sh`; nothing starts it |
| `bin/obsidian-graph-cache.mjs` (standalone path) | In-process path live ONLY in `bin/openclaw-memory-daemon.mjs` which isn't launched |
| `bin/consolidation-scheduler.mjs` | Has plist `ai.openclaw.consolidation-scheduler.plist` with `StartInterval 1800` — **AMBIGUOUS** whether actually loaded |

### D. Dead schemas (no producer)

| Schema | Status |
|---|---|
| `memory.turn_recorded` | Zero producer, zero consumer |
| `memory.concept_mentioned` | Zero producer; `memory-promoter.mjs` would consume (also dead) |
| `memory.snapshot_taken` | Same |
| `memory.artifact_attached` | Zero everything |
| `memory.compaction_triggered` | Zero everything; not even a `.ts` source file (stale dist artifact only) |
| `memory.session_started/ended/fact_extracted` | Producer = `memory-budget.mjs` (LIVE in workspace daemon line 381). Status uncertain — need to verify the workspace daemon actually calls `MemoryBudget.publishLocal`. |

### E. Dead exports inside live modules

Internal helpers exported needlessly (no external caller — just `module.exports` bloat):

- `lib/transcript-parser.mjs` — `registerFormat`, `listFormats`, `extractContent`
- `lib/pre-compression-flush.mjs` — `bigramSimilarity`, `stripSupersedes`, `stripSpeaker`, `truncateAtWord`, `cleanParentheticalChains`
- `lib/memory-injector.mjs` — `estimateTokens`, `recallScore`, `inhibitWithinGroup`, `trimToBudget`, `writeBackReconsolidation`, `formatDegradedWarning`
- `lib/broadcast-emitter.mjs` — `inferIntensity`, `computeDedupKey`, `inferProblemClass`
- `lib/broadcast-acceptor.mjs` — `parseArtifactRef`, `computeTokenOverlap`, `formatPeerMemoryBlock`
- `lib/broadcast-offerer.mjs` — `generateRelevanceSummary`, `buildOfferFromResults`, `filterPrivateItems`
- `lib/extraction-prompt.mjs` — `coerceExtractionResult`, `extractJsonFromText`
- `lib/local-event-log.mjs` — `buildMemoryEvent`
- `lib/node-identity.mjs` — `checkEventFreshness`, `canonicalizeEvent`
- `lib/retrieval-pipeline.mjs` — `findMatchingEntities`, `findMatchingThemes`, `getChunksForSessions`, `entitySearch`, `themeEntitySearch`, `buildSeeds`, `activationSearch`, `weightedRRF`, `filterPrivateResults`, `parseWeights`

### F. Dead hooks / scripts

| File | Status |
|---|---|
| `hooks/claude-code/pre-compact.sh` | Functional; NOT auto-installed by `install.sh` (which only deploys `.claude/hooks/*`); dead unless manually wired |
| `.claude/hooks/pre-compact.sh` | Explicit no-op per Step 0.6 of Phase 0; "retained for future rewiring in Phase 4" |
| `hooks/librechat/openclaw-trigger.js` | Manual-integration module; not auto-installed |
| `hooks/openwebui/openclaw-publisher-plugin.py` | Same |
| `hooks/continue/openclaw-config.json` | Documentation snippet |
| `services/service-manifest.json` | Descriptive metadata; nothing reads it for launching |
| `bin/openclaw-restart.sh` | References dead daemons (memory-promoter, memory-subscriber, health-watch) in UNMANAGED_PROCESSES list |

### G. Tables write-only or unread

| Table | Issue |
|---|---|
| `entities_archived` | Written by `decayWeights`; no reader anywhere (F-N154) |
| `ha_*` (5 tables) | HyperAgentStore is test-only; tables never used in production |
| `tasks_observed` (kanban-store) | KanbanStore is test-only |

---

## 8. Configuration surface (env vars)

26+ env vars read across the codebase. Sample of the consequential ones:

| Var | Default | Effect when changed |
|---|---|---|
| `OPENCLAW_NODE_ID` | hostname sanitized | Federation event signer identity (F-Q101 fix sanitizes) |
| `OPENCLAW_DB_DIR` | `~/.openclaw` | Base path for all DB files |
| `OPENCLAW_KNOWLEDGE_DB` | `<dbDir>/knowledge.db` | Knowledge DB path |
| `OPENCLAW_EXTRACTION_DB` | `<dbDir>/extraction.db` | Extraction DB path |
| `OPENCLAW_WORKSPACE` | (operator-set) | **Critical** — resolves into plist's ProgramArguments to determine which daemon binary actually runs |
| `OPENCLAW_REQUIRE_SIGNED` | `1` | Federation strict mode; tests flip to `0` |
| `OPENCLAW_TRUST_MODE` | `strict` | TOFU vs strict registry mode |
| `OPENCLAW_SUBSCRIBER_PROJECTION` | unset | `stub` enables subscriber in ack-without-project mode |
| `OPENCLAW_BROADCAST_TTL_MIN` | 60 | Federation broadcast TTL |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT`, `LLM_MAX_TOKENS`, `LLM_ANALYSIS_MAX_TOKENS`, `LLM_NATIVE_API`, `LLM_FORCE_FREE_FORM` | various | Ollama integration |
| `OLLAMA_QUEUE_RETRIES`, `OLLAMA_QUEUE_MAX_PENDING`, `SHUTDOWN_GRACE_MS` | various | Queue behavior |
| `INJECTION_TOKEN_BUDGET` | 1500 | Memory injection token cap |
| `RECALL_HALF_LIFE_DAYS` | 14 | Recency decay |
| `RECALL_BOOST` | 1.05 | Reconsolidation salience multiplier |
| `RETRIEVAL_WEIGHTS` | all 1 | Per-channel weight (`fts:N,vec:N,...`) |
| `MEMORY_INJECT_PORT` | 7893 | HTTP server port |
| `USE_LLM_EXTRACTION` | `true` | Falls back to regex when `false` |
| `EXTRACTION_IDLE_THRESHOLD_SEC` | 2700 | Self-trigger interval |
| `CONSOLIDATE_RECENCY_WINDOW_DAYS` | 30 | recency cap for self-joins |
| `CONSOLIDATE_SUMMARY_WAIT_MS` | 12000 | LLM analysis wait-timeout |
| `CONSOLIDATE_MAX_SUMMARIES_PER_CYCLE` | 25 | maxConcepts cap |
| `OBSIDIAN_VAULT_PATH`, `OBSIDIAN_CONCEPT_THRESHOLD` | `~/.openclaw/obsidian-local/`, 5 | Vault location, mention threshold |
| `GRAPH_CACHE_DB_PATH`, `GRAPH_CACHE_INTERVAL_MS` | `~/.openclaw/graph-cache.db`, 600 000 | Cache and refresh interval |
| `KNOWLEDGE_DB`, `KNOWLEDGE_ROOT`, `KNOWLEDGE_MODEL`, `KNOWLEDGE_POLL_MS` | various | Knowledge MCP server settings |
| `PROMOTION_POLICY` | `config/promotion-policy.yaml` | Promoter policy YAML (promoter is dead, so this is unread) |

---

## 9. Contradictions catalog

24 places where intent and code diverge:

1. **Two daemons exist**, the running one is workspace-bin not bin/openclaw-memory-daemon
2. `bin/openclaw-status.mjs` introspects the wrong daemon → reports SessionStore "NOT_WIRED" when it's actually wired in the other daemon
3. `mentions.turn_index` is always null on insert → chunk-grain privacy filter degrades to session-grain (F-Q201/Q301)
4. `actor.type:'peer'` and `entity_type:'broadcast'/'offer'/'accepted'` enum values exist; no producer sets them (F-P413/P414 ineffective)
5. `memory.concept_mentioned.salience` schema field declared, no producer (F-P415)
6. `MemoryEventSchema` discriminated union excludes broadcast schemas (F-P409)
7. `kanban-store`, `hyperagent-store`, and `session-store` all write to `state.db` (no per-domain DB file)
8. `context.accepted` events have no consumer — reinforcement loop open
9. Promotion candidates emitted by consolidation are dropped on the floor
10. `entities_archived` has no reader (write-only)
11. No schema versioning anywhere (F-Q401)
12. `session-store.mjs` and `extraction-store.mjs` lack `busy_timeout` (F-Q403)
13. `detectContradictions` doesn't detect contradictions semantically (F-P202) — flags provenance mixing
14. The launchd plist resolution depends on `OPENCLAW_WORKSPACE` env which is implicit
15. Channel 5 (spreading activation) requires `graphCache` which the production daemon doesn't construct
16. `extractionDb` not threaded into offerer's `peerTracker` — peer dead-detection doesn't accumulate
17. `requestAnalysis` not threaded into offerer — offer-summary LLM always falls back to data-only
18. `local-event-log` signs events but no reader verifies (F-N17/Q418)
19. `consolidation-scheduler` has both a launchd plist AND in-process scheduler → potential double-run
20. `bin/openclaw-restart.sh` references dead daemons as "unmanaged" — gives operator false impression these processes are part of the system
21. `hooks/claude-code/pre-compact.sh` is NOT installed by `install.sh` — install.sh only deploys `.claude/hooks/*` (a different set)
22. 5 of the 8 memory.* event schemas have neither producer nor consumer (turn_recorded, concept_mentioned, snapshot_taken, artifact_attached, compaction_triggered)
23. SessionStore's `importSession` defaults to `skipIfExists: true` — sessions caught mid-stream are permanently truncated
24. The openclaw-gateway (PID 858) is an EXTERNAL global npm package; its source is not in this repo

---

## 10. Architectural decisions needed

These are not "delete or keep" cleanup choices. They are real questions about the system's direction:

### Decision A: Which daemon is the production memory daemon?

**Options:**
- **A1.** `workspace-bin/memory-daemon.mjs` stays the production daemon. The federation/extraction-trigger work in `bin/openclaw-memory-daemon.mjs` gets MERGED into the workspace daemon (substantial work — different code organization, different lifecycle, different dependencies). Federation becomes a feature OF the workspace daemon.
- **A2.** `bin/openclaw-memory-daemon.mjs` becomes the production daemon. The launchd plist gets updated to point to `bin/openclaw-memory-daemon.mjs`. The session-state-machine + ingest logic from workspace-bin gets MERGED into the new daemon. Workspace-bin becomes dead.
- **A3.** Keep both as separate processes. Workspace daemon does session ingest + injection server; new daemon does federation + extraction trigger. Add a SECOND launchd plist for the new daemon. Document the two-daemon architecture explicitly.

**My recommendation**: A3 short-term (lowest disruption, ships federation without breaking ingest), then A1 medium-term (consolidate to one daemon for operational simplicity). But it's your call — A2 is reasonable if you'd rather work from the cleaner federation codebase outward.

### Decision B: Phase 1 — finish or formalize the divergence

The spec mandates event-sourced memory. The implementation skipped it. Choose:

- **B1.** Finish Phase 1 properly. Wire `MemoryBudget.publishLocal` calls. Build the projection layer. Run the local event log as the source of truth. This unlocks Phase 4 (promoter/subscriber as designed) and gives the system the audit trail the spec describes.
- **B2.** Formally declare the spec changed to direct-write. Remove `local-event-log.mjs`, `memory-budget.mjs`, the 5 dead memory.* schemas, and `memory-promoter.mjs`. Update REFERENCE_PLAN.md to reflect the actual architecture.

**My recommendation**: B1 if you value the audit log and the memory-watcher concept you described (debug/QA tool needs an event stream). B2 if you'd rather have a leaner codebase that matches reality.

### Decision C: Federation reinforcement loop (context.accepted)

The acceptor publishes `context.accepted` events. Nothing consumes them. The spec (Phase 9.4) says this should feed back into the offerer for relevance reinforcement.

- **C1.** Build the consumer. Offerers subscribe to `context.accepted` and adjust their thresholds/weights based on acceptance rate. Closes the loop.
- **C2.** Drop the publish. The acceptor publishes are useless without a consumer.

**My recommendation**: C2 short-term (stop emitting dead events), revisit when consolidation feedback features are wanted.

### Decision D: Promotion candidates

Consolidation produces them; nothing automates them into `published_items`.

- **D1.** Build an auto-promoter that takes candidates above a confidence threshold and inserts them into `published_items`. Operator can still manually publish via CLI.
- **D2.** Make consolidation's promotion-candidates output write a single review file (`~/.openclaw/promotion-queue.md`) for operator review. No automation.
- **D3.** Drop the output. If it's not actionable, stop computing it.

**My recommendation**: D2 (queue file). Promotion is a trust-affecting action; should stay operator-mediated, but the queue surface makes it discoverable rather than dropped.

### Decision E: Dead daemons / dead hooks

- `bin/health-watch.mjs`, `bin/dogfood-council.mjs` — no plist, never launched. Delete the files or build the plists?
- `hooks/claude-code/pre-compact.sh` — NOT installed by `install.sh`. The functional hook is `.claude/hooks/pre-compact.sh` (which is a no-op). Either install the real one or remove it.

### Decision F: knowledge-db indexing — automatic vs manual

Currently `bin/embed-existing-sessions.mjs` is the ONLY way to populate knowledge.db's session tables. As new sessions arrive in state.db, nothing automatically embeds them. Retrieval channels 1+2 see stale data until an operator re-runs the script.

- **F1.** Workspace daemon kicks off incremental embedding as part of its 10-min throttled work.
- **F2.** Document the manual cadence explicitly. Users re-run embed-existing-sessions periodically.

**My recommendation**: F1. Stale retrieval defeats the point.

---

## 11. What I got wrong in prior reviews

To be direct: my 3 prior review rounds + the STUB_AUDIT all assumed `bin/openclaw-memory-daemon.mjs` was the production daemon. That assumption was wrong. Specifically:

- **F-N1 fix** ("wire federation into the daemon") wrote to a daemon that doesn't run. Federation is still inert in production.
- **STUB_AUDIT** flagged `SessionStore`, `MemoryBudget`, `startInjectionServer` as "dead in production" — they're alive in the workspace daemon I didn't know about.
- **`openclaw-status.mjs`** introspects the wrong daemon. Its NOT_WIRED reports for SessionStore are false in the real production daemon.
- **`wiring-manifest.test.mjs`** defends the wrong file's wiring.

What WAS correct across the reviews:
- The code in `lib/` is real, used by both daemons. The F-N* and F-P* fixes for sig integrity, privacy, recall scoring, atomic writes, schema bounds, etc. are real fixes to real code.
- The audit pattern findings (fix-at-leaf, test-mock-masks-production, stub-satisfies-type) are real patterns and the F-Q201 finding (mentions.turn_index always null) is verified and correct.
- The 70+ findings about correctness/security/lifecycle in `lib/` files apply regardless of which daemon is the production one.

What this audit changes about going forward:
- "Production daemon" means `workspace-bin/memory-daemon.mjs` until a Decision A is made.
- The federation wiring work needs to be re-targeted (either merged into workspace-bin or made into a second deployed daemon).
- `openclaw-status.mjs` needs to know about both daemons.
- The wiring-manifest needs entries for both daemons.

---

## 12. Recommended sequencing for next work

In order of leverage:

1. **Make a Decision A.** Without it, every "fix the daemon" change is ambiguous.
2. **Fix `openclaw-status.mjs` and `wiring-manifest.test.mjs`** to introspect the workspace daemon (or both, depending on Decision A).
3. **Verify `consolidation-scheduler.mjs`'s actual launch state** — does the plist load? Is the in-process scheduler also running? If both, fix.
4. **Wire incremental knowledge-db indexing** (Decision F1) — high-value, low-risk; stale retrieval undermines everything else.
5. **Decision B + C + D** can wait but shouldn't drift indefinitely. Each is a few hours of work once decided.
6. **Decision E** is cleanup; do it together with other audits.
7. Continue per-finding remediation on the lib/ code (all F-Q3xx items not yet addressed).

---

## 13. What this doc is, what it isn't

**Is:** an honest map of the system as it actually exists today, with citations. Includes my own errors from prior reviews.

**Isn't:** a fix plan. A recommendation for what to build. A grand redesign. The decisions catalogued above are for you, not me.

The next step is yours: read this, make Decision A first, and I'll do the work that follows from it without inventing new daemons or "fixing" things I haven't verified are reached by the production code path.
