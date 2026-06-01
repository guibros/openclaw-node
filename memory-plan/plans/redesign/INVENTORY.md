# Memory Redesign — Step Inventory (local-first)

Every L0–G phase from `MEMORY_REDESIGN.md` decomposed to **true atomic grain**. **One step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit** (see `WORKFLOW.md`). Each carries done-evidence that must be *runtime-observable* (MASTER_PLAN §5), not just tests-green.

**Atomicity test (applied to every step):** does it produce exactly one verifiable behavior change? If a step needed "and" to describe two independently-testable outcomes, it was split. Event-log emission for an operation is folded into the step that *builds* that operation (not front-loaded), so each step's event is part of its own done-evidence.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`. Blocks: 0=L0, 1=L1, 2=L2, 3=L3, 4=L4, 5=L5, 6=L6, 7=G. Carrier starts at `v0.0`.

Blocks 0–6 = **local-first**, run in order. Block 7 = **DEFERRED** (DECISIONS D4). Every block boundary triggers the **macro Re-Orient** (WORKFLOW §7); every step opens with the **micro Re-Orient**.

> **Flow-process view:** every step here is also expressed as a loop (connects-with · purpose · residue · produces-for · testable goal + WIN/FAIL threshold) in [`LOOPS.md`](LOOPS.md). This table is canonical for status/done-evidence; LOOPS.md is canonical for the flow framing.

---

## Block 0 — Deploy gap + NATS (L0) · prerequisite

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [x] | Symlink runtime lib/ → repo lib/ (close lib drift) |
| 0 | 0.2 | v0.2 | [x] | Symlink runtime daemon file → repo; restart; confirm current code runs |
| 0 | 0.3 | v0.3 | [x] | Install local NATS server (JetStream) as a launchd service |
| 0 | 0.4 | v0.4 | [x] | Daemon connects to NATS and creates the local-events stream |

> **0.1:** `diff -rq lib/ ~/.openclaw/workspace/lib/` empty (or runtime lib is a symlink to repo); daemon still boots.
> **0.2:** runtime daemon file is the repo file (symlink or identical); after restart a log line only current code emits appears.
> **0.3:** `lsof -iTCP:4222 -sTCP:LISTEN` shows nats-server; survives `launchctl kickstart`; JetStream enabled.
> **0.4:** JetStream stream `local-events-daedalus` exists (`nats stream ls`); daemon log shows NATS-connected + `Local event log initialized`; a test publish lands (`stream info` messages ≥ 1). [DONE 2026-05-29 — closes Block 0.]

## Block 1 — Event log spine (L1) · DECISIONS D3

Events for ops that *already exist* (ingest/extract/inject). Synthesize/decay/promote events are folded into their build-steps in Block 4.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Define memory.* event vocabulary in packages/event-schemas |
| 1 | 1.2 | v1.2 | [x] | Emit memory.ingested at the ingest boundary |
| 1 | 1.3 | v1.3 | [x] | Emit memory.extracted at the extract boundary |
| 1 | 1.4 | v1.4 | [x] | Emit memory.retrieved + memory.injected in the inject server |
| 1 | 1.5 | v1.5 | [x] | Emit memory.error on caught failures across the wired boundaries |

> **1.1:** schemas validate in a unit test AND one round-trip publish/read against the live stream succeeds.
> **1.2 / 1.3 / 1.4:** trigger the op; the matching event appears in `local-events-<nodeId>` with who/op/session/ts.
> **1.5:** induce a failure at a wired boundary; a memory.error event appears (not a silent swallow).

## Block 2 — Memory-watcher (L2) · DECISIONS D6 (the lens, built early)

Read-only observability over the whole system. Surface = mission-control panel.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [x] | Watcher core: subscribe to the event log, persist one record per op to JSONL |
| 2 | 2.2 | v2.2 | [x] | Classify each op ok / noop / error (incl. empty-output no-op detection) |
| 2 | 2.3 | v2.3 | [x] | Store-health probes: row counts, last-write, WAL size, repo↔runtime drift |
| 2 | 2.4 | v2.4 | [x] | Mission-control API endpoint serving watcher records + health |
| 2 | 2.5 | v2.5 | [x] | Mission-control panel UI: live op stream + dedicated silent-failures view |
| 2 | 2.6 | v2.6 | [x] | Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs |

