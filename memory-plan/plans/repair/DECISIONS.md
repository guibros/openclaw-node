# Decisions Ledger — repair plan

Append-only. Newest at top. Each entry: date, decision, why, consequences. Referenced by MASTER_PLAN §4.8 and §11.

---

## 2026-06-03 — Step 1.8 closed: rebaseline → Block 1 COMPLETE

**Decision (operator, via AskUserQuestion).** (1) `mention_count := COUNT(DISTINCT session_id)` for entities with mention rows — immune to residual pre-fix duplicate rows and consistent with reinforcement's shared-session semantics; the 941 restored keep their preserved historical counts (rows unrecoverable). (2) Salience **0.5 + fresh anchor for ALL live entities** — the same fresh-start the restored got; kills the remaining ≈0.158 artifact cluster (94 rows) outright; mention_count carries ranking until fresh dynamics differentiate.

**Evidence.** Backup `pre-step-1-8-2026-06-03`. Post-write SQL: 0 recount mismatches (132 entities), 0 restored counts disturbed, 0 rows with salience ≠ 0.5. New top-5 by real session count: NATS-KV-pattern 77, Arcane 71 (claimed "157" pre-fix), HIDDEN_TRUTH 60, NATS JetStream 58, openclaw-tui 33. Stability (1.2-proven copy-run, 2 cycles): 0.208% drift ≤ 0.3% gate, 0 archived, SUM(mention_count) stable at 2118.

**Block 1 close + macro Re-Orient (audits/step08_rebaseline/AUDIT_POST.md).** All 8 steps closed with runtime evidence. The graph's numbers now measure memory, not scheduler cadence. Live probes: 1073 entities (132 organic + 941 restored), 68 above concept threshold, 652 themes, 341 decisions, 973 mentions, 65 vault concept notes. Block 2 re-surveyed: steps remain atomic and ordered; 2.9 stays defined-after-2.6; 2.7's backfill scope is modest (68 threshold vs 65 notes) — 2.4's link-integrity unknowns are the bigger surface. No drift; next step **2.1** (unify all vault writers on transparent, D7).

---

## 2026-06-03 — Step 1.7 closed: bug-archived entities restored (operator-driven)

**Decision (operator, via AskUserQuestion).** (1) Restore **all 941** non-colliding archived entities — the bug killed them in hours, the fixed decay re-archives genuinely idle ones legitimately over ~46 days; maximally transparent per D7. (2) Restored salience **0.5 with `last_decayed_at` anchored at restore time** — archived values were sub-floor and would have re-archived within one cycle; 1.8 rebaselines uniformly. (3) **Flag, don't delete**: `entities_archived.restored_at` stamps the audit trail; the 20 name-collision rows (re-extracted since, live row wins) stay archived and unflagged.

**Precondition verified first.** Overnight post-fix scheduler cycles showed the steady-state signature (Decayed 24–45 with 0 archived, Reinforced 0, 364 credited pairs, archive frozen at 961) — the anchoring/seeding pass had completed.

**Evidence.** Backup `~/.openclaw/backups/pre-step-1-7-2026-06-03/state.db` (25.6 MB). One sub-second transaction on live state.db: 941 inserted with original ids (verified safe: AUTOINCREMENT, sequence 2177 > max archived id 2113, 0 id collisions), live entities 132 → **1073**, join-check **0 field-preservation failures** across all 941, 0 entities below the archive floor, 941 archive rows flagged / 20 unflagged.

**Consequences.** The archived entities' mention rows were deleted at archive time and are unrecoverable — their preserved `mention_count` is the historical baseline; 1.8's recount therefore applies only to entities that have mention rows. `entities_archived` semantics now: flagged = bug-era archive (restored), unflagged = superseded by later re-extraction.

---

## 2026-06-02 — Step 1.6 closed: MEMORY.md writes are atomic

**Decision.** All three MEMORY.md write sites (pre-compression-flush LLM + regex paths, memory-budget `#writeFile`) route through `atomicWriteFileSync` (tmp + fsync + rename; budget keeps its dir-creation via `mkdirp: true`). Concurrent readers (budget reload, companion-bridge) can never observe a torn file.

**Evidence.** Grep: zero bare `writeFileSync` in either file. Tests: targeted 72/72, full suite 1499/0. Observed deployed flush wrote MEMORY.md intact with no `.tmp` residue.

**No architectural decision needed.** Block 1 code steps (1.1–1.6) complete; 1.7/1.8 are operator-driven data repair — the autonomous chain BLOCKS here by design.

