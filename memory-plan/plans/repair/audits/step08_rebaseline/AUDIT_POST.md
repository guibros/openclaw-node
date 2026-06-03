# AUDIT_POST — Step 1.8: Data repair B — rebaseline (closes Block 1)

## Plan-vs-actual

Executed per AUDIT_PRE + the two operator decisions. Runtime data operation only; one sub-second transaction.

## Verification (Phase 5 — the Proof)

- **Backup:** `~/.openclaw/backups/pre-step-1-8-2026-06-03/state.db`.
- **Recount:** `mention_count := COUNT(DISTINCT session_id)` for the 132 entities with rows — **0 mismatches** post-write (SQL assert). Restored 941: **0 counts disturbed** (preserved baseline intact). New top-5 reflects real session counts (NATS-KV-pattern=77, Arcane=71, HIDDEN_TRUTH=60, NATS-JetStream=58, openclaw-tui=33; was Arcane "157").
- **Salience:** all 1073 at exactly 0.5 with fresh anchors — histogram is a single line; the 1.0-pin and ≈0.158 artifact clusters are gone (**0 rows ≠ 0.5**).
- **Stability (copy-run, 1.2-proven method):** 2 cycles at +30/+60 min → cycle 1: 0 decayed / 0 archived / 0 reinforced; cycle 2: one composed application, avg salience 0.5 → 0.49896 (**0.208% drift ≤ 0.3% gate**), archived 961→961, SUM(mention_count) 2118→2118.

## Macro Re-Orient (Block 1 close, WORKFLOW §7.2)

- **Principles/intent:** no D7/D8 violations; all work landed inside steps; one OUT_OF_SCOPE capture (bootstrap memory-maintenance exit 1).
- **Registry probes (live):** entities 1073 (132 organic + 941 restored), 68 above the concept threshold (mention_count ≥ 5), themes 652, decisions 341, mentions 973, vault 65 concept notes, archive 961 (941 flagged restored / 20 superseded). Consolidation is mathematically correct at runtime: anchored decay + credited reinforcement in overnight steady state.
- **Block 2 re-survey:** steps 2.1–2.11 remain atomic and correctly ordered; 2.9 stays defined-after-2.6. Scale note for 2.7: 68 above-threshold entities vs 65 existing notes — coverage backfill is modest; the link-integrity unknowns (2.4) are the bigger surface.
- **Drift check:** none — every change this block maps to a step commit.

## Block 1 outcome

The knowledge graph's numbers now measure memory: decay composes over time, reinforcement counts evidence, extraction counts content, turns resolve, MEMORY.md is atomic, the tick is single-flighted, and the data the bugs corrupted is restored + rebaselined. Block 2 (the vault referential system — the operator's headline) builds on true numbers.