> **2.1:** run a session; JSONL has one `{ts,op,actor,session,duration_ms}` line per op.
> **2.2:** induce an empty extraction; record shows `status:noop` with who/where/when.
> **2.3:** probe output matches a direct SQL count; WAL size shown.
> **2.4:** `curl` the endpoint → current watcher records as JSON.
> **2.5:** mission-control shows the live stream updating during a session; silent-failures view populates on an induced no-op.
> **2.6:** induce a Zod validation failure; an alert fires (panel + log).

## Block 3 — Ingest + extraction correctness (L3) · REGISTRY 1.1, 1.2

Each fix confirmed in the watcher.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [x] | Fix skipIfExists truncation — re-import + append-delta for mid-stream sessions |
| 3 | 3.2 | v3.2 | [x] | Stop dropping tool_result / tool-call entries in the gateway transcript adapter |
| 3 | 3.3 | v3.3 | [x] | Populate mentions.turn_index (last-turn-of-tail stamp) |
| 3 | 3.4 | v3.4 | [x] | Make tolerant extraction coercion the running path |

> **3.1:** an active session's later turns land in state.db (row count grows as turns arrive).
> **3.2:** tool messages present in state.db for a session that had them. [DONE 2026-05-29 — removed `tool_result` from GATEWAY_SKIP_TYPES; gateway adapter now handles `toolCall` content blocks (rendered as `[tool_call: name(args)]`) and maps `toolResult` role → `"tool"`. Verified: 4-message import includes role=tool + role=assistant with tool-call content.]
> **3.3:** `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h` > 0. [DONE 2026-05-30 — `storeExtractionResult` accepts `opts.turnIndex`; `runFlush` passes the session `messageCount`. Real extraction via deployed `runFlush` (LLM path) against session `833ea9cf` stamped 14 mentions `turn_index=198` in production state.db (was 0). Tests green.]
> **3.4:** watcher reports extraction success-rate >95% over a 10-session sample. [DONE 2026-05-30 — `coerceExtractionResult` already wired + schema-complete (coerce→validate can't throw on coerced input); added regression test locking missing-arrays/bad-enum tolerance. Runtime: deployed `extractStructured` over 10 real gateway sessions = 10/10 (100%) succeeded, 0 throws/fallbacks. Closes Block 3.]

## Block 4 — Synthesis = the Karpathy wiki (L4) · DECISIONS D5, D2 · the heart

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [x] | Generate structured MEMORY.md from entity/theme/decision tables (emits memory.synthesized) |
| 4 | 4.2 | v4.2 | [x] | Generate Obsidian concept notes (frontmatter + LLM body + wikilinks) |
| 4 | 4.3 | v4.3 | [x] | Generate Obsidian session notes (dated, auto-linked to concepts touched) |
| 4 | 4.4 | v4.4 | [x] | Session-end synthesis trigger |
| 4 | 4.5 | v4.5 | [x] | 30-min-while-active synthesis trigger |
| 4 | 4.6 | v4.6 | [x] | Deploy consolidation module; verify one manual cycle (emits memory.decayed/promoted) |
| 4 | 4.7 | v4.7 | [x] | Install consolidation scheduler (plist) on the cadence |
| 4 | 4.8 | v4.8 | [x] | Assemble a daily/weekly digest deterministically from the vault |
| 4 | 4.9 | v4.9 | [ ] | Retire the lossy hourly daily-log writer |

> **4.1:** end a session → MEMORY.md updates within seconds with structured sections; memory.synthesized event logged. [DONE 2026-05-30 — runFlush returns a synthesis block; daemon emits memory.synthesized (trigger interval/session_end/manual) at the 3 flush sites, mirroring emitExtractEvent. Real synthesis via deployed runFlush → event published to live local-events-daedalus → watcher recorded+classified ok ({"op":"memory.synthesized","status":"ok","actor":"daemon-daedalus"}). Producer test green.]
> **4.2:** relevant `concepts/*.md` notes appear with `[[wikilinks]]`. [DONE 2026-05-30 — wired `generateConceptNotes` into `runFlush` LLM path (after MEMORY.md gen, `{ respectPrivacy:false, maxConcepts:10 }`). Real generation against production state.db (68 entities above threshold): concept notes written to `~/.openclaw/obsidian-local/concepts/` with YAML frontmatter (`type:concept`, `related: [[[wikilinks]]]`), LLM body (qwen3:8b), decisions, session links. `artifacts_written` now includes concept paths.]
> **4.3:** a `sessions/<date>-<topic>.md` note appears, linking the concepts it touched. [DONE 2026-05-31 — `lib/obsidian-session-notes.mjs` (impl by tick) wired into runFlush after concept notes; tests green. Operator-verified: `generateSessionNote` on real session `e7ccaaf9` produced `2026-03-08-gui-openclaw-nats-jetstream-e7ccaaf9.md` with `[[wikilinks]]` to its 35 concepts. Tick had blocked at Phase 5b (verification command not in allowedTools) — see f5e1f9b observability fixes.]
> **4.4:** synthesis fires on a session-end event (visible in watcher). [DONE 2026-05-31 — fixed ACTIVE->ENDED gap (was quick-cleanup only, now runs full synthesis); added `findJsonlBySessionId` for session-switch accuracy; added explicit synthesis logging at both IDLE->ENDED and ACTIVE->ENDED handlers. Runtime: daemon restarted (PID 27452); `memory.synthesized` event with `trigger:session_end` recorded in watcher (`{"op":"memory.synthesized","status":"ok","actor":"daemon-daedalus","session":"step44-verify"}`). Tests 1444/0.]
> **4.5:** synthesis fires on the 30-min interval during a long active session (visible in watcher). [DONE 2026-05-31 — daemon gains `synthesisMs` interval + `lastSynthesis` throttle; Phase 2 runs interval synthesis only while ACTIVE, emitting memory.synthesized `trigger:interval`. Operator-verified: shortened synthesisMs→5s + induced activity → deployed daemon logged `Phase 2: interval synthesis [llm]: 40 facts` and watcher recorded the event (2→3); config reverted. Impl by tick, blocked at 5b (sandbox), closed by operator.]
> **4.6:** `consolidate.mjs` runs once manually; entities_archived written OR a summary regenerated; decay/promote events logged. [DONE 2026-05-31 — consolidate.mjs emits memory.decayed (after decay) + memory.promoted (after promotion); CLI connects to NATS with --no-events fallback; symlink-deployed. Operator-verified: backed up state.db, ran one real cycle (1064 entities/318 decisions decayed, 136 promotion candidates), both events recorded+classified ok in watcher; entities_archived table created. Impl by tick, blocked at 5b (sandbox), closed by operator.]
> **4.7:** scheduler installed (`launchctl list`); a cycle fires on cadence unattended. [DONE 2026-06-01 — consolidation-scheduler.mjs threads eventLog/nodeId + NATS; resolved plist installed (StartInterval 1800) + symlink-deployed. Operator reviewed safety (idle-gated, 5-min hard cap w/ AbortController, concurrency guard, soft-archive-only) before installing. Verified: launchctl list shows it (exit 0); kickstart → "system idle — starting consolidation cycle" → cycle complete, decay+promote events in watcher (2→4). Impl by tick, blocked at 5b, closed by operator.]
> **4.8:** a generated digest reads coherently from vault notes (not an hourly buffer dump). [DONE 2026-06-01 — lib/obsidian-digest.mjs: deterministic template assembly (no LLM) from vault frontmatter, date-filtered, salience-sorted, wikilinked; wired into runFlush (non-fatal). Operator-verified against live vault: weekly digest reads coherently — dated range, session wikilink, active concepts by salience w/ mentions; identical across 2 runs (deterministic). 1473/0 tests. Impl by tick, blocked at 5b, closed by operator.]
> **4.9:** the old hourly-repeat daily-log writer no longer runs (OUT_OF_SCOPE 2026-05-27 resolved).

## Block 5 — Retrieval freshness (L5) · REGISTRY 1.3

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | knowledge.db incremental indexing of new sessions in the daemon's throttled work |
| 5 | 5.2 | v5.2 | [ ] | Construct graphCache in the daemon + refresh it on the synthesis cadence |
| 5 | 5.3 | v5.3 | [ ] | Verify all 5 retrieval channels return for a known-good query (integration checkpoint) |

> **5.1:** knowledge.db session_documents max-time within 1h of the latest session.
> **5.2:** graph-cache `last_refresh_at` within 1h; channel-5 returns non-empty for a seeded query.
> **5.3:** a diagnostic against :7893 shows non-empty hits from FTS, vec, entity, theme, and spreading-activation.

## Block 6 — Health + storage hygiene (L6) · DESIGN_INPUTS §5 (the scars)

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | Build lib/sqlite-store.mjs (WAL + foreign_keys + busy_timeout + integrity_check + user_version) |
| 6 | 6.2 | v6.2 | [ ] | Route all `new Database()` sites through the helper |
| 6 | 6.3 | v6.3 | [ ] | Schema-version migration for the existing populated stores |
| 6 | 6.4 | v6.4 | [ ] | WAL checkpoint (TRUNCATE) on graceful shutdown |
| 6 | 6.5 | v6.5 | [ ] | Install health-watch; verify clean respawn + KeepAlive (no crash-loop) |

> **6.1:** opening a store via the helper sets all pragmas (PRAGMA readback).
> **6.2:** grep shows zero raw `new Database(` outside the helper.
> **6.3:** every store reports a user_version.
> **6.4:** WAL stays bounded across a day (no 331 MB-style bloat).
> **6.5:** kill the daemon → launchd respawns healthy within the interval; no restart loop; watcher logs the transition.

## Block 7 — Multi-node / federation (G) · DEFERRED (DECISIONS D3, D4)

Nothing here starts until Blocks 0–6 close and local is observably healthy. Federation modules already exist (offline) — these bring them online, not rebuild.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [ ] | (DEFERRED) Stand up the 3-node NATS cluster (R=3) |
| 7 | 7.2 | v7.2 | [ ] | (DEFERRED) Wire broadcast/offerer/acceptor into the workspace daemon |
| 7 | 7.3 | v7.3 | [ ] | (DEFERRED) Identity registry + promoter reading the L1 event log |
| 7 | 7.4 | v7.4 | [ ] | (DEFERRED) Validate a cross-node broadcast→offer→accept round-trip |

> Block 7 done-evidence defined when it is un-deferred (after a Block-6 close + macro Re-Orient).

---

## Totals

| Block | Phase | Steps | Cumulative |
|-------|-------|-------|------------|
| 0 | L0 deploy+NATS | 4 | 4 |
| 1 | L1 event log | 5 | 9 |
| 2 | L2 watcher | 6 | 15 |
| 3 | L3 ingest/extract | 4 | 19 |
| 4 | L4 synthesis/wiki | 9 | 28 |
| 5 | L5 retrieval | 3 | 31 |
| 6 | L6 health | 5 | 36 |
| 7 | G multi-node (deferred) | 4 | 40 |

**40 steps total — 36 local-first (Blocks 0–6) + 4 deferred.** Next step to execute: **3.3**.

### Atomicity revision log (vs the prior 33-step draft)
- Block 0: 0.1 split into lib-symlink (0.1) + daemon-symlink/restart (0.2); old 0.3 split into NATS-install (0.3) + daemon↔NATS-wire (0.4).
- Block 1: old 1.4 (4 boundaries bundled) → events now folded into each op's build-step; 1.4 = inject-path only, 1.5 = error.
- Block 2: old 2.1 split into core (2.1) + classification (2.2); old 2.4 split into API endpoint (2.4) + panel UI (2.5).
- Block 3: dropped "watcher surfaces rate" from 3.4 (automatic via Block 2.6).
- Block 4: vault gen split into concept (4.2) + session (4.3) notes; triggers split (4.4 end, 4.5 interval); consolidation split into deploy (4.6) + schedule (4.7); digest split into build (4.8) + retire-old (4.9).
- Block 6: route (6.2) split from migration (6.3).
