# Repair Plan — Step Inventory

Every finding from `FINDINGS_2026-06-02.md` decomposed to **true atomic grain**, v2 after the 2026-06-02 operator-directed atomization review (v1's bundled steps split — see DECISIONS).

**Atomicity test (applied to every step):** one step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit. If describing a step needs "and" between two independently-testable outcomes, it is split. The only sanctioned bundles are ones where the parts are NOT independently verifiable (each is justified inline).

**Structure rule:** every step carries an explicit **Goal** (the single outcome) and a **Proof** (the runtime-observable validation gate). *A step whose Proof is not produced and captured is NOT done — it is in-flight or blocked, never closed.* A step whose Proof cannot be written concretely is not ready to start (applies to the two `defined-at` placeholders, 2.9 and 3.4).

**Procedural rule:** every step runs the full per-step lifecycle in `WORKFLOW.md` §3 (identical protocol to the redesign plan):
Pre-flight → **Scope** (per-step SCOPE.md: goal = the step, files = its deltas, evidence = its Proof; hook gates) → **Phase 1·§0 micro Re-Orient** → Phase 1 AUDIT_PRE (in `audits/stepNN_<slug>/`) → Phase 4 implement (surprises → OUT_OF_SCOPE.md) → Phase 5 VERIFY = tests green **+ runtime evidence per the Proof line** (deploy via symlinks, restart, observe) → Phase 7 AUDIT_POST → Phase 8 corrections-or-BLOCK → Phase 8.5 Deep Review Gate (5 checks + Proof cited) → Phase 9 one commit with `Runtime-Evidence:` trailer + flip `[ ]→[x]` + registry/DECISIONS updates → **macro Re-Orient at every block close** (where placeholder steps get defined and the next block is re-atomicity-checked). Tripwire (WORKFLOW §7.3): ≥2 mid-implementation findings or sub-action sprawl = the step wasn't atomic → stop, split, re-plan.

**Operator priorities (2026-06-02):** (1) vault + wikilink referential system fully implemented, transparent, working — D7; (2) LLM infrastructure audited before further wiring — D8; (3) security PARKED until working prototype (Block P).

**Sequencing rationale:** Block 1 precedes the vault headline because the vault is *generated from* the tables Block-1 bugs corrupt every 30 minutes (R1-R4). Built first, the referential system would render fiction.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`, carrier starts at `v0.0`.
**Driver:** `tick` (autonomous-safe) · `hybrid` (tick implements, operator verifies runtime — redesign Blocks 4-6 pattern) · `operator` (interactive only).

---

## Block 1 — Stop the data corruption · R1-R5, R39

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | hybrid | Tick re-entrancy guard (R3) |
| 1 | 1.2 | v1.2 | [x] | hybrid | Time-anchored decay (R1) |
| 1 | 1.3 | v1.3 | [ ] | hybrid | Idempotent reinforcement (R2) |
| 1 | 1.4 | v1.4 | [ ] | hybrid | Extraction dedup at flush boundaries (R4) |
| 1 | 1.5 | v1.5 | [ ] | tick | turn_index stamps the last real turn (R5) |
| 1 | 1.6 | v1.6 | [ ] | tick | MEMORY.md writes go through atomic-write (R39) |
| 1 | 1.7 | v1.7 | [ ] | operator | Data repair A: restore bug-archived entities (after 1.2/1.3) |
| 1 | 1.8 | v1.8 | [ ] | operator | Data repair B: rebaseline salience + mention_count |

> **1.1 Goal:** at most one tick body executes at any time.
> **1.1 Proof:** induce a >30s tick (real LLM flush); the overlapping interval fire logs `tick skipped (in-flight)` and the watcher shows zero interleaved Phase-2 ops; regression test asserts the skip. [DONE 2026-06-02 — tick wrapped in the shared `createConcurrencyGuard` (maxAgeMs 30min), both call sites routed, skip logged. Runtime: PID 9102, induced long tick via planted gateway session `repair-11-verify` → boot tick 15:36:54, interval fire 15:37:24 logged `tick skipped (in-flight)`, zero interleaved Phase-0/2 sequences; watcher ingested the session ok. Tests 1493/0 (5 new in test/daemon-tick-guard.test.mjs — first defense of workspace-bin/memory-daemon.mjs).]
>
> **1.2 Goal:** decay is idempotent w.r.t. cycle frequency — N cycles in a window decay the same total amount as 1.
> **1.2 Proof:** on a copy of state.db, 3 consolidation cycles inside 1h decay an idle entity ≤0.4% total (per-cycle elapsed-time factor ≈0.1%, not the compounding ~33% observed pre-fix); `entities_archived` gains 0 rows across the 3 cycles in idle steady-state; unit test with a frozen clock locks the formula. [DONE 2026-06-02 — `last_decayed_at` anchor on entities+decisions (migration in initConsolidationTables); anchor = max(last_decayed_at, recall); written only on applied decay so sub-threshold composes. Copy-run: cycle2 decayed=0, cycles2-4 drift 0.19%, archived 961→961 (0 new) vs pre-fix "all 110 every cycle". Tests 3 new frozen-clock, 20/20 file.]
>
> **1.3 Goal:** a co-occurrence pair reinforces once per new shared-session evidence, never per cycle.
> **1.3 Proof:** SQL snapshot diff across 2 consecutive cycles with no new sessions = zero `mention_count`/salience change; adding one new shared session reinforces each member exactly +1; regression test.
>
> **1.4 Goal:** a flush over already-extracted content is a recorded noop, not a re-extraction.
> **1.4 Proof:** two `runFlush` calls over an unchanged session → the second inserts 0 mention rows (SQL) and the watcher records the op as `status:noop`/skip; a grown session extracts only the delta (new mention rows reference only new turns).
>
> **1.5 Goal:** every new mention's `turn_index` references a turn that exists.
> **1.5 Proof:** post-fix extraction → new mentions carry `turn_index == messageCount-1`, and a JOIN against `session_chunks.turn_index` for that session returns rows (no orphan index); regression test.
>
> **1.6 Goal:** MEMORY.md can never be observed half-written.
> **1.6 Proof:** grep shows zero bare `writeFileSync` on the MEMORY.md paths (pre-compression-flush ×2, memory-budget) — all routed through `lib/atomic-write.mjs`; one live flush observed updating MEMORY.md intact; tests green.
>
> **1.7 Goal:** entities archived by the R1 bug are back in the live table.
> **1.7 Proof:** dated `state.db` backup exists before the repair; restoration count logged; SQL shows restored entities live with preserved fields; the handling of their `entities_archived` rows (delete vs flag) decided in-step and logged in DECISIONS with the counts.
>
> **1.8 Goal:** salience and mention_count reflect documented formulas, not the bug equilibrium.
> **1.8 Proof:** sampled SQL assert `mention_count == COUNT(mentions)` for entities that have mention rows; entities without rows get the documented baseline; salience histogram shows no mass pinned at the 1.0/≈0.158 artifacts; values stable (≤0.3% drift) across 2 idle cycles; formula + numbers logged in DECISIONS.

## Block 2 — The vault referential system · D7 · R6-R10 · **the headline**

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | hybrid | All local vault/synthesis writers transparent (D7, R6) |
| 2 | 2.2 | v2.2 | [ ] | tick | One shared slugify for writers + UI route (R7) |
| 2 | 2.3 | v2.3 | [ ] | tick | Promoter writes only new/changed notes (R8) |
| 2 | 2.4 | v2.4 | [ ] | hybrid | Build the vault link-integrity checker (manual run) (R9) |
| 2 | 2.5 | v2.5 | [ ] | hybrid | Checker runs on the synthesis cadence + surfaced (R9) |
| 2 | 2.6 | v2.6 | [ ] | hybrid | Referential coverage report (R9) |
| 2 | 2.7 | v2.7 | [ ] | hybrid | Concept-note coverage backfill to 100% (R9) |
| 2 | 2.8 | v2.8 | [ ] | hybrid | Generators emit only resolving wikilinks (R9) |
| 2 | 2.9 | v2.9 | [ ] | — | (defined after 2.6 — its report is the input) themes/decisions surfaces, if the report shows gaps |
| 2 | 2.10 | v2.10 | [ ] | tick | memory.synthesized carries session_id (R10) |
| 2 | 2.11 | v2.11 | [ ] | tick | Truthful trigger labels at every flush site (R10) |

> **2.1 Goal:** no local writer consults the private flag (D7); the vault shows everything.
> **2.1 Proof:** grep shows no privacy-filtered path remaining in local vault writers (consolidation summaries, promoter, summarizer call sites); one consolidation cycle AND one flush each produce notes for previously-private entities (before/after file diff). The `private` column + filter machinery remain in code (federation-era, D4) — just unconsulted locally.
>
> **2.2 Goal:** one slugify definition, every producer and consumer of note filenames uses it.
> **2.2 Proof:** grep — single definition, imported by `obsidian-summarizer` and the mission-control memory-content route (and any other slug site); a >60-char concept name renders its prose in the content browser (HTTP check that returned "No concept note" pre-fix).
>
> **2.3 Goal:** promoter is idempotent — unchanged vault state writes nothing.
> **2.3 Proof:** two back-to-back promoter runs → second writes 0 files (vault mtime snapshot identical); a changed entity rewrites exactly its own note.
>
> **2.4 Goal:** a checker exists that reports the vault's referential integrity.
> **2.4 Proof:** CLI run against the live vault outputs note count, wikilink count, dangling links (listed), orphan notes (listed); a deliberately seeded dangling `[[link]]` is detected by name; removing it yields a clean run.
>
> **2.5 Goal:** the checker runs automatically on the synthesis cadence and its result is visible.
> **2.5 Proof:** after a live flush, a watcher record carries the dangling/orphan counts; the mission-control surface shows the latest counts matching a manual CLI run.
>
> **2.6 Goal:** referential coverage is a measured number, not a feeling.
> **2.6 Proof:** report (CLI or panel) shows: % of above-threshold entities with a concept note, % of wikilinks resolving, % of session notes linking ≥1 concept — each number reproduced by a manual SQL/fs spot-check.
>
> **2.7 Goal:** every above-threshold entity has a concept note.
> **2.7 Proof:** the 2.6 instrument reports 100% concept-note coverage after backfill; a newly-crossing entity gets its note on the next synthesis run (observed in the vault + watcher).
>
> **2.8 Goal:** generated notes contain only wikilinks that resolve.
> **2.8 Proof:** a post-change synthesis run produces notes for which the 2.4 checker reports 0 dangling links; the stub-vs-link-only-existing sub-decision is logged in DECISIONS.
>
> **2.9 Goal+Proof:** written when defined (input = 2.6's report; struck if the report shows no themes/decisions gap). Cannot start before its Proof line exists.
>
> **2.10 Goal:** every synthesis event is attributable to a session.
> **2.10 Proof:** schema accepts `session_id` (unit test); a live flush produces a watcher `memory.synthesized` record with `session` equal to the flushed session id (not null).
>
> **2.11 Goal:** each flush site emits its own truthful trigger label.
> **2.11 Proof:** the ACTIVE→IDLE flush no longer reports `interval`; each of the flush sites emits a distinct documented label (schema enum extended + tested); an induced idle flush shows its own label in the watcher.

## Block 3 — Local LLM infrastructure · D8 · R11-R14 · audit before wiring

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | operator | LLM infra audit (read-only) → `LLM_INFRA.md` (R13) |
| 3 | 3.2 | v3.2 | [ ] | hybrid | Queue wait-timeout abandons only its OWN job (R11) |
| 3 | 3.3 | v3.3 | [ ] | hybrid | health-watch sees the daemon's real queue (R12) |
| 3 | 3.4 | v3.4 | [ ] | — | (defined at block-open from 3.1) timeout/pre-warm/tiering/analysis remediations; R42 rides along |

> **3.1 Goal:** the LLM layer is measured end-to-end with a verdict per component.
> **3.1 Proof:** `LLM_INFRA.md` in this plan dir with a per-call-site table — model, measured cold ms, measured warm ms, timeout budget at every layer of the chain, failure behavior, verdict (sound / miswired / dead) — plus model-selection reality vs the "tiered selector (qwen3:8b floor)" claim and the pre-warm gap. Zero code changes in the commit (docs only); new findings appended to FINDINGS as R43+.
>
> **3.2 Goal:** the queue's single-flight invariant survives a second caller's timeout.
> **3.2 Proof:** regression test — two overlapping analyses, B's wait-timeout fires while A executes → A's job is NOT abandoned and no second concurrent Ollama request starts (queue-state assertion); full suite green.
>
> **3.3 Goal:** health-watch (separate process) reports the daemon's actual queue state. *(Single sanctioned bundle: exposing state with no consumer is dead code under the done-contract — the only verifiable outcome is the consumer reporting it.)*
> **3.3 Proof:** induce a stuck/slow LLM job in the daemon → health-watch logs/reports it within its interval and `.daemon-health.md`'s queue section shows nonzero state matching the daemon log; stuck-detection (and the auto-restart path) demonstrably reachable.
>
> **3.4 Goal+Proof:** written at Block-3 open from 3.1's numbers (macro Re-Orient). Cannot start before its Proof line exists.

## Block 4 — Daemon lifecycle · R15-R17, R40

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | hybrid | Shutdown fencing (R15) |
| 4 | 4.2 | v4.2 | [ ] | tick | Store-health probes decoupled from the NATS init block (R16) |
| 4 | 4.3 | v4.3 | [ ] | hybrid | NATS subsystems re-init after a failed boot connect (R16) |
| 4 | 4.4 | v4.4 | [ ] | tick | IDLE→ENDED flushes the ended session's JSONL (R17) |
| 4 | 4.5 | v4.5 | [ ] | tick | Extraction idle-timer stops self-perpetuating (R40) |

> **4.1 Goal:** SIGTERM produces a clean, fenced exit — stop ticking, drain the in-flight tick, close handles once, exit explicitly. *(One outcome: clean shutdown; the parts are one ordered behavior, not independently shippable.)*
> **4.1 Proof:** `launchctl kickstart -k` mid-extraction → exit within 10s, `launchctl` shows exit status 0 (not -9), zero new `.err` lines (no mutex abort, no ReferenceError), all three WALs at 0 bytes, shutdown log shows tick-drain before handle closes.
>
> **4.2 Goal:** SQLite store probes run regardless of NATS.
> **4.2 Proof:** stop NATS, restart daemon → `health.probe` records keep appearing in watcher.jsonl on the 5-min cadence while NATS-dependent components are absent.
>
> **4.3 Goal:** a daemon booted while NATS is down acquires the event log/watcher/trigger when NATS appears, without restart.
> **4.3 Proof:** boot daemon with NATS stopped → start NATS → within the retry interval the log shows NATS connected + event log + watcher initialized, a test publish lands in the stream, and the daemon PID is unchanged.
>
> **4.4 Goal:** a session ended by a new session appearing is flushed from ITS OWN transcript.
> **4.4 Proof:** induce a session switch → the flush/archive log and watcher record name the ENDED session's JSONL (not the newest file); unit test on the handler path.
>
> **4.5 Goal:** the idle-timer fallback fires on real inactivity only — no self-triggered loop after a session ends.
> **4.5 Proof:** observation window after a session truly ends shows zero repeating `extraction requested by idle-timer / skipping — session state is ENDED` pairs; the timer re-arms only on real session activity (log evidence).

## Block 5 — Retrieval freshness + honest signals · R18-R22

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | hybrid | Knowledge index re-indexes grown sessions (R18) |
| 5 | 5.2 | v5.2 | [ ] | tick | Retrieval channel failures surface (R19) |
| 5 | 5.3 | v5.3 | [ ] | hybrid | Promotion events emit on change only (R20) |
| 5 | 5.4 | v5.4 | [ ] | hybrid | Stall detector keyed to pipeline ops only (R20) |
| 5 | 5.5 | v5.5 | [ ] | tick | Readonly opens get busy_timeout (R21) |
| 5 | 5.6 | v5.6 | [ ] | tick | integrity_check only at boot / explicit CLI (R22) |

> **5.1 Goal:** a session that grows after first indexing gets re-indexed.
> **5.1 Proof:** index a session mid-flight, grow it → next Phase-2 pass updates its `content_hash` and chunk count in `session_documents`; an FTS query returns late-session content (SQL evidence).
>
> **5.2 Goal:** a failing retrieval channel is observable, never a silent empty result.
> **5.2 Proof:** induced channel failure on a scratch DB (e.g. renamed table) → a `memory.error` event naming the channel appears in the watcher + a log line; the healthy path still returns results.
>
> **5.3 Goal:** an unchanged promotion-candidate set does not re-emit events every cycle.
> **5.3 Proof:** 2 cycles with unchanged candidates → no second identical `memory.promoted` record in the watcher; a changed candidate set emits; emit-on-change vs real promotion bookkeeping decided and logged in DECISIONS.
>
> **5.4 Goal:** the stalled alert detects a dead pipeline even while the scheduler is alive.
> **5.4 Proof:** consolidation scheduler running + ingest/extract stopped → `watcher.alert` (stalled) fires within the threshold; with the pipeline active, no false alert over an observation window.
>
> **5.5 Goal:** readonly connections tolerate writer bursts.
> **5.5 Proof:** PRAGMA readback shows `busy_timeout=5000` on a readonly handle (test); an induced write burst with concurrent probes produces zero SQLITE_BUSY failures.
>
> **5.6 Goal:** the full integrity scan runs where intended, not per health poll.
> **5.6 Proof:** health-poll duration drops to <50ms (measured before/after); code trace confirms `integrity_check` only at daemon boot + explicit CLI; boot log still shows one integrity pass.

## Block 6 — Watcher/UI truth + usability · R23-R27

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | tick | event_id preserved → stable row identity; panel survives polls (R23) |
| 6 | 6.2 | v6.2 | [ ] | tick | HealthCard reads the fields the probe emits (R24) |
| 6 | 6.3 | v6.3 | [ ] | tick | fmtVal basenames only known path fields (R25) |
| 6 | 6.4 | v6.4 | [ ] | tick | Session-less panels skip the dead memory-content fetch (R26) |
| 6 | 6.5 | v6.5 | [ ] | hybrid | watcher.jsonl rotation (R27) |
| 6 | 6.6 | v6.6 | [ ] | hybrid | Watcher API reads the tail, not the whole file (R27) |

> **6.1 Goal:** an expanded detail panel stays open while the stream updates. *(Single sanctioned bundle: the record change and the key change are only verifiable together — the outcome is the surviving panel.)*
> **6.1 Proof:** new watcher.jsonl records carry `event_id` (test on toWatcherRecord); UI keys rows on it; manual check — a panel expanded on a live stream stays open across ≥3 polls with new events arriving.
>
> **6.2 Goal:** the health card renders what the probe actually emits — the drift light tells the truth.
> **6.2 Proof:** with symlinks intact, drift renders OK/green (was permanently red); WAL sizes and session_docs render values matching the latest `health.probe` record.
>
> **6.3 Goal:** content strings render whole; only path fields get basenamed.
> **6.3 Proof:** a decision text containing "/" renders in full in the detail tree while an `artifacts_written` path still renders as basename; unit test on the field allowlist.
>
> **6.4 Goal:** no fetch is fired whose result can never render.
> **6.4 Proof:** expanding a session-less event issues zero `/api/memory-content` requests (network log / server log evidence).
>
> **6.5 Goal:** watcher.jsonl is size-bounded.
> **6.5 Proof:** with a low cap induced, rotation triggers — active file ≤ cap, rotated segment archived alongside; both appenders (watcher loop, health probe) continue seamlessly post-rotation (new records flow).
>
> **6.6 Goal:** API cost is independent of history size.
> **6.6 Proof:** against a synthetic large file (≥50MB), `/api/watcher` answers <100ms (tail read, no full parse) with identical content for the tail window as the old implementation.

## Block 7 — Repo↔runtime + test defense · R28-R33, R41

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 7 | 7.1 | v7.1 | [ ] | tick | memory-daemon plist template carries the live env (R28) |
| 7 | 7.2 | v7.2 | [ ] | tick | redesign-tick plist paths point at the real tick-logs dir (R28) |
| 7 | 7.3 | v7.3 | [ ] | tick | Wiring-manifest rows defend workspace-bin/memory-daemon.mjs (R29) |
| 7 | 7.4 | v7.4 | [ ] | tick | Mesh/collab tests skip visibly, never exit(0)-as-pass (R32) |
| 7 | 7.5 | v7.5 | [ ] | tick | Watcher test fixtures validate against the real schemas (R33) |
| 7 | 7.6 | v7.6 | [ ] | tick | zod dependency declaration matches what's installed (R30) |
| 7 | 7.7 | v7.7 | [ ] | hybrid | Byte caps on event content fields + producer truncation (R31) |
| 7 | 7.8 | v7.8 | [ ] | operator | Dead event vocabulary resolved: wire or delete the 5 producer-less schemas (R41) |

> **7.1 Goal:** rendering the repo template reproduces the running daemon's environment.
> **7.1 Proof:** template rendered via the install path → diff vs the installed plist shows no missing env keys (OPENCLAW_NATS, OPENCLAW_NODE_ID, NODE_PATH); evidence in the commit body.
>
> **7.2 Goal:** the tick plist's log paths exist.
> **7.2 Proof:** repo plist StandardOut/ErrPath point at `memory-plan/plans/redesign/tick-logs/` (exists); `plutil -lint` passes.
>
> **7.3 Goal:** the LIVE daemon's wiring is structurally defended by tests.
> **7.3 Proof:** manifest rows target `workspace-bin/memory-daemon.mjs` (emit* producers at their boundaries, watcher init, inject-server dep passing); mutation check — commenting one wire in a scratch copy fails the test naming that wire; restored → green.
>
> **7.4 Goal:** untestable-here integration tests are visible skips, not silent passes.
> **7.4 Proof:** suite output on this machine shows `skipped > 0` with reasons; grep shows zero `process.exit(0)` in test `before()` hooks.
>
> **7.5 Goal:** test fixtures are valid instances of the schemas they impersonate.
> **7.5 Proof:** the memory-watcher fixtures parse against their real Zod schemas in a test (the current `channels_hit: ['fts','vec']` fixture fails it pre-fix, passes post-fix).
>
> **7.6 Goal:** event-schemas declares the zod it actually runs on.
> **7.6 Proof:** `npm ls zod` resolves consistently with package.json; event-schemas rebuild + tests green; a `publishLocal` round-trip against live NATS validates.
>
> **7.7 Goal:** no producible event can exceed the stream's payload limit or be silently dropped for size.
> **7.7 Proof:** every content-sample field carries `.max()` (schema test rejects oversized); producers truncate per-item — a synthetic 10KB decision string publishes successfully (truncated) against live NATS and renders in the watcher; no silent drop.
>
> **7.8 Goal:** zero producer-less schemas remain — each wired or deleted, none ambiguous.
> **7.8 Proof:** for each of the 5: either a producer exists (its event observed in the live stream) or the schema + its tests are removed with no orphan references (grep); operator decision logged in DECISIONS (lean: delete — federation can re-add).

## Block P — PARKED: security (operator directive 2026-06-02) · R34-R38

Deliberately deferred until a working prototype. Remarks live in FINDINGS Cluster 8 + D7. Nothing here starts without an operator un-park decision logged in DECISIONS.md. Goal+Proof lines are written at un-park.

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| P | P.1 | — | [ ] | operator | (PARKED) Narrow memory-file API jail to vault/MEMORY.md/logs (R34 — ~1-line; recommended early) |
| P | P.2 | — | [ ] | operator | (PARKED) Revisit prompt-plaintext + vault-sync exposure before federation (R35, R36) |
| P | P.3 | — | [ ] | operator | (PARKED) Federation daemon merge-or-delete per §4.6 + extraction-store db-option contract (R37) |
| P | P.4 | — | [ ] | operator | (PARKED) scope-check.sh tightening: glob depth, non-UTC expiry, heredoc note (R38) |

---

## Totals

| Block | Theme | Steps | Cumulative |
|-------|-------|-------|------------|
| 1 | stop data corruption | 8 | 8 |
| 2 | vault referential system (headline) | 11 (1 defined-at) | 19 |
| 3 | LLM infrastructure | 4 (1 defined-at) | 23 |
| 4 | daemon lifecycle | 5 | 28 |
| 5 | retrieval freshness + honest signals | 6 | 34 |
| 6 | watcher/UI | 6 | 40 |
| 7 | repo↔runtime + test defense | 8 | 48 |
| P | security (parked) | 4 | — |

**48 active steps (46 fully specified + 2 defined-at placeholders) + 4 parked.** Next step to execute: **1.1**.

### Atomization revision log (v1 → v2, 2026-06-02 operator review)

Applied the redesign atomicity test to every v1 step; 30 → 48. Splits: 1.5 (turn_index ∥ atomic writes → 1.5/1.6); 1.6 data repair (restore ∥ rebaseline → 1.7/1.8); 2.4 checker (build ∥ cadence+surface → 2.4/2.5, mirroring redesign's deploy-vs-schedule splits); 2.5 "completeness pass" was a mini-project (→ 2.6 measure / 2.7 backfill / 2.8 link repair / 2.9 defined-at); 2.6 events (session_id ∥ trigger labels → 2.10/2.11); 4.2 (probe decoupling ∥ NATS retry → 4.2/4.3); R40 promoted from ride-along to 4.5; 5.3 (promotion noop ∥ stall detector → 5.3/5.4); 5.4 (busy_timeout ∥ integrity_check → 5.5/5.6); 6.3 (fmtVal ∥ dead fetch → 6.3/6.4); 6.5 (rotation ∥ tail read → 6.5/6.6); 7.1 (two plists → 7.1/7.2); 7.3 (visible skips ∥ fixture validity → 7.4/7.5); 7.4 (zod ∥ byte caps → 7.6/7.7); R41 promoted from ride-along to 7.8. Sanctioned bundles (parts not independently verifiable): 3.3, 4.1, 6.1 — each justified inline.

## Work infrastructure

- Standard silo: per-step SCOPE contracts (hook-gated, one active scope repo-wide), canonical docs via `sync-canonical.sh`, viewer auto-discovery, per-step audits in `audits/stepNN_<slug>/`.
- **Tick automation:** not built. When wanted, clone the redesign pattern (`workspace-bin/redesign-tick.sh` + `TICK_PROMPT.md` + plist, RunAtLoad=false, BLOCK-not-fake + Runtime-Evidence trailer rules) as one scoped step. 1.7, 1.8, 3.1 and 7.8 stay operator-driven regardless.
