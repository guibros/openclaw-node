# OpenClaw Memory Infrastructure — Handoff for Restart

**Date:** 2026-05-27
**Purpose:** Single source-of-truth for the state of memory work, so you can restart from a clean slate without re-deriving any of it.

This is a **handoff document**, not a fix plan. It captures what YOU built, what I built (and broke), what runs, what doesn't, and what decisions you need to make before any more code lands.

---

## Part 1 — Your architecture (the part you built)

Reconstructed from your description + verified against the files. This is the system as you designed it, before I touched the deeper memory infra.

### 1.1 The five real components

```
USER
  ↓ types in OpenClaw
OPENCLAW (LLM agent platform — separate npm package: /opt/homebrew/lib/node_modules/openclaw/)
  ↓ POST /v1/chat/completions to companion-bridge
COMPANION-BRIDGE  :8787   (~/Documents/openclaw infrastructure/companion-bridge/)
  │ THIS IS YOUR HARNESS — sits between the prompt and the LLM
  ├── harness.injectRules(prompt)       → Tier 1/2/3 hard-rule injection
  ├── harness.injectMemory(prompt)       → HTTP GET 127.0.0.1:7893/memory/inject
  ├── contextMgr.wrapPromptWithContext   → reads .companion-summary.md / .companion-state.md
  ├── shouldRecycleSession + recovery   → context-window survival
  ├── daily-log injection trigger        → memory/YYYY-MM-DD.md
  ↓
THE VIBE COMPANION  :3457  (Anthropic, external)
  ↓
CLAUDE CODE CLI  (Anthropic, external)
  ↓ writes JSONL
~/.openclaw/agents/main/sessions/<session>.jsonl
  ↓
THIS REPO'S DAEMON: workspace-bin/memory-daemon.mjs  (PID 869 on your machine)
  │ polls JSONLs, ingests, serves /memory/inject
```

### 1.2 What each piece does

| Component | Where | Role |
|---|---|---|
| **OpenClaw** | external npm package `openclaw@2026.2.15` at `/opt/homebrew/lib/node_modules/openclaw/`, plus `openclaw-gateway` running as PID 858 | Runs LLM agents with context; restarts on context-out; writes JSONLs |
| **companion-bridge** | `~/Documents/openclaw infrastructure/companion-bridge/` (a separate npm package, published as `companion-bridge`) | The OpenAI-compatible adapter you wrote. Sits between OpenClaw and the LLM. Contains the **harness** (rule + memory injection) and the **context-persistence layer** (summary + state files). The piece that makes context-out survivable. |
| **harness.ts** | `companion-bridge/harness.ts` (340 lines) | Tier 1/2/3 rule injection. Rules live in `~/.openclaw/harness-rules.json` (user-editable, hot-reloadable). Falls back to `companion-bridge/rules/default.json`. |
| **harness-rules.json** | `~/.openclaw/harness-rules.json` | The active rule set on your machine. Tier 1 = always inject, max 5; Tier 2 = inject on keyword match; Tier 3 = regex-validate output. |
| **.companion-state.md / .companion-summary.md** | `~/.openclaw/workspace/` | Your context-persistence files. Written by the CLI under harness instruction; read on session reset to recover context. |
| **memory/YYYY-MM-DD.md** | `~/.openclaw/workspace/memory/` | Your daily memory log structure. Adapter triggers CLI to write to these (every 5 turns or at 70%+ context). |
| **workspace-bin/memory-daemon.mjs** | this repo, deployed to `~/.openclaw/workspace/bin/` | The session-state-machine + JSONL ingest + injection HTTP server. Launched by `ai.openclaw.memory-daemon` plist. |

### 1.3 Your data structures (what runs daily)

