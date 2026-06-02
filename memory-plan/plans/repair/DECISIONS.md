# Decisions Ledger — repair plan

Append-only. Newest at top. Each entry: date, decision, why, consequences. Referenced by MASTER_PLAN §4.8 and §11.

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
