# Memory Redesign — Local-First Plan

**Date:** 2026-05-28. **Status:** PROPOSAL — awaiting operator alignment.
**Derived from:** the 6 decisions in DECISIONS.md (2026-05-28) + DESIGN_INPUTS.md + COMPONENT_REGISTRY.md (current state) + AUDIT_2026-05-27.md (verified truth).

This is a plan, not code. It sequences the work to get the **local** memory system actually running, readable, and observable — federation stays dormant until local is solid (D4). Nothing already built is deleted (D1, D3, D4). Each phase is a future SCOPE.md with runtime-evidence done-criteria.

---

## 0. The shape we're building toward (local)

One daemon (the existing workspace daemon — no parallel daemons, MASTER_PLAN §4.6), doing six jobs, with a seventh watching all of them:

```
                         ┌─────────────────────────────────────────────┐
                         │            MEMORY-WATCHER (D6)               │
                         │  subscribes to event log + instruments every │
                         │  job. who/where/how/when. structured logs.   │
                         │  surfaces silent failures. read-only lens.   │
                         └───────────────▲─────────────────────────────┘
                                         │ events + instrumentation
  JSONL ──► [1 INGEST] ──► state.db ──► [2 EXTRACT] ──► entities/themes/      
                                         mentions/decisions                  
                                              │                              
                                              ▼                              
                              [3 SYNTHESIZE]  (D2: session-end + 30min active)
                                 ├─► MEMORY.md   (structured working memory)  
                                 └─► Obsidian vault (concepts/decisions/      
                                     sessions/themes = the Karpathy wiki)     
                                              │                              
   prompt ──► [5 INJECT :7893] ◄── [4 RETRIEVE 5-channel] ◄── knowledge.db + graph-cache.db
                                                                             
  every job emits ──► [6 EVENT LOG] (D3, local JetStream R=1) ──► watcher + (later) federation
```

Stores (all kept, D1): `state.db` (episodic + entity tables), `knowledge.db` (semantic vec), `graph-cache.db` (thematic index), the Obsidian vault (wiki), the event log (spine). Federation modules stay in the tree, offline (D4).

---

## 1. Phase ordering (local-first)

Rationale: close the gap that makes anything observable (L0), build the spine + the lens first (L1, L2) so every later fix is *seen working*, then repair the engine (L3), then make it produce readable output (L4), then make retrieval fresh (L5), then make it durable (L6). Federation is a separate later track (G).

| Phase | Name | Delivers | Maps to |
|---|---|---|---|
| **L0** | Close the deploy gap + start NATS | repo↔runtime synced; local broker up | AUDIT Decision 0; REGISTRY 7.1, 8 |
| **L1** | Event log as the spine | every memory op emits a signed local event | D3; REGISTRY 1.7 |
| **L2** | Memory-watcher | the observability/debug lens over everything | D6; new component |
| **L3** | Ingest + extraction correctness | no dropped turns/tools; turn_index real; extraction stops failing silently | D-none; REGISTRY 1.1, 1.2 |
| **L4** | Synthesis layer (the wiki) | MEMORY.md + Obsidian vault actually generated, on D2 triggers | D5, D2; REGISTRY 1.4 |
| **L5** | Retrieval freshness | knowledge.db auto-indexes; graph-cache refreshes; 5 channels live | REGISTRY 1.3 |
| **L6** | Health + storage hygiene | no crash-loops; WAL/busy_timeout/schema-version/integrity | DESIGN_INPUTS §5 |
| **G** | Multi-node (LATER) | bring dormant federation online | D3, D4 |

---

## 2. Phase detail

### L0 — Close the deploy gap + start NATS *(prerequisite — ~1hr)*

**Problem (verified):** the running daemon reads `~/.openclaw/workspace/lib/` (May-23 vintage), 4+ days behind the repo. NATS isn't running, so the event log, extract-trigger, and watcher can't function.

**Work:**
- Symlink `~/.openclaw/workspace/lib` → repo `lib/` and the deployed daemon file → `workspace-bin/memory-daemon.mjs` (AUDIT Decision 0c). Eliminates drift permanently — repo IS runtime.
- Start a local NATS server with JetStream (single-node for local; the 3-node cluster is a G-phase concern).
- Restart daemon; confirm it picks up current code.

