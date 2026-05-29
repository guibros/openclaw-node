# Loops — Flow-Process View of Every Atomic Step (Blocks 0–6)

Companion to [`INVENTORY.md`](INVENTORY.md). The inventory is the terse index (one row +
one done-evidence line per step); this file re-expresses each atomic step as a **loop in the
flow process** — what it connects to, why it exists, what it leaves behind, and who consumes
its output — plus an explicit **win/fail threshold**. Same atomic grain (one step = one
verifiable runtime outcome = one 9-phase cycle = one commit). Where this file and `INVENTORY.md`
disagree on done-evidence, `INVENTORY.md` is canonical and this file is the bug.

Block 7 (multi-node / federation) is DEFERRED (DECISIONS D3/D4) — its loops are defined when it un-defers.

## The loop template

Every step is rendered as:

```
### vX.Y — <title>                                                    [status]
- Connects:    <upstream source>  →  [this loop]  →  <downstream consumer>
- Purpose:     <the intent this loop serves — one line>
- Residue:     <the durable artifact/state it leaves behind after it runs>
- Produces for:<actor>  —  <what they receive / why they consume it>
- Goal:        <the runtime-observable done-evidence (= INVENTORY's `>` line)>
- WIN:         <measurable pass threshold>
- FAIL:        <measurable fail line → BLOCK (no commit), per WORKFLOW §3 / MASTER_PLAN §5>
```

**Reading the fields**
- **Connects** = the step's place in the pipeline (its *target in the flow*): the source it draws from and the consumer it feeds. If a step connects to nothing downstream, question why it's in the plan.
- **Residue** = the persistent byproduct (a DB row, an event in the stream, a file, a symlink, a running service). The residue is what later steps build on; it outlives the step's execution.
- **Produces for / actor** = the consumer the residue exists *for*. Actors in this system: the **operator** (Gui, human), the **memory daemon**, the **local NATS event log** (`local-events-daedalus`), the **memory-watcher** (Block 2), the **mission-control panel**, the **inject server** (:7893), the on-disk **stores** (state.db / knowledge.db / graphCache), the **Obsidian vault**, and (deferred) **federation**.
- **WIN/FAIL** = the two sides of the runtime-evidence gate. WIN is the observable that closes the step; FAIL is the line that forces a BLOCK instead of a fake-close (the discipline the old framework lacked — WORKFLOW §4).

---

## Block 0 — Deploy gap + NATS (L0) · prerequisite

### v0.1 — Symlink runtime lib/ → repo lib/                                          [x]
- Connects:    repo `lib/` (source of truth) → [symlink] → runtime `~/.openclaw/workspace/lib/` (what the daemon loads)
- Purpose:     close the lib code-drift gap so the running daemon executes current repo code, not a stale copy.
- Residue:     a filesystem symlink (runtime lib → repo lib); the lib half of the deploy gap is permanently closed.
- Produces for:the **memory daemon** — it now loads current code, which makes every later step's "runtime evidence" trustworthy.
- Goal:        `diff -rq lib/ ~/.openclaw/workspace/lib/` empty (or runtime lib is a symlink to repo) AND daemon still boots.
- WIN:         diff empty / symlink present + daemon boots clean.
- FAIL:        any residual diff, or daemon fails to boot → BLOCK + restore the moved box.

### v0.2 — Symlink runtime daemon file → repo; restart; confirm current code runs    [x]
- Connects:    repo daemon file → [symlink] → runtime daemon entrypoint → launchd
- Purpose:     extend deploy-gap closure to the daemon entrypoint; prove the current daemon binary is the one running.
- Residue:     a symlinked/identical daemon file + a boot-log line that only current code emits.
- Produces for:**launchd / the daemon**; the **operator** gets proof that deployed == repo.
- Goal:        runtime daemon file is the repo file (symlink or identical); after restart a log line only current code emits appears.
- WIN:         symlink/identical + the marker log line present post-restart.
- FAIL:        a stale binary runs, or the marker line is absent → BLOCK.

