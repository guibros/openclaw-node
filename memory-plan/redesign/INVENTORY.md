# Memory Redesign — Step Inventory (local-first)

Every L0–G phase from `../MEMORY_REDESIGN.md` decomposed into atomic steps. **One step = one 9-phase cycle = one commit** (see `WORKFLOW.md`). Each carries done-evidence that must be *runtime-observable* (MASTER_PLAN §5), not just tests-green.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`. Blocks map to phases: 0=L0, 1=L1, 2=L2, 3=L3, 4=L4, 5=L5, 6=L6, 7=G. Carrier starts at `v0.0`.

Blocks 0–6 are **local-first** and run in order. Block 7 (multi-node) is **DEFERRED** until local is solid (DECISIONS D4).

---

## Block 0 — Deploy gap + NATS (L0)  ·  prerequisite

Nothing is observable or shippable until repo = runtime and the broker is up. See AUDIT_2026-05-27 Decision 0, COMPONENT_REGISTRY families 7.1 + 8.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [ ] | Symlink runtime lib/ + daemon file to repo; eliminate repo↔runtime drift |
| 0 | 0.2 | v0.2 | [ ] | Install local NATS server with JetStream as a managed launchd service |
| 0 | 0.3 | v0.3 | [ ] | Verify daemon connects to NATS; local-events JetStream stream created on disk |

> **0.1 done-evidence:** `diff -rq lib/ ~/.openclaw/workspace/lib/` empty AND `diff -q workspace-bin/memory-daemon.mjs ~/.openclaw/workspace/bin/memory-daemon.mjs` empty (or both are symlinks); daemon restarted; a log line only current code emits appears.
> **0.2 done-evidence:** `lsof -iTCP:4222 -sTCP:LISTEN` shows nats-server; survives a `launchctl kickstart`; JetStream enabled (`nats account info` or equivalent).
> **0.3 done-evidence:** `~/.openclaw/local-events/` exists on disk; daemon log shows NATS-connected; a test publish lands in the stream.

## Block 1 — Event log spine (L1)  ·  DECISIONS D3

Every memory operation emits a signed local event. The substrate the watcher (Block 2) reads and federation (Block 7) later promotes from. COMPONENT_REGISTRY 1.7.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | Define memory.* event vocabulary in packages/event-schemas (ingested/extracted/synthesized/retrieved/injected/decayed/promoted/error) |
| 1 | 1.2 | v1.2 | [ ] | Wire publishLocal at the ingest boundary |
| 1 | 1.3 | v1.3 | [ ] | Wire publishLocal at the extract boundary |
| 1 | 1.4 | v1.4 | [ ] | Wire publishLocal at synthesize/retrieve/inject boundaries + memory.error on any failure |
| 1 | 1.5 | v1.5 | [ ] | Verify a full event trail for one real session in the stream |

> **1.1 done-evidence:** schema package builds; new event types validate in a unit test AND a round-trip publish/read of one event type succeeds against the live stream.
> **1.2–1.4 done-evidence:** trigger the relevant op; the corresponding event appears in `local-events-<nodeId>` with correct fields (who/op/session/ts).
> **1.5 done-evidence:** one session produces an ordered ingest→extract→synthesize(→retrieve→inject) trail visible via `nats stream view`.

## Block 2 — Memory-watcher (L2)  ·  DECISIONS D6 (built early, the lens)

The observability/log/debug device over the ENTIRE memory system. Who/where/how/when. Catches silent no-ops. Surface = mission-control panel (DECISIONS sub-decision). Read-only.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | Watcher core: subscribe to event log, classify each op ok/noop/error, write structured JSONL |
| 2 | 2.2 | v2.2 | [ ] | No-op detection: flag extract→0 entities, synth→empty, retrieve→empty as silent failures |
| 2 | 2.3 | v2.3 | [ ] | Store-health probes: row counts, last-write timestamps, WAL size, repo↔runtime drift |
| 2 | 2.4 | v2.4 | [ ] | Mission-control panel: live op stream + a dedicated silent-failures view |
| 2 | 2.5 | v2.5 | [ ] | Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs |

> **2.1 done-evidence:** run a session; watcher JSONL contains one line per op with `{ts,op,actor,session,status,duration_ms}`.
> **2.2 done-evidence:** induce a known empty extraction; watcher flags it `status:noop` with who/where/when.
> **2.3 done-evidence:** panel/probe reports live row counts matching a direct SQL query; WAL size shown.
> **2.4 done-evidence:** mission-control shows the live stream updating as a session runs; silent-failures view populates on an induced no-op.
> **2.5 done-evidence:** induce a Zod validation failure; an alert fires (panel + log), not a silent swallow.

## Block 3 — Ingest + extraction correctness (L3)  ·  COMPONENT_REGISTRY 1.1, 1.2

Fix the verified-broken pipeline, each fix confirmed in the watcher.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | Fix skipIfExists truncation — re-import + append-delta for mid-stream sessions |
| 3 | 3.2 | v3.2 | [ ] | Stop dropping tool_result / tool-call entries in the gateway transcript adapter |
| 3 | 3.3 | v3.3 | [ ] | Populate mentions.turn_index (last-turn-of-tail stamp) — unbreaks chunk-grain privacy |
| 3 | 3.4 | v3.4 | [ ] | Make tolerant extraction coercion the running path; watcher surfaces success rate |

> **3.1 done-evidence:** an active session's later turns land in state.db (row count grows as turns arrive); watcher shows no truncation.
> **3.2 done-evidence:** tool messages present in state.db for a session that had them.
> **3.3 done-evidence:** `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h` > 0.
> **3.4 done-evidence:** watcher reports extraction success-rate >95% over a 10-session sample; failures no longer silent.

## Block 4 — Synthesis layer = the Karpathy wiki (L4)  ·  DECISIONS D5, D2

Make the already-documented synthesis actually run and produce readable output. Replaces the lossy daily logs. COMPONENT_REGISTRY 1.4.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | Generate structured MEMORY.md from entity/theme/decision tables (Recent decisions / Active concepts) |
| 4 | 4.2 | v4.2 | [ ] | Generate Obsidian vault notes — concepts/decisions/sessions/themes with frontmatter + LLM body + wikilinks |
| 4 | 4.3 | v4.3 | [ ] | Synthesis triggers: session-end hook + every-30-min-while-active interval (D2) |
| 4 | 4.4 | v4.4 | [ ] | Deploy consolidation + install its scheduler (decay/reinforce/cluster/regenerate-summaries) |
| 4 | 4.5 | v4.5 | [ ] | Assemble a daily/weekly digest from the vault; retire the lossy hourly daily-log writer |

> **4.1 done-evidence:** end a session → MEMORY.md updates within seconds with structured sections (not raw fragments); watcher logs the synthesize op.
> **4.2 done-evidence:** a `sessions/<date>-<topic>.md` + relevant `concepts/*.md` notes appear in the vault with `[[wikilinks]]`.
> **4.3 done-evidence:** synthesis fires on a session-end event AND on the 30-min interval during a long active session (both visible in watcher).
> **4.4 done-evidence:** consolidation scheduler installed (`launchctl list`); one cycle observed writing entities_archived / regenerating a summary.
> **4.5 done-evidence:** a generated digest reads coherently; the old hourly-repeat daily-log writer no longer runs (OUT_OF_SCOPE 2026-05-27 resolved).

## Block 5 — Retrieval freshness (L5)  ·  COMPONENT_REGISTRY 1.3

Make the 5 channels operate on current data.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | knowledge.db incremental indexing of new sessions in the daemon's throttled work |
| 5 | 5.2 | v5.2 | [ ] | Construct graphCache in the daemon + refresh it on the synthesis cadence (unbreaks channel 5) |
| 5 | 5.3 | v5.3 | [ ] | Verify all 5 retrieval channels return for a known-good query via the inject server |

> **5.1 done-evidence:** knowledge.db `last_indexed` (or session_documents max) within 1h of the latest session.
> **5.2 done-evidence:** graph-cache `last_refresh_at` within 1h; channel-5 returns non-empty for a seeded query.
> **5.3 done-evidence:** a diagnostic against :7893 shows non-empty hits from FTS, vec, entity, theme, and spreading-activation channels.

## Block 6 — Health + storage hygiene (L6)  ·  DESIGN_INPUTS §5 (the scars)

No crash-loops, no WAL bloat, schema-versioned stores.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | Shared lib/sqlite-store.mjs — WAL + foreign_keys + busy_timeout + integrity_check + user_version on open |
| 6 | 6.2 | v6.2 | [ ] | Route all `new Database()` sites through the helper; add schema-version migration for existing stores |
| 6 | 6.3 | v6.3 | [ ] | WAL checkpoint (TRUNCATE) on graceful shutdown |
| 6 | 6.4 | v6.4 | [ ] | Install health-watch; verify clean restart + KeepAlive respawn (no crash-loop) |

> **6.1 done-evidence:** opening any store via the helper sets all pragmas (verified by `PRAGMA` readback); user_version present.
> **6.2 done-evidence:** grep shows zero raw `new Database(` outside the helper; every store reports a user_version.
> **6.3 done-evidence:** WAL size bounded across a day of activity (no 331 MB-style bloat).
> **6.4 done-evidence:** kill the daemon → launchd respawns it healthy within the interval; health-watch logs the transition; no restart loop.

## Block 7 — Multi-node / federation (G)  ·  DEFERRED until local solid (DECISIONS D3, D4)

Nothing here starts until Blocks 0–6 close and the local system is observably healthy. Federation modules already exist in the tree (offline) — these steps bring them online, they do not rebuild.

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [ ] | (DEFERRED) Stand up the 3-node NATS cluster (R=3) from services/nats/ |
| 7 | 7.2 | v7.2 | [ ] | (DEFERRED) Wire broadcast/offerer/acceptor into the workspace daemon (no parallel daemon) |
| 7 | 7.3 | v7.3 | [ ] | (DEFERRED) Build the identity registry + promoter reading the L1 event log |
| 7 | 7.4 | v7.4 | [ ] | (DEFERRED) Validate a cross-node broadcast→offer→accept round-trip |

> Block 7 done-evidence is defined when Block 7 is un-deferred (after a Block-6 close ceremony). It will mirror the old Block-9/10 federation criteria but with the new runtime-evidence gate.

---

## Totals

| Block | Phase | Steps | Cumulative |
|-------|-------|-------|------------|
| 0 | L0 deploy+NATS | 3 | 3 |
| 1 | L1 event log | 5 | 8 |
| 2 | L2 watcher | 5 | 13 |
| 3 | L3 ingest/extract | 4 | 17 |
| 4 | L4 synthesis/wiki | 5 | 22 |
| 5 | L5 retrieval | 3 | 25 |
| 6 | L6 health | 4 | 29 |
| 7 | G multi-node (deferred) | 4 | 33 |

**29 local-first steps + 4 deferred multi-node = 33 total.** Local-first = Blocks 0–6 (29 steps). The next step to execute is **0.1**.