---

## 2026-06-02 — Step 1.5 closed: turn_index stamps the last real turn

**Decision.** The flush stamp is `messageCount - 1` (turns are 0-based). The prior `messageCount` stamp meant every mention referenced a turn that doesn't exist — the turn-grain mechanisms downstream could never match. The regression test that had locked the bug in (asserting 3 for a 3-message session) is corrected, not just extended.

**Evidence.** Tests 12/12. Runtime: real-LLM deployed runFlush against the 4-message `repair-11-verify` fixture in production state.db → mode=llm/16 facts, all mentions `turn_index=3` (=messageCount−1), JOIN to the messages table: 8 matched, **0 orphan stamps**.

**No architectural decision needed** — one-line semantic fix.

---

## 2026-06-02 — Step 1.4 closed: extraction dedup at flush boundaries

**Decision.** `runFlush` keeps a per-session record of the last successfully-extracted tail (`extraction_state`: session_id PK, sha256 of the tail's `[role, content]` pairs, message_count, extracted_at — lazy table in state.db via the store's db handle). Unchanged tail → no LLM call, no synthesis re-run, `mode:'llm-dedup'` with a zero-count extraction block that the daemon's existing emit guard turns into a watcher-classified `noop`. Hash recorded only after a successful store, so failed extractions retry. Delta-input extraction (feeding only new messages) deliberately not attempted.

**Evidence.** Tests: +1 integration (unchanged → dedup/0 LLM calls/0 new mentions; grown → re-extracts); full suite **1499/0**. Runtime, live daemon end-to-end (synthesisMs 60s temporarily, config backed up + reverted): flush#1 16:04:17 `[llm]` → watcher `status=ok entities=12`, 12 mention rows; flush#2 16:04:55 over the unchanged tail → `[llm-dedup]: 0 facts`, watcher `status=noop entities=0`, **0 mention rows inserted** (SQL window check). Fired on a real 712KB production session.

**No architectural decision needed.** All three mention-count inflators (R1 decay, R2 reinforcement, R4 re-extraction) are now off. Carry-forward: 1.5 can cross-check its stamp against `extraction_state.message_count`.

---

## 2026-06-02 — Step 1.3 closed: idempotent reinforcement

**Decision.** Co-occurrence reinforcement is credited-evidence-based: `cooccurrence_state(id_a, id_b, sessions_seen, last_reinforced_at)` (created lazily inside `reinforceCoOccurrence` so every caller is covered). A pair credits +1 mention_count / +0.05 salience per member when it first qualifies and again only when its shared-session count grows; equal counts skip; 30-day-window shrink is tracked downward (under-credit chosen over re-credit). The `pairs` return now reports only this cycle's credits.

**Evidence.** Tests: 22/22 (2 new: second-cycle full-snapshot deepEqual; one-new-session → exactly +1). Runtime: live-copy run — cycle 1 seeds 102 credits (the set the live scheduler had re-credited every 30 min), cycle 2 reinforced=0 with identical snapshots and unchanged SUM(mention_count)=9113, one real new shared session → exactly +1 per member. Deploy via lib symlink; scheduler picks it up next spawn.

**No architectural decision needed.** With 1.2+1.3, both halves of the salience/mention_count pump are off; the bug equilibrium is gone. Carry-forward: live scheduler log should show one ~102-credit seeding cycle then 0s — sanity check before 1.7/1.8.

---

## 2026-06-02 — Step 1.2 closed: time-anchored decay

**Decision.** Decay applications anchor at `last_decayed_at` (new nullable column on entities + decisions, migrated idempotently in `initConsolidationTables` — the only path that reads it). Per-cycle factor = 0.5^(Δt/14d) where Δt = now − max(last_decayed_at, last_recalled||last_seen): exponentials compose, so N cycles decay exactly as much as one; recall restarts the idle clock; the anchor is written only when decay actually applies, so sub-threshold deltas accumulate instead of vanishing. F-P212/F-L21/F-M18/F-P211 semantics preserved. Decisions loop fixed identically (same bug, same function).

**Evidence.** Tests: 3 new frozen-clock cases (compose-not-compound, recall reset, decisions parity), consolidation file 20/20. Runtime: 4 real-cadence cycles against a `.backup` copy of live state.db — cycle 2 decayed **0** entities (pre-fix live baseline: all 110, every cycle), cycles 2–4 total drift 0.19% (gate ≤0.4%), `entities_archived` 961→961 (0 new rows). Deploy is the lib symlink; the scheduler spawns fresh per StartInterval, so the next live cycle runs anchored decay with no restart step.