### v0.3 — Install local NATS server (JetStream) as a launchd service               [x]
- Connects:    (infra, no upstream) → [nats-server on 127.0.0.1:4222] → the event-log substrate that 0.4 + Block 1 + Block 2 ride on
- Purpose:     stand up the single-node JetStream transport the whole L1 event spine depends on.
- Residue:     a running `nats-server` under launchd (`ai.openclaw.nats`) with a JetStream store on disk; survives restart.
- Produces for:the **daemon** (publisher) and the **watcher** (subscriber) — the shared local bus.
- Goal:        `lsof -iTCP:4222 -sTCP:LISTEN` shows nats-server; survives `launchctl kickstart`; JetStream enabled.
- WIN:         port listening + survives kickstart + JetStream on.
- FAIL:        not listening / dies on kickstart / JetStream off → BLOCK.

### v0.4 — Daemon connects to NATS and creates the local-events stream              [ ]
- Connects:    **memory daemon** → [NATS :4222] → creates `local-events-daedalus` stream → (later) **watcher** consumes
- Purpose:     wire the daemon to the local bus and create its per-node event log — the D3 substrate every memory event lands in.
- Residue:     the durable `local-events-daedalus` JetStream stream + a NATS-connected daemon.
- Produces for:the **watcher** (Block 2) and every **L1 emit step** (Block 1) — the place events are written and read.
- Goal:        daemon log shows `NATS connected` + `Local event log initialized (stream: local-events-daedalus)`; `nats stream ls` lists it; a test publish → messages ≥1; `Shared stream unavailable … continuing` confirms federation stays dormant (D4).
- WIN:         stream listed + test publish lands (msgs ≥ 1) + daemon PID stable >10s.
- FAIL:        daemon crash-loop after reload / stream not created / publish schema-rejected → BLOCK + restore `plist.bak-2026-05-28`.

---

## Block 1 — Event log spine (L1) · DECISIONS D3

Events for ops that *already exist* (ingest/extract/inject). Synthesize/decay/promote events are folded into their build-steps in Block 4.

### v1.1 — Define memory.* event vocabulary in packages/event-schemas               [ ]
- Connects:    DECISIONS D3 (intent) → [Zod schemas] → emit steps 1.2–1.5 (producers) + the watcher's parser (consumer)
- Purpose:     lock the shared event contract (who/op/session/ts + payload) so producers and consumers can't disagree.
- Residue:     versioned schema definitions in `packages/event-schemas` (code artifact).
- Produces for:the **emit boundaries** and the **watcher** — one source of truth for event shape.
- Goal:        schemas validate in a unit test AND one round-trip publish/read against the live stream succeeds.
- WIN:         unit test green + live round-trip OK.
- FAIL:        schema invalid, or round-trip fails → BLOCK.

### v1.2 — Emit memory.ingested at the ingest boundary                              [ ]
- Connects:    **ingest boundary** (raw session in) → [emit memory.ingested] → `local-events` stream → **watcher**
- Purpose:     make the ingest operation observable as a first-class event.
- Residue:     a `memory.ingested` event per ingest in the stream.
- Produces for:the **watcher / operator** — proof ingest happened, with who/op/session/ts.
- Goal:        trigger ingest; the matching event appears in `local-events-daedalus` with who/op/session/ts.
- WIN:         event present with full envelope on a real ingest.
- FAIL:        no event, or missing envelope fields → BLOCK.

### v1.3 — Emit memory.extracted at the extract boundary                            [ ]
- Connects:    **extract boundary** (extraction → state.db) → [emit memory.extracted] → stream → **watcher**
- Purpose:     make extraction observable, so silent/empty extractions become visible downstream.
- Residue:     a `memory.extracted` event per extraction.
- Produces for:the **watcher** (feeds the noop classifier 2.2) and the **operator**.
- Goal:        trigger extraction; the matching event appears with who/op/session/ts.
- WIN:         event present with full envelope on a real extraction.
- FAIL:        no event / missing fields → BLOCK.

### v1.4 — Emit memory.retrieved + memory.injected in the inject server             [ ]
- Connects:    **inject server** (:7893 retrieval+injection) → [emit retrieved + injected] → stream → **watcher**
- Purpose:     observe the recall path — what was retrieved and what was actually injected into the prompt.
- Residue:     `memory.retrieved` + `memory.injected` events.
- Produces for:the **watcher / operator** — closes the loop on whether stored memory is actually used.
- Goal:        trigger inject; both events appear with envelope.
- WIN:         both events present with envelope.
- FAIL:        either event missing → BLOCK.

