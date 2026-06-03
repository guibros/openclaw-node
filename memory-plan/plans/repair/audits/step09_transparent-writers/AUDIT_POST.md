# AUDIT_POST — Step 2.1: All local vault writers transparent (D7, R6)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/obsidian-summarizer.mjs` | ✓ | Default flipped in `queryConceptData` + `generateConceptNotes` (`respectPrivacy === true` = opt-IN filter); doc blocks re-anchored F-N102 → D7 with the R36 parking pointer. Filter machinery intact. |
| `lib/pre-compression-flush.mjs` | ✓ | Redundant `respectPrivacy: false` removed from the flush call (default is the single source). |
| `test/obsidian-summarizer.test.mjs` | ✓ | F-N102 default-filter test → D7 default-transparency test; opt-out test → opt-IN filter test (same exclusion assertions behind `respectPrivacy: true`). |

## Verification (Phase 5 — the Proof)

- **grep:** zero local writers opt into filtering (only the doc line mentions `respectPrivacy: true`); consolidation + promoter inherit transparent via the default; injector untouched (not a vault writer).
- **Tests:** 48/48 across summarizer/consolidation/extraction-store.
- **Consolidation cycle (the newly-transparent path):** kickstarted the live scheduler post-change → cycle complete; 5 concept notes freshly written including `nats-kv-interference-bug-pattern.md` and `arcane.md` — both `private=1` (SQL-confirmed). Pre-change this path excluded every row (all entities default-private). Bonus: cycle shows Block 1 live in steady state (Decayed 0 / 0 archived / Reinforced 0; promotion candidates 103 → 24 under recounted thresholds).
- **Flush:** deployed runFlush (real LLM, grown fixture) → `mode=llm`, **10 concept notes written** for private-flagged entities (nats-jetstream.md, arcane.md, …).

## Findings
- None new.

## Carry-forwards
- The fixture session now has 5 messages; its extraction_state hash updated.
- 2.3 note: this flush rewrote 10 notes for likely-unchanged concepts — the regenerate-every-call behavior is exactly what 2.3 (promoter) and the summarizer's change-skip get measured against in 2.6's coverage work.