**No architectural decision needed** — formula correction within the documented half-life contract. Carry-forward: run 1.7/1.8 after one live anchored cycle; expect a one-time live anchoring pass that may floor a few bug-crushed idle entities (restorable in 1.7 with the rest).

---

## 2026-06-02 — Step 1.1 closed: tick re-entrancy guard → Opens Block 1

**Decision.** The daemon's tick loop is single-flighted through the existing shared `lib/concurrency-guard.mjs` (`createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000, log })`) — reuse of the F-P215/F-Q406 standardized fix, no new mechanism. Both call sites (immediate boot tick, 30s interval) route through the guard; an overlapping interval fire logs `tick skipped (in-flight)` and does nothing. maxAgeMs=30min force-clears a wedged tick (deadlock recovery over strict exclusion — same posture as the graph-cache usage).

**Evidence.** Tests: 1493/0 (5 new in `test/daemon-tick-guard.test.mjs` — behavioral single-flight + 4 source-wiring assertions; the first tests defending `workspace-bin/memory-daemon.mjs`). Runtime: daemon PID 9102 on repo code; induced long tick (planted gateway session `repair-11-verify`) → boot tick started 15:36:54, interval fire at 15:37:24 logged `tick skipped (in-flight)`, log shows one continuous Phase-0→Phase-2 sequence with zero interleaving; watcher recorded `memory.ingested` (`status:ok`) through the guarded tick.

**No architectural decision needed** — mechanical reuse. Carry-forward: `repair-11-verify` (4 messages) remains in state.db as a known fixture for 1.4's dedup proof; skip-line frequency doubles as a chronic-long-tick signal for 3.1. OUT_OF_SCOPE captured: Phase 0 bootstrap's `memory-maintenance` exits 1 while Phase 2's succeeds.

---

## 2026-06-02 — Inventory v2: atomization review (operator-directed) — 30 → 48 steps, Goal+Proof per step, 9-phase binding

**Decision.** The v1 inventory failed an operator review on three criteria and was rewritten in place:
1. **Atomization:** 13 v1 steps bundled ≥2 independently-verifiable outcomes (the "and" test from the redesign atomicity rule). All split — full ledger in INVENTORY's "Atomization revision log". Three bundles kept deliberately because their parts are NOT independently verifiable (3.3 expose+consume queue state — exposure alone is dead code; 4.1 shutdown ordering — one behavior; 6.1 record field + UI key — only the surviving panel is observable); each justified inline.
2. **Structure:** every step now carries an explicit **Goal** (single outcome) + **Proof** (concrete runtime-observable gate with thresholds where measurable). Rule stated at the top: no produced Proof → step not done; no writable Proof → step not startable (binds the 2 defined-at placeholders 2.9/3.4 and Block P).
3. **Procedural:** the per-step 9-phase lifecycle (WORKFLOW §3 — Scope→§0 Re-Orient→AUDIT_PRE→implement→VERIFY(tests+runtime)→AUDIT_POST→corrections→Deep-Review-Gate→commit, macro Re-Orient per block close, §7.3 tripwire) is now bound explicitly in the INVENTORY header; the copied WORKFLOW.md was repointed at this plan's docs (FINDINGS instead of MEMORY_REDESIGN, D7/D8 as the intent check instead of DESIGN_INPUTS, plan-local audits/ path) — protocol itself unchanged.

**Why.** Operator directive (verbatim criteria): maximize atomization to the simplest implementable task; every task needs a clear goal and a validation point that must be proved; procedure must follow the 9-phase step protocol as in the prior workplan. A verbatim-copied WORKFLOW with redesign references is itself the drift disease this discipline exists to kill.

**Consequences.** 48 active steps (46 fully specified, 2 defined-at), 4 parked. Step numbering changed from v1 — FINDINGS R-ids are the stable references. Next executable step remains 1.1.

---

## 2026-06-02 — D8: LLM infrastructure gets an audit-first block; no further LLM wiring until measured