### v1.5 — Emit memory.error on caught failures across the wired boundaries         [ ]
- Connects:    all wired boundaries → [on caught failure → emit memory.error] → stream → **watcher** silent-failure view
- Purpose:     surface failures instead of silently swallowing them (the central scar of the old system).
- Residue:     a `memory.error` event on induced failure.
- Produces for:the **watcher** (2.2/2.6) and the **operator** (alerts).
- Goal:        induce a failure at a wired boundary; a `memory.error` event appears (not a silent swallow).
- WIN:         error event present on the induced failure.
- FAIL:        the failure is swallowed with no event → BLOCK.

---

## Block 2 — Memory-watcher (L2) · DECISIONS D6 (the lens, built early)

Read-only observability over the whole system. Surface = mission-control panel.

### v2.1 — Watcher core: subscribe to the event log, persist one record per op to JSONL [ ]
- Connects:    `local-events` stream (Block 1 producers) → [watcher subscribe] → JSONL op-record store
- Purpose:     build the read-only lens that durably records every memory operation.
- Residue:     a JSONL file with one record per op.
- Produces for:the **mission-control API** (2.4) and the **operator** — the queryable op history.
- Goal:        run a session; JSONL has one `{ts,op,actor,session,duration_ms}` line per op.
- WIN:         exactly one well-formed record per op.
- FAIL:        missing, duplicated, or malformed records → BLOCK.

### v2.2 — Classify each op ok / noop / error (incl. empty-output no-op detection)  [ ]
- Connects:    watcher op-records → [classifier] → enriched records → silent-failures view
- Purpose:     distinguish real success from silent no-ops (an op that "ran" but produced nothing).
- Residue:     a `status` field on every record.
- Produces for:the **silent-failures view** and **anomaly alerts** (2.6).
- Goal:        induce an empty extraction; the record shows `status:noop` with who/where/when.
- WIN:         the noop is correctly classified with context.
- FAIL:        an empty op is recorded as `ok` → BLOCK.

### v2.3 — Store-health probes: row counts, last-write, WAL size, repo↔runtime drift [ ]
- Connects:    state.db / knowledge.db / graphCache + repo↔runtime → [probes] → health snapshot
- Purpose:     continuous ground truth on store health (counts, freshness, WAL, drift).
- Residue:     a health-snapshot record.
- Produces for:the **mission-control panel** and the **operator**.
- Goal:        probe output matches a direct SQL count; WAL size shown.
- WIN:         probe == ground-truth SQL + WAL displayed.
- FAIL:        probe disagrees with a direct SQL count → BLOCK.

### v2.4 — Mission-control API endpoint serving watcher records + health            [ ]
- Connects:    watcher JSONL + health snapshot → [HTTP endpoint] → mission-control panel (2.5)
- Purpose:     expose the lens over HTTP so a UI (or curl) can read it.
- Residue:     a live API endpoint.
- Produces for:the **panel UI** and any **operator** curl.
- Goal:        `curl` the endpoint → current watcher records as JSON.
- WIN:         endpoint returns current records.
- FAIL:        5xx / empty / stale payload → BLOCK.

### v2.5 — Mission-control panel UI: live op stream + dedicated silent-failures view [ ]
- Connects:    API (2.4) → [panel UI] → the **operator's** eyes
- Purpose:     make the running reality visible at a glance — especially the failures the old system hid.
- Residue:     a UI surface (the panel).
- Produces for:the **operator** (human) — the primary observability surface.
- Goal:        panel shows the live stream updating during a session; the silent-failures view populates on an induced no-op.
- WIN:         live updates during activity + induced silent-failure appears in its view.
- FAIL:        panel static/empty during real activity → BLOCK.

### v2.6 — Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs [ ]
- Connects:    classified records + health → [alert rules] → panel + log
- Purpose:     push on dangerous conditions instead of waiting for the operator to look.
- Residue:     an alert event / log entry.
- Produces for:the **operator**.
- Goal:        induce a Zod validation failure; an alert fires (panel + log).
- WIN:         alert fires on the induced failure.
- FAIL:        no alert fires → BLOCK.

