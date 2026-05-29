# AUDIT_PRE — Step 8.1: Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote)

## §1 — Intent

Implement the consolidation jobs library — the "sleep" analog that maintains graph health via periodic batch processing. Six independently runnable + testable functions cover: salience decay with archival, co-occurrence reinforcement, cluster detection for theme candidates, concept note regeneration, contradiction detection, and promotion candidate evaluation. A CLI orchestrator runs one full cycle.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 8 | 8.1 | v8.1 | [A] | Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote) |

## §3 — Design decisions (consumed from prior carry-forwards)

From AUDIT_POST Step 7.4 §6 + RESUME.md §0 Block 8 frozen decisions:

- Test baseline: 869 tests (792 pass, 77 fail — 73 pre-existing + 4 flaky).
- Block 7 is complete (4/4). Block 8 (Consolidation cycle) is next.
- Block 8 scope: Steps 8.1–8.4 (8.3 and 8.4 are parameter specifications consumed by 8.1, not separate inventory steps).
- **Decay parameters** (§0 "8.3"):
  - Salience decay half-life: 14 days for un-recalled items: `new = old * 0.5^(days_since_recall / 14)`
  - Drop threshold: salience < 0.05 → move to `entities_archived` table (don't hard delete)
  - Reinforcement: entities co-occurring in ≥3 recent sessions → `mention_count += 1` and `salience += 0.05` (capped 1.0)
  - This is the decay HALF of the reconsolidation loop from Block 7 amendment (C). Reconsolidation boosts on recall (Block 7); decay runs in batch here (Block 8).
- **Cluster detection** (§0 "8.4"):
  - Simple co-occurrence threshold: entities appearing in same session ≥5 times → candidate for new theme note
  - NOT k-means / DBSCAN — deterministic + transparent preferred
- **Consolidation functions** (§0 "8.1"):
  - `decayWeights()`, `reinforceCoOccurrence()`, `detectClusters()`, `regenerateSummaries()`, `detectContradictions()`, `evaluatePromotionCandidates()`
  - Each independently runnable + testable
  - `bin/consolidate.mjs` orchestrates one full cycle

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| `entities_archived` table doesn't exist yet | LOW | Create via idempotent `CREATE TABLE IF NOT EXISTS` in consolidation module init |
| Decay formula edge cases (last_recalled=NULL, salience=NULL) | LOW | NULL last_recalled → use last_seen; NULL salience → default 0.5 |
| Co-occurrence query on large datasets slow | LOW | Use indexed session_id on mentions table (already indexed) |
| Circular dependency with obsidian-summarizer for regenerateSummaries | LOW | Dynamic import (already the pattern in this codebase) |

## §5 — Deferrals

- Actual scheduling (Step 8.2) deferred — this step only builds the library + orchestrator.
- `ollama-queue` integration for LLM-based summarization deferred to Step 8.2 scheduler.
- Embedding new content and extracting entities from new sessions are handled by existing infrastructure (not part of this step's 6 functions).
- The `entities_archived` table is a dead-letter store; no query API for archived entities in this step.

## §6 — Phase 4 implementation outline

| # | File | Action | Delta |
|---|------|--------|-------|
| 1 | `lib/consolidation.mjs` | new | Main consolidation jobs library. Constants: `DECAY_HALF_LIFE_DAYS` (14), `DECAY_DROP_THRESHOLD` (0.05), `REINFORCEMENT_COOCCURRENCE_MIN` (3), `REINFORCEMENT_SALIENCE_BOOST` (0.05), `CLUSTER_COOCCURRENCE_MIN` (5). Exports: `initConsolidationTables(db)` (creates `entities_archived` table idempotently), `decayWeights(db, opts?)` (SELECT entities/decisions with stale salience, apply half-life formula, archive below threshold), `reinforceCoOccurrence(db, opts?)` (find entity pairs co-occurring in ≥3 recent sessions, bump mention_count + salience), `detectClusters(db, opts?)` (find entity groups appearing in same session ≥5 times, return cluster candidates), `regenerateSummaries(opts)` (call generateConceptNotes for entities whose mention_count changed significantly since last consolidation), `detectContradictions(db)` (wrapper around surfaceConflicts from conflict-surfacing.mjs, adds staleness detection), `evaluatePromotionCandidates(db, opts?)` (query entities above promotion threshold, return candidates with policy evaluation). |
| 2 | `bin/consolidate.mjs` | new | CLI orchestrator. Imports all 6 jobs from `lib/consolidation.mjs`. `runConsolidationCycle(opts)` runs them in sequence: init tables → decay → reinforce → detect clusters → regenerate summaries → detect contradictions → evaluate promotion. Returns `{ decayed, reinforced, clusters, summariesRegenerated, contradictions, promotionCandidates, durationMs }`. CLI entry with `--db`, `--vault-path`, `--dry-run` flags. |
| 3 | `test/consolidation.test.mjs` | new | Tests for all 6 exported functions + orchestrator. ~8-10 `it()` blocks: initConsolidationTables creates table, decayWeights applies half-life + archives below threshold, reinforceCoOccurrence bumps co-occurring entities, detectClusters finds co-occurrence groups, detectContradictions returns conflicts, evaluatePromotionCandidates returns above-threshold entities, runConsolidationCycle orchestration. |