```
~/.openclaw/
├── harness-rules.json              ← YOUR HARD RULES (active)
├── harness-rules.json.bak
├── identity.key / identity.pub     ← ed25519 keypair for federation signing
├── identity-registry.json          ← peer trust bindings
├── state.db                        ← sessions + messages (FTS5) — written by workspace daemon
├── extraction.db                   ← entities/themes/mentions/decisions — written by runFlush
├── knowledge.db                    ← session_chunks + BGE-M3 vec0 embeddings — written by backfill scripts only
├── graph-cache.db                  ← Obsidian vault adjacency cache (currently inert, see Part 4)
├── lcm.db                          ← (mesh? need to verify scope)
├── agents/main/sessions/*.jsonl    ← gateway-written transcripts
├── workspace/
│   ├── memory/YYYY-MM-DD.md        ← YOUR daily logs
│   ├── memory/active-tasks.md
│   ├── .companion-state.md          ← YOUR session-state context file
│   ├── .companion-state.md.bak
│   ├── .daemon-state-<host>.md      ← daemon's own state output (renamed in Phase 0.2)
│   ├── CLAUDE.md, AGENTS.md, IDENTITY.md, SOUL.md, PRINCIPLES.md, etc.
│   ├── bin/memory-daemon.mjs       ← THE RUNNING DAEMON (deployed from this repo)
│   ├── lib/                        ← deployed copy of this repo's lib/
│   └── .mcp.json                   ← references workspace lib/mcp-knowledge/server.mjs
├── obsidian-local/                 ← per-node Obsidian vault (per spec Phase 5)
├── jetstream/ (or local-events-<id>/) ← NATS JetStream data
└── config/
    ├── memory-injection-token      ← 32-byte hex for /memory/inject auth (0o600)
    └── transcript-sources.json     ← registry of JSONL source dirs
```

---

## Part 2 — This repo (openclaw-nodedev) and what it contains