**Done-evidence:** `diff -rq lib/ ~/.openclaw/workspace/lib/` empty; `lsof :4222` shows nats-server; daemon log shows a line that only current code emits.

**Risk:** symlink means a broken mid-edit file could crash the daemon. Mitigation: the scope-check hook already keeps edits deliberate; daemon has KeepAlive.

### L1 — Event log as the spine *(D3)*

**Goal:** every memory operation publishes a structured, signed event to the per-node JetStream stream `local-events-<nodeId>`. This is the substrate the watcher (L2) reads and federation (G) later promotes from.

**Work:**
- Define the event vocabulary (extends the existing `packages/event-schemas`): `memory.ingested`, `memory.extracted`, `memory.synthesized`, `memory.retrieved`, `memory.injected`, `memory.decayed`, `memory.promoted`, plus `memory.error` for failures.
- Wire `publishLocal()` at every job boundary in the daemon (the existing MemoryBudget hooks are a start; extend to ingest/extract/synthesize/retrieve/inject).
- Verify the stream actually persists on disk (`~/.openclaw/local-events/` exists — currently it does NOT, because NATS is down; L0 fixes that).

**Done-evidence:** trigger a session; `nats stream view local-events-<nodeId>` shows ingest→extract→synthesize events with timestamps.

### L2 — Memory-watcher *(D6 — the lens, built early)*

**Goal:** a device to control, log, and debug the entire memory system. Who/where/how/when of every operation. Surfaces silent failures and nonsense code. Read-only — it observes, never mutates.

**What it watches:**
- The L1 event stream (the happy path: what ran, when, with what result).
- Direct instrumentation at each job: inputs, outputs, durations, and crucially **no-ops** (an extract that produced 0 entities, a retrieve that returned empty, a synthesis that wrote nothing) — the silent failures.
- Store health: row counts, last-write timestamps, WAL size, drift.

**What it produces:**
- Structured logs (JSONL): `{ts, op, actor, session, inputs_summary, outputs_summary, duration_ms, status: ok|noop|error, detail}`.
- A readable surface — a new tab in the workplan-viewer (or a mission-control panel) showing the live operation stream + a "silent failures" view (ops that ran but did nothing).
- Alerts on anomalies: extraction failing validation, synthesis producing empty output, a store not being written when it should.

**Why early:** it's the verification instrument for L3–L6. Every later fix gets confirmed *in the watcher*, not by hope. Directly answers the operator's "avoid silent failure and nonsense code."

**Done-evidence:** induce a known silent failure (e.g. an extraction that returns empty) and confirm the watcher flags it as a `noop`/`error`, with who/where/when.

### L3 — Ingest + extraction correctness

**Fixes (all verified broken in AUDIT):**
- `skipIfExists` default truncates mid-stream sessions → change to append-delta or re-import-on-grow.
- `tool_result` / tool calls dropped by the gateway transcript adapter → stop dropping (or justify).
- `mentions.turn_index` always NULL → populate it (cheap: stamp last-turn-of-tail; or right: per-turn LLM citation).
- Extraction silently failing Zod validation (missing `actions`/`decisions`/etc. arrays) → tolerant coercion (the repo's `coerceExtractionResult` exists; ensure it's the running version post-L0) + the watcher surfaces the failure rate.

**Done-evidence:** watcher shows extraction success-rate >95% on a 10-session sample; `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h` > 0; tool messages present in state.db.

### L4 — Synthesis layer: the Karpathy wiki *(D5, D2 — the readable output)*

**Goal:** make the *already-documented* synthesis actually execute and produce the readable artifacts that replace the lossy daily logs.

**Triggers (D2):** on session-end (event hook) AND every 30 min while a session is active (interval, gated on ACTIVE state).

**Produces:**
- **Structured MEMORY.md** (working memory) — generated from entity/theme/decision tables, not raw text. "Recent decisions: …", "Active concepts: …" (REFERENCE_PLAN Phase 3.3).
- **Obsidian vault wiki** (REFERENCE_PLAN Phase 5) — `concepts/`, `decisions/`, `sessions/`, `themes/` notes with frontmatter + LLM-written synthesis body + `[[wikilinks]]`. This IS the Karpathy layer-2.
- **Consolidation** (Phase 8) — decay, reinforce, cluster, regenerate summaries for changed concepts. Deploy + install the scheduler plist (currently absent).

