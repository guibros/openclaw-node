# AUDIT_PRE — Step 1.8: Data repair B — rebaseline salience + mention_count

## §0 Re-orient
- Where am I: Block 1, step 8/8, 8/48 overall. Operator-driven; closes Block 1 → macro Re-Orient follows.
- Last step changed: 1.7 — 941 entities restored (v1.7).
- This step contributes: the graph's two core numbers stop being bug artifacts; everything downstream (vault ranking, promotion, concept thresholds) computes from documented formulas.
- Block serves the north star via: D7's vault renders these numbers — they must be true first.
- Still the right next step? Yes — last step of the block.

## Operator decisions (locked, via AskUserQuestion)
1. **mention_count := COUNT(DISTINCT session_id)** for the 132 entities with mention rows (immune to residual pre-fix duplicate rows; matches reinforcement's shared-session semantics). The 941 restored keep their preserved historical counts (rows unrecoverable).
2. **salience := 0.5 + last_decayed_at = now for ALL live entities** — uniform post-fix fresh start (the restored 941 are already there; idempotent for them). Kills the ~94-entity 0.158-artifact cluster.

## Pre-repair facts
- 132 entities with rows; 102 of them inflated (Gui 91→~5 sessions, Telegram 84→4, Arcane 157→71).
- Salience histogram: pinned@1.0 = 0 (overnight anchored decay already cleared it); <0.2 = 94 (the 0.158 artifact); 0.2–0.5 = 26; rest at 0.5.

## Plan
1. Dated backup → `~/.openclaw/backups/pre-step-1-8-2026-06-03/state.db`.
2. One transaction: distinct-session recount for entities with rows; uniform salience/anchor write.
3. Verify per Proof: 0 recount mismatches; restored counts untouched; histogram = single 0.5 line (no 1.0/0.158 mass); stability via the 1.2-proven copy-run method (2 cycles at +30/+60 min on a post-repair copy → drift ≤0.3%, 0 archived); live scheduler confirms organically on its next cycles.

## Risk register
- Uniform 0.5 flattens ranking until mention_count and fresh dynamics differentiate — accepted by decision (mention_count carries the signal).
- Decisions-table salience left to natural dynamics (1.8's Proof scopes entities; decisions decay is already anchored per 1.2).