---

## Block 3 — Ingest + extraction correctness (L3) · REGISTRY 1.1, 1.2

Each fix confirmed in the watcher.

### v3.1 — Fix skipIfExists truncation — re-import + append-delta for mid-stream sessions [ ]
- Connects:    **ingest** (mid-stream sessions) → [append-delta import] → state.db
- Purpose:     stop truncating active sessions; capture turns that arrive after the first import.
- Residue:     grown state.db rows for active sessions.
- Produces for:**extraction + retrieval** downstream, and the **watcher** (which confirms the fix).
- Goal:        an active session's later turns land in state.db (row count grows as turns arrive).
- WIN:         row count grows as turns arrive.
- FAIL:        later turns still dropped → BLOCK.

### v3.2 — Stop dropping tool_result / tool-call entries in the gateway transcript adapter [ ]
- Connects:    **gateway transcript adapter** → [keep tool entries] → state.db
- Purpose:     preserve tool messages that are currently silently dropped.
- Residue:     tool messages present in state.db.
- Produces for:**extraction/retrieval fidelity** and **operator** recall.
- Goal:        tool messages present in state.db for a session that had them.
- WIN:         tool_result / tool-call entries persisted.
- FAIL:        tool entries still dropped → BLOCK.

### v3.3 — Populate mentions.turn_index (last-turn-of-tail stamp)                    [ ]
- Connects:    **extraction** → [stamp turn_index] → mentions table
- Purpose:     give each mention positional context for recency-aware retrieval.
- Residue:     a populated `turn_index` column.
- Produces for:**retrieval ranking/recency** and the **watcher**.
- Goal:        `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h` > 0.
- WIN:         count > 0.
- FAIL:        count == 0 → BLOCK.

### v3.4 — Make tolerant extraction coercion the running path                        [ ]
- Connects:    **extract boundary** → [tolerant coercion] → state.db; rate observed in **watcher**
- Purpose:     raise extraction success by coercing minor schema deviations instead of hard-failing.
- Residue:     the tolerant coercion path live in the daemon.
- Produces for:**state.db completeness** and the **watcher's** success-rate metric.
- Goal:        watcher reports extraction success-rate >95% over a 10-session sample.
- WIN:         success-rate > 95% across 10 sessions.
- FAIL:        success-rate ≤ 95% → BLOCK.

---

## Block 4 — Synthesis = the Karpathy wiki (L4) · DECISIONS D5, D2 · the heart

### v4.1 — Generate structured MEMORY.md from entity/theme/decision tables (emits memory.synthesized) [ ]
- Connects:    state.db tables → [synthesis] → MEMORY.md; emits `memory.synthesized` → stream
- Purpose:     produce the structured root doc of the wiki from extracted structure.
- Residue:     an updated `MEMORY.md` + a `memory.synthesized` event.
- Produces for:the **operator** (reads MEMORY.md) and the **watcher** (event).
- Goal:        end a session → MEMORY.md updates within seconds with structured sections; `memory.synthesized` logged.
- WIN:         MEMORY.md updated with structured sections + event logged.
- FAIL:        no update, or no event → BLOCK.

### v4.2 — Generate Obsidian concept notes (frontmatter + LLM body + wikilinks)      [ ]
- Connects:    entities/themes → [LLM note-gen] → `concepts/*.md` (vault)
- Purpose:     build the linked concept layer of the wiki (one-hop navigability — DESIGN_INPUTS).
- Residue:     `concepts/*.md` notes with frontmatter, body, and `[[wikilinks]]`.
- Produces for:the **operator's Obsidian vault** (the knowledge graph).
- Goal:        relevant `concepts/*.md` notes appear with `[[wikilinks]]`.
- WIN:         notes present with working wikilinks.
- FAIL:        notes missing, or no links → BLOCK.