**Decision.** The local LLM layer (llm-client, ollama-queue, query-analysis, extraction calls, concept-note summaries, health-watch's LLM introspection) is treated as **untrusted wiring** until a read-only audit (`step 3.1 → LLM_INFRA.md`) measures it end to end: every call site, the full timeout chain, cold/warm latencies per model, model-selection reality vs the MASTER_PLAN "tiered selector (qwen3:8b floor)" claim, and the pre-warm gap. Remediation steps (3.4) are defined from the audit, not guessed.

**Why.** Operator verdict (verbatim intent): the local LLM infrastructure is a crucial part of this harness and looks badly wired. Track record agrees: the 1s analysis ceiling made LLM analysis structurally impossible until 2026-06-01 (OUT_OF_SCOPE entry, resolved); the queue's single-flight invariant is breakable by a second caller's timeout (R11); health-watch's LLM stuck-detection inspects its own empty in-process queue and can never fire (R12). Three independent symptoms of wiring-by-assumption. MASTER_PLAN §4.5: reality before aspiration.

**Consequences.** Block 3 ordering: audit (3.1) → known mechanical fixes (3.2, 3.3) → audit-derived remediations (3.4, defined at block-open). The known fixes are NOT blocked on the audit (they're verified findings), but no new timeout values, model choices, or pre-warm strategies get committed before 3.1's numbers exist.

---

## 2026-06-02 — D7: the Obsidian vault is TRUSTED + FULLY TRANSPARENT for the dev/test phase

**Decision.** All local synthesis paths write everything — no privacy filtering on the vault, MEMORY.md, concept/session notes, digests, or watcher surfaces. `respectPrivacy:false` becomes the deliberate, uniform local posture (it was already the de-facto posture on the flush path and the inject server; the consolidation path's filtering was the inconsistent holdout). The `private` column and the filtering machinery are **retained in code and schema** (federation-era semantics, D4) but not consulted by any local writer. The vault + wikilink graph is the referential system — the operator's primary monitoring surface — and must be complete and on display.

**Why.** Operator directive (2026-06-02, verbatim intent): everything as transparent as possible to monitor a maximum during testing and development; the vault and link system IS the referential system and must be implemented and working. The previous state was the worst of both worlds: a referential system built on default-private data, with one path filtering (producing near-empty output) and another bypassing (silently violating the documented invariant) — R6 in FINDINGS_2026-06-02.md. A referential system that hides its referents is not a referential system.

**Security remark (parked, revisit at working-prototype / before federation or any vault sync):**
- The vault may be cloud-synced (iCloud/Dropbox/Syncthing) — transparent content leaves the machine with it (R36).
- `memory.retrieved` events persist prompt plaintext (first 200 chars) into the event stream + watcher.jsonl (R35).
- The mission-control file API currently jails to all of `~/.openclaw`, which contains `identity.key`, `.mesh-secret`, `discord.token`, telegram credentials (R34) — unauthenticated localhost read. ~1-line narrowing; recommended early even within the parked block.
These are accepted exposures **for now**, by operator decision, in exchange for maximum observability. Block P holds them; un-parking requires an operator decision logged here.

**Consequences.** Step 2.1 unifies every path on transparent and removes the contradiction. Privacy work is *out* of the local-first scope entirely; it returns as a federation concern (the offerer/acceptor boundary is where filtering matters — that infrastructure stays intact). Turn-grain mechanics (turn_index, R5) still get fixed in 1.5 because correct provenance is valuable for ranking and debugging regardless of privacy.

---

## 2026-06-02 — Plan created: repair (post-review correction + upgrade)

**Decision.** New plan silo `memory-plan/plans/repair/` created from the 2026-06-02 deep review (4 parallel review agents + hand-verification of critical claims; baseline in `FINDINGS_2026-06-02.md`, 42 findings R1-R42). 30 active steps across 7 blocks + a parked security block (P). Block order: 1 stop-data-corruption → 2 vault referential system (operator headline) → 3 LLM infra (audit-first) → 4 daemon lifecycle → 5 retrieval freshness → 6 watcher/UI → 7 repo↔runtime defense.

**Why Block 1 before the headline Block 2.** The vault is generated from the entity/theme/decision tables. R1 (compounding decay) + R2 (non-idempotent reinforcement) + R3 (tick re-entrancy) + R4 (re-extraction) actively corrupt those tables on a 30-minute cadence — 961 of ~1,070 entities ever seen are already archived, survivors' salience/mention_count are scheduler artifacts. A referential system rendered from that data would lie. Block 1 is 6 small steps; it stops the bleeding and repairs the data (1.6) so Block 2 builds on truth.

**Consequences.** Redesign plan stays closed at v6.5 (Blocks 0–6 COMPLETE; its Block 7/federation remains deferred — now joined by parked R37). The redesign tick chain stays disabled; repair has no tick automation yet (built on operator demand, see INVENTORY "Work infrastructure"). One scope active at a time, repo-wide, unchanged.