`/Users/moltymac/openclaw-nodedev/` is the **memory daemon code + lib/ + supporting tools.** It is NOT companion-bridge (that's a separate repo) and NOT OpenClaw itself.

### 2.1 What was here when I started

The big picture for what existed before my involvement:

- `workspace-bin/memory-daemon.mjs` — your main daemon (session-state-machine, ingest, injection server)
- `lib/session-store.mjs` — sessions + messages + FTS5
- `lib/extraction-store.mjs` — entities/themes/mentions/decisions (with `private` column from F-C15)
- `lib/extraction-prompt.mjs` + `lib/extraction-schema.mjs` — Phase 3 structured extraction
- `lib/memory-injector.mjs` + `lib/memory-formatter.mjs` + `lib/memory-directives.mjs` — Phase 7 injection
- `lib/memory-inject-server.mjs` — the HTTP server companion-bridge calls on port 7893
- `lib/retrieval-pipeline.mjs` — 5-channel retrieval (FTS, vec, entity, theme, spreading-activation)
- `lib/spreading-activation.mjs` + `bin/obsidian-graph-cache.mjs` — Phase 6
- `lib/consolidation.mjs` + `bin/consolidate.mjs` + `bin/consolidation-scheduler.mjs` — Phase 8
- `lib/obsidian-summarizer.mjs` + `lib/obsidian-vault.mjs` — vault note generation
- `lib/broadcast-emitter.mjs` + `-offerer.mjs` + `-acceptor.mjs` — Phase 9 federation protocol
- `lib/node-identity.mjs` — ed25519 signing
- `packages/event-schemas/` — Phase 1 schema package (Zod)
- `lib/memory-budget.mjs` — Phase 1 producer of memory.* events
- `lib/local-event-log.mjs` — Phase 1 signed local stream
- `bin/memory-promoter.mjs` + `bin/memory-subscriber.mjs` — Phase 4 federation bridges
- `lib/ollama-queue.mjs` + `lib/llm-client.mjs` — LLM client + queue with priority/abort
- Plus: many mesh-* coordination files (kanban etc.) that are **out of memory scope**

`memory-plan/REFERENCE_PLAN.md` describes the canonical 10-phase plan. Phases 0-3 + 5-9 are partially implemented; **Phase 1 (event-sourcing foundation) was skipped** in the actual implementation — the system writes directly to extraction-store / session-store instead of going through the event log.

### 2.2 What I did across 3 review rounds + repair (May 26-27)

**Reviewed code = code I touched, NOT necessarily code that runs.** This is the key distinction I missed throughout.

#### Round 1 — Original audit (2026-05-26 AM)

- 4 parallel review agents → 80 findings (17 critical, 25 high, etc.)
- Doc: `memory-plan/CODE_REVIEW_2026-05-26.md` (you already had this)
- I implemented fixes batch-by-batch: privacy, federation auth, queue lifecycle, schema validation, recall scoring, etc.

#### Round 2 — Follow-up audit (2026-05-26 PM)

- 4 more parallel agents → 70 findings (9 critical, 15 high)
- Doc: `memory-plan/CODE_REVIEW_2026-05-26-FOLLOWUP.md`
- I implemented fixes. Most regressions of previously-claimed-fixed items.
- **First instance** of "fix at leaf, not at producer side" (F-N50 privacy filter — opt threaded into helper, retrieve() never passed it).

#### Round 3 — Pass 1 of second-wave review (2026-05-27 AM)

- 4 more agents → 72 findings (5 critical, 17 high)
- Doc: `memory-plan/REVIEW_PASS_1.md`
- Implemented fixes including: hostname sanitization for federation (F-Q101 — would have blocked your Mac from publishing), privacy fail-CLOSED stopgap (F-Q201), shared `atomic-write.mjs` + `concurrency-guard.mjs` helpers.

#### Round 4 — Pass 2 (2026-05-27 mid)

- 4 more agents → 83 findings (9 critical, 22 high)
- Doc: `memory-plan/REVIEW_PASS_2.md`
- **Key finding (F-Q201):** my F-N51 chunk-grain privacy filter is structurally inert because `extraction-store.mjs:264` hard-codes `mentions.turn_index = null`. The fix was at the consumer side but the producer never populates the column.

#### Round 5 — STUB_AUDIT (2026-05-27 late)

- Triggered by your callout. Sweep for dead code.
- Doc: `memory-plan/STUB_AUDIT.md`
- Found 11 dead/inert subsystems. I incorrectly assumed `bin/openclaw-memory-daemon.mjs` was the production daemon and called several alive subsystems "dead."

#### Round 6 — MEMORY_SYSTEM_MAP (2026-05-27 evening)

- 3 parallel investigations + my own verification.
- Doc: `memory-plan/MEMORY_SYSTEM_MAP.md`
- **THE BIG REVELATION:** there are TWO daemons in this repo. The one I'd been fixing across 3 review rounds (`bin/openclaw-memory-daemon.mjs`) is NOT what runs in production. The real production daemon is `workspace-bin/memory-daemon.mjs` (PID 869).
- This means most of my federation/extraction-trigger/graphCache wiring landed in a binary that's never launched.

### 2.3 Why I built `bin/openclaw-memory-daemon.mjs`

During Round 2 (the follow-up audit), one reviewer (F-N1) found that `createBroadcaster/createOfferer/createAcceptor` were never instantiated anywhere outside tests. I assumed there was no production memory daemon and created `bin/openclaw-memory-daemon.mjs` to instantiate them. I did NOT verify whether the existing `workspace-bin/memory-daemon.mjs` was the real production daemon. The plist at `services/launchd/ai.openclaw.memory-daemon.plist` uses `${OPENCLAW_WORKSPACE}/bin/memory-daemon.mjs` which RESOLVES to the workspace daemon — so the file I built was never connected to launchd.

Net: federation is still inert in production despite 3 rounds of "fixing" it.

---

## Part 3 — Versioning: every commit I made

In chronological order, all on `main`, all pushed to `https://github.com/moltyguibros-design/openclaw-node.git`:

| Commit | Summary | Status |
|---|---|---|
| (pre-audit baseline) | The state when I started, with your original architecture | Reference point |
| (multiple early commits) | Initial 80-finding remediation — privacy fixes, queue lifecycle, schema bounds | Mostly correct, applied to lib/ which IS shared between both daemons |
| `8980da0` | F-M6+F-M8+F-M10 (observability + dead-code cleanup) | Correct (lib/) |
| `f65e5a6` | Docs: CODE_REVIEW_2026-05-26-FOLLOWUP.md + TESTING_PROTOCOL.md | Doc-only |
| `3d6502f` | Cluster D privacy fix: F-N50+F-N51+F-N102 | **F-N51 was a leaf-fix (chunk-grain filter); structurally inert per F-Q201 stopgap below.** |
| `dc1ea9a` | Consolidation hard-cap signal + summary fitting (F-N100, F-N101, F-N110) | Correct (lib/ + bin/consolidate.mjs) |
| `e479912` | Acceptor regressions + dedup rollback (F-N4, F-N5, F-N6) | Correct (lib/broadcast-*.mjs) |
| `6bbfc89` | Queue abort cleanup + stuck-detection precision (F-N103, F-N105) | Correct (lib/ollama-queue.mjs) |
| `0e656cd` | Batch HIGH findings (F-N7-9, F-N52-54) | Correct (lib/ + packages/event-schemas/src/) |
| `dd5d508` | F-N104+F-N106+F-N107 (shutdown doc, backfill class, onIngest mandatory) | Correct |
| `5fe83d4` | 61 REORDER_BREAK test fixes | Correct (test/) |
| `f271859` | **F-N1+F-N2+F-N3 federation wiring** — created `bin/openclaw-memory-daemon.mjs` | **DAEMON NOT LAUNCHED. This was my "fix federation" attempt, into a binary nothing runs.** |
| `01c8891` | Docs: REVIEW_PASS_1.md | Doc-only |
| `54e2aca` | Sig integrity batch (F-P401-403 + DoS bounds) | Correct (lib/node-identity.mjs + schemas) |
| `56dea29` | Channel 5 adapter + daemon onIngest stub (F-P201, F-P107) | Channel 5 fix is correct (lib/spreading-activation.mjs); onIngest stub is in the unlaunched daemon |
| `b3b22a6` | Federation+daemon startup robustness (F-P101-106, F-P411) | Most fixes in lib/; daemon changes are in the unlaunched bin/ |
| `1472ea2` | Consolidation perf cliffs (F-P203, F-P206, F-P208, F-P215) | Correct |
| `e098ad0` | Publisher wrapper semantics (F-P301, F-P302) | Wrappers are test-only, so the fix is correct but the wrappers themselves aren't reached in production |
| `79358ba` | Remaining MED/HIGH (F-P209, F-P210, F-P211, F-P212, F-P408) | Correct |
| `9a4396d` | **HOTFIXES: F-Q101 hostname regex + F-Q201 privacy stopgap** | F-Q101 saves you from a Mac-hostname rejection bug; F-Q201 is a stopgap for the F-N51 producer-side gap |
| `ff44988` | Pass-2 batch 1: shared helpers (atomic-write, concurrency-guard) | Correct (lib/) |
| `1f8cba4` | Pass-2 batch 2: 7 HIGH findings | Correct (lib/ + packages/event-schemas/) |
| `c57548f` | Docs: STUB_AUDIT.md | Doc-only |
| `c10d6d4` | bin/openclaw-status.mjs + AST wiring-manifest + graphCache+extractionTrigger wiring | **Wired into the unlaunched daemon. Status CLI introspects wrong daemon.** |
| `4660816` | Docs: MEMORY_SYSTEM_MAP.md | Doc-only |
| (this commit) | Docs: HANDOFF.md | Doc-only |

### 2.3 Summary of where the work actually lives

**Correct fixes in shared code (live in production via workspace daemon's imports):**
- `lib/extraction-store.mjs` — F-C15 privacy migration, F-H12 ON CONFLICT, F-H13 decay FK, F-Q407 created_at index
- `lib/extraction-prompt.mjs` — Phase 3 work, F-Q315 NaN salience
- `lib/memory-injector.mjs` — F-N50 respectPrivacy threading, F-N52 recall read/write alignment, F-N53 themeFilter rewire, F-N54 recallScore hardening
- `lib/memory-formatter.mjs` — F-M10 DRY, F-N57 mode allowlist
- `lib/memory-inject-server.mjs` — F-Q211 atomic token, silent-catch fixes
- `lib/retrieval-pipeline.mjs` — F-N51 chunk-grain (structurally inert per F-Q201), F-Q201 stopgap, F-N62 channel resilience
- `lib/spreading-activation.mjs` — F-P201 adapter shape fix (BUT graphCache not constructed by workspace daemon)
- `lib/consolidation.mjs` + `bin/consolidate.mjs` + `bin/consolidation-scheduler.mjs` — F-N100 hard cap, F-P203 recency cap × 2, F-P208 abort propagation, F-P210 published_items filter, F-P215 stack guard, F-N101 summary fitting
- `lib/obsidian-summarizer.mjs` — F-N102 vault privacy, F-Q205 atomic vault writes, F-P209 wait timeout
- `lib/ollama-queue.mjs` — Cluster B fixes (F-C5/C6/C7), F-N103-105
- `lib/llm-client.mjs` — Cluster B fixes, abort propagation
- `lib/node-identity.mjs` — Cluster A signing/verify/registry, F-N12 (was unfixed, F-P401 fixed it), F-P408 default-strict, F-P411 atomic save
- `lib/atomic-write.mjs` (NEW) — shared atomic write helper
- `lib/concurrency-guard.mjs` (NEW) — shared single-flight helper
- `lib/federation-startup.mjs` (NEW) — federation bootstrap (BUT not imported by workspace daemon)
- `packages/event-schemas/src/envelope.ts` — F-P404-407 DoS bounds, F-Q101 hostname regex (which I had to fix)
- `packages/event-schemas/src/broadcast/*.ts` — F-N9 + F-P402 TTL bounds
- `bin/obsidian-graph-cache.mjs` — F-P206 busy_timeout, F-P216 concurrency guard
- `bin/extract-existing-sessions.mjs` — F-N106 + F-Q303-304 error classification, F-Q313 atomic checkpoint

**Code in daemons that are NOT in production:**
- `bin/openclaw-memory-daemon.mjs` (NEW, 240+ lines) — federation/extraction-trigger/graphCache wiring → **not launched**
- `bin/openclaw-trust-peer.mjs` (NEW) — CLI for federation peer registry → useful regardless of daemon

**Test scaffolding added:**
- `test/wiring-manifest.test.mjs` (NEW) — checks factory call positions (but for the wrong daemon)
- ~30 new regression tests across various suites (all valid for shared lib/ code)

---

## Part 4 — What runs right now (verified state at 2026-05-27)

```
launchd processes:
  ai.openclaw.gateway              PID 858   (external openclaw npm package)
  ai.openclaw.memory-daemon        PID 869   = workspace-bin/memory-daemon.mjs (deployed)
  ai.openclaw.mesh-*               (mesh coordination — out of memory scope)

The workspace memory daemon does:
  ✓ Session ingest (JSONL → state.db via SessionStore.importSession)
  ✓ MemoryBudget tracking
  ✓ HTTP /memory/inject on port 7893 (companion-bridge calls this)
  ✓ Periodic ENDED/BOOT/ACTIVE/IDLE state machine
  ✗ Real-time extraction (createExtractionTrigger not wired — hooks fire into void)
  ✗ Federation (no broadcast-* imports)
  ✗ Channel 5 spreading activation (no graphCache constructed)
  ✗ Consolidation scheduler (in-process; standalone plist status unverified)

Companion-bridge (running on demand via `npx companion-bridge`):
  ✓ Hard rule injection (harness.injectRules)
  ✓ Memory injection (harness.injectMemory → 127.0.0.1:7893)
  ✓ Context persistence (.companion-state.md / .companion-summary.md)
  ✓ Daily memory log triggers (~/.openclaw/workspace/memory/YYYY-MM-DD.md)

PreCompact hook (~/.claude/hooks/pre-compact.sh):
  ✗ NO-OP per Phase 0.6 (explicitly removed; "retained for future rewiring in Phase 4")

hooks/claude-code/pre-compact.sh:
  ✓ Functional — calls bin/openclaw-extract-now.mjs which publishes NATS event
  ✗ But createExtractionTrigger not wired in workspace daemon → event lost

bin/openclaw-memory-daemon.mjs (my federation daemon):
  ✗ Not launched. The plist resolves to the workspace path.
  ✗ Has wiring for: federation, extraction-trigger, graphCache, consolidation-scheduler
  ✗ All of those features are inert in production
```

**Critical correctness issues active in production right now:**

1. **`mentions.turn_index` always null** (F-Q201/Q301/Q404) — chunk-grain privacy filter falls back to session-grain. Stopgap landed; proper fix needs extractor changes.

2. **`SessionStore.importSession` defaults to `skipIfExists: true`** — sessions caught mid-stream are permanently truncated. Once a row exists, later JSONL turns never reach state.db.

3. **Tool calls + tool results silently dropped** by transcript-parser's openclaw-gateway adapter (lib/transcript-parser.mjs:82-85).

4. **knowledge.db never auto-updates** — only `bin/embed-existing-sessions.mjs` (manual CLI) populates it. New sessions don't get embedded. Retrieval channels 1+2 work on stale data.

5. **No schema versioning** anywhere (F-Q401). Downgrade silently corrupts.

6. **No busy_timeout** on state.db, extraction.db (F-Q403). Concurrent writers throw `SQLITE_BUSY` (inject-server reconsolidation racing consolidation scheduler).

7. **Hook → NATS → ??? loop is broken.** The PreCompact and similar hooks publish to NATS subjects that have no production consumer (because `bin/openclaw-memory-daemon.mjs` isn't launched).

---

## Part 5 — The repos involved

| Repo | Path | Owns |
|---|---|---|
| `openclaw-nodedev` (this repo) | `/Users/moltymac/openclaw-nodedev/` | Memory daemon + lib/ + supporting tools |
| `companion-bridge` | `/Users/moltymac/Documents/openclaw infrastructure/companion-bridge/` | The adapter + harness; published as npm `companion-bridge` |
| OpenClaw itself | external — global npm package `openclaw@2026.2.15` at `/opt/homebrew/lib/node_modules/openclaw/` | The LLM agent runner (the user-facing thing) |
| Claude Code CLI | external — Anthropic | The actual LLM execution |
| The Vibe Companion | external — Anthropic | The CLI bridge |
| Mission Control | sibling dir referenced as `mission-control/` | Operations UI (separate codebase, out of memory scope) |

**Critical:** the harness rules live in the companion-bridge repo (`rules/default.json`) and the user-editable copy at `~/.openclaw/harness-rules.json`. Memory injection from companion-bridge goes over HTTP to port 7893 which is served by THIS repo's `lib/memory-inject-server.mjs` (started by `workspace-bin/memory-daemon.mjs:1191`).

---

## Part 6 — Decisions you need to make before any restart

### Decision A: Daemon consolidation

Today: two daemons exist in this repo; only `workspace-bin/memory-daemon.mjs` runs.

**A1.** Merge federation/extraction-trigger work from `bin/openclaw-memory-daemon.mjs` INTO `workspace-bin/memory-daemon.mjs`. Single production daemon. Most operationally simple.

**A2.** Promote `bin/openclaw-memory-daemon.mjs` to production; merge session-ingest from `workspace-bin/memory-daemon.mjs` INTO it. Cleaner codebase but more disruptive (need plist + recap subprocess wiring).

**A3.** Keep both as separate daemons. Add a second plist for `bin/openclaw-memory-daemon.mjs`. Document the two-daemon architecture.

**Recommendation:** A1. The workspace daemon is the operational reality; merge the federation work into it rather than maintaining two parallel daemons.

### Decision B: Phase 1 event-sourcing

The spec mandates event-sourced memory. The implementation skipped it. The memory-watcher concept you mentioned ("indispensable piece of machinery for debugging and QA control") **needs the event log** to work properly — otherwise there's nothing to watch.

**B1.** Finish Phase 1 properly. Wire `MemoryBudget.publishLocal` in the daemon, write a projection layer that processes events into state.db / extraction.db, run the local event log as the source of truth. Unlocks: real memory watcher, real federation promoter/subscriber, proper audit trail.

**B2.** Formally declare the spec changed to direct-write. Remove `local-event-log.mjs`, `memory-budget.mjs`, the 5 dead memory.* schemas, `memory-promoter.mjs`, `memory-subscriber.mjs`. Update REFERENCE_PLAN.md to reflect direct-write.

**Recommendation:** B1, given you described the memory watcher as essential. The event log is the substrate that watcher would consume.

### Decision C: Memory watcher itself (the indispensable piece you described)

You said this is for debugging + QA control. Spec needed:
- What does it watch? (events flowing through local-event-log? Or also state-machine transitions in the daemon? Or inject/extract calls?)
- What does it surface? (a CLI tail? A web UI? A daily report?)
- Where does it sit in the architecture?
- Does it need its own database, or just read from existing stores?

This needs its own design session before code. The dead `memory-budget.mjs` and `memory.*` schemas are an underspec'd attempt at this; finish or redesign.

### Decision D: companion-bridge's hard-rules system — extend into memory?

You mentioned wanting the hard-rules concept to integrate with the memory watcher. Specifically:
- Rules currently inject prompt prefixes (Tier 1/2) and validate output (Tier 3).
- Memory watcher could surface rule violations as memory events: "Tier 1 rule `build-before-done` was violated 3 times this week."
- Or rules could be informed by memory: "concept X has 50+ mentions, surface a soft rule."

This is design work, not code work. Captures a design intent that should be written down before implementation.

### Decision E: Real-time extraction restoration

The hook → NATS → extraction chain is broken. Three options:

**E1.** Wire `createExtractionTrigger` into whichever daemon wins Decision A. Real-time extraction works. Removes need for backfill except for historical data.

**E2.** Drop the trigger entirely. Stay with batch backfill (manual `bin/extract-existing-sessions.mjs` runs).

**E3.** Different trigger model — fs.watch on JSONL directories instead of NATS (avoids NATS dependency).

**Recommendation:** E1 — restore the spec design. The NATS message bus is already there for federation anyway.

### Decision F: knowledge.db indexing

Currently manual-only. Stale retrieval undermines the memory injection block.

**F1.** Workspace daemon's Phase 2 throttled work (every 10 min) kicks off incremental embedding.

**F2.** Document manual cadence explicitly (operator re-runs periodically).

**Recommendation:** F1.

### Decision G: Dead daemons

`bin/memory-promoter.mjs`, `bin/memory-subscriber.mjs`, `bin/health-watch.mjs`, `bin/dogfood-council.mjs` exist as daemon files with SIGINT handlers but no launchd plist starts them.

Per-daemon:
- **memory-promoter** depends on Decision B (only useful if event log lives)
- **memory-subscriber** depends on Decision B + a real projection layer
- **health-watch** + **dogfood-council** are paired (`mesh.health.alerts` subject). Either build the plists, or remove the files.

### Decision H: The 8 memory.* event schemas

`memory.session_started/ended/fact_extracted` — would be produced by MemoryBudget if wired. Decision B determines fate.

`memory.turn_recorded/concept_mentioned/snapshot_taken/artifact_attached/compaction_triggered` — 5 schemas with zero producers anywhere. Per-event: decide what produces them, or delete the schema file.

---

## Part 7 — Restart plan (suggested order if you do A1 + B1)

If you pick A1 (merge federation into workspace daemon) and B1 (finish Phase 1), here's the ordered work:

1. **Verify the consolidation-scheduler plist status** (5 min) — does `ai.openclaw.consolidation-scheduler.plist` actually load? Use `launchctl list` and check for double-run with the in-process scheduler.
2. **Decide spec-update wording for Decision A** (30 min) — update REFERENCE_PLAN.md with the daemon-consolidation choice.
3. **Wire Phase 1 producer side** (4-6 hours) — import `memory-budget.mjs` + `local-event-log.mjs` into `workspace-bin/memory-daemon.mjs`. Add the `publishLocal` calls per spec Phase 1.2. Set up dual-write mode (existing files continue; events also flow).
4. **Build projection layer** (1-2 days) — subscriber on the local event log that replays events into state.db / extraction.db. Verify replay equals live state.
5. **Wire memory watcher** (depends on Decision C — design first).
6. **Wire federation factories into workspace daemon** (1 day) — port the startup logic from `bin/openclaw-memory-daemon.mjs:38-240` into `workspace-bin/memory-daemon.mjs`. Test that startFederation runs.
7. **Wire createExtractionTrigger into workspace daemon** (2 hours) — same idea.
8. **Wire createGraphCache + pass to startFederation** (1 hour) — Channel 5 lives.
9. **Decision F1**: wire incremental knowledge-db indexing into workspace daemon's Phase 2 throttled work.
10. **Delete `bin/openclaw-memory-daemon.mjs`** and its plist (final consolidation step).
11. **Fix `bin/openclaw-status.mjs`** to introspect the (now single) workspace daemon.
12. **Fix `test/wiring-manifest.test.mjs`** entries.
13. **Schema versioning** (F-Q401) — extract `lib/sqlite-store.mjs` helper that adds user_version + integrity_check + busy_timeout on every open.
14. **Extractor turn_index population** (F-Q201 proper fix) — add per-turn citation to extraction prompt, parse + validate, store. Or simpler: stamp `turn_index` as `tail.lastTurnIndex` per mention (gives session-grain but populated).
15. **Backfill `skipIfExists` decision** — change SessionStore.importSession default to allow re-import + append delta messages. Otherwise sessions caught mid-stream are permanently truncated.
16. **Decision G**: remove or build dead daemons.
17. **Decision H**: clean up or wire the 8 memory.* schemas.

---

## Part 8 — Documents in `memory-plan/` after this work

| Doc | Purpose | Status |
|---|---|---|
| `REFERENCE_PLAN.md` | Canonical 10-phase spec — your reference | Likely needs update after Decisions A + B |
| `FRAMEWORK.md`, `FRAMEWORK_CANONICAL.md`, `INVENTORY.md`, `SETUP.md` | Earlier supporting docs | Read for context |
| `CODE_REVIEW_2026-05-26.md` | Original 80-finding audit | Historical |
| `CODE_REVIEW_2026-05-26-FOLLOWUP.md` | 70-finding follow-up | Historical |
| `REVIEW_PASS_1.md` | 72-finding second-wave review | Historical |
| `REVIEW_PASS_2.md` | 83-finding third review | Historical |
| `STUB_AUDIT.md` | First dead-code sweep — has incorrect "dead" claims for workspace-daemon-live subsystems | **Read with the corrections in MEMORY_SYSTEM_MAP.md** |
| `TESTING_PROTOCOL.md` | Testing strategy doc | Forward-looking |
| `MEMORY_SYSTEM_MAP.md` | Comprehensive architecture map; identifies the two-daemon situation | The map of current reality |
| `HANDOFF.md` (this file) | Restart guide with versioning + decisions | Use this as the starting point when you restart |

---

## Part 9 — What you should NOT do at restart

Things that look reasonable but would compound the existing mess:

1. **Don't continue editing `bin/openclaw-memory-daemon.mjs`** without first making Decision A. Anything you do there ships to a daemon nothing launches.

2. **Don't trust `bin/openclaw-status.mjs`'s output** until it's fixed to introspect the right daemon. Its current "NOT_WIRED" reports for SessionStore/etc. are false.

3. **Don't delete `lib/memory-budget.mjs` or `lib/local-event-log.mjs`** until Decision B is made — they're Phase 1 substrate, dormant but not garbage.

4. **Don't delete the 8 memory.* schema files** until Decision H is made — they're Phase 1 events; if you finish Phase 1 you'll need them.

5. **Don't add more leaf-level fixes** like F-N51-style "add an opt to the helper" without verifying the producer side. The F-Q201/Q301 finding (turn_index never populated) is the canonical example of why this fails.

6. **Don't trust prior review findings without re-verification.** Many of the 305+ findings (80+70+72+83) are real bugs in shared lib/ code. Some are in `bin/openclaw-memory-daemon.mjs` which isn't launched — those fixes are still valid as code but don't affect production.

---

## Part 10 — TL;DR for the actual restart

1. Read `MEMORY_SYSTEM_MAP.md` for the architectural ground truth (two-daemon situation, spec vs reality).
2. Read this doc (`HANDOFF.md`) for the versioning and the 8 decisions.
3. Pick Decision A. Without it, the rest is ambiguous.
4. Pick Decision B (do you finish Phase 1 event-sourcing or formalize the divergence?).
5. From those two picks, the remaining decisions and ordered work fall out naturally.
6. Stop me before I do any more "fixing" — make me re-read this doc + MEMORY_SYSTEM_MAP.md first.

You were right to stop me. The infrastructure isn't broken — it's *partially* implemented and *parallel* implemented. The way out is to make the architectural calls first, then the implementation work has a target.