### v4.3 — Generate Obsidian session notes (dated, auto-linked to concepts touched)  [ ]
- Connects:    session + concepts touched → [note-gen] → `sessions/*.md`
- Purpose:     produce a dated session record auto-linked into the concept graph.
- Residue:     a `sessions/<date>-<topic>.md` note.
- Produces for:the **operator's** vault navigation.
- Goal:        a `sessions/<date>-<topic>.md` note appears, linking the concepts it touched.
- WIN:         dated note present with concept links.
- FAIL:        note missing, or unlinked → BLOCK.

### v4.4 — Session-end synthesis trigger                                             [ ]
- Connects:    session-end event → [trigger] → synthesis (4.1–4.3)
- Purpose:     fire synthesis automatically when a session ends.
- Residue:     a trigger wired to the session-end event.
- Produces for:the **synthesis pipeline**; visible in the **watcher**.
- Goal:        synthesis fires on a session-end event (visible in watcher).
- WIN:         fires on session-end.
- FAIL:        no fire → BLOCK.

### v4.5 — 30-min-while-active synthesis trigger                                     [ ]
- Connects:    30-min interval during a long active session → [trigger] → synthesis
- Purpose:     keep the wiki fresh during long sessions, not only at the end.
- Residue:     an interval trigger.
- Produces for:the **synthesis pipeline**; visible in the **watcher**.
- Goal:        synthesis fires on the 30-min interval during a long active session (visible in watcher).
- WIN:         fires on the interval mid-session.
- FAIL:        no fire → BLOCK.

### v4.6 — Deploy consolidation module; verify one manual cycle (emits memory.decayed/promoted) [ ]
- Connects:    state.db / vault → [consolidate.mjs] → archived / promoted entities; emits decay/promote → stream
- Purpose:     bring memory hygiene (decay + promotion) online.
- Residue:     `entities_archived` written OR a regenerated summary + `memory.decayed`/`memory.promoted` events.
- Produces for:**store health**, the **operator**, and the **watcher**.
- Goal:        `consolidate.mjs` runs once manually; entities_archived written OR a summary regenerated; decay/promote events logged.
- WIN:         archive/summary written + events logged on the manual cycle.
- FAIL:        no change produced, or no events → BLOCK.

### v4.7 — Install consolidation scheduler (plist) on the cadence                    [ ]
- Connects:    consolidate.mjs → [launchd plist] → unattended cadence
- Purpose:     run consolidation on a cadence without a human in the loop.
- Residue:     an installed launchd job.
- Produces for:**ongoing store health**.
- Goal:        scheduler installed (`launchctl list`); a cycle fires on cadence unattended.
- WIN:         job listed + a cycle fires unattended.
- FAIL:        not listed, or never fires → BLOCK.

### v4.8 — Assemble a daily/weekly digest deterministically from the vault           [ ]
- Connects:    vault notes → [deterministic assembler] → digest
- Purpose:     produce a coherent digest from synthesized notes (replacing the lossy hourly buffer dump).
- Residue:     a generated digest artifact.
- Produces for:the **operator**.
- Goal:        a generated digest reads coherently from vault notes (not an hourly buffer dump).
- WIN:         coherent digest assembled from vault notes.
- FAIL:        incoherent output, or still a buffer-dump → BLOCK.

### v4.9 — Retire the lossy hourly daily-log writer                                  [ ]
- Connects:    (removes) the old hourly writer → frees the `memory/` output surface
- Purpose:     kill the lossy, duplicative hourly writer (OUT_OF_SCOPE 2026-05-27).
- Residue:     the old writer no longer runs.
- Produces for:the **operator** (a clean, signal-bearing memory output).
- Goal:        the old hourly-repeat daily-log writer no longer runs (OUT_OF_SCOPE 2026-05-27 resolved).
- WIN:         writer gone; no hourly-repeat entries appear.
- FAIL:        the writer still runs → BLOCK.

---

## Block 5 — Retrieval freshness (L5) · REGISTRY 1.3

### v5.1 — knowledge.db incremental indexing of new sessions in the daemon's throttled work [ ]
- Connects:    new sessions → [incremental indexer in the daemon] → knowledge.db
- Purpose:     keep the retrieval index fresh as sessions arrive (no full reindex).
- Residue:     up-to-date `knowledge.db` session_documents.
- Produces for:the **retrieval channels** (FTS / vec).
- Goal:        knowledge.db session_documents max-time within 1h of the latest session.
- WIN:         index freshness < 1h behind latest session.
- FAIL:        index stale > 1h → BLOCK.