**Kills the lossy logs:** the repetitive truncated daily logs (OUT_OF_SCOPE 2026-05-27) get replaced by: MEMORY.md (the now-state) + dated session notes in the vault (the what-happened) + concept notes (the synthesis). A real daily/weekly digest is generated from the vault, not from an hourly buffer dump.

**Done-evidence:** end a session → within seconds MEMORY.md updates with structured content AND a `sessions/<date>-<topic>.md` vault note appears with wikilinks; watcher shows the synthesize event; the old hourly-repeat daily log is retired.

### L5 — Retrieval freshness

**Fixes:**
- `knowledge.db` never auto-indexes new sessions → wire incremental embedding into the daemon's throttled work.
- `graph-cache.db` refresh job dormant (36h+ stale) → run it on the synthesis cadence.
- Confirm all 5 retrieval channels return non-empty for a known query (channel 5 needs the graph-cache constructed — currently it isn't in the workspace daemon).

**Done-evidence:** knowledge.db `last_indexed` within 1h of latest session; graph-cache `last_refresh_at` within 1h; diagnostic query hits all 5 channels.

### L6 — Health + storage hygiene *(the scars, DESIGN_INPUTS §5)*

**Fixes:**
- Shared `lib/sqlite-store.mjs` open helper: WAL + foreign_keys + `busy_timeout` + `integrity_check` + `user_version` schema versioning, on every open. Route all `new Database()` sites through it.
- WAL checkpointing on shutdown (the 331 MB bloat scar).
- Health-watch installed + KeepAlive verified; no crash-loops (the 13,834× scar).

**Done-evidence:** every store reports a `user_version`; WAL stays bounded across a day; health-watch surfaces a killed daemon within its interval.

### G — Multi-node (LATER, after local is solid — D3, D4)

Bring the dormant federation online: deploy the broadcast/offerer/acceptor modules, stand up the 3-node NATS cluster, build the identity registry, wire the promoter to read the L1 event log. Out of scope until L0–L6 are done and the local system is observably healthy.

---

## 3. What this plan deliberately does NOT do

- **Doesn't delete anything** (D1, D3, D4). Federation, the 5 stores, the existing modules all stay.
- **Doesn't add a 6th store or a parallel daemon.** Repairs the one daemon; the event log + vault already exist in the design.
- **Doesn't start federation.** Local-first. Federation is Phase G, gated on local health.
- **Doesn't invent a new readable format.** Uses the documented MEMORY.md + vault (D5).

## 4. Open sub-decisions (resolve at each phase's planning, log in DECISIONS.md)

- L2: watcher surface — **RESOLVED 2026-05-28: panel in mission-control** (operator). The live op-stream + silent-failures view lives in the existing operations UI (mission-control, PID 872), not the workplan-viewer.
- L3: turn_index — cheap last-turn stamp vs per-turn LLM citation? (Lean: cheap first, citation later.)
- L4: does the daily/weekly digest get generated by an LLM pass over the vault, or assembled deterministically from session notes? (Lean: deterministic assembly first, LLM polish later.)
- L6: schema-versioning migration strategy for the existing populated stores.

## 5. Sequencing summary

```
L0 (deploy gap + NATS)  →  L1 (event log)  →  L2 (watcher)  →  L3 (ingest/extract fixes)
   →  L4 (synthesis/wiki)  →  L5 (retrieval freshness)  →  L6 (health/hygiene)
   ────────────────────────── local solid ──────────────────────────
   →  G (multi-node / federation online)
```

Each phase = one SCOPE.md, runtime-verified, one focused unit of work. We do them in order, finishing each before the next (MASTER_PLAN §4.4).

---

## How to use this doc

This is the master sequence for the memory redesign. When starting a phase, open a SCOPE.md for it with that phase's done-evidence as the contract. Update COMPONENT_REGISTRY.md as each component moves from INERT/STALE/DEGRADED to LIVE. Log any sub-decision (§4) in DECISIONS.md before acting on it.