### v5.2 — Construct graphCache in the daemon + refresh it on the synthesis cadence  [ ]
- Connects:    state.db / knowledge.db → [graphCache build + refresh] → spreading-activation channel
- Purpose:     enable graph / spreading-activation retrieval, kept fresh on cadence.
- Residue:     a `graphCache` with `last_refresh_at`.
- Produces for:**retrieval channel 5** (spreading activation).
- Goal:        graph-cache `last_refresh_at` within 1h; channel-5 returns non-empty for a seeded query.
- WIN:         cache fresh < 1h + channel-5 non-empty.
- FAIL:        cache stale, or channel-5 empty → BLOCK.

### v5.3 — Verify all 5 retrieval channels return for a known-good query (integration checkpoint) [ ]
- Connects:    **inject server** (:7893) → [diagnostic across all 5 channels]
- Purpose:     integration checkpoint that retrieval works end-to-end across every channel.
- Residue:     a diagnostic result (checkpoint — no new persistent artifact).
- Produces for:**operator** confidence + downstream **inject** quality.
- Goal:        a diagnostic against :7893 shows non-empty hits from FTS, vec, entity, theme, and spreading-activation.
- WIN:         all 5 channels return non-empty for the known-good query.
- FAIL:        any channel returns empty → BLOCK.

---

## Block 6 — Health + storage hygiene (L6) · DESIGN_INPUTS §5 (the scars)

### v6.1 — Build lib/sqlite-store.mjs (WAL + foreign_keys + busy_timeout + integrity_check + user_version) [ ]
- Connects:    (new helper) → consumed by all DB-open sites (6.2)
- Purpose:     one hardened SQLite open path so every store gets the safety pragmas.
- Residue:     `lib/sqlite-store.mjs`.
- Produces for:every **store consumer** (daemon, indexer, watcher).
- Goal:        opening a store via the helper sets all pragmas (PRAGMA readback).
- WIN:         all pragmas set on readback.
- FAIL:        any pragma unset → BLOCK.

### v6.2 — Route all `new Database()` sites through the helper                        [ ]
- Connects:    scattered `new Database()` sites → [the 6.1 helper]
- Purpose:     eliminate raw, unhardened DB opens.
- Residue:     zero raw `new Database(` outside the helper.
- Produces for:**store reliability** across the system.
- Goal:        grep shows zero raw `new Database(` outside the helper.
- WIN:         grep count == 0.
- FAIL:        any raw open remains → BLOCK.

### v6.3 — Schema-version migration for the existing populated stores                [ ]
- Connects:    existing populated DBs → [migration] → versioned schema
- Purpose:     bring already-populated stores under schema version control.
- Residue:     a `user_version` on every store.
- Produces for:**future migrations** + integrity.
- Goal:        every store reports a user_version.
- WIN:         all stores versioned.
- FAIL:        any store unversioned → BLOCK.

### v6.4 — WAL checkpoint (TRUNCATE) on graceful shutdown                            [ ]
- Connects:    daemon shutdown → [WAL checkpoint TRUNCATE] → bounded WAL files
- Purpose:     prevent WAL bloat (the 331 MB scar).
- Residue:     bounded WAL files.
- Produces for:**disk health**.
- Goal:        WAL stays bounded across a day (no 331 MB-style bloat).
- WIN:         WAL bounded over a full day.
- FAIL:        WAL grows unbounded → BLOCK.

### v6.5 — Install health-watch; verify clean respawn + KeepAlive (no crash-loop)    [ ]
- Connects:    daemon crash → [launchd KeepAlive + health-watch] → healthy respawn; transition logged by the **watcher**
- Purpose:     guarantee the daemon self-heals without crash-looping.
- Residue:     an installed health-watch + KeepAlive policy.
- Produces for:**uptime**, the **operator**, and the **watcher** (records the transition).
- Goal:        kill the daemon → launchd respawns healthy within the interval; no restart loop; watcher logs the transition.
- WIN:         clean respawn, no loop, transition logged.
- FAIL:        crash-loop, or no respawn → BLOCK.
